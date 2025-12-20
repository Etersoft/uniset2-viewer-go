package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/pv/uniset-panel/internal/ionc"
	"github.com/pv/uniset-panel/internal/modbus"
	"github.com/pv/uniset-panel/internal/opcua"
	"github.com/pv/uniset-panel/internal/uniset"
)

// requireObjectName extracts object name from path and writes error if missing.
// Returns empty string and false if name is missing (error already written).
func (h *Handlers) requireObjectName(w http.ResponseWriter, r *http.Request) (string, bool) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return "", false
	}
	return name, true
}

// requireClient returns UniSet client for the request's server parameter.
// Returns nil and false if client unavailable (error already written).
func (h *Handlers) requireClient(w http.ResponseWriter, r *http.Request) (*uniset.Client, bool) {
	serverID := r.URL.Query().Get("server")
	client, statusCode, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, statusCode, errMsg)
		return nil, false
	}
	return client, true
}

// decodeJSONBody decodes request body into target struct.
// Returns false if decode failed (error already written).
func (h *Handlers) decodeJSONBody(w http.ResponseWriter, r *http.Request, target interface{}) bool {
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return false
	}
	return true
}

// getPagination extracts offset and limit from query parameters with defaults.
func getPagination(r *http.Request, defaultLimit int) (offset, limit int) {
	offset = 0
	limit = defaultLimit

	if offsetStr := r.URL.Query().Get("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l >= 0 {
			limit = l
		}
	}

	return offset, limit
}

// requireIONCPoller returns IONC poller for the request (supports multi-server).
// Returns nil and false if unavailable (error already written).
func (h *Handlers) requireIONCPoller(w http.ResponseWriter, r *http.Request) (*ionc.Poller, bool) {
	var p *ionc.Poller
	serverID := r.URL.Query().Get("server")
	if h.serverManager != nil && serverID != "" {
		if poller, ok := h.serverManager.GetIONCPoller(serverID); ok {
			p = poller
		}
	}
	if p == nil {
		p = h.ioncPoller
	}
	if p == nil {
		h.writeError(w, http.StatusServiceUnavailable, "IONC poller not available")
		return nil, false
	}
	return p, true
}

// requireModbusPoller returns Modbus poller for the request (supports multi-server).
// Returns nil and false if unavailable (error already written).
func (h *Handlers) requireModbusPoller(w http.ResponseWriter, r *http.Request) (*modbus.Poller, bool) {
	var p *modbus.Poller
	serverID := r.URL.Query().Get("server")
	if h.serverManager != nil && serverID != "" {
		if poller, ok := h.serverManager.GetModbusPoller(serverID); ok {
			p = poller
		}
	}
	if p == nil {
		p = h.modbusPoller
	}
	if p == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Modbus poller not available")
		return nil, false
	}
	return p, true
}

// requireOPCUAPoller returns OPCUA poller for the request (supports multi-server).
// Returns nil and false if unavailable (error already written).
func (h *Handlers) requireOPCUAPoller(w http.ResponseWriter, r *http.Request) (*opcua.Poller, bool) {
	var p *opcua.Poller
	serverID := r.URL.Query().Get("server")
	if h.serverManager != nil && serverID != "" {
		if poller, ok := h.serverManager.GetOPCUAPoller(serverID); ok {
			p = poller
		}
	}
	if p == nil {
		p = h.opcuaPoller
	}
	if p == nil {
		h.writeError(w, http.StatusServiceUnavailable, "OPCUA poller not available")
		return nil, false
	}
	return p, true
}

// getIONCPoller returns IONC poller for the request without error writing.
// Used when poller absence is not an error (e.g., GetIONCSubscriptions).
func (h *Handlers) getIONCPoller(r *http.Request) *ionc.Poller {
	var p *ionc.Poller
	serverID := r.URL.Query().Get("server")
	if h.serverManager != nil && serverID != "" {
		if poller, ok := h.serverManager.GetIONCPoller(serverID); ok {
			p = poller
		}
	}
	if p == nil {
		p = h.ioncPoller
	}
	return p
}

// getModbusPoller returns Modbus poller for the request without error writing.
func (h *Handlers) getModbusPoller(r *http.Request) *modbus.Poller {
	var p *modbus.Poller
	serverID := r.URL.Query().Get("server")
	if h.serverManager != nil && serverID != "" {
		if poller, ok := h.serverManager.GetModbusPoller(serverID); ok {
			p = poller
		}
	}
	if p == nil {
		p = h.modbusPoller
	}
	return p
}

// getOPCUAPoller returns OPCUA poller for the request without error writing.
func (h *Handlers) getOPCUAPoller(r *http.Request) *opcua.Poller {
	var p *opcua.Poller
	serverID := r.URL.Query().Get("server")
	if h.serverManager != nil && serverID != "" {
		if poller, ok := h.serverManager.GetOPCUAPoller(serverID); ok {
			p = poller
		}
	}
	if p == nil {
		p = h.opcuaPoller
	}
	return p
}
