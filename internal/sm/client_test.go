package sm

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewClient(t *testing.T) {
	tests := []struct {
		name     string
		baseURL  string
		expected string
	}{
		{"without trailing slash", "http://localhost:9191", "http://localhost:9191"},
		{"with trailing slash", "http://localhost:9191/", "http://localhost:9191"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewClient(tt.baseURL)
			if client.baseURL != tt.expected {
				t.Errorf("expected baseURL %q, got %q", tt.expected, client.baseURL)
			}
		})
	}
}

func TestGetValues(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check URL path
		if r.URL.Path != "/api/v01/SharedMemory/get" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		// Parse query string to get sensors
		query := r.URL.RawQuery
		if query == "" {
			t.Error("expected query string with sensors")
		}

		response := GetResponse{
			Sensors: []SensorValue{
				{ID: 100, Name: "AI100_AS", Value: 42, RealValue: 42.0, TVSec: 1764866261},
				{ID: 101, Name: "AI101_AS", Value: 100, RealValue: 100.0, TVSec: 1764866261},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewClient(server.URL)

	values, err := client.GetValues([]string{"AI100_AS", "AI101_AS"})
	if err != nil {
		t.Fatalf("GetValues failed: %v", err)
	}

	if len(values) != 2 {
		t.Errorf("expected 2 values, got %d", len(values))
	}

	if v, ok := values["AI100_AS"]; !ok {
		t.Error("AI100_AS not found in response")
	} else if v.Value != 42 {
		t.Errorf("expected value 42, got %d", v.Value)
	}

	if v, ok := values["AI101_AS"]; !ok {
		t.Error("AI101_AS not found in response")
	} else if v.Value != 100 {
		t.Errorf("expected value 100, got %d", v.Value)
	}
}

func TestGetValues_Empty(t *testing.T) {
	client := NewClient("http://localhost:9999")

	values, err := client.GetValues([]string{})
	if err != nil {
		t.Fatalf("GetValues with empty list failed: %v", err)
	}

	if len(values) != 0 {
		t.Errorf("expected 0 values, got %d", len(values))
	}
}

func TestGetValues_WithError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := GetResponse{
			Sensors: []SensorValue{
				{ID: 100, Name: "AI100_AS", Value: 42},
				{Name: "unknown_sensor", Error: "not found"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewClient(server.URL)

	values, err := client.GetValues([]string{"AI100_AS", "unknown_sensor"})
	if err != nil {
		t.Fatalf("GetValues failed: %v", err)
	}

	// Should only return sensors without errors
	if len(values) != 1 {
		t.Errorf("expected 1 value (sensor with error excluded), got %d", len(values))
	}

	if _, ok := values["unknown_sensor"]; ok {
		t.Error("unknown_sensor should be excluded from results")
	}
}

func TestGetValues_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("Internal Server Error"))
	}))
	defer server.Close()

	client := NewClient(server.URL)

	_, err := client.GetValues([]string{"AI100_AS"})
	if err == nil {
		t.Error("expected error for server error response")
	}
}

func TestGetValues_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	client := NewClient(server.URL)

	_, err := client.GetValues([]string{"AI100_AS"})
	if err == nil {
		t.Error("expected error for invalid JSON response")
	}
}

func TestGetValues_NetworkError(t *testing.T) {
	// Use a URL that won't connect
	client := NewClient("http://localhost:99999")

	_, err := client.GetValues([]string{"AI100_AS"})
	if err == nil {
		t.Error("expected error for network failure")
	}
}

func TestGetValue(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := GetResponse{
			Sensors: []SensorValue{
				{ID: 100, Name: "AI100_AS", Value: 42, RealValue: 42.5},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewClient(server.URL)

	value, err := client.GetValue("AI100_AS")
	if err != nil {
		t.Fatalf("GetValue failed: %v", err)
	}

	if value.Name != "AI100_AS" {
		t.Errorf("expected name AI100_AS, got %s", value.Name)
	}
	if value.Value != 42 {
		t.Errorf("expected value 42, got %d", value.Value)
	}
	if value.RealValue != 42.5 {
		t.Errorf("expected real_value 42.5, got %f", value.RealValue)
	}
}

func TestGetValue_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := GetResponse{
			Sensors: []SensorValue{
				{Name: "unknown_sensor", Error: "not found"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewClient(server.URL)

	_, err := client.GetValue("unknown_sensor")
	if err == nil {
		t.Error("expected error for not found sensor")
	}
}

func TestIsAvailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v01/SharedMemory/" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewClient(server.URL)

	if !client.IsAvailable() {
		t.Error("expected SM to be available")
	}
}

func TestIsAvailable_NotAvailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	client := NewClient(server.URL)

	if client.IsAvailable() {
		t.Error("expected SM to be not available")
	}
}

func TestIsAvailable_NetworkError(t *testing.T) {
	client := NewClient("http://localhost:99999")

	if client.IsAvailable() {
		t.Error("expected SM to be not available on network error")
	}
}
