// +build integration

package journal

import (
	"context"
	"os"
	"testing"
	"time"
)

// Integration tests for journal package
// Run with: go test -tags=integration -v ./internal/journal/...
// Requires CLICKHOUSE_URL environment variable or defaults to localhost:9000

func getClickHouseURL() string {
	url := os.Getenv("CLICKHOUSE_URL")
	if url == "" {
		url = "clickhouse://localhost:9000/uniset"
	}
	return url
}

func TestIntegration_NewClient(t *testing.T) {
	url := getClickHouseURL()

	client, err := NewClient(url)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	info := client.Info()
	if info.Status != "connected" {
		t.Errorf("expected status=connected, got %s", info.Status)
	}
	if info.ID == "" {
		t.Error("expected non-empty ID")
	}
}

func TestIntegration_GetMTypes(t *testing.T) {
	url := getClickHouseURL()

	client, err := NewClient(url)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	mtypes, err := client.GetMTypes(ctx)
	if err != nil {
		t.Fatalf("GetMTypes failed: %v", err)
	}

	if len(mtypes) == 0 {
		t.Error("expected at least one mtype")
	}

	// Check for standard types
	expectedTypes := map[string]bool{
		"Alarm": false, "Warning": false, "Normal": false,
		"Emergancy": false, "Cauton": false, "Blocking": false,
	}

	for _, mt := range mtypes {
		if _, ok := expectedTypes[mt]; ok {
			expectedTypes[mt] = true
		}
	}

	// At least some standard types should be present
	found := 0
	for _, v := range expectedTypes {
		if v {
			found++
		}
	}
	if found == 0 {
		t.Errorf("no standard mtypes found, got: %v", mtypes)
	}
}

func TestIntegration_GetMGroups(t *testing.T) {
	url := getClickHouseURL()

	client, err := NewClient(url)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	mgroups, err := client.GetMGroups(ctx)
	if err != nil {
		t.Fatalf("GetMGroups failed: %v", err)
	}

	if len(mgroups) == 0 {
		t.Error("expected at least one mgroup")
	}

	t.Logf("found %d mgroups: %v", len(mgroups), mgroups)
}

func TestIntegration_Query(t *testing.T) {
	url := getClickHouseURL()

	client, err := NewClient(url)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	params := QueryParams{
		Limit: 10,
	}

	messages, total, err := client.Query(ctx, params)
	if err != nil {
		t.Fatalf("Query failed: %v", err)
	}

	if total == 0 {
		t.Error("expected total > 0")
	}

	if len(messages) == 0 {
		t.Error("expected at least one message")
	}

	if len(messages) > 10 {
		t.Errorf("expected at most 10 messages, got %d", len(messages))
	}

	// Check message fields
	for _, msg := range messages {
		if msg.Timestamp.IsZero() {
			t.Error("message timestamp is zero")
		}
		if msg.MType == "" {
			t.Error("message mtype is empty")
		}
	}

	t.Logf("found %d messages (total: %d)", len(messages), total)
}

func TestIntegration_QueryWithFilters(t *testing.T) {
	url := getClickHouseURL()

	client, err := NewClient(url)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Query only Alarm messages
	params := QueryParams{
		MTypes: []string{"Alarm"},
		Limit:  50,
	}

	messages, _, err := client.Query(ctx, params)
	if err != nil {
		t.Fatalf("Query failed: %v", err)
	}

	// All messages should be Alarm type
	for _, msg := range messages {
		if msg.MType != "Alarm" {
			t.Errorf("expected mtype=Alarm, got %s", msg.MType)
		}
	}
}

func TestIntegration_QueryWithTimeRange(t *testing.T) {
	url := getClickHouseURL()

	client, err := NewClient(url)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	now := time.Now()
	hourAgo := now.Add(-time.Hour)

	params := QueryParams{
		From:  hourAgo,
		To:    now,
		Limit: 100,
	}

	messages, _, err := client.Query(ctx, params)
	if err != nil {
		t.Fatalf("Query failed: %v", err)
	}

	// All messages should be within time range
	for _, msg := range messages {
		if msg.Timestamp.Before(hourAgo) || msg.Timestamp.After(now) {
			t.Errorf("message timestamp %v outside range [%v, %v]",
				msg.Timestamp, hourAgo, now)
		}
	}
}

func TestIntegration_QueryPagination(t *testing.T) {
	url := getClickHouseURL()

	client, err := NewClient(url)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// First page
	params1 := QueryParams{
		Limit:  5,
		Offset: 0,
	}
	page1, _, err := client.Query(ctx, params1)
	if err != nil {
		t.Fatalf("Query page 1 failed: %v", err)
	}

	// Second page
	params2 := QueryParams{
		Limit:  5,
		Offset: 5,
	}
	page2, _, err := client.Query(ctx, params2)
	if err != nil {
		t.Fatalf("Query page 2 failed: %v", err)
	}

	// Pages should have different messages
	if len(page1) > 0 && len(page2) > 0 {
		if page1[0].Timestamp == page2[0].Timestamp &&
			page1[0].Name == page2[0].Name &&
			page1[0].Message == page2[0].Message {
			t.Error("page 1 and page 2 have same first message")
		}
	}
}

func TestIntegration_GetNewMessages(t *testing.T) {
	url := getClickHouseURL()

	client, err := NewClient(url)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Get messages from 1 hour ago
	since := time.Now().Add(-time.Hour)

	messages, err := client.GetNewMessages(ctx, since, 100)
	if err != nil {
		t.Fatalf("GetNewMessages failed: %v", err)
	}

	// All messages should be after 'since'
	for _, msg := range messages {
		if msg.Timestamp.Before(since) {
			t.Errorf("message timestamp %v is before since %v", msg.Timestamp, since)
		}
	}

	t.Logf("found %d new messages since %v", len(messages), since)
}

func TestIntegration_Manager(t *testing.T) {
	url := getClickHouseURL()

	mgr := NewManager(nil)
	defer mgr.Close()

	err := mgr.AddJournal(url)
	if err != nil {
		t.Fatalf("AddJournal failed: %v", err)
	}

	// Should have one journal
	infos := mgr.GetAllInfos()
	if len(infos) != 1 {
		t.Errorf("expected 1 journal, got %d", len(infos))
	}

	if infos[0].Status != "connected" {
		t.Errorf("expected status=connected, got %s", infos[0].Status)
	}

	// Get client by ID
	client := mgr.GetClient(infos[0].ID)
	if client == nil {
		t.Error("GetClient returned nil")
	}
}

func TestIntegration_Poller(t *testing.T) {
	url := getClickHouseURL()

	client, err := NewClient(url)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	var receivedMessages []Message
	callback := func(journalID string, messages []Message) {
		receivedMessages = append(receivedMessages, messages...)
	}

	poller := NewPoller(client, 500*time.Millisecond, callback, nil)
	poller.Start()

	// Wait for a few poll cycles
	time.Sleep(2 * time.Second)

	poller.Stop()

	// Note: callback may or may not be called depending on new messages
	t.Logf("received %d messages during polling", len(receivedMessages))
}
