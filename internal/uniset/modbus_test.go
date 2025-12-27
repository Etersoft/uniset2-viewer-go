package uniset

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetMBStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expectAPIVersionPath(t, r.URL.Path, "MBMaster/status")
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
	resp, err := client.GetMBStatus("MBMaster")
	if err != nil {
		t.Fatalf("GetMBStatus failed: %v", err)
	}

	if resp.Status == nil {
		t.Error("expected status data")
	}
}

func TestGetMBStatusError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "ERROR",
			"error":  "connection failed",
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetMBStatus("MBMaster")
	if err == nil {
		t.Error("expected error for ERROR result")
	}
}

func TestGetMBParams(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"params": map[string]interface{}{
				"pollTime": 1000,
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetMBParams("MBMaster", []string{"pollTime"})
	if err != nil {
		t.Fatalf("GetMBParams failed: %v", err)
	}

	if resp.Params == nil {
		t.Error("expected params data")
	}
}

func TestGetMBParamsEmpty(t *testing.T) {
	client := NewClient("http://localhost")
	_, err := client.GetMBParams("MBMaster", []string{})
	if err == nil {
		t.Error("expected error for empty params")
	}
}

func TestSetMBParams(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"updated": map[string]interface{}{
				"pollTime": 2000,
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.SetMBParams("MBMaster", map[string]interface{}{"pollTime": 2000})
	if err != nil {
		t.Fatalf("SetMBParams failed: %v", err)
	}

	if resp.Updated == nil {
		t.Error("expected updated data")
	}
}

func TestSetMBParamsEmpty(t *testing.T) {
	client := NewClient("http://localhost")
	_, err := client.SetMBParams("MBMaster", map[string]interface{}{})
	if err == nil {
		t.Error("expected error for empty params")
	}
}

func TestGetMBRegisters(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"registers": []map[string]interface{}{
				{"id": 1, "name": "Reg1"},
			},
			"total": 100,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetMBRegisters("MBMaster", "Reg", "AI", 50, 0)
	if err != nil {
		t.Fatalf("GetMBRegisters failed: %v", err)
	}

	if len(resp.Registers) != 1 {
		t.Errorf("expected 1 register, got %d", len(resp.Registers))
	}
}

func TestGetMBDevices(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"devices": []map[string]interface{}{
				{"addr": 1, "respond": true},
			},
			"count": 1,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetMBDevices("MBMaster")
	if err != nil {
		t.Fatalf("GetMBDevices failed: %v", err)
	}

	if len(resp.Devices) != 1 {
		t.Errorf("expected 1 device, got %d", len(resp.Devices))
	}
}

func TestGetMBMode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result":  "OK",
			"mode":    "Work",
			"mode_id": 1,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetMBMode("MBMaster")
	if err != nil {
		t.Fatalf("GetMBMode failed: %v", err)
	}

	if resp.Mode != "Work" {
		t.Errorf("expected mode Work, got %s", resp.Mode)
	}
}

func TestGetMBModeSupported(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result":    "OK",
			"supported": []string{"Work", "Disabled"},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetMBModeSupported("MBMaster")
	if err != nil {
		t.Fatalf("GetMBModeSupported failed: %v", err)
	}

	if len(resp.Supported) != 2 {
		t.Errorf("expected 2 modes, got %d", len(resp.Supported))
	}
}

func TestSetMBMode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result":  "OK",
			"mode":    "Disabled",
			"mode_id": 2,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.SetMBMode("MBMaster", "Disabled")
	if err != nil {
		t.Fatalf("SetMBMode failed: %v", err)
	}

	if resp.Mode != "Disabled" {
		t.Errorf("expected mode Disabled, got %s", resp.Mode)
	}
}

func TestTakeMBControl(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result":            "OK",
			"httpControlActive": 1,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.TakeMBControl("MBMaster")
	if err != nil {
		t.Fatalf("TakeMBControl failed: %v", err)
	}

	if resp.HTTPControlActive != 1 {
		t.Errorf("expected httpControlActive=1, got %d", resp.HTTPControlActive)
	}
}

func TestReleaseMBControl(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result":            "OK",
			"httpControlActive": 0,
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.ReleaseMBControl("MBMaster")
	if err != nil {
		t.Fatalf("ReleaseMBControl failed: %v", err)
	}

	if resp.HTTPControlActive != 0 {
		t.Errorf("expected httpControlActive=0, got %d", resp.HTTPControlActive)
	}
}

func TestGetMBRegisterValues(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"result": "OK",
			"sensors": []map[string]interface{}{
				{"id": 1, "name": "Reg1", "value": 100},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	resp, err := client.GetMBRegisterValues("MBMaster", "1,2,3")
	if err != nil {
		t.Fatalf("GetMBRegisterValues failed: %v", err)
	}

	if len(resp.Sensors) != 1 {
		t.Errorf("expected 1 sensor, got %d", len(resp.Sensors))
	}
}

func TestMBResponseTypes(t *testing.T) {
	// Test struct field assignments
	statusResp := MBStatusResponse{
		Result: "OK",
		Status: map[string]interface{}{"key": "value"},
	}
	if statusResp.Result != "OK" {
		t.Error("MBStatusResponse.Result not set")
	}

	paramsResp := MBParamsResponse{
		Result:  "OK",
		Params:  map[string]interface{}{"param": 1},
		Updated: map[string]interface{}{"param": 2},
		Unknown: []string{"unknown1"},
	}
	if paramsResp.Result != "OK" {
		t.Error("MBParamsResponse.Result not set")
	}

	regResp := MBRegistersResponse{
		Result:    "OK",
		Registers: []map[string]interface{}{{"id": 1}},
		Sensors:   []map[string]interface{}{{"id": 2}},
		Total:     100,
		Count:     50,
		Limit:     50,
		Offset:    0,
	}
	if regResp.Total != 100 {
		t.Error("MBRegistersResponse.Total not set")
	}

	devResp := MBDevicesResponse{
		Result:  "OK",
		Devices: []map[string]interface{}{{"addr": 1}},
		Count:   1,
	}
	if devResp.Count != 1 {
		t.Error("MBDevicesResponse.Count not set")
	}

	modeResp := MBModeResponse{
		Result:    "OK",
		Mode:      "Work",
		ModeID:    1,
		Supported: []string{"Work", "Disabled"},
	}
	if modeResp.ModeID != 1 {
		t.Error("MBModeResponse.ModeID not set")
	}

	ctrlResp := MBControlResponse{
		Result:            "OK",
		Error:             "",
		HTTPControlActive: 1,
	}
	if ctrlResp.HTTPControlActive != 1 {
		t.Error("MBControlResponse.HTTPControlActive not set")
	}

	device := MBDevice{
		Addr:     1,
		Respond:  true,
		DType:    "RTU",
		RegCount: 100,
		Mode:     1,
		SafeMode: 0,
	}
	if device.Addr != 1 || device.RegCount != 100 {
		t.Error("MBDevice fields not set")
	}

	reg := MBRegister{
		ID:        1,
		Name:      "Reg1",
		IOType:    "AI",
		Value:     100,
		VType:     "word",
		Device:    map[string]interface{}{},
		Register:  map[string]interface{}{},
		NBit:      0,
		Mask:      0xFFFF,
		Precision: 2,
	}
	if reg.ID != 1 || reg.Precision != 2 {
		t.Error("MBRegister fields not set")
	}
}
