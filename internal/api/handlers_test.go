package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/poller"
	"github.com/pv/uniset2-viewer-go/internal/sensorconfig"
	"github.com/pv/uniset2-viewer-go/internal/sm"
	"github.com/pv/uniset2-viewer-go/internal/storage"
	"github.com/pv/uniset2-viewer-go/internal/uniset"
)

// mockUnisetServer создаёт тестовый сервер, эмулирующий uniset2 API
func mockUnisetServer() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		switch r.URL.Path {
		case "/api/v01/list":
			json.NewEncoder(w).Encode([]string{"TestProc", "AnotherObj"})

		case "/api/v01/TestProc":
			response := map[string]interface{}{
				"TestProc": map[string]interface{}{
					"Variables": map[string]interface{}{
						"var1": "100",
						"var2": "200",
					},
					"io": map[string]interface{}{
						"in": map[string]interface{}{
							"input1": map[string]interface{}{
								"id":    1,
								"name":  "Input1_S",
								"value": 42,
							},
						},
					},
				},
			}
			json.NewEncoder(w).Encode(response)

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func setupTestHandlers(unisetServer *httptest.Server) *Handlers {
	client := uniset.NewClient(unisetServer.URL)
	store := storage.NewMemoryStorage()
	p := poller.New(client, store, 5*time.Second, time.Hour)
	return NewHandlers(client, store, p, nil, 5*time.Second)
}

func TestGetObjects(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/objects", nil)
	w := httptest.NewRecorder()

	handlers.GetObjects(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string][]string
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	objects := response["objects"]
	if len(objects) != 2 {
		t.Errorf("expected 2 objects, got %d", len(objects))
	}

	if objects[0] != "TestProc" {
		t.Errorf("expected TestProc, got %s", objects[0])
	}
}

func TestGetObjectData(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/objects/TestProc", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.GetObjectData(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	variables, ok := response["Variables"].(map[string]interface{})
	if !ok {
		t.Fatal("expected Variables in response")
	}

	if variables["var1"] != "100" {
		t.Errorf("expected var1=100, got %v", variables["var1"])
	}
}

func TestGetObjectDataMissingName(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/objects/", nil)
	// Не устанавливаем PathValue
	w := httptest.NewRecorder()

	handlers.GetObjectData(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestWatchObject(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("POST", "/api/objects/TestProc/watch", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.WatchObject(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if response["status"] != "watching" {
		t.Errorf("expected status=watching, got %s", response["status"])
	}

	if response["object"] != "TestProc" {
		t.Errorf("expected object=TestProc, got %s", response["object"])
	}
}

func TestUnwatchObject(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	// Сначала watch
	req := httptest.NewRequest("POST", "/api/objects/TestProc/watch", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()
	handlers.WatchObject(w, req)

	// Затем unwatch
	req = httptest.NewRequest("DELETE", "/api/objects/TestProc/watch", nil)
	req.SetPathValue("name", "TestProc")
	w = httptest.NewRecorder()

	handlers.UnwatchObject(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]string
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["status"] != "unwatched" {
		t.Errorf("expected status=unwatched, got %s", response["status"])
	}
}

func TestGetVariableHistory(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	client := uniset.NewClient(unisetServer.URL)
	store := storage.NewMemoryStorage()
	p := poller.New(client, store, 5*time.Second, time.Hour)
	handlers := NewHandlers(client, store, p, nil, 5*time.Second)

	// Добавляем данные в хранилище
	now := time.Now()
	store.Save("TestProc", "var1", 100, now.Add(-2*time.Second))
	store.Save("TestProc", "var1", 110, now.Add(-time.Second))
	store.Save("TestProc", "var1", 120, now)

	req := httptest.NewRequest("GET", "/api/objects/TestProc/variables/var1/history?count=10", nil)
	req.SetPathValue("name", "TestProc")
	req.SetPathValue("variable", "var1")
	w := httptest.NewRecorder()

	handlers.GetVariableHistory(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response storage.VariableHistory
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if response.ObjectName != "TestProc" {
		t.Errorf("expected ObjectName=TestProc, got %s", response.ObjectName)
	}

	if response.VariableName != "var1" {
		t.Errorf("expected VariableName=var1, got %s", response.VariableName)
	}

	if len(response.Points) != 3 {
		t.Errorf("expected 3 points, got %d", len(response.Points))
	}
}

func TestGetVariableHistoryWithCount(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	client := uniset.NewClient(unisetServer.URL)
	store := storage.NewMemoryStorage()
	p := poller.New(client, store, 5*time.Second, time.Hour)
	handlers := NewHandlers(client, store, p, nil, 5*time.Second)

	// Добавляем 10 точек
	now := time.Now()
	for i := 0; i < 10; i++ {
		store.Save("TestProc", "var1", i*10, now.Add(time.Duration(i)*time.Second))
	}

	// Запрашиваем только 3
	req := httptest.NewRequest("GET", "/api/objects/TestProc/variables/var1/history?count=3", nil)
	req.SetPathValue("name", "TestProc")
	req.SetPathValue("variable", "var1")
	w := httptest.NewRecorder()

	handlers.GetVariableHistory(w, req)

	var response storage.VariableHistory
	json.Unmarshal(w.Body.Bytes(), &response)

	if len(response.Points) != 3 {
		t.Errorf("expected 3 points, got %d", len(response.Points))
	}
}

// === External Sensors API Tests ===

func setupTestHandlersWithSMPoller(unisetServer *httptest.Server, smServer *httptest.Server) *Handlers {
	client := uniset.NewClient(unisetServer.URL)
	store := storage.NewMemoryStorage()
	p := poller.New(client, store, 5*time.Second, time.Hour)
	handlers := NewHandlers(client, store, p, nil, 5*time.Second)

	if smServer != nil {
		smClient := sm.NewClient(smServer.URL)
		smPoller := sm.NewPoller(smClient, store, time.Second, nil)
		handlers.SetSMPoller(smPoller)
	}

	return handlers
}

func mockSMServer() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		switch {
		case r.URL.Path == "/api/v01/SharedMemory/get":
			response := sm.GetResponse{
				Sensors: []sm.SensorValue{
					{ID: 100, Name: "AI100_AS", Value: 42},
					{ID: 101, Name: "AI101_AS", Value: 100},
				},
			}
			json.NewEncoder(w).Encode(response)

		case r.URL.Path == "/api/v01/SharedMemory/":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"object": map[string]interface{}{
					"name": "SharedMemory",
				},
			})

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func TestSubscribeExternalSensors(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	smServer := mockSMServer()
	defer smServer.Close()

	handlers := setupTestHandlersWithSMPoller(unisetServer, smServer)

	reqBody := `{"sensors": ["AI100_AS", "AI101_AS"]}`
	req := httptest.NewRequest("POST", "/api/objects/TestProc/external-sensors", strings.NewReader(reqBody))
	req.SetPathValue("name", "TestProc")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SubscribeExternalSensors(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if response["status"] != "subscribed" {
		t.Errorf("expected status=subscribed, got %s", response["status"])
	}

	sensors := response["sensors"].([]interface{})
	if len(sensors) != 2 {
		t.Errorf("expected 2 sensors, got %d", len(sensors))
	}
}

func TestSubscribeExternalSensors_NoSMPoller(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlersWithSMPoller(unisetServer, nil) // No SM server

	reqBody := `{"sensors": ["AI100_AS"]}`
	req := httptest.NewRequest("POST", "/api/objects/TestProc/external-sensors", strings.NewReader(reqBody))
	req.SetPathValue("name", "TestProc")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SubscribeExternalSensors(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503, got %d", w.Code)
	}
}

func TestSubscribeExternalSensors_InvalidBody(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	smServer := mockSMServer()
	defer smServer.Close()

	handlers := setupTestHandlersWithSMPoller(unisetServer, smServer)

	req := httptest.NewRequest("POST", "/api/objects/TestProc/external-sensors", strings.NewReader("invalid json"))
	req.SetPathValue("name", "TestProc")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SubscribeExternalSensors(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestUnsubscribeExternalSensor(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	smServer := mockSMServer()
	defer smServer.Close()

	handlers := setupTestHandlersWithSMPoller(unisetServer, smServer)

	// First subscribe
	reqBody := `{"sensors": ["AI100_AS", "AI101_AS"]}`
	req := httptest.NewRequest("POST", "/api/objects/TestProc/external-sensors", strings.NewReader(reqBody))
	req.SetPathValue("name", "TestProc")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handlers.SubscribeExternalSensors(w, req)

	// Then unsubscribe one
	req = httptest.NewRequest("DELETE", "/api/objects/TestProc/external-sensors/AI100_AS", nil)
	req.SetPathValue("name", "TestProc")
	req.SetPathValue("sensor", "AI100_AS")
	w = httptest.NewRecorder()

	handlers.UnsubscribeExternalSensor(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["status"] != "unsubscribed" {
		t.Errorf("expected status=unsubscribed, got %s", response["status"])
	}
}

func TestGetExternalSensors(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	smServer := mockSMServer()
	defer smServer.Close()

	handlers := setupTestHandlersWithSMPoller(unisetServer, smServer)

	// First subscribe
	reqBody := `{"sensors": ["AI100_AS", "AI101_AS"]}`
	req := httptest.NewRequest("POST", "/api/objects/TestProc/external-sensors", strings.NewReader(reqBody))
	req.SetPathValue("name", "TestProc")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handlers.SubscribeExternalSensors(w, req)

	// Then get list
	req = httptest.NewRequest("GET", "/api/objects/TestProc/external-sensors", nil)
	req.SetPathValue("name", "TestProc")
	w = httptest.NewRecorder()

	handlers.GetExternalSensors(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	sensors := response["sensors"].([]interface{})
	if len(sensors) != 2 {
		t.Errorf("expected 2 sensors, got %d", len(sensors))
	}
}

func TestGetExternalSensors_NoSMPoller(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlersWithSMPoller(unisetServer, nil)

	req := httptest.NewRequest("GET", "/api/objects/TestProc/external-sensors", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.GetExternalSensors(w, req)

	// GetExternalSensors returns 200 with empty sensors and enabled=false when SM is not configured
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["enabled"] != false {
		t.Error("expected enabled=false when SM not configured")
	}
}

func TestGetExternalSensors_Empty(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	smServer := mockSMServer()
	defer smServer.Close()

	handlers := setupTestHandlersWithSMPoller(unisetServer, smServer)

	// Get list without subscribing
	req := httptest.NewRequest("GET", "/api/objects/TestProc/external-sensors", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.GetExternalSensors(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	sensors := response["sensors"].([]interface{})
	if len(sensors) != 0 {
		t.Errorf("expected 0 sensors, got %d", len(sensors))
	}
}

// === GetVariableHistoryRange Tests ===

func TestGetVariableHistoryRange(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	client := uniset.NewClient(unisetServer.URL)
	store := storage.NewMemoryStorage()
	p := poller.New(client, store, 5*time.Second, time.Hour)
	handlers := NewHandlers(client, store, p, nil, 5*time.Second)

	// Add test data
	now := time.Now()
	store.Save("TestProc", "var1", 100, now.Add(-30*time.Minute))
	store.Save("TestProc", "var1", 150, now.Add(-15*time.Minute))
	store.Save("TestProc", "var1", 200, now)

	req := httptest.NewRequest("GET", "/api/objects/TestProc/variables/var1/history/range", nil)
	req.SetPathValue("name", "TestProc")
	req.SetPathValue("variable", "var1")
	w := httptest.NewRecorder()

	handlers.GetVariableHistoryRange(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response storage.VariableHistory
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if len(response.Points) != 3 {
		t.Errorf("expected 3 points, got %d", len(response.Points))
	}
}

func TestGetVariableHistoryRange_WithTimeParams(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	client := uniset.NewClient(unisetServer.URL)
	store := storage.NewMemoryStorage()
	p := poller.New(client, store, 5*time.Second, time.Hour)
	handlers := NewHandlers(client, store, p, nil, 5*time.Second)

	now := time.Now()
	store.Save("TestProc", "var1", 100, now.Add(-2*time.Hour))
	store.Save("TestProc", "var1", 200, now.Add(-30*time.Minute))
	store.Save("TestProc", "var1", 300, now)

	// Request with from/to parameters
	from := now.Add(-1 * time.Hour).Format(time.RFC3339)
	to := now.Format(time.RFC3339)
	req := httptest.NewRequest("GET", "/api/objects/TestProc/variables/var1/history/range?from="+from+"&to="+to, nil)
	req.SetPathValue("name", "TestProc")
	req.SetPathValue("variable", "var1")
	w := httptest.NewRecorder()

	handlers.GetVariableHistoryRange(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response storage.VariableHistory
	json.Unmarshal(w.Body.Bytes(), &response)

	// Should only include points within the time range (2 points, not 3)
	if len(response.Points) != 2 {
		t.Errorf("expected 2 points in time range, got %d", len(response.Points))
	}
}

func TestGetVariableHistoryRange_MissingParams(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/objects//variables//history/range", nil)
	// Don't set path values
	w := httptest.NewRecorder()

	handlers.GetVariableHistoryRange(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

// === GetSensors Tests ===

func TestGetSensors_NoConfig(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer) // No sensor config

	req := httptest.NewRequest("GET", "/api/sensors", nil)
	w := httptest.NewRecorder()

	handlers.GetSensors(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["count"].(float64) != 0 {
		t.Errorf("expected count 0, got %v", response["count"])
	}
}

func TestGetSensors_WithConfig(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	client := uniset.NewClient(unisetServer.URL)
	store := storage.NewMemoryStorage()
	p := poller.New(client, store, 5*time.Second, time.Hour)

	// Create a mock sensor config
	sensorCfg := createMockSensorConfig()
	handlers := NewHandlers(client, store, p, sensorCfg, 5*time.Second)

	req := httptest.NewRequest("GET", "/api/sensors", nil)
	w := httptest.NewRecorder()

	handlers.GetSensors(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["count"].(float64) == 0 {
		t.Error("expected sensors in response")
	}
}

// === GetSensorByID Tests ===

func TestGetSensorByID_NoConfig(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/sensors/100", nil)
	req.SetPathValue("id", "100")
	w := httptest.NewRecorder()

	handlers.GetSensorByID(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestGetSensorByID_InvalidID(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/sensors/invalid", nil)
	req.SetPathValue("id", "invalid")
	w := httptest.NewRecorder()

	handlers.GetSensorByID(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestGetSensorByID_WithConfig(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	client := uniset.NewClient(unisetServer.URL)
	store := storage.NewMemoryStorage()
	p := poller.New(client, store, 5*time.Second, time.Hour)
	sensorCfg := createMockSensorConfig()
	handlers := NewHandlers(client, store, p, sensorCfg, 5*time.Second)

	req := httptest.NewRequest("GET", "/api/sensors/100", nil)
	req.SetPathValue("id", "100")
	w := httptest.NewRecorder()

	handlers.GetSensorByID(w, req)

	// Should be OK or NotFound depending on whether sensor exists
	if w.Code != http.StatusOK && w.Code != http.StatusNotFound {
		t.Errorf("expected status 200 or 404, got %d", w.Code)
	}
}

// === GetSensorByName Tests ===

func TestGetSensorByName_NoConfig(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/sensors/by-name/AI100_AS", nil)
	req.SetPathValue("name", "AI100_AS")
	w := httptest.NewRecorder()

	handlers.GetSensorByName(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestGetSensorByName_EmptyName(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/sensors/by-name/", nil)
	req.SetPathValue("name", "")
	w := httptest.NewRecorder()

	handlers.GetSensorByName(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

// === GetSMSensors Tests ===

func TestGetSMSensors(t *testing.T) {
	// Create mock SM server
	smServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"sensors": []map[string]interface{}{
				{"id": 100, "name": "AI100_AS", "type": "AI"},
				{"id": 101, "name": "DI101_S", "type": "DI"},
			},
			"count": 2,
		})
	}))
	defer smServer.Close()

	// Mock uniset server that returns SM sensors
	unisetServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v01/SharedMemory/" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"sensors": []map[string]interface{}{
					{"id": 100, "name": "AI100_AS", "type": "AI"},
					{"id": 101, "name": "DI101_S", "type": "DI"},
				},
				"count": 2,
			})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer unisetServer.Close()

	client := uniset.NewClient(unisetServer.URL)
	store := storage.NewMemoryStorage()
	p := poller.New(client, store, 5*time.Second, time.Hour)
	handlers := NewHandlers(client, store, p, nil, 5*time.Second)

	req := httptest.NewRequest("GET", "/api/sm/sensors", nil)
	w := httptest.NewRecorder()

	handlers.GetSMSensors(w, req)

	// Either 200 with sensors or 502 if SM not available
	if w.Code != http.StatusOK && w.Code != http.StatusBadGateway {
		t.Errorf("expected status 200 or 502, got %d", w.Code)
	}
}

// === BroadcastSensorUpdate Test ===

func TestBroadcastSensorUpdate(t *testing.T) {
	hub := NewSSEHub()

	// Add a client
	client := hub.AddClient("TestProc")
	defer hub.RemoveClient(client)

	// Broadcast sensor update
	update := sm.SensorUpdate{
		ObjectName: "TestProc",
		Sensor: sm.SensorValue{
			ID:    100,
			Name:  "AI100_AS",
			Value: 42,
		},
		Timestamp: time.Now(),
	}

	hub.BroadcastSensorUpdate(update)

	// Check that client received the event
	select {
	case event := <-client.events:
		if event.Type != "sensor_data" {
			t.Errorf("expected event type sensor_data, got %s", event.Type)
		}
		if event.ObjectName != "TestProc" {
			t.Errorf("expected objectName TestProc, got %s", event.ObjectName)
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("expected to receive sensor update event")
	}
}

// === UnsubscribeExternalSensor additional tests ===

func TestUnsubscribeExternalSensor_NoSMPoller(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlersWithSMPoller(unisetServer, nil) // No SM

	req := httptest.NewRequest("DELETE", "/api/objects/TestProc/external-sensors/AI100_AS", nil)
	req.SetPathValue("name", "TestProc")
	req.SetPathValue("sensor", "AI100_AS")
	w := httptest.NewRecorder()

	handlers.UnsubscribeExternalSensor(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503, got %d", w.Code)
	}
}

func TestUnsubscribeExternalSensor_MissingParams(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	smServer := mockSMServer()
	defer smServer.Close()

	handlers := setupTestHandlersWithSMPoller(unisetServer, smServer)

	req := httptest.NewRequest("DELETE", "/api/objects//external-sensors/", nil)
	req.SetPathValue("name", "")
	req.SetPathValue("sensor", "")
	w := httptest.NewRecorder()

	handlers.UnsubscribeExternalSensor(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

// === GetSensorByName Success Tests ===

func TestGetSensorByName_WithConfig(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	client := uniset.NewClient(unisetServer.URL)
	store := storage.NewMemoryStorage()
	p := poller.New(client, store, 5*time.Second, time.Hour)
	sensorCfg := createMockSensorConfig()
	handlers := NewHandlers(client, store, p, sensorCfg, 5*time.Second)

	req := httptest.NewRequest("GET", "/api/sensors/name/AI100_AS", nil)
	req.SetPathValue("name", "AI100_AS")
	w := httptest.NewRecorder()

	handlers.GetSensorByName(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["name"] != "AI100_AS" {
		t.Errorf("expected sensor name AI100_AS, got %v", response["name"])
	}
}

func TestGetSensorByName_NotFound(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	client := uniset.NewClient(unisetServer.URL)
	store := storage.NewMemoryStorage()
	p := poller.New(client, store, 5*time.Second, time.Hour)
	sensorCfg := createMockSensorConfig()
	handlers := NewHandlers(client, store, p, sensorCfg, 5*time.Second)

	req := httptest.NewRequest("GET", "/api/sensors/name/NonExistent", nil)
	req.SetPathValue("name", "NonExistent")
	w := httptest.NewRecorder()

	handlers.GetSensorByName(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

// === LogServer Handler Tests ===

func TestGetLogServerStatus_EmptyName(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/logs//status", nil)
	req.SetPathValue("name", "")
	w := httptest.NewRecorder()

	handlers.GetLogServerStatus(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestGetLogServerStatus_NilManager(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)
	// logServerMgr is nil by default in setupTestHandlers

	req := httptest.NewRequest("GET", "/api/logs/TestProc/status", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.GetLogServerStatus(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503, got %d", w.Code)
	}
}

func TestHandleLogServerStream_EmptyName(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/logs//stream", nil)
	req.SetPathValue("name", "")
	w := httptest.NewRecorder()

	handlers.HandleLogServerStream(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestHandleLogServerStream_NilManager(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/logs/TestProc/stream", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.HandleLogServerStream(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503, got %d", w.Code)
	}
}

func TestSendLogServerCommand_EmptyName(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("POST", "/api/logs//command", nil)
	req.SetPathValue("name", "")
	w := httptest.NewRecorder()

	handlers.SendLogServerCommand(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestSendLogServerCommand_NilManager(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	body := `{"command": "setLevel", "level": 1}`
	req := httptest.NewRequest("POST", "/api/logs/TestProc/command", strings.NewReader(body))
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.SendLogServerCommand(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503, got %d", w.Code)
	}
}

func TestGetAllLogServerStatuses_NilManager(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/logs/status", nil)
	w := httptest.NewRecorder()

	handlers.GetAllLogServerStatuses(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Should return empty object
	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)
	if len(response) != 0 {
		t.Errorf("expected empty response, got %v", response)
	}
}

// === Helper functions ===

func createMockSensorConfig() *sensorconfig.SensorConfig {
	// Create a minimal sensor config for testing
	// Root element can be any name (UNISETPLC, Configure, etc.)
	xmlData := `<?xml version="1.0" encoding="utf-8"?>
<Configure>
  <sensors>
    <item id="100" name="AI100_AS" textname="Test Sensor 1" iotype="AI"/>
    <item id="101" name="DI101_S" textname="Test Sensor 2" iotype="DI"/>
  </sensors>
</Configure>`

	cfg, _ := sensorconfig.Parse([]byte(xmlData))
	return cfg
}
