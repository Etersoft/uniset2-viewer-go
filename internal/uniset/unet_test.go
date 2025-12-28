package uniset

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetUNetStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expectAPIVersionPath(t, r.URL.Path, "UNetExchange/status")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"status": map[string]interface{}{
				"activated":    true,
				"maxHeartBeat": 10,
				"steptime":     1000,
				"no_sender":    false,
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetUNetStatus("UNetExchange")
	if err != nil {
		t.Fatalf("GetUNetStatus failed: %v", err)
	}

	if resp.Status == nil {
		t.Error("expected status data")
	}

	if activated, ok := resp.Status["activated"].(bool); !ok || !activated {
		t.Error("expected activated=true")
	}
}

func TestGetUNetStatusError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "ERROR",
			"error":  "not available",
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetUNetStatus("UNetExchange")
	if err == nil {
		t.Error("expected error for ERROR result")
	}
}

func TestGetUNetStatusHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetUNetStatus("UNetExchange")
	if err == nil {
		t.Error("expected error for HTTP 500")
	}
}

func TestGetUNetReceivers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expectAPIVersionPath(t, r.URL.Path, "UNetExchange/receivers")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"receivers": []map[string]interface{}{
				{
					"chan1": map[string]interface{}{
						"transport": "127.255.255.255:2049",
						"mode":      "ACTIVE",
						"recvOK":    true,
					},
					"chan2": map[string]interface{}{
						"transport": "192.168.56.255:3001",
						"mode":      "PASSIVE",
						"recvOK":    false,
					},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetUNetReceivers("UNetExchange")
	if err != nil {
		t.Fatalf("GetUNetReceivers failed: %v", err)
	}

	if len(resp.Receivers) != 1 {
		t.Errorf("expected 1 receiver node, got %d", len(resp.Receivers))
	}
}

func TestGetUNetReceiversError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "ERROR",
			"error":  "not available",
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetUNetReceivers("UNetExchange")
	if err == nil {
		t.Error("expected error for ERROR result")
	}
}

func TestGetUNetReceiversHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("not found"))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetUNetReceivers("UNetExchange")
	if err == nil {
		t.Error("expected error for HTTP 404")
	}
}

func TestGetUNetSenders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expectAPIVersionPath(t, r.URL.Path, "UNetExchange/senders")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"senders": map[string]interface{}{
				"chan1": map[string]interface{}{
					"transport":   "127.255.255.255:2048",
					"mode":        "Enabled",
					"items":       2,
					"lastpacknum": 561,
				},
				"chan2": map[string]interface{}{
					"transport":   "192.168.56.255:3000",
					"mode":        "Enabled",
					"items":       2,
					"lastpacknum": 561,
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetUNetSenders("UNetExchange")
	if err != nil {
		t.Fatalf("GetUNetSenders failed: %v", err)
	}

	if resp.Senders == nil {
		t.Error("expected senders data")
	}

	if _, ok := resp.Senders["chan1"]; !ok {
		t.Error("expected chan1 in senders")
	}
}

func TestGetUNetSendersError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "ERROR",
			"error":  "not available",
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetUNetSenders("UNetExchange")
	if err == nil {
		t.Error("expected error for ERROR result")
	}
}

func TestGetUNetSendersHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte("bad gateway"))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetUNetSenders("UNetExchange")
	if err == nil {
		t.Error("expected error for HTTP 502")
	}
}

func TestGetUNetStatusInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("invalid json"))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetUNetStatus("UNetExchange")
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestGetUNetReceiversInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{invalid"))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetUNetReceivers("UNetExchange")
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestGetUNetSendersInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not json"))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetUNetSenders("UNetExchange")
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}
