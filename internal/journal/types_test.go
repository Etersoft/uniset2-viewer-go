package journal

import (
	"testing"
	"time"
)

func TestMessage_Fields(t *testing.T) {
	msg := Message{
		Timestamp: time.Now(),
		Value:     42.5,
		Name:      "Sensor1",
		Message:   "Test message",
		MType:     "Alarm",
		MGroup:    "Group1",
		MCode:     "A001",
	}

	if msg.Name != "Sensor1" {
		t.Errorf("expected Name=Sensor1, got %s", msg.Name)
	}
	if msg.Value != 42.5 {
		t.Errorf("expected Value=42.5, got %f", msg.Value)
	}
	if msg.MType != "Alarm" {
		t.Errorf("expected MType=Alarm, got %s", msg.MType)
	}
}

func TestQueryParams_Defaults(t *testing.T) {
	params := QueryParams{}

	if !params.From.IsZero() {
		t.Error("expected From to be zero time")
	}
	if !params.To.IsZero() {
		t.Error("expected To to be zero time")
	}
	if params.Limit != 0 {
		t.Errorf("expected Limit=0, got %d", params.Limit)
	}
	if params.Offset != 0 {
		t.Errorf("expected Offset=0, got %d", params.Offset)
	}
}

func TestQueryParams_WithFilters(t *testing.T) {
	now := time.Now()
	params := QueryParams{
		From:    now.Add(-1 * time.Hour),
		To:      now,
		MTypes:  []string{"Alarm", "Warning"},
		MGroups: []string{"Group1"},
		Search:  "test",
		Limit:   50,
		Offset:  100,
	}

	if len(params.MTypes) != 2 {
		t.Errorf("expected 2 MTypes, got %d", len(params.MTypes))
	}
	if params.MTypes[0] != "Alarm" {
		t.Errorf("expected first MType=Alarm, got %s", params.MTypes[0])
	}
	if params.Limit != 50 {
		t.Errorf("expected Limit=50, got %d", params.Limit)
	}
}

func TestJournalInfo_Fields(t *testing.T) {
	info := JournalInfo{
		ID:       "abc123",
		Name:     "Production",
		Database: "uniset",
		Table:    "main_messages_src",
		Status:   "connected",
	}

	if info.ID != "abc123" {
		t.Errorf("expected ID=abc123, got %s", info.ID)
	}
	if info.Status != "connected" {
		t.Errorf("expected Status=connected, got %s", info.Status)
	}
}

func TestMessagesResponse_Empty(t *testing.T) {
	resp := MessagesResponse{
		Messages: []Message{},
		Total:    0,
		Offset:   0,
		Limit:    100,
	}

	if len(resp.Messages) != 0 {
		t.Errorf("expected 0 messages, got %d", len(resp.Messages))
	}
	if resp.Total != 0 {
		t.Errorf("expected Total=0, got %d", resp.Total)
	}
}

func TestMessagesResponse_WithData(t *testing.T) {
	resp := MessagesResponse{
		Messages: []Message{
			{Name: "Sensor1", MType: "Alarm"},
			{Name: "Sensor2", MType: "Warning"},
		},
		Total:  100,
		Offset: 0,
		Limit:  50,
	}

	if len(resp.Messages) != 2 {
		t.Errorf("expected 2 messages, got %d", len(resp.Messages))
	}
	if resp.Total != 100 {
		t.Errorf("expected Total=100, got %d", resp.Total)
	}
}

func TestSSEMessage_Fields(t *testing.T) {
	sseMsg := SSEMessage{
		JournalID: "journal1",
		Messages: []Message{
			{Name: "Test", MType: "Normal"},
		},
	}

	if sseMsg.JournalID != "journal1" {
		t.Errorf("expected JournalID=journal1, got %s", sseMsg.JournalID)
	}
	if len(sseMsg.Messages) != 1 {
		t.Errorf("expected 1 message, got %d", len(sseMsg.Messages))
	}
}
