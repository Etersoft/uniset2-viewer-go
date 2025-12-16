package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/config"
	"github.com/pv/uniset2-viewer-go/internal/storage"
)

// mockUnisetServer creates a test server simulating UniSet2 API
func mockUnisetServer() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		switch r.URL.Path {
		case "/api/v2/list":
			json.NewEncoder(w).Encode([]string{"TestProc", "AnotherObj"})
		case "/api/v2/TestProc":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"TestProc": map[string]interface{}{
					"Variables": map[string]interface{}{
						"var1": "100",
					},
				},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

// mockUnavailableServer creates a server that always returns errors
func mockUnavailableServer() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
}

func TestNewInstance(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()
	instance := NewInstance(cfg, store, time.Second, time.Hour, "TestSupplier", 0, nil, nil, nil, nil, nil, nil)

	if instance == nil {
		t.Fatal("NewInstance returned nil")
	}

	if instance.Config.ID != "test-server" {
		t.Errorf("expected ID=test-server, got %s", instance.Config.ID)
	}

	if instance.Client == nil {
		t.Error("Client is nil")
	}

	if instance.Poller == nil {
		t.Error("Poller is nil")
	}

	if instance.IONCPoller == nil {
		t.Error("IONCPoller is nil")
	}
}

func TestInstanceGetStatus(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()
	instance := NewInstance(cfg, store, time.Second, time.Hour, "", 0, nil, nil, nil, nil, nil, nil)

	status := instance.GetStatus()

	if status.ID != "test-server" {
		t.Errorf("expected ID=test-server, got %s", status.ID)
	}

	if status.Name != "Test Server" {
		t.Errorf("expected Name=Test Server, got %s", status.Name)
	}

	if status.URL != server.URL {
		t.Errorf("expected URL=%s, got %s", server.URL, status.URL)
	}

	if status.Connected {
		t.Error("expected Connected=false for new instance")
	}
}

func TestInstanceGetStatusWithEmptyName(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:  "test-server",
		URL: server.URL,
		// Name is empty
	}

	store := storage.NewMemoryStorage()
	instance := NewInstance(cfg, store, time.Second, time.Hour, "", 0, nil, nil, nil, nil, nil, nil)

	status := instance.GetStatus()

	// When name is empty, should use URL
	if status.Name != server.URL {
		t.Errorf("expected Name=%s (URL), got %s", server.URL, status.Name)
	}
}

func TestInstanceUpdateStatus(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()

	var statusCallbackCalled bool
	var callbackConnected bool
	var mu sync.Mutex

	statusCallback := func(serverID, serverName string, connected bool, lastError string) {
		mu.Lock()
		statusCallbackCalled = true
		callbackConnected = connected
		mu.Unlock()
	}

	instance := NewInstance(cfg, store, time.Second, time.Hour, "", 0, nil, nil, nil, nil, statusCallback, nil)

	// Update status to connected
	instance.UpdateStatus(true, nil)

	mu.Lock()
	if !statusCallbackCalled {
		t.Error("status callback was not called")
	}
	if !callbackConnected {
		t.Error("expected callback connected=true")
	}
	mu.Unlock()

	status := instance.GetStatus()
	if !status.Connected {
		t.Error("expected Connected=true after UpdateStatus")
	}

	if status.LastError != "" {
		t.Errorf("expected empty LastError, got %s", status.LastError)
	}
}

func TestInstanceUpdateStatusWithError(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()
	instance := NewInstance(cfg, store, time.Second, time.Hour, "", 0, nil, nil, nil, nil, nil, nil)

	// First set connected
	instance.UpdateStatus(true, nil)

	// Then update with error
	testErr := &testError{"connection failed"}
	instance.UpdateStatus(false, testErr)

	status := instance.GetStatus()
	if status.Connected {
		t.Error("expected Connected=false after error")
	}

	if status.LastError != "connection failed" {
		t.Errorf("expected LastError='connection failed', got %s", status.LastError)
	}
}

func TestInstanceSetHealthInterval(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()
	instance := NewInstance(cfg, store, time.Second, time.Hour, "", 0, nil, nil, nil, nil, nil, nil)

	// Change health interval
	instance.SetHealthInterval(5 * time.Second)

	// Verify interval was changed
	instance.mu.RLock()
	interval := instance.healthInterval
	instance.mu.RUnlock()

	if interval != 5*time.Second {
		t.Errorf("expected healthInterval=5s, got %v", interval)
	}
}

func TestInstanceSetObjectCount(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()
	instance := NewInstance(cfg, store, time.Second, time.Hour, "", 0, nil, nil, nil, nil, nil, nil)

	instance.SetObjectCount(42)

	status := instance.GetStatus()
	if status.ObjectCount != 42 {
		t.Errorf("expected ObjectCount=42, got %d", status.ObjectCount)
	}
}

func TestInstanceGetObjects(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()
	instance := NewInstance(cfg, store, time.Second, time.Hour, "", 0, nil, nil, nil, nil, nil, nil)

	objects, err := instance.GetObjects()
	if err != nil {
		t.Fatalf("GetObjects failed: %v", err)
	}

	if len(objects) != 2 {
		t.Errorf("expected 2 objects, got %d", len(objects))
	}

	// Check that status was updated to connected
	status := instance.GetStatus()
	if !status.Connected {
		t.Error("expected Connected=true after successful GetObjects")
	}

	if status.ObjectCount != 2 {
		t.Errorf("expected ObjectCount=2, got %d", status.ObjectCount)
	}
}

func TestInstanceGetObjectsError(t *testing.T) {
	server := mockUnavailableServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()
	instance := NewInstance(cfg, store, time.Second, time.Hour, "", 0, nil, nil, nil, nil, nil, nil)

	// First mark as connected
	instance.UpdateStatus(true, nil)

	_, err := instance.GetObjects()
	if err == nil {
		t.Fatal("expected error from unavailable server")
	}

	// Check that status was updated to disconnected
	status := instance.GetStatus()
	if status.Connected {
		t.Error("expected Connected=false after failed GetObjects")
	}
}

func TestInstanceGetObjectData(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()
	instance := NewInstance(cfg, store, time.Second, time.Hour, "", 0, nil, nil, nil, nil, nil, nil)

	data, err := instance.GetObjectData("TestProc")
	if err != nil {
		t.Fatalf("GetObjectData failed: %v", err)
	}

	if data == nil {
		t.Fatal("GetObjectData returned nil")
	}

	if data.Name != "TestProc" {
		t.Errorf("expected Name=TestProc, got %s", data.Name)
	}

	// Check that status was updated to connected
	status := instance.GetStatus()
	if !status.Connected {
		t.Error("expected Connected=true after successful GetObjectData")
	}
}

func TestInstanceWatchUnwatch(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()
	instance := NewInstance(cfg, store, time.Second, time.Hour, "", 0, nil, nil, nil, nil, nil, nil)

	// Watch should not panic
	instance.Watch("TestProc")

	// Unwatch should not panic
	instance.Unwatch("TestProc")
}

func TestInstanceStartStop(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()
	instance := NewInstance(cfg, store, 100*time.Millisecond, time.Hour, "", 0, nil, nil, nil, nil, nil, nil)

	// Start should not panic
	instance.Start()

	// Give health check time to run
	time.Sleep(150 * time.Millisecond)

	// Stop should not panic and should complete
	done := make(chan struct{})
	go func() {
		instance.Stop()
		close(done)
	}()

	select {
	case <-done:
		// OK
	case <-time.After(2 * time.Second):
		t.Error("Stop did not complete in time")
	}
}

func TestInstanceHealthCheckUpdatesStatus(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()

	var statusChanges []bool
	var mu sync.Mutex

	statusCallback := func(serverID, serverName string, connected bool, lastError string) {
		mu.Lock()
		statusChanges = append(statusChanges, connected)
		mu.Unlock()
	}

	instance := NewInstance(cfg, store, 50*time.Millisecond, time.Hour, "", 0, nil, nil, nil, nil, statusCallback, nil)

	// Start instance to run health check
	instance.Start()

	// Wait for health check to run and update status
	time.Sleep(100 * time.Millisecond)

	// Stop instance
	instance.Stop()

	mu.Lock()
	defer mu.Unlock()

	if len(statusChanges) == 0 {
		t.Error("status callback was not called during health check")
	}

	// First change should be to connected (server is available)
	if len(statusChanges) > 0 && !statusChanges[0] {
		t.Error("expected first status change to be connected=true")
	}
}

func TestInstanceObjectsCallbackOnReconnect(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()

	var objectsCallbackCalled bool
	var receivedObjects []string
	var mu sync.Mutex

	objectsCallback := func(serverID, serverName string, objects []string) {
		mu.Lock()
		objectsCallbackCalled = true
		receivedObjects = objects
		mu.Unlock()
	}

	instance := NewInstance(cfg, store, 50*time.Millisecond, time.Hour, "", 0, nil, nil, nil, nil, nil, objectsCallback)

	// Start instance - this triggers health check which should call objectsCallback on first connect
	instance.Start()

	// Wait for health check
	time.Sleep(100 * time.Millisecond)

	instance.Stop()

	mu.Lock()
	defer mu.Unlock()

	if !objectsCallbackCalled {
		t.Error("objects callback was not called on initial connect")
	}

	if len(receivedObjects) != 2 {
		t.Errorf("expected 2 objects in callback, got %d", len(receivedObjects))
	}
}

func TestInstanceStatusCallbackOnlyOnChange(t *testing.T) {
	server := mockUnisetServer()
	defer server.Close()

	cfg := config.ServerConfig{
		ID:   "test-server",
		URL:  server.URL,
		Name: "Test Server",
	}

	store := storage.NewMemoryStorage()

	var callCount int
	var mu sync.Mutex

	statusCallback := func(serverID, serverName string, connected bool, lastError string) {
		mu.Lock()
		callCount++
		mu.Unlock()
	}

	instance := NewInstance(cfg, store, time.Second, time.Hour, "", 0, nil, nil, nil, nil, statusCallback, nil)

	// Update status multiple times with same value
	instance.UpdateStatus(true, nil)
	instance.UpdateStatus(true, nil) // Should not trigger callback
	instance.UpdateStatus(true, nil) // Should not trigger callback

	mu.Lock()
	count := callCount
	mu.Unlock()

	if count != 1 {
		t.Errorf("expected status callback to be called 1 time, got %d", count)
	}

	// Now change status
	instance.UpdateStatus(false, nil)

	mu.Lock()
	count = callCount
	mu.Unlock()

	if count != 2 {
		t.Errorf("expected status callback to be called 2 times after status change, got %d", count)
	}
}

// testError implements error interface for testing
type testError struct {
	msg string
}

func (e *testError) Error() string {
	return e.msg
}
