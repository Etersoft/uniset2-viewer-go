package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/pv/uniset-panel/internal/logserver"
)

// === LogServer Types ===

// LogServerCommand структура команды для LogServer
type LogServerCommand struct {
	Command string `json:"command"` // setLevel, addLevel, delLevel, setFilter
	Level   uint32 `json:"level,omitempty"`
	Filter  string `json:"filter,omitempty"`
}

// === LogServer Handlers ===

// GetLogServerStatus возвращает статус подключения к LogServer объекта
// GET /api/logs/{name}/status
func (h *Handlers) GetLogServerStatus(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	if h.logServerMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "LogServer manager not available")
		return
	}

	client := h.logServerMgr.GetClient(name)
	if client == nil {
		h.writeJSON(w, &logserver.ConnectionStatus{
			Connected: false,
			Host:      "",
			Port:      0,
		})
		return
	}

	h.writeJSON(w, client.GetStatus())
}

// HandleLogServerStream стримит логи объекта через SSE
// GET /api/logs/{name}/stream?filter=...&server=serverID
func (h *Handlers) HandleLogServerStream(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	if h.logServerMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "LogServer manager not available")
		return
	}

	// Получаем данные объекта для получения host:port LogServer
	serverID := r.URL.Query().Get("server")

	var host string
	var port int

	if h.serverManager != nil {
		if serverID == "" {
			h.writeError(w, http.StatusBadRequest, "server parameter is required")
			return
		}
		objData, err := h.serverManager.GetObjectData(serverID, name)
		if err != nil {
			h.writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		if objData.LogServer == nil {
			h.writeError(w, http.StatusNotFound, "object has no LogServer")
			return
		}
		host = objData.LogServer.Host
		port = objData.LogServer.Port
	} else if h.client != nil {
		objData, err := h.client.GetObjectData(name)
		if err != nil {
			h.writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		if objData.LogServer == nil {
			h.writeError(w, http.StatusNotFound, "object has no LogServer")
			return
		}
		host = objData.LogServer.Host
		port = objData.LogServer.Port
	} else {
		h.writeError(w, http.StatusServiceUnavailable, "no client configured")
		return
	}
	if host == "" {
		host = "localhost"
	}
	if port == 0 {
		port = 3333
	}

	filter := r.URL.Query().Get("filter")

	// Настраиваем SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		h.writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Получаем настройки батчинга из конфига
	bufferSize := h.logStreamConfig.GetBufferSize()
	batchSize := h.logStreamConfig.GetBatchSize()
	batchInterval := h.logStreamConfig.GetBatchInterval()

	// Создаем стрим логов
	ctx := r.Context()
	stream, err := h.logServerMgr.NewLogStream(ctx, name, host, port, filter, bufferSize)
	if err != nil {
		// Отправляем ошибку как SSE событие
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", err.Error())
		flusher.Flush()
		return
	}
	defer stream.Close()

	// Отправляем событие подключения
	fmt.Fprintf(w, "event: connected\ndata: {\"host\":\"%s\",\"port\":%d}\n\n", host, port)
	flusher.Flush()

	// Батчевый стриминг логов
	ticker := time.NewTicker(batchInterval)
	defer ticker.Stop()

	batch := make([]string, 0, batchSize)

	for {
		select {
		case <-ctx.Done():
			// Отправляем оставшиеся строки перед закрытием
			if len(batch) > 0 {
				h.sendLogBatch(w, flusher, batch)
			}
			return

		case line, ok := <-stream.Lines:
			if !ok {
				// Канал закрыт - отправляем оставшиеся строки
				if len(batch) > 0 {
					h.sendLogBatch(w, flusher, batch)
				}
				// LogServer отключился
				fmt.Fprintf(w, "event: disconnected\ndata: {}\n\n")
				flusher.Flush()
				return
			}
			batch = append(batch, line)

			// Отправляем если достигли размера батча
			if len(batch) >= batchSize {
				h.sendLogBatch(w, flusher, batch)
				batch = batch[:0]
			}

		case <-ticker.C:
			// Отправляем по таймеру если есть что отправить
			if len(batch) > 0 {
				h.sendLogBatch(w, flusher, batch)
				batch = batch[:0]
			}
		}
	}
}

// sendLogBatch отправляет батч логов как SSE событие
func (h *Handlers) sendLogBatch(w http.ResponseWriter, flusher http.Flusher, lines []string) {
	data, err := json.Marshal(lines)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "event: logs\ndata: %s\n\n", data)
	flusher.Flush()
}

// SendLogServerCommand отправляет команду на LogServer объекта
// POST /api/logs/{name}/command
func (h *Handlers) SendLogServerCommand(w http.ResponseWriter, r *http.Request) {
	if !h.checkControlAccess(w, r) {
		return
	}

	name := r.PathValue("name")
	if name == "" {
		h.writeError(w, http.StatusBadRequest, "object name required")
		return
	}

	if h.logServerMgr == nil {
		h.writeError(w, http.StatusServiceUnavailable, "LogServer manager not available")
		return
	}

	var cmd LogServerCommand
	if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid command")
		return
	}

	client := h.logServerMgr.GetClient(name)
	if client == nil {
		// Нет активного клиента - нужно сначала подключиться через stream
		h.writeError(w, http.StatusNotFound, "no active connection to LogServer")
		return
	}

	var err error
	switch cmd.Command {
	case "setLevel":
		err = client.SetLogLevel(logserver.LogLevel(cmd.Level), cmd.Filter)
	case "addLevel":
		err = client.AddLogLevel(logserver.LogLevel(cmd.Level), cmd.Filter)
	case "delLevel":
		err = client.DelLogLevel(logserver.LogLevel(cmd.Level), cmd.Filter)
	case "setFilter":
		err = client.SetFilter(cmd.Filter)
	case "list":
		err = client.RequestList(cmd.Filter)
	default:
		h.writeError(w, http.StatusBadRequest, "unknown command: "+cmd.Command)
		return
	}

	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, map[string]string{"status": "ok"})
}

// GetAllLogServerStatuses возвращает статусы всех LogServer подключений
// GET /api/logs/status
func (h *Handlers) GetAllLogServerStatuses(w http.ResponseWriter, r *http.Request) {
	if h.logServerMgr == nil {
		h.writeJSON(w, map[string]interface{}{})
		return
	}

	h.writeJSON(w, h.logServerMgr.GetAllStatuses())
}
