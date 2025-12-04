package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/logger"
	"github.com/pv/uniset2-viewer-go/internal/sm"
	"github.com/pv/uniset2-viewer-go/internal/uniset"
)

// SSEHub управляет SSE подключениями клиентов
type SSEHub struct {
	mu      sync.RWMutex
	clients map[*sseClient]bool
}

type sseClient struct {
	objectName string           // если пусто - получает все события
	events     chan SSEEvent
	done       chan struct{}
}

// SSEEvent представляет событие для отправки клиенту
type SSEEvent struct {
	Type       string      `json:"type"`       // "object_data", "object_list", "error"
	ObjectName string      `json:"objectName,omitempty"`
	Data       interface{} `json:"data,omitempty"`
	Timestamp  time.Time   `json:"timestamp"`
}

// NewSSEHub создаёт новый SSE hub
func NewSSEHub() *SSEHub {
	return &SSEHub{
		clients: make(map[*sseClient]bool),
	}
}

// AddClient добавляет нового SSE клиента
func (h *SSEHub) AddClient(objectName string) *sseClient {
	client := &sseClient{
		objectName: objectName,
		events:     make(chan SSEEvent, 10),
		done:       make(chan struct{}),
	}

	h.mu.Lock()
	h.clients[client] = true
	h.mu.Unlock()

	logger.Debug("SSE client connected", "object", objectName, "total_clients", len(h.clients))
	return client
}

// RemoveClient удаляет SSE клиента
func (h *SSEHub) RemoveClient(client *sseClient) {
	h.mu.Lock()
	delete(h.clients, client)
	h.mu.Unlock()

	close(client.done)
	logger.Debug("SSE client disconnected", "object", client.objectName, "total_clients", len(h.clients))
}

// Broadcast отправляет событие всем подходящим клиентам
func (h *SSEHub) Broadcast(event SSEEvent) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		// Отправляем если клиент подписан на все объекты или на конкретный
		if client.objectName == "" || client.objectName == event.ObjectName {
			select {
			case client.events <- event:
			default:
				// Канал переполнен, пропускаем событие
				logger.Warn("SSE client event buffer full, dropping event",
					"object", client.objectName)
			}
		}
	}
}

// BroadcastObjectData отправляет данные объекта всем подписанным клиентам
func (h *SSEHub) BroadcastObjectData(objectName string, data *uniset.ObjectData) {
	h.Broadcast(SSEEvent{
		Type:       "object_data",
		ObjectName: objectName,
		Data:       data,
		Timestamp:  time.Now(),
	})
}

// BroadcastSensorUpdate отправляет обновление внешнего датчика клиентам
func (h *SSEHub) BroadcastSensorUpdate(update sm.SensorUpdate) {
	h.Broadcast(SSEEvent{
		Type:       "sensor_data",
		ObjectName: update.ObjectName,
		Data:       update.Sensor,
		Timestamp:  update.Timestamp,
	})
}

// ClientCount возвращает количество подключённых клиентов
func (h *SSEHub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// HandleSSE обрабатывает SSE подключение
// GET /api/events?object=ObjectName (опционально)
func (h *Handlers) HandleSSE(w http.ResponseWriter, r *http.Request) {
	// Проверяем поддержку SSE
	flusher, ok := w.(http.Flusher)
	if !ok {
		h.writeError(w, http.StatusInternalServerError, "SSE not supported")
		return
	}

	// Получаем имя объекта из query параметра (опционально)
	objectName := r.URL.Query().Get("object")

	// Устанавливаем заголовки SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("X-Accel-Buffering", "no") // Для nginx

	// Регистрируем клиента
	client := h.sseHub.AddClient(objectName)
	defer h.sseHub.RemoveClient(client)

	// Отправляем приветственное сообщение
	h.sendSSEEvent(w, SSEEvent{
		Type:      "connected",
		Timestamp: time.Now(),
		Data: map[string]interface{}{
			"pollInterval": h.pollInterval.Milliseconds(),
		},
	})
	flusher.Flush()

	// Слушаем события
	for {
		select {
		case <-r.Context().Done():
			return
		case <-client.done:
			return
		case event := <-client.events:
			h.sendSSEEvent(w, event)
			flusher.Flush()
		}
	}
}

// sendSSEEvent отправляет одно SSE событие
func (h *Handlers) sendSSEEvent(w http.ResponseWriter, event SSEEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		logger.Error("Failed to marshal SSE event", "error", err)
		return
	}

	fmt.Fprintf(w, "event: %s\n", event.Type)
	fmt.Fprintf(w, "data: %s\n\n", data)
}
