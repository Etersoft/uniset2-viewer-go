package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/pv/uniset-panel/internal/config"
	"github.com/pv/uniset-panel/internal/dashboard"
	"github.com/pv/uniset-panel/internal/ionc"
	"github.com/pv/uniset-panel/internal/journal"
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
	"github.com/pv/uniset-panel/internal/uwsgate"
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
	controlMgr      *ControlManager      // менеджер сессий контроля
	recordingMgr    *recording.Manager   // менеджер записи истории
	version         string               // версия приложения
	uwsgatePoller   *uwsgate.Poller      // поллер UWebSocketGate
	dashboardMgr    *dashboard.Manager   // менеджер серверных dashboard'ов
	journalMgr      *journal.Manager     // менеджер журналов сообщений
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

// SetUWSGatePoller устанавливает UWebSocketGate poller
func (h *Handlers) SetUWSGatePoller(p *uwsgate.Poller) {
	h.uwsgatePoller = p
}

// SetDashboardManager устанавливает менеджер dashboard'ов
func (h *Handlers) SetDashboardManager(mgr *dashboard.Manager) {
	h.dashboardMgr = mgr
}

// SetJournalManager устанавливает менеджер журналов
func (h *Handlers) SetJournalManager(mgr *journal.Manager) {
	h.journalMgr = mgr
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

