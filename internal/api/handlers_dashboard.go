package api

import (
	"encoding/json"
	"net/http"

	"github.com/pv/uniset-panel/internal/dashboard"
)

// ============================================================================
// Dashboard API
// ============================================================================

// GetDashboards возвращает список всех серверных dashboard'ов
// GET /api/dashboards
func (h *Handlers) GetDashboards(w http.ResponseWriter, r *http.Request) {
	if h.dashboardMgr == nil {
		// No dashboards configured
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]dashboard.DashboardInfo{})
		return
	}

	dashboards := h.dashboardMgr.ListInfo()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dashboards)
}

// GetDashboard возвращает конкретный dashboard по имени (raw JSON)
// GET /api/dashboards/{name}
func (h *Handlers) GetDashboard(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "dashboard name required", http.StatusBadRequest)
		return
	}

	if h.dashboardMgr == nil {
		http.Error(w, "no dashboards configured", http.StatusNotFound)
		return
	}

	rawJSON, ok := h.dashboardMgr.Get(name)
	if !ok {
		http.Error(w, "dashboard not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(rawJSON)
}
