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

// Status диалога датчиков
const sensorDialogState = {
    objectName: null,
    allSensors: [],
    filteredSensors: [],
    addedSensors: new Set() // датчики уже добавленные на график для текущего объекта
};

// Открыть диалог выбора датчика
// tabKey - ключ вкладки (serverId:objectName)
function openSensorDialog(tabKey) {
    sensorDialogState.objectName = tabKey;

    // Получаем displayName для localStorage (без serverId)
    const tabState = state.tabs.get(tabKey);
    const displayName = tabState?.displayName || tabKey;

    // Загрузить список уже добавленных внешних датчиков (по displayName)
    sensorDialogState.addedSensors = getExternalSensorsFromStorage(displayName);

    const overlay = document.getElementById('sensor-dialog-overlay');
    const filterInput = document.getElementById('sensor-filter-input');

    overlay.classList.add('visible');
    filterInput.value = '';
    filterInput.focus();

    // Определяем источник датчиков в зависимости от smEnabled
    if (state.capabilities.smEnabled) {
        // SM включен - загружаем датчики из XML конфига
        if (state.sensors.size === 0) {
            renderSensorDialogContent('<div class="sensor-dialog-loading">Loading sensor list...</div>');
            loadSensorsConfig().then(() => {
                prepareSensorList();
                renderSensorTable();
            }).catch(err => {
                renderSensorDialogContent('<div class="sensor-dialog-empty">Error loading sensors</div>');
            });
        } else {
            prepareSensorList();
            renderSensorTable();
        }
    } else {
        // SM не настроен - показываем датчики из IONC таблицы
        const ioncTabState = state.tabs.get(tabKey);
        if (ioncTabState && ioncTabState.renderer && ioncTabState.renderer.sensors) {
            prepareSensorListFromIONC(ioncTabState.renderer.sensors);
            renderSensorTable();
        } else {
            renderSensorDialogContent('<div class="sensor-dialog-empty">No sensors in IONC table</div>');
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

// Close диалог
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

// Filterация датчиков
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
        renderSensorDialogContent('<div class="sensor-dialog-empty">Sensors not found</div>');
        return;
    }

    const rows = sensors.map(sensor => {
        const isAdded = sensorDialogState.addedSensors.has(sensor.name);
        const btnText = isAdded ? '✓' : '+';
        const btnDisabled = isAdded ? 'disabled' : '';
        const btnTitle = isAdded ? 'Already added' : 'Add to chart';

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
                    <th>Name</th>
                    <th>Описание</th>
                    <th style="width: 50px">Type</th>
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
// tabKey - ключ вкладки (serverId:objectName)
async function subscribeToExternalSensors(tabKey, sensorNames) {
    try {
        const tabState = state.tabs.get(tabKey);
        const serverId = tabState?.serverId;
        const objectName = tabState?.displayName || tabKey;

        let url = `/api/objects/${encodeURIComponent(objectName)}/external-sensors`;
        if (serverId) {
            url += `?server=${encodeURIComponent(serverId)}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sensors: sensorNames })
        });
        if (!response.ok) {
            const err = await response.json();
            console.warn('Error подписки на датчики:', err.error || response.statusText);
        }
    } catch (err) {
        console.warn('Error подписки на датчики:', err);
    }
}

// Отписаться от внешнего датчика через API
// tabKey - ключ вкладки (serverId:objectName)
async function unsubscribeFromExternalSensor(tabKey, sensorName) {
    try {
        const tabState = state.tabs.get(tabKey);
        const serverId = tabState?.serverId;
        const objectName = tabState?.displayName || tabKey;

        let url = `/api/objects/${encodeURIComponent(objectName)}/external-sensors/${encodeURIComponent(sensorName)}`;
        if (serverId) {
            url += `?server=${encodeURIComponent(serverId)}`;
        }

        const response = await fetch(url, { method: 'DELETE' });
        if (!response.ok) {
            const err = await response.json();
            console.warn('Error отписки от датчика:', err.error || response.statusText);
        }
    } catch (err) {
        console.warn('Error отписки от датчика:', err);
    }
}

// Подписаться на IONC датчик через API
// tabKey - ключ вкладки (serverId:objectName)
async function subscribeToIONCSensor(tabKey, sensorId) {
    try {
        const tabState = state.tabs.get(tabKey);
        const serverId = tabState?.serverId;
        const objectName = tabState?.displayName || tabKey;

        let url = `/api/objects/${encodeURIComponent(objectName)}/ionc/subscribe`;
        if (serverId) {
            url += `?server=${encodeURIComponent(serverId)}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sensor_ids: [sensorId] })
        });
        if (!response.ok) {
            const err = await response.json();
            console.warn('Error подписки на IONC датчик:', err.error || response.statusText);
        } else {
            // Добавляем в список подписок рендерера
            if (tabState && tabState.renderer && tabState.renderer.subscribedSensorIds) {
                tabState.renderer.subscribedSensorIds.add(sensorId);
            }
            console.log(`IONC: Подписка на датчик ${sensorId} для ${objectName} (server: ${serverId})`);
        }
    } catch (err) {
        console.warn('Error подписки на IONC датчик:', err);
    }
}

// Отписаться от IONC датчика через API
// tabKey - ключ вкладки (serverId:objectName)
async function unsubscribeFromIONCSensor(tabKey, sensorId) {
    try {
        const tabState = state.tabs.get(tabKey);
        const serverId = tabState?.serverId;
        const objectName = tabState?.displayName || tabKey;

        let url = `/api/objects/${encodeURIComponent(objectName)}/ionc/unsubscribe`;
        if (serverId) {
            url += `?server=${encodeURIComponent(serverId)}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sensor_ids: [sensorId] })
        });
        if (!response.ok) {
            const err = await response.json();
            console.warn('Error отписки от IONC датчика:', err.error || response.statusText);
        } else {
            // Удаляем из списка подписок рендерера
            if (tabState && tabState.renderer && tabState.renderer.subscribedSensorIds) {
                tabState.renderer.subscribedSensorIds.delete(sensorId);
            }
            console.log(`IONC: Отписка от датчика ${sensorId} для ${objectName} (server: ${serverId})`);
        }
    } catch (err) {
        console.warn('Error отписки от IONC датчика:', err);
    }
}

// Add external sensor на график
// tabKey - ключ вкладки (serverId:objectName)
function addExternalSensor(tabKey, sensorName) {
    let sensor;

    // Получаем displayName для localStorage (без serverId)
    const tabState = state.tabs.get(tabKey);
    const displayName = tabState?.displayName || tabKey;

    if (state.capabilities.smEnabled) {
        // SM включен - ищем датчик в глобальном списке
        sensor = state.sensorsByName.get(sensorName);
    } else {
        // SM выключен - ищем датчик в списке диалога (из IONC)
        sensor = sensorDialogState.allSensors.find(s => s.name === sensorName);
    }

    if (!sensor) {
        console.error('Sensor not found:', sensorName);
        return;
    }

    // Добавляем в список добавленных (сохраняем полные данные)
    sensorDialogState.addedSensors.set(sensorName, {
        id: sensor.id,
        name: sensor.name,
        textname: sensor.textname || sensor.name,
        iotype: sensor.iotype || sensor.type,
        value: sensor.value
    });

    // Сохраняем в localStorage (используем displayName для переносимости между сессиями)
    saveExternalSensorsToStorage(displayName, sensorDialogState.addedSensors);

    // Создаём график для внешнего датчика (используем tabKey)
    createExternalSensorChart(tabKey, sensor);

    // Обновляем таблицу (чтобы кнопка стала disabled)
    renderSensorTable();

    console.log(`External sensor added ${sensorName} для ${displayName}`);

    if (state.capabilities.smEnabled) {
        // SM включен - подписываемся через SM API
        subscribeToExternalSensors(tabKey, [sensorName]);
    } else {
        // SM выключен - подписываемся через IONC API
        subscribeToIONCSensor(tabKey, sensor.id);
    }
}

// Создать график для внешнего датчика
// tabKey - ключ для state.tabs (serverId:objectName)
// options.badge - текст badge ('SM', 'MB', null для скрытия)
// options.prefix - префикс для varName (по умолчанию 'ext')
function createExternalSensorChart(tabKey, sensor, options = {}) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    // Используем displayName из tabState для ID элементов (без serverId)
    const objectName = tabState.displayName;
    const prefix = options.prefix || 'ext';
    const varName = `${prefix}:${sensor.name}`; // Префикс для идентификации источника

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

    // Badge: SM для SharedMemory, MB для Modbus, или скрыт
    const badge = options.badge !== undefined ? options.badge : 'SM';
    const badgeHtml = badge ? `<span class="chart-panel-badge ${badge === 'SM' ? 'external-badge' : 'modbus-badge'}">${badge}</span>` : '';

    const chartDiv = document.createElement('div');
    chartDiv.className = 'chart-panel external-sensor-chart';
    chartDiv.id = `chart-panel-${objectName}-${safeVarName}`;
    chartDiv.innerHTML = `
        <div class="chart-panel-header">
            <div class="chart-panel-info">
                <span class="legend-color-picker" data-object="${tabKey}" data-variable="${varName}" style="background:${color}" title="Click to choose color"></span>
                <span class="chart-panel-title">${escapeHtml(displayName)}</span>
                <span class="chart-panel-value" id="legend-value-${objectName}-${safeVarName}">--</span>
                <span class="chart-panel-textname">${escapeHtml(sensor.name)}</span>
                <span class="type-badge type-${sensor.iotype || 'unknown'}">${sensor.iotype || '?'}</span>
                ${badgeHtml}
            </div>
            <div class="chart-panel-right">
                ${!isDiscrete ? `
                <label class="fill-toggle" title="Smooth line (bezier curves)">
                    <input type="checkbox" id="smooth-${objectName}-${safeVarName}" checked>
                    <span class="fill-toggle-label">smooth</span>
                </label>
                ` : ''}
                <label class="fill-toggle" title="Fill background">
                    <input type="checkbox" id="fill-${objectName}-${safeVarName}" checked>
                    <span class="fill-toggle-label">fill</span>
                </label>
                <button class="chart-remove-btn" title="Remove from chart">✕</button>
            </div>
        </div>
        <div class="chart-wrapper">
            <canvas id="canvas-${objectName}-${safeVarName}"></canvas>
        </div>
    `;

    chartsContainer.appendChild(chartDiv);

    // Получаем диапазон времени
    const timeRange = getTimeRangeForObject(objectName);
    const fillEnabled = true;
    const steppedEnabled = isDiscrete;

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
        removeExternalSensor(tabKey, sensor.name, { prefix });
    });

    // Обработчик чекбокса заливки
    const fillCheckbox = document.getElementById(`fill-${objectName}-${safeVarName}`);
    if (fillCheckbox) {
        fillCheckbox.addEventListener('change', (e) => {
            chart.data.datasets[0].fill = e.target.checked;
            chart.update('none');
        });
    }

    // Обработчик чекбокса сглаживания (только для аналоговых)
    const smoothCheckbox = document.getElementById(`smooth-${objectName}-${safeVarName}`);
    if (smoothCheckbox) {
        smoothCheckbox.addEventListener('change', (e) => {
            chart.data.datasets[0].tension = e.target.checked ? 0.3 : 0;
            chart.update('none');
        });
    }
}

// Добавить график для внешнего датчика (обёртка над createExternalSensorChart)
// tabKey - ключ для state.tabs (serverId:objectName)
// varName - имя переменной с префиксом (например ws:SensorName)
// sensorId - ID датчика
// textname - отображаемое имя датчика
// options.badge - текст badge ('WS', 'MB', 'SM')
// options.prefix - префикс для varName (например 'ws')
function addExternalSensorChart(tabKey, varName, sensorId, textname, options = {}) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    // Проверяем, не создан ли уже график
    if (tabState.charts.has(varName)) {
        console.log(`График для ${varName} уже существует`);
        return;
    }

    // Извлекаем имя датчика из varName (убираем prefix)
    const prefix = options.prefix || 'ext';
    const sensorName = varName.startsWith(prefix + ':') ? varName.substring(prefix.length + 1) : varName;

    // Получаем информацию о датчике из кэша
    const sensorInfo = getSensorInfo(sensorId) || getSensorInfo(sensorName);

    // Создаём объект sensor для createExternalSensorChart
    const sensor = {
        id: sensorId,
        name: sensorName,
        textname: textname || sensorInfo?.textname || sensorName,
        iotype: sensorInfo?.iotype || 'AI',
        value: sensorInfo?.value
    };

    // Вызываем createExternalSensorChart
    createExternalSensorChart(tabKey, sensor, options);
}

// Удалить внешний датчик с графика
// tabKey - ключ для state.tabs (serverId:objectName)
// options.prefix - префикс для varName (по умолчанию 'ext')
function removeExternalSensor(tabKey, sensorName, options = {}) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    // Используем displayName из tabState для ID элементов (без serverId)
    const objectName = tabState.displayName;
    const prefix = options.prefix || 'ext';
    const varName = `${prefix}:${sensorName}`;
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

    // Удаляем из localStorage (используем objectName/displayName как ключ)
    const addedSensors = getExternalSensorsFromStorage(objectName);
    addedSensors.delete(sensorName);
    saveExternalSensorsToStorage(objectName, addedSensors);

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

    // Снять галочку в любой таблице по data-sensor-name (Modbus, OPCUA и др.)
    const chartCheckbox = document.querySelector(`.chart-checkbox[data-sensor-name="${sensorName}"]`);
    if (chartCheckbox) {
        chartCheckbox.checked = false;
    }

    // Снять галочку в таблице UWebSocketGate (по data-name)
    const uwsgateCheckbox = getElementsInTab(tabKey, `.uwsgate-chart-checkbox[data-name="${sensorName}"]`);
    if (uwsgateCheckbox && uwsgateCheckbox.length > 0) {
        uwsgateCheckbox[0].checked = false;
    }

    // Обновляем состояние диалога если открыт
    if (sensorDialogState.objectName === objectName) {
        sensorDialogState.addedSensors.delete(sensorName);
        renderSensorTable();
    }

    console.log(`Удалён внешний датчик ${sensorName} для ${tabKey}`);

    // Отписываемся от датчика через API
    if (state.capabilities.smEnabled) {
        unsubscribeFromExternalSensor(tabKey, sensorName);
    } else if (sensor) {
        unsubscribeFromIONCSensor(tabKey, sensor.id);
    }
}

// Загрузить внешние датчики из localStorage
// Возвращает Map<sensorName, sensorData> для обратной совместимости с Set API (.has, .add, .delete)
function getExternalSensorsFromStorage(objectName) {
    try {
        const key = `uniset-panel-external-sensors-${objectName}`;
        const data = localStorage.getItem(key);
        if (data) {
            const parsed = JSON.parse(data);
            // Обратная совместимость: если это массив строк (старый формат), конвертируем
            if (Array.isArray(parsed)) {
                const map = new Map();
                parsed.forEach(item => {
                    if (typeof item === 'string') {
                        // Старый формат: только имя
                        map.set(item, { name: item });
                    } else if (item && item.name) {
                        // Новый формат: объект с данными
                        map.set(item.name, item);
                    }
                });
                return map;
            }
        }
    } catch (err) {
        console.warn('Error загрузки внешних датчиков:', err);
    }
    return new Map();
}

// Save внешние датчики в localStorage
function saveExternalSensorsToStorage(objectName, sensors) {
    try {
        const key = `uniset-panel-external-sensors-${objectName}`;
        // sensors - это Map<name, sensorData>
        const arr = [...sensors.values()];
        localStorage.setItem(key, JSON.stringify(arr));
    } catch (err) {
        console.warn('Error сохранения внешних датчиков:', err);
    }
}

// Восстановить внешние датчики при открытии вкладки
// tabKey - ключ для state.tabs (формат: serverId:objectName)
// displayName - имя объекта для отображения и localStorage
function restoreExternalSensors(tabKey, displayName) {
    const sensors = getExternalSensorsFromStorage(displayName);
    if (sensors.size === 0) return;

    // Теперь sensors - это Map<name, sensorData>
    // Используем сохранённые данные напрямую, без необходимости искать в state

    const restoreSensors = () => {
        const tabState = state.tabs.get(tabKey);
        if (!tabState) {
            setTimeout(restoreSensors, 100);
            return;
        }

        const restoredSensorIds = [];
        const restoredSensorNames = [];

        sensors.forEach((sensorData, sensorName) => {
            // Если у нас есть полные данные (новый формат), используем их напрямую
            if (sensorData.id) {
                const sensor = {
                    id: sensorData.id,
                    name: sensorData.name,
                    textname: sensorData.textname || sensorData.name,
                    iotype: sensorData.iotype || sensorData.type,
                    value: sensorData.value
                };
                // Используем сохранённые опции графика (badge, prefix) или дефолтные
                const chartOptions = sensorData.chartOptions || { badge: 'SM', prefix: 'ext' };
                createExternalSensorChart(tabKey, sensor, chartOptions);
                restoredSensorIds.push(sensorData.id);
                restoredSensorNames.push(sensorName);

                // Добавляем в state.sensorsByName если его там нет
                if (!state.sensorsByName.has(sensorName)) {
                    state.sensorsByName.set(sensorName, sensor);
                    state.sensors.set(sensor.id, sensor);
                }
            } else {
                // Старый формат: только имя - пробуем найти в state или renderer
                let sensor = state.sensorsByName.get(sensorName);
                if (!sensor && tabState.renderer && tabState.renderer.sensors) {
                    sensor = tabState.renderer.sensors.find(s => s.name === sensorName);
                    if (sensor) {
                        sensor = {
                            id: sensor.id,
                            name: sensor.name,
                            textname: '',
                            iotype: sensor.type || sensor.iotype,
                            value: sensor.value
                        };
                    }
                }
                if (sensor) {
                    createExternalSensorChart(tabKey, sensor);
                    restoredSensorIds.push(sensor.id);
                    restoredSensorNames.push(sensorName);
                } else {
                    console.warn(`Датчик ${sensorName} не найден (старый формат)`);
                }
            }
        });

        // Подписываемся на все восстановленные датчики
        if (restoredSensorIds.length > 0) {
            if (state.capabilities.smEnabled) {
                subscribeToExternalSensors(tabKey, restoredSensorNames);
            } else if (tabState.renderer && tabState.renderer.subscribedSensorIds) {
                // IONC подписка
                const serverId = tabState.serverId;
                let url = `/api/objects/${encodeURIComponent(displayName)}/ionc/subscribe`;
                if (serverId) {
                    url += `?server=${encodeURIComponent(serverId)}`;
                }
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sensor_ids: restoredSensorIds })
                }).then(response => {
                    if (response.ok) {
                        restoredSensorIds.forEach(id => {
                            tabState.renderer.subscribedSensorIds.add(id);
                        });
                    }
                }).catch(err => {
                    console.warn('Error восстановления подписок:', err);
                });
            }
        }

        console.log(`Восстановлено ${restoredSensorIds.length} датчиков на графике для ${displayName}`);
    };

    // Даём время на инициализацию вкладки
    setTimeout(restoreSensors, 200);
}

// UI функции
