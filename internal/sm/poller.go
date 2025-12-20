package sm

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/pv/uniset-panel/internal/storage"
)

// SensorSubscription подписка на датчик для объекта
type SensorSubscription struct {
	ObjectName string
	SensorName string
}

// SensorUpdate обновление значения датчика
type SensorUpdate struct {
	ObjectName string       `json:"object"`
	Sensor     SensorValue  `json:"sensor"`
	Timestamp  time.Time    `json:"timestamp"`
}

// UpdateCallback функция обратного вызова для обновлений
type UpdateCallback func(update SensorUpdate)

// Poller опрашивает SM для подписанных датчиков
type Poller struct {
	client       *Client
	storage      storage.Storage
	interval     time.Duration
	callback     UpdateCallback

	mu           sync.RWMutex
	// subscriptions: objectName -> set of sensorNames
	subscriptions map[string]map[string]struct{}

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewPoller создает новый SM poller
func NewPoller(client *Client, store storage.Storage, interval time.Duration, callback UpdateCallback) *Poller {
	ctx, cancel := context.WithCancel(context.Background())

	return &Poller{
		client:        client,
		storage:       store,
		interval:      interval,
		callback:      callback,
		subscriptions: make(map[string]map[string]struct{}),
		ctx:           ctx,
		cancel:        cancel,
	}
}

// Start запускает polling
func (p *Poller) Start() {
	p.wg.Add(1)
	go p.pollLoop()
	slog.Info("SM Poller started", "interval", p.interval)
}

// Stop останавливает polling
func (p *Poller) Stop() {
	p.cancel()
	p.wg.Wait()
	slog.Info("SM Poller stopped")
}

// Subscribe подписывает объект на датчик
func (p *Poller) Subscribe(objectName, sensorName string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.subscriptions[objectName] == nil {
		p.subscriptions[objectName] = make(map[string]struct{})
	}
	p.subscriptions[objectName][sensorName] = struct{}{}

	slog.Debug("SM sensor subscribed", "object", objectName, "sensor", sensorName)
}

// Unsubscribe отписывает объект от датчика
func (p *Poller) Unsubscribe(objectName, sensorName string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if sensors, ok := p.subscriptions[objectName]; ok {
		delete(sensors, sensorName)
		if len(sensors) == 0 {
			delete(p.subscriptions, objectName)
		}
	}

	slog.Debug("SM sensor unsubscribed", "object", objectName, "sensor", sensorName)
}

// UnsubscribeAll отписывает объект от всех датчиков
func (p *Poller) UnsubscribeAll(objectName string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	delete(p.subscriptions, objectName)
	slog.Debug("SM all sensors unsubscribed", "object", objectName)
}

// GetSubscriptions возвращает список подписок для объекта
func (p *Poller) GetSubscriptions(objectName string) []string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	sensors, ok := p.subscriptions[objectName]
	if !ok {
		return nil
	}

	result := make([]string, 0, len(sensors))
	for name := range sensors {
		result = append(result, name)
	}
	return result
}

// GetAllSubscriptions возвращает все подписки
func (p *Poller) GetAllSubscriptions() map[string][]string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	result := make(map[string][]string)
	for obj, sensors := range p.subscriptions {
		names := make([]string, 0, len(sensors))
		for name := range sensors {
			names = append(names, name)
		}
		result[obj] = names
	}
	return result
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
	// Собираем все уникальные датчики для опроса
	p.mu.RLock()
	allSensors := make(map[string][]string) // sensor -> objects that subscribe to it
	for obj, sensors := range p.subscriptions {
		for sensor := range sensors {
			allSensors[sensor] = append(allSensors[sensor], obj)
		}
	}
	p.mu.RUnlock()

	if len(allSensors) == 0 {
		return
	}

	// Формируем список датчиков для запроса
	sensorNames := make([]string, 0, len(allSensors))
	for name := range allSensors {
		sensorNames = append(sensorNames, name)
	}

	// Запрашиваем значения из SM
	values, err := p.client.GetValues(sensorNames)
	if err != nil {
		slog.Error("SM poll failed", "error", err)
		return
	}

	now := time.Now().UTC()

	// Отправляем обновления для каждого подписчика
	for sensorName, objects := range allSensors {
		value, ok := values[sensorName]
		if !ok {
			continue
		}

		for _, objectName := range objects {
			update := SensorUpdate{
				ObjectName: objectName,
				Sensor:     value,
				Timestamp:  now,
			}

			// Сохраняем в storage (для истории графиков)
			// SM глобальный, используем пустой serverID (будет DefaultServerID)
			if p.storage != nil {
				varName := "ext:" + sensorName
				p.storage.Save("", objectName, varName, float64(value.Value), now)
			}

			// Вызываем callback для SSE
			if p.callback != nil {
				p.callback(update)
			}
		}
	}
}
