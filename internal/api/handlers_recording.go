package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/pv/uniset-panel/internal/recording"
)

// ============================================================================
// Recording API Handlers
// ============================================================================

// StartRecording запускает запись
// POST /api/recording/start
func (h *Handlers) StartRecording(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Recording not configured")
		return
	}

	if err := h.recordingMgr.Start(); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Принудительно сохраняем начальные значения всех подписанных датчиков
	// (чтобы получить первую точку даже если значения не меняются)
	if h.serverManager != nil {
		go h.serverManager.ForceEmitAllPollers()
	}

	h.writeJSON(w, map[string]interface{}{
		"status":      "ok",
		"isRecording": true,
	})
}

// StopRecording останавливает запись
// POST /api/recording/stop
func (h *Handlers) StopRecording(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Recording not configured")
		return
	}

	if err := h.recordingMgr.Stop(); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"status":      "ok",
		"isRecording": false,
	})
}

// GetRecordingStatus возвращает статус записи
// GET /api/recording/status
func (h *Handlers) GetRecordingStatus(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeJSON(w, map[string]interface{}{
			"configured":  false,
			"isRecording": false,
		})
		return
	}

	stats, err := h.recordingMgr.GetStats()
	if err != nil {
		slog.Error("GetRecordingStatus failed", "error", err)
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"configured":   true,
		"isRecording":  stats.IsRecording,
		"recordCount":  stats.RecordCount,
		"sizeBytes":    stats.SizeBytes,
		"oldestRecord": stats.OldestRecord,
		"newestRecord": stats.NewestRecord,
	})
}

// ClearRecording очищает записанные данные
// DELETE /api/recording/clear
func (h *Handlers) ClearRecording(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Recording not configured")
		return
	}

	if err := h.recordingMgr.Clear(); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"status": "ok",
	})
}

// ExportDatabase экспортирует сырую БД
// GET /api/export/database
func (h *Handlers) ExportDatabase(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Recording not configured")
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=\"uniset2-recording.db\"")

	if err := h.recordingMgr.ExportRaw(w); err != nil {
		// Headers already sent, can't write error
		return
	}
}

// ExportCSV экспортирует данные в CSV
// GET /api/export/csv
func (h *Handlers) ExportCSV(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Recording not configured")
		return
	}

	filter := h.parseExportFilter(r)

	records, err := h.recordingMgr.GetHistory(filter)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"uniset2-recording.csv\"")

	if err := recording.ExportCSV(w, records); err != nil {
		// Headers already sent, can't write error
		return
	}
}

// ExportJSON экспортирует данные в JSON
// GET /api/export/json
func (h *Handlers) ExportJSON(w http.ResponseWriter, r *http.Request) {
	if h.recordingMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "Recording not configured")
		return
	}

	filter := h.parseExportFilter(r)

	records, err := h.recordingMgr.GetHistory(filter)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=\"uniset2-recording.json\"")

	if err := recording.ExportJSON(w, records); err != nil {
		// Headers already sent, can't write error
		return
	}
}

// parseExportFilter parses export filter from query parameters
func (h *Handlers) parseExportFilter(r *http.Request) recording.ExportFilter {
	filter := recording.ExportFilter{}

	if fromStr := r.URL.Query().Get("from"); fromStr != "" {
		if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
			filter.From = &t
		}
	}

	if toStr := r.URL.Query().Get("to"); toStr != "" {
		if t, err := time.Parse(time.RFC3339, toStr); err == nil {
			filter.To = &t
		}
	}

	filter.ServerID = r.URL.Query().Get("server")
	filter.ObjectName = r.URL.Query().Get("object")

	return filter
}
