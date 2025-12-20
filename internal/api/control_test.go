package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestControlManager_IsEnabled(t *testing.T) {
	tests := []struct {
		name     string
		tokens   []string
		expected bool
	}{
		{"no tokens", []string{}, false},
		{"empty token", []string{""}, false},
		{"one token", []string{"admin"}, true},
		{"multiple tokens", []string{"admin", "operator"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := NewControlManager(tt.tokens, time.Minute, nil)
			defer m.Stop()
			if got := m.IsEnabled(); got != tt.expected {
				t.Errorf("IsEnabled() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestControlManager_IsValidToken(t *testing.T) {
	m := NewControlManager([]string{"admin", "operator"}, time.Minute, nil)
	defer m.Stop()

	tests := []struct {
		token    string
		expected bool
	}{
		{"admin", true},
		{"operator", true},
		{"invalid", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.token, func(t *testing.T) {
			if got := m.IsValidToken(tt.token); got != tt.expected {
				t.Errorf("IsValidToken(%q) = %v, want %v", tt.token, got, tt.expected)
			}
		})
	}
}

func TestControlManager_TakeControl(t *testing.T) {
	m := NewControlManager([]string{"admin", "operator"}, time.Minute, nil)
	defer m.Stop()

	// Take with valid token
	if err := m.TakeControl("admin"); err != nil {
		t.Errorf("TakeControl(admin) failed: %v", err)
	}

	// Check is controller
	if !m.IsController("admin") {
		t.Error("admin should be controller after TakeControl")
	}

	// Check has controller
	if !m.HasController() {
		t.Error("HasController() should be true")
	}

	// Another session tries to take - should fail
	if err := m.TakeControl("operator"); err != ErrControlTaken {
		t.Errorf("TakeControl(operator) expected ErrControlTaken, got %v", err)
	}

	// Same session can re-take
	if err := m.TakeControl("admin"); err != nil {
		t.Errorf("TakeControl(admin) again failed: %v", err)
	}

	// Invalid token
	if err := m.TakeControl("invalid"); err != ErrInvalidToken {
		t.Errorf("TakeControl(invalid) expected ErrInvalidToken, got %v", err)
	}
}

func TestControlManager_ReleaseControl(t *testing.T) {
	m := NewControlManager([]string{"admin", "operator"}, time.Minute, nil)
	defer m.Stop()

	// Take control first
	if err := m.TakeControl("admin"); err != nil {
		t.Fatalf("TakeControl failed: %v", err)
	}

	// Wrong token can't release
	if err := m.ReleaseControl("operator"); err != ErrNotController {
		t.Errorf("ReleaseControl(operator) expected ErrNotController, got %v", err)
	}

	// Correct token can release
	if err := m.ReleaseControl("admin"); err != nil {
		t.Errorf("ReleaseControl(admin) failed: %v", err)
	}

	// Check no controller
	if m.HasController() {
		t.Error("HasController() should be false after release")
	}

	if m.IsController("admin") {
		t.Error("admin should not be controller after release")
	}
}

func TestControlManager_Timeout(t *testing.T) {
	// Short timeout for test
	m := NewControlManager([]string{"admin", "operator"}, 100*time.Millisecond, nil)
	defer m.Stop()

	// Take control
	if err := m.TakeControl("admin"); err != nil {
		t.Fatalf("TakeControl failed: %v", err)
	}

	// Immediately, operator can't take
	if err := m.TakeControl("operator"); err != ErrControlTaken {
		t.Errorf("TakeControl(operator) expected ErrControlTaken immediately, got %v", err)
	}

	// Wait for timeout
	time.Sleep(150 * time.Millisecond)

	// Now operator can take (timeout expired)
	if err := m.TakeControl("operator"); err != nil {
		t.Errorf("TakeControl(operator) after timeout failed: %v", err)
	}

	if !m.IsController("operator") {
		t.Error("operator should be controller after timeout takeover")
	}
}

func TestControlManager_Touch(t *testing.T) {
	m := NewControlManager([]string{"admin"}, 100*time.Millisecond, nil)
	defer m.Stop()

	if err := m.TakeControl("admin"); err != nil {
		t.Fatalf("TakeControl failed: %v", err)
	}

	// Keep touching to prevent timeout
	for i := 0; i < 5; i++ {
		time.Sleep(30 * time.Millisecond)
		m.Touch("admin")
	}

	// Should still be controller
	if !m.IsController("admin") {
		t.Error("admin should still be controller after touching")
	}
}

func TestControlManager_GetStatus(t *testing.T) {
	m := NewControlManager([]string{"admin", "operator"}, time.Minute, nil)
	defer m.Stop()

	// Before take
	status := m.GetStatus("admin")
	if !status.Enabled {
		t.Error("Enabled should be true")
	}
	if status.HasController {
		t.Error("HasController should be false before take")
	}
	if status.IsController {
		t.Error("IsController should be false before take")
	}

	// Take control
	m.TakeControl("admin")

	// Admin's status
	status = m.GetStatus("admin")
	if !status.HasController {
		t.Error("HasController should be true after take")
	}
	if !status.IsController {
		t.Error("admin's IsController should be true")
	}

	// Operator's status
	status = m.GetStatus("operator")
	if !status.HasController {
		t.Error("HasController should be true")
	}
	if status.IsController {
		t.Error("operator's IsController should be false")
	}
}

func TestControlManager_DisabledMode(t *testing.T) {
	m := NewControlManager([]string{}, time.Minute, nil)
	defer m.Stop()

	if m.IsEnabled() {
		t.Error("IsEnabled should be false with no tokens")
	}

	// Everyone is controller when disabled
	if !m.IsController("anyone") {
		t.Error("IsController should be true when disabled")
	}

	// Take returns error when disabled
	if err := m.TakeControl("admin"); err != ErrControlDisabled {
		t.Errorf("TakeControl expected ErrControlDisabled, got %v", err)
	}
}

func TestControlManager_ReleaseBySSE(t *testing.T) {
	m := NewControlManager([]string{"admin"}, time.Minute, nil)
	defer m.Stop()

	// Take control
	if err := m.TakeControl("admin"); err != nil {
		t.Fatalf("TakeControl failed: %v", err)
	}

	// Release by SSE disconnect
	m.ReleaseBySSE("admin")

	// ReleaseBySSE has 3 second grace period, so immediately after call
	// HasController should still be true
	if !m.HasController() {
		t.Error("HasController should be true immediately after ReleaseBySSE (grace period)")
	}

	// Wait for grace period to pass (3 seconds + buffer)
	time.Sleep(3500 * time.Millisecond)

	if m.HasController() {
		t.Error("HasController should be false after grace period")
	}
}

// === HTTP Handler Tests ===

func setupControlTestHandlers(tokens []string) (*Handlers, *ControlManager) {
	unisetServer := mockUnisetServer()
	handlers := setupTestHandlers(unisetServer)

	controlMgr := NewControlManager(tokens, time.Minute, nil)
	handlers.controlMgr = controlMgr

	return handlers, controlMgr
}

func TestHandler_GetControlStatus(t *testing.T) {
	handlers, controlMgr := setupControlTestHandlers([]string{"admin123"})
	defer controlMgr.Stop()

	req := httptest.NewRequest("GET", "/api/control/status", nil)
	w := httptest.NewRecorder()

	handlers.GetControlStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var status ControlStatus
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if !status.Enabled {
		t.Error("Enabled should be true")
	}
	if status.HasController {
		t.Error("HasController should be false initially")
	}
}

func TestHandler_TakeControl(t *testing.T) {
	handlers, controlMgr := setupControlTestHandlers([]string{"admin123", "operator456"})
	defer controlMgr.Stop()

	// Valid token
	body := bytes.NewBuffer([]byte(`{"token": "admin123"}`))
	req := httptest.NewRequest("POST", "/api/control/take", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.TakeControl(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var status ControlStatus
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if !status.IsController {
		t.Error("IsController should be true after take")
	}
	if !status.HasController {
		t.Error("HasController should be true after take")
	}

	// Invalid token
	body = bytes.NewBuffer([]byte(`{"token": "wrong"}`))
	req = httptest.NewRequest("POST", "/api/control/take", body)
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()

	handlers.TakeControl(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401 for invalid token, got %d", w.Code)
	}

	// Another valid token tries to take - should fail
	body = bytes.NewBuffer([]byte(`{"token": "operator456"}`))
	req = httptest.NewRequest("POST", "/api/control/take", body)
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()

	handlers.TakeControl(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("expected status 409 for conflict, got %d", w.Code)
	}
}

func TestHandler_ReleaseControl(t *testing.T) {
	handlers, controlMgr := setupControlTestHandlers([]string{"admin123"})
	defer controlMgr.Stop()

	// First take control
	controlMgr.TakeControl("admin123")

	// Release
	body := bytes.NewBuffer([]byte(`{"token": "admin123"}`))
	req := httptest.NewRequest("POST", "/api/control/release", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.ReleaseControl(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	if controlMgr.HasController() {
		t.Error("HasController should be false after release")
	}
}

func TestHandler_PingControl(t *testing.T) {
	handlers, controlMgr := setupControlTestHandlers([]string{"admin123"})
	defer controlMgr.Stop()

	// Take control first
	controlMgr.TakeControl("admin123")

	// Ping with correct token
	req := httptest.NewRequest("POST", "/api/control/ping", nil)
	req.Header.Set("X-Control-Token", "admin123")
	w := httptest.NewRecorder()

	handlers.PingControl(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Ping with wrong token
	req = httptest.NewRequest("POST", "/api/control/ping", nil)
	req.Header.Set("X-Control-Token", "wrong")
	w = httptest.NewRecorder()

	handlers.PingControl(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected status 403 for wrong token, got %d", w.Code)
	}
}

func TestHandler_CheckControlAccess(t *testing.T) {
	handlers, controlMgr := setupControlTestHandlers([]string{"admin123"})
	defer controlMgr.Stop()

	// Take control
	controlMgr.TakeControl("admin123")

	// Request with correct token - should pass
	req := httptest.NewRequest("POST", "/api/objects/TestProc/ionc/set", nil)
	req.Header.Set("X-Control-Token", "admin123")

	if !handlers.checkControlAccess(nil, req) {
		t.Error("checkControlAccess should return true for controller")
	}

	// Request with wrong token - should fail
	req = httptest.NewRequest("POST", "/api/objects/TestProc/ionc/set", nil)
	req.Header.Set("X-Control-Token", "wrong")
	w := httptest.NewRecorder()

	if handlers.checkControlAccess(w, req) {
		t.Error("checkControlAccess should return false for non-controller")
	}

	if w.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", w.Code)
	}
}

func TestHandler_ControlDisabled(t *testing.T) {
	handlers, controlMgr := setupControlTestHandlers([]string{}) // no tokens = disabled
	defer controlMgr.Stop()

	// Status shows disabled
	req := httptest.NewRequest("GET", "/api/control/status", nil)
	w := httptest.NewRecorder()

	handlers.GetControlStatus(w, req)

	var status ControlStatus
	json.Unmarshal(w.Body.Bytes(), &status)

	if status.Enabled {
		t.Error("Enabled should be false when no tokens")
	}

	// CheckControlAccess passes without token when disabled
	req = httptest.NewRequest("POST", "/api/objects/TestProc/ionc/set", nil)
	// No X-Control-Token header

	if !handlers.checkControlAccess(nil, req) {
		t.Error("checkControlAccess should return true when control is disabled")
	}
}
