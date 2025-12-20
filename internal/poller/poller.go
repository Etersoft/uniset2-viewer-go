package poller

import (
	"context"
	"sync"
	"time"

	"github.com/pv/uniset-panel/internal/logger"
	"github.com/pv/uniset-panel/internal/recording"
	"github.com/pv/uniset-panel/internal/storage"
	"github.com/pv/uniset-panel/internal/uniset"
)

// EventCallback вызывается при получении новых данных объекта
type EventCallback func(objectName string, data *uniset.ObjectData)

type Poller struct {
	client   *uniset.Client
	storage  storage.Storage
	interval time.Duration
	ttl      time.Duration
	serverID string // ID сервера для storage

	mu              sync.RWMutex
	watchedObjects  map[string]bool
	lastObjectData  map[string]*uniset.ObjectData
	lastCleanupTime time.Time

	eventCallback EventCallback
	recordingMgr  *recording.Manager // менеджер записи истории
}

func New(client *uniset.Client, store storage.Storage, interval, ttl time.Duration) *Poller {
	return &Poller{
		client:          client,
		storage:         store,
		interval:        interval,
		ttl:             ttl,
		serverID:        "", // будет использоваться DefaultServerID
		watchedObjects:  make(map[string]bool),
		lastObjectData:  make(map[string]*uniset.ObjectData),
		lastCleanupTime: time.Now(),
	}
}

// SetServerID устанавливает ID сервера для сохранения в storage
func (p *Poller) SetServerID(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.serverID = id
}

// SetEventCallback устанавливает callback для уведомления о новых данных
func (p *Poller) SetEventCallback(cb EventCallback) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.eventCallback = cb
}

// SetRecordingManager устанавливает менеджер записи истории
func (p *Poller) SetRecordingManager(mgr *recording.Manager) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.recordingMgr = mgr
}

// Watch добавляет объект в список наблюдения
func (p *Poller) Watch(objectName string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.watchedObjects[objectName] = true
}

// Unwatch удаляет объект из списка наблюдения
func (p *Poller) Unwatch(objectName string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.watchedObjects, objectName)
}

// GetLastData возвращает последние полученные данные объекта
func (p *Poller) GetLastData(objectName string) *uniset.ObjectData {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.lastObjectData[objectName]
}

// Run запускает цикл опроса
func (p *Poller) Run(ctx context.Context) {
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	// Первый опрос сразу
	p.poll()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.poll()
		}
	}
}

func (p *Poller) poll() {
	p.mu.RLock()
	objects := make([]string, 0, len(p.watchedObjects))
	for obj := range p.watchedObjects {
		objects = append(objects, obj)
	}
	p.mu.RUnlock()

	now := time.Now().UTC()

	for _, objectName := range objects {
		data, err := p.client.GetObjectData(objectName)
		if err != nil {
			logger.Warn("Poll failed", "object", objectName, "error", err)
			continue
		}

		p.mu.Lock()
		p.lastObjectData[objectName] = data
		callback := p.eventCallback
		p.mu.Unlock()

		// Уведомляем SSE клиентов о новых данных
		if callback != nil {
			callback(objectName, data)
		}

		// Сохраняем переменные в историю
		if data.Variables != nil {
			for varName, value := range data.Variables {
				if err := p.storage.Save(p.serverID, objectName, varName, value, now); err != nil {
					logger.Warn("Save variable failed", "object", objectName, "var", varName, "error", err)
				}
				// Сохраняем в recording (если включено)
				if p.recordingMgr != nil {
					p.recordingMgr.Save(p.serverID, objectName, varName, value, now)
				}
			}
		}

		// Сохраняем IO данные
		if data.IO != nil {
			if data.IO.In != nil {
				for key, io := range data.IO.In {
					varName := "io.in." + key
					if err := p.storage.Save(p.serverID, objectName, varName, io.Value, now); err != nil {
						logger.Warn("Save IO input failed", "object", objectName, "var", varName, "error", err)
					}
					// Сохраняем в recording (если включено)
					if p.recordingMgr != nil {
						p.recordingMgr.Save(p.serverID, objectName, varName, io.Value, now)
					}
				}
			}
			if data.IO.Out != nil {
				for key, io := range data.IO.Out {
					varName := "io.out." + key
					if err := p.storage.Save(p.serverID, objectName, varName, io.Value, now); err != nil {
						logger.Warn("Save IO output failed", "object", objectName, "var", varName, "error", err)
					}
					// Сохраняем в recording (если включено)
					if p.recordingMgr != nil {
						p.recordingMgr.Save(p.serverID, objectName, varName, io.Value, now)
					}
				}
			}
		}
	}

	// Периодическая очистка старых данных
	if time.Since(p.lastCleanupTime) > time.Minute {
		if err := p.storage.Cleanup(now.Add(-p.ttl)); err != nil {
			logger.Warn("Cleanup failed", "error", err)
		}
		p.lastCleanupTime = now
	}
}
