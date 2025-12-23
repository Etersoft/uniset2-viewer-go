// ============================================================================
// Helper для безопасного поиска элементов внутри панели вкладки
// Решает проблему конфликта ID при multi-server с одинаковыми displayName
// ============================================================================

/**
 * Находит элемент внутри панели конкретной вкладки
 * @param {string} tabKey - Ключ вкладки (serverId:objectName или objectName для single-server)
 * @param {string} elementId - ID элемента для поиска
 * @returns {HTMLElement|null} - Найденный элемент или null
 */
function getElementInTab(tabKey, elementId) {
    const panel = document.querySelector(`.tab-panel[data-name="${tabKey}"]`);
    if (!panel) return null;
    // Escape special CSS characters in elementId (e.g., colon in "ws:SensorName")
    const escapedId = CSS.escape(elementId);
    return panel.querySelector(`#${escapedId}`);
}

/**
 * Находит все элементы внутри панели конкретной вкладки
 * @param {string} tabKey - Ключ вкладки
 * @param {string} selector - CSS селектор
 * @returns {NodeList} - Список найденных элементов
 */
function getElementsInTab(tabKey, selector) {
    const panel = document.querySelector(`.tab-panel[data-name="${tabKey}"]`);
    if (!panel) return [];
    return panel.querySelectorAll(selector);
}

// ============================================================================
// Функции рендеринга (обновлены для работы с tabKey вместо displayName)
// ============================================================================

function renderVariables(tabKey, variables, filterText = '') {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const displayName = tabState.displayName || tabKey;
    const tbody = getElementInTab(tabKey, `variables-${displayName}`);
    if (!tbody) return;

    // Сохраняем переменные в state для фильтрации
    tabState.variables = variables;

    tbody.innerHTML = '';
    const filterLower = filterText.toLowerCase();

    Object.entries(variables).forEach(([varName, value]) => {
        // Filterация по имени переменной
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

function renderIO(tabKey, type, ioData) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const displayName = tabState.displayName || tabKey;

    const tbody = getElementInTab(tabKey, `${type}-${displayName}`);
    const countBadge = getElementInTab(tabKey, `${type}-count-${displayName}`);
    if (!tbody) return;

    const entries = Object.entries(ioData);

    if (countBadge) {
        countBadge.textContent = entries.length;
    }

    // Получаем текущий фильтр (глобальный) и закреплённые строки
    const filterInput = getElementInTab(tabKey, `io-filter-global-${displayName}`);
    const filterText = filterInput ? filterInput.value.toLowerCase() : '';
    const pinnedRows = getIOPinnedRows(tabKey, type);
    const hasPinned = pinnedRows.size > 0;

    // Показываем/скрываем кнопку "снять все"
    const unpinBtn = getElementInTab(tabKey, `io-unpin-${type}-${displayName}`);
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

        // Filterация: если есть закреплённые - показываем только их, иначе фильтруем по тексту
        const searchText = `${io.name || key} ${io.id} ${iotype} ${textname}`.toLowerCase();
        const matchesFilter = !filterText || searchText.includes(filterText);
        const shouldShow = hasPinned ? isPinned : matchesFilter;

        if (!shouldShow) return;

        const tr = document.createElement('tr');
        tr.className = '';
        tr.dataset.rowKey = rowKey;

        tr.innerHTML = `
            <td class="io-pin-col">
                <span class="io-pin-toggle ${isPinned ? 'pinned' : ''}" data-row-key="${rowKey}" title="${isPinned ? 'Unpin' : 'Pin'}">
                    ${isPinned ? '📌' : '○'}
                </span>
            </td>
            <td class="io-chart-col">
                <span class="chart-toggle">
                    <input type="checkbox"
                           id="chart-${displayName}-${varName}"
                           data-object="${tabKey}"
                           data-variable="${varName}"
                           data-sensor-id="${io.id}"
                           ${hasChart(tabKey, varName) ? 'checked' : ''}>
                    <label class="chart-toggle-label" for="chart-${displayName}-${varName}">
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
            toggleIOPin(tabKey, type, rowKey);
        });

        // Chart toggle handler
        const checkbox = tr.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                addChart(tabKey, varName, io.id, textname);
            } else {
                removeChart(tabKey, varName);
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

async function addChart(tabKey, varName, sensorId, passedTextname) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState || tabState.charts.has(varName)) return;

    const displayName = tabState.displayName || tabKey;

    const chartsContainer = getElementInTab(tabKey, `charts-${displayName}`);
    // Ищем сенсор по ID или по имени переменной
    let sensor = sensorId ? getSensorInfo(sensorId) : null;
    if (!sensor) {
        // Пробуем найти по имени (последняя часть varName, например io.in.Input1_S -> Input1_S)
        const shortName = varName.split('.').pop();
        sensor = getSensorInfo(shortName);
    }
    const isDiscrete = isDiscreteSignal(sensor);
    const color = getNextColor();
    const sensorDisplayName = sensor?.name || varName.split('.').pop();
    // textname: приоритет - справочник сенсоров, потом переданный параметр (comment из API)
    const textName = sensor?.textname || passedTextname || '';

    // Создаём панель графика
    const chartDiv = document.createElement('div');
    chartDiv.className = 'chart-panel';
    chartDiv.id = `chart-panel-${displayName}-${varName}`;
    chartDiv.innerHTML = `
        <div class="chart-panel-header">
            <div class="chart-panel-info">
                <span class="legend-color-picker" data-object="${tabKey}" data-variable="${varName}" style="background:${color}" title="Click to choose color"></span>
                <span class="chart-panel-title">${sensorDisplayName}</span>
                <span class="chart-panel-value" id="legend-value-${displayName}-${varName}">--</span>
                <span class="chart-panel-textname">${textName}</span>
                ${sensor?.iotype ? `<span class="type-badge type-${sensor.iotype}">${sensor.iotype}</span>` : ''}
            </div>
            <div class="chart-panel-right">
                ${!isDiscrete ? `
                <label class="fill-toggle" title="Smooth line (bezier curves)">
                    <input type="checkbox" id="smooth-${displayName}-${varName}" checked>
                    <span class="fill-toggle-label">smooth</span>
                </label>
                ` : ''}
                <label class="fill-toggle" title="Fill background">
                    <input type="checkbox" id="fill-${displayName}-${varName}" checked>
                    <span class="fill-toggle-label">fill</span>
                </label>
                <button class="btn-icon" title="Close" onclick="removeChartByButton('${tabKey}', '${varName}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        </div>
        <div class="chart-wrapper">
            <canvas id="canvas-${displayName}-${varName}"></canvas>
        </div>
    `;
    chartsContainer.appendChild(chartDiv);

    // Обработчик для чекбокса заливки
    const fillCheckbox = getElementInTab(tabKey, `fill-${displayName}-${varName}`);
    if (fillCheckbox) {
        fillCheckbox.addEventListener('change', (e) => {
            toggleChartFill(tabKey, varName, e.target.checked);
        });
    }

    // Обработчик для чекбокса сглаживания (только для аналоговых)
    const smoothCheckbox = getElementInTab(tabKey, `smooth-${displayName}-${varName}`);
    if (smoothCheckbox) {
        smoothCheckbox.addEventListener('change', (e) => {
            toggleChartSmooth(tabKey, varName, e.target.checked);
        });
    }

    // Загружаем историю
    try {
        const serverId = tabState?.serverId;
        const history = await fetchVariableHistory(displayName, varName, 200, serverId);
        const ctx = getElementInTab(tabKey, `canvas-${displayName}-${varName}`).getContext('2d');

        // Преобразуем данные для временной шкалы
        const historyData = history.points?.map(p => ({
            x: new Date(p.timestamp),
            y: p.value
        })) || [];

        // Получаем диапазон времени (при первом графике устанавливается начало)
        const timeRange = getTimeRangeForObject(tabKey);

        // Заливка по умолчанию только для аналоговых
        const fillEnabled = true;

        // Конфигурация графика в зависимости от типа сигнала
        const chartConfig = {
            type: 'line',
            data: {
                datasets: [{
                    label: sensorDisplayName,
                    data: historyData,
                    borderColor: color,
                    backgroundColor: `${color}20`,
                    fill: fillEnabled,
                    tension: isDiscrete ? 0 : 0.3,
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
        syncAllChartsTimeRange(tabKey);

        // Обновить начальное значение в легенде
        if (history.points && history.points.length > 0) {
            const lastValue = history.points[history.points.length - 1].value;
            const legendValueEl = getElementInTab(tabKey, `legend-value-${displayName}-${varName}`);
            if (legendValueEl) {
                legendValueEl.textContent = formatValue(lastValue);
            }
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
                await updateChart(tabKey, varName, chart);
            }, state.sse.pollInterval);
        }

        tabState.charts.set(varName, chartData);

    } catch (err) {
        console.error(`Error загрузки истории для ${varName}:`, err);
        chartDiv.innerHTML += `<div class="alert alert-error">Не удалось загрузить данные графика</div>`;
    }
}

async function updateChart(objectName, varName, chart) {
    // objectName может быть displayName или tabKey
    const tabKey = findTabKeyByDisplayName(objectName) || objectName;
    const tabState = state.tabs.get(tabKey);
    if (!tabState || !tabState.charts.has(varName)) return;

    try {
        const serverId = tabState?.serverId;
        const displayName = tabState?.displayName || objectName;
        const history = await fetchVariableHistory(displayName, varName, 200, serverId);

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
        console.error(`Error обновления графика для ${varName}:`, err);
    }
}

// Получить диапазон времени для графиков объекта
// tabKey - ключ вкладки (serverId:objectName)
function getTimeRangeForObject(tabKey) {
    const tabState = state.tabs.get(tabKey);
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
// tabKey - ключ вкладки (serverId:objectName)
function syncAllChartsTimeRange(tabKey) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const timeRange = getTimeRangeForObject(tabKey);

    tabState.charts.forEach((chartData, varName) => {
        const chart = chartData.chart;
        chart.options.scales.x.min = timeRange.min;
        chart.options.scales.x.max = timeRange.max;
        chart.update('none');
    });

    // Обновить отображение оси X (показывать только на последнем графике)
    updateXAxisVisibility(tabKey);
}

// Показывать ось X только на последнем графике
// tabKey - ключ вкладки (serverId:objectName)
function updateXAxisVisibility(tabKey) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    // Используем displayName для DOM селекторов (без serverId)
    const displayName = tabState.displayName || tabKey;

    // ВАЖНО: Ограничиваем поиск панелью конкретной вкладки
    // для избежания конфликтов ID при multi-server (когда displayName одинаковый)
    const tabPanel = document.querySelector(`.tab-panel[data-name="${tabKey}"]`);
    if (!tabPanel) return;

    const chartPanels = tabPanel.querySelectorAll(`#charts-${displayName} .chart-panel`);
    const chartCount = chartPanels.length;

    let index = 0;
    tabState.charts.forEach((chartData, varName) => {
        const isLast = index === chartCount - 1;
        chartData.chart.options.scales.x.ticks.display = isLast;
        chartData.chart.update('none');
        index++;
    });
}

function updateChartLegends(tabKey, data) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const displayName = tabState.displayName || tabKey;

    // Обновляем значения в таблицах
    if (data.io?.in) {
        Object.entries(data.io.in).forEach(([key, io]) => {
            const varName = `io.in.${key}`;
            const legendEl = getElementInTab(tabKey, `legend-value-${displayName}-${varName}`);
            if (legendEl) {
                legendEl.textContent = formatValue(io.value);
            }
        });
    }

    if (data.io?.out) {
        Object.entries(data.io.out).forEach(([key, io]) => {
            const varName = `io.out.${key}`;
            const legendEl = getElementInTab(tabKey, `legend-value-${displayName}-${varName}`);
            if (legendEl) {
                legendEl.textContent = formatValue(io.value);
            }
        });
    }
}

function removeChart(tabKey, varName) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const displayName = tabState.displayName || tabKey;

    const chartData = tabState.charts.get(varName);
    if (chartData) {
        clearInterval(chartData.updateInterval);
        chartData.chart.destroy();
        tabState.charts.delete(varName);
    }

    getElementInTab(tabKey, `chart-panel-${displayName}-${varName}`)?.remove();

    // Снять галочку в таблице (обычная IO таблица)
    const checkbox = getElementInTab(tabKey, `chart-${displayName}-${varName}`);
    if (checkbox) {
        checkbox.checked = false;
    }

    // Снять галочку в таблице IONC (датчики SharedMemory)
    const ioncCheckbox = getElementInTab(tabKey, `ionc-chart-${displayName}-${varName}`);
    if (ioncCheckbox) {
        ioncCheckbox.checked = false;
    }

    // Снять галочку в таблице UWebSocketGate (varName = ws:SensorName)
    if (varName.startsWith('ws:')) {
        const sensorName = varName.substring(3);
        const uwsgateCheckboxes = getElementsInTab(tabKey, `.uwsgate-chart-checkbox[data-name="${sensorName}"]`);
        if (uwsgateCheckboxes && uwsgateCheckboxes.length > 0) {
            uwsgateCheckboxes[0].checked = false;
        }
    }

    // Обновить видимость оси X на оставшихся графиках
    updateXAxisVisibility(tabKey);
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

// Глобальная функция для обновления статуса сервера (для тестов)
window.updateServerStatus = updateServerStatus;

// Хранилище данных таймеров для локального обновления timeleft
const timerDataCache = {};
let timerUpdateInterval = null;

// Рендеринг таймеров
