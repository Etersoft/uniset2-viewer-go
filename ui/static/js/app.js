// Состояние приложения
const state = {
    objects: [],
    tabs: new Map(), // objectName -> { charts, updateInterval, chartStartTime, objectType, renderer }
    activeTab: null,
    sensors: new Map(), // sensorId -> sensorInfo
    sensorsByName: new Map(), // sensorName -> sensorInfo
    timeRange: 900, // секунды (по умолчанию 15 минут)
    sidebarCollapsed: false, // свёрнутая боковая панель
    collapsedSections: {}, // состояние спойлеров
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
            console.log('SSE: Подключено, poll interval:', state.sse.pollInterval, 'ms');

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
            const objectName = event.objectName;
            const data = event.data;

            // Обновляем UI только для открытых вкладок
            const tabState = state.tabs.get(objectName);
            if (tabState) {
                // Обновляем рендерер (таблицы, статистика и т.д.)
                if (tabState.renderer) {
                    tabState.renderer.update(data);
                }

                // Обновляем графики
                tabState.charts.forEach((chartData, varName) => {
                    updateChart(objectName, varName, chartData.chart);
                });
            }
        } catch (err) {
            console.warn('SSE: Ошибка обработки object_data:', err);
        }
    });

    eventSource.onerror = (e) => {
        console.warn('SSE: Ошибка соединения');
        state.sse.connected = false;

        if (state.sse.reconnectAttempts < state.sse.maxReconnectAttempts) {
            state.sse.reconnectAttempts++;
            const delay = state.sse.reconnectDelay * state.sse.reconnectAttempts;
            console.log(`SSE: Переподключение через ${delay}ms (попытка ${state.sse.reconnectAttempts})`);
            setTimeout(initSSE, delay);
        } else {
            console.warn('SSE: Превышено количество попыток, переход на polling');
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
    constructor(objectName) {
        this.objectName = objectName;
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
            <div class="collapsible-section" data-section="${id}-${this.objectName}" id="${sectionId}" ${style}>
                <div class="collapsible-header" onclick="toggleSection('${id}-${this.objectName}')">
                    <svg class="collapsible-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M6 9l6 6 6-6"/>
                    </svg>
                    <span class="collapsible-title">${title}</span>
                    ${badgeHtml}
                </div>
                <div class="collapsible-content" id="section-${id}-${this.objectName}">
                    ${content}
                </div>
            </div>
        `;
    }

    createChartsSection() {
        return this.createCollapsibleSection('charts', 'Графики', `
            <div id="charts-${this.objectName}" class="charts-grid"></div>
        `);
    }

    createIOSection(type, title) {
        const typeLower = type.toLowerCase();
        return this.createCollapsibleSection(typeLower, title, `
            <table class="variables-table">
                <thead>
                    <tr>
                        <th>Имя</th>
                        <th>Описание</th>
                        <th>ID</th>
                        <th>Тип</th>
                        <th>Значение</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody id="${typeLower}-${this.objectName}"></tbody>
            </table>
        `, { badge: true });
    }

    createTimersSection() {
        return this.createCollapsibleSection('timers', 'Таймеры', `
            <table class="variables-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Имя</th>
                        <th>Интервал</th>
                        <th>Осталось</th>
                        <th>Tick</th>
                    </tr>
                </thead>
                <tbody id="timers-${this.objectName}"></tbody>
            </table>
        `, { badge: true });
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
}

// Рендерер для UniSetManager (полный функционал)
class UniSetManagerRenderer extends BaseObjectRenderer {
    static getTypeName() {
        return 'UniSetManager';
    }

    createPanelHTML() {
        return `
            ${this.createChartsSection()}
            <div class="io-grid io-grid-3">
                ${this.createIOSection('inputs', 'Входы')}
                ${this.createIOSection('outputs', 'Выходы')}
                ${this.createTimersSection()}
            </div>
            ${this.createVariablesSection()}
            ${this.createLogServerSection()}
            ${this.createStatisticsSection()}
            ${this.createObjectInfoSection()}
        `;
    }

    initialize() {
        setupFilterHandlers(this.objectName);
    }

    update(data) {
        renderVariables(this.objectName, data.Variables || {});
        renderIO(this.objectName, 'inputs', data.io?.in || {});
        renderIO(this.objectName, 'outputs', data.io?.out || {});
        renderTimers(this.objectName, data.Timers || {});
        renderObjectInfo(this.objectName, data.object);
        renderLogServer(this.objectName, data.LogServer);
        renderStatistics(this.objectName, data.Statistics);
        updateChartLegends(this.objectName, data);
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
            ${this.createVariablesSection()}
            ${this.createLogServerSection()}
            ${this.createStatisticsSection()}
            ${this.createObjectInfoSection()}
        `;
    }

    initialize() {
        setupFilterHandlers(this.objectName);
    }

    update(data) {
        renderVariables(this.objectName, data.Variables || {});
        renderObjectInfo(this.objectName, data.object);
        renderLogServer(this.objectName, data.LogServer);
        renderStatistics(this.objectName, data.Statistics);
        updateChartLegends(this.objectName, data);
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
        // Обновляем тип объекта в сообщении
        const typeSpan = document.querySelector(`#panel-${this.objectName} .fallback-type`);
        if (typeSpan && data.object?.objectType) {
            typeSpan.textContent = data.object.objectType;
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

// Регистрируем стандартные рендереры
registerRenderer('UniSetManager', UniSetManagerRenderer);
registerRenderer('UniSetObject', UniSetObjectRenderer);

// ============================================================================
// Конец системы рендереров
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
async function fetchObjects() {
    const response = await fetch('/api/objects');
    if (!response.ok) throw new Error('Не удалось загрузить список объектов');
    return response.json();
}

async function fetchObjectData(name) {
    const response = await fetch(`/api/objects/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error('Не удалось загрузить данные объекта');
    return response.json();
}

async function watchObject(name) {
    const response = await fetch(`/api/objects/${encodeURIComponent(name)}/watch`, {
        method: 'POST'
    });
    if (!response.ok) throw new Error('Не удалось начать наблюдение');
    return response.json();
}

async function unwatchObject(name) {
    const response = await fetch(`/api/objects/${encodeURIComponent(name)}/watch`, {
        method: 'DELETE'
    });
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

// Загрузка конфигурации сенсоров
async function loadSensorsConfig() {
    try {
        const data = await fetchSensors();
        if (data.sensors) {
            data.sensors.forEach(sensor => {
                state.sensors.set(sensor.id, sensor);
                state.sensorsByName.set(sensor.name, sensor);
            });
        }
        console.log(`Загружено ${state.sensors.size} сенсоров`);
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

// UI функции
function renderObjectsList(objects) {
    const list = document.getElementById('objects-list');
    list.innerHTML = '';

    if (!objects || !objects.objects) {
        list.innerHTML = '<li class="loading">Объекты не найдены</li>';
        return;
    }

    objects.objects.forEach(name => {
        const li = document.createElement('li');
        li.textContent = name;
        li.dataset.name = name;
        li.addEventListener('click', () => openObjectTab(name));
        list.appendChild(li);
    });
}

async function openObjectTab(name) {
    if (state.tabs.has(name)) {
        activateTab(name);
        return;
    }

    // Сначала загружаем данные, чтобы узнать тип объекта
    try {
        const data = await fetchObjectData(name);
        const objectType = data.object?.objectType || 'Default';

        createTab(name, objectType, data);
        activateTab(name);

        watchObject(name).catch(console.error);
    } catch (err) {
        console.error(`Ошибка открытия вкладки ${name}:`, err);
    }
}

function createTab(name, objectType, initialData) {
    const tabsHeader = document.getElementById('tabs-header');
    const tabsContent = document.getElementById('tabs-content');

    const placeholder = tabsContent.querySelector('.placeholder');
    if (placeholder) placeholder.remove();

    // Получаем класс рендерера для данного типа объекта
    const RendererClass = getRendererClass(objectType);
    const renderer = new RendererClass(name);

    // Кнопка вкладки с индикатором типа
    const tabBtn = document.createElement('button');
    tabBtn.className = 'tab-btn';
    tabBtn.dataset.name = name;
    tabBtn.dataset.objectType = objectType;
    tabBtn.innerHTML = `
        <span class="tab-type-badge">${objectType}</span>
        ${name}
        <span class="close">&times;</span>
    `;
    tabBtn.addEventListener('click', (e) => {
        if (e.target.classList.contains('close')) {
            closeTab(name);
        } else {
            activateTab(name);
        }
    });
    tabsHeader.appendChild(tabBtn);

    // Панель содержимого - создаётся рендерером
    const panel = document.createElement('div');
    panel.className = 'tab-panel';
    panel.dataset.name = name;
    panel.dataset.objectType = objectType;
    panel.innerHTML = renderer.createPanelHTML();
    tabsContent.appendChild(panel);

    // Восстановить состояние спойлеров
    restoreCollapsedSections(name);

    // Сохраняем состояние вкладки с рендерером
    // Если SSE подключен, не запускаем polling (данные будут приходить через SSE)
    const updateInterval = state.sse.connected
        ? null
        : setInterval(() => loadObjectData(name), state.sse.pollInterval);

    state.tabs.set(name, {
        charts: new Map(),
        variables: {},
        objectType: objectType,
        renderer: renderer,
        updateInterval: updateInterval
    });

    // Инициализация рендерера (настройка обработчиков и т.д.)
    renderer.initialize();

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

    tbody.innerHTML = '';
    const entries = Object.entries(ioData);

    if (countBadge) {
        countBadge.textContent = entries.length;
    }

    entries.forEach(([key, io]) => {
        const varName = `io.${type === 'inputs' ? 'in' : 'out'}.${key}`;
        const sensor = getSensorInfo(io.id) || getSensorInfo(io.name);
        const iotype = sensor?.iotype || (type === 'inputs' ? 'DI' : 'DO');
        // Сначала пробуем взять textname из ответа API, потом из справочника сенсоров
        const textname = io.textname || sensor?.textname || '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="variable-name">${io.name || key}</td>
            <td class="variable-textname">${textname}</td>
            <td>${io.id}</td>
            <td><span class="variable-iotype iotype-${iotype.toLowerCase()}">${iotype}</span></td>
            <td class="variable-value" data-var="${varName}">${formatValue(io.value)}</td>
            <td>
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
        `;

        const checkbox = tr.querySelector('input');
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

function hasChart(objectName, varName) {
    const tabState = state.tabs.get(objectName);
    return tabState && tabState.charts.has(varName);
}

async function addChart(objectName, varName, sensorId, passedTextname) {
    const tabState = state.tabs.get(objectName);
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
    // textname: сначала переданный параметр, потом из справочника сенсоров
    const textName = passedTextname || sensor?.textname || '';

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
    const tabState = state.tabs.get(objectName);
    if (!tabState) return;

    const chartData = tabState.charts.get(varName);
    if (chartData) {
        clearInterval(chartData.updateInterval);
        chartData.chart.destroy();
        tabState.charts.delete(varName);
    }

    document.getElementById(`chart-panel-${objectName}-${varName}`)?.remove();

    // Снять галочку в таблице
    const checkbox = document.getElementById(`chart-${objectName}-${varName}`);
    if (checkbox) {
        checkbox.checked = false;
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

    tbody.innerHTML = '';

    if (timers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Нет таймеров</td></tr>';
        return;
    }

    timers.forEach(timer => {
        const tr = document.createElement('tr');
        tr.dataset.timerId = timer.id;

        // Форматирование tick: -1 означает бесконечный таймер
        const tickDisplay = timer.tick === -1 ? '∞' : timer.tick;
        const tickClass = timer.tick === -1 ? 'timer-infinite' : '';

        // Форматирование timeleft с прогресс-баром
        const timeleftPercent = timer.msec > 0 ? Math.max(0, (timer.timeleft / timer.msec) * 100) : 0;
        const timeleftClass = timer.timeleft <= 0 ? 'timer-expired' : '';

        tr.innerHTML = `
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
        Object.entries(logServerData.info).forEach(([key, value]) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="info-label">${key}</td>
                <td class="info-value">${formatValue(value)}</td>
            `;
            tbody.appendChild(tr);
        });
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

// Обработка выбора временного диапазона
function setupTimeRangeSelector() {
    document.querySelectorAll('.time-range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.time-range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.timeRange = parseInt(btn.dataset.range, 10);
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
    // Инициализация SSE для realtime обновлений
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

    // Кнопка сворачивания боковой панели
    document.getElementById('toggle-sidebar').addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('collapsed');
        state.sidebarCollapsed = sidebar.classList.contains('collapsed');
        saveSettings();
    });

    // Настройка селектора временного диапазона
    setupTimeRangeSelector();

    // Загрузка сохранённых настроек
    loadSettings();
});
