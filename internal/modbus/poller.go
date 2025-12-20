package modbus

import (
	"log/slog"
	"strconv"
	"time"

	"github.com/pv/uniset-panel/internal/poller"
	"github.com/pv/uniset-panel/internal/recording"
	"github.com/pv/uniset-panel/internal/uniset"
)

// RegisterUpdate обновление значения регистра Modbus
type RegisterUpdate struct {
	ObjectName string            `json:"object"`
	Register   uniset.MBRegister `json:"register"`
	Timestamp  time.Time         `json:"timestamp"`
}

// BatchUpdateCallback функция обратного вызова для батчевых обновлений
type BatchUpdateCallback func(updates []RegisterUpdate)

// Poller опрашивает Modbus регистры для подписанных клиентов
type Poller struct {
	*poller.BasePoller[uniset.MBRegister, RegisterUpdate]
}

// modbusFetcher реализует poller.ItemFetcher для Modbus регистров
type modbusFetcher struct {
	client *uniset.Client
}

func (f *modbusFetcher) FetchItems(objectName string, ids []int64) ([]uniset.MBRegister, error) {
	query := poller.BuildIDQuery(ids)

	slog.Debug("Modbus polling registers", "object", objectName, "ids_count", len(ids), "query_length", len(query))

	resp, err := f.client.GetMBRegisterValues(objectName, query)
	if err != nil {
		slog.Error("Modbus GetMBRegisterValues failed", "object", objectName, "error", err)
		return nil, err
	}

	// GetMBRegisterValues uses /get endpoint which returns "sensors" field, not "registers"
	sensorsData := resp.Sensors
	if len(sensorsData) == 0 {
		sensorsData = resp.Registers // fallback to registers if sensors is empty
	}

	slog.Debug("Modbus GetMBRegisterValues response", "object", objectName, "registers_received", len(sensorsData))

	// Конвертируем map[string]interface{} в MBRegister
	registers := make([]uniset.MBRegister, 0, len(sensorsData))
	for _, regMap := range sensorsData {
		reg := uniset.MBRegister{}

		if id, ok := regMap["id"].(float64); ok {
			reg.ID = int64(id)
		}
		if name, ok := regMap["name"].(string); ok {
			reg.Name = name
		}
		if iotype, ok := regMap["iotype"].(string); ok {
			reg.IOType = iotype
		}
		if value, ok := regMap["value"].(float64); ok {
			reg.Value = int64(value)
		}
		if vtype, ok := regMap["vtype"].(string); ok {
			reg.VType = vtype
		}
		if device, ok := regMap["device"].(map[string]interface{}); ok {
			reg.Device = device
		}
		if register, ok := regMap["register"].(map[string]interface{}); ok {
			reg.Register = register
		}
		if nbit, ok := regMap["nbit"].(float64); ok {
			reg.NBit = int(nbit)
		}
		if mask, ok := regMap["mask"].(float64); ok {
			reg.Mask = int(mask)
		}
		if precision, ok := regMap["precision"].(float64); ok {
			reg.Precision = int(precision)
		}

		registers = append(registers, reg)
	}

	return registers, nil
}

func (f *modbusFetcher) GetItemID(reg uniset.MBRegister) int64 {
	return reg.ID
}

func (f *modbusFetcher) GetValueHash(reg uniset.MBRegister) string {
	return strconv.FormatInt(reg.Value, 10)
}

// NewPoller создает новый Modbus poller
// batchSize - макс. количество регистров в одном запросе (0 = без ограничения)
func NewPoller(client *uniset.Client, interval time.Duration, batchSize int, callback BatchUpdateCallback) *Poller {
	fetcher := &modbusFetcher{client: client}

	makeUpdate := func(objectName string, reg uniset.MBRegister, ts time.Time) RegisterUpdate {
		return RegisterUpdate{
			ObjectName: objectName,
			Register:   reg,
			Timestamp:  ts,
		}
	}

	// Адаптер для callback (конвертируем тип)
	var baseCallback poller.BatchUpdateCallback[RegisterUpdate]
	if callback != nil {
		baseCallback = func(updates []RegisterUpdate) {
			callback(updates)
		}
	}

	base := poller.NewBasePoller(
		interval,
		batchSize,
		fetcher,
		makeUpdate,
		baseCallback,
		"Modbus",
	)

	p := &Poller{BasePoller: base}

	// Устанавливаем функцию конвертации для recording
	base.SetToDataRecord(func(serverID string, update RegisterUpdate) recording.DataRecord {
		return recording.DataRecord{
			ServerID:     serverID,
			ObjectName:   update.ObjectName,
			VariableName: "mb:" + update.Register.Name,
			Value:        update.Register.Value,
			Timestamp:    update.Timestamp,
		}
	})

	return p
}
