// ============================================================================
// IONotifyControllerRenderer - рендерер для SharedMemory и подобных объектов
// ============================================================================

class IONotifyControllerRenderer extends BaseObjectRenderer {
    static getTypeName() {
        return 'IONotifyController';
    }

    constructor(objectName, tabKey = null) {
        super(objectName, tabKey);
        this.sensors = [];
        this.sensorMap = new Map();
        this.filter = '';
        this.typeFilter = 'all';
        this.totalCount = 0;
        this.loading = false;
        this.subscribedSensorIds = new Set();
        // Для батчевого рендеринга
        this.pendingUpdates = new Map(); // id -> sensor
        this.renderScheduled = false;

        // Virtual scroll properties (как в OPCUA)
        this.allSensors = [];           // Все загруженные сенсоры
        this.rowHeight = 32;            // Высота строки (px)
        this.bufferRows = 10;           // Буфер строк выше/ниже viewport
        this.startIndex = 0;            // Первая видимая строка
        this.endIndex = 0;              // Последняя видимая строка

        // Infinite scroll properties
        this.chunkSize = 200;           // Сенсоров за запрос
        this.hasMore = true;            // Есть ли ещё данные
        this.isLoadingChunk = false;    // Идёт загрузка

        // Генераторы значений: Map<sensorId, GeneratorState>
        this.activeGenerators = new Map();
    }

    // IONotifyController датчики - показываем badge "IO" и prefix "io"
    getChartOptions() {
        return { badge: 'IO', prefix: 'io' };
    }

    createPanelHTML() {
        return `
            ${this.createChartsSection()}
            ${this.createSensorsSection()}
            ${this.createLogViewerSection()}
            ${this.createLogServerSection()}
            ${this.createLostConsumersSection()}
            ${this.createObjectInfoSection()}
        `;
    }

    initialize() {
        this.setupEventListeners();
        this.loadSensors();
        this.loadLostConsumers();
        setupChartsResize(this.tabKey);
        setupIONCSensorsResize(this.objectName);
        this.setupVirtualScroll();
    }

    createSensorsSection() {
        return `
            <div class="collapsible-section reorderable-section ionc-sensors-section" data-section="ionc-sensors-${this.objectName}" data-section-id="ionc-sensors">
                <div class="collapsible-header" onclick="toggleSection('ionc-sensors-${this.objectName}')">
                    <svg class="collapsible-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M6 9l6 6 6-6"/>
                    </svg>
                    <span class="collapsible-title">Sensors</span>
                    <span class="sensor-count" id="ionc-sensor-count-${this.objectName}">0</span>
                    <div class="filter-bar" onclick="event.stopPropagation()">
                        <input type="text" class="filter-input" id="ionc-filter-${this.objectName}" placeholder="Filter...">
                        <select class="type-filter" id="ionc-type-filter-${this.objectName}">
                            <option value="all">All</option>
                            <option value="AI">AI</option>
                            <option value="DI">DI</option>
                            <option value="AO">AO</option>
                            <option value="DO">DO</option>
                        </select>
                    </div>
                    <div class="section-reorder-buttons" onclick="event.stopPropagation()">
                        <button class="section-move-btn section-move-up" onclick="moveSectionUp('${this.tabKey}', 'ionc-sensors')" title="Move up">↑</button>
                        <button class="section-move-btn section-move-down" onclick="moveSectionDown('${this.tabKey}', 'ionc-sensors')" title="Move down">↓</button>
                    </div>
                </div>
                <div class="collapsible-content" id="section-ionc-sensors-${this.objectName}">
                    <div class="ionc-sensors-table-container" id="ionc-sensors-container-${this.objectName}">
                        <div class="ionc-sensors-viewport" id="ionc-sensors-viewport-${this.objectName}">
                            <div class="ionc-sensors-spacer" id="ionc-sensors-spacer-${this.objectName}"></div>
                            <table class="sensors-table ionc-sensors-table">
                                <thead>
                                    <tr>
                                        <th class="ionc-col-pin">
                                            <span class="ionc-unpin-all" id="ionc-unpin-${this.objectName}" title="Unpin all" style="display:none">✕</span>
                                        </th>
                                        <th class="ionc-col-chart"></th>
                                        <th class="ionc-col-id">ID</th>
                                        <th class="ionc-col-name">Name</th>
                                        <th class="ionc-col-type">Type</th>
                                        <th class="ionc-col-value">Value</th>
                                        <th class="ionc-col-flags">Status</th>
                                        <th class="ionc-col-supplier">Supplier</th>
                                        <th class="ionc-col-consumers">Consumers</th>
                                        <th class="ionc-col-actions">Actions</th>
                                    </tr>
                                </thead>
                                <tbody class="ionc-sensors-tbody" id="ionc-sensors-tbody-${this.objectName}">
                                    <tr><td colspan="10" class="ionc-loading">Loading...</td></tr>
                                </tbody>
                            </table>
                            <div class="ionc-loading-more" id="ionc-loading-more-${this.objectName}" style="display: none;">Loading...</div>
                        </div>
                    </div>
                    <div class="resize-handle" id="ionc-resize-${this.objectName}"></div>
                </div>
            </div>
        `;
    }

    createLostConsumersSection() {
        return this.createCollapsibleSection(
            'ionc-lost',
            'Lost consumers',
            `<div class="ionc-lost-list" id="ionc-lost-list-${this.objectName}">
                <span class="ionc-lost-empty">No lost consumers</span>
            </div>`,
            { badge: true }
        );
    }

    setupEventListeners() {
        // Используем методы из FilterMixin
        this.setupFilterListeners(
            `ionc-filter-${this.objectName}`,
            `ionc-type-filter-${this.objectName}`,
            () => this.loadSensors()
        );
        this.setupContainerEscHandler(
            `ionc-sensors-container-${this.objectName}`,
            `ionc-filter-${this.objectName}`,
            () => this.loadSensors()
        );

    }

    async loadSensors() {
        if (this.loading) return;
        this.loading = true;

        // Reset state
        this.allSensors = [];
        this.hasMore = true;
        this.startIndex = 0;
        this.endIndex = 0;

        const viewport = document.getElementById(`ionc-sensors-viewport-${this.objectName}`);
        if (viewport) viewport.scrollTop = 0;

        const tbody = document.getElementById(`ionc-sensors-tbody-${this.objectName}`);
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="10" class="ionc-loading">Loading...</td></tr>';
        }

        // Проверяем режим фильтрации: false = серверная (default), true = UI
        const useUIFilter = state.config.ioncUISensorsFilter;

        try {
            let url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/sensors?offset=0&limit=${this.chunkSize}`);

            // Серверная фильтрация (если не включена UI фильтрация)
            if (!useUIFilter) {
                if (this.filter) {
                    url += `&search=${encodeURIComponent(this.filter)}`;
                }
                if (this.typeFilter && this.typeFilter !== 'all') {
                    url += `&iotype=${this.typeFilter}`;
                }
            }

            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to load sensors');

            const data = await response.json();
            this.totalCount = data.size || 0;

            let sensors = data.sensors || [];

            // UI фильтрация (если включена)
            if (useUIFilter) {
                sensors = this.applyLocalFilters(sensors);
            }

            this.allSensors = sensors;
            this.sensors = sensors; // Для совместимости с существующим кодом
            this.sensorMap.clear();
            sensors.forEach(s => this.sensorMap.set(s.id, s));

            // Если нет фильтра и есть закреплённые датчики - загрузить их отдельно
            if (!this.filter) {
                await this.loadPinnedSensors();
            }

            this.hasMore = (data.sensors?.length || 0) === this.chunkSize;
            this.updateVisibleRows();
            this.updateSensorCount();

            // Подписываемся на SSE обновления для загруженных датчиков
            this.subscribeToSSE();
        } catch (err) {
            console.error('Error loading IONC sensors:', err);
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="9" class="ionc-error">Error загрузки: ${err.message}</td></tr>`;
            }
        } finally {
            this.loading = false;
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

        // Загрузить отсутствующие датчики по ID (используем /ionc/get с filter)
        try {
            const idsParam = missingIds.join(',');
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/get?filter=${idsParam}`);
            const response = await fetch(url);
            if (!response.ok) return;

            const data = await response.json();
            const pinnedSensors = data.sensors || [];

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
                s.name.toLowerCase().includes(filterLower) ||
                String(s.id).includes(filterLower)
            );
        }
        if (this.typeFilter !== 'all') {
            result = result.filter(s => s.type === this.typeFilter);
        }
        return result;
    }

    async loadMoreSensors() {
        if (this.isLoadingChunk || !this.hasMore) return;

        this.isLoadingChunk = true;
        this.showLoadingIndicator(true);

        // Проверяем режим фильтрации: false = серверная (default), true = UI
        const useUIFilter = state.config.ioncUISensorsFilter;

        try {
            const nextOffset = this.allSensors.length;
            let url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/sensors?offset=${nextOffset}&limit=${this.chunkSize}`);

            // Серверная фильтрация (если не включена UI фильтрация)
            if (!useUIFilter) {
                if (this.filter) {
                    url += `&search=${encodeURIComponent(this.filter)}`;
                }
                if (this.typeFilter && this.typeFilter !== 'all') {
                    url += `&iotype=${this.typeFilter}`;
                }
            }

            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to load more sensors');

            const data = await response.json();
            let newSensors = data.sensors || [];

            // UI фильтрация (если включена)
            if (useUIFilter) {
                newSensors = this.applyLocalFilters(newSensors);
            }

            // Дедупликация: добавляем только датчики которых еще нет
            const existingIds = new Set(this.allSensors.map(s => s.id));
            const uniqueNewSensors = newSensors.filter(s => !existingIds.has(s.id));

            // Добавить к уже загруженным
            this.allSensors = [...this.allSensors, ...uniqueNewSensors];
            this.sensors = this.allSensors; // Для совместимости
            uniqueNewSensors.forEach(s => this.sensorMap.set(s.id, s));

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
        const viewport = document.getElementById(`ionc-sensors-viewport-${this.objectName}`);
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
        const viewport = document.getElementById(`ionc-sensors-viewport-${this.objectName}`);
        if (!viewport) return;

        const scrollTop = viewport.scrollTop;
        const viewportHeight = viewport.clientHeight;
        const totalRows = this.allSensors.length;
        const visibleRows = Math.ceil(viewportHeight / this.rowHeight);

        this.startIndex = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.bufferRows);
        this.endIndex = Math.min(totalRows, this.startIndex + visibleRows + 2 * this.bufferRows);

        this.renderVisibleSensors();
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

    showLoadingIndicator(show) {
        const el = document.getElementById(`ionc-loading-more-${this.objectName}`);
        if (el) el.style.display = show ? 'block' : 'none';
    }

    renderVisibleSensors() {
        const tbody = document.getElementById(`ionc-sensors-tbody-${this.objectName}`);
        const spacer = document.getElementById(`ionc-sensors-spacer-${this.objectName}`);
        if (!tbody || !spacer) return;

        // Set высоту spacer для позиционирования
        spacer.style.height = `${this.startIndex * this.rowHeight}px`;

        // Получаем закреплённые датчики
        const pinnedSensors = this.getPinnedSensors();
        const hasPinned = pinnedSensors.size > 0;

        // Показываем/скрываем кнопку "снять все"
        const unpinBtn = document.getElementById(`ionc-unpin-${this.objectName}`);
        if (unpinBtn) {
            unpinBtn.style.display = hasPinned ? 'inline' : 'none';
        }

        // Filterуем датчики:
        // - если есть текстовый фильтр — показываем все (для поиска новых датчиков)
        // - иначе если есть закреплённые — показываем только их
        let sensorsToShow = this.allSensors;
        if (!this.filter && hasPinned) {
            sensorsToShow = this.allSensors.filter(s => pinnedSensors.has(String(s.id)));
        }

        if (sensorsToShow.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="ionc-empty">No sensors</td></tr>';
            return;
        }

        // Virtual scroll: показываем только видимые строки
        const visibleSensors = sensorsToShow.slice(this.startIndex, this.endIndex);

        tbody.innerHTML = visibleSensors.map(sensor => this.renderSensorRow(sensor, pinnedSensors.has(String(sensor.id)))).join('');

        // Привязать события к строкам
        this.bindRowEvents(tbody);

        // Обработчик кнопки "снять все"
        if (unpinBtn) {
            unpinBtn.onclick = () => this.unpinAll();
        }
    }

    bindRowEvents(tbody) {
        // Добавляем обработчики событий
        tbody.querySelectorAll('.ionc-btn-set').forEach(btn => {
            btn.addEventListener('click', () => this.showSetDialog(parseInt(btn.dataset.id)));
        });
        // Кнопка заморозки: одинарный клик = диалог, двойной клик = быстрая заморозка
        tbody.querySelectorAll('.ionc-btn-freeze').forEach(btn => {
            let clickTimer = null;
            const sensorId = parseInt(btn.dataset.id);
            btn.addEventListener('click', () => {
                if (clickTimer) {
                    clearTimeout(clickTimer);
                    clickTimer = null;
                    this.quickFreeze(sensorId);
                } else {
                    clickTimer = setTimeout(() => {
                        clickTimer = null;
                        this.showFreezeDialog(sensorId);
                    }, 250);
                }
            });
        });
        // Кнопка разморозки: одинарный клик = диалог, двойной клик = быстрая разморозка
        tbody.querySelectorAll('.ionc-btn-unfreeze').forEach(btn => {
            let clickTimer = null;
            const sensorId = parseInt(btn.dataset.id);
            btn.addEventListener('click', () => {
                if (clickTimer) {
                    clearTimeout(clickTimer);
                    clickTimer = null;
                    this.quickUnfreeze(sensorId);
                } else {
                    clickTimer = setTimeout(() => {
                        clickTimer = null;
                        this.showUnfreezeDialog(sensorId);
                    }, 250);
                }
            });
        });
        tbody.querySelectorAll('.ionc-btn-consumers').forEach(btn => {
            btn.addEventListener('click', () => this.showConsumersDialog(parseInt(btn.dataset.id)));
        });
        // Кнопки генератора
        tbody.querySelectorAll('.ionc-btn-gen').forEach(btn => {
            btn.addEventListener('click', () => this.showGeneratorDialog(parseInt(btn.dataset.id)));
        });
        tbody.querySelectorAll('.ionc-btn-gen-stop').forEach(btn => {
            btn.addEventListener('click', () => this.stopGenerator(parseInt(btn.dataset.id)));
        });
        tbody.querySelectorAll('.pin-toggle').forEach(btn => {
            btn.addEventListener('click', () => this.togglePin(parseInt(btn.dataset.id)));
        });
        tbody.querySelectorAll('.ionc-chart-checkbox').forEach(cb => {
            cb.addEventListener('change', () => this.toggleSensorChartById(parseInt(cb.dataset.id)));
        });
    }

    // Legacy alias for compatibility
    renderSensorsTable() {
        this.renderVisibleSensors();
    }

    renderSensorRow(sensor, isPinned) {
        // Получаем textname из справочника сенсоров (конфигурации)
        const sensorInfo = state.sensorsByName.get(sensor.name);
        const textname = sensorInfo?.textname || sensor.textname || '';

        const frozenClass = sensor.frozen ? 'ionc-sensor-frozen' : '';
        const blockedClass = sensor.blocked ? 'ionc-sensor-blocked' : '';
        const readonlyClass = sensor.readonly ? 'ionc-sensor-readonly' : '';

        // Проверяем активный генератор
        const hasGenerator = this.activeGenerators.has(sensor.id);
        const generatorClass = hasGenerator ? 'ionc-sensor-generating' : '';
        const genState = hasGenerator ? this.activeGenerators.get(sensor.id) : null;

        const flags = [];
        if (hasGenerator) flags.push(`<span class="ionc-flag ionc-flag-generator" title="Генератор: ${genState.type} (${genState.min}-${genState.max})">⟳</span>`);
        if (sensor.frozen) flags.push('<span class="ionc-flag ionc-flag-frozen" title="Frozen">❄</span>');
        if (sensor.blocked) flags.push('<span class="ionc-flag ionc-flag-blocked" title="Blocked">🔒</span>');
        if (sensor.readonly) flags.push('<span class="ionc-flag ionc-flag-readonly" title="Read only">👁</span>');
        if (sensor.undefined) flags.push('<span class="ionc-flag ionc-flag-undefined" title="Undefined">?</span>');

        // Проверка возможности управления
        const canCtrl = canControl();
        const ctrlDisabled = !canCtrl ? 'disabled' : '';
        const ctrlTitle = !canCtrl ? 'Read-only mode' : '';

        const freezeBtn = sensor.frozen
            ? `<button class="ionc-btn ionc-btn-unfreeze" data-id="${sensor.id}" title="${ctrlTitle || 'Frozen at: ' + sensor.value + '. Click to unfreeze'}" ${ctrlDisabled}>🔥</button>`
            : `<button class="ionc-btn ionc-btn-freeze" data-id="${sensor.id}" title="${ctrlTitle || 'Freeze'}" ${ctrlDisabled}>❄</button>`;

        // Кнопка генератора
        const genBtn = hasGenerator
            ? `<button class="ionc-btn ionc-btn-gen-stop" data-id="${sensor.id}" title="${ctrlTitle || 'Остановить генератор'}" ${ctrlDisabled}>⏹</button>`
            : `<button class="ionc-btn ionc-btn-gen" data-id="${sensor.id}" title="${ctrlTitle || 'Генератор значений'}" ${sensor.readonly || !canCtrl ? 'disabled' : ''}>⟳</button>`;

        // Кнопка закрепления (pin)
        const pinToggleClass = isPinned ? 'pin-toggle pinned' : 'pin-toggle';
        const pinIcon = isPinned ? '📌' : '○';
        const pinTitle = isPinned ? 'Unpin' : 'Pin';

        // Checkbox для графика
        const isOnChart = this.isSensorOnChart(sensor.name);
        const varName = `ionc-${sensor.id}`;

        // Supplier с fallback на supplier_id
        const supplierValue = sensor.supplier || (sensor.supplier_id ? String(sensor.supplier_id) : '');

        return `
            <tr class="ionc-sensor-row ${frozenClass} ${blockedClass} ${readonlyClass} ${generatorClass}" data-sensor-id="${sensor.id}">
                <td class="ionc-col-pin">
                    <span class="${pinToggleClass}" data-id="${sensor.id}" title="${pinTitle}">
                        ${pinIcon}
                    </span>
                </td>
                <td class="ionc-col-chart">
                    <span class="chart-toggle">
                        <input type="checkbox"
                               class="ionc-chart-checkbox chart-toggle-input"
                               id="ionc-chart-${this.objectName}-${varName}"
                               data-id="${sensor.id}"
                               data-name="${escapeHtml(sensor.name)}"
                               ${isOnChart ? 'checked' : ''}>
                        <label class="chart-toggle-label" for="ionc-chart-${this.objectName}-${varName}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 3v18h18"/>
                                <path d="M18 9l-5 5-4-4-3 3"/>
                            </svg>
                        </label>
                    </span>
                </td>
                <td class="ionc-col-id">${sensor.id}</td>
                <td class="ionc-col-name" title="${escapeHtml(textname)}">${escapeHtml(sensor.name)}</td>
                <td class="ionc-col-type"><span class="type-badge type-${sensor.type}">${sensor.type}</span></td>
                <td class="ionc-col-value">
                    ${sensor.frozen && sensor.real_value !== undefined && sensor.real_value !== sensor.value
                        ? `<span class="ionc-value ionc-value-frozen" id="ionc-value-${this.objectName}-${sensor.id}">
                               <span class="ionc-real-value">${sensor.real_value}</span>
                               <span class="ionc-frozen-arrow">→</span>
                               <span class="ionc-frozen-value">${sensor.value}❄</span>
                           </span>`
                        : `<span class="ionc-value" id="ionc-value-${this.objectName}-${sensor.id}">${sensor.value}</span>`
                    }
                </td>
                <td class="ionc-col-flags">${flags.join(' ') || '—'}</td>
                <td class="ionc-col-supplier" id="ionc-supplier-${this.objectName}-${sensor.id}" title="${escapeHtml(supplierValue)}">${escapeHtml(supplierValue)}</td>
                <td class="ionc-col-consumers">
                    <button class="ionc-btn ionc-btn-consumers" data-id="${sensor.id}" title="Show consumers">👥</button>
                </td>
                <td class="ionc-col-actions">
                    <button class="ionc-btn ionc-btn-set" data-id="${sensor.id}" title="${ctrlTitle || 'Set value'}" ${sensor.readonly || !canCtrl ? 'disabled' : ''}>✎</button>
                    ${genBtn}
                    ${freezeBtn}
                </td>
            </tr>
        `;
    }

    // Управление закреплёнными датчиками
    getPinnedSensors() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset-panel-ionc-pinned') || '{}');
            return new Set(saved[this.objectName] || []);
        } catch (err) {
            return new Set();
        }
    }

    savePinnedSensors(pinnedSet) {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset-panel-ionc-pinned') || '{}');
            saved[this.objectName] = Array.from(pinnedSet);
            localStorage.setItem('uniset-panel-ionc-pinned', JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save pinned sensors:', err);
        }
    }

    togglePin(sensorId) {
        const pinned = this.getPinnedSensors();
        const idStr = String(sensorId);

        if (pinned.has(idStr)) {
            pinned.delete(idStr);
        } else {
            pinned.add(idStr);
        }

        this.savePinnedSensors(pinned);
        this.renderSensorsTable();
    }

    unpinAll() {
        this.savePinnedSensors(new Set());
        this.renderSensorsTable();
    }

    // Используем метод toggleSensorChart из базового класса
    // isSensorOnChart также наследуется из BaseObjectRenderer
    toggleSensorChartById(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;
        // Приводим к формату базового метода (iotype вместо type)
        const sensorData = { ...sensor, iotype: sensor.type };
        this.toggleSensorChart(sensorData);
    }

    updateSensorCount() {
        this.updateItemCount(`ionc-sensor-count-${this.objectName}`, this.allSensors.length, this.totalCount);
    }

    showSetDialog(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        const objectName = this.objectName;
        const self = this;

        // Предупреждение если датчик заморожен
        const frozenWarning = sensor.frozen
            ? `<div class="ionc-dialog-warning">⚠️ Sensor is frozen. Value will not be changed until you unfreeze the sensor.</div>`
            : '';

        const body = `
            <div class="ionc-dialog-info">
                Sensor: <strong>${escapeHtml(sensor.name)}</strong> (ID: ${sensorId})<br>
                Current value: <strong>${sensor.value}</strong>
            </div>
            ${frozenWarning}
            <div class="ionc-dialog-field">
                <label for="ionc-set-value">New value:</label>
                <input type="number" id="ionc-set-value" value="${sensor.value}">
            </div>
        `;

        const footer = `
            <button class="ionc-dialog-btn ionc-dialog-btn-cancel" onclick="closeIoncDialog()">Cancel</button>
            <button class="ionc-dialog-btn ionc-dialog-btn-primary" id="ionc-set-confirm">Apply</button>
        `;

        const doSetValue = async () => {
            const input = document.getElementById('ionc-set-value');
            const value = parseInt(input.value, 10);

            if (isNaN(value)) {
                showIoncDialogError('Enter an integer');
                input.classList.add('error');
                return;
            }

            try {
                const url = self.buildUrl(`/api/objects/${encodeURIComponent(objectName)}/ionc/set`);
                const response = await controlledFetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sensor_id: sensorId, value: value })
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Failed to set value');
                }

                // Обновляем локально
                if (sensor.frozen) {
                    // Если заморожен - обновляем real_value (значение SM), value остаётся замороженным
                    sensor.real_value = value;
                } else {
                    sensor.value = value;
                }
                // Перерисовываем строку для корректного отображения формата
                self.reRenderSensorRow(sensorId);

                closeIoncDialog();
            } catch (err) {
                showIoncDialogError(`Error: ${err.message}`);
            }
        };

        openIoncDialog({
            title: 'Set value',
            body,
            footer,
            focusInput: true,
            onConfirm: doSetValue
        });

        // Attach button handler
        document.getElementById('ionc-set-confirm').addEventListener('click', doSetValue);
    }

    // Показать диалог заморозки (одинарный клик на ❄)
    showFreezeDialog(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        const objectName = this.objectName;
        const self = this;

        const body = `
            <div class="ionc-dialog-info">
                Sensor: <strong>${escapeHtml(sensor.name)}</strong> (ID: ${sensorId})<br>
                Current value: <strong>${sensor.value}</strong>
            </div>
            <div class="ionc-dialog-field">
                <label for="ionc-freeze-value">Freeze value:</label>
                <input type="number" id="ionc-freeze-value" value="${sensor.value}">
                <div class="ionc-dialog-hint">Double click on ❄ — quick freeze at current value</div>
            </div>
        `;

        const footer = `
            <button class="ionc-dialog-btn ionc-dialog-btn-cancel" onclick="closeIoncDialog()">Cancel</button>
            <button class="ionc-dialog-btn ionc-dialog-btn-freeze" id="ionc-freeze-confirm">❄ Freeze</button>
        `;

        const doFreeze = async () => {
            const input = document.getElementById('ionc-freeze-value');
            const value = parseInt(input.value, 10);

            if (isNaN(value)) {
                showIoncDialogError('Enter an integer');
                input.classList.add('error');
                return;
            }

            try {
                const url = self.buildUrl(`/api/objects/${encodeURIComponent(objectName)}/ionc/freeze`);
                const response = await controlledFetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sensor_id: sensorId, value: value })
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Failed to freeze');
                }

                // Локальное обновление для мгновенной обратной связи
                // SSE обновления подтвердят состояние из API
                sensor.real_value = sensor.value;
                sensor.frozen = true;
                sensor.value = value;
                self.reRenderSensorRow(sensorId);
                closeIoncDialog();
            } catch (err) {
                showIoncDialogError(`Error: ${err.message}`);
            }
        };

        openIoncDialog({
            title: 'Freeze sensor',
            body,
            footer,
            focusInput: true,
            onConfirm: doFreeze
        });

        document.getElementById('ionc-freeze-confirm').addEventListener('click', doFreeze);
    }

    // Быстрая заморозка на текущем значении (двойной клик на ❄)
    async quickFreeze(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        try {
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/freeze`);
            const response = await controlledFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sensor_id: sensorId, value: sensor.value })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to freeze');
            }

            // Локальное обновление для мгновенной обратной связи
            sensor.real_value = sensor.value;
            sensor.frozen = true;
            this.reRenderSensorRow(sensorId);
        } catch (err) {
            showIoncDialogError(`Error: ${err.message}`);
        }
    }

    // Показать диалог разморозки (клик на 🔥)
    showUnfreezeDialog(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        const objectName = this.objectName;
        const self = this;

        const realValue = sensor.real_value !== undefined ? sensor.real_value : '—';
        const frozenValue = sensor.value;

        const body = `
            <div class="ionc-dialog-info">
                Sensor: <strong>${escapeHtml(sensor.name)}</strong> (ID: ${sensorId})
            </div>
            <div class="ionc-unfreeze-values">
                <div class="ionc-unfreeze-row">
                    <span class="ionc-unfreeze-label">Real value (SM):</span>
                    <span class="ionc-unfreeze-value">${realValue}</span>
                </div>
                <div class="ionc-unfreeze-row">
                    <span class="ionc-unfreeze-label">Frozen value:</span>
                    <span class="ionc-unfreeze-value ionc-unfreeze-frozen">${frozenValue}❄</span>
                </div>
            </div>
            <div class="ionc-dialog-hint">After unfreezing, the sensor will return to its real value</div>
        `;

        const footer = `
            <button class="ionc-dialog-btn ionc-dialog-btn-cancel" onclick="closeIoncDialog()">Cancel</button>
            <button class="ionc-dialog-btn ionc-dialog-btn-unfreeze" id="ionc-unfreeze-confirm">🔥 Unfreeze</button>
        `;

        const doUnfreeze = async () => {
            try {
                const url = self.buildUrl(`/api/objects/${encodeURIComponent(objectName)}/ionc/unfreeze`);
                const response = await controlledFetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sensor_id: sensorId })
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Failed to unfreeze');
                }

                // Локальное обновление для мгновенной обратной связи
                sensor.frozen = false;
                if (sensor.real_value !== undefined) {
                    sensor.value = sensor.real_value;
                }
                self.reRenderSensorRow(sensorId);
                closeIoncDialog();
            } catch (err) {
                showIoncDialogError(`Error: ${err.message}`);
            }
        };

        openIoncDialog({
            title: 'Unfreeze sensor',
            body,
            footer,
            focusInput: false,
            onConfirm: doUnfreeze
        });

        document.getElementById('ionc-unfreeze-confirm').addEventListener('click', doUnfreeze);
    }

    // Быстрая разморозка (двойной клик на 🔥)
    async quickUnfreeze(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        try {
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/unfreeze`);
            const response = await controlledFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sensor_id: sensorId })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to unfreeze');
            }

            // Локальное обновление для мгновенной обратной связи
            sensor.frozen = false;
            if (sensor.real_value !== undefined) {
                sensor.value = sensor.real_value;
            }
            this.reRenderSensorRow(sensorId);
        } catch (err) {
            showIoncDialogError(`Error: ${err.message}`);
        }
    }

    // ===== Генератор значений =====

    // Значения по умолчанию для параметров генератора
    getDefaultGeneratorParams() {
        return {
            sin: { min: -50, max: 50, pause: 100, step: 100 },
            cos: { min: -50, max: 50, pause: 100, step: 100 },
            linear: { min: 0, max: 100, pause: 100, step: 1 },
            random: { min: 0, max: 100, period: 5000 },
            square: { min: 0, max: 100, pulseWidth: 2000, pause: 2000 }
        };
    }

    // Загрузка preferences из localStorage с миграцией
    loadGeneratorPreferences() {
        const newPrefs = localStorage.getItem('ionc-gen-preferences');

        if (newPrefs) {
            try {
                return JSON.parse(newPrefs);
            } catch (e) {
                console.error('Failed to parse generator preferences:', e);
            }
        }

        // Миграция со старого формата
        const oldType = localStorage.getItem('ionc-gen-last-type');
        if (oldType) {
            const prefs = {
                lastType: oldType,
                params: this.getDefaultGeneratorParams()
            };
            localStorage.setItem('ionc-gen-preferences', JSON.stringify(prefs));
            localStorage.removeItem('ionc-gen-last-type');
            return prefs;
        }

        // Первый запуск - используем defaults
        return {
            lastType: 'sin',
            params: this.getDefaultGeneratorParams()
        };
    }

    // Сохранение preferences в localStorage
    saveGeneratorPreferences(type, params) {
        const prefs = this.loadGeneratorPreferences();
        prefs.lastType = type;
        prefs.params[type] = params;
        localStorage.setItem('ionc-gen-preferences', JSON.stringify(prefs));
    }

    // Обновление расчётного периода для sin/cos
    updateCalculatedPeriod() {
        const calcPeriodValue = document.getElementById('ionc-gen-calc-period-value');
        const pauseInput = document.getElementById('ionc-gen-period');
        const pointsInput = document.getElementById('ionc-gen-step');

        if (!calcPeriodValue || !pauseInput || !pointsInput) return;

        const pause = parseInt(pauseInput.value, 10) || 0;
        const points = parseInt(pointsInput.value, 10) || 0;
        const totalPeriod = pause * points;

        if (totalPeriod > 0) {
            const seconds = (totalPeriod / 1000).toFixed(1);
            calcPeriodValue.textContent = `${totalPeriod} мс (${seconds} сек)`;
        } else {
            calcPeriodValue.textContent = '-';
        }
    }

    // Управление видимостью полей формы в зависимости от типа функции
    updateFormFieldsVisibility(type) {
        const periodField = document.getElementById('ionc-gen-period-field');
        const stepField = document.getElementById('ionc-gen-step-field');
        const pulseFields = document.getElementById('ionc-gen-pulse-fields');
        const calcPeriodField = document.getElementById('ionc-gen-calc-period');
        const periodLabel = document.getElementById('ionc-gen-period-label');
        const periodHint = document.getElementById('ionc-gen-period-hint');
        const stepLabel = document.getElementById('ionc-gen-step-label');
        const stepHint = document.getElementById('ionc-gen-step-hint');

        if (!periodField || !stepField || !pulseFields) return;

        // Скрываем все условные поля
        periodField.style.display = 'none';
        stepField.style.display = 'none';
        pulseFields.style.display = 'none';
        if (calcPeriodField) calcPeriodField.style.display = 'none';

        // Показываем нужные поля в зависимости от типа
        if (type === 'linear') {
            // linear: пилообразный с шагом-инкрементом
            periodField.style.display = 'block';
            stepField.style.display = 'block';
            if (periodLabel) periodLabel.textContent = 'Пауза между шагами (мс)';
            if (periodHint) periodHint.textContent = 'Задержка перед следующим шагом. Мин: 10мс';
            if (stepLabel) stepLabel.textContent = 'Шаг';
            if (stepHint) stepHint.textContent = 'Размер одного шага изменения значения';
        } else if (type === 'sin' || type === 'cos') {
            // sin/cos: синусоида с заданным количеством точек
            periodField.style.display = 'block';
            stepField.style.display = 'block';
            if (calcPeriodField) calcPeriodField.style.display = 'block';
            if (periodLabel) periodLabel.textContent = 'Шаг обновления (мс)';
            if (periodHint) periodHint.textContent = 'Время между обновлениями значения. Мин: 10мс';
            if (stepLabel) stepLabel.textContent = 'Количество точек на период';
            if (stepHint) stepHint.textContent = 'Сколько точек отрисует синусоида за один полный период';
            // Обновляем расчётный период
            this.updateCalculatedPeriod();
        } else if (type === 'square') {
            pulseFields.style.display = 'block';
        } else {
            // random
            periodField.style.display = 'block';
            // Восстанавливаем подпись для периода
            if (periodLabel) periodLabel.textContent = 'Период (мс)';
            if (periodHint) periodHint.textContent = 'Длительность полного цикла. Мин: 100мс';
        }
    }

    showGeneratorDialog(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        const self = this;
        const existingGen = this.activeGenerators.get(sensorId);

        // Предупреждение если датчик заморожен
        const frozenWarning = sensor.frozen
            ? `<div class="ionc-dialog-warning">Датчик заморожен. Значения будут записываться в SM, но не отобразятся до разморозки.</div>`
            : '';

        const body = `
            <div class="ionc-dialog-info">
                Датчик: <strong>${escapeHtml(sensor.name)}</strong> (ID: ${sensorId})<br>
                Текущее значение: <strong>${sensor.value}</strong>
            </div>
            ${frozenWarning}
            ${existingGen ? (() => {
                const genInfo = `${existingGen.type} (min: ${existingGen.min}, max: ${existingGen.max}`;
                const timing = existingGen.type === 'square'
                    ? `, импульс: ${existingGen.pulseWidth}мс, пауза: ${existingGen.pause}мс)`
                    : (existingGen.type === 'linear' || existingGen.type === 'sin' || existingGen.type === 'cos')
                    ? `, пауза: ${existingGen.pause}мс, шаг: ${existingGen.step})`
                    : `, период: ${existingGen.period}мс)`;

                return `
                <div class="ionc-dialog-warning ionc-dialog-warning-active">
                    <strong>Генератор активен:</strong> ${genInfo}${timing}
                </div>
            `;
            })() : (() => {
                // Загружаем preferences из localStorage
                const prefs = this.loadGeneratorPreferences();
                const lastType = prefs.lastType;
                const params = prefs.params[lastType] || this.getDefaultGeneratorParams()[lastType];

                const options = [
                    { value: 'sin', label: 'sin(t) - Синусоида' },
                    { value: 'cos', label: 'cos(t) - Косинусоида' },
                    { value: 'linear', label: 'linear - Пилообразный' },
                    { value: 'random', label: 'random - Случайные значения' },
                    { value: 'square', label: 'square - Прямоугольный' }
                ];
                const optionsHtml = options.map(o =>
                    `<option value="${o.value}"${o.value === lastType ? ' selected' : ''}>${o.label}</option>`
                ).join('');
                return `
                <div class="ionc-dialog-field">
                    <label for="ionc-gen-type">Тип функции:</label>
                    <select id="ionc-gen-type" class="ionc-dialog-select">
                        ${optionsHtml}
                    </select>
                </div>
                <div class="ionc-dialog-field-row">
                    <div class="ionc-dialog-field ionc-dialog-field-half">
                        <label for="ionc-gen-min">Min:</label>
                        <input type="number" id="ionc-gen-min" value="${params.min}">
                    </div>
                    <div class="ionc-dialog-field ionc-dialog-field-half">
                        <label for="ionc-gen-max">Max:</label>
                        <input type="number" id="ionc-gen-max" value="${params.max}">
                    </div>
                </div>
                <div class="ionc-dialog-field" id="ionc-gen-period-field">
                    <label for="ionc-gen-period"><span id="ionc-gen-period-label">Период (мс)</span>:</label>
                    <input type="number" id="ionc-gen-period" value="${params.period || params.pause || 5000}" step="100">
                    <div class="ionc-dialog-hint" id="ionc-gen-period-hint">Длительность полного цикла. Мин: 100мс</div>
                </div>
                <div class="ionc-dialog-field" id="ionc-gen-step-field" style="display: none;">
                    <label for="ionc-gen-step"><span id="ionc-gen-step-label">Шаг</span>:</label>
                    <input type="number" id="ionc-gen-step" value="${params.step || 20}" step="1" min="1">
                    <div class="ionc-dialog-hint" id="ionc-gen-step-hint">Размер одного шага изменения значения</div>
                </div>
                <div class="ionc-dialog-field" id="ionc-gen-calc-period" style="display: none;">
                    <div class="ionc-dialog-hint" style="color: #4a9eff; font-weight: 500;">
                        💡 Полный период: <span id="ionc-gen-calc-period-value">-</span>
                    </div>
                </div>
                <div id="ionc-gen-pulse-fields" style="display: none;">
                    <div class="ionc-dialog-field-row">
                        <div class="ionc-dialog-field ionc-dialog-field-half">
                            <label for="ionc-gen-pulse-width">Ширина импульса (мс):</label>
                            <input type="number" id="ionc-gen-pulse-width" value="${params.pulseWidth || 2500}" step="100" min="1">
                        </div>
                        <div class="ionc-dialog-field ionc-dialog-field-half">
                            <label for="ionc-gen-pause">Пауза (мс):</label>
                            <input type="number" id="ionc-gen-pause" value="${params.pause || 2500}" step="100" min="1">
                        </div>
                    </div>
                    <div class="ionc-dialog-hint">Период = Ширина импульса + Пауза</div>
                </div>
            `;
            })()}
        `;

        const footer = existingGen ? `
            <button class="ionc-dialog-btn ionc-dialog-btn-cancel" onclick="closeIoncDialog()">Закрыть</button>
            <button class="ionc-dialog-btn ionc-dialog-btn-danger" id="ionc-gen-stop">Остановить</button>
        ` : `
            <button class="ionc-dialog-btn ionc-dialog-btn-cancel" onclick="closeIoncDialog()">Отмена</button>
            <button class="ionc-dialog-btn ionc-dialog-btn-primary" id="ionc-gen-start">Запустить</button>
        `;

        openIoncDialog({
            title: existingGen ? 'Генератор активен' : 'Генератор значений',
            body,
            footer,
            focusInput: !existingGen
        });

        // Обработчики кнопок
        if (existingGen) {
            document.getElementById('ionc-gen-stop')?.addEventListener('click', () => {
                this.stopGenerator(sensorId);
                closeIoncDialog();
            });
        } else {
            document.getElementById('ionc-gen-start')?.addEventListener('click', () => {
                this.startGenerator(sensorId);
            });

            // Обработчик смены типа функции
            const typeSelect = document.getElementById('ionc-gen-type');
            if (typeSelect) {
                typeSelect.addEventListener('change', (e) => {
                    this.updateFormFieldsVisibility(e.target.value);
                });

                // Устанавливаем начальную видимость полей
                this.updateFormFieldsVisibility(typeSelect.value);
            }

            // Обработчики для автоматического расчёта периода (sin/cos)
            const pauseInput = document.getElementById('ionc-gen-period');
            const pointsInput = document.getElementById('ionc-gen-step');
            if (pauseInput && pointsInput) {
                const updateCalc = () => this.updateCalculatedPeriod();
                pauseInput.addEventListener('input', updateCalc);
                pointsInput.addEventListener('input', updateCalc);
            }
        }
    }

    startGenerator(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        // Парсим значения формы
        const type = document.getElementById('ionc-gen-type').value;
        const min = parseInt(document.getElementById('ionc-gen-min').value, 10);
        const max = parseInt(document.getElementById('ionc-gen-max').value, 10);

        // Парсим специфичные для типа параметры
        let period, step, pulseWidth, pause;
        if (type === 'linear' || type === 'sin' || type === 'cos') {
            pause = parseInt(document.getElementById('ionc-gen-period').value, 10);
            step = parseInt(document.getElementById('ionc-gen-step').value, 10);
        } else if (type === 'square') {
            pulseWidth = parseInt(document.getElementById('ionc-gen-pulse-width').value, 10);
            pause = parseInt(document.getElementById('ionc-gen-pause').value, 10);
        } else {
            // random
            period = parseInt(document.getElementById('ionc-gen-period').value, 10);
        }

        // Валидация общих параметров
        if (isNaN(min) || isNaN(max)) {
            showIoncDialogError('Min и Max должны быть числами');
            return;
        }
        if (min >= max) {
            showIoncDialogError('Min должен быть меньше Max');
            return;
        }

        // Валидация специфичных для типа параметров
        if (type === 'linear') {
            if (isNaN(pause) || isNaN(step)) {
                showIoncDialogError('Пауза и Шаг должны быть числами');
                return;
            }
            if (pause < 10) {
                showIoncDialogError('Пауза должна быть не менее 10мс');
                return;
            }
            if (step <= 0) {
                showIoncDialogError('Шаг должен быть больше 0');
                return;
            }
            if (step > (max - min)) {
                showIoncDialogError('Шаг должен быть меньше или равен разности Max - Min');
                return;
            }
        } else if (type === 'sin' || type === 'cos') {
            if (isNaN(pause) || isNaN(step)) {
                showIoncDialogError('Шаг обновления и Количество точек должны быть числами');
                return;
            }
            if (pause < 10) {
                showIoncDialogError('Шаг обновления должен быть не менее 10мс');
                return;
            }
            if (step < 4) {
                showIoncDialogError('Количество точек должно быть не менее 4');
                return;
            }
        } else if (type === 'square') {
            if (isNaN(pulseWidth) || isNaN(pause)) {
                showIoncDialogError('Ширина импульса и Пауза должны быть числами');
                return;
            }
            if (pulseWidth <= 0) {
                showIoncDialogError('Ширина импульса должна быть больше 0');
                return;
            }
            if (pause <= 0) {
                showIoncDialogError('Пауза должна быть больше 0');
                return;
            }
        } else {
            // sin, cos, random
            if (isNaN(period)) {
                showIoncDialogError('Период должен быть числом');
                return;
            }
            if (period < 100) {
                showIoncDialogError('Период должен быть не менее 100мс');
                return;
            }
        }

        // Останавливаем существующий генератор если есть
        this.stopGenerator(sensorId);

        const startTime = Date.now();
        const self = this;
        const objectName = this.objectName;

        // Интервал обновления: ~20 обновлений за период для плавности
        let updateInterval;
        if (type === 'square') {
            updateInterval = Math.max(50, Math.floor((pulseWidth + pause) / 20));
        } else if (type === 'linear' || type === 'sin' || type === 'cos') {
            // Для linear/sin/cos: обновляем с частотой паузы (или чаще для плавности)
            updateInterval = Math.min(pause, 50);
        } else {
            // random
            updateInterval = Math.max(50, Math.floor(period / 20));
        }

        // Состояние генератора (разные поля для разных типов)
        const genState = {
            sensorId,
            type,
            min,
            max,
            startTime,
            intervalId: null
        };

        // Добавляем специфичные для типа параметры
        if (type === 'linear' || type === 'sin' || type === 'cos') {
            genState.pause = pause;
            genState.step = step;
        } else if (type === 'square') {
            genState.pulseWidth = pulseWidth;
            genState.pause = pause;
        } else {
            // random
            genState.period = period;
        }

        // Функция генерации значения
        const generateValue = () => {
            const elapsed = Date.now() - genState.startTime;
            let value;
            const range = max - min;

            switch (type) {
                case 'sin':
                case 'cos': {
                    // Синусоида/косинусоида с заданным количеством точек
                    // genState.step = количество точек на период
                    // genState.pause = шаг обновления (мс)
                    const numPoints = genState.step;
                    const fullCycle = numPoints * genState.pause;
                    const positionInCycle = elapsed % fullCycle;
                    const pointIndex = Math.floor(positionInCycle / genState.pause);

                    // Фаза от 0 до 2π
                    const phase = (pointIndex / numPoints) * 2 * Math.PI;

                    // Синус/косинус от -1 до 1
                    const wave = type === 'sin' ? Math.sin(phase) : Math.cos(phase);

                    // Масштабируем к диапазону min..max
                    value = Math.round(min + (wave + 1) / 2 * range);
                    break;
                }
                case 'linear': {
                    // Пилообразный с шагом-инкрементом и паузой (как в SImitator)
                    // Вверх: min, min+step, min+2*step, ..., max (numStepsUp значений)
                    // Вниз: max-step, max-2*step, ..., min+step (numStepsDown значений, БЕЗ min)
                    // После нисходящей фазы цикл начинается снова с min
                    const numStepsUp = Math.floor(range / genState.step) + 1;
                    const numStepsDown = Math.floor(range / genState.step) - 1;
                    const totalSteps = numStepsUp + numStepsDown;
                    const fullCycle = totalSteps * genState.pause;
                    const positionInCycle = elapsed % fullCycle;
                    const stepNumber = Math.floor(positionInCycle / genState.pause);

                    if (stepNumber < numStepsUp) {
                        // Вверх: min -> max
                        value = min + stepNumber * genState.step;
                    } else {
                        // Вниз: max-step -> min+step (НЕ включая min)
                        const downStepNumber = stepNumber - numStepsUp;
                        value = max - (downStepNumber + 1) * genState.step;
                    }
                    break;
                }
                case 'random': {
                    value = Math.round(min + Math.random() * range);
                    break;
                }
                case 'square': {
                    // Прямоугольный с настраиваемой скважностью
                    const totalPeriod = genState.pulseWidth + genState.pause;
                    const positionInCycle = elapsed % totalPeriod;
                    value = positionInCycle < genState.pulseWidth ? max : min;
                    break;
                }
                default:
                    value = min;
            }

            // Ограничиваем значение
            value = Math.max(min, Math.min(max, value));

            // Отправляем в API
            self.setValueForGenerator(sensorId, value);
        };

        // Запускаем интервал
        genState.intervalId = setInterval(generateValue, updateInterval);

        // Сохраняем состояние генератора
        this.activeGenerators.set(sensorId, genState);

        // Для square генератора включаем stepped режим на графике (меандр)
        if (type === 'square') {
            this.setChartStepped(sensorId, true);
        }

        // Перерисовываем строку для отображения индикатора
        this.reRenderSensorRow(sensorId);

        // Запускаем сразу
        generateValue();

        // Сохраняем preferences (разные параметры для разных типов)
        let params = { min, max };
        if (type === 'linear' || type === 'sin' || type === 'cos') {
            params.pause = pause;
            params.step = step;
        } else if (type === 'square') {
            params.pulseWidth = pulseWidth;
            params.pause = pause;
        } else {
            // random
            params.period = period;
        }
        this.saveGeneratorPreferences(type, params);

        closeIoncDialog();
    }

    async setValueForGenerator(sensorId, value) {
        try {
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/set`);
            await controlledFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sensor_id: sensorId, value: value })
            });
        } catch (err) {
            console.error('Generator: ошибка установки значения', err);
        }
    }

    stopGenerator(sensorId) {
        const genState = this.activeGenerators.get(sensorId);
        if (genState) {
            clearInterval(genState.intervalId);

            // Возвращаем stepped режим к значению по умолчанию (isDiscrete)
            if (genState.type === 'square') {
                this.setChartStepped(sensorId, null); // null = вернуть к isDiscrete
            }

            this.activeGenerators.delete(sensorId);
            this.reRenderSensorRow(sensorId);
        }
    }

    stopAllGenerators() {
        this.activeGenerators.forEach((genState, sensorId) => {
            clearInterval(genState.intervalId);
        });
        this.activeGenerators.clear();
    }

    // Установка stepped режима для графика сенсора
    // stepped: true = включить, false = выключить, null = вернуть к isDiscrete
    setChartStepped(sensorId, stepped) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        const tabState = state.tabs.get(this.tabKey);
        if (!tabState) return;

        const varName = `io:${sensor.name}`;
        const chartData = tabState.charts.get(varName);
        if (!chartData) return;

        let newStepped;
        if (stepped === null) {
            // Вернуть к значению по умолчанию (isDiscrete)
            newStepped = chartData.isDiscrete ? 'before' : false;
        } else {
            newStepped = stepped ? 'before' : false;
        }

        chartData.chart.data.datasets[0].stepped = newStepped;
        chartData.chart.update('none');
    }

    // Перерисовка строки датчика и переподключение обработчиков
    reRenderSensorRow(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        const row = document.querySelector(`tr[data-sensor-id="${sensorId}"]`);
        if (row) {
            row.outerHTML = this.renderSensorRow(sensor);
            this.attachRowEventListeners(sensorId);
        }
    }

    // Подключение обработчиков к строке датчика
    attachRowEventListeners(sensorId) {
        const row = document.querySelector(`tr[data-sensor-id="${sensorId}"]`);
        if (!row) return;

        row.querySelector('.ionc-btn-set')?.addEventListener('click', () => this.showSetDialog(sensorId));
        row.querySelector('.ionc-btn-consumers')?.addEventListener('click', () => this.showConsumersDialog(sensorId));

        // Кнопка заморозки — одинарный/двойной клик
        const freezeBtn = row.querySelector('.ionc-btn-freeze');
        if (freezeBtn) {
            let clickTimer = null;
            freezeBtn.addEventListener('click', (e) => {
                if (clickTimer) {
                    // Двойной клик — быстрая заморозка
                    clearTimeout(clickTimer);
                    clickTimer = null;
                    this.quickFreeze(sensorId);
                } else {
                    // Одинарный клик — ждём второй клик или открываем диалог
                    clickTimer = setTimeout(() => {
                        clickTimer = null;
                        this.showFreezeDialog(sensorId);
                    }, 250);
                }
            });
        }

        // Кнопка разморозки — одинарный/двойной клик
        const unfreezeBtn = row.querySelector('.ionc-btn-unfreeze');
        if (unfreezeBtn) {
            let clickTimer = null;
            unfreezeBtn.addEventListener('click', (e) => {
                if (clickTimer) {
                    // Двойной клик — быстрая разморозка
                    clearTimeout(clickTimer);
                    clickTimer = null;
                    this.quickUnfreeze(sensorId);
                } else {
                    // Одинарный клик — ждём второй клик или открываем диалог
                    clickTimer = setTimeout(() => {
                        clickTimer = null;
                        this.showUnfreezeDialog(sensorId);
                    }, 250);
                }
            });
        }

        // Кнопки генератора
        row.querySelector('.ionc-btn-gen')?.addEventListener('click', () => this.showGeneratorDialog(sensorId));
        row.querySelector('.ionc-btn-gen-stop')?.addEventListener('click', () => this.stopGenerator(sensorId));

        // Чекбокс графика
        row.querySelector('.ionc-chart-checkbox')?.addEventListener('change', () => this.toggleSensorChartById(sensorId));
    }

    async showConsumersDialog(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        // Показываем диалог с индикатором загрузки
        const loadingBody = `
            <div class="ionc-dialog-info">
                Sensor: <strong>${escapeHtml(sensor.name)}</strong> (ID: ${sensorId})
            </div>
            <div class="ionc-dialog-empty">Loading подписчиков...</div>
        `;

        const footer = `
            <button class="ionc-dialog-btn ionc-dialog-btn-cancel" onclick="closeIoncDialog()">Close</button>
        `;

        openIoncDialog({
            title: 'Sensor consumers',
            body: loadingBody,
            footer,
            focusInput: false
        });

        try {
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/consumers?sensors=${sensorId}`);
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to load consumers');

            const data = await response.json();
            const sensorData = data.sensors?.[0];
            const consumers = sensorData?.consumers || [];

            let contentHtml;
            if (consumers.length === 0) {
                contentHtml = `
                    <div class="ionc-dialog-info">
                        Sensor: <strong>${escapeHtml(sensor.name)}</strong> (ID: ${sensorId})
                    </div>
                    <div class="ionc-dialog-empty">No consumers</div>
                `;
            } else {
                const rows = consumers.map(c => `
                    <tr>
                        <td>${c.id}</td>
                        <td>${escapeHtml(c.name)}</td>
                        <td>${escapeHtml(c.node || '')}</td>
                    </tr>
                `).join('');

                contentHtml = `
                    <div class="ionc-dialog-info">
                        Sensor: <strong>${escapeHtml(sensor.name)}</strong> (ID: ${sensorId})<br>
                        Подписчиков: <strong>${consumers.length}</strong>
                    </div>
                    <div class="ionc-dialog-consumers">
                        <table>
                            <thead>
                                <tr>
                                    <th style="width: 60px">ID</th>
                                    <th>Name</th>
                                    <th style="width: 80px">Узел</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                `;
            }

            document.getElementById('ionc-dialog-body').innerHTML = contentHtml;
        } catch (err) {
            showIoncDialogError(`Error: ${err.message}`);
        }
    }

    async loadLostConsumers() {
        try {
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/lost`);
            const response = await fetch(url);
            if (!response.ok) return;

            const data = await response.json();
            const lost = data['lost consumers'] || [];

            const listEl = document.getElementById(`ionc-lost-list-${this.objectName}`);
            const countEl = document.getElementById(`ionc-lost-count-${this.objectName}`);

            if (countEl) countEl.textContent = lost.length;

            if (listEl) {
                if (lost.length === 0) {
                    listEl.innerHTML = '<span class="ionc-lost-empty">No lost consumers</span>';
                } else {
                    listEl.innerHTML = lost.map(c =>
                        `<div class="ionc-lost-item">${escapeHtml(c.name)} (ID: ${c.id})</div>`
                    ).join('');
                }
            }
        } catch (err) {
            console.error('Error loading lost consumers:', err);
        }
    }

    update(data) {
        // При обновлении объекта обновляем информацию
        renderObjectInfo(this.tabKey, data.object);
        this.handleLogServer(data.LogServer);
    }

    // Обработка SSE обновления датчика (батчевая версия)
    handleIONCSensorUpdate(sensor) {
        // Обновляем в sensorMap
        if (this.sensorMap.has(sensor.id)) {
            const oldSensor = this.sensorMap.get(sensor.id);

            // API возвращает всю информацию:
            // - frozen: флаг заморозки
            // - value: замороженное значение (если frozen) или текущее (если нет)
            // - real_value: реальное значение SM
            Object.assign(oldSensor, sensor);

            // Добавляем в очередь на рендеринг
            this.pendingUpdates.set(sensor.id, oldSensor);
        }

        // Планируем батчевый рендеринг
        if (!this.renderScheduled) {
            this.renderScheduled = true;
            requestAnimationFrame(() => this.batchRenderUpdates());
        }
    }

    // Батчевый рендеринг обновлений DOM
    batchRenderUpdates() {
        this.renderScheduled = false;

        if (this.pendingUpdates.size === 0) return;

        // Обновляем DOM для всех ожидающих датчиков
        for (const [id, sensor] of this.pendingUpdates) {
            // Обновляем значение с учётом формата frozen
            const valueEl = document.getElementById(`ionc-value-${this.objectName}-${id}`);
            if (valueEl) {
                // Рендерим правильный формат в зависимости от состояния frozen
                if (sensor.frozen && sensor.real_value !== undefined && sensor.real_value !== sensor.value) {
                    // Формат: real_value → frozen_value❄
                    valueEl.className = 'ionc-value ionc-value-frozen ionc-value-updated';
                    valueEl.innerHTML = `
                        <span class="ionc-real-value">${sensor.real_value}</span>
                        <span class="ionc-frozen-arrow">→</span>
                        <span class="ionc-frozen-value">${sensor.value}❄</span>
                    `;
                } else {
                    // Обычный формат
                    valueEl.className = 'ionc-value ionc-value-updated';
                    valueEl.textContent = sensor.value;
                }
            }

            // Обновляем флаги если изменились
            const row = document.querySelector(`tr[data-sensor-id="${id}"]`);
            if (row) {
                row.classList.toggle('ionc-sensor-frozen', sensor.frozen);
                row.classList.toggle('ionc-sensor-blocked', sensor.blocked);
            }

            // Обновляем supplier если изменился
            const supplierEl = getElementInTab(this.tabKey, `ionc-supplier-${this.objectName}-${id}`);
            if (supplierEl) {
                const supplierValue = sensor.supplier || (sensor.supplier_id ? String(sensor.supplier_id) : '');
                supplierEl.textContent = supplierValue;
                supplierEl.title = supplierValue;
            }
        }

        // Очищаем очередь
        this.pendingUpdates.clear();

        // Убираем анимацию через 500ms
        setTimeout(() => {
            const updatedEls = document.querySelectorAll('.ionc-value-updated');
            updatedEls.forEach(el => el.classList.remove('ionc-value-updated'));
        }, 500);
    }

    // Подписка на SSE обновления для видимых датчиков (использует SSESubscriptionMixin)
    async subscribeToSSE() {
        const sensorIds = this.sensors.map(s => s.id);
        await this.subscribeToSSEFor('/ionc', sensorIds, 'sensor_ids', 'IONC');
    }

    // Отписка от SSE обновлений (использует SSESubscriptionMixin)
    async unsubscribeFromSSE() {
        await this.unsubscribeFromSSEFor('/ionc', 'sensor_ids', 'IONC');
    }

    destroy() {
        // Останавливаем все генераторы значений
        this.stopAllGenerators();
        // Отписываемся от SSE обновлений при закрытии
        this.unsubscribeFromSSE();
        // Уничтожаем LogViewer
        this.destroyLogViewer();
    }
}

// Apply mixins to IONotifyControllerRenderer
applyMixin(IONotifyControllerRenderer, VirtualScrollMixin);
applyMixin(IONotifyControllerRenderer, SSESubscriptionMixin);
applyMixin(IONotifyControllerRenderer, ResizableSectionMixin);
applyMixin(IONotifyControllerRenderer, FilterMixin);
applyMixin(IONotifyControllerRenderer, ItemCounterMixin);
applyMixin(IONotifyControllerRenderer, SectionHeightMixin);

