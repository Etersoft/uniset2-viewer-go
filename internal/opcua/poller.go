package opcua

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/uniset"
)

// OPCUASensor представляет датчик OPC UA
type OPCUASensor struct {
	ID     int64       `json:"id"`
	Name   string      `json:"name"`
	IOType string      `json:"iotype"`
	Value  interface{} `json:"value"`
	Tick   int64       `json:"tick"`
	NodeID string      `json:"nodeId"`
	Status string      `json:"status"`
}

// SensorUpdate обновление значения OPC UA датчика
type SensorUpdate struct {
	ObjectName string      `json:"object"`
	Sensor     OPCUASensor `json:"sensor"`
	Timestamp  time.Time   `json:"timestamp"`
}

// BatchUpdateCallback функция обратного вызова для батчевых обновлений
type BatchUpdateCallback func(updates []SensorUpdate)

// Poller опрашивает OPC UA датчики для подписанных клиентов
type Poller struct {
	client    *uniset.Client
	interval  time.Duration
	callback  BatchUpdateCallback
	batchSize int // макс. датчиков в одном цикле опроса (0 = без ограничения)

	mu sync.RWMutex
	// subscriptions: objectName -> set of sensorIDs
	subscriptions map[string]map[int64]struct{}
	// lastValues: objectName -> sensorID -> value hash (для отправки только изменений)
	lastValues map[string]map[int64]string

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewPoller создает новый OPC UA poller
// batchSize - макс. количество датчиков в одном цикле опроса (0 = без ограничения)
func NewPoller(client *uniset.Client, interval time.Duration, batchSize int, callback BatchUpdateCallback) *Poller {
	ctx, cancel := context.WithCancel(context.Background())

	return &Poller{
		client:        client,
		interval:      interval,
		callback:      callback,
		batchSize:     batchSize,
		subscriptions: make(map[string]map[int64]struct{}),
		lastValues:    make(map[string]map[int64]string),
		ctx:           ctx,
		cancel:        cancel,
	}
}

// Start запускает polling
func (p *Poller) Start() {
	p.wg.Add(1)
	go p.pollLoop()
	slog.Info("OPCUA Poller started", "interval", p.interval)
}

// Stop останавливает polling
func (p *Poller) Stop() {
	p.cancel()
	p.wg.Wait()
	slog.Info("OPCUA Poller stopped")
}

// Subscribe подписывает на датчики объекта
func (p *Poller) Subscribe(objectName string, sensorIDs []int64) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.subscriptions[objectName] == nil {
		p.subscriptions[objectName] = make(map[int64]struct{})
	}
	if p.lastValues[objectName] == nil {
		p.lastValues[objectName] = make(map[int64]string)
	}

	for _, id := range sensorIDs {
		p.subscriptions[objectName][id] = struct{}{}
	}

	slog.Debug("OPCUA sensors subscribed", "object", objectName, "count", len(sensorIDs))
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

	slog.Debug("OPCUA sensors unsubscribed", "object", objectName, "count", len(sensorIDs))
}

// UnsubscribeAll отписывает объект от всех датчиков
func (p *Poller) UnsubscribeAll(objectName string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	delete(p.subscriptions, objectName)
	delete(p.lastValues, objectName)
	slog.Debug("OPCUA all sensors unsubscribed", "object", objectName)
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
			slog.Error("OPCUA poll failed", "object", objectName, "error", err)
			continue
		}

		// Добавляем изменившиеся значения в batch
		for _, sensor := range sensors {
			if p.hasValueChanged(objectName, sensor) {
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

func (p *Poller) pollObject(objectName string, sensorIDs []int64) ([]OPCUASensor, error) {
	sensors := make([]OPCUASensor, 0, len(sensorIDs))

	// Запрашиваем каждый датчик отдельно
	// TODO: оптимизировать - добавить batch API в uniset если возможно
	for _, id := range sensorIDs {
		resp, err := p.client.GetOPCUASensor(objectName, id)
		if err != nil {
			slog.Debug("OPCUA sensor poll failed", "object", objectName, "id", id, "error", err)
			continue
		}

		if resp.Sensor == nil {
			continue
		}

		sensor := OPCUASensor{}
		sensorMap := resp.Sensor

		if v, ok := sensorMap["id"].(float64); ok {
			sensor.ID = int64(v)
		}
		if v, ok := sensorMap["name"].(string); ok {
			sensor.Name = v
		}
		if v, ok := sensorMap["iotype"].(string); ok {
			sensor.IOType = v
		}
		sensor.Value = sensorMap["value"]
		if v, ok := sensorMap["tick"].(float64); ok {
			sensor.Tick = int64(v)
		}
		if v, ok := sensorMap["nodeId"].(string); ok {
			sensor.NodeID = v
		}
		if v, ok := sensorMap["status"].(string); ok {
			sensor.Status = v
		}

		sensors = append(sensors, sensor)
	}

	return sensors, nil
}

func (p *Poller) hasValueChanged(objectName string, sensor OPCUASensor) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.lastValues[objectName] == nil {
		p.lastValues[objectName] = make(map[int64]string)
	}

	// Создаём хеш из value + tick для определения изменений
	currentHash := formatValueHash(sensor.Value, sensor.Tick)

	lastHash, exists := p.lastValues[objectName][sensor.ID]
	if !exists || lastHash != currentHash {
		p.lastValues[objectName][sensor.ID] = currentHash
		return true
	}
	return false
}

func formatValueHash(value interface{}, tick int64) string {
	// Простой хеш: value|tick
	return formatValue(value) + "|" + formatInt64(tick)
}

func formatValue(v interface{}) string {
	if v == nil {
		return "nil"
	}
	switch val := v.(type) {
	case float64:
		return formatFloat64(val)
	case int64:
		return formatInt64(val)
	case int:
		return formatInt64(int64(val))
	case string:
		return val
	case bool:
		if val {
			return "true"
		}
		return "false"
	default:
		return "?"
	}
}

func formatFloat64(v float64) string {
	// Быстрое форматирование без использования fmt
	if v == float64(int64(v)) {
		return formatInt64(int64(v))
	}
	// Для дробных значений используем простой формат
	intPart := int64(v)
	fracPart := int64((v - float64(intPart)) * 1000000)
	if fracPart < 0 {
		fracPart = -fracPart
	}
	return formatInt64(intPart) + "." + formatInt64(fracPart)
}

func formatInt64(v int64) string {
	if v == 0 {
		return "0"
	}
	negative := v < 0
	if negative {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
