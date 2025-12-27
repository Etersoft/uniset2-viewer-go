// ============================================================================
// OPCUAExchangeRenderer - рендерер для OPCUAExchange extensionType
// ============================================================================

class OPCUAExchangeRenderer extends BaseObjectRenderer {
    static getTypeName() {
        return 'OPCUAExchange';
    }

    constructor(objectName, tabKey = null) {
        super(objectName, tabKey);
        this.status = null;
        this.params = {};
        // Параметры только для чтения (статус)
        this.readonlyParams = [
            'currentChannel',
            'connectCount',
            'activated',
            'iolistSize',
            'errorHistoryMax'
        ];
        // Параметры для записи (требуют httpEnabledSetParams=1)
        // exchangeMode первым - он самый важный и требует httpControlActive=1
        this.writableParams = [
            'exchangeMode',
            'polltime',
            'updatetime',
            'reconnectPause',
            'timeoutIterate',
            'writeToAllChannels'
        ];
        // Все параметры для загрузки
        this.paramNames = [...this.readonlyParams, ...this.writableParams];
        // Режимы обмена
        this.exchangeModes = [
            { value: 0, name: 'emNone', label: 'Normal' },
            { value: 1, name: 'emWriteOnly', label: 'Write only' },
            { value: 2, name: 'emReadOnly', label: 'Read only' },
            { value: 3, name: 'emSkipSaveToSM', label: 'Skip save to SM' },
            { value: 4, name: 'emSkipExchange', label: 'Disable exchange' }
        ];
        this.diagnostics = null;
        this.loadingNote = '';
        this.diagnosticsHeight = this.loadDiagnosticsHeight();
        this.sensorsHeight = this.loadSensorsHeight();

        // SSE подписки
        this.subscribedSensorIds = new Set();
        this.pendingUpdates = [];
        this.renderScheduled = false;

        // Virtual scroll properties
        this.allSensors = [];
        this.sensorsTotal = 0;
        this.rowHeight = 32;
        this.bufferRows = 10;
        this.startIndex = 0;
        this.endIndex = 0;

        // Infinite scroll properties
        this.chunkSize = 200;
        this.hasMore = true;
        this.isLoadingChunk = false;

        // Filter state
        this.filter = '';
        this.typeFilter = 'all';
        this.filterDebounce = null;

        // Sensor map for chart support
        this.sensorMap = new Map();
    }

    createPanelHTML() {
        return `
            ${this.createChartsSection()}
            ${this.createOPCUAControlSection()}
            ${this.createOPCUAStatusSection()}
            ${this.createOPCUAParamsSection()}
            ${this.createOPCUASensorsSection()}
            ${this.createOPCUADiagnosticsSection()}
            ${this.createLogViewerSection()}
            ${this.createLogServerSection()}
            ${this.createObjectInfoSection()}
        `;
    }

    initialize() {
        this.bindEvents();
        this.reloadAll();
        setupChartsResize(this.tabKey);
        this.setupDiagnosticsResize();
        this.setupSensorsResize();
        this.setupVirtualScroll();
        this.initStatusAutoRefresh();
    }

    destroy() {
        this.stopStatusAutoRefresh();
        this.destroyLogViewer();
        this.unsubscribeFromSSE();
    }

    async reloadAll() {
        await Promise.allSettled([
            this.loadStatus(),
            this.loadParams(),
            this.loadSensors(),
            this.loadDiagnostics()
        ]);
    }

    bindEvents() {
        const refreshParams = document.getElementById(`opcua-params-refresh-${this.objectName}`);
        if (refreshParams) {
            refreshParams.addEventListener('click', () => this.loadParams());
        }

        const saveParams = document.getElementById(`opcua-params-save-${this.objectName}`);
        if (saveParams) {
            saveParams.addEventListener('click', () => this.saveParams());
        }

        // Используем методы из FilterMixin
        this.setupFilterListeners(
            `opcua-sensors-filter-${this.objectName}`,
            `opcua-type-filter-${this.objectName}`,
            () => this.loadSensors(),
            300,
            `opcua-status-filter-${this.objectName}`
        );

        const refreshDiag = document.getElementById(`opcua-diagnostics-refresh-${this.objectName}`);
        if (refreshDiag) {
            refreshDiag.addEventListener('click', () => this.loadDiagnostics());
        }

        const takeControl = document.getElementById(`opcua-control-take-${this.objectName}`);
        if (takeControl) {
            takeControl.addEventListener('click', () => this.takeControl());
        }

        const releaseControl = document.getElementById(`opcua-control-release-${this.objectName}`);
        if (releaseControl) {
            releaseControl.addEventListener('click', () => this.releaseControl());
        }
    }

    createOPCUAStatusSection() {
        const headerExtra = `
            ${this.createStatusHeaderExtra()}
            <div class="header-channels" id="opcua-header-channels-${this.objectName}" onclick="event.stopPropagation()"></div>
        `;
        return this.createCollapsibleSection('opcua-status', 'OPC UA Status', `
            <div class="opcua-actions">
                <span class="opcua-note" id="opcua-status-note-${this.objectName}"></span>
            </div>
            <div class="opcua-stats-row" id="opcua-stats-${this.objectName}"></div>
            <div class="opcua-monitor-grid" id="opcua-monitor-${this.objectName}"></div>
        `, { sectionId: `opcua-status-section-${this.objectName}`, headerExtra });
    }

    createOPCUAControlSection() {
        const headerIndicators = `
            <div class="header-indicators" id="opcua-control-indicators-${this.objectName}" onclick="event.stopPropagation()">
                <div class="header-indicator">
                    <span class="header-indicator-label">Allowed</span>
                    <span class="header-indicator-dot" id="opcua-ind-allow-${this.objectName}"></span>
                </div>
                <div class="header-indicator">
                    <span class="header-indicator-label">Active</span>
                    <span class="header-indicator-dot" id="opcua-ind-active-${this.objectName}"></span>
                </div>
                <div class="header-indicator">
                    <span class="header-indicator-label">Parameters</span>
                    <span class="header-indicator-dot" id="opcua-ind-params-${this.objectName}"></span>
                </div>
            </div>
        `;
        return this.createCollapsibleSection('opcua-control', 'HTTP Control', `
            <div class="opcua-actions">
                <button class="btn btn-take-control" id="opcua-control-take-${this.objectName}">Take control</button>
                <button class="btn btn-release-control" id="opcua-control-release-${this.objectName}">Release</button>
                <span class="opcua-note" id="opcua-control-note-${this.objectName}"></span>
            </div>
        `, { sectionId: `opcua-control-section-${this.objectName}`, headerExtra: headerIndicators });
    }

    createOPCUAParamsSection() {
        const headerIndicator = `
            <span class="header-indicator-dot fail" id="opcua-ind-params-${this.objectName}" onclick="event.stopPropagation()" title="Parameters: loading..."></span>
        `;
        return this.createCollapsibleSection('opcua-params', 'Exchange Parameters', `
            <div class="opcua-actions">
                <button class="btn" id="opcua-params-refresh-${this.objectName}">Refresh</button>
                <button class="btn primary" id="opcua-params-save-${this.objectName}">Apply</button>
                <span class="opcua-note" id="opcua-params-note-${this.objectName}"></span>
            </div>
            <div class="opcua-params-grid">
                <div class="opcua-params-column">
                    <div class="opcua-params-subtitle">Status</div>
                    <table class="variables-table opcua-params-table compact">
                        <tbody id="opcua-params-readonly-${this.objectName}"></tbody>
                    </table>
                </div>
                <div class="opcua-params-column">
                    <div class="opcua-params-subtitle">Settings</div>
                    <table class="variables-table opcua-params-table">
                        <tbody id="opcua-params-writable-${this.objectName}"></tbody>
                    </table>
                </div>
            </div>
        `, { sectionId: `opcua-params-section-${this.objectName}`, headerExtra: headerIndicator });
    }

    createOPCUASensorsSection() {
        return this.createCollapsibleSection('opcua-sensors', 'Sensors', `
            <div class="filter-bar opcua-actions">
                <input type="text" class="filter-input" id="opcua-sensors-filter-${this.objectName}" placeholder="Filter...">
                <select class="type-filter" id="opcua-type-filter-${this.objectName}">
                    <option value="all">All types</option>
                    <option value="AI">AI</option>
                    <option value="AO">AO</option>
                    <option value="DI">DI</option>
                    <option value="DO">DO</option>
                </select>
                <select class="type-filter" id="opcua-status-filter-${this.objectName}">
                    <option value="all">All statuses</option>
                    <option value="ok">Ok</option>
                    <option value="bad">Bad</option>
                </select>
                <span class="sensor-count" id="opcua-sensor-count-${this.objectName}">0</span>
                <span class="opcua-note" id="opcua-sensors-note-${this.objectName}"></span>
            </div>
            <div class="opcua-sensors-container" id="opcua-sensors-container-${this.objectName}" style="height: ${this.sensorsHeight}px">
                <div class="opcua-sensors-viewport" id="opcua-sensors-viewport-${this.objectName}">
                    <div class="opcua-sensors-spacer" id="opcua-sensors-spacer-${this.objectName}"></div>
                    <table class="sensors-table variables-table opcua-sensors-table">
                        <thead>
                            <tr>
                                <th class="col-pin">
                                    <span class="opcua-unpin-all" id="opcua-unpin-${this.objectName}" title="Unpin all" style="display:none">✕</span>
                                </th>
                                <th class="col-add-buttons"></th>
                                <th class="col-id">ID</th>
                                <th class="col-name">Name</th>
                                <th class="col-type">Type</th>
                                <th class="col-value">Value</th>
                                <th class="col-tick">Tick</th>
                                <th class="col-vtype">VType</th>
                                <th class="col-precision">Precision</th>
                                <th class="col-status">Status</th>
                            </tr>
                        </thead>
                        <tbody id="opcua-sensors-${this.objectName}"></tbody>
                    </table>
                    <div class="opcua-loading-more" id="opcua-loading-more-${this.objectName}" style="display: none;">Loading...</div>
                </div>
                <div class="opcua-sensor-details" id="opcua-sensor-details-${this.objectName}"></div>
            </div>
            <div class="resize-handle" id="opcua-sensors-resize-${this.objectName}"></div>
        `, { sectionId: `opcua-sensors-section-${this.objectName}` });
    }

    createOPCUADiagnosticsSection() {
        return this.createCollapsibleSection('opcua-diagnostics', 'Diagnostics', `
            <div class="opcua-actions">
                <span class="opcua-note" id="opcua-diagnostics-note-${this.objectName}"></span>
            </div>
            <div class="opcua-diagnostics-container" id="opcua-diagnostics-container-${this.objectName}" style="height: ${this.diagnosticsHeight}px">
                <div class="opcua-diagnostics-scroll" id="opcua-diagnostics-${this.objectName}"></div>
            </div>
            <div class="opcua-diagnostics-resize-handle" id="opcua-diagnostics-resize-${this.objectName}"></div>
        `, { sectionId: `opcua-diagnostics-section-${this.objectName}` });
    }

    async loadStatus() {
        try {
            const data = await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/opcua/status`);
            this.status = data.status || null;
            this.renderStatus();
            this.renderControl();
            this.updateParamsAccessibility('opcua');
            this.updateStatusTimestamp();
            this.setNote(`opcua-status-note-${this.objectName}`, '');
        } catch (err) {
            this.setNote(`opcua-status-note-${this.objectName}`, err.message, true);
        }
    }

    renderStatus() {
        const statsContainer = document.getElementById(`opcua-stats-${this.objectName}`);
        const monitorContainer = document.getElementById(`opcua-monitor-${this.objectName}`);
        const headerChannels = document.getElementById(`opcua-header-channels-${this.objectName}`);

        if (!statsContainer || !monitorContainer) return;

        statsContainer.innerHTML = '';
        monitorContainer.innerHTML = '';
        if (headerChannels) headerChannels.innerHTML = '';

        if (!this.status) {
            statsContainer.innerHTML = '<span class="text-muted">No data</span>';
            return;
        }

        const status = this.status;

        // Компактная строка статистики
        const ioSize = status.iolist_size ?? status.iolistSize ?? '—';
        const errCount = status.errorHistorySize ?? 0;
        const errMax = status.errorHistoryMax ?? 100;
        const errClass = errCount >= errMax ? 'error' : (errCount > 0 ? 'warn' : '');

        // Определяем класс индикатора ошибок
        const errDotClass = errCount >= errMax ? 'fail' : (errCount > 0 ? 'warn' : 'ok');

        statsContainer.innerHTML = `
            <div class="opcua-stat-item">
                <span class="opcua-stat-label">Subscription:</span>
                <span class="opcua-stat-value">${this.formatSubscription(status)}</span>
            </div>
            <div class="opcua-stat-item">
                <span class="opcua-stat-label">I/O list:</span>
                <span class="opcua-stat-value">${ioSize}</span>
            </div>
            <div class="opcua-stat-item">
                <span class="opcua-stat-label">Errors:</span>
                <span class="opcua-stat-indicator ${errDotClass}"></span>
                <span class="opcua-stat-value">${errCount}/${errMax}</span>
            </div>
        `;

        // Парсим и отображаем Monitor как сетку параметров
        if (status.monitor) {
            const params = this.parseMonitorString(status.monitor);
            if (params.length > 0) {
                const gridHtml = params.map(p => `
                    <div class="opcua-monitor-item">
                        <span class="opcua-monitor-name">${escapeHtml(p.name)}</span>
                        <span class="opcua-monitor-value">${escapeHtml(p.value)}</span>
                    </div>
                `).join('');
                monitorContainer.innerHTML = `
                    <div class="opcua-monitor-title">Parameters</div>
                    <div class="opcua-monitor-items">${gridHtml}</div>
                `;
            }
        }

        // Каналы в шапке
        if (headerChannels && Array.isArray(status.channels) && status.channels.length > 0) {
            const channelsHtml = status.channels.map(ch => {
                const ok = ch.ok || ch.status === 'OK';
                const addr = ch.addr || ch.address || '';
                const disabled = ch.disabled ? ' (disabled)' : '';
                const channelNum = (ch.index ?? 0) + 1;
                return `
                    <div class="header-channel ${ok ? 'ok' : 'fail'}" title="${addr}${disabled}">
                        <span class="header-channel-name">Channel ${channelNum}</span>
                        <span class="header-channel-dot"></span>
                    </div>
                `;
            }).join('');
            headerChannels.innerHTML = channelsHtml;
        }
    }

    parseMonitorString(monitorStr) {
        // Парсим строку формата "name = value name2 = value2 ..."
        const params = [];
        if (!monitorStr) return params;

        // Разбиваем по пробелам, но учитываем что значения могут быть пустыми
        const regex = /(\w+)\s*=\s*(\S*)/g;
        let match;
        while ((match = regex.exec(monitorStr)) !== null) {
            params.push({ name: match[1], value: match[2] || '—' });
        }
        return params;
    }

    renderControl() {
        const allow = this.status?.httpControlAllow;
        const active = this.status?.httpControlActive;
        const enabledParams = this.status?.httpEnabledSetParams;
        const allowText = allow ? 'Take control' : 'Control not allowed';

        // Обновляем индикаторы в шапке
        const indAllow = document.getElementById(`opcua-ind-allow-${this.objectName}`);
        const indActive = document.getElementById(`opcua-ind-active-${this.objectName}`);
        const indParams = document.getElementById(`opcua-ind-params-${this.objectName}`);

        if (indAllow) {
            indAllow.className = `header-indicator-dot ${allow ? 'ok' : 'fail'}`;
            indAllow.title = allow ? 'Allowed: Yes' : 'Allowed: No';
        }
        if (indActive) {
            indActive.className = `header-indicator-dot ${active ? 'ok' : 'fail'}`;
            indActive.title = active ? 'Active: Yes' : 'Active: No';
        }
        if (indParams) {
            indParams.className = `header-indicator-dot ${enabledParams ? 'ok' : 'fail'}`;
            indParams.title = enabledParams ? 'Parameters: Yes' : 'Parameters: No';
        }

        // Обновляем кнопки
        const takeBtn = document.getElementById(`opcua-control-take-${this.objectName}`);
        const releaseBtn = document.getElementById(`opcua-control-release-${this.objectName}`);
        if (takeBtn) {
            takeBtn.disabled = !allow;
            takeBtn.title = allowText;
        }
        if (releaseBtn) {
            releaseBtn.disabled = !allow;
            releaseBtn.title = allowText;
        }
    }

    formatSubscription(status) {
        if (status.subscription) {
            const sub = status.subscription;
            const enabled = sub.enabled ? 'On' : 'Off';
            const items = sub.items !== undefined ? ` · items: ${sub.items}` : '';
            return `${enabled}${items}`;
        }
        if (Array.isArray(status.read_attributes) || Array.isArray(status.write_attributes)) {
            const read = (status.read_attributes || []).map(r => r.total).reduce((a, b) => a + (b || 0), 0);
            const write = (status.write_attributes || []).map(r => r.total).reduce((a, b) => a + (b || 0), 0);
            return `Read: ${read || 0}, Write: ${write || 0}`;
        }
        return '—';
    }

    async loadParams() {
        try {
            const query = this.paramNames.map(n => `name=${encodeURIComponent(n)}`).join('&');
            const data = await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/opcua/params?${query}`);
            this.params = data.params || {};
            this.renderParams();
            // Обновить состояние доступности (показать предупреждение если нужно)
            this.updateParamsAccessibility('opcua');
        } catch (err) {
            this.setNote(`opcua-params-note-${this.objectName}`, err.message, true);
        }
    }

    renderParams() {
        const readonlyTbody = document.getElementById(`opcua-params-readonly-${this.objectName}`);
        const writableTbody = document.getElementById(`opcua-params-writable-${this.objectName}`);
        if (!readonlyTbody || !writableTbody) return;

        readonlyTbody.innerHTML = '';
        writableTbody.innerHTML = '';

        if (!this.params || Object.keys(this.params).length === 0) {
            readonlyTbody.innerHTML = '<tr><td colspan="2" class="text-muted">No data</td></tr>';
            writableTbody.innerHTML = '<tr><td colspan="2" class="text-muted">No data</td></tr>';
            return;
        }

        // Человекочитаемые названия параметров
        const paramLabels = {
            currentChannel: 'Active channel',
            connectCount: 'Connections',
            activated: 'Activated',
            iolistSize: 'I/O size',
            errorHistoryMax: 'Max errors',
            polltime: 'Poll interval (ms)',
            updatetime: 'Update interval (ms)',
            reconnectPause: 'Reconnect pause (ms)',
            timeoutIterate: 'Iteration timeout (ms)',
            writeToAllChannels: 'Write to all channels',
            exchangeMode: 'Exchange mode'
        };

        // Readonly параметры (только отображение)
        this.readonlyParams.forEach(name => {
            const current = this.params[name];
            const tr = document.createElement('tr');
            let displayValue = current !== undefined ? formatValue(current) : '—';
            // Форматируем activated как Да/Нет
            if (name === 'activated') {
                displayValue = current ? 'Yes' : 'No';
            }
            tr.innerHTML = `
                <td class="variable-name">${paramLabels[name] || name}</td>
                <td class="variable-value">${displayValue}</td>
            `;
            readonlyTbody.appendChild(tr);
        });

        // Writable параметры (с полями ввода)
        const httpControlActive = this.status?.httpControlActive === 1 || this.status?.httpControlActive === true;

        this.writableParams.forEach((name, index) => {
            const current = this.params[name];
            const tr = document.createElement('tr');
            let inputHtml;

            if (name === 'exchangeMode') {
                // Выпадающий список для режима обмена
                const options = this.exchangeModes.map(m => {
                    const selected = current === m.value ? 'selected' : '';
                    return `<option value="${m.value}" ${selected}>${m.label}</option>`;
                }).join('');
                const disabled = httpControlActive ? '' : 'disabled title="HTTP control required"';
                inputHtml = `<select class="opcua-param-input param-field" data-name="${name}" ${disabled}>${options}</select>`;
                tr.className = 'param-row-primary';
            } else if (name === 'writeToAllChannels') {
                // Чекбокс для булевого параметра
                const checked = current ? 'checked' : '';
                inputHtml = `<input type="checkbox" class="opcua-param-checkbox" data-name="${name}" ${checked}>`;
            } else {
                // Обычное поле ввода
                inputHtml = `<input class="opcua-param-input param-field" data-name="${name}" value="${current !== undefined ? current : ''}">`;
            }

            tr.innerHTML = `
                <td class="variable-name">${paramLabels[name] || name}</td>
                <td>${inputHtml}</td>
            `;
            writableTbody.appendChild(tr);

            // Разделитель после exchangeMode
            if (name === 'exchangeMode') {
                const separator = document.createElement('tr');
                separator.className = 'param-separator';
                separator.innerHTML = '<td colspan="2"></td>';
                writableTbody.appendChild(separator);
            }
        });
    }

    async saveParams() {
        const writableTbody = document.getElementById(`opcua-params-writable-${this.objectName}`);
        if (!writableTbody) return;

        const inputs = writableTbody.querySelectorAll('.opcua-param-input');
        const checkboxes = writableTbody.querySelectorAll('.opcua-param-checkbox');
        const changed = {};

        inputs.forEach(input => {
            const name = input.dataset.name;
            const current = this.params[name];
            const newValue = input.value;
            if (newValue === '' || newValue === null) return;
            if (String(current) !== newValue) {
                changed[name] = newValue;
            }
        });

        checkboxes.forEach(checkbox => {
            const name = checkbox.dataset.name;
            const current = this.params[name];
            const newValue = checkbox.checked ? 1 : 0;
            if (current !== newValue) {
                changed[name] = newValue;
            }
        });

        if (Object.keys(changed).length === 0) {
            this.setNote(`opcua-params-note-${this.objectName}`, 'No changes');
            return;
        }

        try {
            const data = await this.fetchJSON(
                `/api/objects/${encodeURIComponent(this.objectName)}/opcua/params`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ params: changed })
                }
            );
            this.params = { ...this.params, ...(data.updated || {}) };
            this.renderParams();
            this.setNote(`opcua-params-note-${this.objectName}`, 'Parameters applied');
            this.loadStatus();
        } catch (err) {
            this.setNote(`opcua-params-note-${this.objectName}`, err.message, true);
        }
    }

    async loadSensors() {
        // Reset state for fresh load
        this.allSensors = [];
        this.hasMore = true;
        this.startIndex = 0;
        this.endIndex = 0;

        // Reset viewport scroll position
        const viewport = document.getElementById(`opcua-sensors-viewport-${this.objectName}`);
        if (viewport) viewport.scrollTop = 0;

        // Проверяем режим фильтрации: false = серверная (default), true = UI
        const useUIFilter = state.config.opcuaUISensorsFilter;

        try {
            let url = `/api/objects/${encodeURIComponent(this.objectName)}/opcua/sensors?limit=${this.chunkSize}&offset=0`;

            // Серверная фильтрация (если не включена UI фильтрация)
            if (!useUIFilter) {
                if (this.filter) {
                    url += `&search=${encodeURIComponent(this.filter)}`;
                }
                if (this.typeFilter && this.typeFilter !== 'all') {
                    url += `&iotype=${this.typeFilter}`;
                }
            }

            const data = await this.fetchJSON(url);
            let sensors = data.sensors || [];
            this.sensorsTotal = typeof data.total === 'number' ? data.total : sensors.length;

            // UI фильтрация (если включена)
            if (useUIFilter) {
                sensors = this.applyLocalFilters(sensors);
            } else if (this.statusFilter && this.statusFilter !== 'all') {
                // Status filter применяем локально (сервер не поддерживает)
                sensors = sensors.filter(s =>
                    (s.status || '').toLowerCase() === this.statusFilter.toLowerCase()
                );
            }

            this.allSensors = sensors;
            this.sensorMap.clear();
            sensors.forEach(s => this.sensorMap.set(s.id, s));

            // Если нет фильтра и есть закреплённые датчики - загрузить их отдельно
            if (!this.filter) {
                await this.loadPinnedSensors();
            }

            this.hasMore = (data.sensors?.length || 0) === this.chunkSize;
            this.updateVisibleRows();
            this.updateSensorCount();
            this.setNote(`opcua-sensors-note-${this.objectName}`, '');

            // Подписываемся на SSE обновления после загрузки
            this.subscribeToSSE();
        } catch (err) {
            this.setNote(`opcua-sensors-note-${this.objectName}`, err.message, true);
        }
    }

    // Загружает закреплённые датчики, если они не в текущем списке
    async loadPinnedSensors() {
        const pinnedIds = this.getPinnedSensors();
        if (pinnedIds.size === 0) return;

        // Найти ID, которых нет в загруженных датчиках
        const missingIds = [];
        for (const idStr of pinnedIds) {
            const id = parseInt(idStr);
            if (!this.sensorMap.has(id)) {
                missingIds.push(id);
            }
        }

        if (missingIds.length === 0) return;

        // Загрузить отсутствующие датчики по ID
        try {
            const idsParam = missingIds.join(',');
            const url = `/api/objects/${encodeURIComponent(this.objectName)}/opcua/get?filter=${idsParam}`;
            const response = await this.fetchJSON(url);
            const pinnedSensors = response.sensors || [];

            // Добавить закреплённые датчики в начало списка
            for (const sensor of pinnedSensors) {
                if (!this.sensorMap.has(sensor.id)) {
                    this.allSensors.unshift(sensor);
                    this.sensorMap.set(sensor.id, sensor);
                }
            }
        } catch (err) {
            console.warn('Failed to load pinned sensors:', err);
        }
    }

    applyLocalFilters(sensors) {
        let result = sensors;
        if (this.filter) {
            const filterLower = this.filter.toLowerCase();
            result = result.filter(s =>
                s.name?.toLowerCase().includes(filterLower) ||
                String(s.id).includes(filterLower)
            );
        }
        if (this.typeFilter && this.typeFilter !== 'all') {
            result = result.filter(s => s.iotype === this.typeFilter);
        }
        if (this.statusFilter && this.statusFilter !== 'all') {
            result = result.filter(s =>
                (s.status || '').toLowerCase() === this.statusFilter.toLowerCase()
            );
        }
        return result;
    }

    async loadMoreSensors() {
        if (this.isLoadingChunk || !this.hasMore) return;

        this.isLoadingChunk = true;
        this.showLoadingIndicator(true);

        // Проверяем режим фильтрации: false = серверная (default), true = UI
        const useUIFilter = state.config.opcuaUISensorsFilter;

        try {
            const nextOffset = this.allSensors.length;
            let url = `/api/objects/${encodeURIComponent(this.objectName)}/opcua/sensors?limit=${this.chunkSize}&offset=${nextOffset}`;

            // Серверная фильтрация (если не включена UI фильтрация)
            if (!useUIFilter) {
                if (this.filter) {
                    url += `&search=${encodeURIComponent(this.filter)}`;
                }
                if (this.typeFilter && this.typeFilter !== 'all') {
                    url += `&iotype=${this.typeFilter}`;
                }
            }

            const data = await this.fetchJSON(url);
            let newSensors = data.sensors || [];

            // UI фильтрация (если включена)
            if (useUIFilter) {
                newSensors = this.applyLocalFilters(newSensors);
            } else if (this.statusFilter && this.statusFilter !== 'all') {
                // Status filter применяем локально (сервер не поддерживает)
                newSensors = newSensors.filter(s =>
                    (s.status || '').toLowerCase() === this.statusFilter.toLowerCase()
                );
            }

            // Дедупликация: добавляем только датчики которых еще нет
            const existingIds = new Set(this.allSensors.map(s => s.id));
            const uniqueNewSensors = newSensors.filter(s => !existingIds.has(s.id));

            this.allSensors = [...this.allSensors, ...uniqueNewSensors];
            this.hasMore = (data.sensors?.length || 0) === this.chunkSize;
            this.updateVisibleRows();
            this.updateSensorCount();
        } catch (err) {
            console.error('Failed to load more sensors:', err);
        } finally {
            this.isLoadingChunk = false;
            this.showLoadingIndicator(false);
        }
    }

    setupVirtualScroll() {
        const viewport = document.getElementById(`opcua-sensors-viewport-${this.objectName}`);
        if (!viewport) return;

        let ticking = false;
        viewport.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    this.updateVisibleRows();
                    this.checkInfiniteScroll(viewport);
                    ticking = false;
                });
                ticking = true;
            }
        });
    }

    updateVisibleRows() {
        const viewport = document.getElementById(`opcua-sensors-viewport-${this.objectName}`);
        if (!viewport) return;

        const scrollTop = viewport.scrollTop;
        const viewportHeight = viewport.clientHeight;
        const totalRows = this.allSensors.length;
        const visibleRows = Math.ceil(viewportHeight / this.rowHeight);

        this.startIndex = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.bufferRows);
        this.endIndex = Math.min(totalRows, this.startIndex + visibleRows + 2 * this.bufferRows);

        this.renderVisibleSensors();
    }

    renderVisibleSensors() {
        const tbody = document.getElementById(`opcua-sensors-${this.objectName}`);
        const spacer = document.getElementById(`opcua-sensors-spacer-${this.objectName}`);
        if (!tbody || !spacer) return;

        // Получаем закрепленные датчики
        const pinnedSensors = this.getPinnedSensors();
        const hasPinned = pinnedSensors.size > 0;

        // Показываем/скрываем кнопку "снять все"
        const unpinBtn = document.getElementById(`opcua-unpin-${this.objectName}`);
        if (unpinBtn) {
            unpinBtn.style.display = hasPinned ? 'inline' : 'none';
        }

        // Фильтруем датчики: если есть закрепленные — показываем только их (если нет фильтра)
        let sensorsToShow = this.allSensors;
        if (hasPinned && !this.filter) {
            sensorsToShow = this.allSensors.filter(s => pinnedSensors.has(String(s.id)));
        }

        // Set spacer height to position visible rows correctly
        const spacerHeight = this.startIndex * this.rowHeight;
        spacer.style.height = `${spacerHeight}px`;

        // Show empty state if no sensors
        if (sensorsToShow.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="opcua-no-sensors">No sensors</td></tr>';
            return;
        }

        // Get visible slice
        const visibleSensors = sensorsToShow.slice(this.startIndex, this.endIndex);

        // Update sensorMap for chart support
        visibleSensors.forEach(sensor => {
            if (sensor.id) {
                this.sensorMap.set(sensor.id, sensor);
            }
        });

        // Render visible rows with type badges and chart toggle
        tbody.innerHTML = visibleSensors.map(sensor => {
            const isPinned = pinnedSensors.has(String(sensor.id));
            const pinToggleClass = isPinned ? 'pin-toggle pinned' : 'pin-toggle';
            const pinIcon = isPinned ? '📌' : '○';
            const pinTitle = isPinned ? 'Unpin' : 'Pin';

            const iotype = sensor.iotype || sensor.type || '';
            const typeBadgeClass = iotype ? `type-badge type-${iotype}` : '';
            return `
            <tr data-sensor-id="${sensor.id || ''}">
                <td class="col-pin">
                    <span class="${pinToggleClass}" data-id="${sensor.id}" title="${pinTitle}">
                        ${pinIcon}
                    </span>
                </td>
                ${this.renderAddButtonsCell(sensor.id, sensor.name, 'opcua', sensor.textname || sensor.name)}
                <td class="col-id">${sensor.id ?? '—'}</td>
                <td class="col-name" title="${escapeHtml(sensor.textname || sensor.comment || '')}">${escapeHtml(sensor.name || '')}</td>
                <td class="col-type"><span class="${typeBadgeClass}">${iotype || '—'}</span></td>
                <td class="col-value">${sensor.value ?? '—'}</td>
                <td class="col-tick">${sensor.tick ?? '—'}</td>
                <td class="col-vtype">${sensor.vtype || '—'}</td>
                <td class="col-precision">${sensor.precision ?? '—'}</td>
                <td class="col-status ${sensor.status && sensor.status.toLowerCase() !== 'ok' ? 'status-bad' : ''}">${sensor.status || '—'}</td>
            </tr>
        `}).join('');

        // Bind chart toggle events
        this.attachChartToggleListeners(tbody, this.sensorMap);

        // Bind dashboard toggle events
        this.attachDashboardToggleListeners(tbody);

        // Bind pin toggle events
        tbody.querySelectorAll('.pin-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => this.toggleSensorPin(parseInt(toggle.dataset.id)));
        });

        // Обработчик кнопки "снять все"
        if (unpinBtn) {
            unpinBtn.onclick = () => this.unpinAllSensors();
        }

        // Bind row click events (prevent on chart checkbox)
        tbody.querySelectorAll('tr[data-sensor-id]').forEach(row => {
            row.addEventListener('click', (e) => {
                // Don't trigger row click when clicking on chart checkbox
                if (e.target.closest('.chart-toggle')) return;
                const id = row.dataset.sensorId;
                if (id) this.loadSensorDetails(parseInt(id, 10));
            });
        });
    }

    // Override to use OPC UA SSE subscription
    subscribeToChartSensor(sensorId) {
        // OPCUAExchange sensors are already subscribed through main SSE
        // Just ensure the sensor is in our subscription list
        if (!this.subscribedSensorIds.has(sensorId)) {
            this.subscribedSensorIds.add(sensorId);
        }
    }

    checkInfiniteScroll(viewport) {
        if (this.isLoadingChunk || !this.hasMore) return;

        const scrollBottom = viewport.scrollTop + viewport.clientHeight;
        const totalHeight = this.allSensors.length * this.rowHeight;
        const threshold = 200; // Load more when 200px from bottom

        if (totalHeight - scrollBottom < threshold) {
            this.loadMoreSensors();
        }
    }

    updateSensorCount() {
        this.updateItemCount(`opcua-sensor-count-${this.objectName}`, this.allSensors.length, this.sensorsTotal);
    }

    showLoadingIndicator(show) {
        const el = document.getElementById(`opcua-loading-more-${this.objectName}`);
        if (el) {
            el.style.display = show ? 'block' : 'none';
        }
    }

    async loadSensorDetails(id) {
        try {
            const data = await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/opcua/sensors/${id}`);
            this.renderSensorDetails(data.sensor);
        } catch (err) {
            this.setNote(`opcua-sensors-note-${this.objectName}`, err.message, true);
        }
    }

    renderSensorDetails(sensor) {
        const container = document.getElementById(`opcua-sensor-details-${this.objectName}`);
        if (!container) return;

        if (!sensor) {
            container.innerHTML = '<div class="text-muted">Sensor not found</div>';
            return;
        }

        const channels = Array.isArray(sensor.channels) ? sensor.channels.map(ch => {
            const disabled = ch.disabled ? 'disabled' : '';
            const status = ch.status || ch.statusCode || '';
            return `<div class="opcua-sensor-channel">${ch.index !== undefined ? `#${ch.index}` : ''} ${status} ${disabled ? '(disabled)' : ''}</div>`;
        }).join('') : '';

        container.innerHTML = `
            <div class="opcua-sensor-card">
                <div class="opcua-sensor-title">${escapeHtml(sensor.name || '')} (${sensor.id})</div>
                <div class="opcua-sensor-grid">
                    <div><span class="opcua-sensor-label">NodeId:</span> ${escapeHtml(sensor.nodeid || '—')}</div>
                    <div><span class="opcua-sensor-label">Type:</span> ${sensor.iotype || sensor.type || '—'}</div>
                    <div><span class="opcua-sensor-label">Value:</span> ${sensor.value ?? '—'}</div>
                    <div><span class="opcua-sensor-label">Tick:</span> ${sensor.tick ?? '—'}</div>
                    <div><span class="opcua-sensor-label">VType:</span> ${sensor.vtype || '—'}</div>
                    <div><span class="opcua-sensor-label">Precision:</span> ${sensor.precision ?? '—'}</div>
                    <div><span class="opcua-sensor-label">Status:</span> ${sensor.status || '—'}</div>
                </div>
                ${channels ? `<div class="opcua-sensor-channels">${channels}</div>` : ''}
            </div>
        `;
    }

    async loadDiagnostics() {
        try {
            const data = await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/opcua/diagnostics`);
            this.diagnostics = data;
            this.renderDiagnostics();
            this.setNote(`opcua-diagnostics-note-${this.objectName}`, '');
        } catch (err) {
            this.setNote(`opcua-diagnostics-note-${this.objectName}`, err.message, true);
        }
    }

    renderDiagnostics() {
        const container = document.getElementById(`opcua-diagnostics-${this.objectName}`);
        if (!container) return;

        if (!this.diagnostics) {
            container.innerHTML = '<div class="text-muted">No data</div>';
            return;
        }

        const summary = this.diagnostics.summary || {};
        const errors = this.diagnostics.lastErrors || [];

        let html = '<div class="opcua-diagnostics-summary">';
        Object.entries(summary).forEach(([key, value]) => {
            html += `<div class="opcua-diagnostics-item"><span>${key}</span><strong>${value}</strong></div>`;
        });
        html += '</div>';

        if (errors.length > 0) {
            html += '<table class="variables-table opcua-errors-table"><thead><tr><th>Time</th><th>Last</th><th>Count</th><th>Channel</th><th>Operation</th><th>StatusCode</th><th>NodeId</th></tr></thead><tbody>';
            errors.forEach(err => {
                html += `<tr>
                    <td>${err.time || ''}</td>
                    <td>${err.lastSeen || ''}</td>
                    <td>${err.count ?? ''}</td>
                    <td>${err.channel ?? ''}</td>
                    <td>${err.operation || ''}</td>
                    <td>${err.statusCode || ''}</td>
                    <td>${escapeHtml(err.nodeid || '')}</td>
                </tr>`;
            });
            html += '</tbody></table>';
        } else {
            html += '<div class="text-muted">No errors</div>';
        }

        container.innerHTML = html;
    }

    loadDiagnosticsHeight() {
        return this.loadSectionHeight('uniset-panel-opcua-diagnostics', 260);
    }

    saveDiagnosticsHeight(value) {
        this.diagnosticsHeight = value;
        this.saveSectionHeight('uniset-panel-opcua-diagnostics', value);
    }

    setupDiagnosticsResize() {
        this.setupSectionResize(
            `opcua-diagnostics-resize-${this.objectName}`,
            `opcua-diagnostics-container-${this.objectName}`,
            'uniset-panel-opcua-diagnostics',
            'diagnosticsHeight',
            { minHeight: 160, maxHeight: 600 }
        );
    }

    loadSensorsHeight() {
        return this.loadSectionHeight('uniset-panel-opcua-sensors', 320);
    }

    saveSensorsHeight(value) {
        this.sensorsHeight = value;
        this.saveSectionHeight('uniset-panel-opcua-sensors', value);
    }

    setupSensorsResize() {
        this.setupSectionResize(
            `opcua-sensors-resize-${this.objectName}`,
            `opcua-sensors-container-${this.objectName}`,
            'uniset-panel-opcua-sensors',
            'sensorsHeight',
            { minHeight: 200, maxHeight: 700 }
        );
    }

    async takeControl() {
        if (this.status && this.status.httpControlAllow === false) {
            this.setNote(`opcua-control-note-${this.objectName}`, 'Control not allowed', true);
            return;
        }

        try {
            await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/opcua/control/take`, { method: 'POST' });
            this.setNote(`opcua-control-note-${this.objectName}`, 'HTTP control activated');
            this.loadStatus();
        } catch (err) {
            this.setNote(`opcua-control-note-${this.objectName}`, err.message, true);
        }
    }

    async releaseControl() {
        if (this.status && this.status.httpControlAllow === false) {
            this.setNote(`opcua-control-note-${this.objectName}`, 'Control not allowed', true);
            return;
        }

        try {
            await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/opcua/control/release`, { method: 'POST' });
            this.setNote(`opcua-control-note-${this.objectName}`, 'Control returned to sensor');
            this.loadStatus();
        } catch (err) {
            this.setNote(`opcua-control-note-${this.objectName}`, err.message, true);
        }
    }

    // === SSE подписка на обновления датчиков (использует SSESubscriptionMixin) ===

    async subscribeToSSE() {
        const sensorIds = this.allSensors.map(s => s.id);
        await this.subscribeToSSEFor('/opcua', sensorIds, 'sensor_ids', 'OPCUA SSE');
    }

    async unsubscribeFromSSE() {
        await this.unsubscribeFromSSEFor('/opcua', 'sensor_ids', 'OPCUA SSE');
    }

    handleOPCUASensorUpdates(sensors) {
        if (!Array.isArray(sensors) || sensors.length === 0) return;

        // Добавляем в очередь на обновление
        this.pendingUpdates.push(...sensors);

        // Планируем батчевый рендеринг
        if (!this.renderScheduled) {
            this.renderScheduled = true;
            requestAnimationFrame(() => this.batchRenderUpdates());
        }
    }

    batchRenderUpdates() {
        this.renderScheduled = false;

        if (this.pendingUpdates.length === 0) return;

        const updates = this.pendingUpdates;
        this.pendingUpdates = [];

        // Создаём map для быстрого поиска
        const updateMap = new Map();
        updates.forEach(sensor => {
            updateMap.set(sensor.id, sensor);
        });

        // Обновляем данные в allSensors
        let hasChanges = false;
        this.allSensors.forEach((sensor, index) => {
            const update = updateMap.get(sensor.id);
            if (update && update.value !== sensor.value) {
                this.allSensors[index] = { ...sensor, value: update.value, tick: update.tick };
                hasChanges = true;
            }
        });

        if (!hasChanges) return;

        // Обновляем видимые строки в DOM
        const tbody = document.getElementById(`opcua-sensors-${this.objectName}`);
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
            const sensorId = parseInt(row.dataset.sensorId);
            if (!sensorId) return;

            const update = updateMap.get(sensorId);
            if (update && update.value !== undefined) {
                // Value ячейка (class-based selector)
                const valueCell = row.querySelector('.col-value');
                if (valueCell) {
                    const oldValue = valueCell.textContent;
                    const newValue = String(update.value);
                    if (oldValue !== newValue) {
                        valueCell.textContent = newValue;
                        // CSS анимация изменения
                        valueCell.classList.remove('value-changed');
                        void valueCell.offsetWidth; // force reflow
                        valueCell.classList.add('value-changed');
                    }
                }
                // Tick ячейка (class-based selector)
                const tickCell = row.querySelector('.col-tick');
                if (tickCell && update.tick !== undefined) {
                    tickCell.textContent = String(update.tick);
                }
            }
        });
    }

    update(data) {
        renderObjectInfo(this.tabKey, data.object);
        updateChartLegends(this.tabKey, data);
        this.handleLogServer(data.LogServer);
    }

    // Pin management для датчиков
    getPinnedSensors() {
        return this.getPinnedItems('uniset-panel-opcua-pinned');
    }

    savePinnedSensors(pinnedSet) {
        this.savePinnedItems('uniset-panel-opcua-pinned', pinnedSet);
    }

    toggleSensorPin(sensorId) {
        this.toggleItemPin('uniset-panel-opcua-pinned', sensorId, this.renderVisibleSensors);
    }

    unpinAllSensors() {
        this.unpinAllItems('uniset-panel-opcua-pinned', this.renderVisibleSensors);
    }
}

// Apply mixins to OPCUAExchangeRenderer
applyMixin(OPCUAExchangeRenderer, VirtualScrollMixin);
applyMixin(OPCUAExchangeRenderer, SSESubscriptionMixin);
applyMixin(OPCUAExchangeRenderer, ResizableSectionMixin);
applyMixin(OPCUAExchangeRenderer, FilterMixin);
applyMixin(OPCUAExchangeRenderer, ParamsAccessibilityMixin);
applyMixin(OPCUAExchangeRenderer, ItemCounterMixin);
applyMixin(OPCUAExchangeRenderer, SectionHeightMixin);
applyMixin(OPCUAExchangeRenderer, PinManagementMixin);

