package logserver

import (
	"context"
	"log/slog"
	"sync"
)

// Manager управляет подключениями к нескольким LogServer (по одному на объект)
type Manager struct {
	clients map[string]*Client // objectName -> client
	mu      sync.RWMutex
	logger  *slog.Logger
}

// NewManager создает новый менеджер LogServer клиентов
func NewManager(logger *slog.Logger) *Manager {
	if logger == nil {
		logger = slog.Default()
	}
	return &Manager{
		clients: make(map[string]*Client),
		logger:  logger,
	}
}

// GetOrCreateClient возвращает клиент для объекта или создает новый
func (m *Manager) GetOrCreateClient(objectName string, host string, port int) *Client {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Проверяем, есть ли уже клиент
	if client, ok := m.clients[objectName]; ok {
		// Проверяем, не изменился ли адрес
		status := client.GetStatus()
		if status.Host == host && status.Port == port {
			return client
		}
		// Адрес изменился - закрываем старый клиент
		client.Close()
	}

	// Создаем новый клиент
	config := &ClientConfig{
		Host:           host,
		Port:           port,
		ConnectTimeout: 10000,
		ReadTimeout:    10000,
		WriteTimeout:   6000,
		ReconnectDelay: 5000,
	}

	client := NewClient(config, m.logger.With("object", objectName, "logserver", host, "port", port))
	m.clients[objectName] = client

	m.logger.Info("created LogServer client", "object", objectName, "host", host, "port", port)
	return client
}

// GetClient возвращает клиент для объекта или nil
func (m *Manager) GetClient(objectName string) *Client {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.clients[objectName]
}

// RemoveClient удаляет и закрывает клиент для объекта
func (m *Manager) RemoveClient(objectName string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if client, ok := m.clients[objectName]; ok {
		client.Close()
		delete(m.clients, objectName)
		m.logger.Info("removed LogServer client", "object", objectName)
	}
}

// GetAllStatuses возвращает статусы всех клиентов
func (m *Manager) GetAllStatuses() map[string]*ConnectionStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	statuses := make(map[string]*ConnectionStatus)
	for name, client := range m.clients {
		statuses[name] = client.GetStatus()
	}
	return statuses
}

// Close закрывает все клиенты
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for name, client := range m.clients {
		client.Close()
		m.logger.Info("closed LogServer client", "object", name)
	}
	m.clients = make(map[string]*Client)
}

// LogStream стрим логов для передачи через SSE
type LogStream struct {
	ObjectName string
	Lines      chan string
	cancel     context.CancelFunc
	manager    *Manager // ссылка на менеджер для закрытия клиента
}

// NewLogStream создает новый стрим логов для объекта
func (m *Manager) NewLogStream(ctx context.Context, objectName string, host string, port int, filter string) (*LogStream, error) {
	client := m.GetOrCreateClient(objectName, host, port)

	// Подключаемся если не подключены
	if !client.IsConnected() {
		if err := client.Connect(); err != nil {
			return nil, err
		}
	}

	// НЕ отправляем setLevel автоматически - пользователь сам выбирает уровень
	// LogServer будет использовать уровни по умолчанию процесса
	// Если логов нет - это нормальная ситуация

	// Отправляем команду фильтра если указан
	if filter != "" {
		if err := client.SetFilter(filter); err != nil {
			m.logger.Warn("не удалось установить фильтр", "error", err)
		}
	}

	// Создаем канал для строк
	lines := make(chan string, 100)

	// Создаем контекст для отмены
	streamCtx, cancel := context.WithCancel(ctx)

	stream := &LogStream{
		ObjectName: objectName,
		Lines:      lines,
		cancel:     cancel,
		manager:    m,
	}

	// Запускаем чтение логов
	go func() {
		defer close(lines)

		client.ReadLogs(streamCtx, func(line string) {
			select {
			case lines <- line:
			case <-streamCtx.Done():
				return
			default:
				// Канал полон - пропускаем строку
				m.logger.Warn("буфер логов переполнен, пропуск строки", "object", objectName)
			}
		})
	}()

	return stream, nil
}

// Close закрывает стрим логов и TCP соединение к LogServer
func (ls *LogStream) Close() {
	if ls.cancel != nil {
		ls.cancel()
	}
	// Закрываем TCP соединение к LogServer
	if ls.manager != nil {
		ls.manager.RemoveClient(ls.ObjectName)
	}
}
