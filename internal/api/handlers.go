package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/logserver"
	"github.com/pv/uniset2-viewer-go/internal/poller"
	"github.com/pv/uniset2-viewer-go/internal/sensorconfig"
	"github.com/pv/uniset2-viewer-go/internal/sm"
	"github.com/pv/uniset2-viewer-go/internal/storage"
	"github.com/pv/uniset2-viewer-go/internal/uniset"
)

type Handlers struct {
	client         *uniset.Client
	storage        storage.Storage
	poller         *poller.Poller
	sensorConfig   *sensorconfig.SensorConfig
	sseHub         *SSEHub
	pollInterval   time.Duration
	logServerMgr   *logserver.Manager
	smPoller       *sm.Poller
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

// GetSSEHub возвращает SSE hub для использования в poller
func (h *Handlers) GetSSEHub() *SSEHub {
	return h.sseHub
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
// GET /api/objects/{name}
func (h *Handlers) GetObjectData(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	data, err := h.client.GetObjectData(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	// Формируем ответ включая raw_data для fallback рендерера
	response := map[string]interface{}{
		"LogServer":  data.LogServer,
		"Timers":     data.Timers,
		"Variables":  data.Variables,
		"Statistics": data.Statistics,
		"io":         data.IO,
		"object":     data.Object,
	}

	// Добавляем raw_data для fallback рендерера (для объектов без специализированного рендерера)
	if data.RawData != nil {
		rawDataParsed := make(map[string]interface{})
		for k, v := range data.RawData {
			var parsed interface{}
			if err := json.Unmarshal(v, &parsed); err == nil {
				rawDataParsed[k] = parsed
			}
		}
		response["raw_data"] = rawDataParsed

		// Извлекаем дополнительные переменные (не входящие в стандартные поля)
		if objDataRaw, ok := data.RawData[name]; ok {
			var objData map[string]interface{}
			if err := json.Unmarshal(objDataRaw, &objData); err == nil {
				extra := make(map[string]interface{})
				knownFields := map[string]bool{
					"LogServer": true, "Timers": true, "Variables": true,
					"Statistics": true, "io": true, "object": true,
				}
				for k, v := range objData {
					if !knownFields[k] {
						extra[k] = v
					}
				}
				if len(extra) > 0 {
					response["extra"] = extra
				}
			}
		}
	}

	h.writeJSON(w, response)
}

// WatchObject добавляет объект в список наблюдения
// POST /api/objects/{name}/watch
func (h *Handlers) WatchObject(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	h.poller.Watch(name)
	h.writeJSON(w, map[string]string{"status": "watching", "object": name})
}

// UnwatchObject удаляет объект из списка наблюдения
// DELETE /api/objects/{name}/watch
func (h *Handlers) UnwatchObject(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	h.poller.Unwatch(name)
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

	history, err := h.storage.GetLatest(objectName, variableName, count)
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

	history, err := h.storage.GetHistory(objectName, variableName, from, to)
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

// GetSensorByID возвращает информацию о датчике по ID
// GET /api/sensors/{id}
func (h *Handlers) GetSensorByID(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid sensor ID")
		return
	}

	if h.sensorConfig == nil {
		h.writeError(w, http.StatusNotFound, "sensor configuration not loaded")
		return
	}

	sensor := h.sensorConfig.GetByID(id)
	if sensor == nil {
		h.writeError(w, http.StatusNotFound, "sensor not found")
		return
	}

	h.writeJSON(w, sensor.ToInfo())
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
// GET /api/logs/{name}/stream?filter=...
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
	data, err := h.client.GetObjectData(name)
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
