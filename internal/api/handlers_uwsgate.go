package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/pv/uniset-panel/internal/uwsgate"
)

// ============================================================================
// UWebSocketGate Handlers
// ============================================================================

// SubscribeUWSGateSensors подписывает на датчики через UWebSocketGate
// POST /api/objects/{name}/uwsgate/subscribe
func (h *Handlers) SubscribeUWSGateSensors(w http.ResponseWriter, r *http.Request) {
	objectName := r.PathValue("name")
	if objectName == "" {
		http.Error(w, "Object name is required", http.StatusBadRequest)
		return
	}

	poller := h.getUWSGatePollerForObject(r)
	if poller == nil {
		http.Error(w, "UWebSocketGate poller not available", http.StatusServiceUnavailable)
		return
	}

	var req uwsgate.SubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if len(req.Sensors) == 0 {
		http.Error(w, "No sensors specified", http.StatusBadRequest)
		return
	}

	if err := poller.Subscribe(objectName, req.Sensors); err != nil {
		http.Error(w, fmt.Sprintf("Subscribe failed: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"message": fmt.Sprintf("Subscribed to %d sensors", len(req.Sensors)),
	})
}

// UnsubscribeUWSGateSensors отписывает от датчиков
// POST /api/objects/{name}/uwsgate/unsubscribe
func (h *Handlers) UnsubscribeUWSGateSensors(w http.ResponseWriter, r *http.Request) {
	objectName := r.PathValue("name")
	if objectName == "" {
		http.Error(w, "Object name is required", http.StatusBadRequest)
		return
	}

	poller := h.getUWSGatePollerForObject(r)
	if poller == nil {
		http.Error(w, "UWebSocketGate poller not available", http.StatusServiceUnavailable)
		return
	}

	var req uwsgate.SubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if len(req.Sensors) == 0 {
		http.Error(w, "No sensors specified", http.StatusBadRequest)
		return
	}

	if err := poller.Unsubscribe(objectName, req.Sensors); err != nil {
		http.Error(w, fmt.Sprintf("Unsubscribe failed: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"message": fmt.Sprintf("Unsubscribed from %d sensors", len(req.Sensors)),
	})
}

// GetUWSGateSubscriptions возвращает список подписок для объекта
// GET /api/objects/{name}/uwsgate/subscriptions
func (h *Handlers) GetUWSGateSubscriptions(w http.ResponseWriter, r *http.Request) {
	objectName := r.PathValue("name")
	if objectName == "" {
		http.Error(w, "Object name is required", http.StatusBadRequest)
		return
	}

	poller := h.getUWSGatePollerForObject(r)
	if poller == nil {
		http.Error(w, "UWebSocketGate poller not available", http.StatusServiceUnavailable)
		return
	}

	subscriptions := poller.GetSubscriptions(objectName)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sensors": subscriptions,
	})
}

// GetUWSGateSensors возвращает текущие значения подписанных датчиков
// GET /api/objects/{name}/uwsgate/sensors
func (h *Handlers) GetUWSGateSensors(w http.ResponseWriter, r *http.Request) {
	objectName := r.PathValue("name")
	if objectName == "" {
		http.Error(w, "Object name is required", http.StatusBadRequest)
		return
	}

	poller := h.getUWSGatePollerForObject(r)
	if poller == nil {
		http.Error(w, "UWebSocketGate poller not available", http.StatusServiceUnavailable)
		return
	}

	sensorData := poller.GetSensorsForObject(objectName)

	// Конвертируем в формат Sensor с дополнительной информацией из sensorconfig
	sensors := make([]uwsgate.Sensor, 0, len(sensorData))
	for _, data := range sensorData {
		sensor := uwsgate.Sensor{
			ID:         data.ID,
			Name:       data.Name,
			Value:      data.Value,
			Error:      data.ErrorCode(),
			Timestamp:  data.TVSec,
			SupplierID: data.SupplierID,
			Supplier:   data.Supplier,
		}

		// Дополняем информацией из sensorconfig
		if h.sensorConfig != nil {
			if info := h.sensorConfig.GetByName(data.Name); info != nil {
				sensor.IOType = string(info.IOType)
				sensor.TextName = info.TextName
				sensor.IsDiscrete = info.IOType.IsDiscrete()
				sensor.IsInput = info.IOType.IsInput()
			}
		}

		sensors = append(sensors, sensor)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(uwsgate.SensorsResponse{
		Sensors: sensors,
	})
}

// getUWSGatePollerForObject возвращает UWSGate poller для запроса
// Сначала проверяем serverManager, потом fallback на h.uwsgatePoller
func (h *Handlers) getUWSGatePollerForObject(r *http.Request) *uwsgate.Poller {
	// Если есть serverManager, используем его
	if h.serverManager != nil {
		serverID := r.URL.Query().Get("server")
		if serverID != "" {
			if poller := h.serverManager.GetUWSGatePoller(serverID); poller != nil {
				return poller
			}
		}
	}

	// Fallback на единственный poller
	return h.uwsgatePoller
}
