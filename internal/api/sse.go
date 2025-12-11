package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/ionc"
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
	Type       string      `json:"type"` // "object_data", "object_list", "server_status", "error"
	ServerID   string      `json:"serverId,omitempty"`
	ServerName string      `json:"serverName,omitempty"`
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

	// События server_status и objects_list отправляются всем клиентам
	isGlobalEvent := event.Type == "server_status" || event.Type == "objects_list"

	for client := range h.clients {
		// Отправляем если: глобальное событие ИЛИ клиент подписан на все объекты ИЛИ на конкретный
		if isGlobalEvent || client.objectName == "" || client.objectName == event.ObjectName {
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

// BroadcastObjectDataWithServer отправляет данные объекта с информацией о сервере
func (h *SSEHub) BroadcastObjectDataWithServer(serverID, serverName, objectName string, data *uniset.ObjectData) {
	h.Broadcast(SSEEvent{
		Type:       "object_data",
		ServerID:   serverID,
		ServerName: serverName,
		ObjectName: objectName,
		Data:       data,
		Timestamp:  time.Now(),
	})
}

// BroadcastServerStatus отправляет изменение статуса сервера
func (h *SSEHub) BroadcastServerStatus(serverID, serverName string, connected bool, lastError string) {
	h.Broadcast(SSEEvent{
		Type:       "server_status",
		ServerID:   serverID,
		ServerName: serverName,
		Data: map[string]interface{}{
			"connected": connected,
			"lastError": lastError,
		},
		Timestamp: time.Now(),
	})
}

// BroadcastObjectsList отправляет обновлённый список объектов (при восстановлении связи)
func (h *SSEHub) BroadcastObjectsList(serverID, serverName string, objects []string) {
	h.Broadcast(SSEEvent{
		Type:       "objects_list",
		ServerID:   serverID,
		ServerName: serverName,
		Data: map[string]interface{}{
			"objects":   objects,
			"connected": true,
		},
		Timestamp: time.Now(),
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

// BroadcastIONCSensorBatchWithServer отправляет батч обновлений IONC датчиков с информацией о сервере
func (h *SSEHub) BroadcastIONCSensorBatchWithServer(serverID, serverName string, updates []ionc.SensorUpdate) {
	if len(updates) == 0 {
		return
	}

	// Группируем по objectName
	byObject := make(map[string][]uniset.IONCSensor)
	var timestamp time.Time

	for _, u := range updates {
		byObject[u.ObjectName] = append(byObject[u.ObjectName], u.Sensor)
		timestamp = u.Timestamp
	}

	// Отправляем по одному событию на объект
	for objectName, sensors := range byObject {
		h.Broadcast(SSEEvent{
			Type:       "ionc_sensor_batch",
			ServerID:   serverID,
			ServerName: serverName,
			ObjectName: objectName,
			Data:       sensors,
			Timestamp:  timestamp,
		})
	}
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

	// Отправляем приветственное сообщение с capabilities
	h.sendSSEEvent(w, SSEEvent{
		Type:      "connected",
		Timestamp: time.Now(),
		Data: map[string]interface{}{
			"pollInterval": h.pollInterval.Milliseconds(),
			"smEnabled":    h.smPoller != nil,
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
