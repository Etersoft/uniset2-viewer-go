package api

import (
	"net/http"
)

// ============================================================================
// UNetExchange Handlers
// ============================================================================

// GetUNetStatus возвращает статус UNetExchange
// GET /api/objects/{name}/unet/status?server=serverID
func (h *Handlers) GetUNetStatus(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	serverID := r.URL.Query().Get("server")
	client, code, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, code, errMsg)
		return
	}

	resp, err := client.GetUNetStatus(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, resp.Status)
}

// GetUNetReceivers возвращает список receivers UNetExchange
// GET /api/objects/{name}/unet/receivers?server=serverID
func (h *Handlers) GetUNetReceivers(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	serverID := r.URL.Query().Get("server")
	client, code, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, code, errMsg)
		return
	}

	resp, err := client.GetUNetReceivers(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"receivers": resp.Receivers,
	})
}

// GetUNetSenders возвращает список senders UNetExchange
// GET /api/objects/{name}/unet/senders?server=serverID
func (h *Handlers) GetUNetSenders(w http.ResponseWriter, r *http.Request) {
	name, ok := h.requireObjectName(w, r)
	if !ok {
		return
	}

	serverID := r.URL.Query().Get("server")
	client, code, errMsg := h.getUniSetClient(serverID)
	if client == nil {
		h.writeError(w, code, errMsg)
		return
	}

	resp, err := client.GetUNetSenders(name)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"senders": resp.Senders,
	})
}
