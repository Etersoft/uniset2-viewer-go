package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/pv/uniset-panel/internal/config"
)

// ================== Server Management API ==================

// GetServers возвращает список всех серверов со статусами
// GET /api/servers
func (h *Handlers) GetServers(w http.ResponseWriter, r *http.Request) {
	if h.serverManager == nil {
		h.writeError(w, http.StatusServiceUnavailable, "server manager not initialized")
		return
	}

	servers := h.serverManager.ListServers()
	h.writeJSON(w, map[string]interface{}{
		"servers": servers,
		"count":   len(servers),
	})
}

// AddServer добавляет новый сервер
// POST /api/servers
func (h *Handlers) AddServer(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	if h.serverManager == nil {
		h.writeError(w, http.StatusServiceUnavailable, "server manager not initialized")
		return
	}

	var req struct {
		URL  string `json:"url"`
		ID   string `json:"id,omitempty"`
		Name string `json:"name,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if req.URL == "" {
		h.writeError(w, http.StatusBadRequest, "url is required")
		return
	}

	cfg := config.ServerConfig{
		URL:  req.URL,
		ID:   req.ID,
		Name: req.Name,
	}

	// Генерируем ID если не указан
	if cfg.ID == "" {
		cfg.ID = generateServerID(cfg.URL)
	}

	if err := h.serverManager.AddServer(cfg); err != nil {
		h.writeError(w, http.StatusConflict, err.Error())
		return
	}

	w.WriteHeader(http.StatusCreated)
	h.writeJSON(w, map[string]interface{}{
		"status": "added",
		"server": map[string]string{
			"id":   cfg.ID,
			"url":  cfg.URL,
			"name": cfg.Name,
		},
	})
}

// RemoveServer удаляет сервер по ID
// DELETE /api/servers/{id}
func (h *Handlers) RemoveServer(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	if h.serverManager == nil {
		h.writeError(w, http.StatusServiceUnavailable, "server manager not initialized")
		return
	}

	serverID := r.PathValue("id")
	if serverID == "" {
		h.writeError(w, http.StatusBadRequest, "server id required")
		return
	}

	if err := h.serverManager.RemoveServer(serverID); err != nil {
		h.writeError(w, http.StatusNotFound, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"status": "removed",
		"id":     serverID,
	})
}

// GetServerStatus возвращает статус конкретного сервера
// GET /api/servers/{id}/status
func (h *Handlers) GetServerStatus(w http.ResponseWriter, r *http.Request) {
	if h.serverManager == nil {
		h.writeError(w, http.StatusServiceUnavailable, "server manager not initialized")
		return
	}

	serverID := r.PathValue("id")
	if serverID == "" {
		h.writeError(w, http.StatusBadRequest, "server id required")
		return
	}

	instance, exists := h.serverManager.GetServer(serverID)
	if !exists {
		h.writeError(w, http.StatusNotFound, "server not found")
		return
	}

	h.writeJSON(w, instance.GetStatus())
}

// GetAllObjectsWithServers возвращает объекты со всех серверов, сгруппированные по серверам
// GET /api/all-objects
func (h *Handlers) GetAllObjectsWithServers(w http.ResponseWriter, r *http.Request) {
	if h.serverManager == nil {
		h.writeError(w, http.StatusServiceUnavailable, "server manager not initialized")
		return
	}

	grouped, err := h.serverManager.GetAllObjectsGrouped()
	if err != nil {
		h.writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	// Считаем общее количество объектов
	totalCount := 0
	for _, server := range grouped {
		totalCount += len(server.Objects)
	}

	h.writeJSON(w, map[string]interface{}{
		"objects": grouped,
		"count":   totalCount,
	})
}

// GetPollInterval возвращает текущий интервал опроса
// GET /api/settings/poll-interval
func (h *Handlers) GetPollInterval(w http.ResponseWriter, r *http.Request) {
	if h.serverManager == nil {
		h.writeJSON(w, map[string]interface{}{
			"interval": h.pollInterval.Milliseconds(),
		})
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"interval": h.serverManager.GetPollInterval().Milliseconds(),
	})
}

// SetPollInterval изменяет интервал опроса
// POST /api/settings/poll-interval
func (h *Handlers) SetPollInterval(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	var req struct {
		Interval int64 `json:"interval"` // миллисекунды
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Валидация: минимум 1 секунда, максимум 5 минут
	if req.Interval < 1000 || req.Interval > 300000 {
		h.writeError(w, http.StatusBadRequest, "interval must be between 1000ms and 300000ms")
		return
	}

	interval := time.Duration(req.Interval) * time.Millisecond

	if h.serverManager != nil {
		h.serverManager.SetPollInterval(interval)
	}

	h.pollInterval = interval

	h.writeJSON(w, map[string]interface{}{
		"interval": interval.Milliseconds(),
		"status":   "ok",
	})
}

// generateServerID генерирует ID из URL
func generateServerID(url string) string {
	// Простой хэш из URL
	var hash uint32 = 0
	for _, c := range url {
		hash = hash*31 + uint32(c)
	}
	return fmt.Sprintf("%08x", hash)
}
