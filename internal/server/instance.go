package server

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/config"
	"github.com/pv/uniset2-viewer-go/internal/ionc"
	"github.com/pv/uniset2-viewer-go/internal/modbus"
	"github.com/pv/uniset2-viewer-go/internal/opcua"
	"github.com/pv/uniset2-viewer-go/internal/poller"
	"github.com/pv/uniset2-viewer-go/internal/storage"
	"github.com/pv/uniset2-viewer-go/internal/uniset"
)

// ObjectEventCallback вызывается при получении данных объекта
type ObjectEventCallback func(serverID, serverName, objectName string, data *uniset.ObjectData)

// IONCEventCallback вызывается при обновлении IONC датчиков
type IONCEventCallback func(serverID, serverName string, updates []ionc.SensorUpdate)

// ModbusEventCallback вызывается при обновлении Modbus регистров
type ModbusEventCallback func(serverID, serverName string, updates []modbus.RegisterUpdate)

// OPCUAEventCallback вызывается при обновлении OPCUA датчиков
type OPCUAEventCallback func(serverID, serverName string, updates []opcua.SensorUpdate)

// StatusEventCallback вызывается при изменении статуса подключения
type StatusEventCallback func(serverID, serverName string, connected bool, lastError string)

// ObjectsChangedCallback вызывается при изменении списка объектов (восстановление связи)
type ObjectsChangedCallback func(serverID, serverName string, objects []string)

// Instance представляет подключение к одному UniSet2 серверу
type Instance struct {
	Config       config.ServerConfig
	Client       *uniset.Client
	Poller       *poller.Poller
	IONCPoller   *ionc.Poller
	ModbusPoller *modbus.Poller
	OPCUAPoller  *opcua.Poller

	mu               sync.RWMutex
	connected        bool
	lastPoll         time.Time
	lastError        string
	objectCount      int
	statusCallback   StatusEventCallback
	objectsCallback  ObjectsChangedCallback
	healthInterval   time.Duration

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewInstance создаёт новый экземпляр сервера
func NewInstance(
	cfg config.ServerConfig,
	store storage.Storage,
	pollInterval time.Duration,
	historyTTL time.Duration,
	supplier string,
	sensorBatchSize int,
	objectCallback ObjectEventCallback,
	ioncCallback IONCEventCallback,
	modbusCallback ModbusEventCallback,
	opcuaCallback OPCUAEventCallback,
	statusCallback StatusEventCallback,
	objectsCallback ObjectsChangedCallback,
) *Instance {
	client := uniset.NewClientWithSupplier(cfg.URL, supplier)

	// Создаём poller
	p := poller.New(client, store, pollInterval, historyTTL)
	p.SetServerID(cfg.ID)

	// Устанавливаем callback с информацией о сервере
	serverID := cfg.ID
	serverName := cfg.Name
	if serverName == "" {
		serverName = cfg.URL
	}

	p.SetEventCallback(func(objectName string, data *uniset.ObjectData) {
		if objectCallback != nil {
			objectCallback(serverID, serverName, objectName, data)
		}
	})

	// Создаём IONC poller
	ioncPoller := ionc.NewPoller(client, pollInterval, sensorBatchSize, func(updates []ionc.SensorUpdate) {
		if ioncCallback != nil {
			ioncCallback(serverID, serverName, updates)
		}
	})

	// Создаём Modbus poller
	modbusPoller := modbus.NewPoller(client, pollInterval, sensorBatchSize, func(updates []modbus.RegisterUpdate) {
		if modbusCallback != nil {
			modbusCallback(serverID, serverName, updates)
		}
	})

	// Создаём OPCUA poller
	opcuaPoller := opcua.NewPoller(client, pollInterval, sensorBatchSize, func(updates []opcua.SensorUpdate) {
		if opcuaCallback != nil {
			opcuaCallback(serverID, serverName, updates)
		}
	})

	ctx, cancel := context.WithCancel(context.Background())

	return &Instance{
		Config:          cfg,
		Client:          client,
		Poller:          p,
		IONCPoller:      ioncPoller,
		ModbusPoller:    modbusPoller,
		OPCUAPoller:     opcuaPoller,
		statusCallback:  statusCallback,
		objectsCallback: objectsCallback,
		healthInterval:  pollInterval, // используем poll interval для health check
		ctx:             ctx,
		cancel:          cancel,
	}
}

// Start запускает все pollers и health check
func (i *Instance) Start() {
	i.wg.Add(1)
	go func() {
		defer i.wg.Done()
		i.Poller.Run(i.ctx)
	}()

	i.IONCPoller.Start()
	i.ModbusPoller.Start()
	i.OPCUAPoller.Start()

	// Запускаем health check goroutine
	i.wg.Add(1)
	go func() {
		defer i.wg.Done()
		i.runHealthCheck()
	}()

	slog.Info("Server instance started", "id", i.Config.ID, "url", i.Config.URL)
}

// runHealthCheck периодически проверяет доступность сервера
func (i *Instance) runHealthCheck() {
	serverName := i.Config.Name
	if serverName == "" {
		serverName = i.Config.URL
	}

	for {
		i.mu.RLock()
		interval := i.healthInterval
		i.mu.RUnlock()

		select {
		case <-i.ctx.Done():
			return
		case <-time.After(interval):
			i.checkHealth(serverName)
		}
	}
}

// checkHealth проверяет доступность сервера и обновляет статус
func (i *Instance) checkHealth(serverName string) {
	objects, err := i.Client.GetObjectList()

	i.mu.RLock()
	wasConnected := i.connected
	i.mu.RUnlock()

	if err != nil {
		// Сервер недоступен
		i.UpdateStatus(false, err)
	} else {
		// Сервер доступен
		i.UpdateStatus(true, nil)
		i.SetObjectCount(len(objects))

		// Если связь восстановилась - уведомляем об обновлении списка объектов
		if !wasConnected && i.objectsCallback != nil {
			slog.Info("Server reconnected, updating objects list",
				"id", i.Config.ID,
				"objects", len(objects),
			)
			i.objectsCallback(i.Config.ID, serverName, objects)
		}
	}
}

// Stop останавливает все pollers
func (i *Instance) Stop() {
	i.cancel()
	i.IONCPoller.Stop()
	i.ModbusPoller.Stop()
	i.OPCUAPoller.Stop()
	i.wg.Wait()

	slog.Info("Server instance stopped", "id", i.Config.ID)
}

// GetStatus возвращает текущий статус сервера
func (i *Instance) GetStatus() Status {
	i.mu.RLock()
	defer i.mu.RUnlock()

	name := i.Config.Name
	if name == "" {
		name = i.Config.URL
	}

	return Status{
		ID:          i.Config.ID,
		URL:         i.Config.URL,
		Name:        name,
		Connected:   i.connected,
		LastPoll:    i.lastPoll,
		LastError:   i.lastError,
		ObjectCount: i.objectCount,
	}
}

// SetHealthInterval изменяет интервал health check
func (i *Instance) SetHealthInterval(interval time.Duration) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.healthInterval = interval
	// Примечание: ticker будет обновлён при следующей итерации runHealthCheck
}

// UpdateStatus обновляет статус подключения
func (i *Instance) UpdateStatus(connected bool, err error) {
	i.mu.Lock()

	// Проверяем, изменился ли статус
	statusChanged := i.connected != connected
	prevConnected := i.connected

	i.connected = connected
	i.lastPoll = time.Now()
	errStr := ""
	if err != nil {
		errStr = err.Error()
		i.lastError = errStr
	} else {
		i.lastError = ""
	}

	callback := i.statusCallback
	serverID := i.Config.ID
	serverName := i.Config.Name
	if serverName == "" {
		serverName = i.Config.URL
	}

	i.mu.Unlock()

	// Вызываем callback вне лока, только если статус изменился
	if statusChanged && callback != nil {
		slog.Info("Server status changed",
			"id", serverID,
			"connected", connected,
			"was", prevConnected,
		)
		callback(serverID, serverName, connected, errStr)
	}
}

// SetObjectCount устанавливает количество объектов
func (i *Instance) SetObjectCount(count int) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.objectCount = count
}

// GetObjects возвращает список объектов сервера
func (i *Instance) GetObjects() ([]string, error) {
	objects, err := i.Client.GetObjectList()
	if err != nil {
		i.UpdateStatus(false, err)
		return nil, err
	}

	i.UpdateStatus(true, nil)
	i.SetObjectCount(len(objects))
	return objects, nil
}

// GetObjectData возвращает данные объекта
func (i *Instance) GetObjectData(objectName string) (*uniset.ObjectData, error) {
	data, err := i.Client.GetObjectData(objectName)
	if err != nil {
		i.UpdateStatus(false, err)
		return nil, err
	}

	i.UpdateStatus(true, nil)
	return data, nil
}

// Watch добавляет объект в наблюдение
func (i *Instance) Watch(objectName string) {
	i.Poller.Watch(objectName)
}

// Unwatch удаляет объект из наблюдения
func (i *Instance) Unwatch(objectName string) {
	i.Poller.Unwatch(objectName)
}

// GetLastData возвращает последние данные объекта
func (i *Instance) GetLastData(objectName string) *uniset.ObjectData {
	return i.Poller.GetLastData(objectName)
}
