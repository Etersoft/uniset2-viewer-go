package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"log/slog"

	"github.com/pv/uniset-panel/internal/api"
	"github.com/pv/uniset-panel/internal/config"
	"github.com/pv/uniset-panel/internal/dashboard"
	"github.com/pv/uniset-panel/internal/ionc"
	"github.com/pv/uniset-panel/internal/logger"
	"github.com/pv/uniset-panel/internal/logserver"
	"github.com/pv/uniset-panel/internal/modbus"
	"github.com/pv/uniset-panel/internal/opcua"
	"github.com/pv/uniset-panel/internal/poller"
	"github.com/pv/uniset-panel/internal/recording"
	"github.com/pv/uniset-panel/internal/sensorconfig"
	"github.com/pv/uniset-panel/internal/server"
	"github.com/pv/uniset-panel/internal/sm"
	"github.com/pv/uniset-panel/internal/storage"
	"github.com/pv/uniset-panel/internal/uniset"
	"github.com/pv/uniset-panel/internal/uwsgate"
	"github.com/pv/uniset-panel/ui"
)

// Version is set at build time via ldflags
var Version = "0.0.2"

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
	serverMgr := server.NewManager(store, cfg.PollInterval, cfg.HistoryTTL, cfg.UnisetSupplier, cfg.GetSensorBatchSize())

	// Create SSE hub (needed for callbacks)
	sseHub := api.NewSSEHub()

	// Create control manager if tokens configured
	var controlMgr *api.ControlManager
	if cfg.IsControlEnabled() {
		controlMgr = api.NewControlManager(cfg.ControlTokens, cfg.GetControlTimeout(), sseHub)
		sseHub.SetControlManager(controlMgr)
		logger.Info("Session control enabled",
			"tokens", len(cfg.ControlTokens),
			"timeout", cfg.GetControlTimeout())
	}

	// Create recording manager
	var recordingMgr *recording.Manager
	recordingPath := cfg.GetRecordingPath()
	if recordingPath != "" {
		backend := recording.NewSQLiteBackend(recordingPath)
		recordingMgr = recording.NewManager(backend, cfg.GetMaxRecords())
		logger.Info("Recording manager initialized",
			"path", recordingPath,
			"max_records", cfg.GetMaxRecords())

		// Start recording if enabled by default
		if cfg.RecordingEnabled {
			if err := recordingMgr.Start(); err != nil {
				logger.Error("Failed to start recording", "error", err)
			} else {
				logger.Info("Recording started (enabled by default)")
			}
		}
	}

	// Set callbacks for SSE broadcasting (with Recording integration)
	serverMgr.SetObjectCallback(sseHub.BroadcastObjectDataWithServer)

	// IONC callback with recording
	serverMgr.SetIONCCallback(func(serverID, serverName string, updates []ionc.SensorUpdate) {
		sseHub.BroadcastIONCSensorBatchWithServer(serverID, serverName, updates)
		// Record IONC sensor values
		if recordingMgr != nil && recordingMgr.IsRecording() {
			now := time.Now()
			for _, u := range updates {
				varName := "ionc:" + u.Sensor.Name
				recordingMgr.Save(serverID, u.ObjectName, varName, u.Sensor.Value, now)
			}
		}
	})

	// Modbus callback with recording
	serverMgr.SetModbusCallback(func(serverID, serverName string, updates []modbus.RegisterUpdate) {
		sseHub.BroadcastModbusRegisterBatchWithServer(serverID, serverName, updates)
		// Record Modbus register values
		if recordingMgr != nil && recordingMgr.IsRecording() {
			now := time.Now()
			for _, u := range updates {
				varName := "mb:" + u.Register.Name
				recordingMgr.Save(serverID, u.ObjectName, varName, u.Register.Value, now)
			}
		}
	})

	// OPCUA callback with recording
	serverMgr.SetOPCUACallback(func(serverID, serverName string, updates []opcua.SensorUpdate) {
		sseHub.BroadcastOPCUASensorBatchWithServer(serverID, serverName, updates)
		// Record OPCUA sensor values
		if recordingMgr != nil && recordingMgr.IsRecording() {
			now := time.Now()
			for _, u := range updates {
				varName := "opcua:" + u.Sensor.Name
				recordingMgr.Save(serverID, u.ObjectName, varName, u.Sensor.Value, now)
			}
		}
	})

	// UWebSocketGate callback with recording
	serverMgr.SetUWSGateCallback(func(serverID, serverName string, updates []uwsgate.SensorUpdate) {
		sseHub.BroadcastUWSGateSensorBatchWithServer(serverID, serverName, updates)
		// Record UWebSocketGate sensor values
		if recordingMgr != nil && recordingMgr.IsRecording() {
			now := time.Now()
			for _, u := range updates {
				varName := "ws:" + u.Sensor.Name
				recordingMgr.Save(serverID, u.ObjectName, varName, u.Sensor.Value, now)
			}
		}
	})

	serverMgr.SetStatusCallback(sseHub.BroadcastServerStatus)
	serverMgr.SetObjectsCallback(sseHub.BroadcastObjectsList)

	// Set recording manager on server manager (for all pollers)
	if recordingMgr != nil {
		serverMgr.SetRecordingManager(recordingMgr)
	}

	// Add servers from configuration
	for _, srvCfg := range cfg.Servers {
		if err := serverMgr.AddServer(srvCfg); err != nil {
			logger.Error("Failed to add server", "url", srvCfg.URL, "error", err)
		}
	}

	// Get first server's client and pollers for API handlers
	var client *uniset.Client
	var pollerInstance *poller.Poller
	var ioncPollerInstance *ionc.Poller
	var modbusPollerInstance *modbus.Poller
	var opcuaPollerInstance *opcua.Poller
	if instance, ok := serverMgr.GetFirstServer(); ok {
		client = instance.Client
		pollerInstance = instance.Poller
		ioncPollerInstance = instance.IONCPoller
		modbusPollerInstance = instance.ModbusPoller
		opcuaPollerInstance = instance.OPCUAPoller
	}

	// Create API handlers
	handlers := api.NewHandlers(client, store, pollerInstance, sensorCfg, cfg.PollInterval)
	handlers.SetVersion(Version)
	handlers.SetLogServerManager(logServerMgr)
	handlers.SetServerManager(serverMgr)
	handlers.SetSSEHub(sseHub)
	handlers.SetControlsEnabled(cfg.ConFile != "") // Controls visible only if uniset-config specified
	handlers.SetUIConfig(cfg.UI)
	handlers.SetLogStreamConfig(cfg.LogStream)
	if controlMgr != nil {
		handlers.SetControlManager(controlMgr)
	}
	if recordingMgr != nil {
		handlers.SetRecordingManager(recordingMgr)
	}

	// Create dashboard manager if directory specified
	if cfg.DashboardsDir != "" {
		dashboardMgr := dashboard.NewManager(cfg.DashboardsDir)
		if err := dashboardMgr.Load(); err != nil {
			logger.Error("Failed to load dashboards", "dir", cfg.DashboardsDir, "error", err)
		} else {
			handlers.SetDashboardManager(dashboardMgr)
			logger.Info("Loaded server dashboards", "dir", cfg.DashboardsDir, "count", dashboardMgr.Count())
		}
	}

	// Set pollers if available
	if ioncPollerInstance != nil {
		handlers.SetIONCPoller(ioncPollerInstance)
	}
	if modbusPollerInstance != nil {
		handlers.SetModbusPoller(modbusPollerInstance)
	}
	if opcuaPollerInstance != nil {
		handlers.SetOPCUAPoller(opcuaPollerInstance)
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

	// Create API server with optional external files for hot reload
	var serverOpts []api.ServerOption
	if cfg.JSFile != "" {
		serverOpts = append(serverOpts, api.WithJSFile(cfg.JSFile))
	}
	if cfg.CSSFile != "" {
		serverOpts = append(serverOpts, api.WithCSSFile(cfg.CSSFile))
	}
	apiServer := api.NewServer(handlers, ui.Content, serverOpts...)

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
			logArgs = append(logArgs, "uniset_config", cfg.ConFile)
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

	// Stop control manager
	if controlMgr != nil {
		controlMgr.Stop()
	}

	// Stop recording manager
	if recordingMgr != nil {
		if err := recordingMgr.Stop(); err != nil {
			logger.Error("Recording manager stop error", "error", err)
		}
	}

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
