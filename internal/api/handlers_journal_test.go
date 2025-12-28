package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pv/uniset-panel/internal/journal"
	"github.com/pv/uniset-panel/internal/poller"
	"github.com/pv/uniset-panel/internal/storage"
)

func TestGetJournals_NoManager(t *testing.T) {
	store := storage.NewMemoryStorage()
	handlers := NewHandlers(nil, store, nil, nil, time.Second)

	req := httptest.NewRequest("GET", "/api/journals", nil)
	w := httptest.NewRecorder()

	handlers.GetJournals(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}

	var journals []journal.JournalInfo
	if err := json.NewDecoder(resp.Body).Decode(&journals); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(journals) != 0 {
		t.Errorf("expected empty journals list, got %d", len(journals))
	}
}

func TestGetJournals_WithManager(t *testing.T) {
	store := storage.NewMemoryStorage()
	handlers := NewHandlers(nil, store, nil, nil, time.Second)

	// Create empty journal manager
	mgr := journal.NewManager(slog.Default())
	handlers.SetJournalManager(mgr)

	req := httptest.NewRequest("GET", "/api/journals", nil)
	w := httptest.NewRecorder()

	handlers.GetJournals(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}

	var journals []journal.JournalInfo
	if err := json.NewDecoder(resp.Body).Decode(&journals); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(journals) != 0 {
		t.Errorf("expected empty journals list, got %d", len(journals))
	}
}

func TestGetJournalMessages_NoManager(t *testing.T) {
	store := storage.NewMemoryStorage()
	handlers := NewHandlers(nil, store, nil, nil, time.Second)

	req := httptest.NewRequest("GET", "/api/journals/test123/messages", nil)
	req.SetPathValue("id", "test123")
	w := httptest.NewRecorder()

	handlers.GetJournalMessages(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", resp.StatusCode)
	}
}

func TestGetJournalMessages_NotFound(t *testing.T) {
	store := storage.NewMemoryStorage()
	handlers := NewHandlers(nil, store, nil, nil, time.Second)

	mgr := journal.NewManager(slog.Default())
	handlers.SetJournalManager(mgr)

	req := httptest.NewRequest("GET", "/api/journals/nonexistent/messages", nil)
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()

	handlers.GetJournalMessages(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", resp.StatusCode)
	}
}

func TestGetJournalMTypes_NoManager(t *testing.T) {
	store := storage.NewMemoryStorage()
	handlers := NewHandlers(nil, store, nil, nil, time.Second)

	req := httptest.NewRequest("GET", "/api/journals/test123/mtypes", nil)
	req.SetPathValue("id", "test123")
	w := httptest.NewRecorder()

	handlers.GetJournalMTypes(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", resp.StatusCode)
	}
}

func TestGetJournalMTypes_NotFound(t *testing.T) {
	store := storage.NewMemoryStorage()
	handlers := NewHandlers(nil, store, nil, nil, time.Second)

	mgr := journal.NewManager(slog.Default())
	handlers.SetJournalManager(mgr)

	req := httptest.NewRequest("GET", "/api/journals/nonexistent/mtypes", nil)
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()

	handlers.GetJournalMTypes(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", resp.StatusCode)
	}
}

func TestGetJournalMGroups_NoManager(t *testing.T) {
	store := storage.NewMemoryStorage()
	handlers := NewHandlers(nil, store, nil, nil, time.Second)

	req := httptest.NewRequest("GET", "/api/journals/test123/mgroups", nil)
	req.SetPathValue("id", "test123")
	w := httptest.NewRecorder()

	handlers.GetJournalMGroups(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", resp.StatusCode)
	}
}

func TestGetJournalMGroups_NotFound(t *testing.T) {
	store := storage.NewMemoryStorage()
	handlers := NewHandlers(nil, store, nil, nil, time.Second)

	mgr := journal.NewManager(slog.Default())
	handlers.SetJournalManager(mgr)

	req := httptest.NewRequest("GET", "/api/journals/nonexistent/mgroups", nil)
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()

	handlers.GetJournalMGroups(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", resp.StatusCode)
	}
}

func TestParseTime(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{
			name:    "RFC3339",
			input:   "2024-01-15T10:30:00Z",
			wantErr: false,
		},
		{
			name:    "Unix timestamp seconds",
			input:   "1705315800",
			wantErr: false,
		},
		{
			name:    "Unix timestamp milliseconds",
			input:   "1705315800000",
			wantErr: false,
		},
		{
			name:    "Empty string",
			input:   "",
			wantErr: false, // returns zero time
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := parseTime(tt.input)
			if tt.wantErr && err != nil {
				return // expected error
			}
			if tt.input == "" && !result.IsZero() {
				t.Error("expected zero time for empty input")
			}
			if tt.input != "" && result.IsZero() && !tt.wantErr {
				t.Error("expected non-zero time")
			}
		})
	}
}

// TestSetJournalManager tests the setter
func TestSetJournalManager(t *testing.T) {
	store := storage.NewMemoryStorage()
	handlers := NewHandlers(nil, store, nil, nil, time.Second)

	if handlers.journalMgr != nil {
		t.Error("expected journalMgr to be nil initially")
	}

	mgr := journal.NewManager(nil)
	handlers.SetJournalManager(mgr)

	if handlers.journalMgr == nil {
		t.Error("expected journalMgr to be set")
	}
	if handlers.journalMgr != mgr {
		t.Error("expected journalMgr to match")
	}
}

// TestJournalRoutes_Integration tests routes via Server
func TestJournalRoutes_Integration(t *testing.T) {
	store := storage.NewMemoryStorage()
	p := poller.New(nil, store, time.Second, time.Hour)
	handlers := NewHandlers(nil, store, p, nil, time.Second)

	mgr := journal.NewManager(slog.Default())
	handlers.SetJournalManager(mgr)

	// Create a minimal static FS mock
	server := NewServer(handlers, nil)

	// Test /api/journals route
	req := httptest.NewRequest("GET", "/api/journals", nil)
	w := httptest.NewRecorder()
	server.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("GET /api/journals: expected 200, got %d", w.Code)
	}

	var journals []journal.JournalInfo
	if err := json.NewDecoder(w.Body).Decode(&journals); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(journals) != 0 {
		t.Errorf("expected empty list, got %d journals", len(journals))
	}
}
