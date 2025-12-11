package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/config"
	"github.com/pv/uniset2-viewer-go/internal/ionc"
	"github.com/pv/uniset2-viewer-go/internal/storage"
	"github.com/pv/uniset2-viewer-go/internal/uniset"
)

func TestNewManager(t *testing.T) {
	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "TestSupplier")

	if mgr == nil {
		t.Fatal("NewManager returned nil")
	}

	if mgr.ServerCount() != 0 {
		t.Errorf("expected 0 servers, got %d", mgr.ServerCount())
	}
}

func TestManagerAddServer(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	cfg := config.ServerConfig{
		ID:   "server1",
		URL:  server.URL,
		Name: "Test Server 1",
	}

	err := mgr.AddServer(cfg)
	if err != nil {
		t.Fatalf("AddServer failed: %v", err)
	}

	if mgr.ServerCount() != 1 {
		t.Errorf("expected 1 server, got %d", mgr.ServerCount())
	}

	// Try to add duplicate
	err = mgr.AddServer(cfg)
	if err == nil {
		t.Error("expected error when adding duplicate server")
	}
}

func TestManagerAddServerEmptyURL(t *testing.T) {
	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	cfg := config.ServerConfig{
		ID:   "server1",
		URL:  "", // Empty URL
		Name: "Test Server 1",
	}

	err := mgr.AddServer(cfg)
	if err == nil {
		t.Error("expected error when adding server with empty URL")
	}
}

func TestManagerRemoveServer(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	cfg := config.ServerConfig{
		ID:   "server1",
		URL:  server.URL,
		Name: "Test Server 1",
	}

	mgr.AddServer(cfg)

	err := mgr.RemoveServer("server1")
	if err != nil {
		t.Fatalf("RemoveServer failed: %v", err)
	}

	if mgr.ServerCount() != 0 {
		t.Errorf("expected 0 servers, got %d", mgr.ServerCount())
	}

	// Try to remove non-existent
	err = mgr.RemoveServer("server1")
	if err == nil {
		t.Error("expected error when removing non-existent server")
	}
}

func TestManagerGetServer(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	cfg := config.ServerConfig{
		ID:   "server1",
		URL:  server.URL,
		Name: "Test Server 1",
	}

	mgr.AddServer(cfg)

	instance, exists := mgr.GetServer("server1")
	if !exists {
		t.Error("GetServer returned exists=false for existing server")
	}
	if instance == nil {
		t.Error("GetServer returned nil instance")
	}

	_, exists = mgr.GetServer("nonexistent")
	if exists {
		t.Error("GetServer returned exists=true for non-existent server")
	}
}

func TestManagerGetServerByURL(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	cfg := config.ServerConfig{
		ID:   "server1",
		URL:  server.URL,
		Name: "Test Server 1",
	}

	mgr.AddServer(cfg)

	instance, exists := mgr.GetServerByURL(server.URL)
	if !exists {
		t.Error("GetServerByURL returned exists=false for existing URL")
	}
	if instance == nil {
		t.Error("GetServerByURL returned nil instance")
	}

	_, exists = mgr.GetServerByURL("http://nonexistent:9999")
	if exists {
		t.Error("GetServerByURL returned exists=true for non-existent URL")
	}
}

func TestManagerListServers(t *testing.T) {
	server1 := mockUnisetServer()
	defer server1.Close()

	server2 := mockUnisetServer()
	defer server2.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.AddServer(config.ServerConfig{
		ID:   "server1",
		URL:  server1.URL,
		Name: "Server 1",
	})

	mgr.AddServer(config.ServerConfig{
		ID:   "server2",
		URL:  server2.URL,
		Name: "Server 2",
	})

	servers := mgr.ListServers()
	if len(servers) != 2 {
		t.Errorf("expected 2 servers in list, got %d", len(servers))
	}
}

func TestManagerGetPollInterval(t *testing.T) {
	store := storage.NewMemoryStorage()
	mgr := NewManager(store, 5*time.Second, time.Hour, "")

	interval := mgr.GetPollInterval()
	if interval != 5*time.Second {
		t.Errorf("expected poll interval 5s, got %v", interval)
	}
}

func TestManagerSetPollInterval(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	// Add a server so we can verify interval is propagated
	mgr.AddServer(config.ServerConfig{
		ID:   "server1",
		URL:  server.URL,
		Name: "Server 1",
	})

	// Change poll interval
	mgr.SetPollInterval(10 * time.Second)

	interval := mgr.GetPollInterval()
	if interval != 10*time.Second {
		t.Errorf("expected poll interval 10s, got %v", interval)
	}

	// Verify instance health interval was also updated
	instance, _ := mgr.GetServer("server1")
	instance.mu.RLock()
	healthInterval := instance.healthInterval
	instance.mu.RUnlock()

	if healthInterval != 10*time.Second {
		t.Errorf("expected instance health interval 10s, got %v", healthInterval)
	}
}

func TestManagerSetObjectCallback(t *testing.T) {
	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.SetObjectCallback(func(serverID, serverName, objectName string, data *uniset.ObjectData) {
		// callback set
	})

	if mgr.objectCallback == nil {
		t.Error("objectCallback was not set")
	}
}

func TestManagerSetIONCCallback(t *testing.T) {
	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.SetIONCCallback(func(serverID, serverName string, updates []ionc.SensorUpdate) {})

	if mgr.ioncCallback == nil {
		t.Error("ioncCallback was not set")
	}
}

func TestManagerSetStatusCallback(t *testing.T) {
	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.SetStatusCallback(func(serverID, serverName string, connected bool, lastError string) {})

	if mgr.statusCallback == nil {
		t.Error("statusCallback was not set")
	}
}

func TestManagerSetObjectsCallback(t *testing.T) {
	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.SetObjectsCallback(func(serverID, serverName string, objects []string) {})

	if mgr.objectsCallback == nil {
		t.Error("objectsCallback was not set")
	}
}

func TestManagerGetAllObjects(t *testing.T) {
	server1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v2/list" {
			json.NewEncoder(w).Encode([]string{"Proc1", "Proc2"})
		}
	}))
	defer server1.Close()

	server2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v2/list" {
			json.NewEncoder(w).Encode([]string{"Proc3"})
		}
	}))
	defer server2.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.AddServer(config.ServerConfig{ID: "s1", URL: server1.URL, Name: "Server1"})
	mgr.AddServer(config.ServerConfig{ID: "s2", URL: server2.URL, Name: "Server2"})

	objects, err := mgr.GetAllObjects()
	if err != nil {
		t.Fatalf("GetAllObjects failed: %v", err)
	}

	if len(objects) != 3 {
		t.Errorf("expected 3 objects, got %d", len(objects))
	}

	// Check FullID format
	found := false
	for _, obj := range objects {
		if obj.FullID == "s1:Proc1" || obj.FullID == "s2:Proc3" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected to find object with FullID format serverID:objectName")
	}
}

func TestManagerGetAllObjectsGrouped(t *testing.T) {
	server1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v2/list" {
			json.NewEncoder(w).Encode([]string{"Proc1", "Proc2"})
		}
	}))
	defer server1.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.AddServer(config.ServerConfig{ID: "s1", URL: server1.URL, Name: "Server1"})

	grouped, err := mgr.GetAllObjectsGrouped()
	if err != nil {
		t.Fatalf("GetAllObjectsGrouped failed: %v", err)
	}

	if len(grouped) != 1 {
		t.Errorf("expected 1 server group, got %d", len(grouped))
	}

	if len(grouped[0].Objects) != 2 {
		t.Errorf("expected 2 objects in group, got %d", len(grouped[0].Objects))
	}

	if grouped[0].ServerID != "s1" {
		t.Errorf("expected ServerID=s1, got %s", grouped[0].ServerID)
	}
}

func TestManagerGetObjectData(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.AddServer(config.ServerConfig{ID: "s1", URL: server.URL, Name: "Server1"})

	data, err := mgr.GetObjectData("s1", "TestProc")
	if err != nil {
		t.Fatalf("GetObjectData failed: %v", err)
	}

	if data == nil {
		t.Fatal("GetObjectData returned nil")
	}

	if data.Name != "TestProc" {
		t.Errorf("expected Name=TestProc, got %s", data.Name)
	}

	// Test non-existent server
	_, err = mgr.GetObjectData("nonexistent", "TestProc")
	if err == nil {
		t.Error("expected error for non-existent server")
	}
}

func TestManagerWatch(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.AddServer(config.ServerConfig{ID: "s1", URL: server.URL, Name: "Server1"})

	err := mgr.Watch("s1", "TestProc")
	if err != nil {
		t.Fatalf("Watch failed: %v", err)
	}

	err = mgr.Watch("nonexistent", "TestProc")
	if err == nil {
		t.Error("expected error for non-existent server")
	}
}

func TestManagerUnwatch(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.AddServer(config.ServerConfig{ID: "s1", URL: server.URL, Name: "Server1"})

	mgr.Watch("s1", "TestProc")

	err := mgr.Unwatch("s1", "TestProc")
	if err != nil {
		t.Fatalf("Unwatch failed: %v", err)
	}

	err = mgr.Unwatch("nonexistent", "TestProc")
	if err == nil {
		t.Error("expected error for non-existent server")
	}
}

func TestManagerGetLastData(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.AddServer(config.ServerConfig{ID: "s1", URL: server.URL, Name: "Server1"})

	// GetLastData returns nil when no data is cached
	data := mgr.GetLastData("s1", "TestProc")
	if data != nil {
		t.Error("expected nil for uncached data")
	}

	// GetLastData for non-existent server returns nil
	data = mgr.GetLastData("nonexistent", "TestProc")
	if data != nil {
		t.Error("expected nil for non-existent server")
	}
}

func TestManagerGetIONCPoller(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.AddServer(config.ServerConfig{ID: "s1", URL: server.URL, Name: "Server1"})

	poller, exists := mgr.GetIONCPoller("s1")
	if !exists {
		t.Error("expected IONC poller to exist")
	}
	if poller == nil {
		t.Error("expected non-nil IONC poller")
	}

	_, exists = mgr.GetIONCPoller("nonexistent")
	if exists {
		t.Error("expected exists=false for non-existent server")
	}
}

func TestManagerGetClient(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.AddServer(config.ServerConfig{ID: "s1", URL: server.URL, Name: "Server1"})

	client, exists := mgr.GetClient("s1")
	if !exists {
		t.Error("expected client to exist")
	}
	if client == nil {
		t.Error("expected non-nil client")
	}

	_, exists = mgr.GetClient("nonexistent")
	if exists {
		t.Error("expected exists=false for non-existent server")
	}
}

func TestManagerGetFirstServer(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	// No servers
	_, exists := mgr.GetFirstServer()
	if exists {
		t.Error("expected exists=false when no servers")
	}

	// Add a server
	mgr.AddServer(config.ServerConfig{ID: "s1", URL: server.URL, Name: "Server1"})

	instance, exists := mgr.GetFirstServer()
	if !exists {
		t.Error("expected exists=true after adding server")
	}
	if instance == nil {
		t.Error("expected non-nil instance")
	}
}

func TestManagerShutdown(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, 100*time.Millisecond, time.Hour, "")

	mgr.AddServer(config.ServerConfig{ID: "s1", URL: server.URL, Name: "Server1"})
	mgr.AddServer(config.ServerConfig{ID: "s2", URL: server.URL, Name: "Server2"})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := mgr.Shutdown(ctx)
	if err != nil {
		t.Fatalf("Shutdown failed: %v", err)
	}

	if mgr.ServerCount() != 0 {
		t.Errorf("expected 0 servers after shutdown, got %d", mgr.ServerCount())
	}
}

func TestManagerShutdownTimeout(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, time.Second, time.Hour, "")

	mgr.AddServer(config.ServerConfig{ID: "s1", URL: server.URL, Name: "Server1"})

	// Very short timeout
	ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()

	// This might timeout or complete depending on timing
	_ = mgr.Shutdown(ctx)
}

func TestManagerCallbacksPassedToInstance(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	store := storage.NewMemoryStorage()
	mgr := NewManager(store, 50*time.Millisecond, time.Hour, "")

	var mu sync.Mutex
	var statusCalled bool

	// Set callbacks before adding server
	mgr.SetStatusCallback(func(serverID, serverName string, connected bool, lastError string) {
		mu.Lock()
		statusCalled = true
		mu.Unlock()
	})

	// Add server - callbacks should be passed to instance
	mgr.AddServer(config.ServerConfig{ID: "s1", URL: server.URL, Name: "Server1"})

	// Wait for health check to run
	time.Sleep(100 * time.Millisecond)

	// Shutdown to stop goroutines
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	mgr.Shutdown(ctx)

	mu.Lock()
	called := statusCalled
	mu.Unlock()

	if !called {
		t.Error("status callback was not called - callback may not have been passed to instance")
	}
}
