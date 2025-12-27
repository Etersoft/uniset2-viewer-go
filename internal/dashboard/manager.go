package dashboard

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// dashboardEntry stores raw JSON and minimal parsed info for listing
type dashboardEntry struct {
	RawJSON     []byte // original JSON bytes
	Name        string
	Description string
	WidgetCount int
}

// Manager manages server-side dashboards
type Manager struct {
	mu         sync.RWMutex
	dashboards map[string]*dashboardEntry
	dir        string // directory to load dashboards from
}

// NewManager creates a new dashboard manager
func NewManager(dir string) *Manager {
	return &Manager{
		dashboards: make(map[string]*dashboardEntry),
		dir:        dir,
	}
}

// Load loads all dashboards from the configured directory
func (m *Manager) Load() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.dir == "" {
		return nil // no directory configured
	}

	// Check if directory exists
	info, err := os.Stat(m.dir)
	if os.IsNotExist(err) {
		return nil // directory doesn't exist, that's OK
	}
	if err != nil {
		return fmt.Errorf("stat dashboard dir: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", m.dir)
	}

	// Clear existing dashboards
	m.dashboards = make(map[string]*dashboardEntry)

	// Walk directory and load JSON files
	err = filepath.WalkDir(m.dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(d.Name()), ".json") {
			return nil
		}

		entry, err := m.loadFile(path, d.Name())
		if err != nil {
			// Log error but continue loading other files
			fmt.Printf("Warning: failed to load dashboard %s: %v\n", path, err)
			return nil
		}

		m.dashboards[entry.Name] = entry
		return nil
	})

	return err
}

// minimalDashboard for extracting only listing info
type minimalDashboard struct {
	Meta struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	} `json:"meta"`
	Widgets []json.RawMessage `json:"widgets"`
}

// loadFile loads a dashboard from a JSON file, storing raw bytes
func (m *Manager) loadFile(path string, filename string) (*dashboardEntry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}

	// Validate it's valid JSON and extract minimal info for listing
	var minimal minimalDashboard
	if err := json.Unmarshal(data, &minimal); err != nil {
		return nil, fmt.Errorf("parse JSON: %w", err)
	}

	name := minimal.Meta.Name
	if name == "" {
		// Use filename without extension as fallback
		name = strings.TrimSuffix(filename, ".json")
	}

	return &dashboardEntry{
		RawJSON:     data,
		Name:        name,
		Description: minimal.Meta.Description,
		WidgetCount: len(minimal.Widgets),
	}, nil
}

// Get returns raw JSON for a dashboard by name
func (m *Manager) Get(name string) ([]byte, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	entry, ok := m.dashboards[name]
	if !ok {
		return nil, false
	}
	return entry.RawJSON, true
}

// ListInfo returns summary info for all dashboards
func (m *Manager) ListInfo() []DashboardInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]DashboardInfo, 0, len(m.dashboards))
	for _, entry := range m.dashboards {
		result = append(result, DashboardInfo{
			Name:        entry.Name,
			Description: entry.Description,
			WidgetCount: entry.WidgetCount,
			Server:      true,
		})
	}

	// Sort by name
	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})

	return result
}

// Count returns the number of loaded dashboards
func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.dashboards)
}
