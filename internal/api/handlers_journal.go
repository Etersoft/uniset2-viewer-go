package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/pv/uniset-panel/internal/journal"
	"github.com/pv/uniset-panel/internal/logger"
)

// GetJournals возвращает список подключенных журналов
// GET /api/journals
func (h *Handlers) GetJournals(w http.ResponseWriter, r *http.Request) {
	if h.journalMgr == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]journal.JournalInfo{})
		return
	}

	infos := h.journalMgr.GetAllInfos()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(infos)
}

// GetJournalMessages возвращает сообщения из журнала с пагинацией и фильтрами
// GET /api/journals/{id}/messages
func (h *Handlers) GetJournalMessages(w http.ResponseWriter, r *http.Request) {
	if h.journalMgr == nil {
		http.Error(w, "journals not configured", http.StatusNotFound)
		return
	}

	id := r.PathValue("id")
	client := h.journalMgr.GetClient(id)
	if client == nil {
		http.Error(w, "journal not found", http.StatusNotFound)
		return
	}

	// Парсим query параметры
	params := journal.QueryParams{}

	// from/to в формате RFC3339 или Unix timestamp
	if fromStr := r.URL.Query().Get("from"); fromStr != "" {
		if t, err := parseTime(fromStr); err == nil {
			params.From = t
		}
	}
	if toStr := r.URL.Query().Get("to"); toStr != "" {
		if t, err := parseTime(toStr); err == nil {
			params.To = t
		}
	}

	// mtype - фильтр по типам (comma-separated)
	if mtypeStr := r.URL.Query().Get("mtype"); mtypeStr != "" {
		params.MTypes = strings.Split(mtypeStr, ",")
	}

	// mgroup - фильтр по группам (comma-separated)
	if mgroupStr := r.URL.Query().Get("mgroup"); mgroupStr != "" {
		params.MGroups = strings.Split(mgroupStr, ",")
	}

	// search - текстовый поиск
	params.Search = r.URL.Query().Get("search")

	// limit/offset для пагинации
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			params.Limit = l
		}
	}
	if params.Limit == 0 {
		params.Limit = 100 // default
	}
	if params.Limit > 1000 {
		params.Limit = 1000 // max
	}

	if offsetStr := r.URL.Query().Get("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			params.Offset = o
		}
	}

	ctx := r.Context()
	resp, err := client.Query(ctx, params)
	if err != nil {
		logger.Error("failed to query journal", "id", id, "error", err)
		http.Error(w, "query failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// GetJournalMTypes возвращает список уникальных типов сообщений
// GET /api/journals/{id}/mtypes
func (h *Handlers) GetJournalMTypes(w http.ResponseWriter, r *http.Request) {
	if h.journalMgr == nil {
		http.Error(w, "journals not configured", http.StatusNotFound)
		return
	}

	id := r.PathValue("id")
	client := h.journalMgr.GetClient(id)
	if client == nil {
		http.Error(w, "journal not found", http.StatusNotFound)
		return
	}

	ctx := r.Context()
	types, err := client.GetMTypes(ctx)
	if err != nil {
		logger.Error("failed to get mtypes", "id", id, "error", err)
		http.Error(w, "query failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(types)
}

// GetJournalMGroups возвращает список уникальных групп сообщений
// GET /api/journals/{id}/mgroups
func (h *Handlers) GetJournalMGroups(w http.ResponseWriter, r *http.Request) {
	if h.journalMgr == nil {
		http.Error(w, "journals not configured", http.StatusNotFound)
		return
	}

	id := r.PathValue("id")
	client := h.journalMgr.GetClient(id)
	if client == nil {
		http.Error(w, "journal not found", http.StatusNotFound)
		return
	}

	ctx := r.Context()
	groups, err := client.GetMGroups(ctx)
	if err != nil {
		logger.Error("failed to get mgroups", "id", id, "error", err)
		http.Error(w, "query failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(groups)
}

// parseTime парсит время из строки (RFC3339 или Unix timestamp)
func parseTime(s string) (time.Time, error) {
	// Пробуем RFC3339
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	// Пробуем Unix timestamp (секунды)
	if ts, err := strconv.ParseInt(s, 10, 64); err == nil {
		return time.Unix(ts, 0), nil
	}
	// Пробуем Unix timestamp (миллисекунды)
	if ts, err := strconv.ParseInt(s, 10, 64); err == nil && ts > 1e12 {
		return time.UnixMilli(ts), nil
	}
	return time.Time{}, nil
}
