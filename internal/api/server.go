package api

import (
	"io/fs"
	"net/http"
	"os"
	"strings"

	"github.com/pv/uniset-panel/internal/logger"
)

type Server struct {
	mux      *http.ServeMux
	handlers *Handlers
	jsFile   string // путь к внешнему app.js (для разработки)
	cssFile  string // путь к внешнему style.css (для разработки)
}

// ServerOption функциональная опция для конфигурации Server
type ServerOption func(*Server)

// WithJSFile устанавливает путь к внешнему app.js файлу
func WithJSFile(path string) ServerOption {
	return func(s *Server) {
		s.jsFile = path
	}
}

// WithCSSFile устанавливает путь к внешнему style.css файлу
func WithCSSFile(path string) ServerOption {
	return func(s *Server) {
		s.cssFile = path
	}
}

func NewServer(handlers *Handlers, staticFS fs.FS, opts ...ServerOption) *Server {
	s := &Server{
		mux:      http.NewServeMux(),
		handlers: handlers,
	}

	// Применяем опции
	for _, opt := range opts {
		opt(s)
	}

	s.setupRoutes(staticFS)
	return s
}

func (s *Server) setupRoutes(staticFS fs.FS) {
	// API routes
	s.mux.HandleFunc("GET /api/version", s.handlers.GetVersion)
	s.mux.HandleFunc("GET /api/objects", s.handlers.GetObjects)
	s.mux.HandleFunc("GET /api/objects/{name}", s.handlers.GetObjectData)
	s.mux.HandleFunc("POST /api/objects/{name}/watch", s.handlers.WatchObject)
	s.mux.HandleFunc("DELETE /api/objects/{name}/watch", s.handlers.UnwatchObject)
	s.mux.HandleFunc("GET /api/objects/{name}/variables/{variable}/history", s.handlers.GetVariableHistory)
	s.mux.HandleFunc("GET /api/objects/{name}/variables/{variable}/history/range", s.handlers.GetVariableHistoryRange)

	// SSE endpoint
	s.mux.HandleFunc("GET /api/events", s.handlers.HandleSSE)

	// Sensor config API
	s.mux.HandleFunc("GET /api/sensors", s.handlers.GetSensors)
	s.mux.HandleFunc("GET /api/sensors/by-name/{name}", s.handlers.GetSensorByName)

	// SharedMemory sensors API
	s.mux.HandleFunc("GET /api/sm/sensors", s.handlers.GetSMSensors)

	// External sensors API (SM integration)
	s.mux.HandleFunc("GET /api/objects/{name}/external-sensors", s.handlers.GetExternalSensors)
	s.mux.HandleFunc("POST /api/objects/{name}/external-sensors", s.handlers.SubscribeExternalSensors)
	s.mux.HandleFunc("DELETE /api/objects/{name}/external-sensors/{sensor}", s.handlers.UnsubscribeExternalSensor)

	// IONotifyController API (for SharedMemory and similar objects)
	s.mux.HandleFunc("GET /api/objects/{name}/ionc/sensors", s.handlers.GetIONCSensors)
	s.mux.HandleFunc("GET /api/objects/{name}/ionc/get", s.handlers.GetIONCSensorValues)
	s.mux.HandleFunc("POST /api/objects/{name}/ionc/set", s.handlers.SetIONCSensorValue)
	s.mux.HandleFunc("POST /api/objects/{name}/ionc/freeze", s.handlers.FreezeIONCSensor)
	s.mux.HandleFunc("POST /api/objects/{name}/ionc/unfreeze", s.handlers.UnfreezeIONCSensor)
	s.mux.HandleFunc("GET /api/objects/{name}/ionc/consumers", s.handlers.GetIONCConsumers)
	s.mux.HandleFunc("GET /api/objects/{name}/ionc/lost", s.handlers.GetIONCLostConsumers)

	// IONC SSE subscriptions
	s.mux.HandleFunc("POST /api/objects/{name}/ionc/subscribe", s.handlers.SubscribeIONCSensors)
	s.mux.HandleFunc("POST /api/objects/{name}/ionc/unsubscribe", s.handlers.UnsubscribeIONCSensors)
	s.mux.HandleFunc("GET /api/objects/{name}/ionc/subscriptions", s.handlers.GetIONCSubscriptions)
	s.mux.HandleFunc("GET /api/objects/{name}/ionc/subscribe", s.handlers.SubscribeIONCSensorsQuery)

	// OPCUAExchange API
	s.mux.HandleFunc("GET /api/objects/{name}/opcua/status", s.handlers.GetOPCUAStatus)
	s.mux.HandleFunc("GET /api/objects/{name}/opcua/params", s.handlers.GetOPCUAParams)
	s.mux.HandleFunc("POST /api/objects/{name}/opcua/params", s.handlers.SetOPCUAParams)
	s.mux.HandleFunc("GET /api/objects/{name}/opcua/sensors", s.handlers.GetOPCUASensors)
	s.mux.HandleFunc("GET /api/objects/{name}/opcua/sensors/{id}", s.handlers.GetOPCUASensor)
	s.mux.HandleFunc("GET /api/objects/{name}/opcua/get", s.handlers.GetOPCUASensorValues)
	s.mux.HandleFunc("GET /api/objects/{name}/opcua/diagnostics", s.handlers.GetOPCUADiagnostics)
	s.mux.HandleFunc("POST /api/objects/{name}/opcua/control/take", s.handlers.TakeOPCUAControl)
	s.mux.HandleFunc("POST /api/objects/{name}/opcua/control/release", s.handlers.ReleaseOPCUAControl)

	// ModbusMaster API
	s.mux.HandleFunc("GET /api/objects/{name}/modbus/status", s.handlers.GetMBStatus)
	s.mux.HandleFunc("GET /api/objects/{name}/modbus/params", s.handlers.GetMBParams)
	s.mux.HandleFunc("POST /api/objects/{name}/modbus/params", s.handlers.SetMBParams)
	s.mux.HandleFunc("GET /api/objects/{name}/modbus/registers", s.handlers.GetMBRegisters)
	s.mux.HandleFunc("GET /api/objects/{name}/modbus/get", s.handlers.GetMBRegisterValues)
	s.mux.HandleFunc("GET /api/objects/{name}/modbus/devices", s.handlers.GetMBDevices)
	s.mux.HandleFunc("GET /api/objects/{name}/modbus/mode", s.handlers.GetMBMode)
	s.mux.HandleFunc("GET /api/objects/{name}/modbus/mode/supported", s.handlers.GetMBModeSupported)
	s.mux.HandleFunc("POST /api/objects/{name}/modbus/mode", s.handlers.SetMBMode)
	s.mux.HandleFunc("POST /api/objects/{name}/modbus/control/take", s.handlers.TakeMBControl)
	s.mux.HandleFunc("POST /api/objects/{name}/modbus/control/release", s.handlers.ReleaseMBControl)

	// Modbus SSE subscriptions (for ModbusMaster and ModbusSlave)
	s.mux.HandleFunc("POST /api/objects/{name}/modbus/subscribe", s.handlers.SubscribeModbusRegisters)
	s.mux.HandleFunc("POST /api/objects/{name}/modbus/unsubscribe", s.handlers.UnsubscribeModbusRegisters)
	s.mux.HandleFunc("GET /api/objects/{name}/modbus/subscriptions", s.handlers.GetModbusSubscriptions)

	// OPCUA SSE subscriptions
	s.mux.HandleFunc("POST /api/objects/{name}/opcua/subscribe", s.handlers.SubscribeOPCUASensors)
	s.mux.HandleFunc("POST /api/objects/{name}/opcua/unsubscribe", s.handlers.UnsubscribeOPCUASensors)
	s.mux.HandleFunc("GET /api/objects/{name}/opcua/subscriptions", s.handlers.GetOPCUASubscriptions)

	// UWebSocketGate API
	s.mux.HandleFunc("POST /api/objects/{name}/uwsgate/subscribe", s.handlers.SubscribeUWSGateSensors)
	s.mux.HandleFunc("POST /api/objects/{name}/uwsgate/unsubscribe", s.handlers.UnsubscribeUWSGateSensors)
	s.mux.HandleFunc("GET /api/objects/{name}/uwsgate/subscriptions", s.handlers.GetUWSGateSubscriptions)
	s.mux.HandleFunc("GET /api/objects/{name}/uwsgate/sensors", s.handlers.GetUWSGateSensors)

	// UNetExchange API
	s.mux.HandleFunc("GET /api/objects/{name}/unet/status", s.handlers.GetUNetStatus)
	s.mux.HandleFunc("GET /api/objects/{name}/unet/receivers", s.handlers.GetUNetReceivers)
	s.mux.HandleFunc("GET /api/objects/{name}/unet/senders", s.handlers.GetUNetSenders)

	// LogServer API
	s.mux.HandleFunc("GET /api/logs/status", s.handlers.GetAllLogServerStatuses)
	s.mux.HandleFunc("GET /api/logs/{name}/status", s.handlers.GetLogServerStatus)
	s.mux.HandleFunc("GET /api/logs/{name}/stream", s.handlers.HandleLogServerStream)
	s.mux.HandleFunc("POST /api/logs/{name}/command", s.handlers.SendLogServerCommand)

	// Server Management API (multi-server support)
	s.mux.HandleFunc("GET /api/servers", s.handlers.GetServers)
	s.mux.HandleFunc("POST /api/servers", s.handlers.AddServer)
	s.mux.HandleFunc("DELETE /api/servers/{id}", s.handlers.RemoveServer)
	s.mux.HandleFunc("GET /api/servers/{id}/status", s.handlers.GetServerStatus)
	s.mux.HandleFunc("GET /api/all-objects", s.handlers.GetAllObjectsWithServers)

	// Settings API
	s.mux.HandleFunc("GET /api/settings/poll-interval", s.handlers.GetPollInterval)
	s.mux.HandleFunc("POST /api/settings/poll-interval", s.handlers.SetPollInterval)

	// Application config for UI
	s.mux.HandleFunc("GET /api/config", s.handlers.GetConfig)

	// Dashboard API
	s.mux.HandleFunc("GET /api/dashboards", s.handlers.GetDashboards)
	s.mux.HandleFunc("GET /api/dashboards/{name}", s.handlers.GetDashboard)

	// Session Control API
	s.mux.HandleFunc("GET /api/control/status", s.handlers.GetControlStatus)
	s.mux.HandleFunc("POST /api/control/take", s.handlers.TakeControl)
	s.mux.HandleFunc("POST /api/control/release", s.handlers.ReleaseControl)
	s.mux.HandleFunc("POST /api/control/ping", s.handlers.PingControl)

	// Recording API
	s.mux.HandleFunc("GET /api/recording/status", s.handlers.GetRecordingStatus)
	s.mux.HandleFunc("POST /api/recording/start", s.handlers.StartRecording)
	s.mux.HandleFunc("POST /api/recording/stop", s.handlers.StopRecording)
	s.mux.HandleFunc("DELETE /api/recording/clear", s.handlers.ClearRecording)

	// Export API
	s.mux.HandleFunc("GET /api/export/database", s.handlers.ExportDatabase)
	s.mux.HandleFunc("GET /api/export/csv", s.handlers.ExportCSV)
	s.mux.HandleFunc("GET /api/export/json", s.handlers.ExportJSON)

	// Static files
	staticHandler := http.FileServer(http.FS(staticFS))

	// Внешние файлы для hot reload при разработке
	hasExternalFiles := s.jsFile != "" || s.cssFile != ""

	if s.jsFile != "" {
		logger.Info("Using external JS file", "path", s.jsFile)
		s.mux.HandleFunc("GET /static/js/app.js", func(w http.ResponseWriter, r *http.Request) {
			content, err := os.ReadFile(s.jsFile)
			if err != nil {
				logger.Error("Failed to read external JS file", "path", s.jsFile, "error", err)
				http.Error(w, "JS file not found", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/javascript")
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			w.Write(content)
		})
	}

	if s.cssFile != "" {
		logger.Info("Using external CSS file", "path", s.cssFile)
		s.mux.HandleFunc("GET /static/css/style.css", func(w http.ResponseWriter, r *http.Request) {
			content, err := os.ReadFile(s.cssFile)
			if err != nil {
				logger.Error("Failed to read external CSS file", "path", s.cssFile, "error", err)
				http.Error(w, "CSS file not found", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "text/css")
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			w.Write(content)
		})
	}

	if hasExternalFiles {
		// Остальные static файлы из embedded FS
		s.mux.HandleFunc("GET /static/", func(w http.ResponseWriter, r *http.Request) {
			// Внешние файлы уже обрабатываются выше
			if (s.jsFile != "" && strings.HasSuffix(r.URL.Path, "/app.js")) ||
				(s.cssFile != "" && strings.HasSuffix(r.URL.Path, "/style.css")) {
				return
			}
			staticHandler.ServeHTTP(w, r)
		})
	} else {
		s.mux.Handle("GET /static/", staticHandler)
	}

	// Index page
	s.mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, staticFS, "templates/index.html")
	})
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}
