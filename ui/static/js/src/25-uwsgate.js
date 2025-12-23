// ============================================================================
// UWebSocketGateRenderer - рендерер для объектов UWebSocketGate
// Работает через WebSocket для получения real-time обновлений датчиков
// ============================================================================

class UWebSocketGateRenderer extends BaseObjectRenderer {
    static getTypeName() {
        return 'UWebSocketGate';
    }

    constructor(objectName, tabKey = null) {
        super(objectName, tabKey);

        // Подписанные датчики: name -> sensor data
        this.sensors = new Map();

        // Закреплённые датчики
        this.pinnedSensors = new Set();

        // Кэш всех датчиков из sensorconfig для autocomplete
        this.allSensorsCache = null;

        // Autocomplete состояние
        this.autocompleteResults = [];
        this.selectedAutocompleteIndex = 0;

        // Virtual scroll
        this.rowHeight = 32;
        this.bufferRows = 5;
        this.startIndex = 0;
        this.endIndex = 0;

        // Высота секции датчиков
        this.sensorsHeight = this.loadSectionHeight('uwsgate-sensors-height', 400);

        // localStorage ключи
        this.subscriptionsKey = `uwsgate-subscriptions-${this.tabKey}`;
        this.pinnedKey = `uwsgate-pinned-${this.tabKey}`;
        this.highlightKey = `uwsgate-highlight-${this.tabKey}`;

        // Мигание при изменении значений (по умолчанию выключено)
        this.highlightEnabled = this.loadHighlightSetting();
        this.loadPinnedSensors();
    }

    loadHighlightSetting() {
        try {
            return localStorage.getItem(this.highlightKey) === 'true';
        } catch (e) {
            return false;
        }
    }

    saveHighlightSetting() {
        try {
            localStorage.setItem(this.highlightKey, this.highlightEnabled.toString());
        } catch (e) {}
    }

    loadPinnedSensors() {
        try {
            const saved = localStorage.getItem(this.pinnedKey);
            if (saved) {
                this.pinnedSensors = new Set(JSON.parse(saved));
            }
        } catch (e) {}
    }

    savePinnedSensors() {
        try {
            localStorage.setItem(this.pinnedKey, JSON.stringify(Array.from(this.pinnedSensors)));
        } catch (e) {}
    }

    togglePin(sensorName) {
        if (this.pinnedSensors.has(sensorName)) {
            this.pinnedSensors.delete(sensorName);
        } else {
            this.pinnedSensors.add(sensorName);
        }
        this.savePinnedSensors();
        this.renderSensorsTable();
    }

    unpinAll() {
        this.pinnedSensors.clear();
        this.savePinnedSensors();
        this.renderSensorsTable();
    }

    getChartOptions() {
        return { badge: 'WS', prefix: 'ws' };
    }

    createPanelHTML() {
        return `
            ${this.createChartsSection()}
            ${this.createSensorsSection()}
            ${this.createLogViewerSection()}
            ${this.createLogServerSection()}
            ${this.createObjectInfoSection()}
        `;
    }

    createSensorsSection() {
        return this.createCollapsibleSection('uwsgate-sensors', 'Realtime Sensors', `
            <div class="uwsgate-add-sensor">
                <input type="text"
                       class="uwsgate-sensor-input"
                       id="uwsgate-input-${this.objectName}"
                       placeholder="Type sensor name to add..."
                       autocomplete="off">
                <div class="uwsgate-autocomplete" id="uwsgate-autocomplete-${this.objectName}"></div>
                <label class="uwsgate-highlight-toggle" title="Enable value change highlighting">
                    <input type="checkbox"
                           id="uwsgate-highlight-${this.objectName}"
                           ${this.highlightEnabled ? 'checked' : ''}>
                    <span>Highlight</span>
                </label>
            </div>
            <div class="uwsgate-sensors-container" id="uwsgate-sensors-container-${this.objectName}" style="height: ${this.sensorsHeight}px; overflow-y: auto;">
                <table class="sensors-table uwsgate-sensors-table">
                    <thead>
                        <tr>
                            <th class="col-pin">
                                <span class="uwsgate-unpin-all" id="uwsgate-unpin-${this.objectName}" title="Unpin all" style="display:none">✕</span>
                            </th>
                            <th class="col-chart"></th>
                            <th class="col-id">ID</th>
                            <th class="col-name">Name</th>
                            <th class="col-type">Type</th>
                            <th class="col-value">Value</th>
                            <th class="col-supplier">Supplier</th>
                            <th class="col-status">Status</th>
                            <th class="col-actions"></th>
                        </tr>
                    </thead>
                    <tbody id="uwsgate-sensors-tbody-${this.objectName}">
                        <tr><td colspan="9" class="uwsgate-empty">No sensors subscribed. Type sensor name above to add.</td></tr>
                    </tbody>
                </table>
            </div>
            <div class="section-counter">
                <span id="uwsgate-sensor-count-${this.objectName}">0</span> sensors
            </div>
            <div class="resize-handle" id="uwsgate-sensors-resize-${this.objectName}"></div>
        `, { sectionId: `uwsgate-sensors-section-${this.objectName}` });
    }

    initialize() {
        this.setupEventListeners();
        this.setupSensorsResize();
        this.loadSavedSubscriptions();
        setupChartsResize(this.tabKey);
    }

    setupEventListeners() {
        const input = getElementInTab(this.tabKey, `uwsgate-input-${this.objectName}`);
        if (!input) return;

        // Debounced autocomplete
        let debounceTimer;
        input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => this.updateAutocomplete(input.value), 150);
        });

        // Keyboard navigation
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addSensorFromInput(input.value);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                input.value = '';
                input.blur();
                this.hideAutocomplete();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.navigateAutocomplete(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.navigateAutocomplete(-1);
            }
        });

        // Click outside to hide autocomplete
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.uwsgate-add-sensor')) {
                this.hideAutocomplete();
            }
        });

        // Highlight toggle
        const highlightCheckbox = getElementInTab(this.tabKey, `uwsgate-highlight-${this.objectName}`);
        if (highlightCheckbox) {
            highlightCheckbox.addEventListener('change', () => {
                this.highlightEnabled = highlightCheckbox.checked;
                this.saveHighlightSetting();
            });
        }

        // Unpin all button
        const unpinBtn = getElementInTab(this.tabKey, `uwsgate-unpin-${this.objectName}`);
        if (unpinBtn) {
            unpinBtn.addEventListener('click', () => this.unpinAll());
        }
    }

    setupSensorsResize() {
        const handle = getElementInTab(this.tabKey, `uwsgate-sensors-resize-${this.objectName}`);
        const container = getElementInTab(this.tabKey, `uwsgate-sensors-container-${this.objectName}`);
        if (!handle || !container) return;

        let startY, startHeight;
        const onMouseMove = (e) => {
            const newHeight = startHeight + (e.clientY - startY);
            if (newHeight >= 100 && newHeight <= 800) {
                container.style.height = `${newHeight}px`;
                this.sensorsHeight = newHeight;
            }
        };
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            this.saveSectionHeight('uwsgate-sensors-height', this.sensorsHeight);
        };
        handle.addEventListener('mousedown', (e) => {
            startY = e.clientY;
            startHeight = container.offsetHeight;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });
    }

    async loadAllSensors() {
        if (this.allSensorsCache) return this.allSensorsCache;

        try {
            const response = await fetch('/api/sensors');
            if (!response.ok) return [];
            const data = await response.json();
            this.allSensorsCache = data.sensors || [];
            return this.allSensorsCache;
        } catch (err) {
            console.error('Failed to load sensors for autocomplete:', err);
            return [];
        }
    }

    async updateAutocomplete(query) {
        if (!query || query.length < 2) {
            this.hideAutocomplete();
            return;
        }

        const allSensors = await this.loadAllSensors();
        const queryLower = query.toLowerCase();

        // Filter: name or id contains query, not already subscribed
        const matches = allSensors
            .filter(s =>
                (s.name.toLowerCase().includes(queryLower) ||
                 String(s.id || '').includes(queryLower)) &&
                !this.sensors.has(s.name)
            )
            .slice(0, 10);

        this.showAutocomplete(matches);
    }

    showAutocomplete(matches) {
        const container = getElementInTab(this.tabKey, `uwsgate-autocomplete-${this.objectName}`);
        if (!container) return;

        if (matches.length === 0) {
            this.hideAutocomplete();
            return;
        }

        this.autocompleteResults = matches;
        this.selectedAutocompleteIndex = 0;

        container.innerHTML = matches.map((s, i) => `
            <div class="uwsgate-autocomplete-item${i === 0 ? ' selected' : ''}" data-name="${escapeHtml(s.name)}">
                <span class="sensor-name">${escapeHtml(s.name)}</span>
                <span class="type-badge type-${s.iotype}">${s.iotype || '?'}</span>
                ${s.textname ? `<span class="sensor-textname">${escapeHtml(s.textname)}</span>` : ''}
            </div>
        `).join('');

        // Click handlers
        container.querySelectorAll('.uwsgate-autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
                this.addSensorByName(item.dataset.name);
            });
        });

        container.style.display = 'block';
    }

    hideAutocomplete() {
        const container = getElementInTab(this.tabKey, `uwsgate-autocomplete-${this.objectName}`);
        if (container) {
            container.style.display = 'none';
            container.innerHTML = '';
        }
        this.autocompleteResults = [];
        this.selectedAutocompleteIndex = 0;
    }

    navigateAutocomplete(direction) {
        const container = getElementInTab(this.tabKey, `uwsgate-autocomplete-${this.objectName}`);
        if (!container || this.autocompleteResults.length === 0) return;

        const items = container.querySelectorAll('.uwsgate-autocomplete-item');
        if (items.length === 0) return;

        // Update selection
        items[this.selectedAutocompleteIndex]?.classList.remove('selected');
        this.selectedAutocompleteIndex += direction;
        if (this.selectedAutocompleteIndex < 0) this.selectedAutocompleteIndex = items.length - 1;
        if (this.selectedAutocompleteIndex >= items.length) this.selectedAutocompleteIndex = 0;
        items[this.selectedAutocompleteIndex]?.classList.add('selected');

        // Update input value
        const input = getElementInTab(this.tabKey, `uwsgate-input-${this.objectName}`);
        if (input && this.autocompleteResults[this.selectedAutocompleteIndex]) {
            input.value = this.autocompleteResults[this.selectedAutocompleteIndex].name;
        }
    }

    async addSensorFromInput(name) {
        name = name.trim();
        if (!name) return;

        // Check if it's in autocomplete results
        const match = this.autocompleteResults.find(s =>
            s.name.toLowerCase() === name.toLowerCase()
        );

        if (match) {
            await this.addSensorByName(match.name);
        } else {
            // Try to add as-is
            await this.addSensorByName(name);
        }

        // Clear input
        const input = getElementInTab(this.tabKey, `uwsgate-input-${this.objectName}`);
        if (input) input.value = '';
        this.hideAutocomplete();
    }

    async addSensorByName(name, subscribeToServer = true) {
        if (this.sensors.has(name)) return;

        try {
            // Validate sensor exists in config before adding
            const allSensors = await this.loadAllSensors();
            const sensorInfo = allSensors.find(s => s.name === name);

            if (!sensorInfo) {
                console.warn(`UWebSocketGate: Sensor "${name}" not found in config, skipping`);
                return;
            }

            // Only subscribe if needed (not when loading from server's existing subscriptions)
            if (subscribeToServer) {
                const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/uwsgate/subscribe`);
                const response = await controlledFetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sensors: [name] })
                });

                if (!response.ok) {
                    const error = await response.text();
                    console.error('Failed to subscribe:', error);
                    return;
                }
            }

            this.sensors.set(name, {
                id: sensorInfo.id,
                name: name,
                iotype: sensorInfo.iotype || 'AI',
                textname: sensorInfo.textname || '',
                value: 0,
                error: 0,
                timestamp: 0,
                supplier: '',
                supplier_id: 0
            });

            this.renderSensorsTable();
            if (subscribeToServer) {
                this.saveSubscriptions();
            }
        } catch (err) {
            console.error('Failed to add sensor:', err);
        }
    }

    async removeSensor(name) {
        if (!this.sensors.has(name)) return;

        try {
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/uwsgate/unsubscribe`);
            await controlledFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sensors: [name] })
            });

            this.sensors.delete(name);

            // Remove from chart if present
            const chartOptions = this.getChartOptions();
            const varName = `${chartOptions.prefix}:${name}`;
            removeChart(this.tabKey, varName);

            this.renderSensorsTable();
            this.saveSubscriptions();
        } catch (err) {
            console.error('Failed to remove sensor:', err);
        }
    }

    renderSensorsTable() {
        const tbody = getElementInTab(this.tabKey, `uwsgate-sensors-tbody-${this.objectName}`);
        if (!tbody) return;

        // Show/hide unpin button
        const unpinBtn = getElementInTab(this.tabKey, `uwsgate-unpin-${this.objectName}`);
        if (unpinBtn) {
            unpinBtn.style.display = this.pinnedSensors.size > 0 ? 'inline' : 'none';
        }

        if (this.sensors.size === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="uwsgate-empty">No sensors subscribed. Type sensor name above to add.</td></tr>';
            this.updateSensorCount();
            return;
        }

        // Sort: pinned first, then by name
        const sortedSensors = Array.from(this.sensors.values()).sort((a, b) => {
            const aPinned = this.pinnedSensors.has(a.name);
            const bPinned = this.pinnedSensors.has(b.name);
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            return a.name.localeCompare(b.name);
        });

        const rows = sortedSensors.map(sensor => this.renderSensorRow(sensor));
        tbody.innerHTML = rows.join('');
        this.bindRowEvents(tbody);
        this.updateSensorCount();
    }

    renderSensorRow(sensor) {
        const chartOptions = this.getChartOptions();
        const varName = `${chartOptions.prefix}:${sensor.name}`;
        const isOnChart = this.isSensorOnChart(varName);
        const isPinned = this.pinnedSensors.has(sensor.name);
        const errorClass = sensor.error ? 'uwsgate-sensor-error' : '';
        const pinnedClass = isPinned ? 'uwsgate-sensor-pinned' : '';

        const checkboxId = `uwsgate-chart-${this.objectName}-${sensor.name}`;
        const pinToggleClass = isPinned ? 'pin-toggle pinned' : 'pin-toggle';
        const pinIcon = isPinned ? '📌' : '○';
        const pinTitle = isPinned ? 'Unpin' : 'Pin';
        return `
            <tr class="uwsgate-sensor-row ${errorClass} ${pinnedClass}" data-sensor-name="${escapeHtml(sensor.name)}">
                <td class="col-pin">
                    <span class="${pinToggleClass}" data-name="${escapeHtml(sensor.name)}" title="${pinTitle}">
                        ${pinIcon}
                    </span>
                </td>
                <td class="col-chart">
                    <span class="chart-toggle">
                        <input type="checkbox"
                               id="${escapeHtml(checkboxId)}"
                               class="uwsgate-chart-checkbox chart-toggle-input"
                               data-name="${escapeHtml(sensor.name)}"
                               ${isOnChart ? 'checked' : ''}>
                        <label class="chart-toggle-label" for="${escapeHtml(checkboxId)}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 3v18h18"/><path d="M18 9l-5 5-4-4-3 3"/>
                            </svg>
                        </label>
                    </span>
                </td>
                <td class="col-id">${sensor.id}</td>
                <td class="col-name" title="${escapeHtml(sensor.textname || sensor.name)}">${escapeHtml(sensor.name)}</td>
                <td class="col-type"><span class="type-badge type-${sensor.iotype}">${sensor.iotype || '?'}</span></td>
                <td class="col-value" id="uwsgate-value-${this.objectName}-${escapeHtml(sensor.name)}">${sensor.value}</td>
                <td class="col-supplier" id="uwsgate-supplier-${this.objectName}-${escapeHtml(sensor.name)}" title="${escapeHtml(sensor.supplier || '')}">${escapeHtml(sensor.supplier || '-')}</td>
                <td class="col-status">${sensor.error ? `<span class="error-flag">Error: ${sensor.error}</span>` : '-'}</td>
                <td class="col-actions">
                    <button class="uwsgate-btn-remove" data-name="${escapeHtml(sensor.name)}" title="Remove sensor">✕</button>
                </td>
            </tr>
        `;
    }

    bindRowEvents(tbody) {
        // Remove buttons
        tbody.querySelectorAll('.uwsgate-btn-remove').forEach(btn => {
            btn.addEventListener('click', () => this.removeSensor(btn.dataset.name));
        });

        // Pin toggles
        tbody.querySelectorAll('.pin-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => this.togglePin(toggle.dataset.name));
        });

        // Chart checkboxes
        tbody.querySelectorAll('.uwsgate-chart-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                const sensor = this.sensors.get(cb.dataset.name);
                if (sensor) {
                    this.toggleSensorChart(sensor);
                }
            });
        });
    }

    isSensorOnChart(varName) {
        const tabState = state.tabs.get(this.tabKey);
        return tabState?.charts?.has(varName) || false;
    }

    toggleSensorChart(sensor) {
        const chartOptions = this.getChartOptions();
        const varName = `${chartOptions.prefix}:${sensor.name}`;
        const tabState = state.tabs.get(this.tabKey);
        console.log('UWebSocketGate: toggleSensorChart', { varName, tabKey: this.tabKey, hasChart: tabState?.charts?.has(varName) });

        if (tabState?.charts?.has(varName)) {
            console.log('UWebSocketGate: Removing chart', varName);
            removeChart(this.tabKey, varName);
        } else {
            console.log('UWebSocketGate: Adding chart', varName, 'sensorId:', sensor.id);
            addExternalSensorChart(this.tabKey, varName, sensor.id, sensor.textname || sensor.name, chartOptions);
        }
    }

    updateSensorCount() {
        const el = getElementInTab(this.tabKey, `uwsgate-sensor-count-${this.objectName}`);
        if (el) {
            el.textContent = this.sensors.size;
        }
    }

    // SSE event handler
    handleSSEUpdate(sensorsData) {
        for (const sensor of sensorsData) {
            if (this.sensors.has(sensor.name)) {
                const existing = this.sensors.get(sensor.name);
                existing.value = sensor.value;
                existing.error = sensor.error;
                existing.timestamp = sensor.tv_sec;
                existing.supplier = sensor.supplier || '';
                existing.supplier_id = sensor.supplier_id || 0;

                // Update value cell
                const valueCell = getElementInTab(this.tabKey, `uwsgate-value-${this.objectName}-${sensor.name}`);
                if (valueCell) {
                    valueCell.textContent = sensor.value;
                    // Only highlight if enabled
                    if (this.highlightEnabled) {
                        // CSS animation trigger via reflow
                        valueCell.classList.remove('value-updated');
                        void valueCell.offsetWidth;
                        valueCell.classList.add('value-updated');
                    }
                }

                // Update supplier cell
                const supplierCell = getElementInTab(this.tabKey, `uwsgate-supplier-${this.objectName}-${sensor.name}`);
                if (supplierCell) {
                    const supplierValue = sensor.supplier || '-';
                    supplierCell.textContent = supplierValue;
                    supplierCell.title = supplierValue;
                }

                // Update chart
                this.updateChartData(sensor);
            }
        }
    }

    updateChartData(sensor) {
        const tabState = state.tabs.get(this.tabKey);
        if (!tabState?.charts) return;

        const chartOptions = this.getChartOptions();
        const varName = `${chartOptions.prefix}:${sensor.name}`;
        const chartData = tabState.charts.get(varName);

        if (chartData && chartData.chart) {
            const timestamp = Date.now();
            chartData.chart.data.datasets[0].data.push({
                x: timestamp,
                y: sensor.value
            });

            // Trim old data
            const maxPoints = 1000;
            if (chartData.chart.data.datasets[0].data.length > maxPoints) {
                chartData.chart.data.datasets[0].data.shift();
            }

            chartData.chart.update('none');
        }
    }

    // Update from API response
    update(data) {
        // Render Object Info (includes msgCount, lostMessages, isActive, etc.)
        renderObjectInfo(this.tabKey, data.object);

        // Render websockets info if present
        if (data.object?.websockets) {
            this.renderWebsocketsInfo(data.object.websockets);
        }

        // Handle LogServer (uppercase - from API)
        this.handleLogServer(data.LogServer);
    }

    renderWebsocketsInfo(websockets) {
        const tabState = state.tabs.get(this.tabKey);
        if (!tabState) return;

        const displayName = tabState.displayName || this.objectName;
        const tbody = getElementInTab(this.tabKey, `object-info-${displayName}`);
        if (!tbody) return;

        // Add websockets row after existing info
        const existingRow = tbody.querySelector('.websockets-info-row');
        if (existingRow) existingRow.remove();

        const tr = document.createElement('tr');
        tr.className = 'websockets-info-row';

        const count = websockets.count ?? 0;
        const items = websockets.items || [];

        let itemsHtml = '';
        if (items.length > 0) {
            itemsHtml = `<div class="ws-items">${items.map(item =>
                `<span class="ws-item">${escapeHtml(item.addr || item)}</span>`
            ).join('')}</div>`;
        }

        tr.innerHTML = `
            <td class="info-label">WebSocket Clients</td>
            <td class="info-value">
                <span class="ws-count ${count > 0 ? 'ws-active' : ''}">${count}</span>
                ${itemsHtml}
            </td>
        `;
        tbody.appendChild(tr);
    }

    // localStorage persistence
    saveSubscriptions() {
        const names = Array.from(this.sensors.keys());
        localStorage.setItem(this.subscriptionsKey, JSON.stringify(names));
    }

    async loadSavedSubscriptions() {
        try {
            // First, fetch current sensors with values from server
            const sensorsUrl = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/uwsgate/sensors`);
            const sensorsResponse = await fetch(sensorsUrl);
            if (sensorsResponse.ok) {
                const data = await sensorsResponse.json();
                if (data.sensors && data.sensors.length > 0) {
                    console.log(`UWebSocketGate: Loading ${data.sensors.length} sensors from server`);
                    // Add sensors with their current values
                    for (const sensor of data.sensors) {
                        if (!this.sensors.has(sensor.name)) {
                            this.sensors.set(sensor.name, {
                                id: sensor.id,
                                name: sensor.name,
                                iotype: sensor.iotype || 'AI',
                                textname: sensor.textname || '',
                                value: sensor.value || 0,
                                error: sensor.error || 0,
                                timestamp: sensor.timestamp || 0,
                                supplier: sensor.supplier || '',
                                supplier_id: sensor.supplier_id || 0
                            });
                        }
                    }
                    this.renderSensorsTable();
                    this.saveSubscriptions();
                    return;
                }
            }

            // Fallback to localStorage if server has no subscriptions
            const saved = localStorage.getItem(this.subscriptionsKey);
            if (!saved) return;

            const names = JSON.parse(saved);
            if (!Array.isArray(names) || names.length === 0) return;

            console.log(`UWebSocketGate: Loading ${names.length} subscriptions from localStorage`);
            // Restore subscriptions (will re-subscribe to server)
            for (const name of names) {
                await this.addSensorByName(name);
            }
        } catch (err) {
            console.error('Failed to load saved subscriptions:', err);
        }
    }

    destroy() {
        super.destroy();
        this.destroyLogViewer();

        // Unsubscribe from all sensors when tab closes
        if (this.sensors.size > 0) {
            const names = Array.from(this.sensors.keys());
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/uwsgate/unsubscribe`);
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sensors: names })
            }).catch(err => console.warn('Failed to unsubscribe on destroy:', err));
        }
    }
}

// Apply mixins
applyMixin(UWebSocketGateRenderer, SectionHeightMixin);

// UWebSocketGate рендерер (по extensionType)
registerRenderer('UWebSocketGate', UWebSocketGateRenderer);

