package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/pv/uniset-panel/internal/ionc"
	"github.com/pv/uniset-panel/internal/journal"
	"github.com/pv/uniset-panel/internal/logger"
	"github.com/pv/uniset-panel/internal/modbus"
	"github.com/pv/uniset-panel/internal/opcua"
	"github.com/pv/uniset-panel/internal/sm"
	"github.com/pv/uniset-panel/internal/uniset"
	"github.com/pv/uniset-panel/internal/uwsgate"
)

// SSEHub управляет SSE подключениями клиентов
type SSEHub struct {
	mu         sync.RWMutex
	clients    map[*sseClient]bool
	controlMgr *ControlManager // для освобождения контроля при отключении
}

type sseClient struct {
	objectName   string         // если пусто - получает все события
	controlToken string         // токен контроля (если клиент контроллер)
	events       chan SSEEvent
	done         chan struct{}
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

// SetControlManager устанавливает менеджер контроля (для освобождения при отключении)
func (h *SSEHub) SetControlManager(mgr *ControlManager) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.controlMgr = mgr
}

// AddClient добавляет нового SSE клиента
func (h *SSEHub) AddClient(objectName string) *sseClient {
	return h.AddClientWithToken(objectName, "")
}

// AddClientWithToken добавляет нового SSE клиента с токеном контроля
func (h *SSEHub) AddClientWithToken(objectName, controlToken string) *sseClient {
	client := &sseClient{
		objectName:   objectName,
		controlToken: controlToken,
		events:       make(chan SSEEvent, 10),
		done:         make(chan struct{}),
	}

	h.mu.Lock()
	h.clients[client] = true
	controlMgr := h.controlMgr
	h.mu.Unlock()

	// Если клиент переподключается с токеном, отменяем отложенное освобождение
	if controlToken != "" && controlMgr != nil {
		controlMgr.CancelPendingRelease(controlToken)
	}

	logger.Debug("SSE client connected", "object", objectName, "hasToken", controlToken != "", "total_clients", len(h.clients))
	return client
}

// RemoveClient удаляет SSE клиента
func (h *SSEHub) RemoveClient(client *sseClient) {
	h.mu.Lock()
	delete(h.clients, client)
	controlMgr := h.controlMgr
	h.mu.Unlock()

	// Close done channel (avoid panic on double close)
	select {
	case <-client.done:
		// already closed
	default:
		close(client.done)
	}

	// Если клиент был контроллером, освобождаем управление
	if client.controlToken != "" && controlMgr != nil {
		controlMgr.ReleaseBySSE(client.controlToken)
		logger.Debug("SSE client disconnected, released control", "object", client.objectName)
	}

	logger.Debug("SSE client disconnected", "object", client.objectName, "total_clients", len(h.clients))
}

// Broadcast отправляет событие всем подходящим клиентам
func (h *SSEHub) Broadcast(event SSEEvent) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	// Глобальные события отправляются всем клиентам
	isGlobalEvent := event.Type == "server_status" || event.Type == "objects_list" || event.Type == "control_status"

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

// SharedMemoryServerID - идентификатор сервера для SharedMemory событий
const SharedMemoryServerID = "sm"

// BroadcastSensorUpdate отправляет обновление внешнего датчика клиентам
func (h *SSEHub) BroadcastSensorUpdate(update sm.SensorUpdate) {
	h.Broadcast(SSEEvent{
		Type:       "sensor_data",
		ServerID:   SharedMemoryServerID,
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

// BroadcastModbusRegisterBatchWithServer отправляет батч обновлений Modbus регистров с информацией о сервере
func (h *SSEHub) BroadcastModbusRegisterBatchWithServer(serverID, serverName string, updates []modbus.RegisterUpdate) {
	if len(updates) == 0 {
		return
	}

	// Группируем по objectName
	byObject := make(map[string][]uniset.MBRegister)
	var timestamp time.Time

	for _, u := range updates {
		byObject[u.ObjectName] = append(byObject[u.ObjectName], u.Register)
		timestamp = u.Timestamp
	}

	// Отправляем по одному событию на объект
	for objectName, registers := range byObject {
		h.Broadcast(SSEEvent{
			Type:       "modbus_register_batch",
			ServerID:   serverID,
			ServerName: serverName,
			ObjectName: objectName,
			Data:       registers,
			Timestamp:  timestamp,
		})
	}
}

// BroadcastOPCUASensorBatchWithServer отправляет батч обновлений OPC UA датчиков с информацией о сервере
func (h *SSEHub) BroadcastOPCUASensorBatchWithServer(serverID, serverName string, updates []opcua.SensorUpdate) {
	if len(updates) == 0 {
		return
	}

	// Группируем по objectName
	byObject := make(map[string][]opcua.OPCUASensor)
	var timestamp time.Time

	for _, u := range updates {
		byObject[u.ObjectName] = append(byObject[u.ObjectName], u.Sensor)
		timestamp = u.Timestamp
	}

	// Отправляем по одному событию на объект
	for objectName, sensors := range byObject {
		h.Broadcast(SSEEvent{
			Type:       "opcua_sensor_batch",
			ServerID:   serverID,
			ServerName: serverName,
			ObjectName: objectName,
			Data:       sensors,
			Timestamp:  timestamp,
		})
	}
}

// BroadcastUWSGateSensorBatchWithServer отправляет батч обновлений UWebSocketGate датчиков с информацией о сервере
func (h *SSEHub) BroadcastUWSGateSensorBatchWithServer(serverID, serverName string, updates []uwsgate.SensorUpdate) {
	if len(updates) == 0 {
		return
	}

	// Группируем по objectName
	byObject := make(map[string][]uwsgate.SensorData)
	var timestamp time.Time

	for _, u := range updates {
		byObject[u.ObjectName] = append(byObject[u.ObjectName], u.Sensor)
		timestamp = u.Timestamp
	}

	// Отправляем по одному событию на объект
	for objectName, sensors := range byObject {
		h.Broadcast(SSEEvent{
			Type:       "uwsgate_sensor_batch",
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

// Close закрывает все SSE соединения (для graceful shutdown)
func (h *SSEHub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()

	for client := range h.clients {
		select {
		case <-client.done:
			// already closed
		default:
			close(client.done)
		}
	}
	h.clients = make(map[*sseClient]bool)

	logger.Info("SSE hub closed, all clients disconnected")
}

// BroadcastControlStatus отправляет статус контроля всем клиентам
func (h *SSEHub) BroadcastControlStatus(status ControlStatus) {
	h.Broadcast(SSEEvent{
		Type:      "control_status",
		Data:      status,
		Timestamp: time.Now(),
	})
}

// UpdateClientControlToken обновляет токен контроля для клиента
func (h *SSEHub) UpdateClientControlToken(client *sseClient, token string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, exists := h.clients[client]; exists {
		client.controlToken = token
	}
}

// BroadcastJournalMessages отправляет новые сообщения журнала
func (h *SSEHub) BroadcastJournalMessages(journalID string, messages []journal.Message) {
	if len(messages) == 0 {
		return
	}
	h.Broadcast(SSEEvent{
		Type: "journal_messages",
		Data: map[string]interface{}{
			"journalId": journalID,
			"messages":  messages,
		},
		Timestamp: time.Now(),
	})
}

// HandleSSE обрабатывает SSE подключение
// GET /api/events?object=ObjectName&token=xxx (опционально)
func (h *Handlers) HandleSSE(w http.ResponseWriter, r *http.Request) {
	// Проверяем поддержку SSE
	flusher, ok := w.(http.Flusher)
	if !ok {
		h.writeError(w, http.StatusInternalServerError, "SSE not supported")
		return
	}

	// Получаем параметры из query
	objectName := r.URL.Query().Get("object")
	controlToken := r.URL.Query().Get("token")

	// Устанавливаем заголовки SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("X-Accel-Buffering", "no") // Для nginx

	// Регистрируем клиента с токеном (если передан)
	client := h.sseHub.AddClientWithToken(objectName, controlToken)
	defer h.sseHub.RemoveClient(client)

	// Формируем данные приветственного сообщения
	connectedData := map[string]interface{}{
		"pollInterval": h.pollInterval.Milliseconds(),
		"smEnabled":    h.smPoller != nil,
	}

	// Добавляем статус контроля если менеджер настроен
	if h.controlMgr != nil {
		status := h.controlMgr.GetStatus(controlToken)
		connectedData["control"] = status
	} else {
		// Контроль отключён
		connectedData["control"] = ControlStatus{
			Enabled:       false,
			HasController: false,
			IsController:  false,
			TimeoutSec:    0,
		}
	}

	// Отправляем приветственное сообщение с capabilities и статусом контроля
	h.sendSSEEvent(w, SSEEvent{
		Type:      "connected",
		Timestamp: time.Now(),
		Data:      connectedData,
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
