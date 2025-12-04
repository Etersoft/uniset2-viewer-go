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
	s.mux.HandleFunc("GET /api/sensors/{id}", s.handlers.GetSensorByID)
	s.mux.HandleFunc("GET /api/sensors/by-name/{name}", s.handlers.GetSensorByName)

	// SharedMemory sensors API
	s.mux.HandleFunc("GET /api/sm/sensors", s.handlers.GetSMSensors)

	// External sensors API (SM integration)
	s.mux.HandleFunc("GET /api/objects/{name}/external-sensors", s.handlers.GetExternalSensors)
	s.mux.HandleFunc("POST /api/objects/{name}/external-sensors", s.handlers.SubscribeExternalSensors)
	s.mux.HandleFunc("DELETE /api/objects/{name}/external-sensors/{sensor}", s.handlers.UnsubscribeExternalSensor)

	// LogServer API
	s.mux.HandleFunc("GET /api/logs/status", s.handlers.GetAllLogServerStatuses)
	s.mux.HandleFunc("GET /api/logs/{name}/status", s.handlers.GetLogServerStatus)
	s.mux.HandleFunc("GET /api/logs/{name}/stream", s.handlers.HandleLogServerStream)
	s.mux.HandleFunc("POST /api/logs/{name}/command", s.handlers.SendLogServerCommand)

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
