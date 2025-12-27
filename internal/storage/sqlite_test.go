package storage

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewSQLiteStorage(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage failed: %v", err)
	}
	defer store.Close()

	if store == nil {
		t.Fatal("store should not be nil")
	}
}

func TestSQLiteStorageSaveAndGetLatest(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage failed: %v", err)
	}
	defer store.Close()

	now := time.Now()

	// Save some points
	for i := 0; i < 5; i++ {
		err := store.Save("", "TestObj", "var1", i*10, now.Add(time.Duration(i)*time.Second))
		if err != nil {
			t.Fatalf("Save failed: %v", err)
		}
	}

	// Get latest 3 points
	history, err := store.GetLatest("", "TestObj", "var1", 3)
	if err != nil {
		t.Fatalf("GetLatest failed: %v", err)
	}

	if history.ObjectName != "TestObj" {
		t.Errorf("expected ObjectName=TestObj, got %s", history.ObjectName)
	}

	if history.VariableName != "var1" {
		t.Errorf("expected VariableName=var1, got %s", history.VariableName)
	}

	if len(history.Points) != 3 {
		t.Fatalf("expected 3 points, got %d", len(history.Points))
	}
}

func TestSQLiteStorageGetHistory(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage failed: %v", err)
	}
	defer store.Close()

	base := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)

	// Save points with 1 minute interval
	for i := 0; i < 10; i++ {
		err := store.Save("", "TestObj", "var1", i, base.Add(time.Duration(i)*time.Minute))
		if err != nil {
			t.Fatalf("Save failed: %v", err)
		}
	}

	// Query range from 3rd to 7th minute
	from := base.Add(3 * time.Minute)
	to := base.Add(7 * time.Minute)

	history, err := store.GetHistory("", "TestObj", "var1", from, to)
	if err != nil {
		t.Fatalf("GetHistory failed: %v", err)
	}

	if len(history.Points) != 5 {
		t.Fatalf("expected 5 points (3,4,5,6,7), got %d", len(history.Points))
	}
}

func TestSQLiteStorageCleanup(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage failed: %v", err)
	}
	defer store.Close()

	now := time.Now()
	old := now.Add(-2 * time.Hour)

	// Save old data
	store.Save("", "TestObj", "var1", 100, old)
	store.Save("", "TestObj", "var1", 101, old.Add(time.Minute))

	// Save new data
	store.Save("", "TestObj", "var1", 200, now)
	store.Save("", "TestObj", "var1", 201, now.Add(time.Minute))

	// Cleanup data older than 1 hour
	err = store.Cleanup(now.Add(-time.Hour))
	if err != nil {
		t.Fatalf("Cleanup failed: %v", err)
	}

	// Should only have new data left
	history, err := store.GetLatest("", "TestObj", "var1", 10)
	if err != nil {
		t.Fatalf("GetLatest failed: %v", err)
	}

	if len(history.Points) != 2 {
		t.Fatalf("expected 2 points after cleanup, got %d", len(history.Points))
	}
}

func TestSQLiteStorageWithServerID(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage failed: %v", err)
	}
	defer store.Close()

	now := time.Now()

	// Save data for different servers
	store.Save("server1", "Obj1", "var1", 100, now)
	store.Save("server2", "Obj1", "var1", 200, now)
	store.Save("", "Obj1", "var1", 300, now) // default server

	// Data should be isolated by server
	h1, _ := store.GetLatest("server1", "Obj1", "var1", 10)
	h2, _ := store.GetLatest("server2", "Obj1", "var1", 10)
	h3, _ := store.GetLatest("", "Obj1", "var1", 10) // default server

	if len(h1.Points) != 1 {
		t.Fatalf("server1 expected 1 point, got %d", len(h1.Points))
	}
	if len(h2.Points) != 1 {
		t.Fatalf("server2 expected 1 point, got %d", len(h2.Points))
	}
	if len(h3.Points) != 1 {
		t.Fatalf("default server expected 1 point, got %d", len(h3.Points))
	}

	// Check serverID in response
	if h1.ServerID != "server1" {
		t.Errorf("expected ServerID=server1, got %s", h1.ServerID)
	}
}

func TestSQLiteStorageEmptyHistory(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage failed: %v", err)
	}
	defer store.Close()

	history, err := store.GetLatest("", "NonExistent", "var", 10)
	if err != nil {
		t.Fatalf("GetLatest failed: %v", err)
	}

	if len(history.Points) != 0 {
		t.Errorf("expected empty history, got %d points", len(history.Points))
	}
}

func TestSQLiteStorageMultipleVariables(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage failed: %v", err)
	}
	defer store.Close()

	now := time.Now()

	store.Save("", "Obj1", "var1", 10, now)
	store.Save("", "Obj1", "var2", 20, now)
	store.Save("", "Obj2", "var1", 30, now)

	h1, _ := store.GetLatest("", "Obj1", "var1", 10)
	h2, _ := store.GetLatest("", "Obj1", "var2", 10)
	h3, _ := store.GetLatest("", "Obj2", "var1", 10)

	if len(h1.Points) != 1 {
		t.Error("Obj1:var1 mismatch")
	}
	if len(h2.Points) != 1 {
		t.Error("Obj1:var2 mismatch")
	}
	if len(h3.Points) != 1 {
		t.Error("Obj2:var1 mismatch")
	}
}

func TestSQLiteStorageComplexValues(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage failed: %v", err)
	}
	defer store.Close()

	now := time.Now()

	// Save different types of values
	store.Save("", "Obj", "int", 42, now)
	store.Save("", "Obj", "float", 3.14, now)
	store.Save("", "Obj", "string", "hello", now)
	store.Save("", "Obj", "bool", true, now)
	store.Save("", "Obj", "map", map[string]int{"a": 1, "b": 2}, now)
	store.Save("", "Obj", "array", []int{1, 2, 3}, now)

	// All should be retrievable
	h1, _ := store.GetLatest("", "Obj", "int", 1)
	h2, _ := store.GetLatest("", "Obj", "float", 1)
	h3, _ := store.GetLatest("", "Obj", "string", 1)
	h4, _ := store.GetLatest("", "Obj", "bool", 1)
	h5, _ := store.GetLatest("", "Obj", "map", 1)
	h6, _ := store.GetLatest("", "Obj", "array", 1)

	if len(h1.Points) != 1 || len(h2.Points) != 1 || len(h3.Points) != 1 ||
		len(h4.Points) != 1 || len(h5.Points) != 1 || len(h6.Points) != 1 {
		t.Error("expected all values to be retrievable")
	}
}

func TestSQLiteStorageReopenDatabase(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	now := time.Now()

	// Create store and save data
	store1, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage failed: %v", err)
	}
	store1.Save("", "Obj", "var", 100, now)
	store1.Close()

	// Reopen and verify data persists
	store2, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage (reopen) failed: %v", err)
	}
	defer store2.Close()

	history, err := store2.GetLatest("", "Obj", "var", 10)
	if err != nil {
		t.Fatalf("GetLatest failed: %v", err)
	}

	if len(history.Points) != 1 {
		t.Fatalf("expected 1 point after reopen, got %d", len(history.Points))
	}
}

func TestSQLiteStorageInvalidPath(t *testing.T) {
	// Try to create database in non-existent directory
	store, err := NewSQLiteStorage("/nonexistent/path/test.db")
	if err == nil {
		store.Close()
		t.Error("expected error for invalid path")
	}
}

func TestSQLiteStorageMakeKeyFunction(t *testing.T) {
	// Test makeKey function via storage operations
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage failed: %v", err)
	}
	defer store.Close()

	now := time.Now()

	// Empty serverID should use default
	store.Save("", "Obj", "var", 1, now)

	// Should be accessible with empty serverID
	h1, _ := store.GetLatest("", "Obj", "var", 10)
	if len(h1.Points) != 1 {
		t.Error("expected 1 point for empty serverID")
	}

	// ServerID in response should be "default" (as returned by GetLatest)
	// Actually the SQLite impl passes through what was given, using DefaultServerID internally
}

func TestDataPointAndVariableHistory(t *testing.T) {
	// Test struct field assignments
	now := time.Now()

	dp := DataPoint{
		Timestamp: now,
		Value:     42,
	}
	if dp.Value != 42 {
		t.Error("DataPoint.Value not set")
	}
	if !dp.Timestamp.Equal(now) {
		t.Error("DataPoint.Timestamp not set")
	}

	vh := VariableHistory{
		ServerID:     "server1",
		ObjectName:   "Obj1",
		VariableName: "var1",
		Points:       []DataPoint{dp},
	}
	if vh.ServerID != "server1" {
		t.Error("VariableHistory.ServerID not set")
	}
	if vh.ObjectName != "Obj1" {
		t.Error("VariableHistory.ObjectName not set")
	}
	if len(vh.Points) != 1 {
		t.Error("VariableHistory.Points not set")
	}
}

func TestDefaultServerIDConstant(t *testing.T) {
	if DefaultServerID != "default" {
		t.Errorf("DefaultServerID = %q, want %q", DefaultServerID, "default")
	}
}

func TestMakeKey(t *testing.T) {
	tests := []struct {
		serverID     string
		objectName   string
		variableName string
		expected     string
	}{
		{"", "Obj", "var", "default:Obj:var"},
		{"server1", "Obj", "var", "server1:Obj:var"},
		{"srv", "MyObject", "myVar", "srv:MyObject:myVar"},
	}

	for _, tt := range tests {
		got := makeKey(tt.serverID, tt.objectName, tt.variableName)
		if got != tt.expected {
			t.Errorf("makeKey(%q, %q, %q) = %q, want %q",
				tt.serverID, tt.objectName, tt.variableName, got, tt.expected)
		}
	}
}

func TestMemoryStorageClose(t *testing.T) {
	store := NewMemoryStorage()
	err := store.Close()
	if err != nil {
		t.Errorf("Close() returned error: %v", err)
	}
}

func TestMemoryStorageCleanupRemovesEmptyKeys(t *testing.T) {
	store := NewMemoryStorage().(*memoryStorage)

	old := time.Now().Add(-2 * time.Hour)
	now := time.Now()

	// Save only old data for one variable
	store.Save("", "Obj1", "var1", 100, old)
	// Save new data for another
	store.Save("", "Obj2", "var2", 200, now)

	// Cleanup should remove the empty key for Obj1:var1
	store.Cleanup(now.Add(-time.Hour))

	store.mu.RLock()
	_, exists := store.data["default:Obj1:var1"]
	store.mu.RUnlock()

	if exists {
		t.Error("expected empty key to be removed after cleanup")
	}
}

func TestSQLiteStorageMigration(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	// Create initial database
	store1, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage failed: %v", err)
	}
	store1.Close()

	// Reopen - migration should be idempotent
	store2, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage (second open) failed: %v", err)
	}
	defer store2.Close()

	// Should work normally
	now := time.Now()
	err = store2.Save("", "Obj", "var", 42, now)
	if err != nil {
		t.Fatalf("Save after migration failed: %v", err)
	}
}

func TestSQLiteStorageFileCreation(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "subdir", "test.db")

	// Create parent directory
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage failed: %v", err)
	}
	defer store.Close()

	// File should exist
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		t.Error("database file should exist")
	}
}
