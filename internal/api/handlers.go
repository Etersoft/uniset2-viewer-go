package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/pv/uniset-panel/internal/config"
	"github.com/pv/uniset-panel/internal/ionc"
	"github.com/pv/uniset-panel/internal/logserver"
	"github.com/pv/uniset-panel/internal/modbus"
	"github.com/pv/uniset-panel/internal/opcua"
	"github.com/pv/uniset-panel/internal/poller"
	"github.com/pv/uniset-panel/internal/recording"
	"github.com/pv/uniset-panel/internal/sensorconfig"
	"github.com/pv/uniset-panel/internal/server"
	"github.com/pv/uniset-panel/internal/sm"
	"github.com/pv/uniset-panel/internal/storage"
	"github.com/pv/uniset-panel/internal/uniset"
)

type Handlers struct {
	client          *uniset.Client
	storage         storage.Storage
	poller          *poller.Poller
	sensorConfig    *sensorconfig.SensorConfig
	sseHub          *SSEHub
	pollInterval    time.Duration
	logServerMgr    *logserver.Manager
	smPoller        *sm.Poller
	ioncPoller      *ionc.Poller
	modbusPoller    *modbus.Poller
	opcuaPoller     *opcua.Poller
	serverManager   *server.Manager  // менеджер нескольких серверов
	controlsEnabled bool             // true if uniset-config was specified (IONC controls visible)
	uiConfig        *config.UIConfig
	logStreamConfig *config.LogStreamConfig
	controlMgr      *ControlManager    // менеджер сессий контроля
	recordingMgr    *recording.Manager // менеджер записи истории
	version         string             // версия приложения
}

func NewHandlers(client *uniset.Client, store storage.Storage, p *poller.Poller, sensorCfg *sensorconfig.SensorConfig, pollInterval time.Duration) *Handlers {
	return &Handlers{
		client:       client,
		storage:      store,
		poller:       p,
		sensorConfig: sensorCfg,
		sseHub:       NewSSEHub(),
		pollInterval: pollInterval,
	}
}

// SetLogServerManager устанавливает менеджер LogServer
func (h *Handlers) SetLogServerManager(mgr *logserver.Manager) {
	h.logServerMgr = mgr
}

// SetSMPoller устанавливает SM poller
func (h *Handlers) SetSMPoller(p *sm.Poller) {
	h.smPoller = p
}

// SetIONCPoller устанавливает IONC poller
func (h *Handlers) SetIONCPoller(p *ionc.Poller) {
	h.ioncPoller = p
}

// SetModbusPoller устанавливает Modbus poller
func (h *Handlers) SetModbusPoller(p *modbus.Poller) {
	h.modbusPoller = p
}

// SetOPCUAPoller устанавливает OPCUA poller
func (h *Handlers) SetOPCUAPoller(p *opcua.Poller) {
	h.opcuaPoller = p
}

// SetServerManager устанавливает менеджер серверов
func (h *Handlers) SetServerManager(mgr *server.Manager) {
	h.serverManager = mgr
}

// SetControlsEnabled устанавливает доступность элементов управления IONC
func (h *Handlers) SetControlsEnabled(enabled bool) {
	h.controlsEnabled = enabled
}

// SetUIConfig устанавливает конфигурацию UI
func (h *Handlers) SetUIConfig(cfg *config.UIConfig) {
	h.uiConfig = cfg
}

// SetLogStreamConfig устанавливает конфигурацию стриминга логов
func (h *Handlers) SetLogStreamConfig(cfg *config.LogStreamConfig) {
	h.logStreamConfig = cfg
}

// SetControlManager устанавливает менеджер контроля сессий
func (h *Handlers) SetControlManager(mgr *ControlManager) {
	h.controlMgr = mgr
}

// GetControlManager возвращает менеджер контроля сессий
func (h *Handlers) GetControlManager() *ControlManager {
	return h.controlMgr
}

// SetRecordingManager устанавливает менеджер записи
func (h *Handlers) SetRecordingManager(mgr *recording.Manager) {
	h.recordingMgr = mgr
}

// GetRecordingManager возвращает менеджер записи
func (h *Handlers) GetRecordingManager() *recording.Manager {
	return h.recordingMgr
}

// SetSSEHub устанавливает SSE hub
func (h *Handlers) SetSSEHub(hub *SSEHub) {
	h.sseHub = hub
}

// GetSSEHub возвращает SSE hub для использования в poller
func (h *Handlers) GetSSEHub() *SSEHub {
	return h.sseHub
}

// SetVersion устанавливает версию приложения
func (h *Handlers) SetVersion(version string) {
	h.version = version
}

// GetVersion возвращает версию приложения (API handler)
func (h *Handlers) GetVersion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"version": h.version})
}

// getUniSetClient возвращает UniSet2 client с учётом serverID (multi-server)
// В multi-server режиме параметр serverID обязателен
func (h *Handlers) getUniSetClient(serverID string) (*uniset.Client, int, string) {
	if h.serverManager != nil {
		if serverID == "" {
			return nil, http.StatusBadRequest, "server parameter is required"
		}
		if instance, ok := h.serverManager.GetServer(serverID); ok {
			return instance.Client, 0, ""
		}
		return nil, http.StatusNotFound, "server not found"
	}

	if h.client != nil {
		return h.client, 0, ""
	}

	return nil, http.StatusServiceUnavailable, "no client configured"
}

func (h *Handlers) writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func (h *Handlers) writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// GetConfig возвращает конфигурацию приложения для UI
// GET /api/config
func (h *Handlers) GetConfig(w http.ResponseWriter, r *http.Request) {
	// Получаем значения с учётом defaults
	var ioncUISensorsFilter, opcuaUISensorsFilter bool
	if h.uiConfig != nil {
		ioncUISensorsFilter = h.uiConfig.GetIONCUISensorsFilter()
		opcuaUISensorsFilter = h.uiConfig.GetOPCUAUISensorsFilter()
	}

	h.writeJSON(w, map[string]interface{}{
		"controlsEnabled":      h.controlsEnabled,
		"ioncUISensorsFilter":  ioncUISensorsFilter,
		"opcuaUISensorsFilter": opcuaUISensorsFilter,
	})
}

// GetObjects возвращает список доступных объектов
// GET /api/objects
func (h *Handlers) GetObjects(w http.ResponseWriter, r *http.Request) {
	list, err := h.client.GetObjectList()
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	// Возвращаем в формате {objects: [...]} для совместимости с UI
	h.writeJSON(w, map[string]interface{}{
		"objects": list,
	})
}

// GetObjectData возвращает текущие данные объекта
// GET /api/objects/{name}?server=serverID
func (h *Handlers) GetObjectData(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	serverID := r.URL.Query().Get("server")

	var data *uniset.ObjectData
	var err error

	if h.serverManager != nil {
		if serverID == "" {
			h.writeError(w, http.StatusBadRequest, "server parameter is required")
			return
		}
		data, err = h.serverManager.GetObjectData(serverID, name)
	} else if h.client != nil {
		// Fallback на старый клиент (для совместимости)
		data, err = h.client.GetObjectData(name)
	} else {
		h.writeError(w, http.StatusServiceUnavailable, "no client configured")
		return
	}

	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	// Гибридный подход: передаём типизированные поля + raw_data для UI
	response := map[string]interface{}{
		// Типизированные поля (нужны серверу, могут использоваться UI напрямую)
		"object":    data.Object,
		"LogServer": data.LogServer,
		"Variables": data.Variables,
		"io":        data.IO,
	}

	// Raw данные для UI — всё что пришло от объекта
	if data.RawData != nil {
		rawDataParsed := make(map[string]interface{})
		for k, v := range data.RawData {
			var parsed interface{}
			if err := json.Unmarshal(v, &parsed); err == nil {
				rawDataParsed[k] = parsed
			}
		}
		response["raw_data"] = rawDataParsed
	}

	h.writeJSON(w, response)
}

// WatchObject добавляет объект в список наблюдения
// POST /api/objects/{name}/watch?server=serverID
func (h *Handlers) WatchObject(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	serverID := r.URL.Query().Get("server")

	if h.serverManager != nil && serverID != "" {
		if err := h.serverManager.Watch(serverID, name); err != nil {
			h.writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	} else if h.poller != nil {
		h.poller.Watch(name)
	}

	h.writeJSON(w, map[string]string{"status": "watching", "object": name})
}

// UnwatchObject удаляет объект из списка наблюдения
// DELETE /api/objects/{name}/watch?server=serverID
func (h *Handlers) UnwatchObject(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	serverID := r.URL.Query().Get("server")

	if h.serverManager != nil && serverID != "" {
		if err := h.serverManager.Unwatch(serverID, name); err != nil {
			h.writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	} else if h.poller != nil {
		h.poller.Unwatch(name)
	}

	h.writeJSON(w, map[string]string{"status": "unwatched", "object": name})
}

// GetVariableHistory возвращает историю переменной
// GET /api/objects/{name}/variables/{variable}/history?count=100
func (h *Handlers) GetVariableHistory(w http.ResponseWriter, r *http.Request) {
	objectName := r.PathValue("name")
	variableName := r.PathValue("variable")

	if objectName == "" || variableName == "" {
		h.writeError(w, http.StatusBadRequest, "object name and variable name required")
		return
	}

	count := 100
	if countStr := r.URL.Query().Get("count"); countStr != "" {
		if c, err := strconv.Atoi(countStr); err == nil && c > 0 {
			count = c
		}
	}

	// serverID из query параметра, пустая строка = DefaultServerID
	serverID := r.URL.Query().Get("server")

	history, err := h.storage.GetLatest(serverID, objectName, variableName, count)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, history)
}

// GetVariableHistoryRange возвращает историю переменной за период
// GET /api/objects/{name}/variables/{variable}/history/range?from=...&to=...
func (h *Handlers) GetVariableHistoryRange(w http.ResponseWriter, r *http.Request) {
	objectName := r.PathValue("name")
	variableName := r.PathValue("variable")

	if objectName == "" || variableName == "" {
		h.writeError(w, http.StatusBadRequest, "object name and variable name required")
		return
	}

	from := time.Now().Add(-time.Hour)
	to := time.Now()

	if fromStr := r.URL.Query().Get("from"); fromStr != "" {
		if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
			from = t
		}
	}

	if toStr := r.URL.Query().Get("to"); toStr != "" {
		if t, err := time.Parse(time.RFC3339, toStr); err == nil {
			to = t
		}
	}

	// serverID из query параметра, пустая строка = DefaultServerID
	serverID := r.URL.Query().Get("server")

	history, err := h.storage.GetHistory(serverID, objectName, variableName, from, to)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, history)
}

// GetSensors возвращает список всех датчиков из конфигурации
// GET /api/sensors
func (h *Handlers) GetSensors(w http.ResponseWriter, r *http.Request) {
	if h.sensorConfig == nil {
		h.writeJSON(w, map[string]interface{}{
			"sensors": []interface{}{},
			"count":   0,
		})
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"sensors": h.sensorConfig.GetAllInfo(),
		"count":   h.sensorConfig.Count(),
	})
}

// GetSensorByName возвращает информацию о датчике по имени
// GET /api/sensors/by-name/{name}
func (h *Handlers) GetSensorByName(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "sensor name required")
		return
	}

	if h.sensorConfig == nil {
		h.writeError(w, http.StatusNotFound, "sensor configuration not loaded")
		return
	}

	sensor := h.sensorConfig.GetByName(name)
	if sensor == nil {
		h.writeError(w, http.StatusNotFound, "sensor not found")
		return
	}

	h.writeJSON(w, sensor.ToInfo())
}

// GetSMSensors возвращает список датчиков из SharedMemory
// GET /api/sm/sensors
func (h *Handlers) GetSMSensors(w http.ResponseWriter, r *http.Request) {
	result, err := h.client.GetSMSensors()
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	// Преобразуем в формат, совместимый с UI
	sensors := make([]map[string]interface{}, 0, len(result.Sensors))
	for _, s := range result.Sensors {
		sensors = append(sensors, map[string]interface{}{
			"id":       s.ID,
			"name":     s.Name,
			"textname": "", // SM не возвращает textname
			"iotype":   s.Type,
		})
	}

	h.writeJSON(w, map[string]interface{}{
		"sensors": sensors,
		"count":   result.Count,
		"source":  "sm",
	})
}

// GetLogServerStatus возвращает статус подключения к LogServer объекта
// GET /api/logs/{name}/status
func (h *Handlers) GetLogServerStatus(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	if h.logServerMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "LogServer manager not available")
		return
	}

	client := h.logServerMgr.GetClient(name)
	if client == nil {
		h.writeJSON(w, &logserver.ConnectionStatus{
			Connected: false,
			Host:      "",
			Port:      0,
		})
		return
	}

	h.writeJSON(w, client.GetStatus())
}

// HandleLogServerStream стримит логи объекта через SSE
// GET /api/logs/{name}/stream?filter=...&server=serverID
func (h *Handlers) HandleLogServerStream(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	if h.logServerMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "LogServer manager not available")
		return
	}

	// Получаем данные объекта для получения host:port LogServer
	serverID := r.URL.Query().Get("server")

	var data *uniset.ObjectData
	var err error

	if h.serverManager != nil {
		if serverID == "" {
			h.writeError(w, http.StatusBadRequest, "server parameter is required")
			return
		}
		data, err = h.serverManager.GetObjectData(serverID, name)
	} else if h.client != nil {
		data, err = h.client.GetObjectData(name)
	} else {
		h.writeError(w, http.StatusServiceUnavailable, "no client configured")
		return
	}

	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	if data.LogServer == nil {
		h.writeError(w, http.StatusNotFound, "object has no LogServer")
		return
	}

	host := data.LogServer.Host
	port := data.LogServer.Port
	if host == "" {
		host = "localhost"
	}
	if port == 0 {
		port = 3333
	}

	filter := r.URL.Query().Get("filter")

	// Настраиваем SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		h.writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Получаем настройки батчинга из конфига
	bufferSize := h.logStreamConfig.GetBufferSize()
	batchSize := h.logStreamConfig.GetBatchSize()
	batchInterval := h.logStreamConfig.GetBatchInterval()

	// Создаем стрим логов
	ctx := r.Context()
	stream, err := h.logServerMgr.NewLogStream(ctx, name, host, port, filter, bufferSize)
	if err != nil {
		// Отправляем ошибку как SSE событие
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", err.Error())
		flusher.Flush()
		return
	}
	defer stream.Close()

	// Отправляем событие подключения
	fmt.Fprintf(w, "event: connected\ndata: {\"host\":\"%s\",\"port\":%d}\n\n", host, port)
	flusher.Flush()

	// Батчевый стриминг логов
	ticker := time.NewTicker(batchInterval)
	defer ticker.Stop()

	batch := make([]string, 0, batchSize)

	for {
		select {
		case <-ctx.Done():
			// Отправляем оставшиеся строки перед закрытием
			if len(batch) > 0 {
				h.sendLogBatch(w, flusher, batch)
			}
			return

		case line, ok := <-stream.Lines:
			if !ok {
				// Канал закрыт - отправляем оставшиеся строки
				if len(batch) > 0 {
					h.sendLogBatch(w, flusher, batch)
				}
				// LogServer отключился
				fmt.Fprintf(w, "event: disconnected\ndata: {}\n\n")
				flusher.Flush()
				return
			}
			batch = append(batch, line)

			// Отправляем если достигли размера батча
			if len(batch) >= batchSize {
				h.sendLogBatch(w, flusher, batch)
				batch = batch[:0]
			}

		case <-ticker.C:
			// Отправляем по таймеру если есть что отправить
			if len(batch) > 0 {
				h.sendLogBatch(w, flusher, batch)
				batch = batch[:0]
			}
		}
	}
}

// sendLogBatch отправляет батч логов как SSE событие
func (h *Handlers) sendLogBatch(w http.ResponseWriter, flusher http.Flusher, lines []string) {
	data, err := json.Marshal(lines)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "event: logs\ndata: %s\n\n", data)
	flusher.Flush()
}

// LogServerCommand структура команды для LogServer
type LogServerCommand struct {
	Command string `json:"command"` // setLevel, addLevel, delLevel, setFilter
	Level   uint32 `json:"level,omitempty"`
	Filter  string `json:"filter,omitempty"`
}

// SendLogServerCommand отправляет команду на LogServer объекта
// POST /api/logs/{name}/command
func (h *Handlers) SendLogServerCommand(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	if h.logServerMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "LogServer manager not available")
		return
	}

	var cmd LogServerCommand
	if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid command")
		return
	}

	client := h.logServerMgr.GetClient(name)
	if client == nil {
		// Нет активного клиента - нужно сначала подключиться через stream
		h.writeError(w, http.StatusNotFound, "no active connection to LogServer")
		return
	}

	var err error
	switch cmd.Command {
	case "setLevel":
		err = client.SetLogLevel(logserver.LogLevel(cmd.Level), cmd.Filter)
	case "addLevel":
		err = client.AddLogLevel(logserver.LogLevel(cmd.Level), cmd.Filter)
	case "delLevel":
		err = client.DelLogLevel(logserver.LogLevel(cmd.Level), cmd.Filter)
	case "setFilter":
		err = client.SetFilter(cmd.Filter)
	case "list":
		err = client.RequestList(cmd.Filter)
	default:
		h.writeError(w, http.StatusBadRequest, "unknown command: "+cmd.Command)
		return
	}

	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, map[string]string{"status": "ok"})
}

// GetAllLogServerStatuses возвращает статусы всех LogServer подключений
// GET /api/logs/status
func (h *Handlers) GetAllLogServerStatuses(w http.ResponseWriter, r *http.Request) {
	if h.logServerMgr == nil {
		h.writeJSON(w, map[string]interface{}{})
		return
	}

	h.writeJSON(w, h.logServerMgr.GetAllStatuses())
}

// === External Sensors API ===

// ExternalSensorsRequest запрос на подписку/отписку датчиков
type ExternalSensorsRequest struct {
	Sensors []string `json:"sensors"`
}

// SubscribeExternalSensors подписывает объект на внешние датчики из SM
// POST /api/objects/{name}/external-sensors
func (h *Handlers) SubscribeExternalSensors(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	if h.smPoller == nil {
		h.writeError(w, http.StatusServiceUnavailable, "SM integration not configured (use --sm-url)")
		return
	}

	var req ExternalSensorsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	for _, sensor := range req.Sensors {
		h.smPoller.Subscribe(name, sensor)
	}

	h.writeJSON(w, map[string]interface{}{
		"status":  "subscribed",
		"object":  name,
		"sensors": req.Sensors,
	})
}

// UnsubscribeExternalSensor отписывает объект от внешнего датчика
// DELETE /api/objects/{name}/external-sensors/{sensor}
func (h *Handlers) UnsubscribeExternalSensor(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	sensor := r.PathValue("sensor")

	if name == "" || sensor == "" {
		h.writeError(w, http.StatusBadRequest, "object name and sensor name required")
		return
	}

	if h.smPoller == nil {
		h.writeError(w, http.StatusServiceUnavailable, "SM integration not configured")
		return
	}

	h.smPoller.Unsubscribe(name, sensor)

	h.writeJSON(w, map[string]interface{}{
		"status": "unsubscribed",
		"object": name,
		"sensor": sensor,
	})
}

// GetExternalSensors возвращает список подписанных внешних датчиков для объекта
// GET /api/objects/{name}/external-sensors
func (h *Handlers) GetExternalSensors(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	if h.smPoller == nil {
		h.writeJSON(w, map[string]interface{}{
			"sensors": []string{},
			"enabled": false,
		})
		return
	}

	sensors := h.smPoller.GetSubscriptions(name)
	if sensors == nil {
		sensors = []string{}
	}

	h.writeJSON(w, map[string]interface{}{
		"sensors": sensors,
		"enabled": true,
	})
}

// === IONotifyController API ===

// GetIONCSensors возвращает список датчиков из IONotifyController объекта
// GET /api/objects/{name}/ionc/sensors?offset=0&limit=100&search=text&iotype=AI&server=...
func (h *Handlers) GetIONCSensors(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	offset, limit := getPagination(r, 100)
	search := r.URL.Query().Get("search")
	iotype := r.URL.Query().Get("iotype")

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetIONCSensors(name, offset, limit, search, iotype)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetIONCSensorValues получает значения конкретных датчиков
// GET /api/objects/{name}/ionc/get?filter=id1,name2,id3&server=...
func (h *Handlers) GetIONCSensorValues(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	filter := r.URL.Query().Get("filter")
	if filter == "" {
		h.writeError(w, http.StatusBadRequest, "filter parameter required")
		return
	}

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetIONCSensorValues(name, filter)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// IONCSetRequest запрос на установку значения датчика
type IONCSetRequest struct {
	SensorID int64 `json:"sensor_id"`
	Value    int64 `json:"value"`
}

// SetIONCSensorValue устанавливает значение датчика
// POST /api/objects/{name}/ionc/set?server=...
func (h *Handlers) SetIONCSensorValue(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	var req IONCSetRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	if err := client.SetIONCSensorValue(name, req.SensorID, req.Value); err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"status":    "ok",
		"sensor_id": req.SensorID,
		"value":     req.Value,
	})
}

// IONCFreezeRequest запрос на заморозку датчика
type IONCFreezeRequest struct {
	SensorID int64 `json:"sensor_id"`
	Value    int64 `json:"value"`
}

// FreezeIONCSensor замораживает датчик
// POST /api/objects/{name}/ionc/freeze?server=...
func (h *Handlers) FreezeIONCSensor(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	var req IONCFreezeRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	if err := client.FreezeIONCSensor(name, req.SensorID, req.Value); err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"status":    "frozen",
		"sensor_id": req.SensorID,
		"value":     req.Value,
	})
}

// IONCUnfreezeRequest запрос на разморозку датчика
type IONCUnfreezeRequest struct {
	SensorID int64 `json:"sensor_id"`
}

// UnfreezeIONCSensor размораживает датчик
// POST /api/objects/{name}/ionc/unfreeze?server=...
func (h *Handlers) UnfreezeIONCSensor(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	var req IONCUnfreezeRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	if err := client.UnfreezeIONCSensor(name, req.SensorID); err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"status":    "unfrozen",
		"sensor_id": req.SensorID,
	})
}

// GetIONCConsumers возвращает список подписчиков на датчики
// GET /api/objects/{name}/ionc/consumers?sensors=id1,id2&server=...
func (h *Handlers) GetIONCConsumers(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	sensors := r.URL.Query().Get("sensors")
	if sensors == "" {
		h.writeError(w, http.StatusBadRequest, "sensors parameter required")
		return
	}

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetIONCConsumers(name, sensors)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetIONCLostConsumers возвращает список потерянных подписчиков
// GET /api/objects/{name}/ionc/lost?server=...
func (h *Handlers) GetIONCLostConsumers(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}
	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetIONCLostConsumers(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// === IONC SSE Subscriptions ===

// IONCSubscribeRequest запрос на подписку датчиков для SSE обновлений
type IONCSubscribeRequest struct {
	SensorIDs []int64 `json:"sensor_ids"`
}

// SubscribeIONCSensors подписывает на SSE обновления для датчиков объекта
// POST /api/objects/{name}/ionc/subscribe
func (h *Handlers) SubscribeIONCSensors(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	var req IONCSubscribeRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	if len(req.SensorIDs) == 0 {
		h.writeError(w, http.StatusBadRequest, "sensor_ids required")
		return
	}

	ioncPoller, ok := h.requireIONCPoller(w, r)
	if !ok {
		return
	}

	ioncPoller.Subscribe(name, req.SensorIDs)

	h.writeJSON(w, map[string]interface{}{
		"status":     "subscribed",
		"object":     name,
		"sensor_ids": req.SensorIDs,
	})
}

// UnsubscribeIONCSensors отписывает от SSE обновлений для датчиков объекта
// POST /api/objects/{name}/ionc/unsubscribe
func (h *Handlers) UnsubscribeIONCSensors(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	ioncPoller, ok := h.requireIONCPoller(w, r)
	if !ok {
		return
	}

	var req IONCSubscribeRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	if len(req.SensorIDs) == 0 {
		// Если не указаны конкретные датчики — отписываем все
		ioncPoller.UnsubscribeAll(name)
	} else {
		ioncPoller.Unsubscribe(name, req.SensorIDs)
	}

	h.writeJSON(w, map[string]interface{}{
		"status": "unsubscribed",
		"object": name,
	})
}

// GetIONCSubscriptions возвращает список подписок на IONC датчики объекта
// GET /api/objects/{name}/ionc/subscriptions
func (h *Handlers) GetIONCSubscriptions(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	ioncPoller := h.getIONCPoller(r)
	if ioncPoller == nil {
		h.writeJSON(w, map[string]interface{}{
			"sensor_ids": []int64{},
			"enabled":    false,
		})
		return
	}

	sensorIDs := ioncPoller.GetSubscriptions(name)
	if sensorIDs == nil {
		sensorIDs = []int64{}
	}

	h.writeJSON(w, map[string]interface{}{
		"sensor_ids": sensorIDs,
		"enabled":    true,
	})
}

// SubscribeIONCSensorsQuery подписывает на SSE обновления из query string
// GET /api/objects/{name}/ionc/subscribe?sensors=id1,id2,id3
func (h *Handlers) SubscribeIONCSensorsQuery(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	ioncPoller, ok := h.requireIONCPoller(w, r)
	if !ok {
		return
	}

	sensorsStr := r.URL.Query().Get("sensors")
	if sensorsStr == "" {
		h.writeError(w, http.StatusBadRequest, "sensors parameter required")
		return
	}

	// Парсим список sensor IDs
	var sensorIDs []int64
	for _, idStr := range strings.Split(sensorsStr, ",") {
		idStr = strings.TrimSpace(idStr)
		if id, err := strconv.ParseInt(idStr, 10, 64); err == nil {
			sensorIDs = append(sensorIDs, id)
		}
	}

	if len(sensorIDs) == 0 {
		h.writeError(w, http.StatusBadRequest, "no valid sensor IDs provided")
		return
	}

	ioncPoller.Subscribe(name, sensorIDs)

	h.writeJSON(w, map[string]interface{}{
		"status":     "subscribed",
		"object":     name,
		"sensor_ids": sensorIDs,
	})
}

// === Modbus SSE Subscriptions ===

// ModbusSubscribeRequest структура запроса на подписку Modbus регистров
type ModbusSubscribeRequest struct {
	RegisterIDs []int64 `json:"register_ids"`
}

// SubscribeModbusRegisters подписывает на SSE обновления для регистров объекта
// POST /api/objects/{name}/modbus/subscribe
func (h *Handlers) SubscribeModbusRegisters(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	var req ModbusSubscribeRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	if len(req.RegisterIDs) == 0 {
		h.writeError(w, http.StatusBadRequest, "register_ids required")
		return
	}

	mbPoller, ok := h.requireModbusPoller(w, r)
	if !ok {
		return
	}

	mbPoller.Subscribe(name, req.RegisterIDs)

	h.writeJSON(w, map[string]interface{}{
		"status":       "subscribed",
		"object":       name,
		"register_ids": req.RegisterIDs,
	})
}

// UnsubscribeModbusRegisters отписывает от SSE обновлений для регистров объекта
// POST /api/objects/{name}/modbus/unsubscribe
func (h *Handlers) UnsubscribeModbusRegisters(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	mbPoller, ok := h.requireModbusPoller(w, r)
	if !ok {
		return
	}

	var req ModbusSubscribeRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	if len(req.RegisterIDs) == 0 {
		// Если не указаны конкретные регистры — отписываем все
		mbPoller.UnsubscribeAll(name)
	} else {
		mbPoller.Unsubscribe(name, req.RegisterIDs)
	}

	h.writeJSON(w, map[string]interface{}{
		"status": "unsubscribed",
		"object": name,
	})
}

// GetModbusSubscriptions возвращает список подписок на Modbus регистры объекта
// GET /api/objects/{name}/modbus/subscriptions
func (h *Handlers) GetModbusSubscriptions(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	mbPoller := h.getModbusPoller(r)
	if mbPoller == nil {
		h.writeJSON(w, map[string]interface{}{
			"register_ids": []int64{},
			"enabled":      false,
		})
		return
	}

	registerIDs := mbPoller.GetSubscriptions(name)
	if registerIDs == nil {
		registerIDs = []int64{}
	}

	h.writeJSON(w, map[string]interface{}{
		"register_ids": registerIDs,
		"enabled":      true,
	})
}

// === OPCUA SSE Subscriptions ===

// OPCUASubscribeRequest структура запроса на подписку OPCUA датчиков
type OPCUASubscribeRequest struct {
	SensorIDs     []int64 `json:"sensor_ids"`
	ExtensionType string  `json:"extension_type,omitempty"` // "OPCUAExchange" или "OPCUAServer"
}

// SubscribeOPCUASensors подписывает на SSE обновления для датчиков объекта
// POST /api/objects/{name}/opcua/subscribe
func (h *Handlers) SubscribeOPCUASensors(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	var req OPCUASubscribeRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	if len(req.SensorIDs) == 0 {
		h.writeError(w, http.StatusBadRequest, "sensor_ids required")
		return
	}

	opPoller, ok := h.requireOPCUAPoller(w, r)
	if !ok {
		return
	}

	opPoller.SubscribeWithType(name, req.SensorIDs, req.ExtensionType)

	h.writeJSON(w, map[string]interface{}{
		"status":         "subscribed",
		"object":         name,
		"sensor_ids":     req.SensorIDs,
		"extension_type": req.ExtensionType,
	})
}

// UnsubscribeOPCUASensors отписывает от SSE обновлений для датчиков объекта
// POST /api/objects/{name}/opcua/unsubscribe
func (h *Handlers) UnsubscribeOPCUASensors(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	opPoller, ok := h.requireOPCUAPoller(w, r)
	if !ok {
		return
	}

	var req OPCUASubscribeRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	if len(req.SensorIDs) == 0 {
		// Если не указаны конкретные датчики — отписываем все
		opPoller.UnsubscribeAll(name)
	} else {
		opPoller.Unsubscribe(name, req.SensorIDs)
	}

	h.writeJSON(w, map[string]interface{}{
		"status": "unsubscribed",
		"object": name,
	})
}

// GetOPCUASubscriptions возвращает список подписок на OPCUA датчики объекта
// GET /api/objects/{name}/opcua/subscriptions
func (h *Handlers) GetOPCUASubscriptions(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	opPoller := h.getOPCUAPoller(r)
	if opPoller == nil {
		h.writeJSON(w, map[string]interface{}{
			"sensor_ids": []int64{},
			"enabled":    false,
		})
		return
	}

	sensorIDs := opPoller.GetSubscriptions(name)
	if sensorIDs == nil {
		sensorIDs = []int64{}
	}

	h.writeJSON(w, map[string]interface{}{
		"sensor_ids": sensorIDs,
		"enabled":    true,
	})
}

// === OPCUAExchange API ===

// GetOPCUAStatus возвращает статус OPCUAExchange
// GET /api/objects/{name}/opcua/status
func (h *Handlers) GetOPCUAStatus(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}
	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetOPCUAStatus(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetOPCUAParams читает параметры OPCUAExchange
// GET /api/objects/{name}/opcua/params?name=polltime&name=updatetime
func (h *Handlers) GetOPCUAParams(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	params := r.URL.Query()["name"]
	if len(params) == 0 {
		h.writeError(w, http.StatusBadRequest, "at least one name parameter required")
		return
	}

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetOPCUAParams(name, params)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// SetOPCUAParams устанавливает параметры OPCUAExchange
// POST /api/objects/{name}/opcua/params
func (h *Handlers) SetOPCUAParams(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	var payload map[string]interface{}
	if !h.decodeJSONBody(w, r, &payload) {
		return
	}

	var params map[string]interface{}
	if raw, ok := payload["params"].(map[string]interface{}); ok {
		params = raw
	} else {
		params = payload
	}

	if len(params) == 0 {
		h.writeError(w, http.StatusBadRequest, "no params provided")
		return
	}

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.SetOPCUAParams(name, params)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetOPCUASensors возвращает список сенсоров OPCUAExchange/OPCUAServer
// GET /api/objects/{name}/opcua/sensors?search=text&iotype=AI&limit=N&offset=N
func (h *Handlers) GetOPCUASensors(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	offset, limit := getPagination(r, 0)
	search := r.URL.Query().Get("search")
	iotype := r.URL.Query().Get("iotype")

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetOPCUASensors(name, search, iotype, limit, offset)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetOPCUASensor возвращает детали сенсора
// GET /api/objects/{name}/opcua/sensors/{id}
func (h *Handlers) GetOPCUASensor(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	idStr := r.PathValue("id")
	if idStr == "" {
		h.writeError(w, http.StatusBadRequest, "sensor id required")
		return
	}

	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid sensor id")
		return
	}

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetOPCUASensor(name, id)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetOPCUADiagnostics возвращает диагностику
// GET /api/objects/{name}/opcua/diagnostics
func (h *Handlers) GetOPCUADiagnostics(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}
	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetOPCUADiagnostics(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// TakeOPCUAControl включает HTTP-контроль
// POST /api/objects/{name}/opcua/control/take
func (h *Handlers) TakeOPCUAControl(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}
	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.TakeOPCUAControl(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// ReleaseOPCUAControl отключает HTTP-контроль
// POST /api/objects/{name}/opcua/control/release
func (h *Handlers) ReleaseOPCUAControl(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}
	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.ReleaseOPCUAControl(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// ================== Server Management API ==================

// GetServers возвращает список всех серверов со статусами
// GET /api/servers
func (h *Handlers) GetServers(w http.ResponseWriter, r *http.Request) {
	if h.serverManager == nil {
		h.writeError(w, http.StatusServiceUnavailable, "server manager not initialized")
		return
	}

	servers := h.serverManager.ListServers()
	h.writeJSON(w, map[string]interface{}{
		"servers": servers,
		"count":   len(servers),
	})
}

// AddServer добавляет новый сервер
// POST /api/servers
func (h *Handlers) AddServer(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	if h.serverManager == nil {
		h.writeError(w, http.StatusServiceUnavailable, "server manager not initialized")
		return
	}

	var req struct {
		URL  string `json:"url"`
		ID   string `json:"id,omitempty"`
		Name string `json:"name,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if req.URL == "" {
		h.writeError(w, http.StatusBadRequest, "url is required")
		return
	}

	cfg := config.ServerConfig{
		URL:  req.URL,
		ID:   req.ID,
		Name: req.Name,
	}

	// Генерируем ID если не указан
	if cfg.ID == "" {
		cfg.ID = generateServerID(cfg.URL)
	}

	if err := h.serverManager.AddServer(cfg); err != nil {
		h.writeError(w, http.StatusConflict, err.Error())
		return
	}

	w.WriteHeader(http.StatusCreated)
	h.writeJSON(w, map[string]interface{}{
		"status": "added",
		"server": map[string]string{
			"id":   cfg.ID,
			"url":  cfg.URL,
			"name": cfg.Name,
		},
	})
}

// RemoveServer удаляет сервер по ID
// DELETE /api/servers/{id}
func (h *Handlers) RemoveServer(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	if h.serverManager == nil {
		h.writeError(w, http.StatusServiceUnavailable, "server manager not initialized")
		return
	}

	serverID := r.PathValue("id")
	if serverID == "" {
		h.writeError(w, http.StatusBadRequest, "server id required")
		return
	}

	if err := h.serverManager.RemoveServer(serverID); err != nil {
		h.writeError(w, http.StatusNotFound, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"status": "removed",
		"id":     serverID,
	})
}

// GetServerStatus возвращает статус конкретного сервера
// GET /api/servers/{id}/status
func (h *Handlers) GetServerStatus(w http.ResponseWriter, r *http.Request) {
	if h.serverManager == nil {
		h.writeError(w, http.StatusServiceUnavailable, "server manager not initialized")
		return
	}

	serverID := r.PathValue("id")
	if serverID == "" {
		h.writeError(w, http.StatusBadRequest, "server id required")
		return
	}

	instance, exists := h.serverManager.GetServer(serverID)
	if !exists {
		h.writeError(w, http.StatusNotFound, "server not found")
		return
	}

	h.writeJSON(w, instance.GetStatus())
}

// GetAllObjectsWithServers возвращает объекты со всех серверов, сгруппированные по серверам
// GET /api/all-objects
func (h *Handlers) GetAllObjectsWithServers(w http.ResponseWriter, r *http.Request) {
	if h.serverManager == nil {
		h.writeError(w, http.StatusServiceUnavailable, "server manager not initialized")
		return
	}

	grouped, err := h.serverManager.GetAllObjectsGrouped()
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	// Считаем общее количество объектов
	totalCount := 0
	for _, server := range grouped {
		totalCount += len(server.Objects)
	}

	h.writeJSON(w, map[string]interface{}{
		"objects": grouped,
		"count":   totalCount,
	})
}

// GetPollInterval возвращает текущий интервал опроса
// GET /api/settings/poll-interval
func (h *Handlers) GetPollInterval(w http.ResponseWriter, r *http.Request) {
	if h.serverManager == nil {
		h.writeJSON(w, map[string]interface{}{
			"interval": h.pollInterval.Milliseconds(),
		})
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"interval": h.serverManager.GetPollInterval().Milliseconds(),
	})
}

// SetPollInterval изменяет интервал опроса
// POST /api/settings/poll-interval
func (h *Handlers) SetPollInterval(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	var req struct {
		Interval int64 `json:"interval"` // миллисекунды
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Валидация: минимум 1 секунда, максимум 5 минут
	if req.Interval < 1000 || req.Interval > 300000 {
		h.writeError(w, http.StatusBadRequest, "interval must be between 1000ms and 300000ms")
		return
	}

	interval := time.Duration(req.Interval) * time.Millisecond

	if h.serverManager != nil {
		h.serverManager.SetPollInterval(interval)
	}

	h.pollInterval = interval

	h.writeJSON(w, map[string]interface{}{
		"interval": interval.Milliseconds(),
		"status":   "ok",
	})
}

// generateServerID генерирует ID из URL (копия из config, чтобы не экспортировать)
func generateServerID(url string) string {
	// Простой хэш из URL
	var hash uint32 = 0
	for _, c := range url {
		hash = hash*31 + uint32(c)
	}
	return fmt.Sprintf("%08x", hash)
}

// === ModbusMaster API ===

// GetMBStatus возвращает статус ModbusMaster
// GET /api/objects/{name}/modbus/status
func (h *Handlers) GetMBStatus(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}
	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetMBStatus(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetMBParams читает параметры ModbusMaster
// GET /api/objects/{name}/modbus/params?name=polltime&name=recv_timeout
func (h *Handlers) GetMBParams(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	params := r.URL.Query()["name"]
	if len(params) == 0 {
		h.writeError(w, http.StatusBadRequest, "at least one name parameter required")
		return
	}

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetMBParams(name, params)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// SetMBParams устанавливает параметры ModbusMaster
// POST /api/objects/{name}/modbus/params
func (h *Handlers) SetMBParams(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	var payload map[string]interface{}
	if !h.decodeJSONBody(w, r, &payload) {
		return
	}

	var params map[string]interface{}
	if raw, ok := payload["params"].(map[string]interface{}); ok {
		params = raw
	} else {
		params = payload
	}

	if len(params) == 0 {
		h.writeError(w, http.StatusBadRequest, "no params provided")
		return
	}

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.SetMBParams(name, params)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetMBRegisters возвращает список регистров ModbusMaster
// GET /api/objects/{name}/modbus/registers?offset=0&limit=100&search=text&iotype=AI
func (h *Handlers) GetMBRegisters(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	offset, limit := getPagination(r, 0)
	search := r.URL.Query().Get("search")
	iotype := r.URL.Query().Get("iotype")

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetMBRegisters(name, search, iotype, limit, offset)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetMBDevices возвращает список устройств (slaves) ModbusMaster
// GET /api/objects/{name}/modbus/devices
func (h *Handlers) GetMBDevices(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}
	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetMBDevices(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetMBMode возвращает текущий режим ModbusMaster
// GET /api/objects/{name}/modbus/mode
func (h *Handlers) GetMBMode(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}
	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetMBMode(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetMBModeSupported возвращает список поддерживаемых режимов ModbusMaster
// GET /api/objects/{name}/modbus/mode/supported
func (h *Handlers) GetMBModeSupported(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}
	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.GetMBModeSupported(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// MBModeSetRequest запрос на установку режима
type MBModeSetRequest struct {
	Mode string `json:"mode"`
}

// SetMBMode устанавливает режим ModbusMaster
// POST /api/objects/{name}/modbus/mode
func (h *Handlers) SetMBMode(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	var req MBModeSetRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	if req.Mode == "" {
		h.writeError(w, http.StatusBadRequest, "mode is required")
		return
	}

	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.SetMBMode(name, req.Mode)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// TakeMBControl перехватывает управление ModbusMaster через HTTP
// POST /api/objects/{name}/modbus/control/take
func (h *Handlers) TakeMBControl(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}
	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.TakeMBControl(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// ReleaseMBControl возвращает управление ModbusMaster
// POST /api/objects/{name}/modbus/control/release
func (h *Handlers) ReleaseMBControl(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}
	client, ok := h.requireClient(w, r)
	if !ok {
		return
	}

	result, err := client.ReleaseMBControl(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// =============================================================================
// Session Control API
// =============================================================================

// controlTokenRequest представляет запрос с токеном
type controlTokenRequest struct {
	Token string `json:"token"`
}

// GetControlStatus возвращает текущий статус контроля
// GET /api/control/status
func (h *Handlers) GetControlStatus(w http.ResponseWriter, r *http.Request) {
	if h.controlMgr == nil {
		// Контроль не настроен
		h.writeJSON(w, ControlStatus{
			Enabled:       false,
			HasController: false,
			IsController:  false,
			TimeoutSec:    0,
		})
		return
	}

	token := r.Header.Get("X-Control-Token")
	status := h.controlMgr.GetStatus(token)
	h.writeJSON(w, status)
}

// TakeControl захватывает управление
// POST /api/control/take
func (h *Handlers) TakeControl(w http.ResponseWriter, r *http.Request) {
	if h.controlMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "control not configured")
		return
	}

	var req controlTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Token == "" {
		h.writeError(w, http.StatusBadRequest, "token is required")
		return
	}

	err := h.controlMgr.TakeControl(req.Token)
	if err != nil {
		switch err {
		case ErrInvalidToken:
			h.writeError(w, http.StatusUnauthorized, "invalid token")
		case ErrControlTaken:
			h.writeError(w, http.StatusConflict, "control already taken by another session")
		default:
			h.writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	status := h.controlMgr.GetStatus(req.Token)
	h.writeJSON(w, status)
}

// ReleaseControl освобождает управление
// POST /api/control/release
func (h *Handlers) ReleaseControl(w http.ResponseWriter, r *http.Request) {
	if h.controlMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "control not configured")
		return
	}

	var req controlTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Token == "" {
		h.writeError(w, http.StatusBadRequest, "token is required")
		return
	}

	err := h.controlMgr.ReleaseControl(req.Token)
	if err != nil {
		switch err {
		case ErrNotController:
			h.writeError(w, http.StatusForbidden, "not the controller")
		default:
			h.writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	status := h.controlMgr.GetStatus(req.Token)
	h.writeJSON(w, status)
}

// PingControl обновляет время активности контроллера
// POST /api/control/ping
func (h *Handlers) PingControl(w http.ResponseWriter, r *http.Request) {
	if h.controlMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "control not configured")
		return
	}

	token := r.Header.Get("X-Control-Token")
	if token == "" {
		h.writeError(w, http.StatusBadRequest, "X-Control-Token header is required")
		return
	}

	if !h.controlMgr.IsController(token) {
		h.writeError(w, http.StatusForbidden, "not the controller")
		return
	}

	h.controlMgr.Touch(token)
	h.writeJSON(w, map[string]string{"status": "ok"})
}

// writeControlError отправляет ошибку контроля
func (h *Handlers) writeControlError(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	json.NewEncoder(w).Encode(map[string]string{
		"error": "Control not authorized",
		"code":  "CONTROL_REQUIRED",
	})
}

// checkControlAccess проверяет доступ на запись
// Возвращает true если доступ разрешён
func (h *Handlers) checkControlAccess(w http.ResponseWriter, r *http.Request) bool {
	// Если контроль не настроен, разрешаем всё
	if h.controlMgr == nil || !h.controlMgr.IsEnabled() {
		return true
	}

	token := r.Header.Get("X-Control-Token")
	if h.controlMgr.IsController(token) {
		h.controlMgr.Touch(token)
		return true
	}

	h.writeControlError(w)
	return false
}

// ============================================================================
// Recording API Handlers
// ============================================================================

// POST /api/recording/start
func (h *Handlers) StartRecording(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Recording not configured")
		return
	}

	if err := h.recordingMgr.Start(); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Принудительно сохраняем начальные значения всех подписанных датчиков
	// (чтобы получить первую точку даже если значения не меняются)
	if h.serverManager != nil {
		go h.serverManager.ForceEmitAllPollers()
	}

	h.writeJSON(w, map[string]interface{}{
		"status":      "ok",
		"isRecording": true,
	})
}

// POST /api/recording/stop
func (h *Handlers) StopRecording(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Recording not configured")
		return
	}

	if err := h.recordingMgr.Stop(); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"status":      "ok",
		"isRecording": false,
	})
}

// GET /api/recording/status
func (h *Handlers) GetRecordingStatus(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeJSON(w, map[string]interface{}{
			"configured":  false,
			"isRecording": false,
		})
		return
	}

	stats, err := h.recordingMgr.GetStats()
	if err != nil {
		slog.Error("GetRecordingStatus failed", "error", err)
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"configured":   true,
		"isRecording":  stats.IsRecording,
		"recordCount":  stats.RecordCount,
		"sizeBytes":    stats.SizeBytes,
		"oldestRecord": stats.OldestRecord,
		"newestRecord": stats.NewestRecord,
	})
}

// DELETE /api/recording/clear
func (h *Handlers) ClearRecording(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Recording not configured")
		return
	}

	if err := h.recordingMgr.Clear(); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"status": "ok",
	})
}

// GET /api/export/database
func (h *Handlers) ExportDatabase(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Recording not configured")
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=\"uniset2-recording.db\"")

	if err := h.recordingMgr.ExportRaw(w); err != nil {
		// Headers already sent, can't write error
		return
	}
}

// GET /api/export/csv
func (h *Handlers) ExportCSV(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Recording not configured")
		return
	}

	filter := h.parseExportFilter(r)

	records, err := h.recordingMgr.GetHistory(filter)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"uniset2-recording.csv\"")

	if err := recording.ExportCSV(w, records); err != nil {
		// Headers already sent, can't write error
		return
	}
}

// GET /api/export/json
func (h *Handlers) ExportJSON(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Recording not configured")
		return
	}

	filter := h.parseExportFilter(r)

	records, err := h.recordingMgr.GetHistory(filter)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=\"uniset2-recording.json\"")

	if err := recording.ExportJSON(w, records); err != nil {
		// Headers already sent, can't write error
		return
	}
}

// parseExportFilter parses export filter from query parameters
func (h *Handlers) parseExportFilter(r *http.Request) recording.ExportFilter {
	filter := recording.ExportFilter{}

	if fromStr := r.URL.Query().Get("from"); fromStr != "" {
		if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
			filter.From = &t
		}
	}

	if toStr := r.URL.Query().Get("to"); toStr != "" {
		if t, err := time.Parse(time.RFC3339, toStr); err == nil {
			filter.To = &t
		}
	}

	filter.ServerID = r.URL.Query().Get("server")
	filter.ObjectName = r.URL.Query().Get("object")

	return filter
}
