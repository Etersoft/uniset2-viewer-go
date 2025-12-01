package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/poller"
	"github.com/pv/uniset2-viewer-go/internal/sensorconfig"
	"github.com/pv/uniset2-viewer-go/internal/storage"
	"github.com/pv/uniset2-viewer-go/internal/uniset"
)

type Handlers struct {
	client       *uniset.Client
	storage      storage.Storage
	poller       *poller.Poller
	sensorConfig *sensorconfig.SensorConfig
}

func NewHandlers(client *uniset.Client, store storage.Storage, p *poller.Poller, sensorCfg *sensorconfig.SensorConfig) *Handlers {
	return &Handlers{
		client:       client,
		storage:      store,
		poller:       p,
		sensorConfig: sensorCfg,
	}
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
	h.writeJSON(w, data)
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
