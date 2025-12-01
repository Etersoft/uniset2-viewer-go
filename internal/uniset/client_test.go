package uniset

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetObjectList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v01/list" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]string{"Object1", "Object2", "Object3"})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	list, err := client.GetObjectList()
	if err != nil {
		t.Fatalf("GetObjectList failed: %v", err)
	}

	if len(list) != 3 {
		t.Errorf("expected 3 objects, got %d", len(list))
	}

	if list[0] != "Object1" {
		t.Errorf("expected Object1, got %s", list[0])
	}
}

func TestGetObjectData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v01/TestProc" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
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
					"out": map[string]interface{}{
						"output1": map[string]interface{}{
							"id":    2,
							"name":  "Output1_C",
							"value": 1,
						},
					},
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewClient(server.URL)
	data, err := client.GetObjectData("TestProc")
	if err != nil {
		t.Fatalf("GetObjectData failed: %v", err)
	}

	if data.Name != "TestProc" {
		t.Errorf("expected name TestProc, got %s", data.Name)
	}

	if len(data.Variables) != 2 {
		t.Errorf("expected 2 variables, got %d", len(data.Variables))
	}

	if data.Variables["var1"] != "100" {
		t.Errorf("expected var1=100, got %v", data.Variables["var1"])
	}

	if data.IO == nil {
		t.Fatal("expected IO data")
	}

	if len(data.IO.In) != 1 {
		t.Errorf("expected 1 input, got %d", len(data.IO.In))
	}

	if len(data.IO.Out) != 1 {
		t.Errorf("expected 1 output, got %d", len(data.IO.Out))
	}
}

func TestGetObjectDataMinimal(t *testing.T) {
	// Тест для объектов которые возвращают только "object" (как UniSetActivator)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Возвращаем только object без ключа с именем объекта
		json.NewEncoder(w).Encode(map[string]interface{}{
			"object": map[string]interface{}{
				"id":         -1,
				"name":       "TestActivator",
				"objectType": "UniSetActivator",
				"isActive":   true,
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	data, err := client.GetObjectData("TestActivator")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if data.Object == nil {
		t.Error("expected object info to be parsed")
	}
	if data.Object.ObjectType != "UniSetActivator" {
		t.Errorf("expected objectType=UniSetActivator, got %s", data.Object.ObjectType)
	}
	if data.RawData == nil {
		t.Error("expected raw_data to be populated")
	}
}

func TestGetObjectHelp(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v01/TestProc/help" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		response := map[string]interface{}{
			"help": []map[string]interface{}{
				{
					"name": "params/get",
					"desc": "get parameter value",
				},
				{
					"name": "params/set",
					"desc": "set parameter value",
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewClient(server.URL)
	help, err := client.GetObjectHelp("TestProc")
	if err != nil {
		t.Fatalf("GetObjectHelp failed: %v", err)
	}

	if len(help.Help) != 2 {
		t.Errorf("expected 2 help commands, got %d", len(help.Help))
	}

	if help.Help[0].Name != "params/get" {
		t.Errorf("expected params/get, got %s", help.Help[0].Name)
	}
}

func TestClientHttpError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetObjectList()
	if err == nil {
		t.Error("expected error for HTTP 500")
	}
}

func TestClientConnectionError(t *testing.T) {
	client := NewClient("http://localhost:99999")
	_, err := client.GetObjectList()
	if err == nil {
		t.Error("expected error for connection failure")
	}
}
