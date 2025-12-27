package api

import (
	"net/http"
	"strconv"
	"strings"
)

// === IONC Request Types ===

// IONCSetRequest запрос на установку значения датчика
type IONCSetRequest struct {
	SensorID int64 `json:"sensor_id"`
	Value    int64 `json:"value"`
}

// IONCFreezeRequest запрос на заморозку датчика
type IONCFreezeRequest struct {
	SensorID int64 `json:"sensor_id"`
	Value    int64 `json:"value"`
}

// IONCUnfreezeRequest запрос на разморозку датчика
type IONCUnfreezeRequest struct {
	SensorID int64 `json:"sensor_id"`
}

// IONCSubscribeRequest запрос на подписку датчиков для SSE обновлений
type IONCSubscribeRequest struct {
	SensorIDs []int64 `json:"sensor_ids"`
}

// === IONC Handlers ===

// GetIONCSensors возвращает список датчиков IONC объекта
// GET /api/objects/{name}/ionc/sensors?server=...
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
