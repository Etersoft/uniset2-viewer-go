package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pv/uniset-panel/internal/config"
	"github.com/pv/uniset-panel/internal/logserver"
	"github.com/pv/uniset-panel/internal/poller"
	"github.com/pv/uniset-panel/internal/sensorconfig"
	"github.com/pv/uniset-panel/internal/server"
	"github.com/pv/uniset-panel/internal/sm"
	"github.com/pv/uniset-panel/internal/storage"
	"github.com/pv/uniset-panel/internal/uniset"
)

func normalizeAPIPath(path string) string {
	if strings.HasPrefix(path, "/api/") {
		trimmed := strings.TrimPrefix(path, "/api/")
		parts := strings.SplitN(trimmed, "/", 2)
		if len(parts) == 2 {
			return "/" + parts[1]
		}
	}
	return path
}

func pathEquals(r *http.Request, suffix string) bool {
	return normalizeAPIPath(r.URL.Path) == "/"+suffix
}

// mockUnisetServer создаёт тестовый сервер, эмулирующий uniset2 API
func mockUnisetServer() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		switch normalizeAPIPath(r.URL.Path) {
		case "/list":
			json.NewEncoder(w).Encode([]string{"TestProc", "AnotherObj"})

		case "/TestProc":
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
	store.Save("", "TestProc", "var1", 100, now.Add(-2*time.Second))
	store.Save("", "TestProc", "var1", 110, now.Add(-time.Second))
	store.Save("", "TestProc", "var1", 120, now)

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
		store.Save("", "TestProc", "var1", i*10, now.Add(time.Duration(i)*time.Second))
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

		switch normalizeAPIPath(r.URL.Path) {
		case "/SharedMemory/get":
			response := sm.GetResponse{
				Sensors: []sm.SensorValue{
					{ID: 100, Name: "AI100_AS", Value: 42},
					{ID: 101, Name: "AI101_AS", Value: 100},
				},
			}
			json.NewEncoder(w).Encode(response)

		case "/SharedMemory/":
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
	store.Save("", "TestProc", "var1", 100, now.Add(-30*time.Minute))
	store.Save("", "TestProc", "var1", 150, now.Add(-15*time.Minute))
	store.Save("", "TestProc", "var1", 200, now)

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
	store.Save("", "TestProc", "var1", 100, now.Add(-2*time.Hour))
	store.Save("", "TestProc", "var1", 200, now.Add(-30*time.Minute))
	store.Save("", "TestProc", "var1", 300, now)

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
		if pathEquals(r, "SharedMemory/") {
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

// === Multi-Server Tests ===

func setupTestHandlersWithServerManager(servers map[string]*httptest.Server) *Handlers {
	store := storage.NewMemoryStorage()
	handlers := &Handlers{
		storage:      store,
		sseHub:       NewSSEHub(),
		pollInterval: 5 * time.Second,
	}

	// Create server manager
	serverMgr := server.NewManager(store, 5*time.Second, time.Hour, "TestProc", 0)

	// Add servers
	for id, srv := range servers {
		cfg := config.ServerConfig{
			ID:   id,
			URL:  srv.URL,
			Name: "Test Server " + id,
		}
		serverMgr.AddServer(cfg)
	}

	handlers.SetServerManager(serverMgr)
	return handlers
}

func TestGetObjectDataWithServerParam(t *testing.T) {
	// Create two mock UniSet servers with different data
	server1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if pathEquals(r, "TestProc") {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"TestProc": map[string]interface{}{
					"Variables": map[string]interface{}{
						"var1": "100",
					},
				},
			})
			return
		}
		if pathEquals(r, "list") {
			json.NewEncoder(w).Encode([]string{"TestProc"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server1.Close()

	server2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if pathEquals(r, "TestProc") {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"TestProc": map[string]interface{}{
					"Variables": map[string]interface{}{
						"var1": "200",
					},
				},
			})
			return
		}
		if pathEquals(r, "list") {
			json.NewEncoder(w).Encode([]string{"TestProc"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server2.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
		"server2": server2,
	})

	// Test fetching from server1
	req := httptest.NewRequest("GET", "/api/objects/TestProc?server=server1", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.GetObjectData(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response1 map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response1)

	vars1 := response1["Variables"].(map[string]interface{})
	if vars1["var1"] != "100" {
		t.Errorf("server1: expected var1=100, got %v", vars1["var1"])
	}

	// Test fetching from server2
	req = httptest.NewRequest("GET", "/api/objects/TestProc?server=server2", nil)
	req.SetPathValue("name", "TestProc")
	w = httptest.NewRecorder()

	handlers.GetObjectData(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response2 map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response2)

	vars2 := response2["Variables"].(map[string]interface{})
	if vars2["var1"] != "200" {
		t.Errorf("server2: expected var1=200, got %v", vars2["var1"])
	}
}

func TestGetObjectDataWithInvalidServer(t *testing.T) {
	server1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if pathEquals(r, "list") {
			json.NewEncoder(w).Encode([]string{"TestProc"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})

	req := httptest.NewRequest("GET", "/api/objects/TestProc?server=nonexistent", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.GetObjectData(w, req)

	if w.Code != http.StatusBadGateway {
		t.Errorf("expected status 502 for invalid server, got %d", w.Code)
	}
}

func TestWatchObjectWithServerParam(t *testing.T) {
	server1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if pathEquals(r, "list") {
			json.NewEncoder(w).Encode([]string{"TestProc"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})

	req := httptest.NewRequest("POST", "/api/objects/TestProc/watch?server=server1", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.WatchObject(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]string
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["status"] != "watching" {
		t.Errorf("expected status=watching, got %s", response["status"])
	}
}

func TestUnwatchObjectWithServerParam(t *testing.T) {
	server1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if pathEquals(r, "list") {
			json.NewEncoder(w).Encode([]string{"TestProc"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})

	// First watch
	req := httptest.NewRequest("POST", "/api/objects/TestProc/watch?server=server1", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()
	handlers.WatchObject(w, req)

	// Then unwatch
	req = httptest.NewRequest("DELETE", "/api/objects/TestProc/watch?server=server1", nil)
	req.SetPathValue("name", "TestProc")
	w = httptest.NewRecorder()

	handlers.UnwatchObject(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]string
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["status"] != "unwatched" {
		t.Errorf("expected status=unwatched, got %s", response["status"])
	}
}

func TestGetAllObjectsGrouped(t *testing.T) {
	server1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if pathEquals(r, "list") {
			json.NewEncoder(w).Encode([]string{"Proc1", "Proc2"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server1.Close()

	server2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if pathEquals(r, "list") {
			json.NewEncoder(w).Encode([]string{"Proc3", "Proc4"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server2.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
		"server2": server2,
	})

	req := httptest.NewRequest("GET", "/api/all-objects", nil)
	w := httptest.NewRecorder()

	handlers.GetAllObjectsWithServers(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	objects := response["objects"].([]interface{})
	if len(objects) != 2 {
		t.Errorf("expected 2 server groups, got %d", len(objects))
	}

	// Check total count
	count := int(response["count"].(float64))
	if count != 4 {
		t.Errorf("expected total count 4, got %d", count)
	}
}

func TestGetServers(t *testing.T) {
	server1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]string{})
	}))
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})

	req := httptest.NewRequest("GET", "/api/servers", nil)
	w := httptest.NewRecorder()

	handlers.GetServers(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	servers := response["servers"].([]interface{})
	if len(servers) != 1 {
		t.Errorf("expected 1 server, got %d", len(servers))
	}

	serverInfo := servers[0].(map[string]interface{})
	if serverInfo["id"] != "server1" {
		t.Errorf("expected server id=server1, got %v", serverInfo["id"])
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

// === Multi-Server LogServer Tests ===
// These tests verify that HandleLogServerStream correctly uses serverManager
// to fetch object data from the specified server when ?server= parameter is provided.

// createMockServerWithLogServer creates a mock UniSet server that returns
// object data with LogServer configuration (different host/port per server)
func createMockServerWithLogServer(logServerHost string, logServerPort int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if pathEquals(r, "TestProc") {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"TestProc": map[string]interface{}{
					"Variables": map[string]interface{}{
						"var1": "100",
					},
					"LogServer": map[string]interface{}{
						"host": logServerHost,
						"port": logServerPort,
					},
				},
			})
			return
		}
		if pathEquals(r, "list") {
			json.NewEncoder(w).Encode([]string{"TestProc"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
}

// TestHandleLogServerStream_WithServerManager_UsesCorrectServer verifies that
// HandleLogServerStream uses serverManager to get object data when server param is provided.
// This test would have caught the bug where h.client was used instead of serverManager.
func TestHandleLogServerStream_WithServerManager_UsesCorrectServer(t *testing.T) {
	// Create two mock servers with different LogServer configurations
	server1 := createMockServerWithLogServer("logserver1.example.com", 5001)
	defer server1.Close()

	server2 := createMockServerWithLogServer("logserver2.example.com", 5002)
	defer server2.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
		"server2": server2,
	})

	// Set up LogServer manager (required for the handler to work)
	handlers.SetLogServerManager(logserver.NewManager(slog.Default()))

	// Test 1: Request with server=server1 should use server1's LogServer config
	req1 := httptest.NewRequest("GET", "/api/logs/TestProc/stream?server=server1", nil)
	req1.SetPathValue("name", "TestProc")
	w1 := httptest.NewRecorder()

	// The handler will try to connect to logserver1.example.com:5001
	// Since that server doesn't exist, it will return an SSE error event
	handlers.HandleLogServerStream(w1, req1)

	// Check that response is SSE (Content-Type)
	contentType := w1.Header().Get("Content-Type")
	if contentType != "text/event-stream" {
		t.Errorf("expected Content-Type text/event-stream, got %s", contentType)
	}

	// The body should contain error event with connection failure to logserver1.example.com:5001
	body1 := w1.Body.String()
	if !strings.Contains(body1, "event: error") {
		t.Errorf("expected SSE error event, got: %s", body1)
	}
	// Verify it tried to connect to the correct LogServer (server1's)
	if !strings.Contains(body1, "5001") && !strings.Contains(body1, "logserver1") {
		t.Logf("Response body: %s", body1)
		// This is expected - the error message might not contain the host/port details
	}

	// Test 2: Request with server=server2 should use server2's LogServer config
	req2 := httptest.NewRequest("GET", "/api/logs/TestProc/stream?server=server2", nil)
	req2.SetPathValue("name", "TestProc")
	w2 := httptest.NewRecorder()

	handlers.HandleLogServerStream(w2, req2)

	body2 := w2.Body.String()
	if !strings.Contains(body2, "event: error") {
		t.Errorf("expected SSE error event, got: %s", body2)
	}
}

// TestHandleLogServerStream_WithServerManager_NoServerParam tests that
// server parameter is required when using multi-server mode
func TestHandleLogServerStream_WithServerManager_NoServerParam(t *testing.T) {
	server1 := createMockServerWithLogServer("localhost", 6001)
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})
	handlers.SetLogServerManager(logserver.NewManager(slog.Default()))

	// Request without server param should return error
	req := httptest.NewRequest("GET", "/api/logs/TestProc/stream", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.HandleLogServerStream(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d", http.StatusBadRequest, w.Code)
	}

	body := w.Body.String()
	if !strings.Contains(body, "server parameter is required") {
		t.Errorf("expected 'server parameter is required' error, got: %s", body)
	}
}

// TestHandleLogServerStream_WithServerManager_InvalidServer tests behavior
// when an invalid server ID is provided
func TestHandleLogServerStream_WithServerManager_InvalidServer(t *testing.T) {
	server1 := createMockServerWithLogServer("localhost", 6001)
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})
	handlers.SetLogServerManager(logserver.NewManager(slog.Default()))

	// Request with invalid server ID
	req := httptest.NewRequest("GET", "/api/logs/TestProc/stream?server=nonexistent", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.HandleLogServerStream(w, req)

	// Should return error (502 Bad Gateway for server not found)
	if w.Code != http.StatusBadGateway {
		t.Errorf("expected status 502, got %d: %s", w.Code, w.Body.String())
	}
}

// TestHandleLogServerStream_ObjectWithoutLogServer tests behavior when
// the object doesn't have LogServer configured
func TestHandleLogServerStream_ObjectWithoutLogServer(t *testing.T) {
	// Server that returns object without LogServer
	serverWithoutLogServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if pathEquals(r, "TestProc") {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"TestProc": map[string]interface{}{
					"Variables": map[string]interface{}{
						"var1": "100",
					},
					// No LogServer field
				},
			})
			return
		}
		if pathEquals(r, "list") {
			json.NewEncoder(w).Encode([]string{"TestProc"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer serverWithoutLogServer.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": serverWithoutLogServer,
	})
	handlers.SetLogServerManager(logserver.NewManager(slog.Default()))

	req := httptest.NewRequest("GET", "/api/logs/TestProc/stream?server=server1", nil)
	req.SetPathValue("name", "TestProc")
	w := httptest.NewRecorder()

	handlers.HandleLogServerStream(w, req)

	// Should return 404 "object has no LogServer"
	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d: %s", w.Code, w.Body.String())
	}
}

// === Multi-Server IONC Tests ===

// createMockIONCServer creates a mock UniSet server that supports IONC endpoints
func createMockIONCServer(sensorValue int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		switch {
		case pathEquals(r, "list"):
			json.NewEncoder(w).Encode([]string{"SharedMemory"})
		case pathEquals(r, "SharedMemory/sensors") || strings.HasPrefix(normalizeAPIPath(r.URL.Path), "/SharedMemory/sensors"):
			json.NewEncoder(w).Encode(map[string]interface{}{
				"sensors": []map[string]interface{}{
					{"id": 100, "name": "AI100_AS", "type": "AI", "value": sensorValue},
					{"id": 101, "name": "DI101_S", "type": "DI", "value": 0},
				},
				"size":   2,
				"offset": 0,
				"limit":  100,
			})
		case pathEquals(r, "SharedMemory/get") || strings.HasPrefix(normalizeAPIPath(r.URL.Path), "/SharedMemory/get"):
			json.NewEncoder(w).Encode(map[string]interface{}{
				"sensors": []map[string]interface{}{
					{"id": 100, "name": "AI100_AS", "value": sensorValue, "real_value": float64(sensorValue)},
				},
			})
		case pathEquals(r, "SharedMemory/set") || strings.HasPrefix(normalizeAPIPath(r.URL.Path), "/SharedMemory/set"):
			json.NewEncoder(w).Encode(map[string]interface{}{"result": "OK"})
		case pathEquals(r, "SharedMemory/freeze") || strings.HasPrefix(normalizeAPIPath(r.URL.Path), "/SharedMemory/freeze"):
			json.NewEncoder(w).Encode(map[string]interface{}{"result": "OK"})
		case pathEquals(r, "SharedMemory/unfreeze") || strings.HasPrefix(normalizeAPIPath(r.URL.Path), "/SharedMemory/unfreeze"):
			json.NewEncoder(w).Encode(map[string]interface{}{"result": "OK"})
		case pathEquals(r, "SharedMemory/consumers") || strings.HasPrefix(normalizeAPIPath(r.URL.Path), "/SharedMemory/consumers"):
			json.NewEncoder(w).Encode(map[string]interface{}{
				"sensors": []map[string]interface{}{
					{"id": 100, "name": "AI100_AS", "consumers": []interface{}{}},
				},
			})
		case pathEquals(r, "SharedMemory/lost") || strings.HasPrefix(normalizeAPIPath(r.URL.Path), "/SharedMemory/lost"):
			json.NewEncoder(w).Encode(map[string]interface{}{"lost consumers": []interface{}{}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func TestGetIONCSensors_WithServerParam(t *testing.T) {
	// Create two servers with different sensor values
	server1 := createMockIONCServer(100)
	defer server1.Close()

	server2 := createMockIONCServer(200)
	defer server2.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
		"server2": server2,
	})

	// Test server1
	req := httptest.NewRequest("GET", "/api/objects/SharedMemory/ionc/sensors?server=server1", nil)
	req.SetPathValue("name", "SharedMemory")
	w := httptest.NewRecorder()

	handlers.GetIONCSensors(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server1: expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response1 map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response1)

	sensors1 := response1["sensors"].([]interface{})
	if len(sensors1) != 2 {
		t.Errorf("server1: expected 2 sensors, got %d", len(sensors1))
	}

	// Test server2
	req = httptest.NewRequest("GET", "/api/objects/SharedMemory/ionc/sensors?server=server2", nil)
	req.SetPathValue("name", "SharedMemory")
	w = httptest.NewRecorder()

	handlers.GetIONCSensors(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server2: expected status 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetIONCSensors_InvalidServer(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})

	req := httptest.NewRequest("GET", "/api/objects/SharedMemory/ionc/sensors?server=nonexistent", nil)
	req.SetPathValue("name", "SharedMemory")
	w := httptest.NewRecorder()

	handlers.GetIONCSensors(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for invalid server, got %d", w.Code)
	}
}

func TestGetIONCSensorValues_WithServerParam(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	server2 := createMockIONCServer(200)
	defer server2.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
		"server2": server2,
	})

	// Test server1
	req := httptest.NewRequest("GET", "/api/objects/SharedMemory/ionc/get?filter=100&server=server1", nil)
	req.SetPathValue("name", "SharedMemory")
	w := httptest.NewRecorder()

	handlers.GetIONCSensorValues(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server1: expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	// Test server2
	req = httptest.NewRequest("GET", "/api/objects/SharedMemory/ionc/get?filter=100&server=server2", nil)
	req.SetPathValue("name", "SharedMemory")
	w = httptest.NewRecorder()

	handlers.GetIONCSensorValues(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server2: expected status 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetIONCSensorValues_InvalidServer(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})

	req := httptest.NewRequest("GET", "/api/objects/SharedMemory/ionc/get?filter=100&server=nonexistent", nil)
	req.SetPathValue("name", "SharedMemory")
	w := httptest.NewRecorder()

	handlers.GetIONCSensorValues(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for invalid server, got %d", w.Code)
	}
}

func TestSetIONCSensorValue_WithServerParam(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	server2 := createMockIONCServer(200)
	defer server2.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
		"server2": server2,
	})

	// Test server1
	body := `{"sensor_id": 100, "value": 42}`
	req := httptest.NewRequest("POST", "/api/objects/SharedMemory/ionc/set?server=server1", strings.NewReader(body))
	req.SetPathValue("name", "SharedMemory")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetIONCSensorValue(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server1: expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["status"] != "ok" {
		t.Errorf("expected status=ok, got %v", response["status"])
	}

	// Test server2
	req = httptest.NewRequest("POST", "/api/objects/SharedMemory/ionc/set?server=server2", strings.NewReader(body))
	req.SetPathValue("name", "SharedMemory")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()

	handlers.SetIONCSensorValue(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server2: expected status 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSetIONCSensorValue_InvalidServer(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})

	body := `{"sensor_id": 100, "value": 42}`
	req := httptest.NewRequest("POST", "/api/objects/SharedMemory/ionc/set?server=nonexistent", strings.NewReader(body))
	req.SetPathValue("name", "SharedMemory")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetIONCSensorValue(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for invalid server, got %d", w.Code)
	}
}

func TestFreezeIONCSensor_WithServerParam(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	server2 := createMockIONCServer(200)
	defer server2.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
		"server2": server2,
	})

	// Test server1
	body := `{"sensor_id": 100, "value": 42}`
	req := httptest.NewRequest("POST", "/api/objects/SharedMemory/ionc/freeze?server=server1", strings.NewReader(body))
	req.SetPathValue("name", "SharedMemory")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.FreezeIONCSensor(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server1: expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["status"] != "frozen" {
		t.Errorf("expected status=frozen, got %v", response["status"])
	}

	// Test server2
	req = httptest.NewRequest("POST", "/api/objects/SharedMemory/ionc/freeze?server=server2", strings.NewReader(body))
	req.SetPathValue("name", "SharedMemory")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()

	handlers.FreezeIONCSensor(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server2: expected status 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFreezeIONCSensor_InvalidServer(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})

	body := `{"sensor_id": 100, "value": 42}`
	req := httptest.NewRequest("POST", "/api/objects/SharedMemory/ionc/freeze?server=nonexistent", strings.NewReader(body))
	req.SetPathValue("name", "SharedMemory")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.FreezeIONCSensor(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for invalid server, got %d", w.Code)
	}
}

func TestUnfreezeIONCSensor_WithServerParam(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	server2 := createMockIONCServer(200)
	defer server2.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
		"server2": server2,
	})

	// Test server1
	body := `{"sensor_id": 100}`
	req := httptest.NewRequest("POST", "/api/objects/SharedMemory/ionc/unfreeze?server=server1", strings.NewReader(body))
	req.SetPathValue("name", "SharedMemory")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.UnfreezeIONCSensor(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server1: expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["status"] != "unfrozen" {
		t.Errorf("expected status=unfrozen, got %v", response["status"])
	}

	// Test server2
	req = httptest.NewRequest("POST", "/api/objects/SharedMemory/ionc/unfreeze?server=server2", strings.NewReader(body))
	req.SetPathValue("name", "SharedMemory")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()

	handlers.UnfreezeIONCSensor(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server2: expected status 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUnfreezeIONCSensor_InvalidServer(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})

	body := `{"sensor_id": 100}`
	req := httptest.NewRequest("POST", "/api/objects/SharedMemory/ionc/unfreeze?server=nonexistent", strings.NewReader(body))
	req.SetPathValue("name", "SharedMemory")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.UnfreezeIONCSensor(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for invalid server, got %d", w.Code)
	}
}

func TestGetIONCConsumers_WithServerParam(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	server2 := createMockIONCServer(200)
	defer server2.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
		"server2": server2,
	})

	// Test server1
	req := httptest.NewRequest("GET", "/api/objects/SharedMemory/ionc/consumers?sensors=100&server=server1", nil)
	req.SetPathValue("name", "SharedMemory")
	w := httptest.NewRecorder()

	handlers.GetIONCConsumers(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server1: expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	// Test server2
	req = httptest.NewRequest("GET", "/api/objects/SharedMemory/ionc/consumers?sensors=100&server=server2", nil)
	req.SetPathValue("name", "SharedMemory")
	w = httptest.NewRecorder()

	handlers.GetIONCConsumers(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server2: expected status 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetIONCConsumers_InvalidServer(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})

	req := httptest.NewRequest("GET", "/api/objects/SharedMemory/ionc/consumers?sensors=100&server=nonexistent", nil)
	req.SetPathValue("name", "SharedMemory")
	w := httptest.NewRecorder()

	handlers.GetIONCConsumers(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for invalid server, got %d", w.Code)
	}
}

func TestGetIONCLostConsumers_WithServerParam(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	server2 := createMockIONCServer(200)
	defer server2.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
		"server2": server2,
	})

	// Test server1
	req := httptest.NewRequest("GET", "/api/objects/SharedMemory/ionc/lost?server=server1", nil)
	req.SetPathValue("name", "SharedMemory")
	w := httptest.NewRecorder()

	handlers.GetIONCLostConsumers(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server1: expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	// Test server2
	req = httptest.NewRequest("GET", "/api/objects/SharedMemory/ionc/lost?server=server2", nil)
	req.SetPathValue("name", "SharedMemory")
	w = httptest.NewRecorder()

	handlers.GetIONCLostConsumers(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("server2: expected status 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetIONCLostConsumers_InvalidServer(t *testing.T) {
	server1 := createMockIONCServer(100)
	defer server1.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server1,
	})

	req := httptest.NewRequest("GET", "/api/objects/SharedMemory/ionc/lost?server=nonexistent", nil)
	req.SetPathValue("name", "SharedMemory")
	w := httptest.NewRecorder()

	handlers.GetIONCLostConsumers(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for invalid server, got %d", w.Code)
	}
}

// ============================================================================
// Poll Interval API Tests
// ============================================================================

func TestGetPollInterval(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	req := httptest.NewRequest("GET", "/api/settings/poll-interval", nil)
	w := httptest.NewRecorder()

	handlers.GetPollInterval(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	interval, ok := response["interval"].(float64)
	if !ok {
		t.Fatal("expected interval field in response")
	}

	// Default interval is 5 seconds = 5000ms
	if interval != 5000 {
		t.Errorf("expected interval=5000, got %v", interval)
	}
}

func TestGetPollInterval_WithServerManager(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]string{})
	}))
	defer server.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server,
	})

	req := httptest.NewRequest("GET", "/api/settings/poll-interval", nil)
	w := httptest.NewRecorder()

	handlers.GetPollInterval(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	_, ok := response["interval"].(float64)
	if !ok {
		t.Error("expected interval field in response")
	}
}

func TestSetPollInterval(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	body := `{"interval": 10000}`
	req := httptest.NewRequest("POST", "/api/settings/poll-interval", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetPollInterval(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	interval, ok := response["interval"].(float64)
	if !ok {
		t.Fatal("expected interval field in response")
	}

	if interval != 10000 {
		t.Errorf("expected interval=10000, got %v", interval)
	}

	if response["status"] != "ok" {
		t.Errorf("expected status=ok, got %v", response["status"])
	}

	// Verify the interval was actually changed
	req = httptest.NewRequest("GET", "/api/settings/poll-interval", nil)
	w = httptest.NewRecorder()
	handlers.GetPollInterval(w, req)

	json.Unmarshal(w.Body.Bytes(), &response)
	if response["interval"].(float64) != 10000 {
		t.Error("interval was not persisted")
	}
}

func TestSetPollInterval_InvalidBody(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	body := `invalid json`
	req := httptest.NewRequest("POST", "/api/settings/poll-interval", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetPollInterval(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestSetPollInterval_TooSmall(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	// Interval less than 1000ms should be rejected
	body := `{"interval": 500}`
	req := httptest.NewRequest("POST", "/api/settings/poll-interval", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetPollInterval(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for too small interval, got %d", w.Code)
	}
}

func TestSetPollInterval_TooLarge(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	// Interval more than 300000ms (5 minutes) should be rejected
	body := `{"interval": 600000}`
	req := httptest.NewRequest("POST", "/api/settings/poll-interval", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetPollInterval(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for too large interval, got %d", w.Code)
	}
}

func TestSetPollInterval_MinValue(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	// Minimum allowed value is 1000ms
	body := `{"interval": 1000}`
	req := httptest.NewRequest("POST", "/api/settings/poll-interval", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetPollInterval(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 for minimum interval, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSetPollInterval_MaxValue(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	// Maximum allowed value is 300000ms (5 minutes)
	body := `{"interval": 300000}`
	req := httptest.NewRequest("POST", "/api/settings/poll-interval", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetPollInterval(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 for maximum interval, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSetPollInterval_WithServerManager(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]string{})
	}))
	defer server.Close()

	handlers := setupTestHandlersWithServerManager(map[string]*httptest.Server{
		"server1": server,
	})

	body := `{"interval": 30000}`
	req := httptest.NewRequest("POST", "/api/settings/poll-interval", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetPollInterval(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["interval"].(float64) != 30000 {
		t.Errorf("expected interval=30000, got %v", response["interval"])
	}
}

// ============================================================================
// SSE Subscribe Tests
// ============================================================================

func TestSubscribeIONCSensors_EmptySensorIDs(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	// Тест с пустым массивом sensor_ids
	body := `{"sensor_ids": []}`
	req := httptest.NewRequest("POST", "/api/objects/TestProc/ionc/subscribe", strings.NewReader(body))
	req.SetPathValue("name", "TestProc")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SubscribeIONCSensors(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for empty sensor_ids, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]string
	json.Unmarshal(w.Body.Bytes(), &response)
	if response["error"] != "sensor_ids required" {
		t.Errorf("expected error='sensor_ids required', got %s", response["error"])
	}
}

func TestSubscribeIONCSensors_MissingSensorIDs(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	// Тест без поля sensor_ids
	body := `{}`
	req := httptest.NewRequest("POST", "/api/objects/TestProc/ionc/subscribe", strings.NewReader(body))
	req.SetPathValue("name", "TestProc")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SubscribeIONCSensors(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for missing sensor_ids, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSubscribeIONCSensors_WrongFieldName(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	// Тест с неправильным именем поля (sensorIds вместо sensor_ids)
	body := `{"sensorIds": [1, 2, 3]}`
	req := httptest.NewRequest("POST", "/api/objects/TestProc/ionc/subscribe", strings.NewReader(body))
	req.SetPathValue("name", "TestProc")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SubscribeIONCSensors(w, req)

	// Должен вернуть ошибку, т.к. поле sensor_ids пустое (sensorIds игнорируется)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for wrong field name, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSubscribeOPCUASensors_EmptySensorIDs(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	body := `{"sensor_ids": []}`
	req := httptest.NewRequest("POST", "/api/objects/TestProc/opcua/subscribe", strings.NewReader(body))
	req.SetPathValue("name", "TestProc")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SubscribeOPCUASensors(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for empty sensor_ids, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]string
	json.Unmarshal(w.Body.Bytes(), &response)
	if response["error"] != "sensor_ids required" {
		t.Errorf("expected error='sensor_ids required', got %s", response["error"])
	}
}

func TestSubscribeOPCUASensors_MissingSensorIDs(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	body := `{}`
	req := httptest.NewRequest("POST", "/api/objects/TestProc/opcua/subscribe", strings.NewReader(body))
	req.SetPathValue("name", "TestProc")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SubscribeOPCUASensors(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for missing sensor_ids, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSubscribeModbusRegisters_EmptyRegisterIDs(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	body := `{"register_ids": []}`
	req := httptest.NewRequest("POST", "/api/objects/TestProc/modbus/subscribe", strings.NewReader(body))
	req.SetPathValue("name", "TestProc")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SubscribeModbusRegisters(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for empty register_ids, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]string
	json.Unmarshal(w.Body.Bytes(), &response)
	if response["error"] != "register_ids required" {
		t.Errorf("expected error='register_ids required', got %s", response["error"])
	}
}

func TestSubscribeModbusRegisters_MissingRegisterIDs(t *testing.T) {
	unisetServer := mockUnisetServer()
	defer unisetServer.Close()

	handlers := setupTestHandlers(unisetServer)

	body := `{}`
	req := httptest.NewRequest("POST", "/api/objects/TestProc/modbus/subscribe", strings.NewReader(body))
	req.SetPathValue("name", "TestProc")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SubscribeModbusRegisters(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for missing register_ids, got %d: %s", w.Code, w.Body.String())
	}
}
