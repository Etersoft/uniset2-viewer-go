package journal

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// Poller опрашивает журнал на наличие новых сообщений
type Poller struct {
	client        *Client
	interval      time.Duration
	lastTimestamp time.Time
	callback      func(journalID string, messages []Message)
	logger        *slog.Logger

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewPoller создаёт новый poller для журнала
func NewPoller(client *Client, interval time.Duration, callback func(journalID string, messages []Message), logger *slog.Logger) *Poller {
	if logger == nil {
		logger = slog.Default()
	}
	if interval <= 0 {
		interval = 2 * time.Second
	}
	return &Poller{
		client:        client,
		interval:      interval,
		lastTimestamp: time.Now(),
		callback:      callback,
		logger:        logger,
	}
}

// Start запускает опрос
func (p *Poller) Start() {
	p.ctx, p.cancel = context.WithCancel(context.Background())
	p.wg.Add(1)
	go p.loop()
}

// Stop останавливает опрос
func (p *Poller) Stop() {
	if p.cancel != nil {
		p.cancel()
	}
	p.wg.Wait()
}

func (p *Poller) loop() {
	defer p.wg.Done()

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	journalID := p.client.ID()
	p.logger.Debug("journal poller started", "id", journalID, "interval", p.interval)

	for {
		select {
		case <-p.ctx.Done():
			p.logger.Debug("journal poller stopped", "id", journalID)
			return
		case <-ticker.C:
			p.poll()
		}
	}
}

func (p *Poller) poll() {
	ctx, cancel := context.WithTimeout(p.ctx, 10*time.Second)
	defer cancel()

	messages, err := p.client.GetNewMessages(ctx, p.lastTimestamp, 100)
	if err != nil {
		p.logger.Error("failed to poll journal", "id", p.client.ID(), "error", err)
		return
	}

	if len(messages) > 0 {
		// Обновляем lastTimestamp на самое свежее сообщение
		for _, msg := range messages {
			if msg.Timestamp.After(p.lastTimestamp) {
				p.lastTimestamp = msg.Timestamp
			}
		}

		// Вызываем callback
		if p.callback != nil {
			p.callback(p.client.ID(), messages)
		}

		p.logger.Debug("polled new messages", "id", p.client.ID(), "count", len(messages))
	}
}
