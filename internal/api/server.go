package api

import (
	"io/fs"
	"net/http"
)

type Server struct {
	mux      *http.ServeMux
	handlers *Handlers
}

func NewServer(handlers *Handlers, staticFS fs.FS) *Server {
	s := &Server{
		mux:      http.NewServeMux(),
		handlers: handlers,
	}
	s.setupRoutes(staticFS)
	return s
}

func (s *Server) setupRoutes(staticFS fs.FS) {
	// API routes
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
	s.mux.HandleFunc("GET /api/objects/{name}/opcua/diagnostics", s.handlers.GetOPCUADiagnostics)
	s.mux.HandleFunc("POST /api/objects/{name}/opcua/control/take", s.handlers.TakeOPCUAControl)
	s.mux.HandleFunc("POST /api/objects/{name}/opcua/control/release", s.handlers.ReleaseOPCUAControl)

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

	// Static files
	staticHandler := http.FileServer(http.FS(staticFS))
	s.mux.Handle("GET /static/", staticHandler)

	// Index page
	s.mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, staticFS, "templates/index.html")
	})
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}
