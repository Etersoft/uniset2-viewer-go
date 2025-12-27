package uwsgate

import "testing"

func TestSensorDataHasError(t *testing.T) {
	tests := []struct {
		name     string
		error    interface{}
		expected bool
	}{
		{"nil error", nil, false},
		{"int zero", int(0), false},
		{"int nonzero", int(5), true},
		{"float64 zero", float64(0), false},
		{"float64 nonzero", float64(3.5), true},
		{"empty string", "", false},
		{"string zero", "0", false},
		{"string nonzero", "error", true},
		{"bool (unsupported type)", true, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &SensorData{Error: tt.error}
			if got := s.HasError(); got != tt.expected {
				t.Errorf("HasError() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestSensorDataErrorCode(t *testing.T) {
	tests := []struct {
		name     string
		error    interface{}
		expected int
	}{
		{"nil error", nil, 0},
		{"int zero", int(0), 0},
		{"int value", int(42), 42},
		{"float64 zero", float64(0), 0},
		{"float64 value", float64(15.7), 15},
		{"empty string", "", 0},
		{"string value", "error", 0},
		{"bool (unsupported type)", true, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &SensorData{Error: tt.error}
			if got := s.ErrorCode(); got != tt.expected {
				t.Errorf("ErrorCode() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestSensorDataFields(t *testing.T) {
	s := SensorData{
		Type:       "SensorInfo",
		ID:         12345,
		Name:       "TestSensor",
		Value:      100,
		Error:      nil,
		TVSec:      1234567890,
		TVNsec:     123456789,
		IOType:     "AI",
		Node:       1,
		SMTVSec:    1234567890,
		SMTVNsec:   123456789,
		SupplierID: 5,
		Supplier:   "TestSupplier",
	}

	if s.Type != "SensorInfo" {
		t.Errorf("Type = %q, want %q", s.Type, "SensorInfo")
	}
	if s.ID != 12345 {
		t.Errorf("ID = %d, want %d", s.ID, 12345)
	}
	if s.Name != "TestSensor" {
		t.Errorf("Name = %q, want %q", s.Name, "TestSensor")
	}
	if s.Value != 100 {
		t.Errorf("Value = %d, want %d", s.Value, 100)
	}
	if s.IOType != "AI" {
		t.Errorf("IOType = %q, want %q", s.IOType, "AI")
	}
}

func TestResponseFields(t *testing.T) {
	resp := Response{
		Data: []SensorData{
			{Name: "Sensor1", Value: 10},
			{Name: "Sensor2", Value: 20},
		},
	}

	if len(resp.Data) != 2 {
		t.Errorf("Data length = %d, want 2", len(resp.Data))
	}
	if resp.Data[0].Name != "Sensor1" {
		t.Errorf("Data[0].Name = %q, want %q", resp.Data[0].Name, "Sensor1")
	}
	if resp.Data[1].Value != 20 {
		t.Errorf("Data[1].Value = %d, want %d", resp.Data[1].Value, 20)
	}
}

func TestSensorFields(t *testing.T) {
	s := Sensor{
		ID:         100,
		Name:       "MySensor",
		IOType:     "DI",
		TextName:   "My Digital Input",
		Value:      1,
		Error:      0,
		Timestamp:  1234567890,
		IsDiscrete: true,
		IsInput:    true,
		SupplierID: 5,
		Supplier:   "Supplier",
	}

	if s.ID != 100 {
		t.Errorf("ID = %d, want 100", s.ID)
	}
	if !s.IsDiscrete {
		t.Error("IsDiscrete should be true")
	}
	if !s.IsInput {
		t.Error("IsInput should be true")
	}
}

func TestSubscribeRequestFields(t *testing.T) {
	req := SubscribeRequest{
		Sensors: []string{"Sensor1", "Sensor2", "Sensor3"},
	}

	if len(req.Sensors) != 3 {
		t.Errorf("Sensors length = %d, want 3", len(req.Sensors))
	}
}

func TestSensorsResponseFields(t *testing.T) {
	resp := SensorsResponse{
		Sensors: []Sensor{
			{Name: "S1", Value: 10},
			{Name: "S2", Value: 20},
		},
	}

	if len(resp.Sensors) != 2 {
		t.Errorf("Sensors length = %d, want 2", len(resp.Sensors))
	}
}
