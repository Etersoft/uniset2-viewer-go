package ionc

import (
	"fmt"
	"time"

	"github.com/pv/uniset-panel/internal/poller"
	"github.com/pv/uniset-panel/internal/recording"
	"github.com/pv/uniset-panel/internal/uniset"
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
	*poller.BasePoller[uniset.IONCSensor, SensorUpdate]
}

// ioncFetcher реализует poller.ItemFetcher для IONC датчиков
type ioncFetcher struct {
	client *uniset.Client
}

func (f *ioncFetcher) FetchItems(objectName string, ids []int64) ([]uniset.IONCSensor, error) {
	query := poller.BuildIDQuery(ids)

	resp, err := f.client.GetIONCSensorValues(objectName, query)
	if err != nil {
		return nil, err
	}

	return resp.Sensors, nil
}

func (f *ioncFetcher) GetItemID(sensor uniset.IONCSensor) int64 {
	return sensor.ID
}

func (f *ioncFetcher) GetValueHash(sensor uniset.IONCSensor) string {
	// Хеш включает Value и RealValue - чтобы обновлять и при изменении real_value (для замороженных датчиков)
	return fmt.Sprintf("%d|%d", sensor.Value, sensor.RealValue)
}

// NewPoller создает новый IONC poller
// batchSize - макс. количество датчиков в одном запросе (0 = без ограничения)
func NewPoller(client *uniset.Client, interval time.Duration, batchSize int, callback BatchUpdateCallback) *Poller {
	fetcher := &ioncFetcher{client: client}

	makeUpdate := func(objectName string, sensor uniset.IONCSensor, ts time.Time) SensorUpdate {
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
		"IONC",
	)

	p := &Poller{BasePoller: base}

	// Устанавливаем функцию конвертации для recording
	base.SetToDataRecord(func(serverID string, update SensorUpdate) recording.DataRecord {
		return recording.DataRecord{
			ServerID:     serverID,
			ObjectName:   update.ObjectName,
			VariableName: "ionc:" + update.Sensor.Name,
			Value:        update.Sensor.Value,
			Timestamp:    update.Timestamp,
		}
	})

	return p
}
