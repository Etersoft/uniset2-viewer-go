package dashboard

// DashboardInfo is a summary for listing dashboards
type DashboardInfo struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	WidgetCount int    `json:"widgetCount"`
	Server      bool   `json:"server"` // true if server-side dashboard
}
