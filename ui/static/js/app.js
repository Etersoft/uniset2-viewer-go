// Состояние приложения
// Экспортируем на window для тестов
const state = window.state = {
    objects: [],
    servers: new Map(), // serverId -> { id, url, name, connected }
    tabs: new Map(), // tabKey -> { charts, updateInterval, chartStartTime, objectType, renderer, serverId, serverName, displayName }
    activeTab: null,
    sensors: new Map(), // sensorId -> sensorInfo
    sensorsByName: new Map(), // sensorName -> sensorInfo
    timeRange: 900, // секунды (по умолчанию 15 минут)
    sidebarCollapsed: false, // свёрнутая боковая панель
    collapsedSections: {}, // состояние спойлеров
    capabilities: {
        smEnabled: false // по умолчанию SM отключен
    },
    sse: {
        eventSource: null,
        connected: false,
        pollInterval: 5000, // будет обновлено с сервера
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        reconnectDelay: 1000
    }
};

// ============================================================================
// SSE (Server-Sent Events) для realtime обновлений
// ============================================================================

// Обновление индикатора состояния SSE в header
function updateSSEStatus(status, lastUpdate = null) {
    const container = document.getElementById('sse-status');
    const textEl = container?.querySelector('.sse-status-text');
    if (!container || !textEl) return;

    // Убираем все классы состояния
    container.classList.remove('connected', 'reconnecting', 'polling', 'disconnected');

    let text = '';
    let title = '';

    switch (status) {
        case 'connected':
            container.classList.add('connected');
            text = 'SSE';
            title = 'Подключено через Server-Sent Events';
            break;
        case 'reconnecting':
            container.classList.add('reconnecting');
            text = `Переподключение (${state.sse.reconnectAttempts}/${state.sse.maxReconnectAttempts})`;
            title = 'Попытка восстановить SSE соединение';
            break;
        case 'polling':
            container.classList.add('polling');
            text = 'Polling';
            title = 'Fallback режим: периодический опрос сервера';
            break;
        case 'disconnected':
            container.classList.add('disconnected');
            text = 'Отключено';
            title = 'Нет соединения с сервером';
            break;
        default:
            text = 'Подключение...';
            title = 'Установка соединения';
    }

    // Добавляем время последнего обновления если есть
    if (lastUpdate) {
        const timeStr = lastUpdate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        text += ` · ${timeStr}`;
    }

    textEl.textContent = text;
    container.title = title;
}

function initSSE() {
    if (state.sse.eventSource) {
        state.sse.eventSource.close();
    }

    const url = '/api/events';
    console.log('SSE: Подключение к', url);

    const eventSource = new EventSource(url);
    state.sse.eventSource = eventSource;

    eventSource.addEventListener('connected', (e) => {
        try {
            const data = JSON.parse(e.data);
            state.sse.connected = true;
            state.sse.reconnectAttempts = 0;
            state.sse.pollInterval = data.data?.pollInterval || 5000;

            // Сохраняем capabilities сервера
            state.capabilities.smEnabled = data.data?.smEnabled || false;
            console.log('SSE: Подключено, poll interval:', state.sse.pollInterval, 'ms, smEnabled:', state.capabilities.smEnabled);

            // Обновляем индикатор статуса
            updateSSEStatus('connected', new Date());

            // Отключаем polling для всех открытых вкладок
            state.tabs.forEach((tabState, objectName) => {
                if (tabState.updateInterval) {
                    clearInterval(tabState.updateInterval);
                    tabState.updateInterval = null;
                    console.log('SSE: Отключен polling для', objectName);
                }
            });
        } catch (err) {
            console.warn('SSE: Ошибка парсинга connected:', err);
        }
    });

    eventSource.addEventListener('object_data', (e) => {
        try {
            const event = JSON.parse(e.data);
            const { objectName, serverId, data } = event;

            // Обновляем время последнего обновления в индикаторе
            updateSSEStatus('connected', new Date());

            // Формируем ключ вкладки: serverId:objectName
            const tabKey = `${serverId}:${objectName}`;

            // Обновляем UI только для открытых вкладок
            const tabState = state.tabs.get(tabKey);
            if (tabState) {
                // Обновляем рендерер (таблицы, статистика и т.д.)
                if (tabState.renderer) {
                    tabState.renderer.update(data);
                }

                // Обновляем графики (кроме внешних датчиков - они обновляются через SSE)
                tabState.charts.forEach((chartData, varName) => {
                    // Пропускаем внешние датчики (ext:) - у них нет истории на сервере
                    if (varName.startsWith('ext:')) {
                        return;
                    }
                    updateChart(tabState.displayName, varName, chartData.chart);
                });
            }
        } catch (err) {
            console.warn('SSE: Ошибка обработки object_data:', err);
        }
    });

    // Обработка обновлений внешних датчиков из SM
    eventSource.addEventListener('sensor_data', (e) => {
        try {
            const event = JSON.parse(e.data);
            const objectName = event.objectName;
            const sensor = event.data;

            // Находим вкладку и график для этого датчика
            const tabState = state.tabs.get(objectName);
            if (tabState) {
                const varName = `ext:${sensor.name}`;
                const chartData = tabState.charts.get(varName);

                if (chartData) {
                    // Добавляем точку на график (формат {x: Date, y: value} для time scale)
                    const timestamp = new Date(event.timestamp);
                    const value = sensor.value;
                    const dataPoint = { x: timestamp, y: value };

                    chartData.chart.data.datasets[0].data.push(dataPoint);

                    // Ограничиваем количество точек
                    const maxPoints = 1000;
                    if (chartData.chart.data.datasets[0].data.length > maxPoints) {
                        chartData.chart.data.datasets[0].data.shift();
                    }

                    // Синхронизируем временную шкалу для всех графиков объекта
                    syncAllChartsTimeRange(objectName);

                    // Обновляем значение в легенде
                    const safeVarName = varName.replace(/:/g, '-');
                    const legendEl = document.getElementById(`legend-value-${objectName}-${safeVarName}`);
                    if (legendEl) {
                        legendEl.textContent = formatValue(value);
                    }
                }
            }
        } catch (err) {
            console.warn('SSE: Ошибка обработки sensor_data:', err);
        }
    });

    // Обработка батча обновлений IONC датчиков (SharedMemory и подобные)
    eventSource.addEventListener('ionc_sensor_batch', (e) => {
        try {
            const event = JSON.parse(e.data);
            const { objectName, serverId } = event;
            const sensors = event.data; // массив датчиков

            // Формируем ключ вкладки: serverId:objectName
            const tabKey = `${serverId}:${objectName}`;

            // Находим вкладку с IONC рендерером
            const tabState = state.tabs.get(tabKey);
            if (!tabState) return;

            const timestamp = new Date(event.timestamp);
            const chartsToUpdate = new Set();

            // Обрабатываем все датчики
            for (const sensor of sensors) {
                // Обновляем таблицу датчиков
                if (tabState.renderer?.handleIONCSensorUpdate) {
                    tabState.renderer.handleIONCSensorUpdate(sensor);
                }

                // Обновляем график если есть
                const varName = `ext:${sensor.name}`;
                const chartData = tabState.charts.get(varName);
                if (chartData) {
                    const value = sensor.value;
                    chartData.chart.data.datasets[0].data.push({ x: timestamp, y: value });
                    chartsToUpdate.add(varName);

                    // Обновляем значение в легенде
                    const safeVarName = varName.replace(/:/g, '-');
                    const legendEl = document.getElementById(`legend-value-${tabState.displayName}-${safeVarName}`);
                    if (legendEl) {
                        legendEl.textContent = formatValue(value);
                    }
                }
            }

            // Один раз синхронизируем временную шкалу
            if (chartsToUpdate.size > 0) {
                syncAllChartsTimeRange(tabState.displayName);
            }

            // Batch update для всех графиков
            tabState.charts.forEach((chartData, varName) => {
                // Ограничиваем количество точек
                const data = chartData.chart.data.datasets[0].data;
                const maxPoints = 1000;
                while (data.length > maxPoints) {
                    data.shift();
                }
                chartData.chart.update('none');
            });

        } catch (err) {
            console.warn('SSE: Ошибка обработки ionc_sensor_batch:', err);
        }
    });

    eventSource.onerror = (e) => {
        console.warn('SSE: Ошибка соединения');
        state.sse.connected = false;

        if (state.sse.reconnectAttempts < state.sse.maxReconnectAttempts) {
            state.sse.reconnectAttempts++;
            const delay = state.sse.reconnectDelay * state.sse.reconnectAttempts;
            console.log(`SSE: Переподключение через ${delay}ms (попытка ${state.sse.reconnectAttempts})`);
            updateSSEStatus('reconnecting');
            setTimeout(initSSE, delay);
        } else {
            console.warn('SSE: Превышено количество попыток, переход на polling');
            updateSSEStatus('polling');
            enablePollingFallback();
        }
    };

    eventSource.onopen = () => {
        console.log('SSE: Соединение открыто');
    };
}

// Включить polling как fallback при недоступности SSE
function enablePollingFallback() {
    console.log('Polling: Включение fallback режима');
    state.tabs.forEach((tabState, objectName) => {
        // Включаем polling для данных объекта
        if (!tabState.updateInterval) {
            tabState.updateInterval = setInterval(
                () => loadObjectData(objectName),
                state.sse.pollInterval
            );
            console.log('Polling: Включен для', objectName);
        }

        // Включаем polling для графиков
        tabState.charts.forEach((chartData, varName) => {
            if (!chartData.updateInterval) {
                chartData.updateInterval = setInterval(async () => {
                    await updateChart(objectName, varName, chartData.chart);
                }, state.sse.pollInterval);
            }
        });
    });
}

// Закрыть SSE соединение
function closeSSE() {
    if (state.sse.eventSource) {
        state.sse.eventSource.close();
        state.sse.eventSource = null;
        state.sse.connected = false;
    }
}

// ============================================================================
// Система рендереров для разных типов объектов
// ============================================================================

// Реестр рендереров по типу объекта
const objectRenderers = new Map();

// Базовый класс рендерера (общий функционал)
class BaseObjectRenderer {
    constructor(objectName, tabKey = null) {
        this.objectName = objectName;
        this.tabKey = tabKey || objectName; // tabKey для доступа к state.tabs
    }

    // Получить тип объекта (для отображения)
    static getTypeName() {
        return 'Object';
    }

    // Создать HTML-структуру панели
    createPanelHTML() {
        return `
            <div class="tab-panel-loading">Загрузка...</div>
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
        // Переопределяется в наследниках
    }

    // Вспомогательные методы для создания секций
    createCollapsibleSection(id, title, content, options = {}) {
        const { badge = false, hidden = false } = options;
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
                    <div class="section-reorder-buttons" onclick="event.stopPropagation()">
                        <button class="section-move-btn section-move-up" onclick="moveSectionUp('${this.tabKey}', '${id}')" title="Переместить вверх">↑</button>
                        <button class="section-move-btn section-move-down" onclick="moveSectionDown('${this.tabKey}', '${id}')" title="Переместить вниз">↓</button>
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
                    <span class="collapsible-title">Графики</span>
                    <button class="add-sensor-btn" onclick="event.stopPropagation(); openSensorDialog('${this.objectName}')">+ Датчик</button>
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
                        <button class="section-move-btn section-move-up" onclick="moveSectionUp('${this.tabKey}', 'charts')" title="Переместить вверх">↑</button>
                        <button class="section-move-btn section-move-down" onclick="moveSectionDown('${this.tabKey}', 'charts')" title="Переместить вниз">↓</button>
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
                               placeholder="Фильтр..." data-object="${this.objectName}">
                    </div>
                    <label class="io-sequential-toggle" onclick="event.stopPropagation()">
                        <input type="checkbox" id="io-sequential-${this.objectName}" onchange="toggleIOLayout('${this.objectName}')">
                        <span>Друг за другом</span>
                    </label>
                    <div class="section-reorder-buttons" onclick="event.stopPropagation()">
                        <button class="section-move-btn section-move-up" onclick="moveSectionUp('${this.tabKey}', 'io-timers')" title="Переместить вверх">↑</button>
                        <button class="section-move-btn section-move-down" onclick="moveSectionDown('${this.tabKey}', 'io-timers')" title="Переместить вниз">↓</button>
                    </div>
                </div>
                <div class="collapsible-content" id="section-io-timers-${this.objectName}">
                    <div class="io-grid io-grid-3" id="io-grid-${this.objectName}">
                        ${this.createIOSection('inputs', 'Входы')}
                        ${this.createIOSection('outputs', 'Выходы')}
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
                                    <span class="io-unpin-all" id="io-unpin-${typeLower}-${this.objectName}" title="Снять все закрепления" style="display:none">✕</span>
                                </th>
                                <th class="io-section-title io-section-toggle" data-section="${typeLower}-${this.objectName}">
                                    <svg class="io-collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M6 9l6 6 6-6"/>
                                    </svg>
                                    ${title} <span class="io-section-badge" id="${typeLower}-count-${this.objectName}">0</span>
                                </th>
                                <th class="io-spacer-col"></th>
                                <th>Тип</th>
                                <th>ID</th>
                                <th>Имя</th>
                                <th>Значение</th>
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
                                    <span class="io-unpin-all" id="io-unpin-timers-${this.objectName}" title="Снять все закрепления" style="display:none">✕</span>
                                </th>
                                <th class="io-section-title io-section-toggle" data-section="timers-${this.objectName}">
                                    <svg class="io-collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M6 9l6 6 6-6"/>
                                    </svg>
                                    Таймеры <span class="io-section-badge" id="timers-count-${this.objectName}">0</span>
                                </th>
                                <th>Имя</th>
                                <th>Интервал</th>
                                <th>Осталось</th>
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
        return this.createCollapsibleSection('variables', 'Настройки', `
            <table class="variables-table">
                <thead>
                    <tr>
                        <th colspan="2">
                            <input type="text"
                                   class="filter-input"
                                   id="filter-variables-${this.objectName}"
                                   placeholder="Фильтр по имени..."
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
            this.logViewer = new LogViewer(this.objectName, container, serverId);
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

    createStatisticsSection() {
        return this.createCollapsibleSection('statistics', 'Статистика', `
            <div id="statistics-${this.objectName}"></div>
        `, { hidden: true, sectionId: `statistics-section-${this.objectName}` });
    }

    createObjectInfoSection() {
        return this.createCollapsibleSection('object', 'Информация об объекте', `
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
}

// Рендерер для UniSetManager (полный функционал)
class UniSetManagerRenderer extends BaseObjectRenderer {
    static getTypeName() {
        return 'UniSetManager';
    }

    createPanelHTML() {
        return `
            ${this.createChartsSection()}
            ${this.createIOTimersSection()}
            ${this.createLogViewerSection()}
            ${this.createLogServerSection()}
            ${this.createVariablesSection()}
            ${this.createStatisticsSection()}
            ${this.createObjectInfoSection()}
        `;
    }

    initialize() {
        setupFilterHandlers(this.objectName);
        setupChartsResize(this.objectName);
        loadIOLayoutState(this.objectName);
        setupIOSections(this.objectName);
    }

    update(data) {
        // Сохраняем данные для повторного рендеринга с фильтрами
        const tabState = state.tabs.get(this.tabKey);
        if (tabState) {
            tabState.ioData = data.io || {};
            tabState.timersData = data.Timers || {};
        }

        // Объединяем Variables и extra (дополнительные переменные не входящие в стандартные поля)
        const allVariables = { ...(data.Variables || {}), ...(data.extra || {}) };
        renderVariables(this.objectName, allVariables);
        renderIO(this.objectName, 'inputs', data.io?.in || {});
        renderIO(this.objectName, 'outputs', data.io?.out || {});
        renderTimers(this.objectName, data.Timers || {});
        renderObjectInfo(this.objectName, data.object);
        renderLogServer(this.objectName, data.LogServer);
        renderStatistics(this.objectName, data.Statistics);
        updateChartLegends(this.objectName, data);

        // Инициализируем LogViewer если есть LogServer
        this.initLogViewer(data.LogServer);
    }

    destroy() {
        this.destroyLogViewer();
    }
}

// Рендерер для UniSetObject (базовый объект без IO/Timers)
class UniSetObjectRenderer extends BaseObjectRenderer {
    static getTypeName() {
        return 'UniSetObject';
    }

    createPanelHTML() {
        return `
            ${this.createChartsSection()}
            ${this.createLogViewerSection()}
            ${this.createLogServerSection()}
            ${this.createVariablesSection()}
            ${this.createStatisticsSection()}
            ${this.createObjectInfoSection()}
        `;
    }

    initialize() {
        setupFilterHandlers(this.objectName);
        setupChartsResize(this.objectName);
    }

    update(data) {
        // Объединяем Variables и extra (дополнительные переменные не входящие в стандартные поля)
        const allVariables = { ...(data.Variables || {}), ...(data.extra || {}) };
        renderVariables(this.objectName, allVariables);
        renderObjectInfo(this.objectName, data.object);
        renderLogServer(this.objectName, data.LogServer);
        renderStatistics(this.objectName, data.Statistics);
        updateChartLegends(this.objectName, data);

        // Инициализируем LogViewer если есть LogServer
        this.initLogViewer(data.LogServer);
    }

    destroy() {
        this.destroyLogViewer();
    }
}

// Fallback рендерер для неподдерживаемых типов объектов
class FallbackRenderer extends BaseObjectRenderer {
    static getTypeName() {
        return 'Unknown';
    }

    createPanelHTML() {
        return `
            <div class="fallback-warning">
                <div class="fallback-icon">⚠️</div>
                <div class="fallback-message">
                    Тип объекта "<span class="fallback-type"></span>" не поддерживается
                </div>
                <div class="fallback-hint">Отображается сырой JSON ответа</div>
            </div>
            <div class="fallback-json-container">
                <pre class="fallback-json" id="fallback-json-${this.objectName}"></pre>
            </div>
            ${this.createObjectInfoSection()}
        `;
    }

    initialize() {
        // Ничего дополнительного не требуется
    }

    update(data) {
        // Обновляем тип объекта в сообщении (используем tabKey для поиска панели)
        const typeSpan = document.querySelector(`.tab-panel[data-name="${this.tabKey}"] .fallback-type`);
        const typeLabel = data.object?.extensionType || data.object?.extensionsType || data.object?.objectType;
        if (typeSpan && typeLabel) {
            typeSpan.textContent = typeLabel;
        }

        // Выводим JSON - используем raw_data если есть, иначе весь data
        const jsonPre = document.getElementById(`fallback-json-${this.objectName}`);
        if (jsonPre) {
            const displayData = data.raw_data || data;
            jsonPre.textContent = JSON.stringify(displayData, null, 2);
        }

        // Обновляем информацию об объекте
        renderObjectInfo(this.objectName, data.object);
    }
}

// Рендерер по умолчанию - теперь использует FallbackRenderer
class DefaultObjectRenderer extends FallbackRenderer {
    static getTypeName() {
        return 'Default';
    }
}

// Регистрация рендереров
function registerRenderer(objectType, rendererClass) {
    objectRenderers.set(objectType, rendererClass);
}

// Получить рендерер для типа объекта
function getRendererClass(objectType) {
    return objectRenderers.get(objectType) || DefaultObjectRenderer;
}

// Выбор рендерера: сначала extensionType, затем objectType
function resolveRenderer(objectInfo = {}) {
    const extensionType = objectInfo.extensionType || objectInfo.extensionsType;
    const objectType = objectInfo.objectType || 'Default';

    if (extensionType && objectRenderers.has(extensionType)) {
        return {
            RendererClass: objectRenderers.get(extensionType),
            rendererType: extensionType,
            badgeType: extensionType,
            extensionType,
            objectType
        };
    }

    return {
        RendererClass: getRendererClass(objectType),
        rendererType: objectType,
        badgeType: extensionType || objectType,
        extensionType,
        objectType
    };
}

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
        setupChartsResize(this.objectName);
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
                    <span class="collapsible-title">Датчики</span>
                    <span class="sensor-count" id="ionc-sensor-count-${this.objectName}">0</span>
                    <div class="filter-bar" onclick="event.stopPropagation()">
                        <input type="text" class="filter-input" id="ionc-filter-${this.objectName}" placeholder="Фильтр...">
                        <select class="type-filter" id="ionc-type-filter-${this.objectName}">
                            <option value="all">Все</option>
                            <option value="AI">AI</option>
                            <option value="DI">DI</option>
                            <option value="AO">AO</option>
                            <option value="DO">DO</option>
                        </select>
                    </div>
                    <div class="section-reorder-buttons" onclick="event.stopPropagation()">
                        <button class="section-move-btn section-move-up" onclick="moveSectionUp('${this.tabKey}', 'ionc-sensors')" title="Переместить вверх">↑</button>
                        <button class="section-move-btn section-move-down" onclick="moveSectionDown('${this.tabKey}', 'ionc-sensors')" title="Переместить вниз">↓</button>
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
                                            <span class="ionc-unpin-all" id="ionc-unpin-${this.objectName}" title="Снять все закрепления" style="display:none">✕</span>
                                        </th>
                                        <th class="ionc-col-chart"></th>
                                        <th class="ionc-col-id">ID</th>
                                        <th class="ionc-col-name">Имя</th>
                                        <th class="ionc-col-type">Тип</th>
                                        <th class="ionc-col-value">Значение</th>
                                        <th class="ionc-col-flags">Статус</th>
                                        <th class="ionc-col-consumers">Подписчики</th>
                                        <th class="ionc-col-actions">Действия</th>
                                    </tr>
                                </thead>
                                <tbody class="ionc-sensors-tbody" id="ionc-sensors-tbody-${this.objectName}">
                                    <tr><td colspan="9" class="ionc-loading">Загрузка...</td></tr>
                                </tbody>
                            </table>
                            <div class="ionc-loading-more" id="ionc-loading-more-${this.objectName}" style="display: none;">Загрузка...</div>
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
            'Потерянные подписчики',
            `<div class="ionc-lost-list" id="ionc-lost-list-${this.objectName}">
                <span class="ionc-lost-empty">Нет потерянных подписчиков</span>
            </div>`,
            { badge: true }
        );
    }

    setupEventListeners() {
        const filterInput = document.getElementById(`ionc-filter-${this.objectName}`);
        const typeFilter = document.getElementById(`ionc-type-filter-${this.objectName}`);

        if (filterInput) {
            let debounceTimer;
            filterInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    this.filter = e.target.value;
                    this.loadSensors();
                }, 300);
            });

            // ESC - сброс фильтра и потеря фокуса
            filterInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    if (filterInput.value) {
                        filterInput.value = '';
                        this.filter = '';
                        this.loadSensors();
                    }
                    filterInput.blur();
                    e.preventDefault();
                }
            });
        }

        if (typeFilter) {
            typeFilter.addEventListener('change', (e) => {
                this.typeFilter = e.target.value;
                this.loadSensors();
            });
        }

        // ESC на контейнере датчиков — сброс фильтра
        const sensorsContainer = document.getElementById(`ionc-sensors-container-${this.objectName}`);
        if (sensorsContainer) {
            // Делаем контейнер фокусируемым
            sensorsContainer.setAttribute('tabindex', '0');

            // При клике на таблицу — фокус на контейнер (для работы ESC)
            sensorsContainer.addEventListener('click', () => {
                sensorsContainer.focus();
            });

            sensorsContainer.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && filterInput && this.filter) {
                    filterInput.value = '';
                    this.filter = '';
                    this.loadSensors();
                    e.preventDefault();
                }
            });
        }
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
            tbody.innerHTML = '<tr><td colspan="9" class="ionc-loading">Загрузка...</td></tr>';
        }

        try {
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/sensors?offset=0&limit=${this.chunkSize}`);
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to load sensors');

            const data = await response.json();
            this.totalCount = data.size || 0;

            // Фильтруем локально
            let sensors = data.sensors || [];
            sensors = this.applyLocalFilters(sensors);

            this.allSensors = sensors;
            this.sensors = sensors; // Для совместимости с существующим кодом
            this.sensorMap.clear();
            sensors.forEach(s => this.sensorMap.set(s.id, s));

            this.hasMore = (data.sensors?.length || 0) === this.chunkSize;
            this.updateVisibleRows();
            this.updateSensorCount();

            // Подписываемся на SSE обновления для загруженных датчиков
            this.subscribeToSSE();
        } catch (err) {
            console.error('Error loading IONC sensors:', err);
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="9" class="ionc-error">Ошибка загрузки: ${err.message}</td></tr>`;
            }
        } finally {
            this.loading = false;
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

        try {
            const nextOffset = this.allSensors.length;
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/sensors?offset=${nextOffset}&limit=${this.chunkSize}`);
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to load more sensors');

            const data = await response.json();
            let newSensors = data.sensors || [];

            // Применить локальные фильтры
            newSensors = this.applyLocalFilters(newSensors);

            // Добавить к уже загруженным
            this.allSensors = [...this.allSensors, ...newSensors];
            this.sensors = this.allSensors; // Для совместимости
            newSensors.forEach(s => this.sensorMap.set(s.id, s));

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

        // Установить высоту spacer для позиционирования
        spacer.style.height = `${this.startIndex * this.rowHeight}px`;

        // Получаем закреплённые датчики
        const pinnedSensors = this.getPinnedSensors();
        const hasPinned = pinnedSensors.size > 0;

        // Показываем/скрываем кнопку "снять все"
        const unpinBtn = document.getElementById(`ionc-unpin-${this.objectName}`);
        if (unpinBtn) {
            unpinBtn.style.display = hasPinned ? 'inline' : 'none';
        }

        // Фильтруем датчики:
        // - если есть текстовый фильтр — показываем все (для поиска новых датчиков)
        // - иначе если есть закреплённые — показываем только их
        let sensorsToShow = this.allSensors;
        if (!this.filter && hasPinned) {
            sensorsToShow = this.allSensors.filter(s => pinnedSensors.has(String(s.id)));
        }

        if (sensorsToShow.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="ionc-empty">Нет датчиков</td></tr>';
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
        // Кнопка разморозки
        tbody.querySelectorAll('.ionc-btn-unfreeze').forEach(btn => {
            btn.addEventListener('click', () => this.unfreeze(parseInt(btn.dataset.id)));
        });
        tbody.querySelectorAll('.ionc-btn-consumers').forEach(btn => {
            btn.addEventListener('click', () => this.showConsumersDialog(parseInt(btn.dataset.id)));
        });
        tbody.querySelectorAll('.pin-toggle').forEach(btn => {
            btn.addEventListener('click', () => this.togglePin(parseInt(btn.dataset.id)));
        });
        tbody.querySelectorAll('.ionc-chart-checkbox').forEach(cb => {
            cb.addEventListener('change', () => this.toggleSensorChart(parseInt(cb.dataset.id)));
        });
    }

    // Legacy alias for compatibility
    renderSensorsTable() {
        this.renderVisibleSensors();
    }

    renderSensorRow(sensor, isPinned) {
        const frozenClass = sensor.frozen ? 'ionc-sensor-frozen' : '';
        const blockedClass = sensor.blocked ? 'ionc-sensor-blocked' : '';
        const readonlyClass = sensor.readonly ? 'ionc-sensor-readonly' : '';

        const flags = [];
        if (sensor.frozen) flags.push('<span class="ionc-flag ionc-flag-frozen" title="Заморожен">❄</span>');
        if (sensor.blocked) flags.push('<span class="ionc-flag ionc-flag-blocked" title="Заблокирован">🔒</span>');
        if (sensor.readonly) flags.push('<span class="ionc-flag ionc-flag-readonly" title="Только чтение">👁</span>');
        if (sensor.undefined) flags.push('<span class="ionc-flag ionc-flag-undefined" title="Не определён">?</span>');

        const freezeBtn = sensor.frozen
            ? `<button class="ionc-btn ionc-btn-unfreeze" data-id="${sensor.id}" title="Разморозить">🔥</button>`
            : `<button class="ionc-btn ionc-btn-freeze" data-id="${sensor.id}" title="Заморозить">❄</button>`;

        // Кнопка закрепления (pin)
        const pinToggleClass = isPinned ? 'pin-toggle pinned' : 'pin-toggle';
        const pinIcon = isPinned ? '📌' : '○';
        const pinTitle = isPinned ? 'Открепить' : 'Закрепить';

        // Checkbox для графика
        const isOnChart = this.isSensorOnChart(sensor.name);
        const varName = `ionc-${sensor.id}`;

        return `
            <tr class="ionc-sensor-row ${frozenClass} ${blockedClass} ${readonlyClass}" data-sensor-id="${sensor.id}">
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
                <td class="ionc-col-name">${escapeHtml(sensor.name)}</td>
                <td class="ionc-col-type"><span class="type-badge type-${sensor.type}">${sensor.type}</span></td>
                <td class="ionc-col-value">
                    <span class="ionc-value" id="ionc-value-${this.objectName}-${sensor.id}">${sensor.value}</span>
                </td>
                <td class="ionc-col-flags">${flags.join(' ') || '—'}</td>
                <td class="ionc-col-consumers">
                    <button class="ionc-btn ionc-btn-consumers" data-id="${sensor.id}" title="Показать подписчиков">👥</button>
                </td>
                <td class="ionc-col-actions">
                    <button class="ionc-btn ionc-btn-set" data-id="${sensor.id}" title="Установить значение" ${sensor.readonly ? 'disabled' : ''}>✎</button>
                    ${freezeBtn}
                </td>
            </tr>
        `;
    }

    // Управление закреплёнными датчиками
    getPinnedSensors() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-ionc-pinned') || '{}');
            return new Set(saved[this.objectName] || []);
        } catch (err) {
            return new Set();
        }
    }

    savePinnedSensors(pinnedSet) {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-ionc-pinned') || '{}');
            saved[this.objectName] = Array.from(pinnedSet);
            localStorage.setItem('uniset2-viewer-ionc-pinned', JSON.stringify(saved));
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

    isSensorOnChart(sensorName) {
        const addedSensors = getExternalSensorsFromStorage(this.tabKey);
        return addedSensors.has(sensorName);
    }

    toggleSensorChart(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        const addedSensors = getExternalSensorsFromStorage(this.tabKey);

        if (addedSensors.has(sensor.name)) {
            // Удаляем с графика
            removeExternalSensor(this.tabKey, sensor.name);
        } else {
            // Добавляем на график - используем существующую систему внешних датчиков
            // Создаём объект датчика в формате, ожидаемом createExternalSensorChart
            const sensorForChart = {
                id: sensor.id,
                name: sensor.name,
                textname: sensor.name,
                iotype: sensor.type,
                value: sensor.value
            };

            // Добавляем в список внешних датчиков
            addedSensors.add(sensor.name);
            saveExternalSensorsToStorage(this.tabKey, addedSensors);

            // Добавляем в state.sensorsByName если его там нет
            if (!state.sensorsByName.has(sensor.name)) {
                state.sensorsByName.set(sensor.name, sensorForChart);
                state.sensors.set(sensor.id, sensorForChart);
            }

            // Создаём график
            createExternalSensorChart(this.tabKey, sensorForChart);

            // Подписываемся на IONC датчик (не SM!)
            subscribeToIONCSensor(this.objectName, sensor.id);
        }
        // Не перерисовываем таблицу - checkbox сам обновляется
    }

    updateSensorCount() {
        const countEl = document.getElementById(`ionc-sensor-count-${this.objectName}`);
        if (countEl) {
            const loaded = this.allSensors.length;
            const total = this.totalCount;
            countEl.textContent = this.hasMore ? `${loaded}+` : `${loaded}`;
            countEl.title = `Загружено: ${loaded} из ${total}`;
        }
    }

    showSetDialog(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        const objectName = this.objectName;
        const self = this;

        const body = `
            <div class="ionc-dialog-info">
                Датчик: <strong>${escapeHtml(sensor.name)}</strong> (ID: ${sensorId})<br>
                Текущее значение: <strong>${sensor.value}</strong>
            </div>
            <div class="ionc-dialog-field">
                <label for="ionc-set-value">Новое значение:</label>
                <input type="number" id="ionc-set-value" value="${sensor.value}">
            </div>
        `;

        const footer = `
            <button class="ionc-dialog-btn ionc-dialog-btn-cancel" onclick="closeIoncDialog()">Отмена</button>
            <button class="ionc-dialog-btn ionc-dialog-btn-primary" id="ionc-set-confirm">Применить</button>
        `;

        const doSetValue = async () => {
            const input = document.getElementById('ionc-set-value');
            const value = parseInt(input.value, 10);

            if (isNaN(value)) {
                showIoncDialogError('Введите целое число');
                input.classList.add('error');
                return;
            }

            try {
                const url = self.buildUrl(`/api/objects/${encodeURIComponent(objectName)}/ionc/set`);
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sensor_id: sensorId, value: value })
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Failed to set value');
                }

                // Обновляем локально
                sensor.value = value;
                const valueEl = document.getElementById(`ionc-value-${objectName}-${sensorId}`);
                if (valueEl) valueEl.textContent = value;

                closeIoncDialog();
            } catch (err) {
                showIoncDialogError(`Ошибка: ${err.message}`);
            }
        };

        openIoncDialog({
            title: 'Установить значение',
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
                Датчик: <strong>${escapeHtml(sensor.name)}</strong> (ID: ${sensorId})<br>
                Текущее значение: <strong>${sensor.value}</strong>
            </div>
            <div class="ionc-dialog-field">
                <label for="ionc-freeze-value">Значение заморозки:</label>
                <input type="number" id="ionc-freeze-value" value="${sensor.value}">
                <div class="ionc-dialog-hint">Двойной клик на ❄ — быстрая заморозка на текущем значении</div>
            </div>
        `;

        const footer = `
            <button class="ionc-dialog-btn ionc-dialog-btn-cancel" onclick="closeIoncDialog()">Отмена</button>
            <button class="ionc-dialog-btn ionc-dialog-btn-freeze" id="ionc-freeze-confirm">❄ Заморозить</button>
        `;

        const doFreeze = async () => {
            const input = document.getElementById('ionc-freeze-value');
            const value = parseInt(input.value, 10);

            if (isNaN(value)) {
                showIoncDialogError('Введите целое число');
                input.classList.add('error');
                return;
            }

            try {
                const url = self.buildUrl(`/api/objects/${encodeURIComponent(objectName)}/ionc/freeze`);
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sensor_id: sensorId, value: value })
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Failed to freeze');
                }

                sensor.frozen = true;
                sensor.value = value;
                self.reRenderSensorRow(sensorId);
                closeIoncDialog();
            } catch (err) {
                showIoncDialogError(`Ошибка: ${err.message}`);
            }
        };

        openIoncDialog({
            title: 'Заморозить датчик',
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
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sensor_id: sensorId, value: sensor.value })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to freeze');
            }

            sensor.frozen = true;
            this.reRenderSensorRow(sensorId);
        } catch (err) {
            showIoncDialogError(`Ошибка: ${err.message}`);
        }
    }

    // Разморозка (клик на 🔥)
    async unfreeze(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        try {
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/unfreeze`);
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sensor_id: sensorId })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to unfreeze');
            }

            sensor.frozen = false;
            this.reRenderSensorRow(sensorId);
        } catch (err) {
            showIoncDialogError(`Ошибка: ${err.message}`);
        }
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

        // Кнопка разморозки
        row.querySelector('.ionc-btn-unfreeze')?.addEventListener('click', () => this.unfreeze(sensorId));
    }

    async showConsumersDialog(sensorId) {
        const sensor = this.sensorMap.get(sensorId);
        if (!sensor) return;

        // Показываем диалог с индикатором загрузки
        const loadingBody = `
            <div class="ionc-dialog-info">
                Датчик: <strong>${escapeHtml(sensor.name)}</strong> (ID: ${sensorId})
            </div>
            <div class="ionc-dialog-empty">Загрузка подписчиков...</div>
        `;

        const footer = `
            <button class="ionc-dialog-btn ionc-dialog-btn-cancel" onclick="closeIoncDialog()">Закрыть</button>
        `;

        openIoncDialog({
            title: 'Подписчики датчика',
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
                        Датчик: <strong>${escapeHtml(sensor.name)}</strong> (ID: ${sensorId})
                    </div>
                    <div class="ionc-dialog-empty">Нет подписчиков</div>
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
                        Датчик: <strong>${escapeHtml(sensor.name)}</strong> (ID: ${sensorId})<br>
                        Подписчиков: <strong>${consumers.length}</strong>
                    </div>
                    <div class="ionc-dialog-consumers">
                        <table>
                            <thead>
                                <tr>
                                    <th style="width: 60px">ID</th>
                                    <th>Имя</th>
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
            showIoncDialogError(`Ошибка: ${err.message}`);
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
                    listEl.innerHTML = '<span class="ionc-lost-empty">Нет потерянных подписчиков</span>';
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
        renderObjectInfo(this.objectName, data.object);
        renderLogServer(this.objectName, data.LogServer);

        // Инициализируем LogViewer если есть LogServer
        this.initLogViewer(data.LogServer);
    }

    // Обработка SSE обновления датчика (батчевая версия)
    handleIONCSensorUpdate(sensor) {
        // Обновляем в sensorMap
        if (this.sensorMap.has(sensor.id)) {
            const oldSensor = this.sensorMap.get(sensor.id);
            Object.assign(oldSensor, sensor);
            // Добавляем в очередь на рендеринг
            this.pendingUpdates.set(sensor.id, sensor);
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
            // Обновляем значение
            const valueEl = document.getElementById(`ionc-value-${this.objectName}-${id}`);
            if (valueEl) {
                valueEl.textContent = sensor.value;
                // Добавляем анимацию при обновлении
                valueEl.classList.add('ionc-value-updated');
            }

            // Обновляем флаги если изменились
            const row = document.querySelector(`tr[data-sensor-id="${id}"]`);
            if (row) {
                row.classList.toggle('ionc-sensor-frozen', sensor.frozen);
                row.classList.toggle('ionc-sensor-blocked', sensor.blocked);
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

    // Подписка на SSE обновления для видимых датчиков
    async subscribeToSSE() {
        // Собираем ID датчиков на текущей странице
        const sensorIds = this.sensors.map(s => s.id);
        if (sensorIds.length === 0) return;

        // Сначала отписываемся от старых подписок
        await this.unsubscribeFromSSE();

        try {
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/subscribe`);
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sensor_ids: sensorIds })
            });

            if (response.ok) {
                sensorIds.forEach(id => this.subscribedSensorIds.add(id));
                console.log(`IONC: Подписка на ${sensorIds.length} датчиков для ${this.objectName}`);
            }
        } catch (err) {
            console.warn('IONC: Ошибка подписки на SSE:', err);
        }
    }

    // Отписка от SSE обновлений
    async unsubscribeFromSSE() {
        if (this.subscribedSensorIds.size === 0) return;

        try {
            const url = this.buildUrl(`/api/objects/${encodeURIComponent(this.objectName)}/ionc/unsubscribe`);
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sensor_ids: [] }) // пустой массив = отписка от всех
            });
            this.subscribedSensorIds.clear();
            console.log(`IONC: Отписка от датчиков для ${this.objectName}`);
        } catch (err) {
            console.warn('IONC: Ошибка отписки от SSE:', err);
        }
    }

    destroy() {
        // Отписываемся от SSE обновлений при закрытии
        this.unsubscribeFromSSE();
        // Уничтожаем LogViewer
        this.destroyLogViewer();
    }
}

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
        this.paramNames = [
            'polltime',
            'updatetime',
            'reconnectPause',
            'timeoutIterate',
            'exchangeMode',
            'writeToAllChannels',
            'currentChannel',
            'connectCount',
            'activated',
            'iolistSize',
            'httpControlAllow',
            'httpControlActive',
            'errorHistoryMax'
        ];
        this.diagnostics = null;
        this.loadingNote = '';
        this.diagnosticsHeight = this.loadDiagnosticsHeight();
        this.sensorsHeight = this.loadSensorsHeight();
        this.statusInterval = this.loadStatusInterval();
        this.statusTimer = null;

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
        setupChartsResize(this.objectName);
        this.setupDiagnosticsResize();
        this.setupSensorsResize();
        this.setupVirtualScroll();
        this.startStatusAutoRefresh();
    }

    destroy() {
        this.destroyLogViewer();
        this.stopStatusAutoRefresh();
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
        this.bindStatusIntervalButtons();

        const refreshParams = document.getElementById(`opcua-params-refresh-${this.objectName}`);
        if (refreshParams) {
            refreshParams.addEventListener('click', () => this.loadParams());
        }

        const saveParams = document.getElementById(`opcua-params-save-${this.objectName}`);
        if (saveParams) {
            saveParams.addEventListener('click', () => this.saveParams());
        }

        const refreshSensors = document.getElementById(`opcua-sensors-refresh-${this.objectName}`);
        if (refreshSensors) {
            refreshSensors.addEventListener('click', () => this.loadSensors());
        }

        const filterInput = document.getElementById(`opcua-sensors-filter-${this.objectName}`);
        if (filterInput) {
            filterInput.addEventListener('input', () => {
                clearTimeout(this.filterDebounce);
                this.filterDebounce = setTimeout(() => {
                    this.filter = filterInput.value.trim();
                    this.loadSensors();
                }, 300);
            });
            filterInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    if (filterInput.value) {
                        filterInput.value = '';
                        this.filter = '';
                        this.loadSensors();
                    }
                    filterInput.blur();
                    e.preventDefault();
                }
            });
        }

        const typeFilter = document.getElementById(`opcua-type-filter-${this.objectName}`);
        if (typeFilter) {
            typeFilter.addEventListener('change', () => {
                this.typeFilter = typeFilter.value;
                this.loadSensors();
            });
        }

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

    async fetchJSON(path, options = {}) {
        const url = this.buildUrl(path);
        const response = await fetch(url, options);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
        }
        return response.json();
    }

    createOPCUAStatusSection() {
        return this.createCollapsibleSection('opcua-status', 'Статус OPC UA', `
            <div class="opcua-actions">
                <div class="opcua-autorefresh" id="opcua-status-autorefresh-${this.objectName}">
                    <span class="opcua-autorefresh-label">Авто:</span>
                    ${this.renderStatusIntervalButtons()}
                    <span class="opcua-last-update" id="opcua-status-last-${this.objectName}"></span>
                </div>
                <span class="opcua-note" id="opcua-status-note-${this.objectName}"></span>
            </div>
            <table class="info-table">
                <tbody id="opcua-status-${this.objectName}"></tbody>
            </table>
            <div class="opcua-channels" id="opcua-channels-${this.objectName}"></div>
        `, { sectionId: `opcua-status-section-${this.objectName}` });
    }

    createOPCUAControlSection() {
        return this.createCollapsibleSection('opcua-control', 'HTTP-контроль', `
            <div class="opcua-actions">
                <button class="btn" id="opcua-control-take-${this.objectName}">Перехватить</button>
                <button class="btn" id="opcua-control-release-${this.objectName}">Вернуть</button>
                <span class="opcua-note" id="opcua-control-note-${this.objectName}"></span>
            </div>
            <div class="opcua-flags" id="opcua-control-flags-${this.objectName}"></div>
        `, { sectionId: `opcua-control-section-${this.objectName}` });
    }

    createOPCUAParamsSection() {
        return this.createCollapsibleSection('opcua-params', 'Параметры обмена', `
            <div class="opcua-actions">
                <button class="btn" id="opcua-params-refresh-${this.objectName}">Обновить</button>
                <button class="btn primary" id="opcua-params-save-${this.objectName}">Применить</button>
                <span class="opcua-note" id="opcua-params-note-${this.objectName}"></span>
            </div>
            <div class="opcua-params-table-wrapper">
                <table class="variables-table opcua-params-table">
                    <thead>
                        <tr>
                            <th>Параметр</th>
                            <th>Текущее</th>
                            <th>Новое значение</th>
                        </tr>
                    </thead>
                    <tbody id="opcua-params-${this.objectName}"></tbody>
                </table>
            </div>
        `, { sectionId: `opcua-params-section-${this.objectName}` });
    }

    createOPCUASensorsSection() {
        return this.createCollapsibleSection('opcua-sensors', 'Датчики', `
            <div class="filter-bar opcua-actions">
                <input type="text" class="filter-input" id="opcua-sensors-filter-${this.objectName}" placeholder="Фильтр по имени...">
                <select class="type-filter" id="opcua-type-filter-${this.objectName}">
                    <option value="all">Все типы</option>
                    <option value="AI">AI</option>
                    <option value="AO">AO</option>
                    <option value="DI">DI</option>
                    <option value="DO">DO</option>
                </select>
                <button class="btn" id="opcua-sensors-refresh-${this.objectName}">Обновить</button>
                <span class="sensor-count" id="opcua-sensor-count-${this.objectName}">0</span>
                <span class="opcua-note" id="opcua-sensors-note-${this.objectName}"></span>
            </div>
            <div class="opcua-sensors-container" id="opcua-sensors-container-${this.objectName}" style="height: ${this.sensorsHeight}px">
                <div class="opcua-sensors-viewport" id="opcua-sensors-viewport-${this.objectName}">
                    <div class="opcua-sensors-spacer" id="opcua-sensors-spacer-${this.objectName}"></div>
                    <table class="sensors-table variables-table opcua-sensors-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Имя</th>
                                <th>Тип</th>
                                <th>Значение</th>
                                <th>Tick</th>
                                <th>VType</th>
                                <th>Precision</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody id="opcua-sensors-${this.objectName}"></tbody>
                    </table>
                    <div class="opcua-loading-more" id="opcua-loading-more-${this.objectName}" style="display: none;">Загрузка...</div>
                </div>
                <div class="opcua-sensor-details" id="opcua-sensor-details-${this.objectName}"></div>
            </div>
            <div class="resize-handle" id="opcua-sensors-resize-${this.objectName}"></div>
        `, { sectionId: `opcua-sensors-section-${this.objectName}` });
    }

    createOPCUADiagnosticsSection() {
        return this.createCollapsibleSection('opcua-diagnostics', 'Диагностика', `
            <div class="opcua-actions">
                <button class="btn" id="opcua-diagnostics-refresh-${this.objectName}">Обновить</button>
                <span class="opcua-note" id="opcua-diagnostics-note-${this.objectName}"></span>
            </div>
            <div class="opcua-diagnostics-container" id="opcua-diagnostics-container-${this.objectName}" style="height: ${this.diagnosticsHeight}px">
                <div class="opcua-diagnostics-scroll" id="opcua-diagnostics-${this.objectName}"></div>
            </div>
            <div class="opcua-diagnostics-resize-handle" id="opcua-diagnostics-resize-${this.objectName}"></div>
        `, { sectionId: `opcua-diagnostics-section-${this.objectName}` });
    }

    setNote(id, text, isError = false) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('error', !!(text && isError));
    }

    async loadStatus() {
        try {
            const data = await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/opcua/status`);
            this.status = data.status || null;
            this.renderStatus();
            this.renderControl();
            this.updateStatusTimestamp();
            this.setNote(`opcua-status-note-${this.objectName}`, '');
        } catch (err) {
            this.setNote(`opcua-status-note-${this.objectName}`, err.message, true);
        }
    }

    renderStatus() {
        const tbody = document.getElementById(`opcua-status-${this.objectName}`);
        const channelsContainer = document.getElementById(`opcua-channels-${this.objectName}`);
        if (!tbody || !channelsContainer) return;

        tbody.innerHTML = '';
        channelsContainer.innerHTML = '';

        if (!this.status) {
            tbody.innerHTML = '<tr><td colspan="2" class="text-muted">Нет данных</td></tr>';
            return;
        }

        const status = this.status;
        const rows = [
            { label: 'Подписка', value: this.formatSubscription(status) },
            { label: 'I/O list size', value: status.iolist_size ?? status.iolistSize },
            { label: 'Monitor', value: status.monitor },
            { label: 'httpEnabledSetParams', value: status.httpEnabledSetParams },
            { label: 'httpControlAllow', value: status.httpControlAllow },
            { label: 'httpControlActive', value: status.httpControlActive },
            { label: 'Ошибок в истории', value: status.errorHistorySize },
            { label: 'Лимит истории ошибок', value: status.errorHistoryMax }
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

        if (Array.isArray(status.channels) && status.channels.length > 0) {
            status.channels.forEach(ch => {
                const div = document.createElement('div');
                div.className = 'opcua-channel-card';
                const ok = ch.ok || ch.status === 'OK';
                const disabled = ch.disabled ? 'disabled' : '';
                div.innerHTML = `
                    <div class="opcua-channel-header">
                        <span class="opcua-channel-title">Канал ${ch.index}</span>
                        <span class="opcua-channel-state ${ok ? 'ok' : 'fail'}">${ok ? 'OK' : 'FAIL'}</span>
                    </div>
                    <div class="opcua-channel-body">
                        <div>Адрес: ${ch.addr || ch.address || '—'}</div>
                        <div>Отключен: ${disabled ? 'Да' : 'Нет'}</div>
                    </div>
                `;
                channelsContainer.appendChild(div);
            });
        }
    }

    renderControl() {
        const container = document.getElementById(`opcua-control-flags-${this.objectName}`);
        if (!container) return;

        const allow = this.status?.httpControlAllow;
        const active = this.status?.httpControlActive;
        const enabledParams = this.status?.httpEnabledSetParams;
        const allowText = allow ? 'Перехватить' : 'Контроль запрещён';

        container.innerHTML = `
            <div class="opcua-flag-row">
                <span class="opcua-flag-label">Разрешён контроль:</span>
                <span class="opcua-flag-value ${allow ? 'ok' : 'fail'}">${allow ? 'Да' : 'Нет'}</span>
            </div>
            <div class="opcua-flag-row">
                <span class="opcua-flag-label">HTTP контроль активен:</span>
                <span class="opcua-flag-value ${active ? 'ok' : 'fail'}">${active ? 'Да' : 'Нет'}</span>
            </div>
            <div class="opcua-flag-row">
                <span class="opcua-flag-label">Разрешено менять параметры:</span>
                <span class="opcua-flag-value ${enabledParams ? 'ok' : 'fail'}">${enabledParams ? 'Да' : 'Нет'}</span>
            </div>
        `;

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
            const enabled = sub.enabled ? 'Вкл' : 'Выкл';
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
            this.setNote(`opcua-params-note-${this.objectName}`, '');
        } catch (err) {
            this.setNote(`opcua-params-note-${this.objectName}`, err.message, true);
        }
    }

    renderParams() {
        const tbody = document.getElementById(`opcua-params-${this.objectName}`);
        if (!tbody) return;

        tbody.innerHTML = '';
        if (!this.params || Object.keys(this.params).length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Нет данных</td></tr>';
            return;
        }

        this.paramNames.forEach(name => {
            const current = this.params[name];
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="variable-name">${name}</td>
                <td class="variable-value">${current !== undefined ? formatValue(current) : '—'}</td>
                <td><input class="opcua-param-input" data-name="${name}" value="${current !== undefined ? current : ''}"></td>
            `;
            tbody.appendChild(tr);
        });
    }

    async saveParams() {
        const tbody = document.getElementById(`opcua-params-${this.objectName}`);
        if (!tbody) return;

        const inputs = tbody.querySelectorAll('.opcua-param-input');
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

        if (Object.keys(changed).length === 0) {
            this.setNote(`opcua-params-note-${this.objectName}`, 'Нет изменений');
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
            this.setNote(`opcua-params-note-${this.objectName}`, 'Параметры применены');
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

        try {
            let url = `/api/objects/${encodeURIComponent(this.objectName)}/opcua/sensors?limit=${this.chunkSize}&offset=0`;
            if (this.filter) {
                url += `&filter=${encodeURIComponent(this.filter)}`;
            }
            const data = await this.fetchJSON(url);
            const sensors = data.sensors || [];
            this.sensorsTotal = typeof data.total === 'number' ? data.total : sensors.length;

            // Apply type filter client-side
            this.allSensors = this.typeFilter === 'all'
                ? sensors
                : sensors.filter(s => s.iotype === this.typeFilter);

            this.hasMore = sensors.length === this.chunkSize;
            this.updateVisibleRows();
            this.updateSensorCount();
            this.setNote(`opcua-sensors-note-${this.objectName}`, '');
        } catch (err) {
            this.setNote(`opcua-sensors-note-${this.objectName}`, err.message, true);
        }
    }

    async loadMoreSensors() {
        if (this.isLoadingChunk || !this.hasMore) return;

        this.isLoadingChunk = true;
        this.showLoadingIndicator(true);

        try {
            const nextOffset = this.allSensors.length;
            let url = `/api/objects/${encodeURIComponent(this.objectName)}/opcua/sensors?limit=${this.chunkSize}&offset=${nextOffset}`;
            if (this.filter) {
                url += `&filter=${encodeURIComponent(this.filter)}`;
            }
            const data = await this.fetchJSON(url);
            const newSensors = data.sensors || [];

            // Apply type filter client-side
            const filtered = this.typeFilter === 'all'
                ? newSensors
                : newSensors.filter(s => s.iotype === this.typeFilter);

            this.allSensors = [...this.allSensors, ...filtered];
            this.hasMore = newSensors.length === this.chunkSize;
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

        // Set spacer height to position visible rows correctly
        const spacerHeight = this.startIndex * this.rowHeight;
        spacer.style.height = `${spacerHeight}px`;

        // Show empty state if no sensors
        if (this.allSensors.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="opcua-no-sensors">Нет сенсоров</td></tr>';
            return;
        }

        // Get visible slice
        const visibleSensors = this.allSensors.slice(this.startIndex, this.endIndex);

        // Render visible rows with type badges
        tbody.innerHTML = visibleSensors.map(sensor => {
            const iotype = sensor.iotype || sensor.type || '';
            const typeBadgeClass = iotype ? `type-badge type-${iotype}` : '';
            return `
            <tr data-sensor-id="${sensor.id || ''}">
                <td>${sensor.id ?? '—'}</td>
                <td>${escapeHtml(sensor.name || '')}</td>
                <td><span class="${typeBadgeClass}">${iotype || '—'}</span></td>
                <td>${sensor.value ?? '—'}</td>
                <td>${sensor.tick ?? '—'}</td>
                <td>${sensor.vtype || '—'}</td>
                <td>${sensor.precision ?? '—'}</td>
                <td>${sensor.status || '—'}</td>
            </tr>
        `}).join('');

        // Bind row click events
        tbody.querySelectorAll('tr[data-sensor-id]').forEach(row => {
            row.addEventListener('click', () => {
                const id = row.dataset.sensorId;
                if (id) this.loadSensorDetails(parseInt(id, 10));
            });
        });
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
        const countEl = document.getElementById(`opcua-sensor-count-${this.objectName}`);
        if (countEl) {
            const loaded = this.allSensors.length;
            const total = this.sensorsTotal;
            countEl.textContent = this.hasMore ? `${loaded}+` : `${loaded}`;
            countEl.title = `Загружено: ${loaded} из ${total}`;
        }
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
            container.innerHTML = '<div class="text-muted">Сенсор не найден</div>';
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
                    <div><span class="opcua-sensor-label">Тип:</span> ${sensor.iotype || sensor.type || '—'}</div>
                    <div><span class="opcua-sensor-label">Значение:</span> ${sensor.value ?? '—'}</div>
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
            container.innerHTML = '<div class="text-muted">Нет данных</div>';
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
            html += '<table class="variables-table opcua-errors-table"><thead><tr><th>Время</th><th>Канал</th><th>Операция</th><th>StatusCode</th><th>NodeId</th></tr></thead><tbody>';
            errors.forEach(err => {
                html += `<tr>
                    <td>${err.time || ''}</td>
                    <td>${err.channel ?? ''}</td>
                    <td>${err.operation || ''}</td>
                    <td>${err.statusCode || ''}</td>
                    <td>${escapeHtml(err.nodeid || '')}</td>
                </tr>`;
            });
            html += '</tbody></table>';
        } else {
            html += '<div class="text-muted">Ошибок нет</div>';
        }

        container.innerHTML = html;
    }

    renderStatusIntervalButtons() {
        const options = [
            { label: '5с', ms: 5000 },
            { label: '10с', ms: 10000 },
            { label: '15с', ms: 15000 },
            { label: '1м', ms: 60000 },
            { label: '5м', ms: 300000 }
        ];
        return options.map(opt => {
            const active = this.statusInterval === opt.ms ? 'active' : '';
            return `<button type="button" class="opcua-interval-btn time-range-btn ${active}" data-ms="${opt.ms}">${opt.label}</button>`;
        }).join('');
    }

    bindStatusIntervalButtons() {
        const wrapper = document.getElementById(`opcua-status-autorefresh-${this.objectName}`);
        if (!wrapper) return;
        wrapper.querySelectorAll('.opcua-interval-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const ms = parseInt(btn.dataset.ms, 10);
                if (!isNaN(ms)) {
                    this.statusInterval = ms;
                    this.saveStatusInterval(ms);
                    this.updateStatusIntervalUI();
                    this.startStatusAutoRefresh();
                }
            });
        });
        this.updateStatusIntervalUI();
    }

    updateStatusIntervalUI() {
        const wrapper = document.getElementById(`opcua-status-autorefresh-${this.objectName}`);
        if (!wrapper) return;
        wrapper.querySelectorAll('.opcua-interval-btn').forEach(btn => {
            const ms = parseInt(btn.dataset.ms, 10);
            btn.classList.toggle('active', ms === this.statusInterval);
        });
    }

    updateStatusTimestamp() {
        const el = document.getElementById(`opcua-status-last-${this.objectName}`);
        if (!el) return;
        const now = new Date();
        const hh = now.getHours().toString().padStart(2, '0');
        const mm = now.getMinutes().toString().padStart(2, '0');
        const ss = now.getSeconds().toString().padStart(2, '0');
        el.textContent = `обновлено ${hh}:${mm}:${ss}`;
    }

    startStatusAutoRefresh() {
        this.stopStatusAutoRefresh();
        if (!this.statusInterval || this.statusInterval <= 0) return;
        this.statusTimer = setInterval(() => this.loadStatus(), this.statusInterval);
    }

    stopStatusAutoRefresh() {
        if (this.statusTimer) {
            clearInterval(this.statusTimer);
            this.statusTimer = null;
        }
    }

    loadStatusInterval() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-opcua-status-interval') || '{}');
            const value = saved[this.objectName];
            if (typeof value === 'number' && value > 0) {
                return value;
            }
        } catch (err) {
            console.warn('Failed to load status interval:', err);
        }
        return 5000;
    }

    saveStatusInterval(value) {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-opcua-status-interval') || '{}');
            saved[this.objectName] = value;
            localStorage.setItem('uniset2-viewer-opcua-status-interval', JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save status interval:', err);
        }
    }

    loadDiagnosticsHeight() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-opcua-diagnostics') || '{}');
            const value = saved[this.objectName];
            if (typeof value === 'number' && value > 0) {
                return value;
            }
        } catch (err) {
            console.warn('Failed to load diagnostics height:', err);
        }
        return 260;
    }

    saveDiagnosticsHeight(value) {
        this.diagnosticsHeight = value;
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-opcua-diagnostics') || '{}');
            saved[this.objectName] = value;
            localStorage.setItem('uniset2-viewer-opcua-diagnostics', JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save diagnostics height:', err);
        }
    }

    setupDiagnosticsResize() {
        const handle = document.getElementById(`opcua-diagnostics-resize-${this.objectName}`);
        const container = document.getElementById(`opcua-diagnostics-container-${this.objectName}`);
        if (!handle || !container) return;

        container.style.height = `${this.diagnosticsHeight}px`;

        let startY = 0;
        let startHeight = 0;
        let isResizing = false;

        const onMouseMove = (e) => {
            if (!isResizing) return;
            const delta = e.clientY - startY;
            const newHeight = Math.max(160, Math.min(600, startHeight + delta));
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
                this.saveDiagnosticsHeight(newHeight);
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

    loadSensorsHeight() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-opcua-sensors') || '{}');
            const value = saved[this.objectName];
            if (typeof value === 'number' && value > 0) {
                return value;
            }
        } catch (err) {
            console.warn('Failed to load sensors height:', err);
        }
        return 320;
    }

    saveSensorsHeight(value) {
        this.sensorsHeight = value;
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-opcua-sensors') || '{}');
            saved[this.objectName] = value;
            localStorage.setItem('uniset2-viewer-opcua-sensors', JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save sensors height:', err);
        }
    }

    setupSensorsResize() {
        const handle = document.getElementById(`opcua-sensors-resize-${this.objectName}`);
        const container = document.getElementById(`opcua-sensors-container-${this.objectName}`);
        if (!handle || !container) return;

        container.style.height = `${this.sensorsHeight}px`;

        let startY = 0;
        let startHeight = 0;
        let isResizing = false;

        const onMouseMove = (e) => {
            if (!isResizing) return;
            const delta = e.clientY - startY;
            const newHeight = Math.max(200, Math.min(700, startHeight + delta));
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
                this.saveSensorsHeight(newHeight);
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

    async takeControl() {
        if (this.status && this.status.httpControlAllow === false) {
            this.setNote(`opcua-control-note-${this.objectName}`, 'Контроль запрещён', true);
            return;
        }

        try {
            await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/opcua/control/take`, { method: 'POST' });
            this.setNote(`opcua-control-note-${this.objectName}`, 'HTTP контроль активирован');
            this.loadStatus();
        } catch (err) {
            this.setNote(`opcua-control-note-${this.objectName}`, err.message, true);
        }
    }

    async releaseControl() {
        if (this.status && this.status.httpControlAllow === false) {
            this.setNote(`opcua-control-note-${this.objectName}`, 'Контроль запрещён', true);
            return;
        }

        try {
            await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/opcua/control/release`, { method: 'POST' });
            this.setNote(`opcua-control-note-${this.objectName}`, 'Контроль возвращён сенсору');
            this.loadStatus();
        } catch (err) {
            this.setNote(`opcua-control-note-${this.objectName}`, err.message, true);
        }
    }

    update(data) {
        renderObjectInfo(this.objectName, data.object);
        renderLogServer(this.objectName, data.LogServer);
        updateChartLegends(this.objectName, data);
        this.initLogViewer(data.LogServer);
    }
}

// Регистрируем стандартные рендереры
registerRenderer('UniSetManager', UniSetManagerRenderer);
registerRenderer('UniSetObject', UniSetObjectRenderer);
registerRenderer('IONotifyController', IONotifyControllerRenderer);
registerRenderer('OPCUAExchange', OPCUAExchangeRenderer);

// ============================================================================
// Конец системы рендереров
// ============================================================================

// ============================================================================
// LogViewer - компонент для просмотра логов в реальном времени
// ============================================================================

// Уровни логов UniSet2
const LOG_LEVELS = {
    NONE: 0,
    CRIT: 1,
    WARN: 2,
    INFO: 4,
    DEBUG: 8,
    LEVEL1: 16,
    LEVEL2: 32,
    LEVEL3: 64,
    LEVEL4: 128,
    LEVEL5: 256,
    LEVEL6: 512,
    LEVEL7: 1024,
    LEVEL8: 2048,
    LEVEL9: 4096,
    ANY: 0xFFFFFFFF
};

// Класс для управления просмотром логов объекта
class LogViewer {
    constructor(objectName, container, serverId = null) {
        this.objectName = objectName;
        this.container = container;
        this.serverId = serverId;
        this.eventSource = null;
        this.connected = false;
        this.isActive = false; // true если идёт попытка подключения или переподключения
        this.lines = [];
        this.maxLines = 10000;
        this.autoScroll = true;
        this.currentLevel = 0; // 0 = по умолчанию (не отправлять setLevel)
        this.selectedLevels = new Set(); // выбранные уровни логов
        this.levelDropdownOpen = false;
        this.filter = '';
        this.filterRegex = true; // использовать regexp
        this.filterCase = false; // учитывать регистр
        this.filterOnlyMatches = false; // показывать только совпадения
        this.height = 200;
        this.hasReceivedLogs = false; // Получали ли логи
        this.matchCount = 0; // количество совпадений
        this.paused = false; // пауза автопрокрутки
        this.pausedBuffer = []; // буфер логов во время паузы

        this.init();
    }

    init() {
        this.render();
        this.setupEventHandlers();
        this.loadSavedHeight();
    }

    render() {
        const html = `
            <div class="logviewer-section" data-object="${this.objectName}" id="logviewer-section-${this.objectName}">
                <div class="logviewer-header" data-toggle="logviewer">
                    <svg class="collapsible-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M6 9l6 6 6-6"/>
                    </svg>
                    <span class="logviewer-title">Логи</span>
                    <div class="logviewer-controls" onclick="event.stopPropagation()">
                        <div class="log-level-wrapper" id="log-level-wrapper-${this.objectName}">
                            <button class="log-level-btn" id="log-level-btn-${this.objectName}" title="Выбор уровней логов">
                                Уровни ▼
                            </button>
                            <div class="log-level-dropdown" id="log-level-dropdown-${this.objectName}">
                                <div class="log-level-pills">
                                    <button class="log-level-pill" data-level="CRIT">CRIT</button>
                                    <button class="log-level-pill" data-level="WARN">WARN</button>
                                    <button class="log-level-pill" data-level="INFO">INFO</button>
                                    <button class="log-level-pill" data-level="DEBUG">DEBUG</button>
                                </div>
                                <div class="log-level-pills">
                                    <button class="log-level-pill" data-level="LEVEL1">LVL1</button>
                                    <button class="log-level-pill" data-level="LEVEL2">LVL2</button>
                                    <button class="log-level-pill" data-level="LEVEL3">LVL3</button>
                                    <button class="log-level-pill" data-level="LEVEL4">LVL4</button>
                                    <button class="log-level-pill" data-level="LEVEL5">LVL5</button>
                                </div>
                                <div class="log-level-pills">
                                    <button class="log-level-pill" data-level="LEVEL6">LVL6</button>
                                    <button class="log-level-pill" data-level="LEVEL7">LVL7</button>
                                    <button class="log-level-pill" data-level="LEVEL8">LVL8</button>
                                    <button class="log-level-pill" data-level="LEVEL9">LVL9</button>
                                    <button class="log-level-pill" data-level="ANY">ALL</button>
                                </div>
                                <div class="log-level-presets">
                                    <button class="log-preset-btn" data-preset="errors">Ошибки</button>
                                    <button class="log-preset-btn" data-preset="info">Инфо+</button>
                                    <button class="log-preset-btn" data-preset="all">Всё</button>
                                    <button class="log-preset-btn" data-preset="reset">Сброс</button>
                                </div>
                                <button class="log-level-apply" id="log-level-apply-${this.objectName}">Применить</button>
                            </div>
                        </div>
                        <div class="log-filter-wrapper">
                            <input type="text" class="log-filter-input" id="log-filter-${this.objectName}"
                                   placeholder="Фильтр (/ для фокуса)..." title="Фильтр (/ для фокуса, Esc для очистки)">
                            <div class="log-filter-options">
                                <label class="log-filter-option" title="Регулярные выражения">
                                    <input type="checkbox" id="log-filter-regex-${this.objectName}" checked> Regex
                                </label>
                                <label class="log-filter-option" title="Учитывать регистр">
                                    <input type="checkbox" id="log-filter-case-${this.objectName}"> Case
                                </label>
                                <label class="log-filter-option" title="Только совпадения">
                                    <input type="checkbox" id="log-filter-only-${this.objectName}"> Только
                                </label>
                            </div>
                            <span class="log-match-count" id="log-match-count-${this.objectName}"></span>
                        </div>
                        <div class="log-controls-spacer"></div>
                        <span class="log-stats" id="log-stats-${this.objectName}"></span>
                        <div class="logviewer-status">
                            <span class="logviewer-status-dot" id="log-status-dot-${this.objectName}"></span>
                            <span id="log-status-text-${this.objectName}">Отключено</span>
                        </div>
                        <button class="log-pause-btn" id="log-pause-${this.objectName}" title="Пауза/Продолжить (Esc)">
                            <span class="pause-icon">⏸</span>
                            <span class="pause-count" id="log-pause-count-${this.objectName}"></span>
                        </button>
                        <button class="log-connect-btn" id="log-connect-${this.objectName}">Подключить</button>
                        <select class="log-buffer-select" id="log-buffer-${this.objectName}" title="Размер буфера">
                            <option value="500">500</option>
                            <option value="1000">1000</option>
                            <option value="2000">2000</option>
                            <option value="5000">5000</option>
                            <option value="10000" selected>10000</option>
                            <option value="20000">20000</option>
                            <option value="50000">50000</option>
                        </select>
                        <button class="log-download-btn" id="log-download-${this.objectName}" title="Скачать логи">💾</button>
                        <button class="log-clear-btn" id="log-clear-${this.objectName}" title="Очистить">Очистить</button>
                    </div>
                    <div class="section-reorder-buttons" onclick="event.stopPropagation()">
                        <button class="section-move-btn section-move-up" onclick="moveSectionUp('${this.tabKey}', 'logviewer')" title="Переместить вверх">↑</button>
                        <button class="section-move-btn section-move-down" onclick="moveSectionDown('${this.tabKey}', 'logviewer')" title="Переместить вниз">↓</button>
                    </div>
                </div>
                <div class="logviewer-content">
                    <div class="log-container" id="log-container-${this.objectName}" style="height: ${this.height}px">
                        <div class="log-placeholder" id="log-placeholder-${this.objectName}">
                            <span class="log-placeholder-icon">📋</span>
                            <span>Нажмите "Подключить" для просмотра логов</span>
                        </div>
                        <div class="log-waiting" id="log-waiting-${this.objectName}" style="display: none">
                            <span class="log-waiting-text">Ожидание сообщений...</span>
                            <span class="log-waiting-hint">Выберите уровень логов или дождитесь сообщений от процесса</span>
                        </div>
                        <div class="log-lines" id="log-lines-${this.objectName}" style="display: none"></div>
                    </div>
                    <div class="logviewer-resize-handle" id="log-resize-${this.objectName}"></div>
                </div>
            </div>
        `;
        this.container.innerHTML = html;
    }

    setupEventHandlers() {
        // Toggle collapse
        const header = this.container.querySelector('.logviewer-header');
        header.addEventListener('click', (e) => {
            if (e.target.closest('.logviewer-controls')) return;
            this.toggleCollapse();
        });

        // Connect button
        const connectBtn = document.getElementById(`log-connect-${this.objectName}`);
        connectBtn.addEventListener('click', () => {
            if (this.isActive) {
                this.disconnect();
            } else {
                this.connect();
            }
        });

        // Clear button
        const clearBtn = document.getElementById(`log-clear-${this.objectName}`);
        clearBtn.addEventListener('click', () => this.clear());

        // Download button
        const downloadBtn = document.getElementById(`log-download-${this.objectName}`);
        downloadBtn.addEventListener('click', () => this.downloadLogs());

        // Pause button
        const pauseBtn = document.getElementById(`log-pause-${this.objectName}`);
        pauseBtn.addEventListener('click', () => this.togglePause());

        // Level dropdown
        this.setupLevelDropdown();

        // Filter input with local filtering
        const filterInput = document.getElementById(`log-filter-${this.objectName}`);
        let filterTimeout = null;
        filterInput.addEventListener('input', (e) => {
            clearTimeout(filterTimeout);
            filterTimeout = setTimeout(() => {
                this.filter = e.target.value;
                this.applyFilter();
            }, 300);
        });

        // Filter options
        const regexCheckbox = document.getElementById(`log-filter-regex-${this.objectName}`);
        regexCheckbox.addEventListener('change', (e) => {
            this.filterRegex = e.target.checked;
            this.saveFilterOptions();
            this.applyFilter();
        });

        const caseCheckbox = document.getElementById(`log-filter-case-${this.objectName}`);
        caseCheckbox.addEventListener('change', (e) => {
            this.filterCase = e.target.checked;
            this.saveFilterOptions();
            this.applyFilter();
        });

        const onlyCheckbox = document.getElementById(`log-filter-only-${this.objectName}`);
        onlyCheckbox.addEventListener('change', (e) => {
            this.filterOnlyMatches = e.target.checked;
            this.saveFilterOptions();
            this.applyFilter();
        });

        // Hotkey "/" for filter focus, Esc for pause toggle
        document.addEventListener('keydown', (e) => {
            // Check if LogViewer section is visible
            const section = document.getElementById(`logviewer-section-${this.objectName}`);
            if (!section || section.classList.contains('collapsed')) return;

            if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                filterInput.focus();
            }
            if (e.key === 'Escape') {
                if (document.activeElement === filterInput) {
                    // Clear filter and blur
                    filterInput.value = '';
                    this.filter = '';
                    this.applyFilter();
                    filterInput.blur();
                } else if (document.activeElement.tagName !== 'INPUT') {
                    // Toggle pause when not in input
                    this.togglePause();
                }
            }
        });

        // Buffer size select
        const bufferSelect = document.getElementById(`log-buffer-${this.objectName}`);
        bufferSelect.addEventListener('change', (e) => {
            this.maxLines = parseInt(e.target.value);
            this.saveBufferSize();
            this.updateStats();
        });

        // Resize handle
        this.setupResize();

        // Auto-scroll on container scroll
        const logContainer = document.getElementById(`log-container-${this.objectName}`);
        logContainer.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = logContainer;
            this.autoScroll = scrollHeight - scrollTop - clientHeight < 50;
        });

        // Load saved settings
        this.loadSavedLevels();
        this.loadSavedBufferSize();
        this.loadFilterOptions();
    }

    saveFilterOptions() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-filter-options') || '{}');
            saved[this.objectName] = {
                regex: this.filterRegex,
                case: this.filterCase,
                only: this.filterOnlyMatches
            };
            localStorage.setItem('uniset2-viewer-filter-options', JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save filter options:', err);
        }
    }

    loadFilterOptions() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-filter-options') || '{}');
            if (saved[this.objectName]) {
                const opts = saved[this.objectName];
                this.filterRegex = opts.regex !== undefined ? opts.regex : true;
                this.filterCase = opts.case !== undefined ? opts.case : false;
                this.filterOnlyMatches = opts.only !== undefined ? opts.only : false;

                // Update checkboxes
                const regexCheckbox = document.getElementById(`log-filter-regex-${this.objectName}`);
                const caseCheckbox = document.getElementById(`log-filter-case-${this.objectName}`);
                const onlyCheckbox = document.getElementById(`log-filter-only-${this.objectName}`);

                if (regexCheckbox) regexCheckbox.checked = this.filterRegex;
                if (caseCheckbox) caseCheckbox.checked = this.filterCase;
                if (onlyCheckbox) onlyCheckbox.checked = this.filterOnlyMatches;
            }
        } catch (err) {
            console.warn('Failed to load filter options:', err);
        }
    }

    saveBufferSize() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-buffersize') || '{}');
            saved[this.objectName] = this.maxLines;
            localStorage.setItem('uniset2-viewer-buffersize', JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save buffer size:', err);
        }
    }

    loadSavedBufferSize() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-buffersize') || '{}');
            if (saved[this.objectName]) {
                this.maxLines = saved[this.objectName];
                const bufferSelect = document.getElementById(`log-buffer-${this.objectName}`);
                if (bufferSelect) {
                    bufferSelect.value = this.maxLines;
                }
            }
        } catch (err) {
            console.warn('Failed to load buffer size:', err);
        }
    }

    setupLevelDropdown() {
        const btn = document.getElementById(`log-level-btn-${this.objectName}`);
        const dropdown = document.getElementById(`log-level-dropdown-${this.objectName}`);
        const wrapper = document.getElementById(`log-level-wrapper-${this.objectName}`);

        // Toggle dropdown
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.levelDropdownOpen = !this.levelDropdownOpen;
            dropdown.classList.toggle('open', this.levelDropdownOpen);
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target) && this.levelDropdownOpen) {
                this.levelDropdownOpen = false;
                dropdown.classList.remove('open');
            }
        });

        // Level pills
        const pills = dropdown.querySelectorAll('.log-level-pill');
        pills.forEach(pill => {
            pill.addEventListener('click', (e) => {
                e.stopPropagation();
                const level = pill.dataset.level;
                if (level === 'ANY') {
                    // ANY toggles all levels
                    if (this.selectedLevels.has('ANY')) {
                        this.selectedLevels.clear();
                    } else {
                        this.selectedLevels.clear();
                        this.selectedLevels.add('ANY');
                    }
                } else {
                    // Remove ANY if specific level selected
                    this.selectedLevels.delete('ANY');
                    if (this.selectedLevels.has(level)) {
                        this.selectedLevels.delete(level);
                    } else {
                        this.selectedLevels.add(level);
                    }
                }
                this.updatePillsUI();
            });
        });

        // Presets
        const presets = dropdown.querySelectorAll('.log-preset-btn');
        presets.forEach(preset => {
            preset.addEventListener('click', (e) => {
                e.stopPropagation();
                const type = preset.dataset.preset;
                this.selectedLevels.clear();
                switch (type) {
                    case 'errors':
                        this.selectedLevels.add('CRIT');
                        this.selectedLevels.add('WARN');
                        break;
                    case 'info':
                        this.selectedLevels.add('CRIT');
                        this.selectedLevels.add('WARN');
                        this.selectedLevels.add('INFO');
                        break;
                    case 'all':
                        this.selectedLevels.add('ANY');
                        break;
                    case 'reset':
                        // Already cleared
                        break;
                }
                this.updatePillsUI();
            });
        });

        // Apply button
        const applyBtn = document.getElementById(`log-level-apply-${this.objectName}`);
        applyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.applyLevelSelection();
            this.levelDropdownOpen = false;
            dropdown.classList.remove('open');
        });
    }

    updatePillsUI() {
        const dropdown = document.getElementById(`log-level-dropdown-${this.objectName}`);
        const pills = dropdown.querySelectorAll('.log-level-pill');
        pills.forEach(pill => {
            const level = pill.dataset.level;
            pill.classList.toggle('active', this.selectedLevels.has(level));
        });

        // Update button text to show selected count
        const btn = document.getElementById(`log-level-btn-${this.objectName}`);
        if (this.selectedLevels.size === 0) {
            btn.textContent = 'Уровни ▼';
        } else if (this.selectedLevels.has('ANY')) {
            btn.textContent = 'Все ▼';
        } else {
            btn.textContent = `Уровни (${this.selectedLevels.size}) ▼`;
        }
    }

    applyLevelSelection() {
        // Calculate combined mask
        let mask = 0;
        if (this.selectedLevels.has('ANY')) {
            mask = LOG_LEVELS.ANY;
        } else {
            this.selectedLevels.forEach(level => {
                if (LOG_LEVELS[level]) {
                    mask |= LOG_LEVELS[level];
                }
            });
        }

        this.currentLevel = mask;
        this.saveLevels();

        // Send to server if connected
        if (this.connected && mask > 0) {
            this.sendCommand('setLevel', mask);
        }
    }

    saveLevels() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-loglevels') || '{}');
            saved[this.objectName] = Array.from(this.selectedLevels);
            localStorage.setItem('uniset2-viewer-loglevels', JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save log levels:', err);
        }
    }

    loadSavedLevels() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset2-viewer-loglevels') || '{}');
            if (saved[this.objectName]) {
                this.selectedLevels = new Set(saved[this.objectName]);
                this.updatePillsUI();
                // Calculate mask for currentLevel
                let mask = 0;
                if (this.selectedLevels.has('ANY')) {
                    mask = LOG_LEVELS.ANY;
                } else {
                    this.selectedLevels.forEach(level => {
                        if (LOG_LEVELS[level]) {
                            mask |= LOG_LEVELS[level];
                        }
                    });
                }
                this.currentLevel = mask;
            }
        } catch (err) {
            console.warn('Failed to load log levels:', err);
        }
    }

    setupResize() {
        const resizeHandle = document.getElementById(`log-resize-${this.objectName}`);
        const logContainer = document.getElementById(`log-container-${this.objectName}`);

        let startY = 0;
        let startHeight = 0;
        let isResizing = false;

        const onMouseMove = (e) => {
            if (!isResizing) return;
            const delta = e.clientY - startY;
            const newHeight = Math.max(100, Math.min(600, startHeight + delta));
            logContainer.style.height = `${newHeight}px`;
            this.height = newHeight;
        };

        const onMouseUp = () => {
            if (!isResizing) return;
            isResizing = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            this.saveHeight();
        };

        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isResizing = true;
            startY = e.clientY;
            startHeight = logContainer.offsetHeight;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
        });
    }

    toggleCollapse() {
        const section = document.getElementById(`logviewer-section-${this.objectName}`);
        section.classList.toggle('collapsed');
        this.saveCollapsedState();
    }

    connect() {
        if (this.eventSource) {
            this.eventSource.close();
        }

        this.isActive = true;
        this.updateStatus('connecting');

        // Собираем query параметры
        const params = new URLSearchParams();
        if (this.filter) {
            params.set('filter', this.filter);
        }
        if (this.serverId) {
            params.set('server', this.serverId);
        }
        const queryString = params.toString();
        const url = `/api/logs/${encodeURIComponent(this.objectName)}/stream${queryString ? '?' + queryString : ''}`;

        this.eventSource = new EventSource(url);

        this.eventSource.addEventListener('connected', (e) => {
            this.connected = true;
            this.hasReceivedLogs = false;
            this.updateStatus('connected');
            this.showWaiting(); // Показываем "ожидание сообщений"

            // НЕ отправляем setLevel автоматически - пользователь сам выбирает
            // Если уровень уже был выбран до подключения, отправляем его
            if (this.currentLevel > 0) {
                this.sendCommand('setLevel', this.currentLevel);
            }

            try {
                const data = JSON.parse(e.data);
                console.log(`LogViewer: Connected to ${data.host}:${data.port}`);
            } catch (err) {
                console.log('LogViewer: Connected');
            }
        });

        this.eventSource.addEventListener('log', (e) => {
            this.addLine(e.data);
        });

        this.eventSource.addEventListener('disconnected', () => {
            this.connected = false;
            // isActive остаётся true - EventSource будет пытаться переподключиться
            this.updateStatus('reconnecting');
            console.log('LogViewer: Disconnected, will reconnect');
        });

        this.eventSource.addEventListener('error', (e) => {
            if (e.data) {
                this.addLine(`[ERROR] ${e.data}`, 'error');
            }
            this.connected = false;
            // isActive остаётся true - EventSource будет пытаться переподключиться
            this.updateStatus('reconnecting');
        });

        this.eventSource.onerror = () => {
            if (this.connected) {
                this.connected = false;
                // isActive остаётся true - EventSource будет пытаться переподключиться
                this.updateStatus('reconnecting');
            }
        };
    }

    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.connected = false;
        this.isActive = false;
        this.updateStatus('disconnected');
    }

    async sendCommand(command, level = 0, filter = '') {
        try {
            await fetch(`/api/logs/${encodeURIComponent(this.objectName)}/command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command, level, filter })
            });
        } catch (err) {
            console.error('LogViewer: Failed to send command', err);
        }
    }

    addLine(text, type = '') {
        // При первом логе скрываем "ожидание" и показываем логи
        if (!this.hasReceivedLogs) {
            this.hasReceivedLogs = true;
            this.showLogLines();
        }

        const line = { text, type, timestamp: new Date() };

        // Если на паузе - накапливаем в буфер
        if (this.paused) {
            this.pausedBuffer.push(line);
            this.updatePauseCount();
            return;
        }

        this.lines.push(line);

        // Limit lines - also need to remove from DOM
        if (this.lines.length > this.maxLines) {
            this.lines = this.lines.slice(-this.maxLines);
            // Remove old lines from DOM
            const linesContainer = document.getElementById(`log-lines-${this.objectName}`);
            if (linesContainer && linesContainer.children.length > this.maxLines) {
                const toRemove = linesContainer.children.length - this.maxLines;
                for (let i = 0; i < toRemove; i++) {
                    linesContainer.removeChild(linesContainer.firstChild);
                }
            }
        }

        const matches = this.renderLine(line, this.lines.length - 1);
        if (matches) {
            this.matchCount++;
            this.updateMatchCount();
        }
        this.updateStats();
        this.scrollToBottom();
    }

    renderLine(line, index = -1) {
        const linesContainer = document.getElementById(`log-lines-${this.objectName}`);
        if (!linesContainer) return;

        const div = document.createElement('div');
        div.className = 'log-line';
        if (index >= 0) {
            div.dataset.index = index;
        }

        // Detect log level from text
        const levelClass = this.detectLogLevel(line.text);
        if (levelClass) {
            div.classList.add(levelClass);
        }
        if (line.type === 'error') {
            div.classList.add('log-level-crit');
        }

        // Apply filter highlighting
        const { html, matches } = this.highlightText(line.text);
        if (matches) {
            div.innerHTML = html;
            div.classList.add('has-match');
        } else {
            div.textContent = line.text;
            if (this.filterOnlyMatches && this.filter) {
                div.classList.add('hidden');
            }
        }

        linesContainer.appendChild(div);
        return matches;
    }

    highlightText(text) {
        if (!this.filter) {
            return { html: text, matches: false };
        }

        try {
            let regex;
            if (this.filterRegex) {
                const flags = this.filterCase ? 'g' : 'gi';
                regex = new RegExp(`(${this.filter})`, flags);
            } else {
                const escaped = this.filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const flags = this.filterCase ? 'g' : 'gi';
                regex = new RegExp(`(${escaped})`, flags);
            }

            if (regex.test(text)) {
                // Reset lastIndex after test
                regex.lastIndex = 0;
                const html = text.replace(regex, '<mark class="log-highlight">$1</mark>');
                return { html, matches: true };
            }
        } catch (e) {
            // Invalid regex - just return text
        }

        return { html: text, matches: false };
    }

    applyFilter() {
        const linesContainer = document.getElementById(`log-lines-${this.objectName}`);
        if (!linesContainer) return;

        // Re-render all lines with filter
        linesContainer.innerHTML = '';
        this.matchCount = 0;

        this.lines.forEach((line, index) => {
            const matches = this.renderLine(line, index);
            if (matches) {
                this.matchCount++;
            }
        });

        // Update match count display
        this.updateMatchCount();
        this.updateStats();
        this.scrollToBottom();
    }

    updateMatchCount() {
        const countEl = document.getElementById(`log-match-count-${this.objectName}`);
        if (countEl) {
            if (this.filter && this.matchCount > 0) {
                countEl.textContent = `${this.matchCount} совп.`;
                countEl.classList.add('has-matches');
            } else if (this.filter) {
                countEl.textContent = '0 совп.';
                countEl.classList.remove('has-matches');
            } else {
                countEl.textContent = '';
                countEl.classList.remove('has-matches');
            }
        }
    }

    updateStats() {
        const statsEl = document.getElementById(`log-stats-${this.objectName}`);
        if (statsEl) {
            statsEl.textContent = `${this.lines.length} / ${this.maxLines}`;
        }
    }

    togglePause() {
        this.paused = !this.paused;
        this.updatePauseUI();

        if (!this.paused) {
            // При снятии паузы - выгружаем накопленный буфер
            this.flushPausedBuffer();
        }
    }

    updatePauseUI() {
        const pauseBtn = document.getElementById(`log-pause-${this.objectName}`);
        const pauseIcon = pauseBtn?.querySelector('.pause-icon');

        if (pauseBtn) {
            pauseBtn.classList.toggle('paused', this.paused);
            if (pauseIcon) {
                pauseIcon.textContent = this.paused ? '▶' : '⏸';
            }
        }
        this.updatePauseCount();
    }

    updatePauseCount() {
        const countEl = document.getElementById(`log-pause-count-${this.objectName}`);
        if (countEl) {
            if (this.paused && this.pausedBuffer.length > 0) {
                countEl.textContent = `+${this.pausedBuffer.length}`;
                countEl.style.display = 'inline';
            } else {
                countEl.textContent = '';
                countEl.style.display = 'none';
            }
        }
    }

    flushPausedBuffer() {
        if (this.pausedBuffer.length === 0) return;

        // Добавляем все накопленные строки
        this.pausedBuffer.forEach(line => {
            this.lines.push(line);
        });

        // Ограничиваем размер
        if (this.lines.length > this.maxLines) {
            this.lines = this.lines.slice(-this.maxLines);
        }

        // Очищаем буфер
        this.pausedBuffer = [];
        this.updatePauseCount();

        // Перерисовываем все строки с учётом фильтра
        this.applyFilter();
    }

    downloadLogs() {
        if (this.lines.length === 0) return;

        const content = this.lines.map(line => line.text).join('\n');
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `logs-${this.objectName}-${timestamp}.txt`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    detectLogLevel(text) {
        const lower = text.toLowerCase();
        if (lower.includes('crit') || lower.includes('fatal') || lower.includes('error')) {
            return 'log-level-crit';
        }
        if (lower.includes('warn')) {
            return 'log-level-warn';
        }
        if (lower.includes('info')) {
            return 'log-level-info';
        }
        if (lower.includes('debug') || lower.includes('level')) {
            return 'log-level-debug';
        }
        return '';
    }

    scrollToBottom() {
        if (!this.autoScroll) return;
        const container = document.getElementById(`log-container-${this.objectName}`);
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    showWaiting() {
        const placeholder = document.getElementById(`log-placeholder-${this.objectName}`);
        const waiting = document.getElementById(`log-waiting-${this.objectName}`);
        const lines = document.getElementById(`log-lines-${this.objectName}`);
        if (placeholder) placeholder.style.display = 'none';
        if (waiting) waiting.style.display = 'flex';
        if (lines) lines.style.display = 'none';
    }

    showLogLines() {
        const placeholder = document.getElementById(`log-placeholder-${this.objectName}`);
        const waiting = document.getElementById(`log-waiting-${this.objectName}`);
        const lines = document.getElementById(`log-lines-${this.objectName}`);
        if (placeholder) placeholder.style.display = 'none';
        if (waiting) waiting.style.display = 'none';
        if (lines) lines.style.display = 'block';
    }

    clear() {
        this.lines = [];
        const linesContainer = document.getElementById(`log-lines-${this.objectName}`);
        if (linesContainer) {
            linesContainer.innerHTML = '';
        }
    }

    updateStatus(status) {
        const dot = document.getElementById(`log-status-dot-${this.objectName}`);
        const text = document.getElementById(`log-status-text-${this.objectName}`);
        const btn = document.getElementById(`log-connect-${this.objectName}`);

        if (!dot || !text || !btn) return;

        dot.className = 'logviewer-status-dot';
        btn.classList.remove('connected', 'reconnecting');

        switch (status) {
            case 'connected':
                dot.classList.add('connected');
                text.textContent = 'Подключено';
                btn.textContent = 'Отключить';
                btn.classList.add('connected');
                break;
            case 'connecting':
                dot.classList.add('connecting');
                text.textContent = 'Подключение...';
                btn.textContent = 'Остановить';
                break;
            case 'reconnecting':
                dot.classList.add('reconnecting');
                text.textContent = 'Переподключение...';
                btn.textContent = 'Остановить';
                btn.classList.add('reconnecting');
                break;
            default: // disconnected
                text.textContent = 'Отключено';
                btn.textContent = 'Подключить';
        }
    }

    saveHeight() {
        try {
            const heights = JSON.parse(localStorage.getItem('uniset2-viewer-logheights') || '{}');
            heights[this.objectName] = this.height;
            localStorage.setItem('uniset2-viewer-logheights', JSON.stringify(heights));
        } catch (err) {
            console.warn('Failed to save log height:', err);
        }
    }

    loadSavedHeight() {
        try {
            const heights = JSON.parse(localStorage.getItem('uniset2-viewer-logheights') || '{}');
            if (heights[this.objectName]) {
                this.height = heights[this.objectName];
                const container = document.getElementById(`log-container-${this.objectName}`);
                if (container) {
                    container.style.height = `${this.height}px`;
                }
            }
        } catch (err) {
            console.warn('Failed to load log height:', err);
        }
    }

    saveCollapsedState() {
        const section = document.getElementById(`logviewer-section-${this.objectName}`);
        const collapsed = section.classList.contains('collapsed');
        state.collapsedSections[`logviewer-${this.objectName}`] = collapsed;
        saveCollapsedSections();
    }

    restoreCollapsedState() {
        if (state.collapsedSections[`logviewer-${this.objectName}`]) {
            const section = document.getElementById(`logviewer-section-${this.objectName}`);
            section?.classList.add('collapsed');
        }
    }

    destroy() {
        this.disconnect();
    }
}

// ============================================================================
// Конец LogViewer
// ============================================================================

// Цвета для графиков
const chartColors = [
    '#3274d9', '#73bf69', '#ff9830', '#f2495c',
    '#b877d9', '#5794f2', '#fade2a', '#ff6eb4'
];
let colorIndex = 0;

function getNextColor() {
    const color = chartColors[colorIndex % chartColors.length];
    colorIndex++;
    return color;
}

// API вызовы
async function fetchServers() {
    const response = await fetch('/api/servers');
    if (!response.ok) return null;
    return response.json();
}

async function fetchObjects() {
    // Загружаем список серверов
    const serversData = await fetchServers();
    if (!serversData || !serversData.servers) {
        throw new Error('Не удалось загрузить список серверов');
    }

    state.servers.clear();
    serversData.servers.forEach(server => {
        state.servers.set(server.id, {
            id: server.id,
            url: server.url,
            name: server.name || server.url,
            connected: server.connected
        });
    });

    // Загружаем объекты со всех серверов
    const response = await fetch('/api/all-objects');
    if (!response.ok) throw new Error('Не удалось загрузить список объектов');
    return response.json();
}

async function fetchObjectData(name, serverId = null) {
    let url = `/api/objects/${encodeURIComponent(name)}`;
    if (serverId) {
        url += `?server=${encodeURIComponent(serverId)}`;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error('Не удалось загрузить данные объекта');
    return response.json();
}

async function watchObject(name, serverId = null) {
    let url = `/api/objects/${encodeURIComponent(name)}/watch`;
    if (serverId) {
        url += `?server=${encodeURIComponent(serverId)}`;
    }
    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) throw new Error('Не удалось начать наблюдение');
    return response.json();
}

async function unwatchObject(name, serverId = null) {
    let url = `/api/objects/${encodeURIComponent(name)}/watch`;
    if (serverId) {
        url += `?server=${encodeURIComponent(serverId)}`;
    }
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) throw new Error('Не удалось остановить наблюдение');
    return response.json();
}

async function fetchVariableHistory(objectName, variableName, count = 100) {
    const response = await fetch(
        `/api/objects/${encodeURIComponent(objectName)}/variables/${encodeURIComponent(variableName)}/history?count=${count}`
    );
    if (!response.ok) throw new Error('Не удалось загрузить историю');
    return response.json();
}

async function fetchSensors() {
    const response = await fetch('/api/sensors');
    if (!response.ok) return { sensors: [], count: 0 };
    return response.json();
}

async function fetchSMSensors() {
    const response = await fetch('/api/sm/sensors');
    if (!response.ok) return { sensors: [], count: 0 };
    return response.json();
}

// Загрузка конфигурации сенсоров
async function loadSensorsConfig() {
    try {
        // Сначала пробуем загрузить из конфига
        let data = await fetchSensors();
        let source = 'config';

        // Если конфиг пуст, пробуем загрузить из SharedMemory
        if (!data.sensors || data.sensors.length === 0) {
            console.log('Конфиг датчиков пуст, загружаю из SharedMemory...');
            data = await fetchSMSensors();
            source = 'sm';
        }

        if (data.sensors) {
            data.sensors.forEach(sensor => {
                state.sensors.set(sensor.id, sensor);
                state.sensorsByName.set(sensor.name, sensor);
            });
        }
        console.log(`Загружено ${state.sensors.size} сенсоров из ${source}`);
    } catch (err) {
        console.error('Ошибка загрузки конфигурации сенсоров:', err);
    }
}

// Получить информацию о сенсоре по ID или имени
function getSensorInfo(idOrName) {
    if (typeof idOrName === 'number') {
        return state.sensors.get(idOrName);
    }
    return state.sensorsByName.get(idOrName);
}

// Проверить, является ли сигнал дискретным
function isDiscreteSignal(sensor) {
    if (!sensor) return false;
    return sensor.isDiscrete === true || sensor.iotype === 'DI' || sensor.iotype === 'DO';
}

// === IONC Action Dialog ===

const ioncDialogState = {
    isOpen: false,
    onConfirm: null,
    onCancel: null
};

function openIoncDialog(options) {
    const { title, body, footer, onConfirm, onCancel, focusInput } = options;

    const overlay = document.getElementById('ionc-dialog-overlay');
    const titleEl = document.getElementById('ionc-dialog-title');
    const bodyEl = document.getElementById('ionc-dialog-body');
    const footerEl = document.getElementById('ionc-dialog-footer');
    const errorEl = document.getElementById('ionc-dialog-error');

    titleEl.textContent = title;
    bodyEl.innerHTML = body;
    footerEl.innerHTML = footer;
    errorEl.textContent = '';

    ioncDialogState.isOpen = true;
    ioncDialogState.onConfirm = onConfirm;
    ioncDialogState.onCancel = onCancel;

    overlay.classList.add('visible');

    // Focus input if specified (use setTimeout to ensure element is visible)
    if (focusInput) {
        setTimeout(() => {
            const input = bodyEl.querySelector('input');
            if (input) {
                input.focus();
                input.select();
            }
        }, 50);
    }

    // Add ESC handler
    document.addEventListener('keydown', handleIoncDialogKeydown);
}

function closeIoncDialog() {
    const overlay = document.getElementById('ionc-dialog-overlay');
    overlay.classList.remove('visible');
    ioncDialogState.isOpen = false;
    ioncDialogState.onConfirm = null;
    ioncDialogState.onCancel = null;
    document.removeEventListener('keydown', handleIoncDialogKeydown);
}

function handleIoncDialogKeydown(e) {
    if (!ioncDialogState.isOpen) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        if (ioncDialogState.onCancel) {
            ioncDialogState.onCancel();
        }
        closeIoncDialog();
    } else if (e.key === 'Enter') {
        const input = document.querySelector('#ionc-dialog-body input');
        if (input && document.activeElement === input) {
            e.preventDefault();
            if (ioncDialogState.onConfirm) {
                ioncDialogState.onConfirm();
            }
        }
    }
}

function showIoncDialogError(message) {
    const errorEl = document.getElementById('ionc-dialog-error');
    errorEl.textContent = message;
}

function clearIoncDialogError() {
    const errorEl = document.getElementById('ionc-dialog-error');
    errorEl.textContent = '';
}

// === Sensor Dialog ===

// Состояние диалога датчиков
const sensorDialogState = {
    objectName: null,
    allSensors: [],
    filteredSensors: [],
    addedSensors: new Set() // датчики уже добавленные на график для текущего объекта
};

// Открыть диалог выбора датчика
function openSensorDialog(objectName) {
    sensorDialogState.objectName = objectName;

    // Загрузить список уже добавленных внешних датчиков
    sensorDialogState.addedSensors = getExternalSensorsFromStorage(objectName);

    const overlay = document.getElementById('sensor-dialog-overlay');
    const filterInput = document.getElementById('sensor-filter-input');

    overlay.classList.add('visible');
    filterInput.value = '';
    filterInput.focus();

    // Определяем источник датчиков в зависимости от smEnabled
    if (state.capabilities.smEnabled) {
        // SM включен - загружаем датчики из XML конфига
        if (state.sensors.size === 0) {
            renderSensorDialogContent('<div class="sensor-dialog-loading">Загрузка списка датчиков...</div>');
            loadSensorsConfig().then(() => {
                prepareSensorList();
                renderSensorTable();
            }).catch(err => {
                renderSensorDialogContent('<div class="sensor-dialog-empty">Ошибка загрузки датчиков</div>');
            });
        } else {
            prepareSensorList();
            renderSensorTable();
        }
    } else {
        // SM не настроен - показываем датчики из IONC таблицы
        const tabState = state.tabs.get(objectName);
        if (tabState && tabState.renderer && tabState.renderer.sensors) {
            prepareSensorListFromIONC(tabState.renderer.sensors);
            renderSensorTable();
        } else {
            renderSensorDialogContent('<div class="sensor-dialog-empty">Нет датчиков в таблице IONC</div>');
        }
    }

    // Обработчик фильтра
    filterInput.oninput = () => {
        filterSensors(filterInput.value);
        renderSensorTable();
    };

    // Обработчик ESC
    document.addEventListener('keydown', handleSensorDialogKeydown);
}

// Закрыть диалог
function closeSensorDialog() {
    const overlay = document.getElementById('sensor-dialog-overlay');
    overlay.classList.remove('visible');
    sensorDialogState.objectName = null;
    document.removeEventListener('keydown', handleSensorDialogKeydown);
}

// Обработка ESC
function handleSensorDialogKeydown(e) {
    if (e.key === 'Escape') {
        const filterInput = document.getElementById('sensor-filter-input');

        // Если есть фильтр — сбросить его и убрать фокус
        if (filterInput.value) {
            filterInput.value = '';
            filterInput.blur();
            filterSensors('');
            renderSensorTable();
        } else {
            // Иначе закрыть диалог
            closeSensorDialog();
        }
        e.preventDefault();
    }
}

// Подготовить список датчиков из XML конфига
function prepareSensorList() {
    sensorDialogState.allSensors = Array.from(state.sensors.values());
    sensorDialogState.filteredSensors = [...sensorDialogState.allSensors];
}

// Подготовить список датчиков из IONC таблицы
function prepareSensorListFromIONC(ioncSensors) {
    // Преобразуем формат IONC датчиков в формат диалога
    sensorDialogState.allSensors = ioncSensors.map(sensor => ({
        id: sensor.id,
        name: sensor.name,
        textname: '', // IONC датчики не имеют текстового описания
        iotype: sensor.type // 'type' в IONC -> 'iotype' в диалоге
    }));
    sensorDialogState.filteredSensors = [...sensorDialogState.allSensors];
}

// Фильтрация датчиков
function filterSensors(query) {
    if (!query) {
        sensorDialogState.filteredSensors = [...sensorDialogState.allSensors];
        return;
    }

    const lowerQuery = query.toLowerCase();
    sensorDialogState.filteredSensors = sensorDialogState.allSensors.filter(sensor => {
        return (sensor.name && sensor.name.toLowerCase().includes(lowerQuery)) ||
               (sensor.textname && sensor.textname.toLowerCase().includes(lowerQuery)) ||
               (sensor.iotype && sensor.iotype.toLowerCase().includes(lowerQuery));
    });
}

// Рендер содержимого диалога
function renderSensorDialogContent(html) {
    document.getElementById('sensor-dialog-content').innerHTML = html;
}

// Рендер таблицы датчиков
function renderSensorTable() {
    const sensors = sensorDialogState.filteredSensors;
    const countEl = document.getElementById('sensor-dialog-count');

    countEl.textContent = `${sensors.length} датчиков`;

    if (sensors.length === 0) {
        renderSensorDialogContent('<div class="sensor-dialog-empty">Датчики не найдены</div>');
        return;
    }

    const rows = sensors.map(sensor => {
        const isAdded = sensorDialogState.addedSensors.has(sensor.name);
        const btnText = isAdded ? '✓' : '+';
        const btnDisabled = isAdded ? 'disabled' : '';
        const btnTitle = isAdded ? 'Уже добавлен' : 'Добавить на график';

        return `
            <tr>
                <td>
                    <button class="sensor-add-btn" ${btnDisabled} title="${btnTitle}"
                            onclick="addExternalSensor('${sensorDialogState.objectName}', '${sensor.name}')">${btnText}</button>
                </td>
                <td>${sensor.id}</td>
                <td class="sensor-name">${escapeHtml(sensor.name)}</td>
                <td>${escapeHtml(sensor.textname || '')}</td>
                <td class="sensor-type">${sensor.iotype || ''}</td>
            </tr>
        `;
    }).join('');

    renderSensorDialogContent(`
        <table class="sensor-table">
            <thead>
                <tr>
                    <th style="width: 40px"></th>
                    <th style="width: 60px">ID</th>
                    <th>Имя</th>
                    <th>Описание</th>
                    <th style="width: 50px">Тип</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `);
}

// Экранирование HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Подписаться на внешние датчики через API
async function subscribeToExternalSensors(objectName, sensorNames) {
    try {
        const response = await fetch(`/api/objects/${encodeURIComponent(objectName)}/external-sensors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sensors: sensorNames })
        });
        if (!response.ok) {
            const err = await response.json();
            console.warn('Ошибка подписки на датчики:', err.error || response.statusText);
        }
    } catch (err) {
        console.warn('Ошибка подписки на датчики:', err);
    }
}

// Отписаться от внешнего датчика через API
async function unsubscribeFromExternalSensor(objectName, sensorName) {
    try {
        const response = await fetch(
            `/api/objects/${encodeURIComponent(objectName)}/external-sensors/${encodeURIComponent(sensorName)}`,
            { method: 'DELETE' }
        );
        if (!response.ok) {
            const err = await response.json();
            console.warn('Ошибка отписки от датчика:', err.error || response.statusText);
        }
    } catch (err) {
        console.warn('Ошибка отписки от датчика:', err);
    }
}

// Подписаться на IONC датчик через API
async function subscribeToIONCSensor(objectName, sensorId) {
    try {
        const response = await fetch(`/api/objects/${encodeURIComponent(objectName)}/ionc/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sensor_ids: [sensorId] })
        });
        if (!response.ok) {
            const err = await response.json();
            console.warn('Ошибка подписки на IONC датчик:', err.error || response.statusText);
        } else {
            // Добавляем в список подписок рендерера
            const tabState = state.tabs.get(objectName);
            if (tabState && tabState.renderer && tabState.renderer.subscribedSensorIds) {
                tabState.renderer.subscribedSensorIds.add(sensorId);
            }
            console.log(`IONC: Подписка на датчик ${sensorId} для ${objectName}`);
        }
    } catch (err) {
        console.warn('Ошибка подписки на IONC датчик:', err);
    }
}

// Отписаться от IONC датчика через API
async function unsubscribeFromIONCSensor(objectName, sensorId) {
    try {
        const response = await fetch(`/api/objects/${encodeURIComponent(objectName)}/ionc/unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sensor_ids: [sensorId] })
        });
        if (!response.ok) {
            const err = await response.json();
            console.warn('Ошибка отписки от IONC датчика:', err.error || response.statusText);
        } else {
            // Удаляем из списка подписок рендерера
            const tabState = state.tabs.get(objectName);
            if (tabState && tabState.renderer && tabState.renderer.subscribedSensorIds) {
                tabState.renderer.subscribedSensorIds.delete(sensorId);
            }
            console.log(`IONC: Отписка от датчика ${sensorId} для ${objectName}`);
        }
    } catch (err) {
        console.warn('Ошибка отписки от IONC датчика:', err);
    }
}

// Добавить внешний датчик на график
function addExternalSensor(objectName, sensorName) {
    let sensor;

    if (state.capabilities.smEnabled) {
        // SM включен - ищем датчик в глобальном списке
        sensor = state.sensorsByName.get(sensorName);
    } else {
        // SM выключен - ищем датчик в списке диалога (из IONC)
        sensor = sensorDialogState.allSensors.find(s => s.name === sensorName);
    }

    if (!sensor) {
        console.error('Датчик не найден:', sensorName);
        return;
    }

    // Добавляем в список добавленных
    sensorDialogState.addedSensors.add(sensorName);

    // Сохраняем в localStorage
    saveExternalSensorsToStorage(objectName, sensorDialogState.addedSensors);

    // Создаём график для внешнего датчика
    createExternalSensorChart(objectName, sensor);

    // Обновляем таблицу (чтобы кнопка стала disabled)
    renderSensorTable();

    console.log(`Добавлен внешний датчик ${sensorName} для ${objectName}`);

    if (state.capabilities.smEnabled) {
        // SM включен - подписываемся через SM API
        subscribeToExternalSensors(objectName, [sensorName]);
    } else {
        // SM выключен - подписываемся через IONC API
        subscribeToIONCSensor(objectName, sensor.id);
    }
}

// Создать график для внешнего датчика
// tabKey - ключ для state.tabs (serverId:objectName)
function createExternalSensorChart(tabKey, sensor) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    // Используем displayName из tabState для ID элементов (без serverId)
    const objectName = tabState.displayName;
    const varName = `ext:${sensor.name}`; // Префикс ext: для внешних датчиков

    // Проверяем, не создан ли уже график
    if (tabState.charts.has(varName)) {
        console.log(`График для ${varName} уже существует`);
        return;
    }

    const displayName = sensor.textname || sensor.name;
    const isDiscrete = isDiscreteSignal(sensor);
    const color = getNextColor();

    // Создаём панель графика
    const chartsContainer = document.getElementById(`charts-${objectName}`);
    if (!chartsContainer) return;

    // Используем CSS-безопасный ID (заменяем : на -)
    const safeVarName = varName.replace(/:/g, '-');

    const chartDiv = document.createElement('div');
    chartDiv.className = 'chart-panel external-sensor-chart';
    chartDiv.id = `chart-panel-${objectName}-${safeVarName}`;
    chartDiv.innerHTML = `
        <div class="chart-panel-header">
            <div class="chart-panel-info">
                <span class="legend-color-picker" data-object="${objectName}" data-variable="${varName}" style="background:${color}" title="Нажмите для выбора цвета"></span>
                <span class="chart-panel-title">${escapeHtml(displayName)}</span>
                <span class="chart-panel-value" id="legend-value-${objectName}-${safeVarName}">--</span>
                <span class="chart-panel-textname">${escapeHtml(sensor.name)}</span>
                <span class="chart-panel-badge external-badge">SM</span>
            </div>
            <div class="chart-panel-right">
                <label class="fill-toggle" title="Заливка фона">
                    <input type="checkbox" id="fill-${objectName}-${safeVarName}" ${!isDiscrete ? 'checked' : ''}>
                    <span class="fill-toggle-label">фон</span>
                </label>
                <button class="chart-remove-btn" title="Удалить с графика">✕</button>
            </div>
        </div>
        <div class="chart-wrapper">
            <canvas id="canvas-${objectName}-${safeVarName}"></canvas>
        </div>
    `;

    chartsContainer.appendChild(chartDiv);

    // Получаем диапазон времени
    const timeRange = getTimeRangeForObject(objectName);
    const fillEnabled = !isDiscrete;

    // Создаём Chart.js график
    const ctx = document.getElementById(`canvas-${objectName}-${safeVarName}`).getContext('2d');
    const chartConfig = {
        type: 'line',
        data: {
            datasets: [{
                label: displayName,
                data: [],
                borderColor: color,
                backgroundColor: `${color}20`,
                fill: fillEnabled,
                tension: 0,
                stepped: isDiscrete ? 'before' : false,
                pointRadius: 0,
                borderWidth: isDiscrete ? 2 : 1.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            scales: {
                x: {
                    type: 'time',
                    display: true,
                    grid: {
                        color: '#333840',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#8a9099',
                        maxTicksLimit: 10,
                        display: true
                    },
                    time: {
                        displayFormats: {
                            second: 'HH:mm:ss',
                            minute: 'HH:mm',
                            hour: 'HH:mm'
                        }
                    },
                    min: timeRange.min,
                    max: timeRange.max
                },
                y: {
                    display: true,
                    position: 'left',
                    beginAtZero: isDiscrete,
                    suggestedMin: isDiscrete ? 0 : undefined,
                    suggestedMax: isDiscrete ? 1.1 : undefined,
                    grid: {
                        color: '#333840',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#8a9099',
                        stepSize: isDiscrete ? 1 : undefined
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: '#22252a',
                    titleColor: '#d8dce2',
                    bodyColor: '#d8dce2',
                    borderColor: '#333840',
                    borderWidth: 1
                }
            }
        }
    };

    const chart = new Chart(ctx, chartConfig);

    // Синхронизируем все графики после добавления нового
    syncAllChartsTimeRange(objectName);

    // Сохраняем в состояние (используем оригинальный varName для ключа)
    tabState.charts.set(varName, {
        chart,
        isDiscrete,
        displayName,
        color,
        safeVarName // сохраняем для обновления DOM элементов
    });

    // Устанавливаем начальное время если это первый график
    if (!tabState.chartStartTime) {
        tabState.chartStartTime = Date.now();
    }

    // Добавляем начальную точку с текущим значением
    if (sensor.value !== undefined) {
        const now = new Date();
        chart.data.datasets[0].data.push({ x: now, y: sensor.value });
        chart.update('none');

        // Обновляем легенду
        const legendEl = document.getElementById(`legend-value-${objectName}-${safeVarName}`);
        if (legendEl) {
            legendEl.textContent = formatValue(sensor.value);
        }
    }

    // Обработчик удаления (передаём tabKey, а не objectName)
    chartDiv.querySelector('.chart-remove-btn').addEventListener('click', () => {
        removeExternalSensor(tabKey, sensor.name);
    });

    // Обработчик чекбокса заливки
    const fillCheckbox = document.getElementById(`fill-${objectName}-${safeVarName}`);
    if (fillCheckbox) {
        fillCheckbox.addEventListener('change', (e) => {
            chart.data.datasets[0].fill = e.target.checked;
            chart.update('none');
        });
    }
}

// Удалить внешний датчик с графика
// tabKey - ключ для state.tabs (serverId:objectName)
function removeExternalSensor(tabKey, sensorName) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    // Используем displayName из tabState для ID элементов (без serverId)
    const objectName = tabState.displayName;
    const varName = `ext:${sensorName}`;
    const safeVarName = varName.replace(/:/g, '-');

    // Удаляем график
    const chartData = tabState.charts.get(varName);
    if (chartData) {
        chartData.chart.destroy();
        tabState.charts.delete(varName);
    }

    // Удаляем DOM элемент (используем safeVarName)
    const chartPanel = document.getElementById(`chart-panel-${objectName}-${safeVarName}`);
    if (chartPanel) {
        chartPanel.remove();
    }

    // Удаляем из localStorage (используем tabKey как ключ)
    const addedSensors = getExternalSensorsFromStorage(tabKey);
    addedSensors.delete(sensorName);
    saveExternalSensorsToStorage(tabKey, addedSensors);

    // Находим сенсор для получения ID
    let sensor;
    if (state.capabilities.smEnabled) {
        sensor = state.sensorsByName.get(sensorName);
    } else {
        // Когда SM выключен, ищем в рендерере
        if (tabState && tabState.renderer && tabState.renderer.sensors) {
            sensor = tabState.renderer.sensors.find(s => s.name === sensorName);
        }
    }

    // Снять галочку в таблице IONC (по sensor.id)
    if (sensor) {
        const ioncCheckbox = document.getElementById(`ionc-chart-${objectName}-ionc-${sensor.id}`);
        if (ioncCheckbox) {
            ioncCheckbox.checked = false;
        }
    }

    // Обновляем состояние диалога если открыт
    if (sensorDialogState.objectName === objectName) {
        sensorDialogState.addedSensors.delete(sensorName);
        renderSensorTable();
    }

    console.log(`Удалён внешний датчик ${sensorName} для ${tabKey}`);

    // Отписываемся от датчика через API
    if (state.capabilities.smEnabled) {
        unsubscribeFromExternalSensor(objectName, sensorName);
    } else if (sensor) {
        unsubscribeFromIONCSensor(objectName, sensor.id);
    }
}

// Загрузить внешние датчики из localStorage
function getExternalSensorsFromStorage(objectName) {
    try {
        const key = `uniset2-viewer-external-sensors-${objectName}`;
        const data = localStorage.getItem(key);
        if (data) {
            return new Set(JSON.parse(data));
        }
    } catch (err) {
        console.warn('Ошибка загрузки внешних датчиков:', err);
    }
    return new Set();
}

// Сохранить внешние датчики в localStorage
function saveExternalSensorsToStorage(objectName, sensors) {
    try {
        const key = `uniset2-viewer-external-sensors-${objectName}`;
        localStorage.setItem(key, JSON.stringify([...sensors]));
    } catch (err) {
        console.warn('Ошибка сохранения внешних датчиков:', err);
    }
}

// Восстановить внешние датчики при открытии вкладки
function restoreExternalSensors(objectName) {
    const sensors = getExternalSensorsFromStorage(objectName);
    if (sensors.size === 0) return;

    if (state.capabilities.smEnabled) {
        // SM включен - ждём загрузки конфига сенсоров
        const tryRestore = () => {
            if (state.sensors.size === 0) {
                setTimeout(tryRestore, 100);
                return;
            }

            const restoredSensors = [];
            sensors.forEach(sensorName => {
                const sensor = state.sensorsByName.get(sensorName);
                if (sensor) {
                    createExternalSensorChart(objectName, sensor);
                    restoredSensors.push(sensorName);
                } else {
                    console.warn(`Внешний датчик ${sensorName} не найден в конфиге`);
                }
            });

            // Подписываемся на все восстановленные датчики одним запросом
            if (restoredSensors.length > 0) {
                subscribeToExternalSensors(objectName, restoredSensors);
            }

            console.log(`Восстановлено ${restoredSensors.length} внешних датчиков для ${objectName}`);
        };

        tryRestore();
    } else {
        // SM выключен - ждём загрузки сенсоров рендерера (IONC)
        const tryRestoreIONC = () => {
            const tabState = state.tabs.get(objectName);
            if (!tabState || !tabState.renderer || !tabState.renderer.sensors || tabState.renderer.sensors.length === 0) {
                setTimeout(tryRestoreIONC, 100);
                return;
            }

            const restoredSensorIds = [];
            sensors.forEach(sensorName => {
                const sensor = tabState.renderer.sensors.find(s => s.name === sensorName);
                if (sensor) {
                    // Адаптируем формат датчика для createExternalSensorChart
                    const adaptedSensor = {
                        id: sensor.id,
                        name: sensor.name,
                        textname: '', // IONC датчики не имеют текстового описания
                        iotype: sensor.type,
                        value: sensor.value
                    };
                    createExternalSensorChart(objectName, adaptedSensor);
                    restoredSensorIds.push(sensor.id);
                } else {
                    console.warn(`IONC датчик ${sensorName} не найден`);
                }
            });

            // Подписываемся на все восстановленные датчики через IONC
            if (restoredSensorIds.length > 0) {
                fetch(`/api/objects/${encodeURIComponent(objectName)}/ionc/subscribe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sensor_ids: restoredSensorIds })
                }).then(response => {
                    if (response.ok) {
                        restoredSensorIds.forEach(id => {
                            tabState.renderer.subscribedSensorIds.add(id);
                        });
                        console.log(`IONC: Восстановлена подписка на ${restoredSensorIds.length} датчиков`);
                    }
                }).catch(err => {
                    console.warn('Ошибка восстановления подписок IONC:', err);
                });
            }

            console.log(`Восстановлено ${restoredSensorIds.length} внешних датчиков для ${objectName}`);
        };

        tryRestoreIONC();
    }
}

// UI функции
function renderObjectsList(data) {
    const list = document.getElementById('objects-list');
    list.innerHTML = '';

    if (!data || !data.objects || data.objects.length === 0) {
        list.innerHTML = '<li class="loading">Объекты не найдены</li>';
        return;
    }

    // data.objects - массив { serverId, serverName, objects: [...] }
    data.objects.forEach(serverData => {
        const serverId = serverData.serverId;
        const serverName = serverData.serverName || serverId;
        const serverConnected = serverData.connected !== false;

        if (!serverData.objects || serverData.objects.length === 0) return;

        serverData.objects.forEach(name => {
            const li = document.createElement('li');
            li.dataset.name = name;
            li.dataset.serverId = serverId;
            li.dataset.serverName = serverName;

            // Бейдж сервера + имя объекта
            const badge = document.createElement('span');
            badge.className = 'server-badge' + (serverConnected ? '' : ' disconnected');
            badge.textContent = serverName;
            badge.title = `Сервер: ${serverName}${serverConnected ? '' : ' (отключен)'}`;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'object-name';
            nameSpan.textContent = name;

            li.appendChild(badge);
            li.appendChild(nameSpan);

            li.addEventListener('click', () => openObjectTab(name, serverId, serverName));
            list.appendChild(li);
        });
    });
}

async function openObjectTab(name, serverId, serverName) {
    // Составной ключ для tabs: serverId:objectName
    const tabKey = `${serverId}:${name}`;

    if (state.tabs.has(tabKey)) {
        activateTab(tabKey);
        return;
    }

    // Сначала загружаем данные, чтобы узнать тип объекта
    try {
        const data = await fetchObjectData(name, serverId);
        const rendererInfo = resolveRenderer(data.object || {});

        createTab(tabKey, name, rendererInfo, data, serverId, serverName);
        activateTab(tabKey);

        watchObject(name, serverId).catch(console.error);
    } catch (err) {
        console.error(`Ошибка открытия вкладки ${name}:`, err);
    }
}

function createTab(tabKey, displayName, rendererInfo, initialData, serverId, serverName) {
    const tabsHeader = document.getElementById('tabs-header');
    const tabsContent = document.getElementById('tabs-content');

    const placeholder = tabsContent.querySelector('.placeholder');
    if (placeholder) placeholder.remove();

    // Получаем класс рендерера для данного типа объекта/расширения
    const RendererClass = rendererInfo.RendererClass || DefaultObjectRenderer;
    const renderer = new RendererClass(displayName, tabKey);
    renderer.extensionType = rendererInfo.extensionType;
    renderer.objectType = rendererInfo.objectType;

    // Кнопка вкладки с индикатором типа и сервера
    const tabBtn = document.createElement('button');
    tabBtn.className = 'tab-btn';
    tabBtn.dataset.name = tabKey;
    tabBtn.dataset.objectType = rendererInfo.rendererType;
    tabBtn.dataset.serverId = serverId;

    const badgeType = rendererInfo.badgeType || rendererInfo.rendererType || 'Default';

    // Формируем HTML вкладки
    const tabHTML = `
        <span class="tab-type-badge">${badgeType}</span>
        <span class="tab-server-badge">${serverName}</span>
        ${displayName}
        <span class="close">&times;</span>
    `;
    tabBtn.innerHTML = tabHTML;

    tabBtn.addEventListener('click', (e) => {
        if (e.target.classList.contains('close')) {
            closeTab(tabKey);
        } else {
            activateTab(tabKey);
        }
    });
    tabsHeader.appendChild(tabBtn);

    // Панель содержимого - создаётся рендерером
    const panel = document.createElement('div');
    panel.className = 'tab-panel';
    panel.dataset.name = tabKey;
    panel.dataset.objectType = rendererInfo.rendererType;
    panel.dataset.serverId = serverId;
    panel.innerHTML = renderer.createPanelHTML();
    tabsContent.appendChild(panel);

    // Восстановить состояние спойлеров
    restoreCollapsedSections(tabKey);

    // Восстановить порядок секций
    loadSectionOrder(tabKey);

    // Сохраняем состояние вкладки с рендерером
    // Если SSE подключен, не запускаем polling (данные будут приходить через SSE)
    const updateInterval = state.sse.connected
        ? null
        : setInterval(() => loadObjectData(displayName), state.sse.pollInterval);

    state.tabs.set(tabKey, {
        charts: new Map(),
        variables: {},
        objectType: rendererInfo.rendererType,
        extensionType: rendererInfo.extensionType,
        renderer: renderer,
        updateInterval: updateInterval,
        displayName: displayName,
        serverId: serverId,
        serverName: serverName
    });

    // Инициализация рендерера (настройка обработчиков и т.д.)
    renderer.initialize();

    // Восстанавливаем внешние датчики из localStorage
    restoreExternalSensors(displayName);

    // Обновляем состояние кнопок перемещения секций
    updateReorderButtons(tabKey);

    // Отрисовываем начальные данные
    if (initialData) {
        renderer.update(initialData);
    }
}

function activateTab(name) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelectorAll('.objects-list li').forEach(li => li.classList.remove('active'));

    document.querySelector(`.tab-btn[data-name="${name}"]`)?.classList.add('active');
    document.querySelector(`.tab-panel[data-name="${name}"]`)?.classList.add('active');
    document.querySelector(`.objects-list li[data-name="${name}"]`)?.classList.add('active');

    state.activeTab = name;
}

function closeTab(name) {
    const tabState = state.tabs.get(name);
    if (tabState) {
        clearInterval(tabState.updateInterval);
        tabState.charts.forEach(chartData => {
            clearInterval(chartData.updateInterval);
            chartData.chart.destroy();
        });
        // Вызываем destroy рендерера
        if (tabState.renderer) {
            tabState.renderer.destroy();
        }
    }

    unwatchObject(name).catch(console.error);

    state.tabs.delete(name);

    document.querySelector(`.tab-btn[data-name="${name}"]`)?.remove();
    document.querySelector(`.tab-panel[data-name="${name}"]`)?.remove();

    if (state.tabs.size === 0) {
        const tabsContent = document.getElementById('tabs-content');
        tabsContent.innerHTML = '<div class="placeholder">Выберите объект из списка слева</div>';
        state.activeTab = null;
    } else if (state.activeTab === name) {
        const firstTab = state.tabs.keys().next().value;
        activateTab(firstTab);
    }
}

async function loadObjectData(name) {
    try {
        const data = await fetchObjectData(name);
        const tabState = state.tabs.get(name);

        // Используем рендерер для обновления данных
        if (tabState && tabState.renderer) {
            tabState.renderer.update(data);
        }

        // Если работаем в режиме polling - обновляем индикатор
        if (!state.sse.connected) {
            updateSSEStatus('polling', new Date());
        }
    } catch (err) {
        console.error(`Ошибка загрузки ${name}:`, err);
    }
}

function renderVariables(objectName, variables, filterText = '') {
    const tbody = document.getElementById(`variables-${objectName}`);
    if (!tbody) return;

    // Сохраняем переменные в state для фильтрации
    const tabState = state.tabs.get(objectName);
    if (tabState) {
        tabState.variables = variables;
    }

    tbody.innerHTML = '';
    const filterLower = filterText.toLowerCase();

    Object.entries(variables).forEach(([varName, value]) => {
        // Фильтрация по имени переменной
        if (filterText && !varName.toLowerCase().includes(filterLower)) {
            return;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="variable-name">${varName}</td>
            <td class="variable-value">${formatValue(value)}</td>
            <td></td>
        `;

        tbody.appendChild(tr);
    });
}

function renderIO(objectName, type, ioData) {
    const tbody = document.getElementById(`${type}-${objectName}`);
    const countBadge = document.getElementById(`${type}-count-${objectName}`);
    if (!tbody) return;

    const entries = Object.entries(ioData);

    if (countBadge) {
        countBadge.textContent = entries.length;
    }

    // Получаем текущий фильтр (глобальный) и закреплённые строки
    const filterInput = document.getElementById(`io-filter-global-${objectName}`);
    const filterText = filterInput ? filterInput.value.toLowerCase() : '';
    const pinnedRows = getIOPinnedRows(objectName, type);
    const hasPinned = pinnedRows.size > 0;

    // Показываем/скрываем кнопку "снять все"
    const unpinBtn = document.getElementById(`io-unpin-${type}-${objectName}`);
    if (unpinBtn) {
        unpinBtn.style.display = hasPinned ? 'inline' : 'none';
    }

    tbody.innerHTML = '';

    entries.forEach(([key, io]) => {
        const varName = `io.${type === 'inputs' ? 'in' : 'out'}.${key}`;
        const sensor = getSensorInfo(io.id) || getSensorInfo(io.name);
        const iotype = sensor?.iotype || (type === 'inputs' ? 'DI' : 'DO');
        const textname = sensor?.textname || io.textname || io.comment || '';
        const rowKey = io.id || key;
        const isPinned = pinnedRows.has(String(rowKey));

        // Фильтрация: если есть закреплённые - показываем только их, иначе фильтруем по тексту
        const searchText = `${io.name || key} ${io.id} ${iotype} ${textname}`.toLowerCase();
        const matchesFilter = !filterText || searchText.includes(filterText);
        const shouldShow = hasPinned ? isPinned : matchesFilter;

        if (!shouldShow) return;

        const tr = document.createElement('tr');
        tr.className = '';
        tr.dataset.rowKey = rowKey;

        tr.innerHTML = `
            <td class="io-pin-col">
                <span class="io-pin-toggle ${isPinned ? 'pinned' : ''}" data-row-key="${rowKey}" title="${isPinned ? 'Открепить' : 'Закрепить'}">
                    ${isPinned ? '📌' : '○'}
                </span>
            </td>
            <td class="io-chart-col">
                <span class="chart-toggle">
                    <input type="checkbox"
                           id="chart-${objectName}-${varName}"
                           data-object="${objectName}"
                           data-variable="${varName}"
                           data-sensor-id="${io.id}"
                           ${hasChart(objectName, varName) ? 'checked' : ''}>
                    <label class="chart-toggle-label" for="chart-${objectName}-${varName}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 3v18h18"/>
                            <path d="M18 9l-5 5-4-4-3 3"/>
                        </svg>
                    </label>
                </span>
            </td>
            <td class="io-spacer-col"></td>
            <td><span class="variable-iotype iotype-${iotype.toLowerCase()}">${iotype}</span></td>
            <td>${io.id}</td>
            <td class="variable-name" title="${textname}">${io.name || key}</td>
            <td class="variable-value" data-var="${varName}">${formatValue(io.value)}</td>
        `;

        // Pin toggle handler
        const pinToggle = tr.querySelector('.io-pin-toggle');
        pinToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleIOPin(objectName, type, rowKey);
        });

        // Chart toggle handler
        const checkbox = tr.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                addChart(objectName, varName, io.id, textname);
            } else {
                removeChart(objectName, varName);
            }
        });

        tbody.appendChild(tr);
    });
}

function formatValue(value) {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value : value.toFixed(2);
    }
    return String(value);
}

// Находит tabKey по displayName (для обратной совместимости с кодом использующим objectName)
function findTabKeyByDisplayName(displayName) {
    for (const [tabKey, tabState] of state.tabs) {
        if (tabState.displayName === displayName) {
            return tabKey;
        }
    }
    // Fallback: если не нашли, возможно это и есть tabKey
    if (state.tabs.has(displayName)) {
        return displayName;
    }
    return null;
}

function hasChart(objectName, varName) {
    const tabKey = findTabKeyByDisplayName(objectName);
    if (!tabKey) return false;
    const tabState = state.tabs.get(tabKey);
    return tabState && tabState.charts.has(varName);
}

async function addChart(objectName, varName, sensorId, passedTextname) {
    const tabKey = findTabKeyByDisplayName(objectName);
    if (!tabKey) return;
    const tabState = state.tabs.get(tabKey);
    if (!tabState || tabState.charts.has(varName)) return;

    const chartsContainer = document.getElementById(`charts-${objectName}`);
    // Ищем сенсор по ID или по имени переменной
    let sensor = sensorId ? getSensorInfo(sensorId) : null;
    if (!sensor) {
        // Пробуем найти по имени (последняя часть varName, например io.in.Input1_S -> Input1_S)
        const shortName = varName.split('.').pop();
        sensor = getSensorInfo(shortName);
    }
    const isDiscrete = isDiscreteSignal(sensor);
    const color = getNextColor();
    const displayName = sensor?.name || varName.split('.').pop();
    // textname: приоритет - справочник сенсоров, потом переданный параметр (comment из API)
    const textName = sensor?.textname || passedTextname || '';

    // Создаём панель графика
    const chartDiv = document.createElement('div');
    chartDiv.className = 'chart-panel';
    chartDiv.id = `chart-panel-${objectName}-${varName}`;
    chartDiv.innerHTML = `
        <div class="chart-panel-header">
            <div class="chart-panel-info">
                <span class="legend-color-picker" data-object="${objectName}" data-variable="${varName}" style="background:${color}" title="Нажмите для выбора цвета"></span>
                <span class="chart-panel-title">${displayName}</span>
                <span class="chart-panel-value" id="legend-value-${objectName}-${varName}">--</span>
                <span class="chart-panel-textname">${textName}</span>
            </div>
            <div class="chart-panel-right">
                <label class="fill-toggle" title="Заливка фона">
                    <input type="checkbox" id="fill-${objectName}-${varName}" ${!isDiscrete ? 'checked' : ''}>
                    <span class="fill-toggle-label">фон</span>
                </label>
                <button class="btn-icon" title="Закрыть" onclick="removeChartByButton('${objectName}', '${varName}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        </div>
        <div class="chart-wrapper">
            <canvas id="canvas-${objectName}-${varName}"></canvas>
        </div>
    `;
    chartsContainer.appendChild(chartDiv);

    // Обработчик для чекбокса заливки
    const fillCheckbox = document.getElementById(`fill-${objectName}-${varName}`);
    fillCheckbox.addEventListener('change', (e) => {
        toggleChartFill(objectName, varName, e.target.checked);
    });

    // Загружаем историю
    try {
        const history = await fetchVariableHistory(objectName, varName, 200);
        const ctx = document.getElementById(`canvas-${objectName}-${varName}`).getContext('2d');

        // Преобразуем данные для временной шкалы
        const historyData = history.points?.map(p => ({
            x: new Date(p.timestamp),
            y: p.value
        })) || [];

        // Получаем диапазон времени (при первом графике устанавливается начало)
        const timeRange = getTimeRangeForObject(objectName);

        // Заливка по умолчанию только для аналоговых
        const fillEnabled = !isDiscrete;

        // Конфигурация графика в зависимости от типа сигнала
        const chartConfig = {
            type: 'line',
            data: {
                datasets: [{
                    label: displayName,
                    data: historyData,
                    borderColor: color,
                    backgroundColor: `${color}20`,
                    fill: fillEnabled,
                    tension: 0,
                    stepped: isDiscrete ? 'before' : false,
                    pointRadius: 0,
                    borderWidth: isDiscrete ? 2 : 1.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                scales: {
                    x: {
                        type: 'time',
                        display: true,
                        grid: {
                            color: '#333840',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#8a9099',
                            maxTicksLimit: 10,
                            display: true
                        },
                        time: {
                            displayFormats: {
                                second: 'HH:mm:ss',
                                minute: 'HH:mm',
                                hour: 'HH:mm'
                            }
                        },
                        min: timeRange.min,
                        max: timeRange.max
                    },
                    y: {
                        display: true,
                        position: 'left',
                        beginAtZero: isDiscrete,
                        suggestedMin: isDiscrete ? 0 : undefined,
                        suggestedMax: isDiscrete ? 1.1 : undefined,
                        grid: {
                            color: '#333840',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#8a9099',
                            stepSize: isDiscrete ? 1 : undefined
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: '#22252a',
                        titleColor: '#d8dce2',
                        bodyColor: '#d8dce2',
                        borderColor: '#333840',
                        borderWidth: 1
                    }
                }
            }
        };

        const chart = new Chart(ctx, chartConfig);

        // Синхронизируем все графики после добавления нового
        syncAllChartsTimeRange(objectName);

        // Обновить начальное значение в легенде
        if (history.points && history.points.length > 0) {
            const lastValue = history.points[history.points.length - 1].value;
            document.getElementById(`legend-value-${objectName}-${varName}`).textContent = formatValue(lastValue);
        }

        // Сохраняем данные графика
        const chartData = {
            chart,
            sensorId,
            isDiscrete,
            color,
            updateInterval: null
        };

        // Периодическое обновление только если SSE не подключен
        if (!state.sse.connected) {
            chartData.updateInterval = setInterval(async () => {
                await updateChart(objectName, varName, chart);
            }, state.sse.pollInterval);
        }

        tabState.charts.set(varName, chartData);

    } catch (err) {
        console.error(`Ошибка загрузки истории для ${varName}:`, err);
        chartDiv.innerHTML += `<div class="error">Не удалось загрузить данные графика</div>`;
    }
}

async function updateChart(objectName, varName, chart) {
    const tabState = state.tabs.get(objectName);
    if (!tabState || !tabState.charts.has(varName)) return;

    try {
        const history = await fetchVariableHistory(objectName, varName, 200);

        // Преобразуем данные для временной шкалы
        const chartData = history.points?.map(p => ({
            x: new Date(p.timestamp),
            y: p.value
        })) || [];

        chart.data.datasets[0].data = chartData;

        // Применяем диапазон времени (со смещением если нужно)
        const timeRange = getTimeRangeForObject(objectName);
        chart.options.scales.x.min = timeRange.min;
        chart.options.scales.x.max = timeRange.max;

        chart.update('none');

        // Обновить значение в легенде
        if (history.points && history.points.length > 0) {
            const lastValue = history.points[history.points.length - 1].value;
            const legendEl = document.getElementById(`legend-value-${objectName}-${varName}`);
            if (legendEl) {
                legendEl.textContent = formatValue(lastValue);
            }
        }
    } catch (err) {
        console.error(`Ошибка обновления графика для ${varName}:`, err);
    }
}

// Получить диапазон времени для графиков объекта
function getTimeRangeForObject(objectName) {
    const tabState = state.tabs.get(objectName);
    if (!tabState) {
        const now = Date.now();
        return { min: now, max: now + state.timeRange * 1000 };
    }

    // Если нет начального времени - установить текущее
    if (!tabState.chartStartTime) {
        tabState.chartStartTime = Date.now();
    }

    const now = Date.now();
    const rangeMs = state.timeRange * 1000;
    let min = tabState.chartStartTime;
    let max = min + rangeMs;

    // Если текущее время достигло конца шкалы - сместить на 90%
    if (now >= max) {
        const shiftAmount = rangeMs * 0.9;
        tabState.chartStartTime = min + shiftAmount;
        min = tabState.chartStartTime;
        max = min + rangeMs;
    }

    return { min, max };
}

// Синхронизировать диапазон времени для всех графиков
function syncAllChartsTimeRange(objectName) {
    const tabState = state.tabs.get(objectName);
    if (!tabState) return;

    const timeRange = getTimeRangeForObject(objectName);

    tabState.charts.forEach((chartData, varName) => {
        const chart = chartData.chart;
        chart.options.scales.x.min = timeRange.min;
        chart.options.scales.x.max = timeRange.max;
        chart.update('none');
    });

    // Обновить отображение оси X (показывать только на последнем графике)
    updateXAxisVisibility(objectName);
}

// Показывать ось X только на последнем графике
function updateXAxisVisibility(objectName) {
    const tabState = state.tabs.get(objectName);
    if (!tabState) return;

    const chartPanels = document.querySelectorAll(`#charts-${objectName} .chart-panel`);
    const chartCount = chartPanels.length;

    let index = 0;
    tabState.charts.forEach((chartData, varName) => {
        const isLast = index === chartCount - 1;
        chartData.chart.options.scales.x.ticks.display = isLast;
        chartData.chart.update('none');
        index++;
    });
}

function updateChartLegends(objectName, data) {
    const tabState = state.tabs.get(objectName);
    if (!tabState) return;

    // Обновляем значения в таблицах
    if (data.io?.in) {
        Object.entries(data.io.in).forEach(([key, io]) => {
            const varName = `io.in.${key}`;
            const legendEl = document.getElementById(`legend-value-${objectName}-${varName}`);
            if (legendEl) {
                legendEl.textContent = formatValue(io.value);
            }
        });
    }

    if (data.io?.out) {
        Object.entries(data.io.out).forEach(([key, io]) => {
            const varName = `io.out.${key}`;
            const legendEl = document.getElementById(`legend-value-${objectName}-${varName}`);
            if (legendEl) {
                legendEl.textContent = formatValue(io.value);
            }
        });
    }
}

function removeChart(objectName, varName) {
    const tabKey = findTabKeyByDisplayName(objectName);
    if (!tabKey) return;
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const chartData = tabState.charts.get(varName);
    if (chartData) {
        clearInterval(chartData.updateInterval);
        chartData.chart.destroy();
        tabState.charts.delete(varName);
    }

    document.getElementById(`chart-panel-${objectName}-${varName}`)?.remove();

    // Снять галочку в таблице (обычная IO таблица)
    const checkbox = document.getElementById(`chart-${objectName}-${varName}`);
    if (checkbox) {
        checkbox.checked = false;
    }

    // Снять галочку в таблице IONC (датчики SharedMemory)
    const ioncCheckbox = document.getElementById(`ionc-chart-${objectName}-${varName}`);
    if (ioncCheckbox) {
        ioncCheckbox.checked = false;
    }

    // Обновить видимость оси X на оставшихся графиках
    updateXAxisVisibility(objectName);
}

// Глобальная функция для кнопки закрытия графика
window.removeChartByButton = function(objectName, varName) {
    removeChart(objectName, varName);
};

// Глобальная функция для сворачивания/разворачивания секций
window.toggleSection = function(sectionId) {
    const section = document.querySelector(`[data-section="${sectionId}"]`);
    if (section) {
        section.classList.toggle('collapsed');
        saveCollapsedSections();
    }
};

// Хранилище данных таймеров для локального обновления timeleft
const timerDataCache = {};
let timerUpdateInterval = null;

// Рендеринг таймеров
function renderTimers(objectName, timersData) {
    const tbody = document.getElementById(`timers-${objectName}`);
    const countBadge = document.getElementById(`timers-count-${objectName}`);
    if (!tbody) return;

    // Извлечь таймеры из объекта (исключая count)
    const timers = [];
    Object.entries(timersData).forEach(([key, timer]) => {
        if (key !== 'count' && typeof timer === 'object') {
            timers.push({...timer, _key: key});
        }
    });

    // Сохраняем в кэш для локального обновления
    timerDataCache[objectName] = {
        timers: timers,
        lastUpdate: Date.now()
    };

    if (countBadge) {
        countBadge.textContent = timers.length;
    }

    renderTimersTable(objectName, timers);

    // Запускаем интервал локального обновления если ещё не запущен
    startTimerUpdateInterval();
}

// Отрисовка таблицы таймеров
function renderTimersTable(objectName, timers) {
    const tbody = document.getElementById(`timers-${objectName}`);
    if (!tbody) return;

    // Получаем текущий фильтр (глобальный) и закреплённые строки
    const filterInput = document.getElementById(`io-filter-global-${objectName}`);
    const filterText = filterInput ? filterInput.value.toLowerCase() : '';
    const pinnedRows = getIOPinnedRows(objectName, 'timers');
    const hasPinned = pinnedRows.size > 0;

    // Показываем/скрываем кнопку "снять все"
    const unpinBtn = document.getElementById(`io-unpin-timers-${objectName}`);
    if (unpinBtn) {
        unpinBtn.style.display = hasPinned ? 'inline' : 'none';
    }

    tbody.innerHTML = '';

    if (timers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Нет таймеров</td></tr>';
        return;
    }

    timers.forEach(timer => {
        const rowKey = timer.id || timer._key;
        const isPinned = pinnedRows.has(String(rowKey));

        // Фильтрация
        const searchText = `${timer.id} ${timer.name || ''}`.toLowerCase();
        const matchesFilter = !filterText || searchText.includes(filterText);
        const shouldShow = hasPinned ? isPinned : matchesFilter;

        if (!shouldShow) return;

        const tr = document.createElement('tr');
        tr.dataset.timerId = timer.id;
        tr.className = '';

        // Форматирование tick: -1 означает бесконечный таймер
        const tickDisplay = timer.tick === -1 ? '∞' : timer.tick;
        const tickClass = timer.tick === -1 ? 'timer-infinite' : '';

        // Форматирование timeleft с прогресс-баром
        const timeleftPercent = timer.msec > 0 ? Math.max(0, (timer.timeleft / timer.msec) * 100) : 0;
        const timeleftClass = timer.timeleft <= 0 ? 'timer-expired' : '';

        tr.innerHTML = `
            <td class="io-pin-col">
                <span class="io-pin-toggle ${isPinned ? 'pinned' : ''}" data-row-key="${rowKey}" title="${isPinned ? 'Открепить' : 'Закрепить'}">
                    ${isPinned ? '📌' : '○'}
                </span>
            </td>
            <td>${timer.id}</td>
            <td class="variable-name">${timer.name || '-'}</td>
            <td class="variable-value">${timer.msec} мс</td>
            <td class="variable-value ${timeleftClass}">
                <div class="timeleft-cell">
                    <span class="timeleft-value">${Math.max(0, timer.timeleft)} мс</span>
                    <div class="timeleft-bar" style="width: ${timeleftPercent}%"></div>
                </div>
            </td>
            <td class="variable-value ${tickClass}">${tickDisplay}</td>
        `;

        // Pin toggle handler
        const pinToggle = tr.querySelector('.io-pin-toggle');
        pinToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleIOPin(objectName, 'timers', rowKey);
        });

        tbody.appendChild(tr);
    });
}

// Запуск интервала для локального обновления timeleft
function startTimerUpdateInterval() {
    if (timerUpdateInterval) return;

    const UPDATE_INTERVAL = 100; // мс

    timerUpdateInterval = setInterval(() => {
        const now = Date.now();

        Object.entries(timerDataCache).forEach(([objectName, cache]) => {
            const elapsed = now - cache.lastUpdate;

            // Обновляем timeleft для каждого таймера
            cache.timers.forEach(timer => {
                if (timer.tick !== -1 && timer.timeleft > 0) {
                    timer.timeleft = Math.max(0, timer.timeleft - UPDATE_INTERVAL);
                }
            });

            cache.lastUpdate = now;

            // Перерисовываем таблицу
            renderTimersTable(objectName, cache.timers);
        });
    }, UPDATE_INTERVAL);
}

// Остановка интервала обновления таймеров
function stopTimerUpdateInterval() {
    if (timerUpdateInterval) {
        clearInterval(timerUpdateInterval);
        timerUpdateInterval = null;
    }
}

// Рендеринг информации об объекте
function renderObjectInfo(objectName, objectData) {
    const tbody = document.getElementById(`object-info-${objectName}`);
    if (!tbody || !objectData) return;

    tbody.innerHTML = '';

    // Первая строка - важные метрики сообщений (объединённая)
    const msgCount = objectData.msgCount ?? 0;
    const lostMessages = objectData.lostMessages ?? 0;
    const maxQueue = objectData.maxSizeOfMessageQueue ?? '-';
    const msgCountRow = document.createElement('tr');
    msgCountRow.className = 'message-metrics-row';
    const lostClass = lostMessages > 0 ? 'lost-messages-warning' : '';
    msgCountRow.innerHTML = `
        <td colspan="2" class="message-metrics">
            <span class="metric-item">В очереди: <strong>${msgCount}</strong></span>
            <span class="metric-separator">|</span>
            <span class="metric-item ${lostClass}">Потеряно: <strong>${lostMessages}</strong></span>
            <span class="metric-separator">|</span>
            <span class="metric-item">Макс. очередь: <strong>${maxQueue}</strong></span>
        </td>
    `;
    tbody.appendChild(msgCountRow);

    // Остальные поля
    const fields = [
        { key: 'name', label: 'Имя' },
        { key: 'id', label: 'ID' },
        { key: 'objectType', label: 'Тип' },
        { key: 'extensionType', label: 'Extension' },
        { key: 'isActive', label: 'Активен', format: v => v ? 'Да' : 'Нет' }
    ];

    fields.forEach(({ key, label, format }) => {
        if (objectData[key] !== undefined) {
            const tr = document.createElement('tr');
            const value = format ? format(objectData[key]) : objectData[key];
            tr.innerHTML = `
                <td class="info-label">${label}</td>
                <td class="info-value">${value}</td>
            `;
            tbody.appendChild(tr);
        }
    });
}

// Рендеринг LogServer
function renderLogServer(objectName, logServerData) {
    const section = document.getElementById(`logserver-section-${objectName}`);
    const tbody = document.getElementById(`logserver-${objectName}`);
    if (!section || !tbody) return;

    if (!logServerData) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    tbody.innerHTML = '';

    const fields = [
        { key: 'host', label: 'Хост' },
        { key: 'port', label: 'Порт' },
        { key: 'state', label: 'Состояние', formatState: true }
    ];

    fields.forEach(({ key, label, formatState }) => {
        if (logServerData[key] !== undefined) {
            const tr = document.createElement('tr');
            let valueHtml;
            if (formatState) {
                const stateValue = String(logServerData[key]).toUpperCase();
                // Проверяем с учётом возможных опечаток (RUNNIG вместо RUNNING)
                const stateClass = stateValue.startsWith('RUNN') ? 'state-running' :
                                   stateValue === 'STOPPED' ? 'state-stopped' : '';
                valueHtml = `<span class="state-badge ${stateClass}">${logServerData[key]}</span>`;
            } else {
                valueHtml = logServerData[key];
            }
            tr.innerHTML = `
                <td class="info-label">${label}</td>
                <td class="info-value">${valueHtml}</td>
            `;
            tbody.appendChild(tr);
        }
    });

    // Если есть дополнительная информация в info
    if (logServerData.info && typeof logServerData.info === 'object') {
        const info = logServerData.info;

        // Показываем sessMaxCount
        if (info.sessMaxCount !== undefined) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="info-label">Макс. сессий</td>
                <td class="info-value">${info.sessMaxCount}</td>
            `;
            tbody.appendChild(tr);
        }

        // Показываем список сессий
        if (info.sessions && Array.isArray(info.sessions)) {
            const sessionsCount = info.sessions.length;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="info-label">Активных сессий</td>
                <td class="info-value">${sessionsCount}</td>
            `;
            tbody.appendChild(tr);

            // Если есть активные сессии - показываем их
            if (sessionsCount > 0) {
                info.sessions.forEach((session, idx) => {
                    const sessionTr = document.createElement('tr');
                    const sessionInfo = typeof session === 'object' ?
                        JSON.stringify(session) : String(session);
                    sessionTr.innerHTML = `
                        <td class="info-label" style="padding-left: 1.5rem">Сессия ${idx + 1}</td>
                        <td class="info-value">${sessionInfo}</td>
                    `;
                    tbody.appendChild(sessionTr);
                });
            }
        }
    }
}

// Рендеринг статистики
function renderStatistics(objectName, statsData) {
    const section = document.getElementById(`statistics-section-${objectName}`);
    const container = document.getElementById(`statistics-${objectName}`);
    if (!section || !container) return;

    if (!statsData) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    // Сохраняем данные статистики в state для фильтрации
    const tabState = state.tabs.get(objectName);
    if (tabState) {
        tabState.statisticsData = statsData;
    }

    // Проверяем, был ли уже создан контейнер
    let generalTable = container.querySelector('.stats-general-table');
    let sensorsSection = container.querySelector('.stats-sensors-section');

    if (!generalTable) {
        // Первичный рендеринг - создаём структуру
        container.innerHTML = `
            <table class="info-table stats-general-table">
                <tbody></tbody>
            </table>
            <div class="stats-sensors-section" style="display:none">
                <div class="stats-subtitle">Сенсоры</div>
                <input type="text"
                       class="filter-input stats-filter"
                       id="filter-stats-${objectName}"
                       placeholder="Фильтр по имени датчика..."
                       data-object="${objectName}">
                <table class="variables-table stats-sensors-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Имя</th>
                            <th>Срабатываний</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        `;

        // Настроить обработчик фильтра
        const filterInput = container.querySelector(`#filter-stats-${objectName}`);
        if (filterInput) {
            filterInput.addEventListener('input', (e) => {
                renderStatisticsSensors(objectName, e.target.value);
            });
            filterInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    filterInput.value = '';
                    filterInput.blur();
                    renderStatisticsSensors(objectName, '');
                }
            });
        }

        generalTable = container.querySelector('.stats-general-table');
        sensorsSection = container.querySelector('.stats-sensors-section');
    }

    // Обновляем общую статистику
    const generalTbody = generalTable.querySelector('tbody');
    generalTbody.innerHTML = '';

    Object.entries(statsData).forEach(([key, value]) => {
        if (key === 'sensors' && typeof value === 'object') {
            return;
        }
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="info-label">${key}</td>
            <td class="info-value">${formatValue(value)}</td>
        `;
        generalTbody.appendChild(tr);
    });

    // Обновляем секцию сенсоров
    if (statsData.sensors && typeof statsData.sensors === 'object' && Object.keys(statsData.sensors).length > 0) {
        sensorsSection.style.display = 'block';
        const currentFilter = container.querySelector(`#filter-stats-${objectName}`)?.value || '';
        renderStatisticsSensors(objectName, currentFilter);
    } else {
        sensorsSection.style.display = 'none';
    }
}

// Рендеринг таблицы сенсоров в статистике с фильтрацией
function renderStatisticsSensors(objectName, filterText = '') {
    const tabState = state.tabs.get(objectName);
    if (!tabState || !tabState.statisticsData?.sensors) return;

    const container = document.getElementById(`statistics-${objectName}`);
    if (!container) return;

    const tbody = container.querySelector('.stats-sensors-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const filterLower = filterText.toLowerCase();
    const sensors = tabState.statisticsData.sensors;

    Object.entries(sensors).forEach(([sensorKey, sensorData]) => {
        // sensorData может быть объектом {id, name, count} или просто числом
        let sensorId, sensorName, sensorCount;

        if (typeof sensorData === 'object' && sensorData !== null) {
            // Формат: {id: 1, name: "Input1_S", count: 5}
            sensorId = sensorData.id ?? '-';
            sensorName = sensorData.name || sensorKey;
            sensorCount = sensorData.count ?? 0;
        } else {
            // Формат: "SensorName": 5 (просто число срабатываний)
            const sensorInfo = getSensorInfo(sensorKey);
            sensorId = sensorInfo?.id || '-';
            sensorName = sensorKey;
            sensorCount = sensorData;
        }

        if (filterText && !sensorName.toLowerCase().includes(filterLower)) {
            return;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${sensorId}</td>
            <td class="variable-name">${sensorName}</td>
            <td class="variable-value">${formatValue(sensorCount)}</td>
        `;
        tbody.appendChild(tr);
    });

    if (tbody.children.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">Нет данных</td></tr>';
    }
}

// Восстановление состояния спойлеров из localStorage
function restoreCollapsedSections(objectName) {
    try {
        const saved = localStorage.getItem('uniset2-viewer-collapsed');
        if (saved) {
            state.collapsedSections = JSON.parse(saved);
        }
    } catch (err) {
        console.warn('Ошибка загрузки состояния спойлеров:', err);
    }

    // Применить сохранённые состояния к секциям этого объекта
    Object.entries(state.collapsedSections).forEach(([sectionId, collapsed]) => {
        if (sectionId.endsWith(`-${objectName}`)) {
            const section = document.querySelector(`[data-section="${sectionId}"]`);
            if (section && collapsed) {
                section.classList.add('collapsed');
            }
        }
    });
}

// Сохранение состояния спойлеров в localStorage
function saveCollapsedSections() {
    const sections = document.querySelectorAll('.collapsible-section[data-section]');
    const collapsed = {};

    sections.forEach(section => {
        const sectionId = section.dataset.section;
        collapsed[sectionId] = section.classList.contains('collapsed');
    });

    state.collapsedSections = collapsed;

    try {
        localStorage.setItem('uniset2-viewer-collapsed', JSON.stringify(collapsed));
    } catch (err) {
        console.warn('Ошибка сохранения состояния спойлеров:', err);
    }
}

// Color picker для изменения цвета графика
let activeColorPicker = null;

function showColorPicker(element, objectName, varName) {
    // Закрыть предыдущий picker если открыт
    hideColorPicker();

    const tabState = state.tabs.get(objectName);
    if (!tabState) return;

    const chartData = tabState.charts.get(varName);
    if (!chartData) return;

    const currentColor = chartData.color;
    const rect = element.getBoundingClientRect();

    const popup = document.createElement('div');
    popup.className = 'color-picker-popup';
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 4}px`;

    chartColors.forEach(color => {
        const option = document.createElement('div');
        option.className = 'color-picker-option';
        if (color === currentColor) option.classList.add('selected');
        option.style.background = color;
        option.addEventListener('click', () => {
            changeChartColor(objectName, varName, color);
            hideColorPicker();
        });
        popup.appendChild(option);
    });

    document.body.appendChild(popup);
    activeColorPicker = popup;

    // Закрыть по клику вне popup
    setTimeout(() => {
        document.addEventListener('click', handleColorPickerOutsideClick);
    }, 0);
}

function hideColorPicker() {
    if (activeColorPicker) {
        activeColorPicker.remove();
        activeColorPicker = null;
        document.removeEventListener('click', handleColorPickerOutsideClick);
    }
}

function handleColorPickerOutsideClick(e) {
    if (activeColorPicker && !activeColorPicker.contains(e.target) && !e.target.classList.contains('legend-color-picker')) {
        hideColorPicker();
    }
}

function changeChartColor(objectName, varName, newColor) {
    const tabState = state.tabs.get(objectName);
    if (!tabState) return;

    const chartData = tabState.charts.get(varName);
    if (!chartData) return;

    // Обновить цвет в данных
    chartData.color = newColor;

    // Обновить цвет графика
    const chart = chartData.chart;
    chart.data.datasets[0].borderColor = newColor;
    chart.data.datasets[0].backgroundColor = `${newColor}20`;
    chart.update('none');

    // Обновить цвет квадратика в шапке
    const colorPicker = document.querySelector(`#chart-panel-${objectName}-${varName} .legend-color-picker`);
    if (colorPicker) {
        colorPicker.style.background = newColor;
    }
}

// Переключение заливки графика
function toggleChartFill(objectName, varName, fillEnabled) {
    const tabState = state.tabs.get(objectName);
    if (!tabState) return;

    const chartData = tabState.charts.get(varName);
    if (!chartData) return;

    chartData.chart.data.datasets[0].fill = fillEnabled;
    chartData.chart.update('none');
}

// Делегирование события для color picker
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('legend-color-picker')) {
        const objectName = e.target.dataset.object;
        const varName = e.target.dataset.variable;
        showColorPicker(e.target, objectName, varName);
    }
});

// Настройка обработчиков фильтра для вкладки
function setupFilterHandlers(objectName) {
    const filterInput = document.getElementById(`filter-variables-${objectName}`);
    if (!filterInput) return;

    // Обработка ввода
    filterInput.addEventListener('input', (e) => {
        const tabState = state.tabs.get(objectName);
        if (tabState && tabState.variables) {
            renderVariables(objectName, tabState.variables, e.target.value);
        }
    });

    // Обработка ESC
    filterInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            filterInput.value = '';
            filterInput.blur();
            const tabState = state.tabs.get(objectName);
            if (tabState && tabState.variables) {
                renderVariables(objectName, tabState.variables, '');
            }
        }
    });
}

// Настройка resize для графиков
function setupChartsResize(objectName) {
    const resizeHandle = document.getElementById(`charts-resize-${objectName}`);
    const chartsContainer = document.getElementById(`charts-container-${objectName}`);

    if (!resizeHandle || !chartsContainer) return;

    let startY = 0;
    let startHeight = 0;
    let isResizing = false;

    const onMouseMove = (e) => {
        if (!isResizing) return;
        const delta = e.clientY - startY;
        const newHeight = Math.max(150, startHeight + delta);
        chartsContainer.style.height = `${newHeight}px`;
        chartsContainer.style.maxHeight = `${newHeight}px`;
    };

    const onMouseUp = () => {
        if (!isResizing) return;
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Сохраняем высоту
        saveChartsHeight(objectName, chartsContainer.offsetHeight);
    };

    resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizing = true;
        startY = e.clientY;
        startHeight = chartsContainer.offsetHeight || 300;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    });

    // Загружаем сохранённую высоту
    loadChartsHeight(objectName);
}

function saveChartsHeight(objectName, height) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-charts-height') || '{}');
        saved[objectName] = height;
        localStorage.setItem('uniset2-viewer-charts-height', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save charts height:', err);
    }
}

function loadChartsHeight(objectName) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-charts-height') || '{}');
        if (saved[objectName]) {
            const chartsContainer = document.getElementById(`charts-container-${objectName}`);
            if (chartsContainer) {
                chartsContainer.style.height = `${saved[objectName]}px`;
                chartsContainer.style.maxHeight = `${saved[objectName]}px`;
            }
        }
    } catch (err) {
        console.warn('Failed to load charts height:', err);
    }
}

// Настройка resize для IONC секции датчиков
function setupIONCSensorsResize(objectName) {
    const resizeHandle = document.getElementById(`ionc-resize-${objectName}`);
    const sensorsContainer = document.getElementById(`ionc-sensors-container-${objectName}`);

    if (!resizeHandle || !sensorsContainer) return;

    let startY = 0;
    let startHeight = 0;
    let isResizing = false;

    const onMouseMove = (e) => {
        if (!isResizing) return;
        const delta = e.clientY - startY;
        const newHeight = Math.max(200, startHeight + delta);
        sensorsContainer.style.height = `${newHeight}px`;
        sensorsContainer.style.maxHeight = `${newHeight}px`;
    };

    const onMouseUp = () => {
        if (!isResizing) return;
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Сохраняем высоту
        saveIONCSensorsHeight(objectName, sensorsContainer.offsetHeight);
    };

    resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizing = true;
        startY = e.clientY;
        startHeight = sensorsContainer.offsetHeight || 400;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    });

    // Загружаем сохранённую высоту
    loadIONCSensorsHeight(objectName);
}

function saveIONCSensorsHeight(objectName, height) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-ionc-height') || '{}');
        saved[objectName] = height;
        localStorage.setItem('uniset2-viewer-ionc-height', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save IONC sensors height:', err);
    }
}

function loadIONCSensorsHeight(objectName) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-ionc-height') || '{}');
        if (saved[objectName]) {
            const sensorsContainer = document.getElementById(`ionc-sensors-container-${objectName}`);
            if (sensorsContainer) {
                sensorsContainer.style.height = `${saved[objectName]}px`;
                sensorsContainer.style.maxHeight = `${saved[objectName]}px`;
            }
        }
    } catch (err) {
        console.warn('Failed to load IONC sensors height:', err);
    }
}

// Переключение режима отображения IO (горизонтально/вертикально)
function toggleIOLayout(objectName) {
    const checkbox = document.getElementById(`io-sequential-${objectName}`);
    const ioGrid = document.getElementById(`io-grid-${objectName}`);

    if (!checkbox || !ioGrid) return;

    if (checkbox.checked) {
        ioGrid.classList.add('io-sequential');
    } else {
        ioGrid.classList.remove('io-sequential');
    }

    // Сохраняем состояние
    saveIOLayoutState(objectName, checkbox.checked);
}

function saveIOLayoutState(objectName, isSequential) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-io-layout') || '{}');
        saved[objectName] = isSequential;
        localStorage.setItem('uniset2-viewer-io-layout', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save IO layout state:', err);
    }
}

function loadIOLayoutState(objectName) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-io-layout') || '{}');
        if (saved[objectName]) {
            const checkbox = document.getElementById(`io-sequential-${objectName}`);
            const ioGrid = document.getElementById(`io-grid-${objectName}`);
            if (checkbox && ioGrid) {
                checkbox.checked = true;
                ioGrid.classList.add('io-sequential');
            }
        }
    } catch (err) {
        console.warn('Failed to load IO layout state:', err);
    }
}

// === Section Reordering ===

function moveSectionUp(objectName, sectionId) {
    const section = getSectionElement(objectName, sectionId);
    if (!section) return;

    const prev = getPreviousReorderableSection(section);
    if (prev) {
        section.parentNode.insertBefore(section, prev);
        saveSectionOrder(objectName);
        updateReorderButtons(objectName);
    }
}

function moveSectionDown(objectName, sectionId) {
    const section = getSectionElement(objectName, sectionId);
    if (!section) return;

    const next = getNextReorderableSection(section);
    if (next) {
        section.parentNode.insertBefore(next, section);
        saveSectionOrder(objectName);
        updateReorderButtons(objectName);
    }
}

function getSectionElement(objectName, sectionId) {
    // Для logviewer ищем wrapper
    if (sectionId === 'logviewer') {
        return document.getElementById(`logviewer-wrapper-${objectName}`);
    }
    // Для остальных секций ищем по data-section-id
    const panel = document.querySelector(`.tab-panel[data-name="${objectName}"]`);
    if (!panel) return null;
    return panel.querySelector(`.reorderable-section[data-section-id="${sectionId}"]`);
}

function getPreviousReorderableSection(element) {
    let prev = element.previousElementSibling;
    while (prev) {
        if (prev.classList.contains('reorderable-section') && prev.style.display !== 'none') {
            return prev;
        }
        prev = prev.previousElementSibling;
    }
    return null;
}

function getNextReorderableSection(element) {
    let next = element.nextElementSibling;
    while (next) {
        if (next.classList.contains('reorderable-section') && next.style.display !== 'none') {
            return next;
        }
        next = next.nextElementSibling;
    }
    return null;
}

function saveSectionOrder(objectName) {
    try {
        const panel = document.querySelector(`.tab-panel[data-name="${objectName}"]`);
        if (!panel) return;

        const sections = panel.querySelectorAll('.reorderable-section[data-section-id]');
        const order = Array.from(sections).map(s => s.dataset.sectionId);

        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-section-order') || '{}');
        saved[objectName] = order;
        localStorage.setItem('uniset2-viewer-section-order', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save section order:', err);
    }
}

function loadSectionOrder(objectName) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-section-order') || '{}');
        const order = saved[objectName];
        if (!order || !Array.isArray(order)) return;

        const panel = document.querySelector(`.tab-panel[data-name="${objectName}"]`);
        if (!panel) return;

        // Собираем все reorderable секции в Map
        const sections = new Map();
        panel.querySelectorAll('.reorderable-section[data-section-id]').forEach(s => {
            sections.set(s.dataset.sectionId, s);
        });

        if (sections.size === 0) return;

        // Собираем секции в нужном порядке
        const orderedSections = order
            .map(id => sections.get(id))
            .filter(s => s != null);

        if (orderedSections.length < 2) return;

        // Находим первую секцию в DOM (точка привязки)
        const allSections = [...sections.values()];
        allSections.sort((a, b) =>
            a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
        );
        let anchor = allSections[0];

        // Вставляем в обратном порядке перед anchor
        // После каждой вставки новый элемент становится anchor
        for (let i = orderedSections.length - 1; i >= 0; i--) {
            panel.insertBefore(orderedSections[i], anchor);
            anchor = orderedSections[i];
        }

        updateReorderButtons(objectName);
    } catch (err) {
        console.warn('Failed to load section order:', err);
    }
}

function updateReorderButtons(objectName) {
    const panel = document.querySelector(`.tab-panel[data-name="${objectName}"]`);
    if (!panel) return;

    const sections = Array.from(panel.querySelectorAll('.reorderable-section[data-section-id]'))
        .filter(s => s.style.display !== 'none');

    sections.forEach((section, index) => {
        const upBtn = section.querySelector('.section-move-up');
        const downBtn = section.querySelector('.section-move-down');

        if (upBtn) {
            upBtn.disabled = index === 0;
        }
        if (downBtn) {
            downBtn.disabled = index === sections.length - 1;
        }
    });
}

// IO Section resize, filter, and pin functionality
function setupIOSections(objectName) {
    // Setup global filter for all IO sections
    setupIOGlobalFilter(objectName);

    ['inputs', 'outputs', 'timers'].forEach(type => {
        setupIOResize(objectName, type);
        setupIOUnpinAll(objectName, type);
        setupIOCollapse(objectName, type);
    });
}

function setupIOCollapse(objectName, type) {
    const toggleEl = document.querySelector(`.io-section-toggle[data-section="${type}-${objectName}"]`);
    const section = document.getElementById(`${type}-section-${objectName}`);

    if (!toggleEl || !section) return;

    // Load saved state
    const savedState = loadIOCollapseState(objectName, type);
    if (savedState === 'collapsed') {
        section.classList.add('collapsed');
    }

    toggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        section.classList.toggle('collapsed');
        saveIOCollapseState(objectName, type, section.classList.contains('collapsed'));
    });
}

function saveIOCollapseState(objectName, type, collapsed) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-io-collapse') || '{}');
        const key = `${objectName}-${type}`;
        saved[key] = collapsed ? 'collapsed' : 'expanded';
        localStorage.setItem('uniset2-viewer-io-collapse', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save IO collapse state:', err);
    }
}

function loadIOCollapseState(objectName, type) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-io-collapse') || '{}');
        const key = `${objectName}-${type}`;
        return saved[key] || 'expanded';
    } catch (err) {
        console.warn('Failed to load IO collapse state:', err);
        return 'expanded';
    }
}

function setupIOResize(objectName, type) {
    const resizeHandle = document.getElementById(`io-resize-${type}-${objectName}`);
    const container = document.getElementById(`io-container-${type}-${objectName}`);

    if (!resizeHandle || !container) return;

    let startY = 0;
    let startHeight = 0;
    let isResizing = false;

    const onMouseMove = (e) => {
        if (!isResizing) return;
        const delta = e.clientY - startY;
        const newHeight = Math.max(100, startHeight + delta);
        container.style.height = `${newHeight}px`;
        container.style.maxHeight = `${newHeight}px`;
    };

    const onMouseUp = () => {
        if (!isResizing) return;
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        saveIOHeight(objectName, type, container.offsetHeight);
    };

    resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizing = true;
        startY = e.clientY;
        startHeight = container.offsetHeight || 200;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    });

    loadIOHeight(objectName, type);
}

function saveIOHeight(objectName, type, height) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-io-heights') || '{}');
        const key = `${objectName}-${type}`;
        saved[key] = height;
        localStorage.setItem('uniset2-viewer-io-heights', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save IO height:', err);
    }
}

function loadIOHeight(objectName, type) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-io-heights') || '{}');
        const key = `${objectName}-${type}`;
        if (saved[key]) {
            const container = document.getElementById(`io-container-${type}-${objectName}`);
            if (container) {
                container.style.height = `${saved[key]}px`;
                container.style.maxHeight = `${saved[key]}px`;
            }
        }
    } catch (err) {
        console.warn('Failed to load IO height:', err);
    }
}

function setupIOGlobalFilter(objectName) {
    const filterInput = document.getElementById(`io-filter-global-${objectName}`);
    if (!filterInput) return;

    let filterTimeout = null;

    const refilterAll = () => {
        const tabState = state.tabs.get(objectName);
        if (tabState) {
            if (tabState.ioData?.in) {
                renderIO(objectName, 'inputs', tabState.ioData.in);
            }
            if (tabState.ioData?.out) {
                renderIO(objectName, 'outputs', tabState.ioData.out);
            }
            if (tabState.timersData) {
                renderTimers(objectName, tabState.timersData);
            }
        }
    };

    filterInput.addEventListener('input', (e) => {
        clearTimeout(filterTimeout);
        filterTimeout = setTimeout(refilterAll, 200);
    });

    // ESC to clear and blur
    filterInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            filterInput.value = '';
            filterInput.blur();
            refilterAll();
        }
    });
}

function setupIOUnpinAll(objectName, type) {
    const unpinBtn = document.getElementById(`io-unpin-${type}-${objectName}`);
    if (!unpinBtn) return;

    unpinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearIOPinnedRows(objectName, type);
        // Перерисовываем
        const tabState = state.tabs.get(objectName);
        if (tabState) {
            if (type === 'inputs' && tabState.ioData?.in) {
                renderIO(objectName, 'inputs', tabState.ioData.in);
            } else if (type === 'outputs' && tabState.ioData?.out) {
                renderIO(objectName, 'outputs', tabState.ioData.out);
            } else if (type === 'timers' && tabState.timersData) {
                renderTimers(objectName, tabState.timersData);
            }
        }
    });
}

// Pinned rows management
function getIOPinnedRows(objectName, type) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-io-pinned') || '{}');
        const key = `${objectName}-${type}`;
        return new Set(saved[key] || []);
    } catch (err) {
        return new Set();
    }
}

function saveIOPinnedRows(objectName, type, pinnedSet) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-io-pinned') || '{}');
        const key = `${objectName}-${type}`;
        saved[key] = Array.from(pinnedSet);
        localStorage.setItem('uniset2-viewer-io-pinned', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save pinned rows:', err);
    }
}

function toggleIOPin(objectName, type, rowKey) {
    const pinned = getIOPinnedRows(objectName, type);
    const keyStr = String(rowKey);

    if (pinned.has(keyStr)) {
        pinned.delete(keyStr);
    } else {
        pinned.add(keyStr);
    }

    saveIOPinnedRows(objectName, type, pinned);

    // Перерисовываем
    const tabState = state.tabs.get(objectName);
    if (tabState) {
        if (type === 'inputs' && tabState.ioData?.in) {
            renderIO(objectName, 'inputs', tabState.ioData.in);
        } else if (type === 'outputs' && tabState.ioData?.out) {
            renderIO(objectName, 'outputs', tabState.ioData.out);
        } else if (type === 'timers' && tabState.timersData) {
            renderTimers(objectName, tabState.timersData);
        }
    }
}

function clearIOPinnedRows(objectName, type) {
    saveIOPinnedRows(objectName, type, new Set());
}

// Установка временного диапазона
function setTimeRange(range) {
    // Обновляем active класс на всех кнопках
    document.querySelectorAll('.time-range-btn').forEach(btn => {
        const btnRange = parseInt(btn.getAttribute('onclick')?.match(/setTimeRange\((\d+)\)/)?.[1], 10);
        btn.classList.toggle('active', btnRange === range);
    });

    state.timeRange = range;
    saveSettings();

    // Сбросить начальное время для всех вкладок при изменении интервала
    state.tabs.forEach((tabState, objectName) => {
        if (tabState.charts.size > 0) {
            tabState.chartStartTime = Date.now();
        }
        tabState.charts.forEach((chartData, varName) => {
            updateChart(objectName, varName, chartData.chart);
        });
    });
}


// Сохранение настроек в localStorage
function saveSettings() {
    const settings = {
        timeRange: state.timeRange,
        sidebarCollapsed: state.sidebarCollapsed
    };
    localStorage.setItem('uniset2-viewer-settings', JSON.stringify(settings));
}

// Загрузка настроек из localStorage
function loadSettings() {
    try {
        const saved = localStorage.getItem('uniset2-viewer-settings');
        if (saved) {
            const settings = JSON.parse(saved);

            // Восстановить timeRange
            if (settings.timeRange) {
                state.timeRange = settings.timeRange;
                document.querySelectorAll('.time-range-btn').forEach(btn => {
                    btn.classList.toggle('active', parseInt(btn.dataset.range, 10) === state.timeRange);
                });
            }

            // Восстановить состояние sidebar
            if (settings.sidebarCollapsed) {
                state.sidebarCollapsed = settings.sidebarCollapsed;
                document.getElementById('sidebar').classList.add('collapsed');
            }
        }
    } catch (err) {
        console.warn('Ошибка загрузки настроек:', err);
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    // Инициализация SSE для realtime обновлений (получаем capabilities при подключении)
    initSSE();

    // Загружаем конфигурацию сенсоров (не блокируем загрузку объектов)
    loadSensorsConfig().catch(err => {
        console.warn('Не удалось загрузить конфигурацию сенсоров:', err);
    });

    // Загружаем список объектов
    fetchObjects()
        .then(renderObjectsList)
        .catch(err => {
            console.error('Ошибка загрузки объектов:', err);
            document.getElementById('objects-list').innerHTML =
                '<li class="error">Ошибка загрузки объектов</li>';
        });

    // Кнопка обновления
    document.getElementById('refresh-objects').addEventListener('click', () => {
        fetchObjects()
            .then(renderObjectsList)
            .catch(console.error);
    });

    // Кнопка очистки кэша
    document.getElementById('clear-cache').addEventListener('click', () => {
        if (confirm('Очистить все сохранённые настройки?\n\nБудут удалены:\n- порядок секций\n- выбранные графики\n- настройки LogViewer\n- состояние sidebar')) {
            localStorage.clear();
            location.reload();
        }
    });

    // Кнопка сворачивания боковой панели
    document.getElementById('toggle-sidebar').addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('collapsed');
        state.sidebarCollapsed = sidebar.classList.contains('collapsed');
        saveSettings();
    });

    // Загрузка сохранённых настроек
    loadSettings();
});
