package config

import (
	"flag"
	"log/slog"
	"strings"
	"time"
)

type StorageType string

const (
	StorageMemory StorageType = "memory"
	StorageSQLite StorageType = "sqlite"
)

type Config struct {
	UnisetURL      string
	Port           int
	PollInterval   time.Duration
	Storage        StorageType
	SQLitePath     string
	HistoryTTL     time.Duration
	LogFormat      string
	LogLevel       string
	ConFile        string
	SMURL          string        // URL SharedMemory API (пусто = отключено)
	SMPollInterval time.Duration // Интервал опроса SM (0 = использовать PollInterval)
}

func Parse() *Config {
	cfg := &Config{}

	flag.StringVar(&cfg.UnisetURL, "uniset-url", "http://localhost:8080", "UniSet2 HTTP API URL")
	flag.IntVar(&cfg.Port, "port", 9090, "Web server port")
	flag.DurationVar(&cfg.PollInterval, "poll-interval", 5*time.Second, "UniSet2 polling interval")

	var storageStr string
	flag.StringVar(&storageStr, "storage", "memory", "Storage type: memory or sqlite")

	flag.StringVar(&cfg.SQLitePath, "sqlite-path", "./history.db", "SQLite database path")
	flag.DurationVar(&cfg.HistoryTTL, "history-ttl", time.Hour, "History retention time")
	flag.StringVar(&cfg.LogFormat, "log-format", "text", "Log format: text or json")
	flag.StringVar(&cfg.LogLevel, "log-level", "info", "Log level: debug, info, warn, error")
	flag.StringVar(&cfg.ConFile, "confile", "", "UniSet2 XML configuration file (sensors metadata)")
	flag.StringVar(&cfg.SMURL, "sm-url", "", "SharedMemory HTTP API URL (empty = disabled)")
	flag.DurationVar(&cfg.SMPollInterval, "sm-poll-interval", 0, "SharedMemory polling interval (0 = use poll-interval)")

	flag.Parse()

	cfg.Storage = StorageType(storageStr)
	if cfg.Storage != StorageMemory && cfg.Storage != StorageSQLite {
		cfg.Storage = StorageMemory
	}

	return cfg
}

// ParseLogLevel converts string log level to slog.Level
func ParseLogLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
