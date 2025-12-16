package ionc

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/uniset"
)

// SensorUpdate обновление значения IONC датчика
type SensorUpdate struct {
	ObjectName string            `json:"object"`
	Sensor     uniset.IONCSensor `json:"sensor"`
	Timestamp  time.Time         `json:"timestamp"`
}

// BatchUpdateCallback функция обратного вызова для батчевых обновлений
type BatchUpdateCallback func(updates []SensorUpdate)

// Poller опрашивает IONC датчики для подписанных клиентов
type Poller struct {
	client    *uniset.Client
	interval  time.Duration
	callback  BatchUpdateCallback
	batchSize int // макс. датчиков в одном запросе

	mu sync.RWMutex
	// subscriptions: objectName -> set of sensorIDs
	subscriptions map[string]map[int64]struct{}
	// lastValues: objectName -> sensorID -> value (для отправки только изменений)
	lastValues map[string]map[int64]int64

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewPoller создает новый IONC poller
// batchSize - макс. количество датчиков в одном запросе (0 = без ограничения)
func NewPoller(client *uniset.Client, interval time.Duration, batchSize int, callback BatchUpdateCallback) *Poller {
	ctx, cancel := context.WithCancel(context.Background())

	return &Poller{
		client:        client,
		interval:      interval,
		callback:      callback,
		batchSize:     batchSize,
		subscriptions: make(map[string]map[int64]struct{}),
		lastValues:    make(map[string]map[int64]int64),
		ctx:           ctx,
		cancel:        cancel,
	}
}

// Start запускает polling
func (p *Poller) Start() {
	p.wg.Add(1)
	go p.pollLoop()
	slog.Info("IONC Poller started", "interval", p.interval)
}

// Stop останавливает polling
func (p *Poller) Stop() {
	p.cancel()
	p.wg.Wait()
	slog.Info("IONC Poller stopped")
}

// Subscribe подписывает на датчики объекта
func (p *Poller) Subscribe(objectName string, sensorIDs []int64) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.subscriptions[objectName] == nil {
		p.subscriptions[objectName] = make(map[int64]struct{})
	}
	if p.lastValues[objectName] == nil {
		p.lastValues[objectName] = make(map[int64]int64)
	}

	for _, id := range sensorIDs {
		p.subscriptions[objectName][id] = struct{}{}
	}

	slog.Debug("IONC sensors subscribed", "object", objectName, "count", len(sensorIDs))
}

// Unsubscribe отписывает от датчиков объекта
func (p *Poller) Unsubscribe(objectName string, sensorIDs []int64) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if sensors, ok := p.subscriptions[objectName]; ok {
		for _, id := range sensorIDs {
			delete(sensors, id)
			delete(p.lastValues[objectName], id)
		}
		if len(sensors) == 0 {
			delete(p.subscriptions, objectName)
			delete(p.lastValues, objectName)
		}
	}

	slog.Debug("IONC sensors unsubscribed", "object", objectName, "count", len(sensorIDs))
}

// UnsubscribeAll отписывает объект от всех датчиков
func (p *Poller) UnsubscribeAll(objectName string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	delete(p.subscriptions, objectName)
	delete(p.lastValues, objectName)
	slog.Debug("IONC all sensors unsubscribed", "object", objectName)
}

// GetSubscriptions возвращает список подписок для объекта
func (p *Poller) GetSubscriptions(objectName string) []int64 {
	p.mu.RLock()
	defer p.mu.RUnlock()

	sensors, ok := p.subscriptions[objectName]
	if !ok {
		return nil
	}

	result := make([]int64, 0, len(sensors))
	for id := range sensors {
		result = append(result, id)
	}
	return result
}

// GetAllSubscriptions возвращает все подписки
func (p *Poller) GetAllSubscriptions() map[string][]int64 {
	p.mu.RLock()
	defer p.mu.RUnlock()

	result := make(map[string][]int64)
	for obj, sensors := range p.subscriptions {
		ids := make([]int64, 0, len(sensors))
		for id := range sensors {
			ids = append(ids, id)
		}
		result[obj] = ids
	}
	return result
}

// SubscriptionCount возвращает количество подписок
func (p *Poller) SubscriptionCount() int {
	p.mu.RLock()
	defer p.mu.RUnlock()

	count := 0
	for _, sensors := range p.subscriptions {
		count += len(sensors)
	}
	return count
}

func (p *Poller) pollLoop() {
	defer p.wg.Done()

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			p.poll()
		}
	}
}

func (p *Poller) poll() {
	// Копируем подписки под блокировкой
	p.mu.RLock()
	subsSnapshot := make(map[string][]int64)
	for obj, sensors := range p.subscriptions {
		ids := make([]int64, 0, len(sensors))
		for id := range sensors {
			ids = append(ids, id)
		}
		subsSnapshot[obj] = ids
	}
	p.mu.RUnlock()

	if len(subsSnapshot) == 0 {
		return
	}

	// Собираем все изменения в batch
	var batch []SensorUpdate
	now := time.Now()

	// Опрашиваем каждый объект
	for objectName, sensorIDs := range subsSnapshot {
		if len(sensorIDs) == 0 {
			continue
		}

		sensors, err := p.pollObject(objectName, sensorIDs)
		if err != nil {
			slog.Error("IONC poll failed", "object", objectName, "error", err)
			continue
		}

		// Добавляем изменившиеся значения в batch
		for _, sensor := range sensors {
			if p.hasValueChanged(objectName, sensor.ID, sensor.Value) {
				batch = append(batch, SensorUpdate{
					ObjectName: objectName,
					Sensor:     sensor,
					Timestamp:  now,
				})
			}
		}
	}

	// Отправляем batch целиком
	if len(batch) > 0 && p.callback != nil {
		p.callback(batch)
	}
}

func (p *Poller) pollObject(objectName string, sensorIDs []int64) ([]uniset.IONCSensor, error) {
	// Если батчинг включен и датчиков больше чем batchSize, разбиваем на батчи
	if p.batchSize > 0 && len(sensorIDs) > p.batchSize {
		return p.pollObjectBatched(objectName, sensorIDs)
	}

	return p.pollObjectSingle(objectName, sensorIDs)
}

func (p *Poller) pollObjectSingle(objectName string, sensorIDs []int64) ([]uniset.IONCSensor, error) {
	// Формируем строку запроса: id1,id2,id3
	query := ""
	for i, id := range sensorIDs {
		if i > 0 {
			query += ","
		}
		query += fmt.Sprintf("%d", id)
	}

	resp, err := p.client.GetIONCSensorValues(objectName, query)
	if err != nil {
		return nil, err
	}

	return resp.Sensors, nil
}

func (p *Poller) pollObjectBatched(objectName string, sensorIDs []int64) ([]uniset.IONCSensor, error) {
	var allSensors []uniset.IONCSensor
	var lastErr error

	// Разбиваем на батчи
	for i := 0; i < len(sensorIDs); i += p.batchSize {
		end := i + p.batchSize
		if end > len(sensorIDs) {
			end = len(sensorIDs)
		}
		batch := sensorIDs[i:end]

		sensors, err := p.pollObjectSingle(objectName, batch)
		if err != nil {
			lastErr = err
			slog.Debug("IONC batch poll failed", "object", objectName, "batch", i/p.batchSize, "error", err)
			continue
		}

		allSensors = append(allSensors, sensors...)
	}

	// Возвращаем ошибку только если не получили ни одного датчика
	if len(allSensors) == 0 && lastErr != nil {
		return nil, lastErr
	}

	return allSensors, nil
}

func (p *Poller) hasValueChanged(objectName string, sensorID int64, newValue int64) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.lastValues[objectName] == nil {
		p.lastValues[objectName] = make(map[int64]int64)
	}

	lastValue, exists := p.lastValues[objectName][sensorID]
	if !exists || lastValue != newValue {
		p.lastValues[objectName][sensorID] = newValue
		return true
	}
	return false
}
