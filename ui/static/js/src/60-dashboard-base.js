// ============================================================================
// Dashboard System
// ============================================================================

const DASHBOARD_VERSION = 1;

// Dashboard state
const dashboardState = window.dashboardState = {
    currentView: 'objects', // 'objects' or 'dashboard'
    currentDashboard: null, // current dashboard name
    dashboards: new Map(),  // name -> dashboard config
    serverDashboards: [],   // list of server-side dashboards
    editMode: false,
    selectedWidgetId: null, // selected widget for keyboard movement
    widgets: new Map(),     // widgetId -> widget instance
    sensorSubscriptions: new Map(), // sensorName -> Set of widgetIds
    setpointSubscriptions: new Map(), // sensor2Name -> Set of widgetIds (for dual scale)
    chartSubscriptions: new Map(), // sensorName -> Set of widgetIds (for chart widgets)
    pendingImport: null     // pending import data
};

// ============================================================================
// Base Widget Class
// ============================================================================

class DashboardWidget {
    static type = 'base';
    static displayName = 'Base Widget';
    static description = 'Base widget class';
    static icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
    static defaultSize = { width: 2, height: 1 };
    static minSize = { width: 1, height: 1 };
    static maxSize = { width: 6, height: 2 };

    constructor(id, config, container) {
        this.id = id;
        this.config = config;
        this.container = container;
        this.value = null;
        this.error = null;
        this.element = null;
    }

    // Override in subclasses
    render() {
        this.element = document.createElement('div');
        this.element.className = 'widget-content';
        this.element.innerHTML = '<span class="widget-value">--</span>';
        this.container.appendChild(this.element);
    }

    // Override in subclasses
    update(value, error = null) {
        this.value = value;
        this.error = error;
    }

    // Override in subclasses to return config form HTML
    static getConfigForm(config = {}) {
        return `
            <div class="widget-config-field">
                <label>Sensor</label>
                <input type="text" class="widget-input" name="sensor"
                       value="${config.sensor || ''}" placeholder="Type to search..." autocomplete="off">
            </div>
            <div class="widget-config-field">
                <label>Label</label>
                <input type="text" class="widget-input" name="label"
                       value="${config.label || ''}" placeholder="Display label">
            </div>
        `;
    }

    // Override in subclasses to parse form data
    static parseConfigForm(form) {
        return {
            sensor: form.querySelector('[name="sensor"]')?.value || '',
            label: form.querySelector('[name="label"]')?.value || ''
        };
    }

    destroy() {
        if (this.element) {
            this.element.remove();
        }
    }

    getConfig() {
        return { ...this.config };
    }
}

// ============================================================================
// Gauge Widget (SVG)
// ============================================================================

