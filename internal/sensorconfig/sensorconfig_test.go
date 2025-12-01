package sensorconfig

import (
	"testing"
)

const testXML = `<?xml version="1.0" encoding="utf-8"?>
<UNISETPLC>
	<sensors name="Sensors">
		<item id="1" iotype="DI" name="Input1_S" textname="Digital Input 1"/>
		<item id="2" iotype="DI" name="Input2_S" textname="Digital Input 2"/>
		<item id="101" iotype="DO" name="Output1_C" textname="Digital Output 1"/>
		<item id="201" iotype="AI" name="Temp_AS" textname="Temperature"/>
		<item id="301" iotype="AO" name="Valve_C" textname="Valve Control"/>
	</sensors>
</UNISETPLC>`

func TestParse(t *testing.T) {
	cfg, err := Parse([]byte(testXML))
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}

	if cfg.Count() != 5 {
		t.Errorf("expected 5 sensors, got %d", cfg.Count())
	}
}

func TestGetByID(t *testing.T) {
	cfg, _ := Parse([]byte(testXML))

	sensor := cfg.GetByID(1)
	if sensor == nil {
		t.Fatal("expected sensor with ID 1")
	}

	if sensor.Name != "Input1_S" {
		t.Errorf("expected name Input1_S, got %s", sensor.Name)
	}

	if sensor.TextName != "Digital Input 1" {
		t.Errorf("expected textname 'Digital Input 1', got '%s'", sensor.TextName)
	}

	if sensor.IOType != IOTypeDI {
		t.Errorf("expected IOType DI, got %s", sensor.IOType)
	}
}

func TestGetByName(t *testing.T) {
	cfg, _ := Parse([]byte(testXML))

	sensor := cfg.GetByName("Temp_AS")
	if sensor == nil {
		t.Fatal("expected sensor with name Temp_AS")
	}

	if sensor.ID != 201 {
		t.Errorf("expected ID 201, got %d", sensor.ID)
	}

	if sensor.IOType != IOTypeAI {
		t.Errorf("expected IOType AI, got %s", sensor.IOType)
	}
}

func TestIOTypeIsDiscrete(t *testing.T) {
	cfg, _ := Parse([]byte(testXML))

	discrete := cfg.GetDiscrete()
	if len(discrete) != 3 {
		t.Errorf("expected 3 discrete sensors (2 DI + 1 DO), got %d", len(discrete))
	}

	for _, s := range discrete {
		if !s.IOType.IsDiscrete() {
			t.Errorf("sensor %s should be discrete", s.Name)
		}
	}
}

func TestIOTypeIsAnalog(t *testing.T) {
	cfg, _ := Parse([]byte(testXML))

	analog := cfg.GetAnalog()
	if len(analog) != 2 {
		t.Errorf("expected 2 analog sensors (1 AI + 1 AO), got %d", len(analog))
	}

	for _, s := range analog {
		if !s.IOType.IsAnalog() {
			t.Errorf("sensor %s should be analog", s.Name)
		}
	}
}

func TestIOTypeIsInput(t *testing.T) {
	tests := []struct {
		iotype   IOType
		isInput  bool
		isOutput bool
	}{
		{IOTypeDI, true, false},
		{IOTypeDO, false, true},
		{IOTypeAI, true, false},
		{IOTypeAO, false, true},
	}

	for _, tc := range tests {
		if tc.iotype.IsInput() != tc.isInput {
			t.Errorf("%s.IsInput() = %v, want %v", tc.iotype, tc.iotype.IsInput(), tc.isInput)
		}
		if tc.iotype.IsOutput() != tc.isOutput {
			t.Errorf("%s.IsOutput() = %v, want %v", tc.iotype, tc.iotype.IsOutput(), tc.isOutput)
		}
	}
}

func TestToInfo(t *testing.T) {
	cfg, _ := Parse([]byte(testXML))

	sensor := cfg.GetByID(1)
	info := sensor.ToInfo()

	if info.ID != 1 {
		t.Errorf("expected ID 1, got %d", info.ID)
	}
	if info.Name != "Input1_S" {
		t.Errorf("expected name Input1_S, got %s", info.Name)
	}
	if info.IOType != "DI" {
		t.Errorf("expected IOType DI, got %s", info.IOType)
	}
	if info.TextName != "Digital Input 1" {
		t.Errorf("expected textname 'Digital Input 1', got '%s'", info.TextName)
	}
	if !info.IsDiscrete {
		t.Error("expected IsDiscrete = true")
	}
	if !info.IsInput {
		t.Error("expected IsInput = true")
	}
}

func TestNilConfig(t *testing.T) {
	var cfg *SensorConfig

	if cfg.GetByID(1) != nil {
		t.Error("expected nil for nil config")
	}
	if cfg.GetByName("test") != nil {
		t.Error("expected nil for nil config")
	}
	if cfg.GetAll() != nil {
		t.Error("expected nil for nil config")
	}
	if cfg.Count() != 0 {
		t.Error("expected 0 for nil config")
	}
}

func TestCaseInsensitiveIOType(t *testing.T) {
	xmlLower := `<?xml version="1.0"?>
<UNISETPLC>
	<sensors>
		<item id="1" iotype="di" name="Test" textname="Test"/>
	</sensors>
</UNISETPLC>`

	cfg, err := Parse([]byte(xmlLower))
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}

	sensor := cfg.GetByID(1)
	if sensor.IOType != IOTypeDI {
		t.Errorf("expected IOType DI (normalized), got %s", sensor.IOType)
	}
}
