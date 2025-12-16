package server

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/config"
	"github.com/pv/uniset2-viewer-go/internal/ionc"
	"github.com/pv/uniset2-viewer-go/internal/modbus"
	"github.com/pv/uniset2-viewer-go/internal/opcua"
	"github.com/pv/uniset2-viewer-go/internal/storage"
	"github.com/pv/uniset2-viewer-go/internal/uniset"
)

// ObjectWithServer расширяет имя объекта информацией о сервере
type ObjectWithServer struct {
	ServerID   string `json:"serverId"`
	ServerName string `json:"serverName"`
	ObjectName string `json:"objectName"`
	FullID     string `json:"fullId"` // "serverID:objectName"
}

// ServerObjects группирует объекты по серверам для UI
type ServerObjects struct {
	ServerID   string   `json:"serverId"`
	ServerName string   `json:"serverName"`
	Connected  bool     `json:"connected"`
	Objects    []string `json:"objects"`
}

// Manager управляет несколькими серверами UniSet2
type Manager struct {
	mu        sync.RWMutex
	instances map[string]*Instance // serverID -> Instance

	storage         storage.Storage
	pollInterval    time.Duration
	historyTTL      time.Duration
	supplier        string // supplier name for set/freeze/unfreeze
	sensorBatchSize int    // макс. датчиков/регистров в одном запросе

	// Callbacks для SSE
	objectCallback  ObjectEventCallback
	ioncCallback    IONCEventCallback
	modbusCallback  ModbusEventCallback
	opcuaCallback   OPCUAEventCallback
	statusCallback  StatusEventCallback
	objectsCallback ObjectsChangedCallback
}

// NewManager создаёт новый менеджер серверов
func NewManager(
	store storage.Storage,
	pollInterval time.Duration,
	historyTTL time.Duration,
	supplier string,
	sensorBatchSize int,
) *Manager {
	return &Manager{
		instances:       make(map[string]*Instance),
		storage:         store,
		pollInterval:    pollInterval,
		historyTTL:      historyTTL,
		supplier:        supplier,
		sensorBatchSize: sensorBatchSize,
	}
}

// SetObjectCallback устанавливает callback для событий объектов
func (m *Manager) SetObjectCallback(cb ObjectEventCallback) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objectCallback = cb
}

// SetIONCCallback устанавливает callback для событий IONC
func (m *Manager) SetIONCCallback(cb IONCEventCallback) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ioncCallback = cb
}

// SetModbusCallback устанавливает callback для событий Modbus
func (m *Manager) SetModbusCallback(cb ModbusEventCallback) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.modbusCallback = cb
}

// SetOPCUACallback устанавливает callback для событий OPCUA
func (m *Manager) SetOPCUACallback(cb OPCUAEventCallback) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.opcuaCallback = cb
}

// SetStatusCallback устанавливает callback для изменения статуса серверов
func (m *Manager) SetStatusCallback(cb StatusEventCallback) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.statusCallback = cb
}

// SetObjectsCallback устанавливает callback для обновления списка объектов
func (m *Manager) SetObjectsCallback(cb ObjectsChangedCallback) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objectsCallback = cb
}

// AddServer добавляет новый сервер
func (m *Manager) AddServer(cfg config.ServerConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Проверяем, что сервер с таким ID ещё не существует
	if _, exists := m.instances[cfg.ID]; exists {
		return fmt.Errorf("server with ID %q already exists", cfg.ID)
	}

	// Проверяем URL
	if cfg.URL == "" {
		return fmt.Errorf("server URL is required")
	}

	instance := NewInstance(
		cfg,
		m.storage,
		m.pollInterval,
		m.historyTTL,
		m.supplier,
		m.sensorBatchSize,
		m.objectCallback,
		m.ioncCallback,
		m.modbusCallback,
		m.opcuaCallback,
		m.statusCallback,
		m.objectsCallback,
	)

	m.instances[cfg.ID] = instance
	instance.Start()

	slog.Info("Server added", "id", cfg.ID, "url", cfg.URL, "name", cfg.Name)

	return nil
}

// RemoveServer удаляет сервер по ID
func (m *Manager) RemoveServer(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	instance, exists := m.instances[id]
	if !exists {
		return fmt.Errorf("server with ID %q not found", id)
	}

	instance.Stop()
	delete(m.instances, id)

	slog.Info("Server removed", "id", id)

	return nil
}

// GetServer возвращает экземпляр сервера по ID
func (m *Manager) GetServer(id string) (*Instance, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	instance, exists := m.instances[id]
	return instance, exists
}

// GetServerByURL ищет сервер по URL
func (m *Manager) GetServerByURL(url string) (*Instance, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, instance := range m.instances {
		if instance.Config.URL == url {
			return instance, true
		}
	}
	return nil, false
}

// ListServers возвращает статусы всех серверов
func (m *Manager) ListServers() []Status {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]Status, 0, len(m.instances))
	for _, instance := range m.instances {
		result = append(result, instance.GetStatus())
	}
	return result
}

// GetPollInterval возвращает текущий интервал опроса
func (m *Manager) GetPollInterval() time.Duration {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.pollInterval
}

// SetPollInterval изменяет интервал опроса для всех серверов
func (m *Manager) SetPollInterval(interval time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.pollInterval = interval

	// Обновляем интервал для всех экземпляров
	for _, instance := range m.instances {
		instance.SetHealthInterval(interval)
	}

	slog.Info("Poll interval changed", "interval", interval)
}

// GetAllObjects возвращает объекты со всех серверов (плоский список)
func (m *Manager) GetAllObjects() ([]ObjectWithServer, error) {
	m.mu.RLock()
	instances := make([]*Instance, 0, len(m.instances))
	for _, instance := range m.instances {
		instances = append(instances, instance)
	}
	m.mu.RUnlock()

	var result []ObjectWithServer
	var errors []error

	for _, instance := range instances {
		objects, err := instance.GetObjects()
		if err != nil {
			errors = append(errors, fmt.Errorf("server %s: %w", instance.Config.ID, err))
			continue
		}

		serverName := instance.Config.Name
		if serverName == "" {
			serverName = instance.Config.URL
		}

		for _, objName := range objects {
			result = append(result, ObjectWithServer{
				ServerID:   instance.Config.ID,
				ServerName: serverName,
				ObjectName: objName,
				FullID:     instance.Config.ID + ":" + objName,
			})
		}
	}

	// Возвращаем результат даже если некоторые серверы недоступны
	if len(errors) > 0 && len(result) == 0 {
		return nil, errors[0]
	}

	return result, nil
}

// GetAllObjectsGrouped возвращает объекты сгруппированные по серверам
func (m *Manager) GetAllObjectsGrouped() ([]ServerObjects, error) {
	m.mu.RLock()
	instances := make([]*Instance, 0, len(m.instances))
	for _, instance := range m.instances {
		instances = append(instances, instance)
	}
	m.mu.RUnlock()

	var result []ServerObjects
	var errors []error

	for _, instance := range instances {
		serverName := instance.Config.Name
		if serverName == "" {
			serverName = instance.Config.URL
		}

		status := instance.GetStatus()
		serverObj := ServerObjects{
			ServerID:   instance.Config.ID,
			ServerName: serverName,
			Connected:  status.Connected,
			Objects:    []string{},
		}

		objects, err := instance.GetObjects()
		if err != nil {
			errors = append(errors, fmt.Errorf("server %s: %w", instance.Config.ID, err))
			// Добавляем сервер в результат даже если не удалось получить объекты
			result = append(result, serverObj)
			continue
		}

		serverObj.Objects = objects
		result = append(result, serverObj)
	}

	// Возвращаем результат даже если некоторые серверы недоступны
	if len(errors) > 0 && len(result) == 0 {
		return nil, errors[0]
	}

	return result, nil
}

// GetObjectData возвращает данные объекта с указанного сервера
func (m *Manager) GetObjectData(serverID, objectName string) (*uniset.ObjectData, error) {
	instance, exists := m.GetServer(serverID)
	if !exists {
		return nil, fmt.Errorf("server %q not found", serverID)
	}

	return instance.GetObjectData(objectName)
}

// Watch добавляет объект в наблюдение
func (m *Manager) Watch(serverID, objectName string) error {
	instance, exists := m.GetServer(serverID)
	if !exists {
		return fmt.Errorf("server %q not found", serverID)
	}

	instance.Watch(objectName)
	return nil
}

// Unwatch удаляет объект из наблюдения
func (m *Manager) Unwatch(serverID, objectName string) error {
	instance, exists := m.GetServer(serverID)
	if !exists {
		return fmt.Errorf("server %q not found", serverID)
	}

	instance.Unwatch(objectName)
	return nil
}

// GetLastData возвращает последние данные объекта
func (m *Manager) GetLastData(serverID, objectName string) *uniset.ObjectData {
	instance, exists := m.GetServer(serverID)
	if !exists {
		return nil
	}

	return instance.GetLastData(objectName)
}

// GetIONCPoller возвращает IONC poller для указанного сервера
func (m *Manager) GetIONCPoller(serverID string) (*ionc.Poller, bool) {
	instance, exists := m.GetServer(serverID)
	if !exists {
		return nil, false
	}

	return instance.IONCPoller, true
}

// GetModbusPoller возвращает Modbus poller для указанного сервера
func (m *Manager) GetModbusPoller(serverID string) (*modbus.Poller, bool) {
	instance, exists := m.GetServer(serverID)
	if !exists {
		return nil, false
	}

	return instance.ModbusPoller, true
}

// GetOPCUAPoller возвращает OPCUA poller для указанного сервера
func (m *Manager) GetOPCUAPoller(serverID string) (*opcua.Poller, bool) {
	instance, exists := m.GetServer(serverID)
	if !exists {
		return nil, false
	}

	return instance.OPCUAPoller, true
}

// GetClient возвращает клиент для указанного сервера
func (m *Manager) GetClient(serverID string) (*uniset.Client, bool) {
	instance, exists := m.GetServer(serverID)
	if !exists {
		return nil, false
	}

	return instance.Client, true
}

// ServerCount возвращает количество серверов
func (m *Manager) ServerCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.instances)
}

// Shutdown корректно останавливает все серверы
func (m *Manager) Shutdown(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	slog.Info("Shutting down server manager", "servers", len(m.instances))

	var wg sync.WaitGroup
	for id, instance := range m.instances {
		wg.Add(1)
		go func(id string, inst *Instance) {
			defer wg.Done()
			inst.Stop()
		}(id, instance)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		slog.Info("All server instances stopped")
	case <-ctx.Done():
		slog.Warn("Server shutdown timed out")
		return ctx.Err()
	}

	m.instances = make(map[string]*Instance)
	return nil
}

// GetFirstServer возвращает первый доступный сервер
func (m *Manager) GetFirstServer() (*Instance, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, instance := range m.instances {
		return instance, true
	}
	return nil, false
}
