package uwsgate

import (
	"log/slog"
	"os"
	"testing"
)

func TestNewClient(t *testing.T) {
	tests := []struct {
		name        string
		baseURL     string
		expectedWS  string
	}{
		{
			name:        "http URL",
			baseURL:     "http://localhost:8080",
			expectedWS:  "ws://localhost:8080/wsgate/",
		},
		{
			name:        "https URL",
			baseURL:     "https://localhost:8080",
			expectedWS:  "wss://localhost:8080/wsgate/",
		},
		{
			name:        "http URL with trailing slash",
			baseURL:     "http://localhost:8080/",
			expectedWS:  "ws://localhost:8080/wsgate/",
		},
		{
			name:        "http URL with path",
			baseURL:     "http://localhost:8080/api",
			expectedWS:  "ws://localhost:8080/api/wsgate/",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewClient(tt.baseURL, nil)
			if client == nil {
				t.Fatal("NewClient returned nil")
			}
			if client.GetWSURL() != tt.expectedWS {
				t.Errorf("GetWSURL() = %q, want %q", client.GetWSURL(), tt.expectedWS)
			}
			if client.GetBaseURL() != tt.baseURL {
				t.Errorf("GetBaseURL() = %q, want %q", client.GetBaseURL(), tt.baseURL)
			}
		})
	}
}

func TestNewClientWithLogger(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	client := NewClient("http://localhost:8080", logger)
	if client == nil {
		t.Fatal("NewClient returned nil")
	}
}

func TestNewClientWithNilLogger(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)
	if client == nil {
		t.Fatal("NewClient returned nil")
	}
	if client.logger == nil {
		t.Error("logger should be set to default when nil passed")
	}
}

func TestClientInitialState(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)

	if client.IsConnected() {
		t.Error("new client should not be connected")
	}
	if client.conn != nil {
		t.Error("conn should be nil initially")
	}
	if len(client.pendingSubscriptions) != 0 {
		t.Error("pendingSubscriptions should be empty")
	}
}

func TestClientSetCallbacks(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)

	dataCalled := false
	disconnectCalled := false

	client.SetOnData(func(data []SensorData) {
		dataCalled = true
	})

	client.SetOnDisconnect(func(err error) {
		disconnectCalled = true
	})

	// Verify callbacks are set (we can't easily test they're called without a connection)
	if client.onData == nil {
		t.Error("onData callback should be set")
	}
	if client.onDisconnect == nil {
		t.Error("onDisconnect callback should be set")
	}

	// These should remain false since we didn't trigger them
	if dataCalled || disconnectCalled {
		t.Error("callbacks should not be called during set")
	}
}

func TestClientSubscribeWithoutConnection(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)

	// Subscribe without connection should add to pending but fail to send
	err := client.Subscribe([]string{"Sensor1", "Sensor2"})
	if err == nil {
		t.Error("Subscribe without connection should return error")
	}

	// Check pending subscriptions were added
	client.subMu.Lock()
	if len(client.pendingSubscriptions) != 2 {
		t.Errorf("pendingSubscriptions length = %d, want 2", len(client.pendingSubscriptions))
	}
	client.subMu.Unlock()
}

func TestClientSubscribeEmpty(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)

	// Subscribe with empty list should return nil
	err := client.Subscribe([]string{})
	if err != nil {
		t.Errorf("Subscribe([]) should return nil, got %v", err)
	}
}

func TestClientUnsubscribeEmpty(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)

	err := client.Unsubscribe([]string{})
	if err != nil {
		t.Errorf("Unsubscribe([]) should return nil, got %v", err)
	}
}

func TestClientGetEmpty(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)

	err := client.Get([]string{})
	if err != nil {
		t.Errorf("Get([]) should return nil, got %v", err)
	}
}

func TestClientSetEmpty(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)

	err := client.Set(map[string]int64{})
	if err != nil {
		t.Errorf("Set({}) should return nil, got %v", err)
	}
}

func TestClientSendCommandWithoutConnection(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)

	err := client.sendCommand("test:cmd")
	if err == nil {
		t.Error("sendCommand without connection should return error")
	}
	if err.Error() != "not connected" {
		t.Errorf("expected 'not connected' error, got %q", err.Error())
	}
}

func TestClientSubscribeDuplicates(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)

	// Subscribe multiple times with same sensors
	_ = client.Subscribe([]string{"Sensor1", "Sensor2"})
	_ = client.Subscribe([]string{"Sensor2", "Sensor3"})

	client.subMu.Lock()
	defer client.subMu.Unlock()

	// Should have 3 unique sensors, not 4
	if len(client.pendingSubscriptions) != 3 {
		t.Errorf("pendingSubscriptions length = %d, want 3", len(client.pendingSubscriptions))
	}
}

func TestClientUnsubscribeRemovesPending(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)

	// Subscribe first
	_ = client.Subscribe([]string{"Sensor1", "Sensor2", "Sensor3"})

	// Unsubscribe one (will fail to send but will update pending)
	_ = client.Unsubscribe([]string{"Sensor2"})

	client.subMu.Lock()
	defer client.subMu.Unlock()

	// Should have 2 sensors left
	if len(client.pendingSubscriptions) != 2 {
		t.Errorf("pendingSubscriptions length = %d, want 2", len(client.pendingSubscriptions))
	}

	// Check Sensor2 was removed
	for _, s := range client.pendingSubscriptions {
		if s == "Sensor2" {
			t.Error("Sensor2 should have been removed from pending")
		}
	}
}

func TestClientClose(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)

	// Close without connection should not panic
	err := client.Close()
	if err != nil {
		t.Errorf("Close() returned error: %v", err)
	}

	if client.IsConnected() {
		t.Error("client should not be connected after Close")
	}
}

func TestClientReconnectIntervals(t *testing.T) {
	client := NewClient("http://localhost:8080", nil)

	if client.reconnectInterval.Seconds() != 1 {
		t.Errorf("reconnectInterval = %v, want 1s", client.reconnectInterval)
	}
	if client.maxReconnectInterval.Seconds() != 30 {
		t.Errorf("maxReconnectInterval = %v, want 30s", client.maxReconnectInterval)
	}
	if client.currentReconnectInterval.Seconds() != 1 {
		t.Errorf("currentReconnectInterval = %v, want 1s", client.currentReconnectInterval)
	}
}
