package api

import (
	"encoding/json"
	"net/http"
)

// === Control Types ===

// controlTokenRequest представляет запрос с токеном
type controlTokenRequest struct {
	Token string `json:"token"`
}

// === Control Session Handlers ===

// GetControlStatus возвращает текущий статус контроля
// GET /api/control/status
func (h *Handlers) GetControlStatus(w http.ResponseWriter, r *http.Request) {
	if h.controlMgr == nil {
		// Контроль не настроен
		h.writeJSON(w, ControlStatus{
			Enabled:       false,
			HasController: false,
			IsController:  false,
			TimeoutSec:    0,
		})
		return
	}

	token := r.Header.Get("X-Control-Token")
	status := h.controlMgr.GetStatus(token)
	h.writeJSON(w, status)
}

// TakeControl захватывает управление
// POST /api/control/take
func (h *Handlers) TakeControl(w http.ResponseWriter, r *http.Request) {
	if h.controlMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "control not configured")
		return
	}

	var req controlTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Token == "" {
		h.writeError(w, http.StatusBadRequest, "token is required")
		return
	}

	err := h.controlMgr.TakeControl(req.Token)
	if err != nil {
		switch err {
		case ErrInvalidToken:
			h.writeError(w, http.StatusUnauthorized, "invalid token")
		case ErrControlTaken:
			h.writeError(w, http.StatusConflict, "control already taken by another session")
		default:
			h.writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	status := h.controlMgr.GetStatus(req.Token)
	h.writeJSON(w, status)
}

// ReleaseControl освобождает управление
// POST /api/control/release
func (h *Handlers) ReleaseControl(w http.ResponseWriter, r *http.Request) {
	if h.controlMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "control not configured")
		return
	}

	var req controlTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Token == "" {
		h.writeError(w, http.StatusBadRequest, "token is required")
		return
	}

	err := h.controlMgr.ReleaseControl(req.Token)
	if err != nil {
		switch err {
		case ErrNotController:
			h.writeError(w, http.StatusForbidden, "not the controller")
		default:
			h.writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	status := h.controlMgr.GetStatus(req.Token)
	h.writeJSON(w, status)
}

// PingControl обновляет время активности контроллера
// POST /api/control/ping
func (h *Handlers) PingControl(w http.ResponseWriter, r *http.Request) {
	if h.controlMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "control not configured")
		return
	}

	token := r.Header.Get("X-Control-Token")
	if token == "" {
		h.writeError(w, http.StatusBadRequest, "X-Control-Token header is required")
		return
	}

	if !h.controlMgr.IsController(token) {
		h.writeError(w, http.StatusForbidden, "not the controller")
		return
	}

	h.controlMgr.Touch(token)
	h.writeJSON(w, map[string]string{"status": "ok"})
}

// writeControlError отправляет ошибку контроля
func (h *Handlers) writeControlError(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	json.NewEncoder(w).Encode(map[string]string{
		"error": "Control not authorized",
		"code":  "CONTROL_REQUIRED",
	})
}

// checkControlAccess проверяет доступ на запись
// Возвращает true если доступ разрешён
func (h *Handlers) checkControlAccess(w http.ResponseWriter, r *http.Request) bool {
	// Если контроль не настроен, разрешаем всё
	if h.controlMgr == nil || !h.controlMgr.IsEnabled() {
		return true
	}

	token := r.Header.Get("X-Control-Token")
	if h.controlMgr.IsController(token) {
		h.controlMgr.Touch(token)
		return true
	}

	h.writeControlError(w)
	return false
}
