package journal

import (
	"log/slog"
	"testing"
	"time"
)

func TestNewPoller_NilClient(t *testing.T) {
	// Should not panic with nil client
	poller := NewPoller(nil, time.Second, nil, nil)
	if poller == nil {
		t.Fatal("expected non-nil poller")
	}
	if poller.interval != time.Second {
		t.Errorf("expected interval=1s, got %v", poller.interval)
	}
}

func TestNewPoller_DefaultInterval(t *testing.T) {
	poller := NewPoller(nil, 0, nil, nil)
	if poller.interval != 2*time.Second {
		t.Errorf("expected default interval=2s, got %v", poller.interval)
	}
}

func TestNewPoller_NegativeInterval(t *testing.T) {
	poller := NewPoller(nil, -5*time.Second, nil, nil)
	if poller.interval != 2*time.Second {
		t.Errorf("expected default interval=2s for negative value, got %v", poller.interval)
	}
}

func TestNewPoller_WithLogger(t *testing.T) {
	logger := slog.Default()
	poller := NewPoller(nil, time.Second, nil, logger)
	if poller.logger != logger {
		t.Error("expected logger to be set")
	}
}

func TestNewPoller_WithCallback(t *testing.T) {
	callback := func(journalID string, messages []Message) {
		// callback body
	}

	poller := NewPoller(nil, time.Second, callback, nil)
	if poller.callback == nil {
		t.Error("expected callback to be set")
	}
}

// TestPoller_StartStop requires a real ClickHouse client
// and is tested in integration tests
func TestPoller_StartStop(t *testing.T) {
	t.Skip("requires ClickHouse server - tested in integration tests")
}

func TestPoller_StopWithoutStart(t *testing.T) {
	poller := NewPoller(nil, time.Second, nil, nil)
	// Should not panic
	poller.Stop()
}

// TestPoller_DoubleStop requires a real ClickHouse client
func TestPoller_DoubleStop(t *testing.T) {
	t.Skip("requires ClickHouse server - tested in integration tests")
}

func TestPoller_LastTimestamp(t *testing.T) {
	before := time.Now()
	poller := NewPoller(nil, time.Second, nil, nil)
	after := time.Now()

	if poller.lastTimestamp.Before(before) || poller.lastTimestamp.After(after) {
		t.Error("expected lastTimestamp to be set to current time")
	}
}
