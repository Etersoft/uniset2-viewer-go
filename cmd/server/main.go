package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/pv/uniset2-viewer-go/internal/api"
	"github.com/pv/uniset2-viewer-go/internal/config"
	"github.com/pv/uniset2-viewer-go/internal/logger"
	"github.com/pv/uniset2-viewer-go/internal/poller"
	"github.com/pv/uniset2-viewer-go/internal/sensorconfig"
	"github.com/pv/uniset2-viewer-go/internal/storage"
	"github.com/pv/uniset2-viewer-go/internal/uniset"
	"github.com/pv/uniset2-viewer-go/ui"
)

func main() {
	cfg := config.Parse()

	// Initialize logger
	logger.Init(cfg.LogFormat, config.ParseLogLevel(cfg.LogLevel))

	// Create uniset client
	client := uniset.NewClient(cfg.UnisetURL)

	// Create storage
	var store storage.Storage
	var err error

	switch cfg.Storage {
	case config.StorageSQLite:
		store, err = storage.NewSQLiteStorage(cfg.SQLitePath)
		if err != nil {
			logger.Error("Failed to create SQLite storage", "error", err)
			os.Exit(1)
		}
		logger.Info("Using SQLite storage", "path", cfg.SQLitePath)
	default:
		store = storage.NewMemoryStorage()
		logger.Info("Using in-memory storage")
	}
	defer store.Close()

	// Create poller
	p := poller.New(client, store, cfg.PollInterval, cfg.HistoryTTL)

	// Load sensor configuration if provided
	var sensorCfg *sensorconfig.SensorConfig
	if cfg.ConFile != "" {
		var err error
		sensorCfg, err = sensorconfig.LoadFromFile(cfg.ConFile)
		if err != nil {
			logger.Error("Failed to load sensor config", "file", cfg.ConFile, "error", err)
			os.Exit(1)
		}
		logger.Info("Loaded sensor configuration", "file", cfg.ConFile, "sensors", sensorCfg.Count())
	}

	// Create API handlers and server
	handlers := api.NewHandlers(client, store, p, sensorCfg)
	server := api.NewServer(handlers, ui.Content)

	// Start poller
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go p.Run(ctx)

	// Start HTTP server
	addr := fmt.Sprintf(":%d", cfg.Port)
	httpServer := &http.Server{
		Addr:    addr,
		Handler: server,
	}

	go func() {
		logArgs := []any{
			"addr", addr,
			"uniset_url", cfg.UnisetURL,
			"poll_interval", cfg.PollInterval.String(),
			"history_ttl", cfg.HistoryTTL.String(),
		}
		if cfg.ConFile != "" {
			logArgs = append(logArgs, "confile", cfg.ConFile)
		}
		logger.Info("Starting server", logArgs...)

		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("Server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down server...")

	// Cancel poller context
	cancel()

	// Graceful shutdown with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("Server shutdown error", "error", err)
	}

	logger.Info("Server stopped")
}
