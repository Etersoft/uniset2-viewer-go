package uniset

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetOPCUAStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"status": map[string]interface{}{
				"connected": true,
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetOPCUAStatus("OPCUAExchange")
	if err != nil {
		t.Fatalf("GetOPCUAStatus failed: %v", err)
	}

	if resp.Status == nil {
		t.Error("expected status data")
	}
}

func TestGetOPCUAParams(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"params": map[string]interface{}{
				"reconnectPause": 5000,
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetOPCUAParams("OPCUAExchange", []string{"reconnectPause"})
	if err != nil {
		t.Fatalf("GetOPCUAParams failed: %v", err)
	}

	if resp.Params == nil {
		t.Error("expected params data")
	}
}

func TestGetOPCUAParamsEmpty(t *testing.T) {
	client := NewClient("http://localhost")
	_, err := client.GetOPCUAParams("OPCUAExchange", []string{})
	if err == nil {
		t.Error("expected error for empty params")
	}
}

func TestSetOPCUAParams(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"updated": map[string]interface{}{
				"reconnectPause": 10000,
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.SetOPCUAParams("OPCUAExchange", map[string]interface{}{"reconnectPause": 10000})
	if err != nil {
		t.Fatalf("SetOPCUAParams failed: %v", err)
	}

	if resp.Updated == nil {
		t.Error("expected updated data")
	}
}

func TestSetOPCUAParamsEmpty(t *testing.T) {
	client := NewClient("http://localhost")
	_, err := client.SetOPCUAParams("OPCUAExchange", map[string]interface{}{})
	if err == nil {
		t.Error("expected error for empty params")
	}
}

func TestGetOPCUASensors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"sensors": []map[string]interface{}{
				{"id": 1, "name": "Temperature"},
			},
			"total": 50,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetOPCUASensors("OPCUAExchange", "Temp", "AI", 50, 0)
	if err != nil {
		t.Fatalf("GetOPCUASensors failed: %v", err)
	}

	if len(resp.Sensors) != 1 {
		t.Errorf("expected 1 sensor, got %d", len(resp.Sensors))
	}
}

func TestGetOPCUASensor(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"sensor": map[string]interface{}{
				"id":    1,
				"name":  "Temperature",
				"value": 25,
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetOPCUASensor("OPCUAExchange", 1)
	if err != nil {
		t.Fatalf("GetOPCUASensor failed: %v", err)
	}

	if resp.Sensor == nil {
		t.Error("expected sensor data")
	}
}

func TestGetOPCUADiagnostics(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"summary": map[string]interface{}{
				"errorsTotal": 5,
			},
			"lastErrors":       []map[string]interface{}{},
			"errorHistoryMax":  100,
			"errorHistorySize": 5,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetOPCUADiagnostics("OPCUAExchange")
	if err != nil {
		t.Fatalf("GetOPCUADiagnostics failed: %v", err)
	}

	if resp.Summary == nil {
		t.Error("expected summary data")
	}
	if resp.ErrorHistoryMax != 100 {
		t.Errorf("expected errorHistoryMax=100, got %d", resp.ErrorHistoryMax)
	}
}

func TestTakeOPCUAControl(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result":       "OK",
			"previousMode": 0,
			"currentMode":  1,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.TakeOPCUAControl("OPCUAExchange")
	if err != nil {
		t.Fatalf("TakeOPCUAControl failed: %v", err)
	}

	if resp.CurrentMode != 1 {
		t.Errorf("expected currentMode=1, got %d", resp.CurrentMode)
	}
}

func TestReleaseOPCUAControl(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result":       "OK",
			"previousMode": 1,
			"currentMode":  0,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.ReleaseOPCUAControl("OPCUAExchange")
	if err != nil {
		t.Fatalf("ReleaseOPCUAControl failed: %v", err)
	}

	if resp.CurrentMode != 0 {
		t.Errorf("expected currentMode=0, got %d", resp.CurrentMode)
	}
}

func TestGetOPCUASensorValues(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"sensors": []map[string]interface{}{
				{"id": 1, "name": "Sensor1", "value": 100},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetOPCUASensorValues("OPCUAExchange", "1,2,3")
	if err != nil {
		t.Fatalf("GetOPCUASensorValues failed: %v", err)
	}

	if len(resp.Sensors) != 1 {
		t.Errorf("expected 1 sensor, got %d", len(resp.Sensors))
	}
}

func TestGetOPCUAServerSensorValues(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check that id= parameter is used instead of filter=
		if r.URL.Query().Get("id") == "" {
			t.Error("expected id= parameter")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"sensors": []map[string]interface{}{
				{"id": 1, "name": "Sensor1", "value": 200},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetOPCUAServerSensorValues("OPCUAServer", "1,2,3")
	if err != nil {
		t.Fatalf("GetOPCUAServerSensorValues failed: %v", err)
	}

	if len(resp.Sensors) != 1 {
		t.Errorf("expected 1 sensor, got %d", len(resp.Sensors))
	}
}

func TestOPCUAResponseTypes(t *testing.T) {
	// Test struct field assignments
	statusResp := OPCUAStatusResponse{
		Result: "OK",
		Status: map[string]interface{}{"key": "value"},
	}
	if statusResp.Result != "OK" {
		t.Error("OPCUAStatusResponse.Result not set")
	}

	paramsResp := OPCUAParamsResponse{
		Result:  "OK",
		Params:  map[string]interface{}{"param": 1},
		Updated: map[string]interface{}{"param": 2},
	}
	if paramsResp.Result != "OK" {
		t.Error("OPCUAParamsResponse.Result not set")
	}

	sensorsResp := OPCUASensorsResponse{
		Result:  "OK",
		Sensors: []map[string]interface{}{{"id": 1}},
		Total:   100,
		Limit:   50,
		Offset:  0,
	}
	if sensorsResp.Total != 100 {
		t.Error("OPCUASensorsResponse.Total not set")
	}

	sensorResp := OPCUASensorResponse{
		Result: "OK",
		Sensor: map[string]interface{}{"id": 1},
		Query:  map[string]interface{}{"param": "value"},
	}
	if sensorResp.Sensor == nil {
		t.Error("OPCUASensorResponse.Sensor not set")
	}

	diagResp := OPCUADiagnosticsResponse{
		Result:           "OK",
		Summary:          map[string]interface{}{"errors": 0},
		LastErrors:       []map[string]interface{}{},
		ErrorHistoryMax:  100,
		ErrorHistorySize: 0,
	}
	if diagResp.ErrorHistoryMax != 100 {
		t.Error("OPCUADiagnosticsResponse.ErrorHistoryMax not set")
	}

	ctrlResp := OPCUAControlResponse{
		Result:       "OK",
		Message:      "Control acquired",
		PreviousMode: 0,
		CurrentMode:  1,
	}
	if ctrlResp.CurrentMode != 1 {
		t.Error("OPCUAControlResponse.CurrentMode not set")
	}
}

func TestNewClientWithSupplier(t *testing.T) {
	client := NewClientWithSupplier("http://localhost:8080", "MySupplier")
	if client == nil {
		t.Fatal("NewClientWithSupplier returned nil")
	}
	if client.Supplier != "MySupplier" {
		t.Errorf("Supplier = %q, want %q", client.Supplier, "MySupplier")
	}
	if client.baseURL != "http://localhost:8080" {
		t.Errorf("baseURL = %q, want %q", client.baseURL, "http://localhost:8080")
	}
}

func TestEnsureResult(t *testing.T) {
	tests := []struct {
		name    string
		result  string
		errMsg  string
		wantErr bool
	}{
		{"empty result", "", "", false},
		{"OK result", "OK", "", false},
		{"ok lowercase", "ok", "", false},
		{"ERROR with message", "ERROR", "connection failed", true},
		{"ERROR without message", "ERROR", "", true},
		{"FAILED result", "FAILED", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ensureResult(tt.result, tt.errMsg)
			if (err != nil) != tt.wantErr {
				t.Errorf("ensureResult(%q, %q) error = %v, wantErr %v", tt.result, tt.errMsg, err, tt.wantErr)
			}
		})
	}
}
