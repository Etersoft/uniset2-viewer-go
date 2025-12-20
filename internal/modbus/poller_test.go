package modbus

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pv/uniset-panel/internal/uniset"
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

	// Unsubscribe last register should remove object entry
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
		t.Errorf("expected 2 registers for Object1, got %d", len(all["Object1"]))
	}

	if len(all["Object2"]) != 1 {
		t.Errorf("expected 1 register for Object2, got %d", len(all["Object2"]))
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

		response := uniset.MBRegistersResponse{
			Result: "OK",
			Registers: []map[string]interface{}{
				{"id": float64(100), "name": "AI100", "iotype": "AI", "value": float64(42)},
				{"id": float64(101), "name": "AI101", "iotype": "AI", "value": float64(100)},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := uniset.NewClient(server.URL)

	var mu sync.Mutex
	var updates []RegisterUpdate

	callback := func(batch []RegisterUpdate) {
		mu.Lock()
		updates = append(updates, batch...)
		mu.Unlock()
	}

	poller := NewPoller(client, 50*time.Millisecond, 0, callback)

	// Subscribe to registers
	poller.Subscribe("MBTCPMaster1", []int64{100, 101})

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
		t.Error("expected at least one request to Modbus API")
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
		response := uniset.MBRegistersResponse{
			Result: "OK",
			Registers: []map[string]interface{}{
				{"id": float64(100), "name": "AI100", "iotype": "AI", "value": float64(42)},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := uniset.NewClient(server.URL)

	var mu sync.Mutex
	var updates []RegisterUpdate

	callback := func(batch []RegisterUpdate) {
		mu.Lock()
		updates = append(updates, batch...)
		mu.Unlock()
	}

	poller := NewPoller(client, 30*time.Millisecond, 0, callback)

	poller.Subscribe("MBTCPMaster1", []int64{100})

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

func TestRegisterUpdate_Fields(t *testing.T) {
	update := RegisterUpdate{
		ObjectName: "MBTCPMaster1",
		Register: uniset.MBRegister{
			ID:     100,
			Name:   "AI100",
			IOType: "AI",
			Value:  42,
		},
		Timestamp: time.Now(),
	}

	if update.ObjectName != "MBTCPMaster1" {
		t.Errorf("expected ObjectName MBTCPMaster1, got %s", update.ObjectName)
	}
	if update.Register.Name != "AI100" {
		t.Errorf("expected register name AI100, got %s", update.Register.Name)
	}
	if update.Register.Value != 42 {
		t.Errorf("expected register value 42, got %d", update.Register.Value)
	}
	if update.Register.IOType != "AI" {
		t.Errorf("expected register type AI, got %s", update.Register.IOType)
	}
}

func TestPoller_MultipleObjects(t *testing.T) {
	var mu sync.Mutex
	requestsByObject := make(map[string]int)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requestsByObject[r.URL.Path]++
		mu.Unlock()

		response := uniset.MBRegistersResponse{
			Result: "OK",
			Registers: []map[string]interface{}{
				{"id": float64(100), "name": "AI100", "iotype": "AI", "value": float64(42)},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := uniset.NewClient(server.URL)

	var updates []RegisterUpdate
	var updatesMu sync.Mutex

	callback := func(batch []RegisterUpdate) {
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

func TestPoller_DuplicateSubscriptions(t *testing.T) {
	client := uniset.NewClient("http://localhost:9999")
	poller := NewPoller(client, time.Second, 0, nil)

	// Subscribe same register multiple times
	poller.Subscribe("Object1", []int64{100, 101})
	poller.Subscribe("Object1", []int64{100, 102}) // 100 is duplicate

	// Should still have 3 unique subscriptions
	subs := poller.GetSubscriptions("Object1")
	if len(subs) != 3 {
		t.Errorf("expected 3 unique subscriptions, got %d", len(subs))
	}
}

func TestPoller_ValueChangedAfterUnsubscribe(t *testing.T) {
	client := uniset.NewClient("http://localhost:9999")
	poller := NewPoller(client, time.Second, 0, nil)

	poller.Subscribe("Object1", []int64{100})
	poller.Unsubscribe("Object1", []int64{100})

	// Re-subscribe - should be treated as new subscription
	poller.Subscribe("Object1", []int64{100})

	// lastValues should have been cleared by unsubscribe
	subs := poller.GetSubscriptions("Object1")
	if len(subs) != 1 {
		t.Errorf("expected 1 subscription after re-subscribe, got %d", len(subs))
	}
}
