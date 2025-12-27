package api

import (
	"net/http"
	"strconv"
)

// === OPCUA Request Types ===

// OPCUASubscribeRequest структура запроса на подписку OPCUA датчиков
type OPCUASubscribeRequest struct {
	SensorIDs     []int64 `json:"sensor_ids"`
	ExtensionType string  `json:"extension_type,omitempty"` // "OPCUAExchange" или "OPCUAServer"
}

// === OPCUA SSE Subscriptions ===

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

// GetOPCUASensorValues получает значения конкретных датчиков по ID
// GET /api/objects/{name}/opcua/get?filter=id1,id2,id3&server=...
func (h *Handlers) GetOPCUASensorValues(w http.ResponseWriter, r *http.Request) {
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

	result, err := client.GetOPCUASensorValues(name, filter)
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
