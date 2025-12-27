package uniset

import (
	"encoding/json"
	"testing"
)

func TestObjectListType(t *testing.T) {
	var list ObjectList = []string{"Object1", "Object2"}
	if len(list) != 2 {
		t.Errorf("len(ObjectList) = %d, want 2", len(list))
	}
}

func TestTimerFields(t *testing.T) {
	timer := Timer{
		ID:       1,
		Name:     "Timer1",
		Msec:     1000,
		TimeLeft: 500,
		Tick:     100,
	}

	if timer.ID != 1 || timer.Name != "Timer1" {
		t.Error("Timer fields not set correctly")
	}
}

func TestSensorFields(t *testing.T) {
	sensor := Sensor{
		ID:    42,
		Name:  "Temperature",
		Count: 10,
	}

	if sensor.ID != 42 || sensor.Name != "Temperature" || sensor.Count != 10 {
		t.Error("Sensor fields not set correctly")
	}
}

func TestLogServerFields(t *testing.T) {
	ls := LogServer{
		Host:  "localhost",
		Port:  5000,
		State: "connected",
	}

	if ls.Host != "localhost" || ls.Port != 5000 || ls.State != "connected" {
		t.Error("LogServer fields not set correctly")
	}
}

func TestLogServerInfoFields(t *testing.T) {
	info := LogServerInfo{
		Host:         "localhost",
		Name:         "TestLog",
		Port:         5000,
		SessMaxCount: 10,
		Sessions:     []interface{}{},
	}

	if info.SessMaxCount != 10 {
		t.Errorf("SessMaxCount = %d, want 10", info.SessMaxCount)
	}
}

func TestIOVarFields(t *testing.T) {
	iovar := IOVar{
		ID:      1,
		Name:    "Input1",
		Value:   42,
		Comment: "Test input",
		VarType: "int",
	}

	if iovar.ID != 1 || iovar.Name != "Input1" {
		t.Error("IOVar fields not set correctly")
	}
}

func TestIODataFields(t *testing.T) {
	data := IOData{
		In: map[string]IOVar{
			"in1": {ID: 1, Name: "In1"},
		},
		Out: map[string]IOVar{
			"out1": {ID: 2, Name: "Out1"},
		},
	}

	if len(data.In) != 1 || len(data.Out) != 1 {
		t.Error("IOData maps not set correctly")
	}
}

func TestWebsocketsInfoFields(t *testing.T) {
	info := WebsocketsInfo{
		Count: 5,
		Items: []string{"ws1", "ws2"},
	}

	if info.Count != 5 || len(info.Items) != 2 {
		t.Error("WebsocketsInfo fields not set correctly")
	}
}

func TestObjectInfoFields(t *testing.T) {
	info := ObjectInfo{
		ID:                    100,
		Name:                  "TestObject",
		IsActive:              true,
		LostMessages:          5,
		MaxSizeOfMessageQueue: 1000,
		MsgCount:              50,
		ObjectType:            "IONotifyController",
		ExtensionType:         "",
		TransportType:         "tcp",
	}

	if info.ID != 100 || info.Name != "TestObject" {
		t.Error("ObjectInfo fields not set correctly")
	}
	if !info.IsActive {
		t.Error("IsActive should be true")
	}
}

func TestObjectDataFields(t *testing.T) {
	data := ObjectData{
		Name: "TestProc",
		Object: &ObjectInfo{
			ID:   1,
			Name: "TestProc",
		},
		Variables: map[string]interface{}{
			"var1": 100,
		},
	}

	if data.Name != "TestProc" {
		t.Errorf("Name = %q, want %q", data.Name, "TestProc")
	}
	if data.Object == nil {
		t.Error("Object should not be nil")
	}
	if len(data.Variables) != 1 {
		t.Error("Variables should have 1 entry")
	}
}

func TestHelpCommandFields(t *testing.T) {
	cmd := HelpCommand{
		Name: "test/cmd",
		Desc: "Test command",
		Parameters: []HelpParameter{
			{Name: "param1", Desc: "First parameter"},
		},
	}

	if cmd.Name != "test/cmd" || cmd.Desc != "Test command" {
		t.Error("HelpCommand fields not set correctly")
	}
	if len(cmd.Parameters) != 1 {
		t.Error("Parameters should have 1 entry")
	}
}

func TestHelpResponseFields(t *testing.T) {
	resp := HelpResponse{
		Help: []HelpCommand{
			{Name: "cmd1", Desc: "Cmd 1"},
			{Name: "cmd2", Desc: "Cmd 2"},
		},
	}

	if len(resp.Help) != 2 {
		t.Errorf("Help length = %d, want 2", len(resp.Help))
	}
}

func TestObjectInfoJSONParsing(t *testing.T) {
	jsonStr := `{
		"id": 123,
		"name": "TestObj",
		"objectType": "ModbusMaster",
		"isActive": true,
		"lostMessages": 0,
		"maxSizeOfMessageQueue": 500,
		"msgCount": 10,
		"transportType": "tcp"
	}`

	var info ObjectInfo
	if err := json.Unmarshal([]byte(jsonStr), &info); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if info.ID != 123 {
		t.Errorf("ID = %d, want 123", info.ID)
	}
	if info.ObjectType != "ModbusMaster" {
		t.Errorf("ObjectType = %q, want %q", info.ObjectType, "ModbusMaster")
	}
	if info.TransportType != "tcp" {
		t.Errorf("TransportType = %q, want %q", info.TransportType, "tcp")
	}
}

func TestLogServerJSONParsing(t *testing.T) {
	jsonStr := `{
		"host": "192.168.1.1",
		"port": 5001,
		"state": "active"
	}`

	var ls LogServer
	if err := json.Unmarshal([]byte(jsonStr), &ls); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if ls.Host != "192.168.1.1" {
		t.Errorf("Host = %q, want %q", ls.Host, "192.168.1.1")
	}
	if ls.Port != 5001 {
		t.Errorf("Port = %d, want 5001", ls.Port)
	}
}

func TestIODataJSONParsing(t *testing.T) {
	jsonStr := `{
		"in": {
			"input1": {"id": 1, "name": "AI_1", "value": 100}
		},
		"out": {
			"output1": {"id": 2, "name": "AO_1", "value": 50}
		}
	}`

	var io IOData
	if err := json.Unmarshal([]byte(jsonStr), &io); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if len(io.In) != 1 {
		t.Errorf("In length = %d, want 1", len(io.In))
	}
	if len(io.Out) != 1 {
		t.Errorf("Out length = %d, want 1", len(io.Out))
	}

	if io.In["input1"].Name != "AI_1" {
		t.Errorf("In[input1].Name = %q, want %q", io.In["input1"].Name, "AI_1")
	}
}
