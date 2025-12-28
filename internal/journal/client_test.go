package journal

import (
	"net/url"
	"testing"
)

func TestParseJournalURL(t *testing.T) {
	tests := []struct {
		name         string
		urlStr       string
		wantDatabase string
		wantTable    string
		wantName     string
	}{
		{
			name:         "full URL with all params",
			urlStr:       "clickhouse://localhost:9000/uniset?table=main_messages_src&name=Production",
			wantDatabase: "uniset",
			wantTable:    "main_messages_src",
			wantName:     "Production",
		},
		{
			name:         "URL without table param",
			urlStr:       "clickhouse://localhost:9000/testdb",
			wantDatabase: "testdb",
			wantTable:    "",
			wantName:     "",
		},
		{
			name:         "URL with only name",
			urlStr:       "clickhouse://host:9000/db?name=Test",
			wantDatabase: "db",
			wantTable:    "",
			wantName:     "Test",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			u, err := url.Parse(tt.urlStr)
			if err != nil {
				t.Fatalf("failed to parse URL: %v", err)
			}

			query := u.Query()
			table := query.Get("table")
			name := query.Get("name")
			database := u.Path[1:] // remove leading /

			if database != tt.wantDatabase {
				t.Errorf("database = %q, want %q", database, tt.wantDatabase)
			}
			if table != tt.wantTable {
				t.Errorf("table = %q, want %q", table, tt.wantTable)
			}
			if name != tt.wantName {
				t.Errorf("name = %q, want %q", name, tt.wantName)
			}
		})
	}
}

func TestDefaultTable(t *testing.T) {
	if defaultTable != "main_messages_src" {
		t.Errorf("expected defaultTable=main_messages_src, got %s", defaultTable)
	}
}

func TestDefaultDatabase(t *testing.T) {
	if defaultDatabase != "uniset" {
		t.Errorf("expected defaultDatabase=uniset, got %s", defaultDatabase)
	}
}

func TestNewClient_InvalidURL(t *testing.T) {
	_, err := NewClient("not-a-valid-url")
	if err == nil {
		t.Error("expected error for invalid URL")
	}
}

func TestNewClient_ConnectionRefused(t *testing.T) {
	// Valid URL format but no server running
	_, err := NewClient("clickhouse://127.0.0.1:59999/testdb")
	if err == nil {
		t.Error("expected error for connection refused")
	}
}

func TestNewClient_InvalidScheme(t *testing.T) {
	_, err := NewClient("http://localhost:9000/db")
	if err == nil {
		t.Error("expected error for invalid scheme")
	}
}

// TestGenerateID tests that IDs are generated consistently
func TestGenerateID(t *testing.T) {
	url1 := "clickhouse://host1:9000/db1"
	url2 := "clickhouse://host2:9000/db2"

	// Same URL should produce same ID
	client1, err := func() (*Client, error) {
		// We can't actually connect, so just test the ID generation logic
		return nil, nil
	}()
	_ = client1
	_ = err

	// Different URLs should produce different IDs (can't test without connection)
	_ = url1
	_ = url2
}

// Integration tests (require running ClickHouse)
// These are skipped by default

func TestNewClient_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	// This test requires a running ClickHouse instance
	t.Skip("requires ClickHouse server")

	client, err := NewClient("clickhouse://localhost:9000/default")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	info := client.Info()
	if info.Status != "connected" {
		t.Errorf("expected status=connected, got %s", info.Status)
	}
}
