package opcua

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

		// Новый формат: /get?filter= возвращает массив sensors
		response := uniset.OPCUASensorsResponse{
			Result: "OK",
			Sensors: []map[string]interface{}{
				{
					"id":     float64(100),
					"name":   "AI100",
					"iotype": "AI",
					"value":  float64(42),
					"tick":   float64(12345),
				},
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
	poller.Subscribe("OPCUAExchange", []int64{100})

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
		t.Error("expected at least one request to OPCUA API")
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

		// Always return the same value and tick
		response := uniset.OPCUASensorsResponse{
			Result: "OK",
			Sensors: []map[string]interface{}{
				{
					"id":     float64(100),
					"name":   "AI100",
					"iotype": "AI",
					"value":  float64(42),
					"tick":   float64(12345),
				},
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

	poller.Subscribe("OPCUAExchange", []int64{100})

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
		ObjectName: "OPCUAExchange",
		Sensor: OPCUASensor{
			ID:     100,
			Name:   "AI100",
			IOType: "AI",
			Value:  float64(42),
			Tick:   12345,
		},
		Timestamp: time.Now(),
	}

	if update.ObjectName != "OPCUAExchange" {
		t.Errorf("expected ObjectName OPCUAExchange, got %s", update.ObjectName)
	}
	if update.Sensor.Name != "AI100" {
		t.Errorf("expected sensor name AI100, got %s", update.Sensor.Name)
	}
	if update.Sensor.Value != float64(42) {
		t.Errorf("expected sensor value 42, got %v", update.Sensor.Value)
	}
	if update.Sensor.IOType != "AI" {
		t.Errorf("expected sensor type AI, got %s", update.Sensor.IOType)
	}
}

func TestPoller_DuplicateSubscriptions(t *testing.T) {
	client := uniset.NewClient("http://localhost:9999")
	poller := NewPoller(client, time.Second, 0, nil)

	// Subscribe same sensor multiple times
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

func TestFormatValueHash(t *testing.T) {
	tests := []struct {
		value    interface{}
		tick     int64
		expected string
	}{
		{float64(42), 12345, "42|12345"},
		{float64(3.14), 100, "3.140000|100"},
		{int64(42), 12345, "42|12345"},
		{"hello", 1, "hello|1"},
		{true, 0, "true|0"},
		{false, 0, "false|0"},
		{nil, 0, "nil|0"},
	}

	for _, tt := range tests {
		got := formatValueHash(tt.value, tt.tick)
		if got != tt.expected {
			t.Errorf("formatValueHash(%v, %d) = %s, want %s", tt.value, tt.tick, got, tt.expected)
		}
	}
}

func TestFormatInt64(t *testing.T) {
	tests := []struct {
		input    int64
		expected string
	}{
		{0, "0"},
		{1, "1"},
		{-1, "-1"},
		{123456789, "123456789"},
		{-987654321, "-987654321"},
	}

	for _, tt := range tests {
		got := formatInt64(tt.input)
		if got != tt.expected {
			t.Errorf("formatInt64(%d) = %s, want %s", tt.input, got, tt.expected)
		}
	}
}

func TestOPCUASensor_Fields(t *testing.T) {
	sensor := OPCUASensor{
		ID:     100,
		Name:   "TestSensor",
		IOType: "AI",
		Value:  float64(42.5),
		Tick:   12345,
		NodeID: "ns=2;i=100",
		Status: "Good",
	}

	if sensor.ID != 100 {
		t.Errorf("expected ID 100, got %d", sensor.ID)
	}
	if sensor.Name != "TestSensor" {
		t.Errorf("expected Name TestSensor, got %s", sensor.Name)
	}
	if sensor.IOType != "AI" {
		t.Errorf("expected IOType AI, got %s", sensor.IOType)
	}
	if sensor.Value != float64(42.5) {
		t.Errorf("expected Value 42.5, got %v", sensor.Value)
	}
	if sensor.Tick != 12345 {
		t.Errorf("expected Tick 12345, got %d", sensor.Tick)
	}
	if sensor.NodeID != "ns=2;i=100" {
		t.Errorf("expected NodeID ns=2;i=100, got %s", sensor.NodeID)
	}
	if sensor.Status != "Good" {
		t.Errorf("expected Status Good, got %s", sensor.Status)
	}
}
