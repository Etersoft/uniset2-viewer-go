
// ============================================================================
// Widget Registry
// ============================================================================

const WIDGET_TYPES = {
    'gauge': GaugeWidget,
    'level': LevelWidget,
    'led': LedWidget,
    'label': LabelWidget,
    'divider': DividerWidget,
    'statusbar': StatusBarWidget,
    'bargraph': BarGraphWidget,
    'digital': DigitalWidget,
    'chart': ChartWidget
};

// Grid settings (4x finer grid for precise positioning)
const GRID_COLS = 48;
const GRID_ROW_HEIGHT = 30;
const GRID_GAP = 4;

// ============================================================================
// Dashboard Manager
// ============================================================================

class DashboardManager {
    constructor() {
        this.gridEl = document.getElementById('dashboard-grid');
        this.selectEl = document.getElementById('dashboard-select');
        this.actionsEl = document.getElementById('dashboard-actions');

        this.loadDashboards();
        this.bindEvents();
    }

    bindEvents() {
        // View switcher
        document.getElementById('view-objects-btn')?.addEventListener('click', () => this.switchView('objects'));
        document.getElementById('view-dashboard-btn')?.addEventListener('click', () => this.switchView('dashboard'));

        // Dashboard selector
        this.selectEl?.addEventListener('change', (e) => this.loadDashboard(e.target.value));

        // Dashboard actions
        document.getElementById('dashboard-new-btn')?.addEventListener('click', () => this.showNewDashboardDialog());
        document.getElementById('dashboard-add-widget-btn')?.addEventListener('click', () => this.showWidgetPicker());
        document.getElementById('dashboard-edit-btn')?.addEventListener('click', () => this.toggleEditMode());
        document.getElementById('dashboard-import-btn')?.addEventListener('click', () => this.showImportDialog());
        document.getElementById('dashboard-export-btn')?.addEventListener('click', () => this.exportDashboard());
        document.getElementById('dashboard-delete-btn')?.addEventListener('click', () => this.deleteDashboard());

        // Dialog events
        document.getElementById('dashboard-name-confirm')?.addEventListener('click', () => this.createDashboard());
        document.getElementById('widget-config-apply')?.addEventListener('click', () => this.applyWidgetConfig());
        document.getElementById('import-confirm')?.addEventListener('click', () => this.confirmImport());

        // Import dropzone
        this.setupImportDropzone();

        // Dashboards section collapse toggle
        document.getElementById('dashboards-section-header')?.addEventListener('click', () => {
            const section = document.getElementById('dashboards-section');
            section?.classList.toggle('collapsed');
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeWidgetPicker();
                closeWidgetConfig();
                closeDashboardNameDialog();
                closeDashboardImport();
                // Deselect widget
                if (dashboardState.selectedWidgetId) {
                    this.selectWidget(null);
                }
            }

            // Arrow keys for moving selected widget
            // Default: move by grid cell, Shift+Arrow: move by 1px (fine mode)
            if (dashboardState.editMode && dashboardState.selectedWidgetId) {
                const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
                if (arrowKeys.includes(e.key)) {
                    e.preventDefault();
                    this.moveWidgetByKey(e.key, e.shiftKey);
                }
            }
        });

        // Click on grid background deselects widget
        this.gridEl?.addEventListener('click', (e) => {
            if (!dashboardState.editMode) return;
            // Only deselect if clicked directly on grid, not on a widget
            if (e.target === this.gridEl || e.target.classList.contains('dashboard-placeholder')) {
                this.selectWidget(null);
            }
        });
    }

    switchView(view) {
        // Delegate to global switchView function
        if (typeof window.switchView === 'function') {
            window.switchView(view);
        }
        this.saveDashboardSettings();
    }

    // Обновить все виджеты с их текущими значениями
    refreshAllWidgets() {
        dashboardState.widgets.forEach((widget) => {
            if (widget.value !== null) {
                widget.update(widget.value, widget.error);
            }
        });
    }

    loadDashboards() {
        // Load from localStorage
        try {
            const userDashboards = JSON.parse(localStorage.getItem('user-dashboards') || '[]');
            userDashboards.forEach(name => {
                const config = localStorage.getItem(`dashboard:${name}`);
                if (config) {
                    dashboardState.dashboards.set(name, JSON.parse(config));
                }
            });
        } catch (err) {
            console.warn('Failed to load dashboards from localStorage:', err);
        }

        // Load server dashboards
        this.loadServerDashboards();

        // Update selector
        this.updateDashboardSelector();

        // Restore last viewed dashboard
        const lastDashboard = localStorage.getItem('last-dashboard');
        if (lastDashboard && dashboardState.dashboards.has(lastDashboard)) {
            this.loadDashboard(lastDashboard);
        }
    }

    async loadServerDashboards() {
        try {
            const response = await fetch('/api/dashboards');
            if (response.ok) {
                const dashboardInfos = await response.json();
                if (Array.isArray(dashboardInfos) && dashboardInfos.length > 0) {
                    // API returns array of DashboardInfo (name, description, widgetCount, server)
                    for (const info of dashboardInfos) {
                        const name = info.name;
                        if (!name) continue;
                        // Don't overwrite user dashboards with same name
                        if (dashboardState.dashboards.has(name)) {
                            continue;
                        }
                        // Create placeholder - will be loaded on demand
                        dashboardState.dashboards.set(name, {
                            _server: true,
                            _loaded: false,
                            meta: { name, description: info.description || '' }
                        });
                    }
                    this.updateDashboardSelector();
                }
            }
        } catch (err) {
            console.log('No server dashboards available');
        }
    }

    updateDashboardSelector() {
        if (!this.selectEl) return;

        const currentValue = this.selectEl.value;

        let html = '<option value="">Select dashboard...</option>';

        // Server dashboards
        const serverDashboards = Array.from(dashboardState.dashboards.entries())
            .filter(([_, config]) => config._server);
        if (serverDashboards.length > 0) {
            html += '<optgroup label="Server Dashboards">';
            serverDashboards.forEach(([name]) => {
                html += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
            });
            html += '</optgroup>';
        }

        // User dashboards
        const userDashboards = Array.from(dashboardState.dashboards.entries())
            .filter(([_, config]) => !config._server);
        if (userDashboards.length > 0) {
            html += '<optgroup label="My Dashboards">';
            userDashboards.forEach(([name]) => {
                html += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
            });
            html += '</optgroup>';
        }

        this.selectEl.innerHTML = html;
        this.selectEl.value = currentValue;

        // Also update sidebar dashboards list
        this.updateSidebarDashboards();
    }

    updateSidebarDashboards() {
        const listEl = document.getElementById('dashboards-list');
        const countEl = document.getElementById('dashboards-count');
        if (!listEl) return;

        const allDashboards = Array.from(dashboardState.dashboards.entries());
        const serverDashboards = allDashboards.filter(([_, c]) => c._server);
        const userDashboards = allDashboards.filter(([_, c]) => !c._server);

        // Update count
        if (countEl) {
            countEl.textContent = allDashboards.length;
        }

        // Build list HTML
        let html = '';

        // Server dashboards first
        serverDashboards.forEach(([name]) => {
            const isActive = dashboardState.currentDashboard === name;
            html += `
                <li class="dashboard-item server${isActive ? ' active' : ''}" data-name="${escapeHtml(name)}">
                    <svg class="dashboard-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="7" height="7"/>
                        <rect x="14" y="3" width="7" height="7"/>
                        <rect x="14" y="14" width="7" height="7"/>
                        <rect x="3" y="14" width="7" height="7"/>
                    </svg>
                    <span class="dashboard-name">${escapeHtml(name)}</span>
                    <span class="dashboard-badge">srv</span>
                </li>
            `;
        });

        // User dashboards
        userDashboards.forEach(([name]) => {
            const isActive = dashboardState.currentDashboard === name;
            html += `
                <li class="dashboard-item${isActive ? ' active' : ''}" data-name="${escapeHtml(name)}">
                    <svg class="dashboard-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="7" height="7"/>
                        <rect x="14" y="3" width="7" height="7"/>
                        <rect x="14" y="14" width="7" height="7"/>
                        <rect x="3" y="14" width="7" height="7"/>
                    </svg>
                    <span class="dashboard-name">${escapeHtml(name)}</span>
                </li>
            `;
        });

        listEl.innerHTML = html;

        // Bind click events
        listEl.querySelectorAll('.dashboard-item').forEach(item => {
            item.addEventListener('click', () => {
                const name = item.dataset.name;
                this.switchView('dashboard');
                this.loadDashboard(name);
                if (this.selectEl) {
                    this.selectEl.value = name;
                }
            });
        });
    }

    async loadDashboard(name) {
        if (!name) {
            this.clearDashboard();
            return;
        }

        let config = dashboardState.dashboards.get(name);
        if (!config) {
            console.warn('Dashboard not found:', name);
            return;
        }

        // Lazy load server dashboard if not yet loaded
        if (config._server && !config._loaded) {
            try {
                const response = await fetch(`/api/dashboards/${encodeURIComponent(name)}`);
                if (response.ok) {
                    const fullConfig = await response.json();
                    fullConfig._server = true;
                    fullConfig._loaded = true;
                    dashboardState.dashboards.set(name, fullConfig);
                    config = fullConfig;
                } else {
                    console.error('Failed to load dashboard:', name, response.status);
                    return;
                }
            } catch (err) {
                console.error('Error loading dashboard:', name, err);
                return;
            }
        }

        dashboardState.currentDashboard = name;
        this.actionsEl?.classList.remove('hidden');

        // Update sidebar active state
        this.updateSidebarDashboards();

        // Clear existing widgets
        this.clearWidgets();

        // Render widgets
        this.renderDashboard(config);

        // Save last viewed
        localStorage.setItem('last-dashboard', name);

        // Update edit button for server dashboards
        const editBtn = document.getElementById('dashboard-edit-btn');
        const deleteBtn = document.getElementById('dashboard-delete-btn');
        if (config._server) {
            editBtn?.classList.add('hidden');
            deleteBtn?.classList.add('hidden');
        } else {
            editBtn?.classList.remove('hidden');
            deleteBtn?.classList.remove('hidden');
        }
    }

    renderDashboard(config) {
        if (!this.gridEl) return;

        this.gridEl.innerHTML = '';

        if (!config.widgets || config.widgets.length === 0) {
            this.gridEl.innerHTML = `
                <div class="dashboard-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <line x1="12" y1="8" x2="12" y2="16"/>
                        <line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                    <p>Dashboard is empty. Click "Add Widget" to get started.</p>
                </div>
            `;
            return;
        }

        config.widgets.forEach(widgetConfig => {
            this.createWidget(widgetConfig);
        });

        // Subscribe to sensor updates
        this.updateSensorSubscriptions();

        // Initialize widgets with cached/fetched values
        this.initializeWidgetValues();
    }

    // Initialize widgets with current sensor values (from cache or API)
    async initializeWidgetValues() {
        // Collect unique sensor names from subscriptions
        const sensorNames = new Set();
        for (const sensorName of dashboardState.sensorSubscriptions.keys()) {
            sensorNames.add(sensorName);
        }
        for (const sensorName of dashboardState.setpointSubscriptions.keys()) {
            sensorNames.add(sensorName);
        }
        for (const sensorName of dashboardState.chartSubscriptions.keys()) {
            sensorNames.add(sensorName);
        }

        if (sensorNames.size === 0) return;

        // First, try to use cached values from SSE events
        const uncachedSensors = [];
        for (const name of sensorNames) {
            const cached = state.sensorValuesCache.get(name);
            if (cached) {
                // Use cached value (not older than 60 seconds)
                if (Date.now() - cached.timestamp < 60000) {
                    this.handleSensorUpdate(name, cached.value, cached.error);
                } else {
                    uncachedSensors.push(name);
                }
            } else {
                uncachedSensors.push(name);
            }
        }

        // For uncached sensors, try to fetch from API
        if (uncachedSensors.length > 0) {
            this.fetchSensorValues(uncachedSensors);
        }
    }

    // Fetch sensor values from IONC API
    async fetchSensorValues(sensorNames) {
        // Find SharedMemory server
        let smServerId = null;
        for (const [id, server] of state.servers) {
            if (server.connected) {
                smServerId = id;
                break;
            }
        }

        if (!smServerId) return;

        // Fetch each sensor (could be optimized with batch API)
        for (const name of sensorNames) {
            try {
                const response = await fetch(`/api/objects/SharedMemory/ionc/sensors?server=${smServerId}&search=${encodeURIComponent(name)}&limit=1`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.sensors && data.sensors.length > 0) {
                        const sensor = data.sensors.find(s => s.name === name);
                        if (sensor) {
                            // Cache and update
                            state.sensorValuesCache.set(name, {
                                value: sensor.value,
                                error: null,
                                timestamp: Date.now()
                            });
                            this.handleSensorUpdate(name, sensor.value, null);
                        }
                    }
                }
            } catch (err) {
                console.warn('Failed to fetch sensor value:', name, err);
            }
        }
    }

    createWidget(widgetConfig) {
        const WidgetClass = WIDGET_TYPES[widgetConfig.type];
        if (!WidgetClass) {
            console.warn('Unknown widget type:', widgetConfig.type);
            return null;
        }

        const { position = {} } = widgetConfig;
        const { col = 0, row = 0, width = 2, height = 1, freePosition, offset } = position;

        // Create widget container
        const container = document.createElement('div');
        container.className = `dashboard-widget widget-${width}x${height}`;
        // Transparent by default for most widgets, but NOT for chart
        const isChart = widgetConfig.type === 'chart';
        const isTransparent = isChart
            ? (widgetConfig.config?.transparent === true)  // chart: explicit true only
            : (widgetConfig.config?.transparent !== false); // others: default true
        if (isTransparent) {
            container.classList.add('transparent');
        }
        // Build transform string (offset + rotation)
        const rotate = widgetConfig.config?.rotate || 0;
        const transforms = [];
        if (offset && (offset.x || offset.y)) {
            transforms.push(`translate(${offset.x || 0}px, ${offset.y || 0}px)`);
        }
        if (rotate) {
            transforms.push(`rotate(${rotate}deg)`);
        }
        if (transforms.length > 0) {
            container.style.transform = transforms.join(' ');
        }
        container.dataset.widgetId = widgetConfig.id;
        container.dataset.type = widgetConfig.type;

        // Free pixel positioning (Shift+drag) or grid snap
        if (freePosition) {
            container.style.position = 'absolute';
            container.style.left = `${freePosition.left}px`;
            container.style.top = `${freePosition.top}px`;
            // Always calculate size from grid cells (width/height are always in cells)
            const gap = GRID_GAP;
            const gridEl = this.gridEl || document.querySelector('.dashboard-grid');
            if (gridEl) {
                const gridRect = gridEl.getBoundingClientRect();
                const computedStyle = window.getComputedStyle(gridEl);
                const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
                const contentWidth = gridRect.width - paddingLeft * 2;
                const cellWidth = (contentWidth - gap * (GRID_COLS - 1)) / GRID_COLS;
                const cellHeight = GRID_ROW_HEIGHT;
                container.style.width = `${width * cellWidth + (width - 1) * gap}px`;
                container.style.height = `${height * cellHeight + (height - 1) * gap}px`;
            }
            container.classList.add('free-position');
        } else {
            container.style.gridColumn = `${col + 1} / span ${width}`;
            container.style.gridRow = `${row + 1} / span ${height}`;
        }

        // Widget header (always hidden, shows action buttons on hover)
        // Title is rendered inside widget-content by the widget
        container.innerHTML = `
            <div class="widget-header hidden-title">
                <span class="widget-title">${escapeHtml(widgetConfig.config?.label || widgetConfig.type)}</span>
                <div class="widget-actions">
                    <button class="widget-action-btn config" title="Configure">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
                        </svg>
                    </button>
                    <button class="widget-action-btn delete" title="Remove">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="widget-resize-handle" title="Drag to resize"></div>
        `;

        // Create widget instance
        const widget = new WidgetClass(widgetConfig.id, widgetConfig.config || {}, container);
        widget.render();

        // Inject title if configured (before widget-content, not inside)
        const title = widgetConfig.config?.title;
        if (title) {
            const widgetContent = container.querySelector('.widget-content');
            if (widgetContent) {
                const titleEl = document.createElement('div');
                titleEl.className = 'widget-title-label' + (widgetConfig.config?.titleBorder ? ' title-badge' : '');
                titleEl.textContent = title;
                // Insert BEFORE widget-content, not inside it
                widgetContent.parentNode.insertBefore(titleEl, widgetContent);
            }
        }

        // Bind widget events
        container.querySelector('.widget-action-btn.config')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showWidgetConfig(widgetConfig.id);
        });

        container.querySelector('.widget-action-btn.delete')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeWidget(widgetConfig.id);
        });

        // Resize handle
        const resizeHandle = container.querySelector('.widget-resize-handle');
        if (resizeHandle) {
            resizeHandle.addEventListener('mousedown', (e) => {
                if (!dashboardState.editMode) return;
                e.preventDefault();
                e.stopPropagation();
                this.startResize(widgetConfig.id, container, e);
            });
        }

        // Drag by header
        const header = container.querySelector('.widget-header');
        if (header) {
            header.addEventListener('mousedown', (e) => {
                if (!dashboardState.editMode) return;
                // Ignore clicks on buttons
                if (e.target.closest('.widget-action-btn')) return;
                e.preventDefault();
                this.startDrag(widgetConfig.id, container, e);
            });
        }

        // Select/deselect widget by click in edit mode (toggle)
        container.addEventListener('click', (e) => {
            if (!dashboardState.editMode) return;
            // Ignore clicks on buttons
            if (e.target.closest('.widget-action-btn')) return;
            // Toggle: if already selected, deselect
            if (dashboardState.selectedWidgetId === widgetConfig.id) {
                this.selectWidget(null);
            } else {
                this.selectWidget(widgetConfig.id);
            }
        });

        // Add to grid
        this.gridEl.appendChild(container);

        // Store widget instance
        dashboardState.widgets.set(widgetConfig.id, widget);

        return widget;
    }

    clearWidgets() {
        // Destroy all widget instances
        dashboardState.widgets.forEach(widget => {
            if (widget && typeof widget.destroy === 'function') {
                widget.destroy();
            }
        });
        dashboardState.widgets.clear();
        dashboardState.sensorSubscriptions.clear();
    }

    clearDashboard() {
        dashboardState.currentDashboard = null;
        this.clearWidgets();
        this.actionsEl?.classList.add('hidden');

        if (this.gridEl) {
            this.gridEl.innerHTML = `
                <div class="dashboard-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 6v6l4 2"/>
                    </svg>
                    <p>Select a dashboard or create a new one</p>
                </div>
            `;
        }
    }

    showNewDashboardDialog() {
        const overlay = document.getElementById('dashboard-name-overlay');
        const input = document.getElementById('dashboard-name-input');
        const title = document.getElementById('dashboard-name-title');

        if (title) title.textContent = 'New Dashboard';
        if (input) input.value = '';
        overlay?.classList.remove('hidden');
        input?.focus();
    }

    createDashboard() {
        const input = document.getElementById('dashboard-name-input');
        const name = input?.value?.trim();

        if (!name) {
            alert('Please enter a dashboard name');
            return;
        }

        if (dashboardState.dashboards.has(name)) {
            alert('A dashboard with this name already exists');
            return;
        }

        const config = {
            version: DASHBOARD_VERSION,
            meta: {
                name,
                created: new Date().toISOString(),
                modified: new Date().toISOString()
            },
            grid: { cols: GRID_COLS, rowHeight: GRID_ROW_HEIGHT, gap: GRID_GAP },
            widgets: []
        };

        dashboardState.dashboards.set(name, config);
        this.saveDashboard(name);
        this.updateDashboardSelector();

        closeDashboardNameDialog();

        // Select the new dashboard
        if (this.selectEl) {
            this.selectEl.value = name;
        }
        this.loadDashboard(name);
    }

    saveDashboard(name = dashboardState.currentDashboard) {
        if (!name) return;

        const config = dashboardState.dashboards.get(name);
        if (!config || config._server) return; // Don't save server dashboards

        config.meta = config.meta || {};
        config.meta.modified = new Date().toISOString();

        // Save to localStorage
        localStorage.setItem(`dashboard:${name}`, JSON.stringify(config));

        // Update user dashboards list
        const userDashboards = Array.from(dashboardState.dashboards.entries())
            .filter(([_, c]) => !c._server)
            .map(([n]) => n);
        localStorage.setItem('user-dashboards', JSON.stringify(userDashboards));
    }

    saveDashboardSettings() {
        localStorage.setItem('dashboard-view', dashboardState.currentView);
    }

    showWidgetPicker() {
        const overlay = document.getElementById('widget-picker-overlay');
        const content = document.getElementById('widget-picker-content');

        if (!content) return;

        content.innerHTML = Object.values(WIDGET_TYPES).map(WidgetClass => `
            <div class="widget-picker-item" data-type="${WidgetClass.type}">
                <div class="widget-picker-icon">${WidgetClass.icon}</div>
                <span class="widget-picker-name">${WidgetClass.displayName}</span>
                <span class="widget-picker-desc">${WidgetClass.description}</span>
            </div>
        `).join('');

        // Bind click events
        content.querySelectorAll('.widget-picker-item').forEach(item => {
            item.addEventListener('click', () => {
                const type = item.dataset.type;
                closeWidgetPicker();
                this.showWidgetConfig(null, type);
            });
        });

        overlay?.classList.remove('hidden');
    }

    showWidgetConfig(widgetId, type = null) {
        const overlay = document.getElementById('widget-config-overlay');
        const title = document.getElementById('widget-config-title');
        const content = document.getElementById('widget-config-content');

        if (!content) return;

        let config = {};
        let position = {};
        let WidgetClass;

        if (widgetId) {
            // Editing existing widget
            const dashboard = dashboardState.dashboards.get(dashboardState.currentDashboard);
            const widgetConfig = dashboard?.widgets?.find(w => w.id === widgetId);
            if (widgetConfig) {
                type = widgetConfig.type;
                config = widgetConfig.config || {};
                position = widgetConfig.position || {};
            }
        }

        WidgetClass = WIDGET_TYPES[type];
        if (!WidgetClass) return;

        if (title) {
            title.textContent = widgetId ? `Configure ${WidgetClass.displayName}` : `Add ${WidgetClass.displayName}`;
        }

        // Get current size from position, or default
        const currentWidth = position.width || WidgetClass.defaultSize.width;
        const currentHeight = position.height || WidgetClass.defaultSize.height;

        // Chart widget doesn't show transparent option (always opaque)
        const showTransparent = type !== 'chart';
        const transparentHtml = showTransparent ? `
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label class="widget-toggle">
                        <input type="checkbox" name="transparent" ${config.transparent !== false ? 'checked' : ''}>
                        <span class="widget-toggle-track"><span class="widget-toggle-thumb"></span></span>
                        <span class="widget-toggle-label">Transparent background</span>
                    </label>
                </div>
            </div>
        ` : '';

        // Title option (shown above widget content)
        const titleHtml = `
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Title (optional)</label>
                    <input type="text" class="widget-input" name="title" value="${escapeHtml(config.title || '')}" placeholder="e.g. Engine RPM">
                </div>
                <div class="widget-config-field">
                    <label class="widget-toggle">
                        <input type="checkbox" name="titleBorder" ${config.titleBorder ? 'checked' : ''}>
                        <span class="widget-toggle-track"><span class="widget-toggle-thumb"></span></span>
                        <span class="widget-toggle-label">Badge style</span>
                    </label>
                </div>
            </div>
        `;

        // Rotate option - available for all widget types
        const currentRotate = config.rotate || 0;
        const rotateHtml = `
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Rotate</label>
                    <div class="rotate-input-group">
                        <input type="number" name="rotate" value="${currentRotate}" min="0" max="360" step="1">
                        <span class="rotate-unit">°</span>
                        <div class="rotate-quick-buttons">
                            <button type="button" class="rotate-quick-btn" data-angle="0">0°</button>
                            <button type="button" class="rotate-quick-btn" data-angle="90">90°</button>
                            <button type="button" class="rotate-quick-btn" data-angle="180">180°</button>
                            <button type="button" class="rotate-quick-btn" data-angle="270">270°</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        content.innerHTML = `
            ${WidgetClass.getConfigForm(config)}
            ${titleHtml}
            ${transparentHtml}
            ${rotateHtml}
        `;

        // Store context for apply
        content.dataset.widgetId = widgetId || '';
        content.dataset.widgetType = type;

        // Setup sensor autocomplete for all sensor inputs
        this.setupSensorAutocomplete(content, 'sensor');
        this.setupSensorAutocomplete(content, 'sensor2');

        // Setup chart widget autocomplete for zone sensor inputs
        if (type === 'chart') {
            setupChartWidgetAutocomplete();
        }

        // Setup custom number inputs
        setupNumberInputs(content);

        // Setup rotate quick buttons
        const rotateInput = content.querySelector('[name="rotate"]');
        content.querySelectorAll('.rotate-quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (rotateInput) {
                    rotateInput.value = btn.dataset.angle;
                }
            });
        });

        // Call widget-specific config handlers if available
        if (typeof WidgetClass.initConfigHandlers === 'function') {
            WidgetClass.initConfigHandlers(content, config);
        }

        overlay?.classList.remove('hidden');
    }

    setupSensorAutocomplete(container, fieldName = 'sensor') {
        const sensorInput = container.querySelector(`[name="${fieldName}"]`);
        if (!sensorInput) return;

        // Wrap input in relative container and add autocomplete dropdown
        const field = sensorInput.closest('.widget-config-field');
        if (!field) return;

        field.classList.add('sensor-autocomplete-field');

        // Create autocomplete container
        const autocompleteContainer = document.createElement('div');
        autocompleteContainer.className = 'widget-sensor-autocomplete';
        autocompleteContainer.style.display = 'none';
        field.appendChild(autocompleteContainer);

        // State
        let autocompleteResults = [];
        let selectedIndex = 0;
        let debounceTimer = null;

        const sensors = Array.from(state.sensorsByName.entries()).map(([name, data]) => ({
            name,
            iotype: data?.iotype || '?',
            textname: data?.textname || ''
        }));

        const hideAutocomplete = () => {
            autocompleteContainer.style.display = 'none';
            autocompleteContainer.innerHTML = '';
            autocompleteResults = [];
            selectedIndex = 0;
        };

        const showAutocomplete = (matches) => {
            if (matches.length === 0) {
                hideAutocomplete();
                return;
            }

            autocompleteResults = matches;
            selectedIndex = 0;

            autocompleteContainer.innerHTML = matches.map((s, i) => `
                <div class="widget-autocomplete-item${i === 0 ? ' selected' : ''}" data-name="${escapeHtml(s.name)}">
                    <span class="sensor-name">${escapeHtml(s.name)}</span>
                    <span class="type-badge type-${s.iotype}">${s.iotype}</span>
                    ${s.textname ? `<span class="sensor-textname">${escapeHtml(s.textname)}</span>` : ''}
                </div>
            `).join('');

            // Click handlers
            autocompleteContainer.querySelectorAll('.widget-autocomplete-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    sensorInput.value = item.dataset.name;
                    hideAutocomplete();
                });
            });

            autocompleteContainer.style.display = 'block';
        };

        const updateSelection = () => {
            const items = autocompleteContainer.querySelectorAll('.widget-autocomplete-item');
            items.forEach((item, i) => {
                item.classList.toggle('selected', i === selectedIndex);
            });
            // Scroll selected into view
            const selected = autocompleteContainer.querySelector('.selected');
            if (selected) {
                selected.scrollIntoView({ block: 'nearest' });
            }
        };

        const navigateAutocomplete = (direction) => {
            if (autocompleteResults.length === 0) return;
            selectedIndex = Math.max(0, Math.min(autocompleteResults.length - 1, selectedIndex + direction));
            updateSelection();
        };

        // Input event - debounced search
        sensorInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const query = sensorInput.value.trim().toLowerCase();
                if (query.length < 2) {
                    hideAutocomplete();
                    return;
                }

                // Filter: partial match (contains)
                const matches = sensors
                    .filter(s => s.name.toLowerCase().includes(query))
                    .slice(0, 10);

                showAutocomplete(matches);
            }, 150);
        });

        // Keyboard navigation
        sensorInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                sensorInput.value = '';
                sensorInput.blur();
                hideAutocomplete();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                navigateAutocomplete(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                navigateAutocomplete(-1);
            } else if (e.key === 'Enter') {
                if (autocompleteResults.length > 0) {
                    e.preventDefault();
                    sensorInput.value = autocompleteResults[selectedIndex].name;
                    hideAutocomplete();
                }
            }
        });

        // Focus - show autocomplete if text is present
        sensorInput.addEventListener('focus', () => {
            const query = sensorInput.value.trim().toLowerCase();
            if (query.length >= 2) {
                const matches = sensors
                    .filter(s => s.name.toLowerCase().includes(query))
                    .slice(0, 10);
                showAutocomplete(matches);
            }
        });

        // Click outside to hide
        const clickOutsideHandler = (e) => {
            if (!field.contains(e.target)) {
                hideAutocomplete();
            }
        };
        document.addEventListener('click', clickOutsideHandler);

        // Cleanup on overlay close
        const overlay = document.getElementById('widget-config-overlay');
        if (overlay) {
            const observer = new MutationObserver(() => {
                if (overlay.classList.contains('hidden')) {
                    document.removeEventListener('click', clickOutsideHandler);
                    observer.disconnect();
                }
            });
            observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
        }
    }

    applyWidgetConfig() {
        const content = document.getElementById('widget-config-content');
        if (!content) return;

        const widgetId = content.dataset.widgetId;
        const type = content.dataset.widgetType;
        const WidgetClass = WIDGET_TYPES[type];

        if (!WidgetClass) return;

        const config = WidgetClass.parseConfigForm(content);
        const transparent = content.querySelector('[name="transparent"]')?.checked || false;
        config.transparent = transparent;

        // Read title value
        const title = content.querySelector('[name="title"]')?.value?.trim() || '';
        if (title) {
            config.title = title;
        }

        // Read titleBorder value
        const titleBorder = content.querySelector('[name="titleBorder"]')?.checked || false;
        config.titleBorder = titleBorder;

        // Read rotate value
        const rotateInput = content.querySelector('[name="rotate"]');
        const rotate = parseInt(rotateInput?.value) || 0;
        config.rotate = rotate;

        const dashboard = dashboardState.dashboards.get(dashboardState.currentDashboard);
        if (!dashboard) return;

        if (widgetId) {
            // Update existing widget - keep current size
            const widgetConfig = dashboard.widgets.find(w => w.id === widgetId);
            if (widgetConfig) {
                widgetConfig.config = config;
                const width = widgetConfig.position.width;
                const height = widgetConfig.position.height;

                // Re-render widget
                const widget = dashboardState.widgets.get(widgetId);
                if (widget) {
                    widget.config = config;
                    widget.container.className = `dashboard-widget widget-${width}x${height}`;
                    widget.container.classList.toggle('transparent', transparent);
                    // Preserve edit-mode class if active
                    if (dashboardState.editMode) {
                        widget.container.classList.add('edit-mode');
                    }
                    // Apply transform (offset + rotation)
                    const offset = widgetConfig.position?.offset;
                    const transforms = [];
                    if (offset && (offset.x || offset.y)) {
                        transforms.push(`translate(${offset.x || 0}px, ${offset.y || 0}px)`);
                    }
                    if (rotate) {
                        transforms.push(`rotate(${rotate}deg)`);
                    }
                    widget.container.style.transform = transforms.length > 0 ? transforms.join(' ') : '';
                    widget.container.querySelector('.widget-title').textContent = config.label || type;
                    // Remove old title and content before re-render
                    widget.container.querySelector('.widget-title-label')?.remove();
                    widget.container.querySelector('.widget-content')?.remove();
                    widget.render();

                    // Inject title if configured (before widget-content, not inside)
                    if (config.title) {
                        const widgetContent = widget.container.querySelector('.widget-content');
                        if (widgetContent) {
                            const titleEl = document.createElement('div');
                            titleEl.className = 'widget-title-label' + (config.titleBorder ? ' title-badge' : '');
                            titleEl.textContent = config.title;
                            // Insert BEFORE widget-content, not inside it
                            widgetContent.parentNode.insertBefore(titleEl, widgetContent);
                        }
                    }
                }
            }
        } else {
            // Add new widget with default size
            const newId = `widget-${Date.now()}`;
            const width = WidgetClass.defaultSize.width;
            const height = WidgetClass.defaultSize.height;
            const position = this.findEmptyPosition(width, height);

            const widgetConfig = {
                id: newId,
                type,
                position: { ...position, width, height },
                config
            };

            dashboard.widgets = dashboard.widgets || [];
            dashboard.widgets.push(widgetConfig);

            this.createWidget(widgetConfig);
        }

        this.saveDashboard();
        this.updateSensorSubscriptions();
        closeWidgetConfig();
    }

    findEmptyPosition(width, height) {
        // Simple algorithm: find first empty position
        const dashboard = dashboardState.dashboards.get(dashboardState.currentDashboard);
        const widgets = dashboard?.widgets || [];
        const cols = GRID_COLS;

        // Build occupancy grid
        const occupied = new Set();
        widgets.forEach(w => {
            const { col, row, width: w2, height: h } = w.position || {};
            for (let c = col; c < col + w2; c++) {
                for (let r = row; r < row + h; r++) {
                    occupied.add(`${c},${r}`);
                }
            }
        });

        // Find first empty position
        for (let row = 0; row < 100; row++) {
            for (let col = 0; col <= cols - width; col++) {
                let fits = true;
                for (let c = col; c < col + width && fits; c++) {
                    for (let r = row; r < row + height && fits; r++) {
                        if (occupied.has(`${c},${r}`)) {
                            fits = false;
                        }
                    }
                }
                if (fits) {
                    return { col, row };
                }
            }
        }

        return { col: 0, row: 0 };
    }

    async removeWidget(widgetId) {
        const confirmed = await showConfirmDialog(
            'Remove Widget',
            'Are you sure you want to remove this widget?',
            'Remove'
        );
        if (!confirmed) return;

        const dashboard = dashboardState.dashboards.get(dashboardState.currentDashboard);
        if (!dashboard) return;

        // Remove from config
        dashboard.widgets = dashboard.widgets.filter(w => w.id !== widgetId);

        // Remove widget instance
        const widget = dashboardState.widgets.get(widgetId);
        if (widget) {
            widget.container.remove();
            widget.destroy();
            dashboardState.widgets.delete(widgetId);
        }

        this.saveDashboard();
        this.updateSensorSubscriptions();
    }

    startResize(widgetId, container, startEvent) {
        const dashboard = dashboardState.dashboards.get(dashboardState.currentDashboard);
        if (!dashboard) return;

        const widgetConfig = dashboard.widgets.find(w => w.id === widgetId);
        if (!widgetConfig) return;

        const gridRect = this.gridEl.getBoundingClientRect();
        const startX = startEvent.clientX;
        const startY = startEvent.clientY;
        const startWidth = widgetConfig.position.width || 2;
        const startHeight = widgetConfig.position.height || 1;

        // Calculate cell size
        const gap = GRID_GAP;
        const cellWidth = (gridRect.width - gap * (GRID_COLS - 1)) / GRID_COLS;
        const cellHeight = GRID_ROW_HEIGHT;

        container.classList.add('resizing');

        const onMouseMove = (e) => {
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            // Calculate new size in cells
            const col = widgetConfig.position.col || 0;
            const maxWidth = GRID_COLS - col; // Can't extend beyond grid
            let newWidth = Math.max(1, Math.min(maxWidth, Math.round(startWidth + deltaX / (cellWidth + gap))));
            let newHeight = Math.max(1, Math.min(20, Math.round(startHeight + deltaY / (cellHeight + gap))));

            // Update visual preview
            container.style.gridColumn = `${(widgetConfig.position.col || 0) + 1} / span ${newWidth}`;
            container.style.gridRow = `${(widgetConfig.position.row || 0) + 1} / span ${newHeight}`;

            // Store pending size
            container.dataset.pendingWidth = newWidth;
            container.dataset.pendingHeight = newHeight;
        };

        const onMouseUp = () => {
            container.classList.remove('resizing');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            // Apply new size
            const newWidth = parseInt(container.dataset.pendingWidth) || startWidth;
            const newHeight = parseInt(container.dataset.pendingHeight) || startHeight;

            if (newWidth !== startWidth || newHeight !== startHeight) {
                widgetConfig.position.width = newWidth;
                widgetConfig.position.height = newHeight;

                // Update class
                container.className = container.className.replace(/widget-\d+x\d+/, `widget-${newWidth}x${newHeight}`);

                this.saveDashboard();
            }

            delete container.dataset.pendingWidth;
            delete container.dataset.pendingHeight;
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    startDrag(widgetId, container, startEvent) {
        // Auto-select widget being dragged
        if (dashboardState.selectedWidgetId !== widgetId) {
            this.selectWidget(widgetId);
        }

        const dashboard = dashboardState.dashboards.get(dashboardState.currentDashboard);
        if (!dashboard) return;

        const widgetConfig = dashboard.widgets.find(w => w.id === widgetId);
        if (!widgetConfig) return;

        const gridRect = this.gridEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(this.gridEl);
        const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
        const paddingTop = parseFloat(computedStyle.paddingTop) || 0;

        // Offset from mouse to container top-left
        const offsetX = startEvent.clientX - containerRect.left;
        const offsetY = startEvent.clientY - containerRect.top;

        // Calculate cell size (grid content area = width minus padding on both sides)
        const gap = GRID_GAP;
        const contentWidth = gridRect.width - paddingLeft * 2;
        const cellWidth = (contentWidth - gap * (GRID_COLS - 1)) / GRID_COLS;
        const cellHeight = GRID_ROW_HEIGHT;

        const width = widgetConfig.position.width || 2;
        const height = widgetConfig.position.height || 1;

        // Switch to absolute positioning for smooth drag
        container.classList.add('dragging');
        container.style.position = 'fixed';
        container.style.width = `${containerRect.width}px`;
        container.style.height = `${containerRect.height}px`;
        container.style.left = `${containerRect.left}px`;
        container.style.top = `${containerRect.top}px`;
        container.style.zIndex = '1000';
        container.style.gridColumn = '';
        container.style.gridRow = '';

        // Create placeholder with actual widget size (absolute positioning)
        const placeholder = document.createElement('div');
        placeholder.className = 'widget-drag-placeholder';
        placeholder.style.position = 'absolute';
        placeholder.style.width = `${containerRect.width}px`;
        placeholder.style.height = `${containerRect.height}px`;
        // Initial position (use freePosition if available, otherwise calculate from grid)
        const initCol = widgetConfig.position.col || 0;
        const initRow = widgetConfig.position.row || 0;
        const freePos = widgetConfig.position.freePosition;
        if (freePos) {
            placeholder.style.left = `${freePos.left}px`;
            placeholder.style.top = `${freePos.top}px`;
        } else {
            placeholder.style.left = `${initCol * (cellWidth + gap)}px`;
            placeholder.style.top = `${initRow * (cellHeight + gap)}px`;
        }
        this.gridEl.appendChild(placeholder);

        let pendingCol = initCol;
        let pendingRow = initRow;
        let pendingFreePosition = null;
        let isShiftHeld = startEvent.shiftKey;

        const onMouseMove = (e) => {
            // Move container with mouse
            const widgetLeft = e.clientX - offsetX;
            const widgetTop = e.clientY - offsetY;
            container.style.left = `${widgetLeft}px`;
            container.style.top = `${widgetTop}px`;

            isShiftHeld = e.shiftKey;

            // Calculate position relative to grid content area
            const relativeLeft = widgetLeft - gridRect.left - paddingLeft;
            const relativeTop = widgetTop - gridRect.top - paddingTop;

            if (isShiftHeld) {
                // Free pixel positioning (Shift held)
                // Only store left/top, size comes from width/height (grid cells)
                placeholder.style.display = 'none';
                pendingFreePosition = {
                    left: Math.max(0, relativeLeft),
                    top: Math.max(0, relativeTop)
                };
            } else {
                // Grid snap mode
                placeholder.style.display = '';
                pendingFreePosition = null;

                let newCol = Math.floor(relativeLeft / (cellWidth + gap));
                let newRow = Math.floor(relativeTop / (cellHeight + gap));

                // Clamp to grid bounds
                newCol = Math.max(0, Math.min(GRID_COLS - width, newCol));
                newRow = Math.max(0, newRow);

                if (newCol !== pendingCol || newRow !== pendingRow) {
                    pendingCol = newCol;
                    pendingRow = newRow;
                    placeholder.style.left = `${newCol * (cellWidth + gap)}px`;
                    placeholder.style.top = `${newRow * (cellHeight + gap)}px`;
                }
            }
        };

        const onMouseUp = (e) => {
            container.classList.remove('dragging');
            container.classList.remove('free-position');
            container.style.position = '';
            container.style.width = '';
            container.style.height = '';
            container.style.left = '';
            container.style.top = '';
            container.style.zIndex = '';

            placeholder.remove();

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            const useFreePosition = e.shiftKey && pendingFreePosition;

            if (useFreePosition) {
                // Apply free pixel position with size
                widgetConfig.position.freePosition = pendingFreePosition;
                container.style.position = 'absolute';
                container.style.left = `${pendingFreePosition.left}px`;
                container.style.top = `${pendingFreePosition.top}px`;
                container.style.width = `${pendingFreePosition.width}px`;
                container.style.height = `${pendingFreePosition.height}px`;
                container.classList.add('free-position');
                this.saveDashboard();
            } else {
                // Clear free position and apply grid snap
                delete widgetConfig.position.freePosition;

                if (pendingCol !== widgetConfig.position.col || pendingRow !== widgetConfig.position.row) {
                    widgetConfig.position.col = pendingCol;
                    widgetConfig.position.row = pendingRow;
                    this.saveDashboard();
                }

                container.style.gridColumn = `${pendingCol + 1} / span ${width}`;
                container.style.gridRow = `${pendingRow + 1} / span ${height}`;
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    toggleEditMode() {
        dashboardState.editMode = !dashboardState.editMode;

        const editBtn = document.getElementById('dashboard-edit-btn');
        editBtn?.classList.toggle('active', dashboardState.editMode);

        this.gridEl?.classList.toggle('edit-mode', dashboardState.editMode);

        dashboardState.widgets.forEach((widget, id) => {
            widget.container.classList.toggle('edit-mode', dashboardState.editMode);
        });

        if (dashboardState.editMode) {
            this.enableDragAndDrop();
        } else {
            this.disableDragAndDrop();
            // Deselect widget when exiting edit mode
            this.selectWidget(null);
        }
    }

    selectWidget(widgetId) {
        // Deselect previous
        if (dashboardState.selectedWidgetId) {
            const prevWidget = dashboardState.widgets.get(dashboardState.selectedWidgetId);
            prevWidget?.container.classList.remove('selected');
        }

        dashboardState.selectedWidgetId = widgetId;

        // Select new
        if (widgetId) {
            const widget = dashboardState.widgets.get(widgetId);
            widget?.container.classList.add('selected');
        }
    }

    moveWidgetByKey(key, fineMode = false) {
        const widgetId = dashboardState.selectedWidgetId;
        if (!widgetId) return;

        const dashboard = dashboardState.dashboards.get(dashboardState.currentDashboard);
        if (!dashboard) return;

        const widgetConfig = dashboard.widgets.find(w => w.id === widgetId);
        if (!widgetConfig) return;

        const widget = dashboardState.widgets.get(widgetId);
        if (!widget) return;

        const container = widget.container;

        // Calculate grid parameters
        const gridRect = this.gridEl.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(this.gridEl);
        const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
        const gap = GRID_GAP;
        const contentWidth = gridRect.width - paddingLeft * 2;
        const cellWidth = (contentWidth - gap * (GRID_COLS - 1)) / GRID_COLS;
        const cellHeight = GRID_ROW_HEIGHT;

        const width = widgetConfig.position.width || 2;
        const height = widgetConfig.position.height || 1;

        if (fineMode) {
            // Fine mode (Shift): move by 1px using freePosition
            // freePosition only stores left/top, size comes from width/height (grid cells)
            let freePos = widgetConfig.position.freePosition;
            if (!freePos) {
                // Convert grid position to pixels
                const col = widgetConfig.position.col || 0;
                const row = widgetConfig.position.row || 0;
                freePos = {
                    left: col * (cellWidth + gap),
                    top: row * (cellHeight + gap)
                };
            }

            const step = 1;
            switch (key) {
                case 'ArrowUp':
                    freePos.top = Math.max(0, freePos.top - step);
                    break;
                case 'ArrowDown':
                    freePos.top = freePos.top + step;
                    break;
                case 'ArrowLeft':
                    freePos.left = Math.max(0, freePos.left - step);
                    break;
                case 'ArrowRight':
                    freePos.left = freePos.left + step;
                    break;
            }

            // Apply free position
            widgetConfig.position.freePosition = freePos;
            container.style.position = 'absolute';
            container.style.left = `${freePos.left}px`;
            container.style.top = `${freePos.top}px`;
            container.classList.add('free-position');
            container.style.gridColumn = '';
            container.style.gridRow = '';
        } else {
            // Grid mode (default): move by one grid cell
            let col = widgetConfig.position.col || 0;
            let row = widgetConfig.position.row || 0;

            switch (key) {
                case 'ArrowUp':
                    row = Math.max(0, row - 1);
                    break;
                case 'ArrowDown':
                    row = row + 1;
                    break;
                case 'ArrowLeft':
                    col = Math.max(0, col - 1);
                    break;
                case 'ArrowRight':
                    col = Math.min(GRID_COLS - width, col + 1);
                    break;
            }

            // Update grid position
            widgetConfig.position.col = col;
            widgetConfig.position.row = row;

            // Clear free position if was set
            delete widgetConfig.position.freePosition;

            // Apply grid positioning
            container.style.position = '';
            container.style.left = '';
            container.style.top = '';
            container.classList.remove('free-position');
            container.style.gridColumn = `${col + 1} / span ${width}`;
            container.style.gridRow = `${row + 1} / span ${height}`;
        }

        this.saveDashboard();
    }

    enableDragAndDrop() {
        dashboardState.widgets.forEach((widget, id) => {
            widget.container.draggable = true;

            widget.container.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', id);
                widget.container.classList.add('dragging');
            });

            widget.container.addEventListener('dragend', () => {
                widget.container.classList.remove('dragging');
            });
        });

        this.gridEl?.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        this.gridEl?.addEventListener('drop', (e) => {
            e.preventDefault();
            // TODO: Implement grid position calculation
        });
    }

    disableDragAndDrop() {
        dashboardState.widgets.forEach((widget) => {
            widget.container.draggable = false;
        });
    }

    updateSensorSubscriptions() {
        dashboardState.sensorSubscriptions.clear();
        dashboardState.setpointSubscriptions.clear();
        dashboardState.chartSubscriptions.clear();

        dashboardState.widgets.forEach((widget, id) => {
            // Main sensor subscription
            const sensor = widget.config?.sensor;
            if (sensor) {
                if (!dashboardState.sensorSubscriptions.has(sensor)) {
                    dashboardState.sensorSubscriptions.set(sensor, new Set());
                }
                dashboardState.sensorSubscriptions.get(sensor).add(id);
            }

            // Setpoint sensor subscription (for dual scale)
            const sensor2 = widget.config?.sensor2;
            if (sensor2) {
                if (!dashboardState.setpointSubscriptions.has(sensor2)) {
                    dashboardState.setpointSubscriptions.set(sensor2, new Set());
                }
                dashboardState.setpointSubscriptions.get(sensor2).add(id);
            }

            // StatusBar items subscription (multiple sensors in items array)
            const items = widget.config?.items;
            if (Array.isArray(items)) {
                items.forEach(item => {
                    if (item.sensor) {
                        if (!dashboardState.sensorSubscriptions.has(item.sensor)) {
                            dashboardState.sensorSubscriptions.set(item.sensor, new Set());
                        }
                        dashboardState.sensorSubscriptions.get(item.sensor).add(id);
                    }
                });
            }

            // Chart widget subscriptions (multiple sensors from zones)
            if (widget instanceof ChartWidget && typeof widget.getSensorNames === 'function') {
                const sensorNames = widget.getSensorNames();
                for (const sensorName of sensorNames) {
                    if (!dashboardState.chartSubscriptions.has(sensorName)) {
                        dashboardState.chartSubscriptions.set(sensorName, new Set());
                    }
                    dashboardState.chartSubscriptions.get(sensorName).add(id);
                }
            }
        });
    }

    handleSensorUpdate(sensorName, value, error = null, timestamp = null) {
        // Main sensor updates
        const widgetIds = dashboardState.sensorSubscriptions.get(sensorName);
        if (widgetIds) {
            widgetIds.forEach(id => {
                const widget = dashboardState.widgets.get(id);
                if (widget) {
                    // StatusBar widget uses updateBySensor for items
                    if (typeof widget.updateBySensor === 'function') {
                        widget.updateBySensor(sensorName, value, error);
                    } else {
                        widget.update(value, error);
                    }
                }
            });
        }

        // Setpoint sensor updates
        const setpointWidgetIds = dashboardState.setpointSubscriptions.get(sensorName);
        if (setpointWidgetIds) {
            setpointWidgetIds.forEach(id => {
                const widget = dashboardState.widgets.get(id);
                if (widget && typeof widget.updateSetpoint === 'function') {
                    widget.updateSetpoint(value, error);
                }
            });
        }

        // Chart widget updates
        const chartWidgetIds = dashboardState.chartSubscriptions.get(sensorName);
        if (chartWidgetIds) {
            chartWidgetIds.forEach(id => {
                const widget = dashboardState.widgets.get(id);
                if (widget && typeof widget.updateSensor === 'function') {
                    widget.updateSensor(sensorName, value, timestamp);
                }
            });
        }
    }

    exportDashboard() {
        const name = dashboardState.currentDashboard;
        if (!name) return;

        const config = dashboardState.dashboards.get(name);
        if (!config) return;

        // Create clean export (remove internal flags)
        const exportConfig = JSON.parse(JSON.stringify(config));
        delete exportConfig._server;

        const blob = new Blob([JSON.stringify(exportConfig, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
        a.click();

        URL.revokeObjectURL(url);
    }

    setupImportDropzone() {
        const dropzone = document.getElementById('import-dropzone');
        const fileInput = document.getElementById('import-file-input');

        if (!dropzone || !fileInput) return;

        dropzone.addEventListener('click', () => fileInput.click());

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('drag-over');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('drag-over');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('drag-over');

            const file = e.dataTransfer.files[0];
            if (file) this.handleImportFile(file);
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.handleImportFile(file);
        });

        // Import mode toggle
        document.querySelectorAll('[name="import-mode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const nameField = document.getElementById('import-name-field');
                if (radio.value === 'new') {
                    nameField?.classList.remove('hidden');
                } else {
                    nameField?.classList.add('hidden');
                }
            });
        });
    }

    handleImportFile(file) {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const config = JSON.parse(e.target.result);

                // Validate
                if (!config.widgets || !Array.isArray(config.widgets)) {
                    throw new Error('Invalid dashboard format: missing widgets array');
                }

                // Migrate if needed
                const migrated = migrateDashboard(config);

                dashboardState.pendingImport = migrated;

                // Update UI
                const dropzone = document.getElementById('import-dropzone');
                dropzone?.classList.add('has-file');
                dropzone.querySelector('p').textContent = `${file.name} (${config.widgets.length} widgets)`;

                const nameInput = document.getElementById('import-name-input');
                if (nameInput) {
                    nameInput.value = config.meta?.name || file.name.replace('.json', '');
                }

                document.getElementById('import-confirm').disabled = false;
                document.getElementById('import-error')?.classList.add('hidden');

            } catch (err) {
                const errorEl = document.getElementById('import-error');
                if (errorEl) {
                    errorEl.textContent = err.message;
                    errorEl.classList.remove('hidden');
                }
                document.getElementById('import-confirm').disabled = true;
            }
        };

        reader.readAsText(file);
    }

    showImportDialog() {
        const overlay = document.getElementById('dashboard-import-overlay');
        const dropzone = document.getElementById('import-dropzone');

        // Reset state
        dashboardState.pendingImport = null;
        dropzone?.classList.remove('has-file');
        if (dropzone) dropzone.querySelector('p').textContent = 'Drop JSON file here or click to browse';
        document.getElementById('import-confirm').disabled = true;
        document.getElementById('import-error')?.classList.add('hidden');
        document.getElementById('import-file-input').value = '';

        overlay?.classList.remove('hidden');
    }

    confirmImport() {
        if (!dashboardState.pendingImport) return;

        const mode = document.querySelector('[name="import-mode"]:checked')?.value;
        let name;

        if (mode === 'replace' && dashboardState.currentDashboard) {
            name = dashboardState.currentDashboard;
        } else {
            name = document.getElementById('import-name-input')?.value?.trim();
            if (!name) {
                alert('Please enter a dashboard name');
                return;
            }
        }

        const config = dashboardState.pendingImport;
        config.meta = config.meta || {};
        config.meta.name = name;
        config.meta.modified = new Date().toISOString();

        dashboardState.dashboards.set(name, config);
        this.saveDashboard(name);
        this.updateDashboardSelector();

        closeDashboardImport();

        // Load imported dashboard
        if (this.selectEl) {
            this.selectEl.value = name;
        }
        this.loadDashboard(name);
    }

    deleteDashboard() {
        const name = dashboardState.currentDashboard;
        if (!name) return;

        const config = dashboardState.dashboards.get(name);
        if (config?._server) {
            alert('Cannot delete server dashboards');
            return;
        }

        if (!confirm(`Delete dashboard "${name}"?`)) return;

        dashboardState.dashboards.delete(name);
        localStorage.removeItem(`dashboard:${name}`);

        // Update user dashboards list
        const userDashboards = Array.from(dashboardState.dashboards.entries())
            .filter(([_, c]) => !c._server)
            .map(([n]) => n);
        localStorage.setItem('user-dashboards', JSON.stringify(userDashboards));

        this.updateDashboardSelector();
        this.clearDashboard();
    }
}

// Dashboard migration
