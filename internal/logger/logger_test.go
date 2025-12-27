package logger

import (
	"log/slog"
	"testing"
)

func TestLoggerInit(t *testing.T) {
	// Test that Log is initialized by init()
	if Log == nil {
		t.Fatal("Log should be initialized by init()")
	}
}

func TestInitTextFormat(t *testing.T) {
	Init("text", slog.LevelInfo)
	if Log == nil {
		t.Fatal("Log is nil after Init(text)")
	}
}

func TestInitJSONFormat(t *testing.T) {
	Init("json", slog.LevelDebug)
	if Log == nil {
		t.Fatal("Log is nil after Init(json)")
	}
}

func TestInitDefaultFormat(t *testing.T) {
	Init("unknown", slog.LevelWarn)
	if Log == nil {
		t.Fatal("Log is nil after Init(unknown)")
	}
}

func TestConvenienceFunctions(t *testing.T) {
	// Just ensure they don't panic
	Init("text", slog.LevelDebug)

	// These should not panic
	Info("test info message")
	Error("test error message")
	Warn("test warn message")
	Debug("test debug message")

	// With args
	Info("test", "key", "value")
	Error("test", "code", 500)
	Warn("test", "count", 10)
	Debug("test", "flag", true)
}

func TestInitLevels(t *testing.T) {
	levels := []slog.Level{
		slog.LevelDebug,
		slog.LevelInfo,
		slog.LevelWarn,
		slog.LevelError,
	}

	for _, level := range levels {
		Init("text", level)
		if Log == nil {
			t.Errorf("Log is nil after Init with level %v", level)
		}
	}
}
