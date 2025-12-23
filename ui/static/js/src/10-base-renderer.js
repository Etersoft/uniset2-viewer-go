// ============================================================================
// Система рендереров для разных типов объектов
// ============================================================================

// Реестр рендереров по типу объекта
const objectRenderers = new Map();

// ============================================================================
// Миксины для переиспользования общей функциональности
// ============================================================================

/**
 * Миксин для виртуального скролла с infinite loading
 * Требует: viewportId, itemsArray, rowHeight, loadMoreFn, renderFn
 */
const VirtualScrollMixin = {
    // Инициализация свойств виртуального скролла
    initVirtualScrollProps() {
        this.rowHeight = 32;
        this.bufferRows = 10;
        this.startIndex = 0;
        this.endIndex = 0;
        this.chunkSize = 200;
        this.hasMore = true;
        this.isLoadingChunk = false;
    },

    // Настройка обработчика скролла
    setupVirtualScrollFor(viewportId) {
        const viewport = document.getElementById(viewportId);
        if (!viewport) return;

        let ticking = false;
        viewport.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    this.updateVisibleRowsFor(viewportId);
                    this.checkInfiniteScrollFor(viewport);
                    ticking = false;
                });
                ticking = true;
            }
        });
    },

    // Обновление видимых строк
    updateVisibleRowsFor(viewportId) {
        const viewport = document.getElementById(viewportId);
        if (!viewport) return;

        const scrollTop = viewport.scrollTop;
        const viewportHeight = viewport.clientHeight;
        const items = this.getVirtualScrollItems();
        const totalRows = items.length;
        const visibleRows = Math.ceil(viewportHeight / this.rowHeight);

        this.startIndex = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.bufferRows);
        this.endIndex = Math.min(totalRows, this.startIndex + visibleRows + 2 * this.bufferRows);

        this.renderVisibleItems();
    },

    // Проверка необходимости подгрузки
    checkInfiniteScrollFor(viewport) {
        if (this.isLoadingChunk || !this.hasMore) return;

        const scrollBottom = viewport.scrollTop + viewport.clientHeight;
        const items = this.getVirtualScrollItems();
        const totalHeight = items.length * this.rowHeight;
        const threshold = 200;

        if (totalHeight - scrollBottom < threshold) {
            this.loadMoreItems();
        }
    },

    // Показать/скрыть индикатор загрузки
    showLoadingIndicatorFor(elementId, show) {
        const el = document.getElementById(elementId);
        if (el) el.style.display = show ? 'block' : 'none';
    },

    // Получить видимый срез данных
    getVisibleSlice() {
        const items = this.getVirtualScrollItems();
        return items.slice(this.startIndex, this.endIndex);
    }
};

/**
 * Миксин для SSE подписок на обновления датчиков/регистров
 * Требует: objectName, apiPath, idField
 */
const SSESubscriptionMixin = {
    // Инициализация свойств SSE
    initSSEProps() {
        this.subscribedSensorIds = new Set();
        this.pendingUpdates = [];
        this.renderScheduled = false;
    },

    // Подписка на SSE обновления
    // apiPath - путь API (например '/ionc', '/opcua', '/modbus')
    // ids - массив ID для подписки
    // idField - имя поля в теле запроса (например 'sensor_ids', 'register_ids')
    // logPrefix - префикс для логов
    // extraBody - дополнительные поля для тела запроса (опционально)
    async subscribeToSSEFor(apiPath, ids, idField = 'sensor_ids', logPrefix = 'SSE', extraBody = {}) {
        if (!ids || ids.length === 0) return;

        // Пропускаем если уже подписаны на те же ID
        const newIds = new Set(ids);
        if (this.subscribedSensorIds.size === newIds.size &&
            [...newIds].every(id => this.subscribedSensorIds.has(id))) {
            return;
        }

        try {
            await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}${apiPath}/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [idField]: ids, ...extraBody })
            });

            this.subscribedSensorIds = newIds;
            console.log(`${logPrefix}: подписка на ${ids.length} элементов для ${this.objectName}`);
        } catch (err) {
            console.warn(`${logPrefix}: ошибка подписки:`, err);
        }
    },

    // Отписка от SSE обновлений
    async unsubscribeFromSSEFor(apiPath, idField = 'sensor_ids', logPrefix = 'SSE') {
        if (this.subscribedSensorIds.size === 0) return;

        try {
            const ids = [...this.subscribedSensorIds];
            await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}${apiPath}/unsubscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [idField]: ids })
            });

            console.log(`${logPrefix}: отписка от ${ids.length} элементов для ${this.objectName}`);
            this.subscribedSensorIds.clear();
        } catch (err) {
            console.warn(`${logPrefix}: ошибка отписки:`, err);
        }
    },

    // Планирование батчевого рендера обновлений
    scheduleBatchRender(renderFn) {
        if (this.renderScheduled) return;
        this.renderScheduled = true;

        requestAnimationFrame(() => {
            if (this.pendingUpdates.length > 0) {
                renderFn(this.pendingUpdates);
                this.pendingUpdates = [];
            }
            this.renderScheduled = false;
        });
    }
};

/**
 * Миксин для изменяемых по высоте секций с сохранением в localStorage
 */
const ResizableSectionMixin = {
    // Loading сохранённой высоты
    loadSectionHeight(storageKey, defaultHeight = 320) {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
            const value = saved[this.objectName];
            if (typeof value === 'number' && value > 0) {
                return value;
            }
        } catch (err) {
            console.warn('Failed to load section height:', err);
        }
        return defaultHeight;
    },

    // Сохранение высоты
    saveSectionHeight(storageKey, value) {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
            saved[this.objectName] = value;
            localStorage.setItem(storageKey, JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save section height:', err);
        }
    },

    // Настройка resize для секции
    // handleId - ID элемента resize-ручки
    // containerId - ID контейнера секции
    // storageKey - ключ для localStorage
    // heightProp - имя свойства для высоты (например 'sensorsHeight')
    // options - дополнительные параметры { minHeight, maxHeight }
    setupSectionResize(handleId, containerId, storageKey, heightProp, options = {}) {
        const handle = document.getElementById(handleId);
        const container = document.getElementById(containerId);
        if (!handle || !container) return;

        const minHeight = options.minHeight || 100;
        const maxHeight = options.maxHeight || 800;

        container.style.height = `${this[heightProp]}px`;

        let startY = 0;
        let startHeight = 0;
        let isResizing = false;

        const onMouseMove = (e) => {
            if (!isResizing) return;
            const delta = e.clientY - startY;
            const newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + delta));
            container.style.height = `${newHeight}px`;
        };

        const onMouseUp = () => {
            if (!isResizing) return;
            isResizing = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            const newHeight = parseInt(container.style.height, 10);
            if (!Number.isNaN(newHeight)) {
                this[heightProp] = newHeight;
                this.saveSectionHeight(storageKey, newHeight);
            }
        };

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isResizing = true;
            startY = e.clientY;
            startHeight = container.offsetHeight;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
        });
    }
};

/**
 * Миксин для фильтрации списка элементов
 */
const FilterMixin = {
    // Инициализация свойств фильтрации
    initFilterProps() {
        this.filter = '';
        this.typeFilter = 'all';
        this.statusFilter = 'all';
        this.filterDebounce = null;
    },

    // Применение локальных фильтров к списку
    // extraFields - дополнительные поля для текстового поиска (например, ['mbreg'] для Modbus)
    // fieldAccessor - функция для получения значения поля (для вложенных объектов)
    applyFilters(items, nameField = 'name', typeField = 'type', statusField = null, extraFields = [], fieldAccessor = null) {
        let result = items;

        if (this.filter) {
            const filterLower = this.filter.toLowerCase();
            result = result.filter(item => {
                // Поиск по name
                if ((item[nameField] || '').toLowerCase().includes(filterLower)) return true;
                // Поиск по id
                if (String(item.id || '').includes(filterLower)) return true;
                // Поиск по дополнительным полям
                for (const field of extraFields) {
                    const value = fieldAccessor ? fieldAccessor(item, field) : item[field];
                    if (String(value || '').toLowerCase().includes(filterLower)) return true;
                }
                return false;
            });
        }

        if (this.typeFilter && this.typeFilter !== 'all') {
            result = result.filter(item => item[typeField] === this.typeFilter);
        }

        if (statusField && this.statusFilter && this.statusFilter !== 'all') {
            result = result.filter(item =>
                (item[statusField] || '').toLowerCase() === this.statusFilter.toLowerCase()
            );
        }

        return result;
    },

    // Настройка debounced фильтра
    setupFilterInput(inputId, onFilter, delay = 300) {
        const input = document.getElementById(inputId);
        if (!input) return;

        input.addEventListener('input', (e) => {
            clearTimeout(this.filterDebounce);
            this.filterDebounce = setTimeout(() => {
                this.filter = e.target.value;
                onFilter();
            }, delay);
        });
    },

    // Полная настройка фильтров с ESC, type filter и опциональным status filter
    setupFilterListeners(filterInputId, typeFilterId, onFilter, delay = 300, statusFilterId = null) {
        const filterInput = document.getElementById(filterInputId);
        const typeFilter = document.getElementById(typeFilterId);
        const statusFilter = statusFilterId ? document.getElementById(statusFilterId) : null;

        if (filterInput) {
            // Debounced input
            filterInput.addEventListener('input', (e) => {
                clearTimeout(this.filterDebounce);
                this.filterDebounce = setTimeout(() => {
                    this.filter = e.target.value.trim();
                    onFilter();
                }, delay);
            });

            // ESC сбрасывает фильтр
            filterInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    if (filterInput.value) {
                        filterInput.value = '';
                        this.filter = '';
                        onFilter();
                    }
                    filterInput.blur();
                    e.preventDefault();
                }
            });
        }

        if (typeFilter) {
            typeFilter.addEventListener('change', () => {
                this.typeFilter = typeFilter.value;
                onFilter();
            });
        }

        if (statusFilter) {
            statusFilter.addEventListener('change', () => {
                this.statusFilter = statusFilter.value;
                onFilter();
            });
        }
    },

    // Настройка ESC на контейнере для сброса фильтра
    setupContainerEscHandler(containerId, filterInputId, onFilter) {
        const container = document.getElementById(containerId);
        const filterInput = document.getElementById(filterInputId);
        if (!container || !filterInput) return;

        container.setAttribute('tabindex', '0');
        container.addEventListener('click', () => container.focus());
        container.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.filter) {
                filterInput.value = '';
                this.filter = '';
                onFilter();
                e.preventDefault();
            }
        });
    }
};

// Миксин для управления доступностью секции параметров на основе httpEnabledSetParams
const ParamsAccessibilityMixin = {
    /**
     * Обновляет доступность секции параметров на основе флага httpEnabledSetParams в статусе.
     * Если httpEnabledSetParams === false:
     * - Секция сворачивается
     * - Кнопка "Apply" блокируется
     * - Все input/select в таблице параметров блокируются
     * - Показывается предупреждающее сообщение
     * - Обновляется индикатор в шапке (если есть)
     *
     * @param {string} prefix - Префикс элементов (например, 'opcua', 'opcuasrv', 'mb', 'mbs')
     */
    updateParamsAccessibility(prefix) {
        // httpEnabledSetParams может быть: true/false, 1/0, или отсутствовать
        // Если статус не загружен - не меняем состояние секции
        if (!this.status) return;

        const val = this.status.httpEnabledSetParams;
        // Разрешено если значение === true или === 1
        // Также разрешено если значение не определено (для совместимости со старыми версиями)
        const enabled = val === true || val === 1 || val === undefined;
        const explicitlyDisabled = val === false || val === 0;

        // Заблокировать кнопку "Apply"
        const saveBtn = document.getElementById(`${prefix}-params-save-${this.objectName}`);
        if (saveBtn) {
            saveBtn.disabled = explicitlyDisabled;
            saveBtn.title = explicitlyDisabled ? 'Parameter modification disabled' : '';
        }

        // Заблокировать все input в таблице параметров
        const paramsTable = document.getElementById(`${prefix}-params-${this.objectName}`);
        if (paramsTable) {
            const inputs = paramsTable.querySelectorAll('input, select');
            inputs.forEach(input => {
                input.disabled = explicitlyDisabled;
            });
        }

        // Обновить индикатор в шапке (если есть)
        const indParams = document.getElementById(`${prefix}-ind-params-${this.objectName}`);
        if (indParams) {
            indParams.className = `header-indicator-dot ${enabled ? 'ok' : 'fail'}`;
            indParams.title = enabled ? 'Parameters: Yes' : 'Parameters: No';
        }

        // Показать предупреждение только если явно запрещено
        this.setNote(`${prefix}-params-note-${this.objectName}`,
            explicitlyDisabled ? 'Parameter modification disabled (httpEnabledSetParams=false)' : '',
            explicitlyDisabled);
    }
};

/**
 * Миксин для отображения счётчика загруженных/всего элементов
 * Показывает "loaded / total" или просто "total" когда всё загружено
 */
const ItemCounterMixin = {
    /**
     * Обновляет счётчик элементов
     * @param {string} elementId - ID элемента счётчика
     * @param {number} loaded - Количество загруженных элементов
     * @param {number} total - Общее количество элементов
     */
    updateItemCount(elementId, loaded, total) {
        const countEl = document.getElementById(elementId);
        if (countEl) {
            countEl.textContent = loaded === total ? `${total}` : `${loaded} / ${total}`;
        }
    }
};

/**
 * Миксин для сохранения/загрузки высоты секций в localStorage
 */
const SectionHeightMixin = {
    /**
     * Загружает сохранённую высоту секции
     * @param {string} storageKey - Ключ в localStorage
     * @param {number} defaultHeight - Value по умолчанию
     * @returns {number}
     */
    loadSectionHeight(storageKey, defaultHeight = 300) {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
            const value = saved[this.objectName];
            if (typeof value === 'number' && value > 0) {
                return value;
            }
        } catch (err) {
            console.warn('Failed to load section height:', err);
        }
        return defaultHeight;
    },

    /**
     * Сохраняет высоту секции
     * @param {string} storageKey - Ключ в localStorage
     * @param {number} value - Value высоты
     */
    saveSectionHeight(storageKey, value) {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
            saved[this.objectName] = value;
            localStorage.setItem(storageKey, JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save section height:', err);
        }
    }
};

const PinManagementMixin = {
    /**
     * Получает закрепленные элементы (датчики/регистры)
     * @param {string} storageKey - Ключ в localStorage
     * @returns {Set<string>}
     */
    getPinnedItems(storageKey) {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
            return new Set(saved[this.objectName] || []);
        } catch (err) {
            return new Set();
        }
    },

    /**
     * Сохраняет закрепленные элементы
     * @param {string} storageKey - Ключ в localStorage
     * @param {Set<string>} pinnedSet - Множество ID закрепленных элементов
     */
    savePinnedItems(storageKey, pinnedSet) {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
            saved[this.objectName] = Array.from(pinnedSet);
            localStorage.setItem(storageKey, JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save pinned items:', err);
        }
    },

    /**
     * Переключает закрепление элемента
     * @param {string} storageKey - Ключ в localStorage
     * @param {number|string} itemId - ID элемента
     * @param {Function} renderCallback - Callback для перерисовки
     */
    toggleItemPin(storageKey, itemId, renderCallback) {
        const pinned = this.getPinnedItems(storageKey);
        const idStr = String(itemId);

        if (pinned.has(idStr)) {
            pinned.delete(idStr);
        } else {
            pinned.add(idStr);
        }

        this.savePinnedItems(storageKey, pinned);
        if (renderCallback) {
            renderCallback.call(this);
        }
    },

    /**
     * Снимает закрепление со всех элементов
     * @param {string} storageKey - Ключ в localStorage
     * @param {Function} renderCallback - Callback для перерисовки
     */
    unpinAllItems(storageKey, renderCallback) {
        this.savePinnedItems(storageKey, new Set());
        if (renderCallback) {
            renderCallback.call(this);
        }
    }
};

// Функция для применения миксина к классу
function applyMixin(targetClass, mixin) {
    Object.getOwnPropertyNames(mixin).forEach(name => {
        if (name !== 'constructor') {
            Object.defineProperty(
                targetClass.prototype,
                name,
                Object.getOwnPropertyDescriptor(mixin, name)
            );
        }
    });
}

// ============================================================================

// Базовый класс рендерера (общий функционал)
class BaseObjectRenderer {
    constructor(objectName, tabKey = null) {
        this.objectName = objectName;
        this.tabKey = tabKey || objectName; // tabKey для доступа к state.tabs

        // Префикс для ID элементов статуса (для updateStatusTimestamp)
        const typeName = this.constructor.getTypeName().toLowerCase();
        this.statusLastIdPrefix = `${typeName}-status-last`;

        // Timestamp последнего обновления статуса (для относительного времени)
        this.statusLastUpdate = null;
        this.statusDisplayTimer = null;
    }

    // Получить тип объекта (для отображения)
    static getTypeName() {
        return 'Object';
    }

    // Создать HTML-структуру панели
    createPanelHTML() {
        return `
            <div class="tab-panel-loading">Loading...</div>
        `;
    }

    // Инициализация после создания DOM
    initialize() {
        // Переопределяется в наследниках
    }

    // Обновить данные
    update(data) {
        // Переопределяется в наследниках
    }

    // Очистка при закрытии
    destroy() {
        this.stopStatusAutoRefresh();
        this.stopStatusDisplayTimer();
    }

    // Форматирование относительного времени
    formatTimeAgo(timestamp) {
        if (!timestamp) return '';
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 5) return '';
        if (seconds < 60) return `Updated ${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `Updated ${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        return `Updated ${hours}h ago`;
    }

    // Запуск таймера обновления отображения относительного времени
    startStatusDisplayTimer() {
        this.stopStatusDisplayTimer();
        this.statusDisplayTimer = setInterval(() => this.updateStatusDisplay(), 1000);
    }

    // Остановка таймера обновления отображения
    stopStatusDisplayTimer() {
        if (this.statusDisplayTimer) {
            clearInterval(this.statusDisplayTimer);
            this.statusDisplayTimer = null;
        }
    }

    // Обновить отображение относительного времени
    updateStatusDisplay() {
        const el = document.getElementById(`${this.statusLastIdPrefix}-${this.objectName}`);
        if (!el) return;
        el.textContent = this.formatTimeAgo(this.statusLastUpdate);
    }

    // --- Методы для автообновления статуса ---

    // Создать HTML для отображения времени последнего обновления статуса
    // Используется в headerExtra секций статуса
    createStatusHeaderExtra() {
        return `<span class="status-last" id="${this.statusLastIdPrefix}-${this.objectName}"></span>`;
    }

    // Инициализация автообновления статуса
    // Использует глобальный интервал state.sse.pollInterval
    initStatusAutoRefresh() {
        // Проверяем есть ли метод loadStatus у рендерера
        if (typeof this.loadStatus !== 'function') return;
        this.startStatusAutoRefresh();
        this.startStatusDisplayTimer();
    }

    // Вспомогательные методы для создания секций
    createCollapsibleSection(id, title, content, options = {}) {
        const { badge = false, hidden = false, headerExtra = '' } = options;
        const badgeHtml = badge ? `<span class="io-section-badge" id="${id}-count-${this.objectName}">0</span>` : '';
        const style = hidden ? 'style="display:none"' : '';
        const sectionId = options.sectionId || `${id}-section-${this.objectName}`;

        return `
            <div class="collapsible-section reorderable-section" data-section="${id}-${this.objectName}" data-section-id="${id}" id="${sectionId}" ${style}>
                <div class="collapsible-header" onclick="toggleSection('${id}-${this.objectName}')">
                    <svg class="collapsible-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M6 9l6 6 6-6"/>
                    </svg>
                    <span class="collapsible-title">${title}</span>
                    ${badgeHtml}
                    ${headerExtra}
                    <div class="section-reorder-buttons" onclick="event.stopPropagation()">
                        <button class="section-move-btn section-move-up" onclick="moveSectionUp('${this.tabKey}', '${id}')" title="Move up">↑</button>
                        <button class="section-move-btn section-move-down" onclick="moveSectionDown('${this.tabKey}', '${id}')" title="Move down">↓</button>
                    </div>
                </div>
                <div class="collapsible-content" id="section-${id}-${this.objectName}">
                    ${content}
                </div>
            </div>
        `;
    }

    createChartsSection() {
        return `
            <div class="collapsible-section reorderable-section" data-section="charts-${this.objectName}" data-section-id="charts" id="charts-section-${this.objectName}">
                <div class="collapsible-header" onclick="toggleSection('charts-${this.objectName}')">
                    <svg class="collapsible-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M6 9l6 6 6-6"/>
                    </svg>
                    <span class="collapsible-title">Charts</span>
                    <button class="add-sensor-btn" id="add-sensor-btn-${this.objectName}"
                            onclick="event.stopPropagation(); openSensorDialog('${this.tabKey}')"
                            ${!state.capabilities.smEnabled ? 'disabled title="SM not connected (-sm-url not set)"' : ''}>+ Sensor</button>
                    <div class="charts-time-range" onclick="event.stopPropagation()">
                        <div class="time-range-selector">
                            <button class="time-range-btn${state.timeRange === 60 ? ' active' : ''}" onclick="setTimeRange(60)">1m</button>
                            <button class="time-range-btn${state.timeRange === 180 ? ' active' : ''}" onclick="setTimeRange(180)">3m</button>
                            <button class="time-range-btn${state.timeRange === 300 ? ' active' : ''}" onclick="setTimeRange(300)">5m</button>
                            <button class="time-range-btn${state.timeRange === 900 ? ' active' : ''}" onclick="setTimeRange(900)">15m</button>
                            <button class="time-range-btn${state.timeRange === 3600 ? ' active' : ''}" onclick="setTimeRange(3600)">1h</button>
                            <button class="time-range-btn${state.timeRange === 10800 ? ' active' : ''}" onclick="setTimeRange(10800)">3h</button>
                        </div>
                    </div>
                    <div class="section-reorder-buttons" onclick="event.stopPropagation()">
                        <button class="section-move-btn section-move-up" onclick="moveSectionUp('${this.tabKey}', 'charts')" title="Move up">↑</button>
                        <button class="section-move-btn section-move-down" onclick="moveSectionDown('${this.tabKey}', 'charts')" title="Move down">↓</button>
                    </div>
                </div>
                <div class="collapsible-content" id="section-charts-${this.objectName}">
                    <div class="charts-container" id="charts-container-${this.objectName}">
                        <div id="charts-${this.objectName}" class="charts-grid"></div>
                    </div>
                    <div class="charts-resize-handle" id="charts-resize-${this.objectName}"></div>
                </div>
            </div>
        `;
    }

    createIOTimersSection() {
        return `
            <div class="collapsible-section io-timers-section reorderable-section" data-section="io-timers-${this.objectName}" data-section-id="io-timers" id="io-timers-section-${this.objectName}">
                <div class="collapsible-header" onclick="toggleSection('io-timers-${this.objectName}')">
                    <svg class="collapsible-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M6 9l6 6 6-6"/>
                    </svg>
                    <span class="collapsible-title">I/O</span>
                    <div class="io-filter-wrapper" onclick="event.stopPropagation()">
                        <input type="text" class="io-filter-input io-filter-global" id="io-filter-global-${this.objectName}"
                               placeholder="Filter..." data-object="${this.objectName}">
                    </div>
                    <label class="io-sequential-toggle" onclick="event.stopPropagation()">
                        <input type="checkbox" id="io-sequential-${this.objectName}" onchange="toggleIOLayout('${this.objectName}')">
                        <span>Sequential</span>
                    </label>
                    <div class="section-reorder-buttons" onclick="event.stopPropagation()">
                        <button class="section-move-btn section-move-up" onclick="moveSectionUp('${this.tabKey}', 'io-timers')" title="Move up">↑</button>
                        <button class="section-move-btn section-move-down" onclick="moveSectionDown('${this.tabKey}', 'io-timers')" title="Move down">↓</button>
                    </div>
                </div>
                <div class="collapsible-content" id="section-io-timers-${this.objectName}">
                    <div class="io-grid io-grid-3" id="io-grid-${this.objectName}">
                        ${this.createIOSection('inputs', 'Inputs')}
                        ${this.createIOSection('outputs', 'Outputs')}
                        ${this.createTimersSection()}
                    </div>
                </div>
            </div>
        `;
    }

    createIOSection(type, title) {
        const typeLower = type.toLowerCase();
        return `
            <div class="io-section" id="${typeLower}-section-${this.objectName}" data-section="${typeLower}-${this.objectName}">
                <div class="io-table-container" id="io-container-${typeLower}-${this.objectName}">
                    <table class="variables-table io-table io-table-io">
                        <thead>
                            <tr>
                                <th class="io-pin-col">
                                    <span class="io-unpin-all" id="io-unpin-${typeLower}-${this.objectName}" title="Unpin all" style="display:none">✕</span>
                                </th>
                                <th class="io-section-title io-section-toggle" data-section="${typeLower}-${this.objectName}">
                                    <svg class="io-collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M6 9l6 6 6-6"/>
                                    </svg>
                                    ${title} <span class="io-section-badge" id="${typeLower}-count-${this.objectName}">0</span>
                                </th>
                                <th class="io-spacer-col"></th>
                                <th>Type</th>
                                <th>ID</th>
                                <th>Name</th>
                                <th>Value</th>
                            </tr>
                        </thead>
                        <tbody id="${typeLower}-${this.objectName}"></tbody>
                    </table>
                </div>
                <div class="io-resize-handle" id="io-resize-${typeLower}-${this.objectName}"></div>
            </div>
        `;
    }

    createTimersSection() {
        return `
            <div class="io-section" id="timers-section-${this.objectName}" data-section="timers-${this.objectName}">
                <div class="io-table-container" id="io-container-timers-${this.objectName}">
                    <table class="variables-table io-table">
                        <thead>
                            <tr>
                                <th class="io-pin-col">
                                    <span class="io-unpin-all" id="io-unpin-timers-${this.objectName}" title="Unpin all" style="display:none">✕</span>
                                </th>
                                <th class="io-section-title io-section-toggle" data-section="timers-${this.objectName}">
                                    <svg class="io-collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M6 9l6 6 6-6"/>
                                    </svg>
                                    Timers <span class="io-section-badge" id="timers-count-${this.objectName}">0</span>
                                </th>
                                <th>Name</th>
                                <th>Interval</th>
                                <th>Remaining</th>
                                <th>Tick</th>
                            </tr>
                        </thead>
                        <tbody id="timers-${this.objectName}"></tbody>
                    </table>
                </div>
                <div class="io-resize-handle" id="io-resize-timers-${this.objectName}"></div>
            </div>
        `;
    }

    createVariablesSection() {
        return this.createCollapsibleSection('variables', 'Settings', `
            <table class="variables-table">
                <thead>
                    <tr>
                        <th colspan="2">
                            <input type="text"
                                   class="filter-input"
                                   id="filter-variables-${this.objectName}"
                                   placeholder="Filter by name..."
                                   data-object="${this.objectName}">
                        </th>
                        <th></th>
                    </tr>
                </thead>
                <tbody id="variables-${this.objectName}"></tbody>
            </table>
        `);
    }

    createLogServerSection() {
        return this.createCollapsibleSection('logserver', 'LogServer', `
            <table class="info-table">
                <tbody id="logserver-${this.objectName}"></tbody>
            </table>
        `, { hidden: true, sectionId: `logserver-section-${this.objectName}` });
    }

    createLogViewerSection() {
        // Контейнер для LogViewer - будет инициализирован позже
        // Обёртка reorderable-section для возможности перемещения
        return `<div class="reorderable-section logviewer-wrapper" data-section-id="logviewer" id="logviewer-wrapper-${this.objectName}">
            <div id="logviewer-container-${this.objectName}"></div>
        </div>`;
    }

    // Инициализация LogViewer (вызывается после создания DOM если LogServer доступен)
    initLogViewer(logServerData) {
        if (!logServerData || !logServerData.host) {
            return;
        }

        const container = document.getElementById(`logviewer-container-${this.objectName}`);
        if (!container) return;

        // Создаём LogViewer только если его ещё нет
        if (!this.logViewer) {
            // Извлекаем serverId из tabKey (формат: serverId:objectName)
            const tabState = state.tabs.get(this.tabKey);
            const serverId = tabState ? tabState.serverId : null;
            this.logViewer = new LogViewer(this.objectName, container, serverId, this.tabKey);
            this.logViewer.restoreCollapsedState();
        }
    }

    // Уничтожение LogViewer
    destroyLogViewer() {
        if (this.logViewer) {
            this.logViewer.destroy();
            this.logViewer = null;
        }
    }

    // Общий метод для обработки LogServer (рендеринг секции + инициализация LogViewer)
    handleLogServer(logServerData) {
        renderLogServer(this.tabKey, logServerData);
        this.initLogViewer(logServerData);
    }

    // ========== Общие методы для работы с графиками ==========

    // Проверить, добавлен ли датчик на график
    isSensorOnChart(sensorName) {
        // Используем objectName (displayName) для localStorage - это имя объекта без serverId
        const addedSensors = getExternalSensorsFromStorage(this.objectName);
        return addedSensors.has(sensorName);
    }

    // Переключить датчик на графике (добавить/удалить)
    // sensor должен содержать: id, name, iotype (или type), value
    toggleSensorChart(sensor) {
        if (!sensor || !sensor.name) return;

        // Используем objectName (displayName) для localStorage
        const addedSensors = getExternalSensorsFromStorage(this.objectName);

        if (addedSensors.has(sensor.name)) {
            // Удаляем с графика
            removeExternalSensor(this.tabKey, sensor.name, this.getChartOptions());
        } else {
            // Добавляем на график
            const chartOptions = this.getChartOptions();
            const sensorForChart = {
                id: sensor.id,
                name: sensor.name,
                textname: sensor.textname || sensor.name,
                iotype: sensor.iotype || sensor.type,
                value: sensor.value,
                // Сохраняем опции графика для восстановления после перезагрузки
                chartOptions: chartOptions
            };

            // Добавляем в список внешних датчиков (сохраняем полные данные)
            addedSensors.set(sensor.name, sensorForChart);
            saveExternalSensorsToStorage(this.objectName, addedSensors);

            // Добавляем в state.sensorsByName если его там нет
            if (!state.sensorsByName.has(sensor.name)) {
                state.sensorsByName.set(sensor.name, sensorForChart);
                state.sensors.set(sensor.id, sensorForChart);
            }

            // Создаём график с опциями, специфичными для типа рендерера
            createExternalSensorChart(this.tabKey, sensorForChart, this.getChartOptions());

            // Подписываемся на обновления датчика
            this.subscribeToChartSensor(sensor.id);
        }
    }

    // Получить опции для создания графика
    // Переопределяется в наследниках для специфичных badge и prefix
    getChartOptions() {
        return { badge: 'SM', prefix: 'ext' };
    }

    // Подписаться на обновления датчика для графика
    // Переопределяется в наследниках для специфичных API
    subscribeToChartSensor(sensorId) {
        // По умолчанию используем IONC подписку
        subscribeToIONCSensor(this.tabKey, sensorId);
    }

    // Сгенерировать HTML для checkbox добавления на график
    renderChartToggleCell(sensorId, sensorName, prefix = 'sensor') {
        const isOnChart = this.isSensorOnChart(sensorName);
        const varName = `${prefix}-${sensorId}`;
        const checkboxId = `chart-${this.objectName}-${varName}`;
        return `
            <td class="chart-col">
                <span class="chart-toggle">
                    <input type="checkbox"
                           class="chart-checkbox chart-toggle-input"
                           id="${checkboxId}"
                           data-sensor-id="${sensorId}"
                           data-sensor-name="${escapeHtml(sensorName)}"
                           ${isOnChart ? 'checked' : ''}>
                    <label class="chart-toggle-label" for="${checkboxId}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 3v18h18"/>
                            <path d="M18 9l-5 5-4-4-3 3"/>
                        </svg>
                    </label>
                </span>
            </td>
        `;
    }

    // Привязать обработчики событий для checkbox графиков
    // sensorMap - Map с данными датчиков по id
    attachChartToggleListeners(container, sensorMap) {
        if (!container) return;
        container.querySelectorAll('.chart-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                const sensorId = parseInt(cb.dataset.sensorId, 10);
                const sensor = sensorMap.get(sensorId);
                if (sensor) {
                    this.toggleSensorChart(sensor);
                }
            });
        });
    }

    createStatisticsSection() {
        return this.createCollapsibleSection('statistics', 'Statistics', `
            <div id="statistics-${this.objectName}"></div>
        `, { hidden: true, sectionId: `statistics-section-${this.objectName}` });
    }

    createObjectInfoSection() {
        return this.createCollapsibleSection('object', 'Object Information', `
            <table class="info-table">
                <tbody id="object-info-${this.objectName}"></tbody>
            </table>
        `);
    }

    // Построение URL с параметром server для multi-server режима
    buildUrl(path) {
        const tabState = state.tabs.get(this.tabKey);
        const serverId = tabState?.serverId;
        if (serverId) {
            return `${path}${path.includes('?') ? '&' : '?'}server=${encodeURIComponent(serverId)}`;
        }
        return path;
    }

    // Выполнить запрос и вернуть JSON
    async fetchJSON(path, options = {}) {
        const url = this.buildUrl(path);
        const response = await fetch(url, options);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
        }
        return response.json();
    }

    // Set текст уведомления
    setNote(id, text, isError = false) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('note-error', !!(text && isError));
    }

    // Базовый resize handler для секций
    setupResize(containerSelector, handleSelector, storageKey, minHeight = 100, maxHeight = 800) {
        const container = document.querySelector(containerSelector);
        const handle = document.querySelector(handleSelector);
        if (!container || !handle) return;

        let startY, startHeight;

        const onMouseMove = (e) => {
            const delta = e.clientY - startY;
            const newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + delta));
            container.style.height = `${newHeight}px`;
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            localStorage.setItem(storageKey, container.style.height);
        };

        handle.addEventListener('mousedown', (e) => {
            startY = e.clientY;
            startHeight = container.offsetHeight;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });

        // Восстановить из localStorage
        const savedHeight = localStorage.getItem(storageKey);
        if (savedHeight) {
            container.style.height = savedHeight;
        }
    }

    // --- Status auto-refresh (использует глобальный state.sse.pollInterval) ---

    startStatusAutoRefresh() {
        this.stopStatusAutoRefresh();
        const interval = state.sse.pollInterval || 5000;
        if (interval <= 0) return;
        this.statusTimer = setInterval(() => this.loadStatus(), interval);
    }

    stopStatusAutoRefresh() {
        if (this.statusTimer) {
            clearInterval(this.statusTimer);
            this.statusTimer = null;
        }
    }

    updateStatusTimestamp() {
        this.statusLastUpdate = Date.now();
        this.updateStatusDisplay();
    }
}

// Рендерер для UniSetManager (полный функционал)
