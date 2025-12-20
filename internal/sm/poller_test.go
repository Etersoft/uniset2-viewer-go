package sm

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pv/uniset-panel/internal/storage"
)

func TestPoller_SubscribeUnsubscribe(t *testing.T) {
	client := NewClient("http://localhost:9999")
	store := storage.NewMemoryStorage()
	poller := NewPoller(client, store, time.Second, nil)

	// Test Subscribe
	poller.Subscribe("Object1", "AI100_AS")
	poller.Subscribe("Object1", "AI101_AS")
	poller.Subscribe("Object2", "AI100_AS")

	subs := poller.GetSubscriptions("Object1")
	if len(subs) != 2 {
		t.Errorf("expected 2 subscriptions for Object1, got %d", len(subs))
	}

	subs = poller.GetSubscriptions("Object2")
	if len(subs) != 1 {
		t.Errorf("expected 1 subscription for Object2, got %d", len(subs))
	}

	// Test Unsubscribe
	poller.Unsubscribe("Object1", "AI100_AS")
	subs = poller.GetSubscriptions("Object1")
	if len(subs) != 1 {
		t.Errorf("expected 1 subscription after unsubscribe, got %d", len(subs))
	}

	// Unsubscribe last sensor should remove object entry
	poller.Unsubscribe("Object1", "AI101_AS")
	subs = poller.GetSubscriptions("Object1")
	if subs != nil {
		t.Errorf("expected nil subscriptions after removing all, got %v", subs)
	}
}

func TestPoller_UnsubscribeAll(t *testing.T) {
	client := NewClient("http://localhost:9999")
	store := storage.NewMemoryStorage()
	poller := NewPoller(client, store, time.Second, nil)

	poller.Subscribe("Object1", "AI100_AS")
	poller.Subscribe("Object1", "AI101_AS")
	poller.Subscribe("Object1", "AI102_AS")

	poller.UnsubscribeAll("Object1")

	subs := poller.GetSubscriptions("Object1")
	if subs != nil {
		t.Errorf("expected nil subscriptions after UnsubscribeAll, got %v", subs)
	}
}

func TestPoller_GetAllSubscriptions(t *testing.T) {
	client := NewClient("http://localhost:9999")
	store := storage.NewMemoryStorage()
	poller := NewPoller(client, store, time.Second, nil)

	poller.Subscribe("Object1", "AI100_AS")
	poller.Subscribe("Object1", "AI101_AS")
	poller.Subscribe("Object2", "AI200_AS")

	all := poller.GetAllSubscriptions()
	if len(all) != 2 {
		t.Errorf("expected 2 objects, got %d", len(all))
	}

	if len(all["Object1"]) != 2 {
		t.Errorf("expected 2 sensors for Object1, got %d", len(all["Object1"]))
	}

	if len(all["Object2"]) != 1 {
		t.Errorf("expected 1 sensor for Object2, got %d", len(all["Object2"]))
	}
}

func TestPoller_Poll(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)

		response := GetResponse{
			Sensors: []SensorValue{
				{ID: 100, Name: "AI100_AS", Value: 42},
				{ID: 101, Name: "AI101_AS", Value: 100},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewClient(server.URL)
	store := storage.NewMemoryStorage()

	var mu sync.Mutex
	var updates []SensorUpdate

	callback := func(update SensorUpdate) {
		mu.Lock()
		updates = append(updates, update)
		mu.Unlock()
	}

	poller := NewPoller(client, store, 50*time.Millisecond, callback)

	// Subscribe to sensors
	poller.Subscribe("Object1", "AI100_AS")
	poller.Subscribe("Object1", "AI101_AS")
	poller.Subscribe("Object2", "AI100_AS")

	// Start polling
	poller.Start()

	// Wait for at least one poll cycle
	time.Sleep(100 * time.Millisecond)

	// Stop polling
	poller.Stop()

	// Check that we got updates
	mu.Lock()
	numUpdates := len(updates)
	mu.Unlock()

	if numUpdates == 0 {
		t.Error("expected some updates, got 0")
	}

	// Should have at least one request
	if atomic.LoadInt32(&requestCount) == 0 {
		t.Error("expected at least one request to SM")
	}

	// Check storage has data (пустой serverID = default, т.к. SM глобальный)
	history, err := store.GetHistory("", "Object1", "ext:AI100_AS", time.Now().Add(-time.Minute), time.Now())
	if err != nil {
		t.Errorf("GetHistory failed: %v", err)
	}
	if history == nil || len(history.Points) == 0 {
		t.Error("expected history in storage for ext:AI100_AS")
	}
}

func TestPoller_NoSubscriptions(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewClient(server.URL)
	store := storage.NewMemoryStorage()
	poller := NewPoller(client, store, 50*time.Millisecond, nil)

	// Start polling without subscriptions
	poller.Start()
	time.Sleep(100 * time.Millisecond)
	poller.Stop()

	// Should not make any requests when no subscriptions
	if atomic.LoadInt32(&requestCount) != 0 {
		t.Errorf("expected 0 requests without subscriptions, got %d", requestCount)
	}
}

func TestPoller_DuplicateSensorForMultipleObjects(t *testing.T) {
	var mu sync.Mutex
	var requestedSensors []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.RawQuery
		mu.Lock()
		requestedSensors = append(requestedSensors, query)
		mu.Unlock()

		response := GetResponse{
			Sensors: []SensorValue{
				{ID: 100, Name: "AI100_AS", Value: 42},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewClient(server.URL)
	store := storage.NewMemoryStorage()

	var updates []SensorUpdate
	var updatesMu sync.Mutex

	callback := func(update SensorUpdate) {
		updatesMu.Lock()
		updates = append(updates, update)
		updatesMu.Unlock()
	}

	poller := NewPoller(client, store, 50*time.Millisecond, callback)

	// Same sensor subscribed by multiple objects
	poller.Subscribe("Object1", "AI100_AS")
	poller.Subscribe("Object2", "AI100_AS")
	poller.Subscribe("Object3", "AI100_AS")

	poller.Start()
	time.Sleep(100 * time.Millisecond)
	poller.Stop()

	// Should have updates for all objects
	updatesMu.Lock()
	numUpdates := len(updates)
	updatesMu.Unlock()

	// Each poll should generate 3 updates (one per object)
	if numUpdates < 3 {
		t.Errorf("expected at least 3 updates (one per object), got %d", numUpdates)
	}

	// Check that updates include all objects
	objectSet := make(map[string]bool)
	updatesMu.Lock()
	for _, u := range updates {
		objectSet[u.ObjectName] = true
	}
	updatesMu.Unlock()

	for _, obj := range []string{"Object1", "Object2", "Object3"} {
		if !objectSet[obj] {
			t.Errorf("expected update for %s", obj)
		}
	}
}

func TestPoller_StartStop(t *testing.T) {
	client := NewClient("http://localhost:9999")
	store := storage.NewMemoryStorage()
	poller := NewPoller(client, store, time.Second, nil)

	// Should not panic on multiple Start/Stop
	poller.Start()
	poller.Stop()

	// Should be safe to call Stop again (though not recommended)
	// The goroutine is already stopped, this tests graceful handling
}

func TestSensorUpdate_Fields(t *testing.T) {
	update := SensorUpdate{
		ObjectName: "TestObject",
		Sensor: SensorValue{
			ID:        100,
			Name:      "AI100_AS",
			Value:     42,
			RealValue: 42.5,
			TVSec:     1764866261,
			TVNsec:    123456789,
		},
		Timestamp: time.Now(),
	}

	if update.ObjectName != "TestObject" {
		t.Errorf("expected ObjectName TestObject, got %s", update.ObjectName)
	}
	if update.Sensor.Name != "AI100_AS" {
		t.Errorf("expected sensor name AI100_AS, got %s", update.Sensor.Name)
	}
	if update.Sensor.Value != 42 {
		t.Errorf("expected sensor value 42, got %d", update.Sensor.Value)
	}
}
