package uwsgate

import (
	"log/slog"
	"os"
	"testing"
)

func TestNewPoller(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)
	if p == nil {
		t.Fatal("NewPoller returned nil")
	}
	if p.client == nil {
		t.Error("client should not be nil")
	}
	if p.subscriptions == nil {
		t.Error("subscriptions should not be nil")
	}
	if p.lastValues == nil {
		t.Error("lastValues should not be nil")
	}
	if p.currentValues == nil {
		t.Error("currentValues should not be nil")
	}
}

func TestNewPollerWithLogger(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	p := NewPoller("http://localhost:8080", nil, logger)
	if p == nil {
		t.Fatal("NewPoller returned nil")
	}
}

func TestNewPollerWithCallback(t *testing.T) {
	callbackInvoked := false
	callback := func(updates []SensorUpdate) {
		callbackInvoked = true
	}

	p := NewPoller("http://localhost:8080", callback, nil)
	if p == nil {
		t.Fatal("NewPoller returned nil")
	}
	if p.callback == nil {
		t.Error("callback should be set")
	}

	// Callback should not be invoked yet
	if callbackInvoked {
		t.Error("callback should not be invoked at creation")
	}
}

func TestPollerSubscriptionManagement(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	// Subscribe (will fail to send but subscription tracking should work)
	_ = p.Subscribe("Object1", []string{"Sensor1", "Sensor2"})

	// Check subscriptions
	subs := p.GetSubscriptions("Object1")
	if len(subs) != 2 {
		t.Errorf("GetSubscriptions(Object1) length = %d, want 2", len(subs))
	}

	// Check non-existent object
	subs = p.GetSubscriptions("NonExistent")
	if len(subs) != 0 {
		t.Errorf("GetSubscriptions(NonExistent) length = %d, want 0", len(subs))
	}
}

func TestPollerSubscribeEmpty(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	err := p.Subscribe("Object1", []string{})
	if err != nil {
		t.Errorf("Subscribe with empty list should return nil, got %v", err)
	}
}

func TestPollerSubscribeDuplicates(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	_ = p.Subscribe("Object1", []string{"Sensor1", "Sensor2"})
	_ = p.Subscribe("Object1", []string{"Sensor2", "Sensor3"})

	subs := p.GetSubscriptions("Object1")
	if len(subs) != 3 {
		t.Errorf("GetSubscriptions length = %d, want 3 (unique sensors)", len(subs))
	}
}

func TestPollerUnsubscribeEmpty(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	err := p.Unsubscribe("Object1", []string{})
	if err != nil {
		t.Errorf("Unsubscribe with empty list should return nil, got %v", err)
	}
}

func TestPollerUnsubscribeNonExistent(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	err := p.Unsubscribe("NonExistent", []string{"Sensor1"})
	if err != nil {
		t.Errorf("Unsubscribe from non-existent object should return nil, got %v", err)
	}
}

func TestPollerUnsubscribe(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	// Subscribe first
	_ = p.Subscribe("Object1", []string{"Sensor1", "Sensor2", "Sensor3"})

	// Unsubscribe one sensor
	_ = p.Unsubscribe("Object1", []string{"Sensor2"})

	subs := p.GetSubscriptions("Object1")
	if len(subs) != 2 {
		t.Errorf("GetSubscriptions length = %d, want 2 after unsubscribe", len(subs))
	}

	// Verify Sensor2 is gone
	for _, s := range subs {
		if s == "Sensor2" {
			t.Error("Sensor2 should have been removed")
		}
	}
}

func TestPollerUnsubscribeAll(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	// Subscribe first
	_ = p.Subscribe("Object1", []string{"Sensor1", "Sensor2", "Sensor3"})

	// Unsubscribe all
	_ = p.UnsubscribeAll("Object1")

	subs := p.GetSubscriptions("Object1")
	if len(subs) != 0 {
		t.Errorf("GetSubscriptions length = %d, want 0 after UnsubscribeAll", len(subs))
	}
}

func TestPollerUnsubscribeAllNonExistent(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	err := p.UnsubscribeAll("NonExistent")
	if err != nil {
		t.Errorf("UnsubscribeAll for non-existent object should return nil, got %v", err)
	}
}

func TestPollerGetAllSubscriptions(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	_ = p.Subscribe("Object1", []string{"Sensor1", "Sensor2"})
	_ = p.Subscribe("Object2", []string{"Sensor3"})

	all := p.GetAllSubscriptions()
	if len(all) != 2 {
		t.Errorf("GetAllSubscriptions length = %d, want 2", len(all))
	}
	if len(all["Object1"]) != 2 {
		t.Errorf("GetAllSubscriptions[Object1] length = %d, want 2", len(all["Object1"]))
	}
	if len(all["Object2"]) != 1 {
		t.Errorf("GetAllSubscriptions[Object2] length = %d, want 1", len(all["Object2"]))
	}
}

func TestPollerGetCurrentValue(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	// Initially no values
	_, exists := p.GetCurrentValue("Sensor1")
	if exists {
		t.Error("should not have current value for unsubscribed sensor")
	}

	// Simulate receiving data
	p.mu.Lock()
	p.currentValues["Sensor1"] = SensorData{Name: "Sensor1", Value: 42}
	p.mu.Unlock()

	data, exists := p.GetCurrentValue("Sensor1")
	if !exists {
		t.Error("should have current value after setting")
	}
	if data.Value != 42 {
		t.Errorf("Value = %d, want 42", data.Value)
	}
}

func TestPollerGetSensorsForObject(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	// Subscribe sensors
	_ = p.Subscribe("Object1", []string{"Sensor1", "Sensor2"})

	// No current values yet
	sensors := p.GetSensorsForObject("Object1")
	if len(sensors) != 0 {
		t.Errorf("GetSensorsForObject length = %d, want 0 (no values yet)", len(sensors))
	}

	// Add some current values
	p.mu.Lock()
	p.currentValues["Sensor1"] = SensorData{Name: "Sensor1", Value: 10}
	p.currentValues["Sensor2"] = SensorData{Name: "Sensor2", Value: 20}
	p.mu.Unlock()

	sensors = p.GetSensorsForObject("Object1")
	if len(sensors) != 2 {
		t.Errorf("GetSensorsForObject length = %d, want 2", len(sensors))
	}
}

func TestPollerGetSensorsForNonExistentObject(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	sensors := p.GetSensorsForObject("NonExistent")
	if len(sensors) != 0 {
		t.Errorf("GetSensorsForObject length = %d, want 0", len(sensors))
	}
}

func TestPollerHandleData(t *testing.T) {
	received := make([]SensorUpdate, 0)
	callback := func(updates []SensorUpdate) {
		received = append(received, updates...)
	}

	p := NewPoller("http://localhost:8080", callback, nil)

	// Subscribe to sensors
	_ = p.Subscribe("Object1", []string{"Sensor1", "Sensor2"})

	// Simulate receiving data
	data := []SensorData{
		{Name: "Sensor1", Value: 100, Error: nil},
		{Name: "Sensor2", Value: 200, Error: nil},
	}
	p.handleData(data)

	// Check callback was called
	if len(received) != 2 {
		t.Errorf("callback received %d updates, want 2", len(received))
	}

	// Check current values updated
	v1, _ := p.GetCurrentValue("Sensor1")
	if v1.Value != 100 {
		t.Errorf("Sensor1 value = %d, want 100", v1.Value)
	}
	v2, _ := p.GetCurrentValue("Sensor2")
	if v2.Value != 200 {
		t.Errorf("Sensor2 value = %d, want 200", v2.Value)
	}
}

func TestPollerHandleDataChangeDetection(t *testing.T) {
	callCount := 0
	callback := func(updates []SensorUpdate) {
		callCount += len(updates)
	}

	p := NewPoller("http://localhost:8080", callback, nil)
	_ = p.Subscribe("Object1", []string{"Sensor1"})

	// First update
	p.handleData([]SensorData{{Name: "Sensor1", Value: 100}})
	if callCount != 1 {
		t.Errorf("callCount = %d, want 1 after first update", callCount)
	}

	// Same value - should not trigger callback
	p.handleData([]SensorData{{Name: "Sensor1", Value: 100}})
	if callCount != 1 {
		t.Errorf("callCount = %d, want 1 (same value, no change)", callCount)
	}

	// Different value - should trigger callback
	p.handleData([]SensorData{{Name: "Sensor1", Value: 200}})
	if callCount != 2 {
		t.Errorf("callCount = %d, want 2 after value change", callCount)
	}
}

func TestPollerHandleDataEmpty(t *testing.T) {
	callCount := 0
	callback := func(updates []SensorUpdate) {
		callCount++
	}

	p := NewPoller("http://localhost:8080", callback, nil)

	// Empty data should not call callback
	p.handleData([]SensorData{})
	if callCount != 0 {
		t.Errorf("callCount = %d, want 0 for empty data", callCount)
	}
}

func TestPollerHandleDataUnsubscribedSensor(t *testing.T) {
	callCount := 0
	callback := func(updates []SensorUpdate) {
		callCount += len(updates)
	}

	p := NewPoller("http://localhost:8080", callback, nil)
	// No subscriptions

	// Data for unsubscribed sensor should update currentValues but not trigger callback
	p.handleData([]SensorData{{Name: "Sensor1", Value: 100}})
	if callCount != 0 {
		t.Errorf("callCount = %d, want 0 (sensor not subscribed)", callCount)
	}

	// Value should still be stored
	v, exists := p.GetCurrentValue("Sensor1")
	if !exists {
		t.Error("currentValue should exist even for unsubscribed sensor")
	}
	if v.Value != 100 {
		t.Errorf("Value = %d, want 100", v.Value)
	}
}

func TestPollerSetServerID(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	p.SetServerID("server123")

	p.mu.RLock()
	if p.serverID != "server123" {
		t.Errorf("serverID = %q, want %q", p.serverID, "server123")
	}
	p.mu.RUnlock()
}

func TestPollerIsConnected(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	// Initially not connected
	if p.IsConnected() {
		t.Error("new poller should not be connected")
	}
}

func TestPollerGetClient(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	client := p.GetClient()
	if client == nil {
		t.Error("GetClient should not return nil")
	}
	if client.GetBaseURL() != "http://localhost:8080" {
		t.Errorf("client baseURL = %q, want %q", client.GetBaseURL(), "http://localhost:8080")
	}
}

func TestPollerStop(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	// Stop without starting should not panic
	p.Stop()

	if p.IsConnected() {
		t.Error("should not be connected after Stop")
	}
}

func TestPollerMultipleObjectsSameSensor(t *testing.T) {
	received := make([]SensorUpdate, 0)
	callback := func(updates []SensorUpdate) {
		received = append(received, updates...)
	}

	p := NewPoller("http://localhost:8080", callback, nil)

	// Two objects subscribe to the same sensor
	_ = p.Subscribe("Object1", []string{"SharedSensor"})
	_ = p.Subscribe("Object2", []string{"SharedSensor"})

	// Simulate data update
	p.handleData([]SensorData{{Name: "SharedSensor", Value: 50}})

	// Should receive updates for both objects
	if len(received) != 2 {
		t.Errorf("received %d updates, want 2 (one for each object)", len(received))
	}

	// Verify object names
	objectNames := make(map[string]bool)
	for _, u := range received {
		objectNames[u.ObjectName] = true
	}
	if !objectNames["Object1"] || !objectNames["Object2"] {
		t.Error("should have updates for both Object1 and Object2")
	}
}

func TestPollerUnsubscribeSharedSensor(t *testing.T) {
	p := NewPoller("http://localhost:8080", nil, nil)

	// Two objects subscribe to the same sensor
	_ = p.Subscribe("Object1", []string{"SharedSensor"})
	_ = p.Subscribe("Object2", []string{"SharedSensor"})

	// Unsubscribe Object1
	_ = p.Unsubscribe("Object1", []string{"SharedSensor"})

	// Object2 should still have the subscription
	subs := p.GetSubscriptions("Object2")
	if len(subs) != 1 || subs[0] != "SharedSensor" {
		t.Error("Object2 should still be subscribed to SharedSensor")
	}

	// Object1 should have no subscriptions
	subs = p.GetSubscriptions("Object1")
	if len(subs) != 0 {
		t.Errorf("Object1 should have 0 subscriptions, got %d", len(subs))
	}
}
