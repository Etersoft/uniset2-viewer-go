package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/poller"
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
	return NewHandlers(client, store, p)
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
	handlers := NewHandlers(client, store, p)

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
	handlers := NewHandlers(client, store, p)

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
