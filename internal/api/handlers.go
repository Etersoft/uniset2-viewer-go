package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/config"
	"github.com/pv/uniset2-viewer-go/internal/ionc"
	"github.com/pv/uniset2-viewer-go/internal/logserver"
	"github.com/pv/uniset2-viewer-go/internal/poller"
	"github.com/pv/uniset2-viewer-go/internal/sensorconfig"
	"github.com/pv/uniset2-viewer-go/internal/server"
	"github.com/pv/uniset2-viewer-go/internal/sm"
	"github.com/pv/uniset2-viewer-go/internal/storage"
	"github.com/pv/uniset2-viewer-go/internal/uniset"
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
	serverManager   *server.Manager // менеджер нескольких серверов
	controlsEnabled bool            // true if confile was specified (IONC controls visible)
	uiConfig        *config.UIConfig
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

// SetSSEHub устанавливает SSE hub
func (h *Handlers) SetSSEHub(hub *SSEHub) {
	h.sseHub = hub
}

// GetSSEHub возвращает SSE hub для использования в poller
func (h *Handlers) GetSSEHub() *SSEHub {
	return h.sseHub
}

// getUniSetClient возвращает UniSet2 client с учётом serverID (multi-server)
func (h *Handlers) getUniSetClient(serverID string) (*uniset.Client, int, string) {
	if h.serverManager != nil {
		if serverID != "" {
			if instance, ok := h.serverManager.GetServer(serverID); ok {
				return instance.Client, 0, ""
			}
			return nil, http.StatusNotFound, "server not found"
		}

		if instance, ok := h.serverManager.GetFirstServer(); ok {
			return instance.Client, 0, ""
		}
		return nil, http.StatusServiceUnavailable, "no servers available"
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

	if h.serverManager != nil && serverID != "" {
		// Используем конкретный сервер
		data, err = h.serverManager.GetObjectData(serverID, name)
	} else if h.serverManager != nil {
		// Если сервер не указан, пробуем первый доступный
		instance, exists := h.serverManager.GetFirstServer()
		if !exists {
			h.writeError(w, http.StatusServiceUnavailable, "no servers available")
			return
		}
		data, err = instance.GetObjectData(name)
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

	if h.serverManager != nil && serverID != "" {
		data, err = h.serverManager.GetObjectData(serverID, name)
	} else if h.serverManager != nil {
		instance, exists := h.serverManager.GetFirstServer()
		if !exists {
			h.writeError(w, http.StatusServiceUnavailable, "no servers available")
			return
		}
		data, err = instance.GetObjectData(name)
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

	// Создаем стрим логов
	ctx := r.Context()
	stream, err := h.logServerMgr.NewLogStream(ctx, name, host, port, filter)
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

	// Стримим логи
	for {
		select {
		case <-ctx.Done():
			return
		case line, ok := <-stream.Lines:
			if !ok {
				// Канал закрыт - LogServer отключился
				fmt.Fprintf(w, "event: disconnected\ndata: {}\n\n")
				flusher.Flush()
				return
			}
			// Отправляем строку лога
			fmt.Fprintf(w, "event: log\ndata: %s\n\n", line)
			flusher.Flush()
		}
	}
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
// GET /api/objects/{name}/ionc/sensors?offset=0&limit=100&filter=text&server=...
func (h *Handlers) GetIONCSensors(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	offset := 0
	limit := 100
	filter := r.URL.Query().Get("filter")

	if offsetStr := r.URL.Query().Get("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
		return
	}

	result, err := client.GetIONCSensors(name, offset, limit, filter)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetIONCSensorValues получает значения конкретных датчиков
// GET /api/objects/{name}/ionc/get?sensors=id1,name2,id3&server=...
func (h *Handlers) GetIONCSensorValues(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	sensors := r.URL.Query().Get("sensors")
	if sensors == "" {
		h.writeError(w, http.StatusBadRequest, "sensors parameter required")
		return
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
		return
	}

	result, err := client.GetIONCSensorValues(name, sensors)
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
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	var req IONCSetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
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
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	var req IONCFreezeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
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
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	var req IONCUnfreezeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
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
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	sensors := r.URL.Query().Get("sensors")
	if sensors == "" {
		h.writeError(w, http.StatusBadRequest, "sensors parameter required")
		return
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
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
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
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
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	if h.ioncPoller == nil {
		h.writeError(w, http.StatusServiceUnavailable, "IONC poller not available")
		return
	}

	var req IONCSubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(req.SensorIDs) == 0 {
		h.writeError(w, http.StatusBadRequest, "sensor_ids required")
		return
	}

	h.ioncPoller.Subscribe(name, req.SensorIDs)

	h.writeJSON(w, map[string]interface{}{
		"status":     "subscribed",
		"object":     name,
		"sensor_ids": req.SensorIDs,
	})
}

// UnsubscribeIONCSensors отписывает от SSE обновлений для датчиков объекта
// POST /api/objects/{name}/ionc/unsubscribe
func (h *Handlers) UnsubscribeIONCSensors(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	if h.ioncPoller == nil {
		h.writeError(w, http.StatusServiceUnavailable, "IONC poller not available")
		return
	}

	var req IONCSubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(req.SensorIDs) == 0 {
		// Если не указаны конкретные датчики — отписываем все
		h.ioncPoller.UnsubscribeAll(name)
	} else {
		h.ioncPoller.Unsubscribe(name, req.SensorIDs)
	}

	h.writeJSON(w, map[string]interface{}{
		"status": "unsubscribed",
		"object": name,
	})
}

// GetIONCSubscriptions возвращает список подписок на IONC датчики объекта
// GET /api/objects/{name}/ionc/subscriptions
func (h *Handlers) GetIONCSubscriptions(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	if h.ioncPoller == nil {
		h.writeJSON(w, map[string]interface{}{
			"sensor_ids": []int64{},
			"enabled":    false,
		})
		return
	}

	sensorIDs := h.ioncPoller.GetSubscriptions(name)
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
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	if h.ioncPoller == nil {
		h.writeError(w, http.StatusServiceUnavailable, "IONC poller not available")
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

	h.ioncPoller.Subscribe(name, sensorIDs)

	h.writeJSON(w, map[string]interface{}{
		"status":     "subscribed",
		"object":     name,
		"sensor_ids": sensorIDs,
	})
}

// === OPCUAExchange API ===

// GetOPCUAStatus возвращает статус OPCUAExchange
// GET /api/objects/{name}/opcua/status
func (h *Handlers) GetOPCUAStatus(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
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
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	params := r.URL.Query()["name"]
	if len(params) == 0 {
		h.writeError(w, http.StatusBadRequest, "at least one name parameter required")
		return
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
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
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
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

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
		return
	}

	result, err := client.SetOPCUAParams(name, params)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetOPCUASensors возвращает список сенсоров OPCUAExchange
// GET /api/objects/{name}/opcua/sensors
func (h *Handlers) GetOPCUASensors(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	limit := 0
	offset := 0
	filter := r.URL.Query().Get("filter")

	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l >= 0 {
			limit = l
		}
	}

	if offsetStr := r.URL.Query().Get("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
		return
	}

	result, err := client.GetOPCUASensors(name, filter, limit, offset)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, result)
}

// GetOPCUASensor возвращает детали сенсора
// GET /api/objects/{name}/opcua/sensors/{id}
func (h *Handlers) GetOPCUASensor(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
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

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
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
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
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
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
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
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
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
