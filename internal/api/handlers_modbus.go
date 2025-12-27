package api

import (
	"net/http"
)

// === Modbus Request Types ===

// ModbusSubscribeRequest структура запроса на подписку Modbus регистров
type ModbusSubscribeRequest struct {
	RegisterIDs []int64 `json:"register_ids"`
}

// MBModeSetRequest запрос на установку режима
type MBModeSetRequest struct {
	Mode string `json:"mode"`
}

// === Modbus SSE Subscriptions ===

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

// GetMBRegisterValues получает значения конкретных регистров по ID
// GET /api/objects/{name}/modbus/get?filter=id1,id2,id3&server=...
func (h *Handlers) GetMBRegisterValues(w http.ResponseWriter, r *http.Request) {
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

	result, err := client.GetMBRegisterValues(name, filter)
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
