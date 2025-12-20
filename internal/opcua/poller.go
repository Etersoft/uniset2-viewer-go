package opcua

import (
	"sync"
	"time"

	"github.com/pv/uniset-panel/internal/poller"
	"github.com/pv/uniset-panel/internal/recording"
	"github.com/pv/uniset-panel/internal/uniset"
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
	*poller.BasePoller[OPCUASensor, SensorUpdate]

	// Дополнительные поля для OPCUA
	objectTypes map[string]string
	typesMu     sync.RWMutex
}

// opcuaFetcher реализует poller.ItemFetcher для OPC UA датчиков
type opcuaFetcher struct {
	client      *uniset.Client
	objectTypes map[string]string
	typesMu     *sync.RWMutex
}

func (f *opcuaFetcher) FetchItems(objectName string, ids []int64) ([]OPCUASensor, error) {
	query := poller.BuildIDQuery(ids)

	// Определяем тип объекта для выбора правильного API метода
	f.typesMu.RLock()
	objectType := f.objectTypes[objectName]
	f.typesMu.RUnlock()

	var resp *uniset.OPCUASensorsResponse
	var err error

	// OPCUAServer использует параметр id=, OPCUAExchange использует filter=
	if objectType == "OPCUAServer" {
		resp, err = f.client.GetOPCUAServerSensorValues(objectName, query)
	} else {
		resp, err = f.client.GetOPCUASensorValues(objectName, query)
	}
	if err != nil {
		return nil, err
	}

	sensors := make([]OPCUASensor, 0, len(resp.Sensors))
	for _, sensorMap := range resp.Sensors {
		sensor := OPCUASensor{}

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

func (f *opcuaFetcher) GetItemID(sensor OPCUASensor) int64 {
	return sensor.ID
}

func (f *opcuaFetcher) GetValueHash(sensor OPCUASensor) string {
	// Создаём хеш из value + tick для определения изменений
	return formatValueHash(sensor.Value, sensor.Tick)
}

// NewPoller создает новый OPC UA poller
// batchSize - макс. количество датчиков в одном цикле опроса (0 = без ограничения)
func NewPoller(client *uniset.Client, interval time.Duration, batchSize int, callback BatchUpdateCallback) *Poller {
	objectTypes := make(map[string]string)
	typesMu := &sync.RWMutex{}

	fetcher := &opcuaFetcher{
		client:      client,
		objectTypes: objectTypes,
		typesMu:     typesMu,
	}

	makeUpdate := func(objectName string, sensor OPCUASensor, ts time.Time) SensorUpdate {
		return SensorUpdate{
			ObjectName: objectName,
			Sensor:     sensor,
			Timestamp:  ts,
		}
	}

	// Адаптер для callback
	var baseCallback poller.BatchUpdateCallback[SensorUpdate]
	if callback != nil {
		baseCallback = func(updates []SensorUpdate) {
			callback(updates)
		}
	}

	base := poller.NewBasePoller(
		interval,
		batchSize,
		fetcher,
		makeUpdate,
		baseCallback,
		"OPCUA",
	)

	// Устанавливаем функцию конвертации для recording
	base.SetToDataRecord(func(serverID string, update SensorUpdate) recording.DataRecord {
		return recording.DataRecord{
			ServerID:     serverID,
			ObjectName:   update.ObjectName,
			VariableName: "ext:" + update.Sensor.Name,
			Value:        update.Sensor.Value,
			Timestamp:    update.Timestamp,
		}
	})

	return &Poller{
		BasePoller:  base,
		objectTypes: objectTypes,
		typesMu:     *typesMu,
	}
}

// Subscribe подписывает на датчики объекта (использует OPCUAExchange по умолчанию)
func (p *Poller) Subscribe(objectName string, sensorIDs []int64) {
	p.SubscribeWithType(objectName, sensorIDs, "")
}

// SubscribeWithType подписывает на датчики объекта с указанием типа
// extensionType: "OPCUAExchange" или "OPCUAServer" (пустая строка = OPCUAExchange по умолчанию)
func (p *Poller) SubscribeWithType(objectName string, sensorIDs []int64, extensionType string) {
	// Сначала вызываем базовую подписку
	p.BasePoller.Subscribe(objectName, sensorIDs)

	// Сохраняем тип объекта (если указан)
	if extensionType != "" {
		p.typesMu.Lock()
		p.objectTypes[objectName] = extensionType
		p.typesMu.Unlock()
	}
}

// Unsubscribe отписывает от датчиков объекта
func (p *Poller) Unsubscribe(objectName string, sensorIDs []int64) {
	p.BasePoller.Unsubscribe(objectName, sensorIDs)

	// Проверяем, остались ли подписки для объекта
	if len(p.BasePoller.GetSubscriptions(objectName)) == 0 {
		p.typesMu.Lock()
		delete(p.objectTypes, objectName)
		p.typesMu.Unlock()
	}
}

// UnsubscribeAll отписывает объект от всех датчиков
func (p *Poller) UnsubscribeAll(objectName string) {
	p.BasePoller.UnsubscribeAll(objectName)

	p.typesMu.Lock()
	delete(p.objectTypes, objectName)
	p.typesMu.Unlock()
}

// Helper functions for value hashing

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
