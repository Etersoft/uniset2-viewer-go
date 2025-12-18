package modbus

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/uniset"
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
	client    *uniset.Client
	interval  time.Duration
	callback  BatchUpdateCallback
	batchSize int // макс. регистров в одном запросе

	mu sync.RWMutex
	// subscriptions: objectName -> set of registerIDs
	subscriptions map[string]map[int64]struct{}
	// lastValues: objectName -> registerID -> value (для отправки только изменений)
	lastValues map[string]map[int64]int64

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewPoller создает новый Modbus poller
// batchSize - макс. количество регистров в одном запросе (0 = без ограничения)
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
	slog.Info("Modbus Poller started", "interval", p.interval)
}

// Stop останавливает polling
func (p *Poller) Stop() {
	p.cancel()
	p.wg.Wait()
	slog.Info("Modbus Poller stopped")
}

// Subscribe подписывает на регистры объекта
func (p *Poller) Subscribe(objectName string, registerIDs []int64) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.subscriptions[objectName] == nil {
		p.subscriptions[objectName] = make(map[int64]struct{})
	}
	if p.lastValues[objectName] == nil {
		p.lastValues[objectName] = make(map[int64]int64)
	}

	for _, id := range registerIDs {
		p.subscriptions[objectName][id] = struct{}{}
	}

	// Считаем subscriptions напрямую, не вызывая SubscriptionCount() чтобы избежать deadlock
	totalCount := 0
	for _, regs := range p.subscriptions {
		totalCount += len(regs)
	}

	slog.Info("Modbus registers subscribed", "object", objectName, "count", len(registerIDs), "total_subscriptions", totalCount)
}

// Unsubscribe отписывает от регистров объекта
func (p *Poller) Unsubscribe(objectName string, registerIDs []int64) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if registers, ok := p.subscriptions[objectName]; ok {
		for _, id := range registerIDs {
			delete(registers, id)
			delete(p.lastValues[objectName], id)
		}
		if len(registers) == 0 {
			delete(p.subscriptions, objectName)
			delete(p.lastValues, objectName)
		}
	}

	slog.Debug("Modbus registers unsubscribed", "object", objectName, "count", len(registerIDs))
}

// UnsubscribeAll отписывает объект от всех регистров
func (p *Poller) UnsubscribeAll(objectName string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	delete(p.subscriptions, objectName)
	delete(p.lastValues, objectName)
	slog.Debug("Modbus all registers unsubscribed", "object", objectName)
}

// GetSubscriptions возвращает список подписок для объекта
func (p *Poller) GetSubscriptions(objectName string) []int64 {
	p.mu.RLock()
	defer p.mu.RUnlock()

	registers, ok := p.subscriptions[objectName]
	if !ok {
		return nil
	}

	result := make([]int64, 0, len(registers))
	for id := range registers {
		result = append(result, id)
	}
	return result
}

// GetAllSubscriptions возвращает все подписки
func (p *Poller) GetAllSubscriptions() map[string][]int64 {
	p.mu.RLock()
	defer p.mu.RUnlock()

	result := make(map[string][]int64)
	for obj, registers := range p.subscriptions {
		ids := make([]int64, 0, len(registers))
		for id := range registers {
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
	for _, registers := range p.subscriptions {
		count += len(registers)
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
	for obj, registers := range p.subscriptions {
		ids := make([]int64, 0, len(registers))
		for id := range registers {
			ids = append(ids, id)
		}
		subsSnapshot[obj] = ids
	}
	p.mu.RUnlock()

	if len(subsSnapshot) == 0 {
		return
	}

	// Собираем все изменения в batch
	var batch []RegisterUpdate
	now := time.Now()

	// Опрашиваем каждый объект
	for objectName, registerIDs := range subsSnapshot {
		if len(registerIDs) == 0 {
			continue
		}

		registers, err := p.pollObject(objectName, registerIDs)
		if err != nil {
			slog.Error("Modbus poll failed", "object", objectName, "error", err)
			continue
		}

		// Добавляем изменившиеся значения в batch
		for _, reg := range registers {
			if p.hasValueChanged(objectName, reg.ID, reg.Value) {
				batch = append(batch, RegisterUpdate{
					ObjectName: objectName,
					Register:   reg,
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

func (p *Poller) pollObject(objectName string, registerIDs []int64) ([]uniset.MBRegister, error) {
	// Если батчинг включен и регистров больше чем batchSize, разбиваем на батчи
	if p.batchSize > 0 && len(registerIDs) > p.batchSize {
		return p.pollObjectBatched(objectName, registerIDs)
	}

	return p.pollObjectSingle(objectName, registerIDs)
}

func (p *Poller) pollObjectSingle(objectName string, registerIDs []int64) ([]uniset.MBRegister, error) {
	// Формируем строку запроса: id1,id2,id3
	query := ""
	for i, id := range registerIDs {
		if i > 0 {
			query += ","
		}
		query += fmt.Sprintf("%d", id)
	}

	resp, err := p.client.GetMBRegisterValues(objectName, query)
	if err != nil {
		return nil, err
	}

	// Конвертируем map[string]interface{} в MBRegister
	registers := make([]uniset.MBRegister, 0, len(resp.Registers))
	for _, regMap := range resp.Registers {
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

func (p *Poller) pollObjectBatched(objectName string, registerIDs []int64) ([]uniset.MBRegister, error) {
	var allRegisters []uniset.MBRegister
	var lastErr error

	// Разбиваем на батчи
	for i := 0; i < len(registerIDs); i += p.batchSize {
		end := i + p.batchSize
		if end > len(registerIDs) {
			end = len(registerIDs)
		}
		batch := registerIDs[i:end]

		registers, err := p.pollObjectSingle(objectName, batch)
		if err != nil {
			lastErr = err
			slog.Debug("Modbus batch poll failed", "object", objectName, "batch", i/p.batchSize, "error", err)
			continue
		}

		allRegisters = append(allRegisters, registers...)
	}

	// Возвращаем ошибку только если не получили ни одного регистра
	if len(allRegisters) == 0 && lastErr != nil {
		return nil, lastErr
	}

	return allRegisters, nil
}

func (p *Poller) hasValueChanged(objectName string, registerID int64, newValue int64) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.lastValues[objectName] == nil {
		p.lastValues[objectName] = make(map[int64]int64)
	}

	lastValue, exists := p.lastValues[objectName][registerID]
	if !exists || lastValue != newValue {
		p.lastValues[objectName][registerID] = newValue
		return true
	}
	return false
}
