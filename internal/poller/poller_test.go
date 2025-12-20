package poller

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pv/uniset-panel/internal/storage"
	"github.com/pv/uniset-panel/internal/uniset"
)

func newMockServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	return httptest.NewServer(handler)
}

func normalizeUniSetPath(path string) string {
	if strings.HasPrefix(path, "/api/") {
		trimmed := strings.TrimPrefix(path, "/api/")
		parts := strings.SplitN(trimmed, "/", 2)
		if len(parts) == 2 {
			return "/" + parts[1]
		}
	}
	return path
}

func TestPollerWatchUnwatch(t *testing.T) {
	store := storage.NewMemoryStorage()
	defer store.Close()

	client := uniset.NewClient("http://localhost:9999")
	p := New(client, store, time.Second, time.Hour)

	// Initially empty
	p.mu.RLock()
	if len(p.watchedObjects) != 0 {
		t.Error("expected empty watched objects")
	}
	p.mu.RUnlock()

	// Watch objects
	p.Watch("TestProc")
	p.Watch("Controller")

	p.mu.RLock()
	if len(p.watchedObjects) != 2 {
		t.Errorf("expected 2 watched objects, got %d", len(p.watchedObjects))
	}
	if !p.watchedObjects["TestProc"] {
		t.Error("TestProc should be watched")
	}
	p.mu.RUnlock()

	// Unwatch one
	p.Unwatch("TestProc")

	p.mu.RLock()
	if len(p.watchedObjects) != 1 {
		t.Errorf("expected 1 watched object, got %d", len(p.watchedObjects))
	}
	if p.watchedObjects["TestProc"] {
		t.Error("TestProc should not be watched")
	}
	if !p.watchedObjects["Controller"] {
		t.Error("Controller should still be watched")
	}
	p.mu.RUnlock()
}

func TestPollerGetLastData(t *testing.T) {
	store := storage.NewMemoryStorage()
	defer store.Close()

	// Create mock server
	server := newMockServer(t, func(w http.ResponseWriter, r *http.Request) {
		response := map[string]interface{}{
			"TestProc": map[string]interface{}{
				"Variables": map[string]interface{}{
					"counter": "42",
					"status":  "running",
				},
			},
			"object": map[string]interface{}{
				"id":   6000,
				"name": "TestProc",
			},
		}
		json.NewEncoder(w).Encode(response)
	})
	defer server.Close()

	client := uniset.NewClient(server.URL)
	p := New(client, store, 100*time.Millisecond, time.Hour)

	// Initially nil
	if p.GetLastData("TestProc") != nil {
		t.Error("expected nil for unwatched object")
	}

	// Watch and poll
	p.Watch("TestProc")

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	go p.Run(ctx)

	// Wait for first poll
	time.Sleep(200 * time.Millisecond)

	data := p.GetLastData("TestProc")
	if data == nil {
		t.Fatal("expected data after poll")
	}

	if data.Variables == nil {
		t.Fatal("expected variables in data")
	}

	if data.Variables["counter"] != "42" {
		t.Errorf("expected counter=42, got %v", data.Variables["counter"])
	}
}

func TestPollerPollSavesToStorage(t *testing.T) {
	store := storage.NewMemoryStorage()
	defer store.Close()

	var pollCount int32

	// Create mock server
	server := newMockServer(t, func(w http.ResponseWriter, r *http.Request) {
		count := atomic.AddInt32(&pollCount, 1)
		response := map[string]interface{}{
			"TestProc": map[string]interface{}{
				"Variables": map[string]interface{}{
					"value": count * 10,
				},
				"io": map[string]interface{}{
					"in": map[string]interface{}{
						"sensor1": map[string]interface{}{
							"id":    1,
							"name":  "Sensor1",
							"value": count,
						},
					},
					"out": map[string]interface{}{
						"actuator1": map[string]interface{}{
							"id":    2,
							"name":  "Actuator1",
							"value": count * 2,
						},
					},
				},
			},
			"object": map[string]interface{}{
				"id":   6000,
				"name": "TestProc",
			},
		}
		json.NewEncoder(w).Encode(response)
	})
	defer server.Close()

	client := uniset.NewClient(server.URL)
	p := New(client, store, 50*time.Millisecond, time.Hour)

	p.Watch("TestProc")

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	go p.Run(ctx)

	// Wait for a few polls
	time.Sleep(180 * time.Millisecond)

	// Check variable was saved (пустой serverID = default)
	history, err := store.GetLatest("", "TestProc", "value", 10)
	if err != nil {
		t.Fatalf("GetLatest failed: %v", err)
	}

	if len(history.Points) == 0 {
		t.Error("expected variable history points")
	}

	// Check IO was saved
	ioHistory, err := store.GetLatest("", "TestProc", "io.in.sensor1", 10)
	if err != nil {
		t.Fatalf("GetLatest for IO failed: %v", err)
	}

	if len(ioHistory.Points) == 0 {
		t.Error("expected IO history points")
	}

	// Check output was saved
	outHistory, err := store.GetLatest("", "TestProc", "io.out.actuator1", 10)
	if err != nil {
		t.Fatalf("GetLatest for output failed: %v", err)
	}

	if len(outHistory.Points) == 0 {
		t.Error("expected output history points")
	}
}

func TestPollerContextCancellation(t *testing.T) {
	store := storage.NewMemoryStorage()
	defer store.Close()

	var pollCount int32

	server := newMockServer(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&pollCount, 1)
		response := map[string]interface{}{
			"TestProc": map[string]interface{}{
				"Variables": map[string]interface{}{},
			},
		}
		json.NewEncoder(w).Encode(response)
	})
	defer server.Close()

	client := uniset.NewClient(server.URL)
	p := New(client, store, 50*time.Millisecond, time.Hour)

	p.Watch("TestProc")

	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		p.Run(ctx)
		close(done)
	}()

	// Let it poll a few times
	time.Sleep(150 * time.Millisecond)

	// Cancel context
	cancel()

	// Wait for Run to exit
	select {
	case <-done:
		// OK
	case <-time.After(time.Second):
		t.Fatal("Run did not exit after context cancellation")
	}

	countBefore := atomic.LoadInt32(&pollCount)

	// Wait and verify no more polls
	time.Sleep(100 * time.Millisecond)

	countAfter := atomic.LoadInt32(&pollCount)

	if countAfter != countBefore {
		t.Error("polling continued after context cancellation")
	}
}

func TestPollerHandlesErrors(t *testing.T) {
	store := storage.NewMemoryStorage()
	defer store.Close()

	var reqCount int32

	// Server that fails on first request, succeeds on second
	server := newMockServer(t, func(w http.ResponseWriter, r *http.Request) {
		count := atomic.AddInt32(&reqCount, 1)
		if count == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		response := map[string]interface{}{
			"TestProc": map[string]interface{}{
				"Variables": map[string]interface{}{
					"value": "ok",
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	})
	defer server.Close()

	client := uniset.NewClient(server.URL)
	p := New(client, store, 50*time.Millisecond, time.Hour)

	p.Watch("TestProc")

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	go p.Run(ctx)

	time.Sleep(180 * time.Millisecond)

	// Should have recovered and saved data
	data := p.GetLastData("TestProc")
	if data == nil {
		t.Error("expected data after recovery from error")
	}
}

func TestPollerMultipleObjects(t *testing.T) {
	store := storage.NewMemoryStorage()
	defer store.Close()

	server := newMockServer(t, func(w http.ResponseWriter, r *http.Request) {
		path := normalizeUniSetPath(r.URL.Path)
		var response map[string]interface{}

		switch path {
		case "/Obj1":
			response = map[string]interface{}{
				"Obj1": map[string]interface{}{
					"Variables": map[string]interface{}{"var": "1"},
				},
			}
		case "/Obj2":
			response = map[string]interface{}{
				"Obj2": map[string]interface{}{
					"Variables": map[string]interface{}{"var": "2"},
				},
			}
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(response)
	})
	defer server.Close()

	client := uniset.NewClient(server.URL)
	p := New(client, store, 50*time.Millisecond, time.Hour)

	p.Watch("Obj1")
	p.Watch("Obj2")

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()

	go p.Run(ctx)

	time.Sleep(130 * time.Millisecond)

	data1 := p.GetLastData("Obj1")
	data2 := p.GetLastData("Obj2")

	if data1 == nil || data2 == nil {
		t.Fatal("expected data for both objects")
	}

	if data1.Variables["var"] != "1" {
		t.Errorf("expected Obj1.var=1, got %v", data1.Variables["var"])
	}
	if data2.Variables["var"] != "2" {
		t.Errorf("expected Obj2.var=2, got %v", data2.Variables["var"])
	}
}

func TestPollerCleanup(t *testing.T) {
	store := storage.NewMemoryStorage()
	defer store.Close()

	server := newMockServer(t, func(w http.ResponseWriter, r *http.Request) {
		response := map[string]interface{}{
			"TestProc": map[string]interface{}{
				"Variables": map[string]interface{}{"v": "1"},
			},
		}
		json.NewEncoder(w).Encode(response)
	})
	defer server.Close()

	client := uniset.NewClient(server.URL)
	// Very short TTL for testing
	p := New(client, store, 50*time.Millisecond, time.Millisecond)

	// Force cleanup time to be in the past
	p.lastCleanupTime = time.Now().Add(-2 * time.Minute)

	p.Watch("TestProc")

	// Single poll should trigger cleanup
	p.poll()

	// Verify cleanup was called (lastCleanupTime should be updated)
	if time.Since(p.lastCleanupTime) > time.Second {
		t.Error("cleanup time should have been updated")
	}
}

func TestPollerEventCallback(t *testing.T) {
	store := storage.NewMemoryStorage()
	defer store.Close()

	server := newMockServer(t, func(w http.ResponseWriter, r *http.Request) {
		response := map[string]interface{}{
			"TestProc": map[string]interface{}{
				"Variables": map[string]interface{}{
					"value": "42",
				},
			},
			"object": map[string]interface{}{
				"id":   6000,
				"name": "TestProc",
			},
		}
		json.NewEncoder(w).Encode(response)
	})
	defer server.Close()

	client := uniset.NewClient(server.URL)
	p := New(client, store, 50*time.Millisecond, time.Hour)

	// Счётчик вызовов callback
	var callbackCount int32
	var lastObjectName string
	var mu sync.Mutex

	p.SetEventCallback(func(objectName string, data *uniset.ObjectData) {
		atomic.AddInt32(&callbackCount, 1)
		mu.Lock()
		lastObjectName = objectName
		mu.Unlock()
	})

	p.Watch("TestProc")

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	go p.Run(ctx)

	// Wait for polls
	time.Sleep(180 * time.Millisecond)

	count := atomic.LoadInt32(&callbackCount)
	if count == 0 {
		t.Error("expected callback to be called at least once")
	}

	mu.Lock()
	objName := lastObjectName
	mu.Unlock()

	if objName != "TestProc" {
		t.Errorf("expected objectName=TestProc, got %s", objName)
	}
}

func TestPollerEventCallbackWithMultipleObjects(t *testing.T) {
	store := storage.NewMemoryStorage()
	defer store.Close()

	server := newMockServer(t, func(w http.ResponseWriter, r *http.Request) {
		path := normalizeUniSetPath(r.URL.Path)
		var response map[string]interface{}

		switch path {
		case "/Obj1":
			response = map[string]interface{}{
				"Obj1": map[string]interface{}{
					"Variables": map[string]interface{}{"var": "1"},
				},
			}
		case "/Obj2":
			response = map[string]interface{}{
				"Obj2": map[string]interface{}{
					"Variables": map[string]interface{}{"var": "2"},
				},
			}
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(response)
	})
	defer server.Close()

	client := uniset.NewClient(server.URL)
	p := New(client, store, 50*time.Millisecond, time.Hour)

	// Отслеживаем какие объекты получили события
	receivedObjects := make(map[string]bool)
	var mu sync.Mutex

	p.SetEventCallback(func(objectName string, data *uniset.ObjectData) {
		mu.Lock()
		receivedObjects[objectName] = true
		mu.Unlock()
	})

	p.Watch("Obj1")
	p.Watch("Obj2")

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()

	go p.Run(ctx)

	time.Sleep(130 * time.Millisecond)

	mu.Lock()
	obj1Received := receivedObjects["Obj1"]
	obj2Received := receivedObjects["Obj2"]
	mu.Unlock()

	if !obj1Received {
		t.Error("expected callback for Obj1")
	}
	if !obj2Received {
		t.Error("expected callback for Obj2")
	}
}

func TestPollerSetEventCallbackNil(t *testing.T) {
	store := storage.NewMemoryStorage()
	defer store.Close()

	server := newMockServer(t, func(w http.ResponseWriter, r *http.Request) {
		response := map[string]interface{}{
			"TestProc": map[string]interface{}{
				"Variables": map[string]interface{}{"v": "1"},
			},
		}
		json.NewEncoder(w).Encode(response)
	})
	defer server.Close()

	client := uniset.NewClient(server.URL)
	p := New(client, store, 50*time.Millisecond, time.Hour)

	// Не устанавливаем callback (nil по умолчанию)
	p.Watch("TestProc")

	// Не должен паниковать при nil callback
	p.poll()

	// Проверяем что данные всё равно сохраняются
	data := p.GetLastData("TestProc")
	if data == nil {
		t.Error("expected data to be saved even without callback")
	}
}
