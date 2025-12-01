// Состояние приложения
const state = {
    objects: [],
    tabs: new Map(), // objectName -> { charts, updateInterval }
    activeTab: null,
    sensors: new Map(), // sensorId -> sensorInfo
    sensorsByName: new Map(), // sensorName -> sensorInfo
    timeRange: 900, // секунды (по умолчанию 15 минут)
    sharedTimeRange: { min: null, max: null } // общий диапазон времени для всех графиков
};

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

function openObjectTab(name) {
    if (state.tabs.has(name)) {
        activateTab(name);
        return;
    }

    createTab(name);
    activateTab(name);

    watchObject(name).catch(console.error);
    loadObjectData(name);
}

function createTab(name) {
    const tabsHeader = document.getElementById('tabs-header');
    const tabsContent = document.getElementById('tabs-content');

    const placeholder = tabsContent.querySelector('.placeholder');
    if (placeholder) placeholder.remove();

    // Кнопка вкладки
    const tabBtn = document.createElement('button');
    tabBtn.className = 'tab-btn';
    tabBtn.dataset.name = name;
    tabBtn.innerHTML = `${name} <span class="close">&times;</span>`;
    tabBtn.addEventListener('click', (e) => {
        if (e.target.classList.contains('close')) {
            closeTab(name);
        } else {
            activateTab(name);
        }
    });
    tabsHeader.appendChild(tabBtn);

    // Панель содержимого
    const panel = document.createElement('div');
    panel.className = 'tab-panel';
    panel.dataset.name = name;
    panel.innerHTML = `
        <div class="charts-section">
            <h3 class="section-header">Графики</h3>
            <div id="charts-${name}" class="charts-grid"></div>
        </div>
        <div class="io-grid">
            <div class="io-section">
                <div class="io-section-header">
                    <span class="io-section-title">Входы</span>
                    <span class="io-section-badge" id="inputs-count-${name}">0</span>
                </div>
                <table class="variables-table">
                    <thead>
                        <tr>
                            <th>Имя</th>
                            <th>ID</th>
                            <th>Тип</th>
                            <th>Значение</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="inputs-${name}"></tbody>
                </table>
            </div>
            <div class="io-section">
                <div class="io-section-header">
                    <span class="io-section-title">Выходы</span>
                    <span class="io-section-badge" id="outputs-count-${name}">0</span>
                </div>
                <table class="variables-table">
                    <thead>
                        <tr>
                            <th>Имя</th>
                            <th>ID</th>
                            <th>Тип</th>
                            <th>Значение</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="outputs-${name}"></tbody>
                </table>
            </div>
        </div>
        <div class="variables-section">
            <h3 class="section-header">Переменные</h3>
            <table class="variables-table">
                <thead>
                    <tr>
                        <th>Имя</th>
                        <th>Значение</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody id="variables-${name}"></tbody>
            </table>
        </div>
    `;
    tabsContent.appendChild(panel);

    state.tabs.set(name, {
        charts: new Map(),
        updateInterval: setInterval(() => loadObjectData(name), 5000)
    });
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
        renderVariables(name, data.Variables || {});
        renderIO(name, 'inputs', data.io?.in || {});
        renderIO(name, 'outputs', data.io?.out || {});

        // Обновить значения в легендах графиков
        updateChartLegends(name, data);
    } catch (err) {
        console.error(`Ошибка загрузки ${name}:`, err);
    }
}

function renderVariables(objectName, variables) {
    const tbody = document.getElementById(`variables-${objectName}`);
    if (!tbody) return;

    tbody.innerHTML = '';

    Object.entries(variables).forEach(([varName, value]) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="variable-name">${varName}</td>
            <td class="variable-value">${formatValue(value)}</td>
            <td>
                <span class="chart-toggle">
                    <input type="checkbox"
                           id="chart-${objectName}-var-${varName}"
                           data-object="${objectName}"
                           data-variable="${varName}"
                           ${hasChart(objectName, varName) ? 'checked' : ''}>
                    <label class="chart-toggle-label" for="chart-${objectName}-var-${varName}">
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
                addChart(objectName, varName, null);
            } else {
                removeChart(objectName, varName);
            }
        });

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
        const textname = sensor?.textname || io.name || key;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="variable-name">${io.name || key}</div>
                <div class="variable-textname">${textname !== io.name ? textname : ''}</div>
            </td>
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
                addChart(objectName, varName, io.id);
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

async function addChart(objectName, varName, sensorId) {
    const tabState = state.tabs.get(objectName);
    if (!tabState || tabState.charts.has(varName)) return;

    const chartsContainer = document.getElementById(`charts-${objectName}`);
    const sensor = sensorId ? getSensorInfo(sensorId) : null;
    const isDiscrete = isDiscreteSignal(sensor);
    const color = getNextColor();
    const displayName = sensor?.name || varName.split('.').pop();
    const textName = sensor?.textname || displayName;

    // Создаём панель графика
    const chartDiv = document.createElement('div');
    chartDiv.className = 'chart-panel';
    chartDiv.id = `chart-panel-${objectName}-${varName}`;
    chartDiv.innerHTML = `
        <div class="chart-panel-header">
            <span class="chart-panel-title">${displayName}</span>
            <div class="chart-panel-actions">
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
        <div class="chart-legend">
            <table class="legend-table">
                <thead>
                    <tr>
                        <th>Имя</th>
                        <th>Описание</th>
                        <th style="text-align:right">Значение</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>
                            <span class="legend-color" style="background:${color}"></span>
                            <span class="legend-name">${displayName}</span>
                        </td>
                        <td class="legend-textname">${textName}</td>
                        <td class="legend-value" id="legend-value-${objectName}-${varName}">--</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
    chartsContainer.appendChild(chartDiv);

    // Загружаем историю
    try {
        const history = await fetchVariableHistory(objectName, varName, 200);
        const ctx = document.getElementById(`canvas-${objectName}-${varName}`).getContext('2d');

        // Преобразуем данные для временной шкалы
        const historyData = history.points?.map(p => ({
            x: new Date(p.timestamp),
            y: p.value
        })) || [];

        // Вычисляем общий диапазон времени
        updateSharedTimeRange(historyData);

        // Конфигурация графика в зависимости от типа сигнала
        const chartConfig = {
            type: 'line',
            data: {
                datasets: [{
                    label: displayName,
                    data: historyData,
                    borderColor: color,
                    backgroundColor: isDiscrete ? color : `${color}20`,
                    fill: !isDiscrete,
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
                        min: state.sharedTimeRange.min,
                        max: state.sharedTimeRange.max
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

        // Периодическое обновление
        chartData.updateInterval = setInterval(async () => {
            await updateChart(objectName, varName, chart);
        }, 5000);

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

        // Обновляем общий диапазон времени
        updateSharedTimeRange(chartData);

        // Применяем общий диапазон
        chart.options.scales.x.min = state.sharedTimeRange.min;
        chart.options.scales.x.max = state.sharedTimeRange.max;

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

// Обновить общий диапазон времени на основе данных
function updateSharedTimeRange(chartData) {
    if (!chartData || chartData.length === 0) return;

    const times = chartData.map(d => d.x.getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    if (state.sharedTimeRange.min === null || minTime < state.sharedTimeRange.min) {
        state.sharedTimeRange.min = minTime;
    }
    if (state.sharedTimeRange.max === null || maxTime > state.sharedTimeRange.max) {
        state.sharedTimeRange.max = maxTime;
    }
}

// Синхронизировать диапазон времени для всех графиков
function syncAllChartsTimeRange(objectName) {
    const tabState = state.tabs.get(objectName);
    if (!tabState) return;

    tabState.charts.forEach((chartData, varName) => {
        const chart = chartData.chart;
        chart.options.scales.x.min = state.sharedTimeRange.min;
        chart.options.scales.x.max = state.sharedTimeRange.max;
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

// Обработка выбора временного диапазона
function setupTimeRangeSelector() {
    document.querySelectorAll('.time-range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.time-range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.timeRange = parseInt(btn.dataset.range, 10);

            // Обновить все активные графики
            state.tabs.forEach((tabState, objectName) => {
                tabState.charts.forEach((chartData, varName) => {
                    updateChart(objectName, varName, chartData.chart);
                });
            });
        });
    });
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
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

    // Настройка селектора временного диапазона
    setupTimeRangeSelector();
});
