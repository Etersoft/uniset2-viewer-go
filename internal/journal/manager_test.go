package journal

import (
	"log/slog"
	"testing"
)

func TestNewManager(t *testing.T) {
	mgr := NewManager(nil)
	if mgr == nil {
		t.Fatal("expected non-nil manager")
	}
	if mgr.clients == nil {
		t.Error("expected clients map to be initialized")
	}
	if mgr.Count() != 0 {
		t.Errorf("expected 0 clients, got %d", mgr.Count())
	}
}

func TestNewManager_WithLogger(t *testing.T) {
	logger := slog.Default()
	mgr := NewManager(logger)
	if mgr == nil {
		t.Fatal("expected non-nil manager")
	}
	if mgr.logger != logger {
		t.Error("expected logger to be set")
	}
}

func TestManager_GetClient_NotFound(t *testing.T) {
	mgr := NewManager(nil)
	client := mgr.GetClient("nonexistent")
	if client != nil {
		t.Error("expected nil for non-existent client")
	}
}

func TestManager_GetAllInfos_Empty(t *testing.T) {
	mgr := NewManager(nil)
	infos := mgr.GetAllInfos()
	if len(infos) != 0 {
		t.Errorf("expected 0 infos, got %d", len(infos))
	}
}

func TestManager_GetAllClients_Empty(t *testing.T) {
	mgr := NewManager(nil)
	clients := mgr.GetAllClients()
	if len(clients) != 0 {
		t.Errorf("expected 0 clients, got %d", len(clients))
	}
}

func TestManager_Close_Empty(t *testing.T) {
	mgr := NewManager(nil)
	// Should not panic
	mgr.Close()
	if mgr.Count() != 0 {
		t.Error("expected 0 clients after close")
	}
}

func TestManager_AddJournal_InvalidURL(t *testing.T) {
	mgr := NewManager(nil)

	// Invalid URL scheme should fail to connect
	err := mgr.AddJournal("invalid://not-a-real-host:9999/db")
	if err == nil {
		t.Error("expected error for invalid URL")
	}

	if mgr.Count() != 0 {
		t.Errorf("expected 0 clients after failed add, got %d", mgr.Count())
	}
}

func TestManager_AddJournal_ConnectionRefused(t *testing.T) {
	mgr := NewManager(nil)

	// Valid URL but connection should fail (no server running)
	err := mgr.AddJournal("clickhouse://127.0.0.1:59999/testdb")
	if err == nil {
		t.Error("expected error for connection refused")
	}

	if mgr.Count() != 0 {
		t.Errorf("expected 0 clients after failed add, got %d", mgr.Count())
	}
}
