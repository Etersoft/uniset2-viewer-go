// ============================================================================
// ModbusMasterRenderer - рендерер для ModbusMaster объектов
// ============================================================================

class ModbusMasterRenderer extends BaseObjectRenderer {
    static getTypeName() {
        return 'ModbusMaster';
    }

    constructor(objectName, tabKey = null) {
        super(objectName, tabKey);
        this.status = null;
        this.params = {};
        this.paramNames = [
            'force',
            'force_out',
            'recv_timeout',
            'sleepPause_msec',
            'polltime',
            'default_timeout',
            'maxHeartBeat'
        ];
        this.devices = [];
        this.registersHeight = this.loadRegistersHeight();

        // SSE подписки (используется subscribedSensorIds из миксина)
        this.subscribedSensorIds = new Set();
        this.pendingUpdates = [];
        this.renderScheduled = false;

        // Virtual scroll properties
        this.allRegisters = [];
        this.devicesDict = {};
        this.registersTotal = 0;
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

        // Register map for chart support
        this.registerMap = new Map();
    }

    createPanelHTML() {
        return `
            ${this.createChartsSection()}
            ${this.createMBStatusSection()}
            ${this.createMBParamsSection()}
            ${this.createMBDevicesSection()}
            ${this.createMBRegistersSection()}
            ${this.createLogViewerSection()}
            ${this.createLogServerSection()}
            ${this.createObjectInfoSection()}
        `;
    }

    initialize() {
        this.bindEvents();
        this.reloadAll();
        setupChartsResize(this.tabKey);
        this.setupRegistersResize();
        this.setupVirtualScroll();
        this.initStatusAutoRefresh();
    }

    destroy() {
        this.stopStatusAutoRefresh();
        this.destroyLogViewer();
        this.unsubscribeFromSSE();
    }

    // ModbusMaster регистры - показываем badge "MB"
    getChartOptions() {
        return { badge: 'MB', prefix: 'mb' };
    }

    async reloadAll() {
        await Promise.allSettled([
            this.loadStatus(),
            this.loadParams(),
            this.loadDevices(),
            this.loadRegisters()
        ]);
    }

    bindEvents() {
        const refreshParams = document.getElementById(`mb-params-refresh-${this.objectName}`);
        if (refreshParams) {
            refreshParams.addEventListener('click', () => this.loadParams());
        }

        const saveParams = document.getElementById(`mb-params-save-${this.objectName}`);
        if (saveParams) {
            saveParams.addEventListener('click', () => this.saveParams());
        }

        // Используем методы из FilterMixin
        this.setupMBFilterListeners(
            `mb-registers-filter-${this.objectName}`,
            `mb-type-filter-${this.objectName}`
        );
    }

    // Настройка фильтров для Modbus
    setupMBFilterListeners(filterInputId, typeFilterId) {
        const filterInput = document.getElementById(filterInputId);
        const typeFilter = document.getElementById(typeFilterId);

        if (filterInput) {
            filterInput.addEventListener('input', (e) => {
                clearTimeout(this.filterDebounce);
                this.filterDebounce = setTimeout(() => {
                    this.filter = e.target.value.trim();
                    this.renderRegisters(); // Локальная фильтрация по mbreg и имени
                }, 300);
            });

            filterInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    if (filterInput.value) {
                        filterInput.value = '';
                        this.filter = '';
                        this.renderRegisters();
                    }
                    filterInput.blur();
                    e.preventDefault();
                }
            });
        }

        if (typeFilter) {
            typeFilter.addEventListener('change', (e) => {
                this.typeFilter = e.target.value;
                this.loadRegisters(); // Тип фильтруется на сервере
            });
        }
    }

    createMBStatusSection() {
        return this.createCollapsibleSection('mb-status', 'Modbus Status', `
            <div class="mb-actions">
                <span class="mb-note" id="mb-status-note-${this.objectName}"></span>
            </div>
            <table class="info-table">
                <tbody id="mb-status-${this.objectName}"></tbody>
            </table>
        `, { sectionId: `mb-status-section-${this.objectName}`, headerExtra: this.createStatusHeaderExtra() });
    }

    createMBParamsSection() {
        return this.createCollapsibleSection('mb-params', 'Exchange Parameters', `
            <div class="mb-actions">
                <button class="btn" id="mb-params-refresh-${this.objectName}">Перезагрузить</button>
                <button class="btn primary" id="mb-params-save-${this.objectName}">Apply</button>
                <span class="mb-note" id="mb-params-note-${this.objectName}"></span>
            </div>
            <div class="mb-params-table-wrapper">
                <table class="variables-table mb-params-table">
                    <thead>
                        <tr>
                            <th>Parameter</th>
                            <th>Current</th>
                            <th>New value</th>
                        </tr>
                    </thead>
                    <tbody id="mb-params-${this.objectName}"></tbody>
                </table>
            </div>
        `, { sectionId: `mb-params-section-${this.objectName}` });
    }

    createMBDevicesSection() {
        return this.createCollapsibleSection('mb-devices', 'Devices (Slaves)', `
            <div class="mb-actions">
                <span class="mb-device-count" id="mb-device-count-${this.objectName}">0</span>
                <span class="mb-note" id="mb-devices-note-${this.objectName}"></span>
            </div>
            <div class="mb-devices-container" id="mb-devices-${this.objectName}"></div>
        `, { sectionId: `mb-devices-section-${this.objectName}` });
    }

    createMBRegistersSection() {
        return this.createCollapsibleSection('mb-registers', 'Registers', `
            <div class="filter-bar mb-actions">
                <input type="text" class="filter-input" id="mb-registers-filter-${this.objectName}" placeholder="Filter...">
                <select class="type-filter" id="mb-type-filter-${this.objectName}">
                    <option value="all">All types</option>
                    <option value="AI">AI</option>
                    <option value="AO">AO</option>
                    <option value="DI">DI</option>
                    <option value="DO">DO</option>
                </select>
                <span class="sensor-count" id="mb-register-count-${this.objectName}">0</span>
                <span class="mb-note" id="mb-registers-note-${this.objectName}"></span>
            </div>
            <div class="mb-registers-container" id="mb-registers-container-${this.objectName}" style="height: ${this.registersHeight}px">
                <div class="mb-registers-viewport" id="mb-registers-viewport-${this.objectName}">
                    <div class="mb-registers-spacer" id="mb-registers-spacer-${this.objectName}"></div>
                    <table class="sensors-table variables-table mb-registers-table">
                        <thead>
                            <tr>
                                <th class="col-pin">
                                    <span class="mb-unpin-all" id="mb-unpin-${this.objectName}" title="Unpin all" style="display:none">✕</span>
                                </th>
                                <th class="col-add-buttons"></th>
                                <th class="col-id">ID</th>
                                <th class="col-name">Name</th>
                                <th class="col-type">Type</th>
                                <th class="col-value">Value</th>
                                <th class="col-device">Устройство</th>
                                <th class="col-register">Регистр</th>
                                <th class="col-func">Функция</th>
                                <th class="col-mbval">MB Val</th>
                            </tr>
                        </thead>
                        <tbody id="mb-registers-tbody-${this.objectName}"></tbody>
                    </table>
                    <div class="mb-loading-more" id="mb-loading-more-${this.objectName}" style="display: none;">Loading...</div>
                </div>
            </div>
            <div class="resize-handle" id="mb-registers-resize-${this.objectName}"></div>
        `, { sectionId: `mb-registers-section-${this.objectName}` });
    }

    async loadStatus() {
        try {
            const data = await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/modbus/status`);
            this.status = data.status || null;
            this.renderStatus();
            this.updateParamsAccessibility('mb');
            this.updateStatusTimestamp();
            this.setNote(`mb-status-note-${this.objectName}`, '');
        } catch (err) {
            this.setNote(`mb-status-note-${this.objectName}`, err.message, true);
        }
    }

    renderStatus() {
        const tbody = document.getElementById(`mb-status-${this.objectName}`);
        if (!tbody) return;

        tbody.innerHTML = '';

        if (!this.status) {
            tbody.innerHTML = '<tr><td colspan="2" class="text-muted">No data</td></tr>';
            return;
        }

        const status = this.status;
        const rows = [
            { label: 'Name', value: status.name },
            { label: 'Monitor', value: status.monitor },
            { label: 'Activated', value: status.activated },
            { label: 'Mode', value: status.mode?.name || status.exchangeMode },
            { label: 'force', value: status.force },
            { label: 'force_out', value: status.force_out },
            { label: 'maxHeartBeat', value: status.maxHeartBeat },
            { label: 'activateTimeout', value: status.activateTimeout },
            { label: 'reopenTimeout', value: status.reopenTimeout }
        ];

        rows.forEach(row => {
            if (row.value === undefined || row.value === null) return;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="info-label">${row.label}</td>
                <td class="info-value">${formatValue(row.value)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    async loadParams() {
        try {
            const query = this.paramNames.map(n => `name=${encodeURIComponent(n)}`).join('&');
            const data = await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/modbus/params?${query}`);
            this.params = data.params || {};
            this.renderParams();
            this.updateParamsAccessibility('mb');
            this.setNote(`mb-params-note-${this.objectName}`, '');
        } catch (err) {
            this.setNote(`mb-params-note-${this.objectName}`, err.message, true);
        }
    }

    renderParams() {
        const tbody = document.getElementById(`mb-params-${this.objectName}`);
        if (!tbody) return;

        tbody.innerHTML = '';

        this.paramNames.forEach(name => {
            const value = this.params[name];
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="param-name">${name}</td>
                <td class="param-value">${value !== undefined ? value : '—'}</td>
                <td class="param-input">
                    <input type="text" class="param-field" data-param="${name}" placeholder="${value !== undefined ? value : ''}" />
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async saveParams() {
        const inputs = document.querySelectorAll(`#mb-params-${this.objectName} input.param-field`);
        const params = {};

        inputs.forEach(input => {
            const name = input.dataset.param;
            const val = input.value.trim();
            if (val !== '') {
                params[name] = val;
            }
        });

        if (Object.keys(params).length === 0) {
            this.setNote(`mb-params-note-${this.objectName}`, 'No changes');
            return;
        }

        try {
            await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/modbus/params`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ params })
            });
            this.setNote(`mb-params-note-${this.objectName}`, 'Saved');
            this.loadParams();
        } catch (err) {
            this.setNote(`mb-params-note-${this.objectName}`, err.message, true);
        }
    }

    async loadDevices() {
        try {
            const data = await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/modbus/devices`);
            this.devices = data.devices || [];
            this.renderDevices();
            this.setNote(`mb-devices-note-${this.objectName}`, '');
        } catch (err) {
            this.setNote(`mb-devices-note-${this.objectName}`, err.message, true);
        }
    }

    renderDevices() {
        const container = document.getElementById(`mb-devices-${this.objectName}`);
        const countEl = document.getElementById(`mb-device-count-${this.objectName}`);
        if (!container) return;

        if (countEl) {
            countEl.textContent = `${this.devices.length} devices`;
        }

        if (this.devices.length === 0) {
            container.innerHTML = '<div class="text-muted">No devices</div>';
            return;
        }

        container.innerHTML = `
            <table class="variables-table mb-devices-table">
                <thead>
                    <tr>
                        <th>Address</th>
                        <th>Status</th>
                        <th>Type</th>
                        <th>Registers</th>
                        <th>Mode</th>
                        <th>SafeMode</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.devices.map(dev => {
                        const respondClass = dev.respond ? '' : 'status-bad';
                        const respondText = dev.respond ? 'Ok' : 'No response';
                        return `
                            <tr>
                                <td>${dev.addr}</td>
                                <td class="${respondClass}">${respondText}</td>
                                <td>${dev.dtype || '—'}</td>
                                <td>${dev.regCount ?? 0}</td>
                                <td>${dev.mode ?? 0}</td>
                                <td>${dev.safeMode ?? 0}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    async loadRegisters() {
        this.allRegisters = [];
        this.devicesDict = {};
        this.hasMore = true;
        this.isLoadingChunk = false;
        await this.loadRegisterChunk(0);
    }

    async loadRegisterChunk(offset) {
        if (this.isLoadingChunk || !this.hasMore) return;
        this.isLoadingChunk = true;

        const loadingEl = document.getElementById(`mb-loading-more-${this.objectName}`);
        if (loadingEl) loadingEl.style.display = 'block';

        try {
            let url = `/api/objects/${encodeURIComponent(this.objectName)}/modbus/registers?offset=${offset}&limit=${this.chunkSize}`;
            if (this.typeFilter && this.typeFilter !== 'all') {
                url += `&iotype=${encodeURIComponent(this.typeFilter)}`;
            }

            const data = await this.fetchJSON(url);
            const registers = data.registers || [];
            this.registersTotal = data.total || 0;

            // Merge devices dictionary
            if (data.devices) {
                Object.assign(this.devicesDict, data.devices);
            }

            if (offset === 0) {
                this.allRegisters = registers;
                this.registerMap.clear();
                registers.forEach(r => this.registerMap.set(r.id, r));

                // Если нет фильтра и есть закреплённые регистры - загрузить их отдельно
                if (!this.filter) {
                    await this.loadPinnedRegisters();
                }
            } else {
                this.allRegisters = this.allRegisters.concat(registers);
                registers.forEach(r => this.registerMap.set(r.id, r));
            }

            this.hasMore = this.allRegisters.length < this.registersTotal;
            this.renderRegisters();
            this.setNote(`mb-registers-note-${this.objectName}`, '');

            this.updateItemCount(`mb-register-count-${this.objectName}`, this.allRegisters.length, this.registersTotal);

            // Подписываемся на SSE обновления после загрузки
            this.subscribeToSSE();
        } catch (err) {
            this.setNote(`mb-registers-note-${this.objectName}`, err.message, true);
        } finally {
            this.isLoadingChunk = false;
            if (loadingEl) loadingEl.style.display = 'none';
        }
    }

    // Загружает закреплённые регистры, если они не в текущем списке
    async loadPinnedRegisters() {
        const pinnedIds = this.getPinnedRegisters();
        if (pinnedIds.size === 0) return;

        // Найти ID, которых нет в загруженных регистрах
        const missingIds = [];
        for (const idStr of pinnedIds) {
            const id = parseInt(idStr);
            if (!this.registerMap.has(id)) {
                missingIds.push(id);
            }
        }

        if (missingIds.length === 0) return;

        // Загрузить отсутствующие регистры по ID
        try {
            const idsParam = missingIds.join(',');
            const url = `/api/objects/${encodeURIComponent(this.objectName)}/modbus/get?filter=${idsParam}`;
            const response = await this.fetchJSON(url);
            const pinnedRegisters = response.registers || [];

            // Добавить закреплённые регистры в начало списка
            for (const reg of pinnedRegisters) {
                if (!this.registerMap.has(reg.id)) {
                    this.allRegisters.unshift(reg);
                    this.registerMap.set(reg.id, reg);
                }
            }
        } catch (err) {
            console.warn('Failed to load pinned registers:', err);
        }
    }

    renderRegisters() {
        const tbody = document.getElementById(`mb-registers-tbody-${this.objectName}`);
        if (!tbody) return;

        // Получаем закрепленные регистры
        const pinnedRegisters = this.getPinnedRegisters();
        const hasPinned = pinnedRegisters.size > 0;

        // Показываем/скрываем кнопку "снять все"
        const unpinBtn = document.getElementById(`mb-unpin-${this.objectName}`);
        if (unpinBtn) {
            unpinBtn.style.display = hasPinned ? 'inline' : 'none';
        }

        // Фильтруем регистры используя общий метод (по name, id, mbreg)
        const mbregAccessor = (item, field) => (item.register || {})[field];
        let registersToShow = this.applyFilters(this.allRegisters, 'name', 'iotype', null, ['mbreg'], mbregAccessor);

        // Если есть закрепленные и нет фильтра — показываем только их
        if (hasPinned && !this.filter) {
            registersToShow = registersToShow.filter(r => pinnedRegisters.has(String(r.id)));
        }

        // Обновляем счётчик с учётом фильтрации
        this.updateItemCount(`mb-register-count-${this.objectName}`, registersToShow.length, this.registersTotal);

        // Update registerMap for chart support
        registersToShow.forEach(reg => {
            if (reg.id) {
                this.registerMap.set(reg.id, reg);
            }
        });

        const html = registersToShow.map(reg => {
            const isPinned = pinnedRegisters.has(String(reg.id));
            const pinToggleClass = isPinned ? 'pin-toggle pinned' : 'pin-toggle';
            const pinIcon = isPinned ? '📌' : '○';
            const pinTitle = isPinned ? 'Unpin' : 'Pin';

            const deviceAddr = reg.device;
            const deviceInfo = this.devicesDict[deviceAddr] || {};
            const regInfo = reg.register || {};
            const respondClass = deviceInfo.respond ? 'ok' : 'fail';
            return `
                <tr data-sensor-id="${reg.id}">
                    <td class="col-pin">
                        <span class="${pinToggleClass}" data-id="${reg.id}" title="${pinTitle}">
                            ${pinIcon}
                        </span>
                    </td>
                    ${this.renderAddButtonsCell(reg.id, reg.name, 'mbreg', reg.textname || reg.name)}
                    <td class="col-id">${reg.id}</td>
                    <td class="col-name" title="${escapeHtml(reg.textname || reg.comment || '')}">${escapeHtml(reg.name || '')}</td>
                    <td class="col-type">${reg.iotype ? `<span class="type-badge type-${reg.iotype}">${reg.iotype}</span>` : ''}</td>
                    <td class="col-value">${reg.value !== undefined ? reg.value : ''}</td>
                    <td class="col-device"><span class="mb-respond ${respondClass}">${deviceAddr || ''}</span></td>
                    <td class="col-register">${regInfo.mbreg || ''}</td>
                    <td class="col-func">${regInfo.mbfunc || ''}</td>
                    <td class="col-mbval">${regInfo.mbval !== undefined ? regInfo.mbval : ''}</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = html;

        // Bind chart toggle events
        this.attachChartToggleListeners(tbody, this.registerMap);

        // Bind dashboard button events
        this.attachDashboardToggleListeners(tbody);

        // Bind pin toggle events
        tbody.querySelectorAll('.pin-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => this.toggleRegisterPin(parseInt(toggle.dataset.id)));
        });

        // Обработчик кнопки "снять все"
        if (unpinBtn) {
            unpinBtn.onclick = () => this.unpinAllRegisters();
        }
    }

    // Override to use Modbus SSE subscription
    subscribeToChartSensor(sensorId) {
        // ModbusMaster registers are already subscribed through main SSE
        if (!this.subscribedSensorIds.has(sensorId)) {
            this.subscribedSensorIds.add(sensorId);
        }
    }

    setupVirtualScroll() {
        const viewport = document.getElementById(`mb-registers-viewport-${this.objectName}`);
        if (!viewport) return;

        viewport.addEventListener('scroll', () => {
            const scrollTop = viewport.scrollTop;
            const viewportHeight = viewport.clientHeight;
            const scrollHeight = viewport.scrollHeight;

            // Загружаем следующий чанк когда остается 100px до конца
            if (scrollHeight - scrollTop - viewportHeight < 100) {
                this.loadRegisterChunk(this.allRegisters.length);
            }
        });
    }

    loadRegistersHeight() {
        return this.loadSectionHeight('uniset-panel-mb-registers', 320);
    }

    saveRegistersHeight(value) {
        this.registersHeight = value;
        this.saveSectionHeight('uniset-panel-mb-registers', value);
    }

    setupRegistersResize() {
        this.setupSectionResize(
            `mb-registers-resize-${this.objectName}`,
            `mb-registers-container-${this.objectName}`,
            'uniset-panel-mb-registers',
            'registersHeight',
            { minHeight: 200, maxHeight: 700 }
        );
    }

    // === SSE подписка на обновления регистров (использует SSESubscriptionMixin) ===

    async subscribeToSSE() {
        const registerIds = this.allRegisters.map(r => r.id);
        await this.subscribeToSSEFor('/modbus', registerIds, 'register_ids', 'ModbusMaster SSE');
    }

    async unsubscribeFromSSE() {
        await this.unsubscribeFromSSEFor('/modbus', 'register_ids', 'ModbusMaster SSE');
    }

    handleModbusRegisterUpdates(registers) {
        if (!Array.isArray(registers) || registers.length === 0) return;

        // Добавляем в очередь на обновление
        this.pendingUpdates.push(...registers);

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
        updates.forEach(reg => {
            updateMap.set(reg.id, reg);
        });

        // Обновляем данные в allRegisters
        let hasChanges = false;
        this.allRegisters.forEach((reg, index) => {
            const update = updateMap.get(reg.id);
            if (update && update.value !== reg.value) {
                this.allRegisters[index] = { ...reg, value: update.value };
                hasChanges = true;
            }
        });

        if (!hasChanges) return;

        // Обновляем только изменившиеся ячейки в DOM
        const tbody = document.getElementById(`mb-registers-tbody-${this.objectName}`);
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
            const regId = parseInt(row.dataset.sensorId);
            if (!regId) return;

            const update = updateMap.get(regId);
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
            }
        });
    }

    update(data) {
        renderObjectInfo(this.tabKey, data.object);
        updateChartLegends(this.tabKey, data);
        this.handleLogServer(data.LogServer);
    }

    // Pin management для регистров
    getPinnedRegisters() {
        return this.getPinnedItems('uniset-panel-mb-pinned');
    }

    savePinnedRegisters(pinnedSet) {
        this.savePinnedItems('uniset-panel-mb-pinned', pinnedSet);
    }

    toggleRegisterPin(registerId) {
        this.toggleItemPin('uniset-panel-mb-pinned', registerId, this.renderRegisters);
    }

    unpinAllRegisters() {
        this.unpinAllItems('uniset-panel-mb-pinned', this.renderRegisters);
    }
}

// Apply mixins to ModbusMasterRenderer
applyMixin(ModbusMasterRenderer, VirtualScrollMixin);
applyMixin(ModbusMasterRenderer, SSESubscriptionMixin);
applyMixin(ModbusMasterRenderer, ResizableSectionMixin);
applyMixin(ModbusMasterRenderer, FilterMixin);
applyMixin(ModbusMasterRenderer, ParamsAccessibilityMixin);
applyMixin(ModbusMasterRenderer, ItemCounterMixin);
applyMixin(ModbusMasterRenderer, SectionHeightMixin);
applyMixin(ModbusMasterRenderer, PinManagementMixin);

// Регистрируем стандартные рендереры
registerRenderer('UniSetManager', UniSetManagerRenderer);
registerRenderer('UniSetObject', UniSetObjectRenderer);
registerRenderer('IONotifyController', IONotifyControllerRenderer);
registerRenderer('OPCUAExchange', OPCUAExchangeRenderer);

// ModbusMaster рендерер (по extensionType)
registerRenderer('ModbusMaster', ModbusMasterRenderer);

// Fallback для старых версий (по objectType)
registerRenderer('MBTCPMaster', ModbusMasterRenderer);
registerRenderer('MBTCPMultiMaster', ModbusMasterRenderer);
registerRenderer('MBRTUMaster', ModbusMasterRenderer);
registerRenderer('ModbusTCPMaster', ModbusMasterRenderer);
registerRenderer('ModbusRTUMaster', ModbusMasterRenderer);

