package dashboard

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNewManager(t *testing.T) {
	m := NewManager("/some/path")
	if m == nil {
		t.Fatal("NewManager returned nil")
	}
	if m.dir != "/some/path" {
		t.Errorf("dir = %q, want %q", m.dir, "/some/path")
	}
	if m.dashboards == nil {
		t.Error("dashboards map is nil")
	}
}

func TestManagerLoadEmptyDir(t *testing.T) {
	m := NewManager("")
	if err := m.Load(); err != nil {
		t.Errorf("Load() with empty dir failed: %v", err)
	}
	if m.Count() != 0 {
		t.Errorf("Count() = %d, want 0", m.Count())
	}
}

func TestManagerLoadNonExistentDir(t *testing.T) {
	m := NewManager("/nonexistent/path/that/does/not/exist")
	if err := m.Load(); err != nil {
		t.Errorf("Load() with nonexistent dir should not fail: %v", err)
	}
	if m.Count() != 0 {
		t.Errorf("Count() = %d, want 0", m.Count())
	}
}

func TestManagerLoadValidDashboards(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "dashboard-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create test dashboard files
	dashboard1 := `{
		"meta": {"name": "Test Dashboard 1", "description": "Test description"},
		"widgets": [{"type": "gauge"}, {"type": "led"}]
	}`
	dashboard2 := `{
		"meta": {"name": "Test Dashboard 2"},
		"widgets": [{"type": "chart"}]
	}`

	if err := os.WriteFile(filepath.Join(tmpDir, "dash1.json"), []byte(dashboard1), 0644); err != nil {
		t.Fatalf("Failed to write dash1.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "dash2.json"), []byte(dashboard2), 0644); err != nil {
		t.Fatalf("Failed to write dash2.json: %v", err)
	}

	// Load dashboards
	m := NewManager(tmpDir)
	if err := m.Load(); err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	// Check count
	if m.Count() != 2 {
		t.Errorf("Count() = %d, want 2", m.Count())
	}

	// Check Get
	data, ok := m.Get("Test Dashboard 1")
	if !ok {
		t.Error("Get(Test Dashboard 1) returned false")
	}
	if data == nil {
		t.Error("Get(Test Dashboard 1) returned nil data")
	}

	// Check Get non-existent
	_, ok = m.Get("Non Existent")
	if ok {
		t.Error("Get(Non Existent) should return false")
	}

	// Check ListInfo
	list := m.ListInfo()
	if len(list) != 2 {
		t.Errorf("ListInfo() returned %d items, want 2", len(list))
	}

	// Check sorted order
	if list[0].Name != "Test Dashboard 1" {
		t.Errorf("list[0].Name = %q, want %q", list[0].Name, "Test Dashboard 1")
	}
	if list[1].Name != "Test Dashboard 2" {
		t.Errorf("list[1].Name = %q, want %q", list[1].Name, "Test Dashboard 2")
	}

	// Check dashboard info
	if list[0].WidgetCount != 2 {
		t.Errorf("list[0].WidgetCount = %d, want 2", list[0].WidgetCount)
	}
	if list[0].Description != "Test description" {
		t.Errorf("list[0].Description = %q, want %q", list[0].Description, "Test description")
	}
	if !list[0].Server {
		t.Error("list[0].Server should be true")
	}
}

func TestManagerLoadInvalidJSON(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "dashboard-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create invalid JSON file
	if err := os.WriteFile(filepath.Join(tmpDir, "invalid.json"), []byte("not valid json"), 0644); err != nil {
		t.Fatalf("Failed to write invalid.json: %v", err)
	}

	// Create valid JSON file
	validDashboard := `{"meta": {"name": "Valid"}, "widgets": []}`
	if err := os.WriteFile(filepath.Join(tmpDir, "valid.json"), []byte(validDashboard), 0644); err != nil {
		t.Fatalf("Failed to write valid.json: %v", err)
	}

	m := NewManager(tmpDir)
	// Should not fail, just skip invalid file
	if err := m.Load(); err != nil {
		t.Errorf("Load() should not fail with invalid JSON: %v", err)
	}

	// Should have loaded only valid dashboard
	if m.Count() != 1 {
		t.Errorf("Count() = %d, want 1", m.Count())
	}
}

func TestManagerLoadNoNameFallback(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "dashboard-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Dashboard without name in meta - should use filename
	noName := `{"meta": {}, "widgets": []}`
	if err := os.WriteFile(filepath.Join(tmpDir, "my-dashboard.json"), []byte(noName), 0644); err != nil {
		t.Fatalf("Failed to write my-dashboard.json: %v", err)
	}

	m := NewManager(tmpDir)
	if err := m.Load(); err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	// Should use filename as name
	_, ok := m.Get("my-dashboard")
	if !ok {
		t.Error("Dashboard should be accessible by filename when meta.name is empty")
	}
}

func TestManagerLoadNotDirectory(t *testing.T) {
	// Create temp file
	tmpFile, err := os.CreateTemp("", "dashboard-test-*.txt")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	tmpFile.Close()
	defer os.Remove(tmpFile.Name())

	m := NewManager(tmpFile.Name())
	err = m.Load()
	if err == nil {
		t.Error("Load() should fail when path is not a directory")
	}
}

func TestManagerLoadSkipsNonJSON(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "dashboard-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create non-JSON file
	if err := os.WriteFile(filepath.Join(tmpDir, "readme.txt"), []byte("readme"), 0644); err != nil {
		t.Fatalf("Failed to write readme.txt: %v", err)
	}

	// Create valid JSON dashboard
	validDashboard := `{"meta": {"name": "Valid"}, "widgets": []}`
	if err := os.WriteFile(filepath.Join(tmpDir, "valid.json"), []byte(validDashboard), 0644); err != nil {
		t.Fatalf("Failed to write valid.json: %v", err)
	}

	m := NewManager(tmpDir)
	if err := m.Load(); err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	// Should only load JSON file
	if m.Count() != 1 {
		t.Errorf("Count() = %d, want 1", m.Count())
	}
}

func TestManagerReload(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "dashboard-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create initial dashboard
	dashboard1 := `{"meta": {"name": "Dashboard 1"}, "widgets": []}`
	if err := os.WriteFile(filepath.Join(tmpDir, "dash1.json"), []byte(dashboard1), 0644); err != nil {
		t.Fatalf("Failed to write dash1.json: %v", err)
	}

	m := NewManager(tmpDir)
	if err := m.Load(); err != nil {
		t.Fatalf("First Load() failed: %v", err)
	}
	if m.Count() != 1 {
		t.Errorf("After first load: Count() = %d, want 1", m.Count())
	}

	// Add another dashboard
	dashboard2 := `{"meta": {"name": "Dashboard 2"}, "widgets": []}`
	if err := os.WriteFile(filepath.Join(tmpDir, "dash2.json"), []byte(dashboard2), 0644); err != nil {
		t.Fatalf("Failed to write dash2.json: %v", err)
	}

	// Reload
	if err := m.Load(); err != nil {
		t.Fatalf("Second Load() failed: %v", err)
	}
	if m.Count() != 2 {
		t.Errorf("After second load: Count() = %d, want 2", m.Count())
	}
}
