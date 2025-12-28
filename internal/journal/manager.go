package journal

import (
	"fmt"
	"log/slog"
	"sync"
)

// Manager управляет несколькими журналами
type Manager struct {
	clients map[string]*Client // id -> client
	mu      sync.RWMutex
	logger  *slog.Logger
}

// NewManager создаёт нового менеджера журналов
func NewManager(logger *slog.Logger) *Manager {
	if logger == nil {
		logger = slog.Default()
	}
	return &Manager{
		clients: make(map[string]*Client),
		logger:  logger,
	}
}

// AddJournal добавляет новый журнал по URL
func (m *Manager) AddJournal(urlStr string) error {
	client, err := NewClient(urlStr)
	if err != nil {
		return fmt.Errorf("failed to create client: %w", err)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	id := client.ID()
	if _, exists := m.clients[id]; exists {
		client.Close()
		return fmt.Errorf("journal with ID %s already exists", id)
	}

	m.clients[id] = client
	m.logger.Info("journal added", "id", id, "name", client.Info().Name)
	return nil
}

// GetClient возвращает клиента по ID
func (m *Manager) GetClient(id string) *Client {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.clients[id]
}

// GetAllInfos возвращает информацию о всех журналах
func (m *Manager) GetAllInfos() []JournalInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	infos := make([]JournalInfo, 0, len(m.clients))
	for _, client := range m.clients {
		infos = append(infos, client.Info())
	}
	return infos
}

// GetAllClients возвращает всех клиентов
func (m *Manager) GetAllClients() []*Client {
	m.mu.RLock()
	defer m.mu.RUnlock()

	clients := make([]*Client, 0, len(m.clients))
	for _, client := range m.clients {
		clients = append(clients, client)
	}
	return clients
}

// Count возвращает количество журналов
func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.clients)
}

// Close закрывает все подключения
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, client := range m.clients {
		if err := client.Close(); err != nil {
			m.logger.Error("failed to close journal", "id", id, "error", err)
		}
	}
	m.clients = make(map[string]*Client)
}
