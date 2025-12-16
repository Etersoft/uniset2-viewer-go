package ionc

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/uniset"
)

func TestPoller_SubscribeUnsubscribe(t *testing.T) {
	client := uniset.NewClient("http://localhost:9999")
	poller := NewPoller(client, time.Second, 0, nil)

	// Test Subscribe
	poller.Subscribe("Object1", []int64{100, 101})
	poller.Subscribe("Object2", []int64{200})

	subs := poller.GetSubscriptions("Object1")
	if len(subs) != 2 {
		t.Errorf("expected 2 subscriptions for Object1, got %d", len(subs))
	}

	subs = poller.GetSubscriptions("Object2")
	if len(subs) != 1 {
		t.Errorf("expected 1 subscription for Object2, got %d", len(subs))
	}

	// Test Unsubscribe
	poller.Unsubscribe("Object1", []int64{100})
	subs = poller.GetSubscriptions("Object1")
	if len(subs) != 1 {
		t.Errorf("expected 1 subscription after unsubscribe, got %d", len(subs))
	}

	// Unsubscribe last sensor should remove object entry
	poller.Unsubscribe("Object1", []int64{101})
	subs = poller.GetSubscriptions("Object1")
	if subs != nil {
		t.Errorf("expected nil subscriptions after removing all, got %v", subs)
	}
}

func TestPoller_UnsubscribeAll(t *testing.T) {
	client := uniset.NewClient("http://localhost:9999")
	poller := NewPoller(client, time.Second, 0, nil)

	poller.Subscribe("Object1", []int64{100, 101, 102})

	poller.UnsubscribeAll("Object1")

	subs := poller.GetSubscriptions("Object1")
	if subs != nil {
		t.Errorf("expected nil subscriptions after UnsubscribeAll, got %v", subs)
	}
}

func TestPoller_GetAllSubscriptions(t *testing.T) {
	client := uniset.NewClient("http://localhost:9999")
	poller := NewPoller(client, time.Second, 0, nil)

	poller.Subscribe("Object1", []int64{100, 101})
	poller.Subscribe("Object2", []int64{200})

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

func TestPoller_SubscriptionCount(t *testing.T) {
	client := uniset.NewClient("http://localhost:9999")
	poller := NewPoller(client, time.Second, 0, nil)

	if poller.SubscriptionCount() != 0 {
		t.Errorf("expected 0 subscriptions initially, got %d", poller.SubscriptionCount())
	}

	poller.Subscribe("Object1", []int64{100, 101})
	poller.Subscribe("Object2", []int64{200})

	if poller.SubscriptionCount() != 3 {
		t.Errorf("expected 3 total subscriptions, got %d", poller.SubscriptionCount())
	}
}

func TestPoller_Poll(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)

		response := uniset.IONCSensorsResponse{
			Sensors: []uniset.IONCSensor{
				{ID: 100, Name: "AI100_AS", Value: 42, Type: "AI"},
				{ID: 101, Name: "AI101_AS", Value: 100, Type: "AI"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := uniset.NewClient(server.URL)

	var mu sync.Mutex
	var updates []SensorUpdate

	callback := func(batch []SensorUpdate) {
		mu.Lock()
		updates = append(updates, batch...)
		mu.Unlock()
	}

	poller := NewPoller(client, 50*time.Millisecond, 0, callback)

	// Subscribe to sensors
	poller.Subscribe("SharedMemory", []int64{100, 101})

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
		t.Error("expected at least one request to IONC API")
	}
}

func TestPoller_NoSubscriptions(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := uniset.NewClient(server.URL)
	poller := NewPoller(client, 50*time.Millisecond, 0, nil)

	// Start polling without subscriptions
	poller.Start()
	time.Sleep(100 * time.Millisecond)
	poller.Stop()

	// Should not make any requests when no subscriptions
	if atomic.LoadInt32(&requestCount) != 0 {
		t.Errorf("expected 0 requests without subscriptions, got %d", requestCount)
	}
}

func TestPoller_OnlyChangedValuesEmitted(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)

		// Always return the same value
		response := uniset.IONCSensorsResponse{
			Sensors: []uniset.IONCSensor{
				{ID: 100, Name: "AI100_AS", Value: 42, Type: "AI"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := uniset.NewClient(server.URL)

	var mu sync.Mutex
	var updates []SensorUpdate

	callback := func(batch []SensorUpdate) {
		mu.Lock()
		updates = append(updates, batch...)
		mu.Unlock()
	}

	poller := NewPoller(client, 30*time.Millisecond, 0, callback)

	poller.Subscribe("SharedMemory", []int64{100})

	poller.Start()
	time.Sleep(150 * time.Millisecond) // Wait for multiple poll cycles
	poller.Stop()

	mu.Lock()
	numUpdates := len(updates)
	mu.Unlock()

	requests := atomic.LoadInt32(&requestCount)

	// Should have made multiple requests
	if requests < 2 {
		t.Errorf("expected at least 2 requests, got %d", requests)
	}

	// But only 1 update (first time value seen)
	if numUpdates != 1 {
		t.Errorf("expected 1 update (only changed values), got %d", numUpdates)
	}
}

func TestPoller_StartStop(t *testing.T) {
	client := uniset.NewClient("http://localhost:9999")
	poller := NewPoller(client, time.Second, 0, nil)

	// Should not panic on Start/Stop
	poller.Start()
	poller.Stop()
}

func TestSensorUpdate_Fields(t *testing.T) {
	update := SensorUpdate{
		ObjectName: "SharedMemory",
		Sensor: uniset.IONCSensor{
			ID:       100,
			Name:     "AI100_AS",
			Value:    42,
			Type:     "AI",
			Frozen:   false,
			Blocked:  false,
			ReadOnly: true,
		},
		Timestamp: time.Now(),
	}

	if update.ObjectName != "SharedMemory" {
		t.Errorf("expected ObjectName SharedMemory, got %s", update.ObjectName)
	}
	if update.Sensor.Name != "AI100_AS" {
		t.Errorf("expected sensor name AI100_AS, got %s", update.Sensor.Name)
	}
	if update.Sensor.Value != 42 {
		t.Errorf("expected sensor value 42, got %d", update.Sensor.Value)
	}
	if update.Sensor.Type != "AI" {
		t.Errorf("expected sensor type AI, got %s", update.Sensor.Type)
	}
}

func extractObjectFromPath(path string) string {
	trimmed := strings.TrimPrefix(path, "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) >= 3 && parts[0] == "api" {
		// parts[1] is version (v2), parts[2] is object name
		return parts[2]
	}
	return ""
}

func TestPoller_MultipleObjects(t *testing.T) {
	requestsByObject := make(map[string]int)
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		obj := extractObjectFromPath(r.URL.Path)
		if obj != "" {
			mu.Lock()
			requestsByObject[obj]++
			mu.Unlock()
		}

		response := uniset.IONCSensorsResponse{
			Sensors: []uniset.IONCSensor{
				{ID: 100, Name: "AI100_AS", Value: 42, Type: "AI"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := uniset.NewClient(server.URL)

	var updates []SensorUpdate
	var updatesMu sync.Mutex

	callback := func(batch []SensorUpdate) {
		updatesMu.Lock()
		updates = append(updates, batch...)
		updatesMu.Unlock()
	}

	poller := NewPoller(client, 50*time.Millisecond, 0, callback)

	// Subscribe to multiple objects
	poller.Subscribe("Object1", []int64{100})
	poller.Subscribe("Object2", []int64{200})

	poller.Start()
	time.Sleep(100 * time.Millisecond)
	poller.Stop()

	// Should have updates
	updatesMu.Lock()
	numUpdates := len(updates)
	updatesMu.Unlock()

	if numUpdates == 0 {
		t.Error("expected some updates, got 0")
	}
}
