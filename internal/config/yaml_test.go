package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadFromYAML_WithControl(t *testing.T) {
	// Create temp YAML file
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")

	yamlContent := `
servers:
  - url: http://localhost:9090
    name: "Test Server"

control:
  tokens:
    - admin123
    - operator456
  timeout: 120s
`
	if err := os.WriteFile(configPath, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	// Load config
	cfg, err := LoadFromYAML(configPath)
	if err != nil {
		t.Fatalf("LoadFromYAML failed: %v", err)
	}

	// Check servers
	if len(cfg.Servers) != 1 {
		t.Errorf("expected 1 server, got %d", len(cfg.Servers))
	}
	if cfg.Servers[0].URL != "http://localhost:9090" {
		t.Errorf("expected URL http://localhost:9090, got %s", cfg.Servers[0].URL)
	}

	// Check control
	if cfg.Control == nil {
		t.Fatal("expected Control to be set")
	}
	if len(cfg.Control.Tokens) != 2 {
		t.Errorf("expected 2 tokens, got %d", len(cfg.Control.Tokens))
	}
	if cfg.Control.Tokens[0] != "admin123" {
		t.Errorf("expected first token admin123, got %s", cfg.Control.Tokens[0])
	}
	if cfg.Control.Tokens[1] != "operator456" {
		t.Errorf("expected second token operator456, got %s", cfg.Control.Tokens[1])
	}
	if cfg.Control.Timeout != 120*time.Second {
		t.Errorf("expected timeout 120s, got %v", cfg.Control.Timeout)
	}
}

func TestLoadFromYAML_WithoutControl(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")

	yamlContent := `
servers:
  - url: http://localhost:9090
`
	if err := os.WriteFile(configPath, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	cfg, err := LoadFromYAML(configPath)
	if err != nil {
		t.Fatalf("LoadFromYAML failed: %v", err)
	}

	// Control should be nil when not specified
	if cfg.Control != nil {
		t.Errorf("expected Control to be nil, got %+v", cfg.Control)
	}
}

func TestLoadFromYAML_ControlTokensOnly(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")

	yamlContent := `
servers:
  - url: http://localhost:9090

control:
  tokens:
    - secret123
`
	if err := os.WriteFile(configPath, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	cfg, err := LoadFromYAML(configPath)
	if err != nil {
		t.Fatalf("LoadFromYAML failed: %v", err)
	}

	if cfg.Control == nil {
		t.Fatal("expected Control to be set")
	}
	if len(cfg.Control.Tokens) != 1 {
		t.Errorf("expected 1 token, got %d", len(cfg.Control.Tokens))
	}
	// Timeout should be zero (will use default in Parse)
	if cfg.Control.Timeout != 0 {
		t.Errorf("expected timeout 0, got %v", cfg.Control.Timeout)
	}
}

func TestLoadFromYAML_WithJournals(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")

	yamlContent := `
servers:
  - url: http://localhost:9090

journals:
  - url: "clickhouse://host1:9000/uniset"
    name: "Production"
    table: "main_messages_src"
  - url: "clickhouse://host2:9000/uniset"
    name: "Test"
`
	if err := os.WriteFile(configPath, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	cfg, err := LoadFromYAML(configPath)
	if err != nil {
		t.Fatalf("LoadFromYAML failed: %v", err)
	}

	if len(cfg.Journals) != 2 {
		t.Fatalf("expected 2 journals, got %d", len(cfg.Journals))
	}

	// Check first journal
	if cfg.Journals[0].URL != "clickhouse://host1:9000/uniset" {
		t.Errorf("expected first journal URL clickhouse://host1:9000/uniset, got %s", cfg.Journals[0].URL)
	}
	if cfg.Journals[0].Name != "Production" {
		t.Errorf("expected first journal name Production, got %s", cfg.Journals[0].Name)
	}
	if cfg.Journals[0].Table != "main_messages_src" {
		t.Errorf("expected first journal table main_messages_src, got %s", cfg.Journals[0].Table)
	}

	// Check second journal
	if cfg.Journals[1].URL != "clickhouse://host2:9000/uniset" {
		t.Errorf("expected second journal URL clickhouse://host2:9000/uniset, got %s", cfg.Journals[1].URL)
	}
	if cfg.Journals[1].Name != "Test" {
		t.Errorf("expected second journal name Test, got %s", cfg.Journals[1].Name)
	}
}

func TestLoadFromYAML_WithoutJournals(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")

	yamlContent := `
servers:
  - url: http://localhost:9090
`
	if err := os.WriteFile(configPath, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	cfg, err := LoadFromYAML(configPath)
	if err != nil {
		t.Fatalf("LoadFromYAML failed: %v", err)
	}

	if len(cfg.Journals) != 0 {
		t.Errorf("expected 0 journals, got %d", len(cfg.Journals))
	}
}

func TestLoadFromYAML_JournalWithDatabase(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")

	yamlContent := `
servers:
  - url: http://localhost:9090

journals:
  - url: "clickhouse://host:9000/default"
    database: "custom_db"
`
	if err := os.WriteFile(configPath, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	cfg, err := LoadFromYAML(configPath)
	if err != nil {
		t.Fatalf("LoadFromYAML failed: %v", err)
	}

	if len(cfg.Journals) != 1 {
		t.Fatalf("expected 1 journal, got %d", len(cfg.Journals))
	}

	if cfg.Journals[0].Database != "custom_db" {
		t.Errorf("expected database custom_db, got %s", cfg.Journals[0].Database)
	}
}
