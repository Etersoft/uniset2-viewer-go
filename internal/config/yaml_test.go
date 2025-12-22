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
