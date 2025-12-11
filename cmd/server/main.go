package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"log/slog"

	"github.com/pv/uniset2-viewer-go/internal/api"
	"github.com/pv/uniset2-viewer-go/internal/config"
	"github.com/pv/uniset2-viewer-go/internal/ionc"
	"github.com/pv/uniset2-viewer-go/internal/logger"
	"github.com/pv/uniset2-viewer-go/internal/logserver"
	"github.com/pv/uniset2-viewer-go/internal/poller"
	"github.com/pv/uniset2-viewer-go/internal/sensorconfig"
	"github.com/pv/uniset2-viewer-go/internal/server"
	"github.com/pv/uniset2-viewer-go/internal/sm"
	"github.com/pv/uniset2-viewer-go/internal/storage"
	"github.com/pv/uniset2-viewer-go/internal/uniset"
	"github.com/pv/uniset2-viewer-go/ui"
)

func main() {
	cfg := config.Parse()

	// Initialize logger
	logger.Init(cfg.LogFormat, config.ParseLogLevel(cfg.LogLevel))

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

	// Load sensor configuration if provided
	var sensorCfg *sensorconfig.SensorConfig
	if cfg.ConFile != "" {
		var err error
		sensorCfg, err = sensorconfig.LoadFromFile(cfg.ConFile)
		if err != nil {
			logger.Error("Failed to load sensor config", "file", cfg.ConFile, "error", err)
			os.Exit(1)
		}
		logger.Info("Loaded sensor configuration", "file", cfg.ConFile, "sensors", sensorCfg.Count(),
			"objects", sensorCfg.ObjectCount(), "services", sensorCfg.ServiceCount())

		// Validate that supplier exists in config (objects or services)
		if !sensorCfg.HasObjectOrService(cfg.UnisetSupplier) {
			logger.Error("Supplier not found in configuration",
				"supplier", cfg.UnisetSupplier,
				"hint", "Specify valid supplier with -uniset-supplier=<name>",
				"note", "Supplier must exist in <objects> or <services> section of the config")
			os.Exit(1)
		}
		logger.Info("Validated supplier", "supplier", cfg.UnisetSupplier)
	}

	// Create LogServer manager
	logServerMgr := logserver.NewManager(slog.Default())
	defer logServerMgr.Close()

	// Create ServerManager
	serverMgr := server.NewManager(store, cfg.PollInterval, cfg.HistoryTTL, cfg.UnisetSupplier)

	// Create SSE hub (needed for callbacks)
	sseHub := api.NewSSEHub()

	// Set callbacks for SSE broadcasting
	serverMgr.SetObjectCallback(sseHub.BroadcastObjectDataWithServer)
	serverMgr.SetIONCCallback(sseHub.BroadcastIONCSensorBatchWithServer)
	serverMgr.SetStatusCallback(sseHub.BroadcastServerStatus)
	serverMgr.SetObjectsCallback(sseHub.BroadcastObjectsList)

	// Add servers from configuration
	for _, srvCfg := range cfg.Servers {
		if err := serverMgr.AddServer(srvCfg); err != nil {
			logger.Error("Failed to add server", "url", srvCfg.URL, "error", err)
		} else {
			logger.Info("Added server", "id", srvCfg.ID, "url", srvCfg.URL, "name", srvCfg.Name)
		}
	}

	// Get first server's client and poller for API handlers
	var client *uniset.Client
	var pollerInstance *poller.Poller
	var ioncPollerInstance *ionc.Poller
	if instance, ok := serverMgr.GetFirstServer(); ok {
		client = instance.Client
		pollerInstance = instance.Poller
		ioncPollerInstance = instance.IONCPoller
	}

	// Create API handlers
	handlers := api.NewHandlers(client, store, pollerInstance, sensorCfg, cfg.PollInterval)
	handlers.SetLogServerManager(logServerMgr)
	handlers.SetServerManager(serverMgr)
	handlers.SetSSEHub(sseHub)
	handlers.SetControlsEnabled(cfg.ConFile != "") // Controls visible only if confile specified
	handlers.SetUIConfig(cfg.UI)

	// Set IONC poller if available
	if ioncPollerInstance != nil {
		handlers.SetIONCPoller(ioncPollerInstance)
	}

	// Create SM poller if configured
	var smPoller *sm.Poller
	if cfg.SMURL != "" {
		smClient := sm.NewClient(cfg.SMURL)
		smInterval := cfg.SMPollInterval
		if smInterval == 0 {
			smInterval = cfg.PollInterval
		}
		smPoller = sm.NewPoller(smClient, store, smInterval, func(update sm.SensorUpdate) {
			sseHub.BroadcastSensorUpdate(update)
		})
		handlers.SetSMPoller(smPoller)
		logger.Info("SM integration enabled", "url", cfg.SMURL, "poll_interval", smInterval)
	}

	apiServer := api.NewServer(handlers, ui.Content)

	// Start SM poller if configured
	if smPoller != nil {
		smPoller.Start()
		defer smPoller.Stop()
	}

	// Start HTTP server
	httpServer := &http.Server{
		Addr:    cfg.Addr,
		Handler: apiServer,
	}

	go func() {
		logArgs := []any{
			"addr", cfg.Addr,
			"poll_interval", cfg.PollInterval.String(),
			"history_ttl", cfg.HistoryTTL.String(),
			"servers", len(cfg.Servers),
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

	// Shutdown server manager
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := serverMgr.Shutdown(shutdownCtx); err != nil {
		logger.Error("Server manager shutdown error", "error", err)
	}

	// Graceful shutdown HTTP server with timeout
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("Server shutdown error", "error", err)
	}

	logger.Info("Server stopped")
}
