// Идентификатор сервера для SharedMemory (SM) событий
// Соответствует SharedMemoryServerID в backend (internal/api/sse.go)
const SM_SERVER_ID = 'sm';

// Status приложения
// Экспортируем на window для тестов
const state = window.state = {
    objects: [],
    servers: new Map(), // serverId -> { id, url, name, connected, objectCount }
    tabs: new Map(), // tabKey -> { charts, updateInterval, chartStartTime, objectType, renderer, serverId, serverName, displayName }
    activeTab: null,
    sensors: new Map(), // sensorId -> sensorInfo
    sensorsByName: new Map(), // sensorName -> sensorInfo
    timeRange: 900, // секунды (по умолчанию 15 минут)
    sidebarCollapsed: false, // свёрнутая боковая панель
    collapsedSections: {}, // состояние спойлеров
    collapsedServerGroups: new Set(), // свёрнутые группы серверов в списке объектов
    serversSectionCollapsed: false, // свёрнута ли секция "Servers"
    capabilities: {
        smEnabled: false // по умолчанию SM отключен
    },
    config: {
        controlsEnabled: false,
        ioncUISensorsFilter: false,  // false = серверная фильтрация (default)
        opcuaUISensorsFilter: false  // false = серверная фильтрация (default)
    },
    sse: {
        eventSource: null,
        connected: false,
        pollInterval: 5000, // будет обновлено с сервера
        reconnectAttempts: 0,
        maxReconnectAttempts: 10,
        baseReconnectDelay: 1000,   // начальная задержка (1s)
        maxReconnectDelay: 30000    // максимальная задержка (30s)
    },
    control: {
        enabled: false,       // включён ли контроль на сервере
        token: null,          // текущий токен (из localStorage или URL)
        isController: false,  // я контроллер?
        hasController: false, // есть активный контроллер (кто-то другой)
        timeoutSec: 60,       // таймаут неактивности
        pingIntervalId: null  // ID интервала ping
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
            title = 'Connected via Server-Sent Events';
            break;
        case 'reconnecting':
            container.classList.add('reconnecting');
            text = `Reconnecting (${state.sse.reconnectAttempts}/${state.sse.maxReconnectAttempts})`;
            title = 'Attempting to restore SSE connection';
            break;
        case 'polling':
            container.classList.add('polling');
            text = 'Polling';
            title = 'Fallback mode: periodic server polling';
            break;
        case 'disconnected':
            container.classList.add('disconnected');
            text = 'Disconnected';
            title = 'No connection to server';
            break;
        default:
            text = 'Connecting...';
            title = 'Establishing connection';
    }

    // Добавляем время последнего обновления если есть
    if (lastUpdate) {
        const timeStr = lastUpdate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        text += ` · ${timeStr}`;
    }

    textEl.textContent = text;
    container.title = title;
}

// Обновить доступность кнопок "Add sensor" для всех открытых вкладок
function updateAddSensorButtons() {
    const buttons = document.querySelectorAll('.add-sensor-btn');
    buttons.forEach(btn => {
        if (state.capabilities.smEnabled) {
            btn.disabled = false;
            btn.title = '';
        } else {
            btn.disabled = true;
            btn.title = 'SM not connected (-sm-url not set)';
        }
    });
}

// Обновить статус конкретного сервера
function updateServerStatus(serverId, connected) {
    const server = state.servers.get(serverId);
    if (!server) return;

    server.connected = connected;

    // Обновляем группу сервера в списке объектов
    const serverGroup = document.querySelector(`.server-group[data-server-id="${serverId}"]`);
    if (serverGroup) {
        const statusDot = serverGroup.querySelector('.server-group-header .server-status-dot');
        if (statusDot) {
            statusDot.classList.toggle('disconnected', !connected);
        }
    }

    // Обновляем элемент сервера в секции "Servers"
    const serverItem = document.querySelector(`.server-item[data-server-id="${serverId}"]`);
    if (serverItem) {
        const statusDot = serverItem.querySelector('.server-status-dot');
        if (statusDot) {
            statusDot.classList.toggle('disconnected', !connected);
        }
        // Обновляем статистику
        const statsEl = serverItem.querySelector('.server-stats');
        if (statsEl) {
            const objectCount = server.objectCount || 0;
            const connectedCount = connected ? objectCount : 0;
            statsEl.textContent = objectCount > 0 ? `${connectedCount}/${objectCount}` : '-/-';

            statsEl.classList.remove('all-connected', 'some-disconnected', 'all-disconnected');
            if (objectCount > 0) {
                if (connectedCount === objectCount) {
                    statsEl.classList.add('all-connected');
                } else if (connectedCount === 0) {
                    statsEl.classList.add('all-disconnected');
                } else {
                    statsEl.classList.add('some-disconnected');
                }
            }
        }
    }

    // Обновляем бейджи серверов в табах
    const tabBadges = document.querySelectorAll(`.tab-server-badge[data-server-id="${serverId}"]`);
    tabBadges.forEach(badge => {
        if (connected) {
            badge.classList.remove('disconnected');
        } else {
            badge.classList.add('disconnected');
        }
    });

    // Обновляем состояние кнопок табов (заголовки)
    const tabButtons = document.querySelectorAll(`.tab-btn[data-server-id="${serverId}"]`);
    tabButtons.forEach(btn => {
        if (connected) {
            btn.classList.remove('server-disconnected');
        } else {
            btn.classList.add('server-disconnected');
        }
    });

    // Обновляем состояние панелей табов (контент)
    const tabPanels = document.querySelectorAll(`.tab-panel[data-server-id="${serverId}"]`);
    tabPanels.forEach(panel => {
        if (connected) {
            panel.classList.remove('server-disconnected');
        } else {
            panel.classList.add('server-disconnected');
        }
    });
}

// ============================================================================
// Session Control - управление сессиями записи
// ============================================================================

// Инициализация токена контроля
function initControlToken() {
    // 1. Проверяем URL параметр
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');

    if (urlToken) {
        state.control.token = urlToken;
        localStorage.setItem('control-token', urlToken);
        // Убираем токен из URL (безопасность)
        urlParams.delete('token');
        const newUrl = urlParams.toString()
            ? `${window.location.pathname}?${urlParams.toString()}`
            : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
        console.log('Control: Token loaded from URL');
    } else {
        // 2. Проверяем localStorage
        state.control.token = localStorage.getItem('control-token');
        if (state.control.token) {
            console.log('Control: Token loaded from localStorage');
        }
    }
}

// Проверка возможности управления
function canControl() {
    // Если контроль отключён - разрешено всем
    if (!state.control.enabled) return true;
    // Иначе только контроллеру
    return state.control.isController;
}

// Обновление статуса контроля из данных сервера
function updateControlStatus(status) {
    state.control.enabled = status.enabled;
    state.control.hasController = status.hasController;
    state.control.isController = status.isController;
    state.control.timeoutSec = status.timeoutSec || 60;

    updateControlUI();
    updateAllControlButtons();
}

// Обновление UI контроля (компактный индикатор в шапке)
function updateControlUI() {
    const statusEl = document.getElementById('control-status');
    if (!statusEl) return;

    // Скрываем если контроль отключён
    if (!state.control.enabled) {
        statusEl.classList.add('hidden');
        return;
    }

    statusEl.classList.remove('hidden');
    statusEl.classList.remove('control-status-readonly', 'control-status-active');

    if (state.control.isController) {
        statusEl.classList.add('control-status-active');
        statusEl.innerHTML = `
            <span class="control-status-icon">✓</span>
            <span class="control-status-text">Control</span>
            <button class="control-status-btn" onclick="releaseControl()">Release</button>
        `;
    } else {
        statusEl.classList.add('control-status-readonly');
        statusEl.innerHTML = `
            <span class="control-status-icon">🔒</span>
            <span class="control-status-text">Read-only</span>
            <button class="control-status-btn" onclick="showControlDialog()">Take</button>
        `;
    }
}

// Обновление всех кнопок управления (disabled состояние)
function updateAllControlButtons() {
    const canCtrl = canControl();

    // IONC кнопки
    document.querySelectorAll('.ionc-btn-set, .ionc-btn-freeze, .ionc-btn-unfreeze, .ionc-btn-gen, .ionc-btn-gen-stop').forEach(btn => {
        // Не трогаем readonly сенсоры - они всегда disabled
        if (btn.closest('tr')?.classList.contains('readonly')) return;
        btn.disabled = !canCtrl;
        if (!canCtrl) {
            btn.title = 'Read-only mode - take control first';
        } else {
            btn.title = '';
        }
    });

    // Modbus/OPCUA control кнопки
    document.querySelectorAll('.btn-take-control, .btn-release-control').forEach(btn => {
        btn.disabled = !canCtrl;
    });

    // Кнопки сохранения параметров (Modbus, OPCUA)
    document.querySelectorAll('[id^="mb-params-save-"], [id^="mbs-params-save-"], [id^="opcua-params-save-"], [id^="opcuasrv-params-save-"]').forEach(btn => {
        btn.disabled = !canCtrl;
        if (!canCtrl) {
            btn.title = 'Read-only mode - take control first';
        } else {
            btn.title = '';
        }
    });

    // Кнопки команд логера
    document.querySelectorAll('.log-command-btn').forEach(btn => {
        btn.disabled = !canCtrl;
        if (!canCtrl) {
            btn.title = 'Read-only mode - take control first';
        } else {
            btn.title = '';
        }
    });
}

// Показать диалог ввода токена
function showControlDialog() {
    const overlay = document.getElementById('control-dialog-overlay');
    if (overlay) {
        overlay.classList.add('visible');
        const input = document.getElementById('control-token-input');
        if (input) {
            input.value = state.control.token || '';
            input.focus();
        }
    }
}

// Закрыть диалог
function closeControlDialog() {
    const overlay = document.getElementById('control-dialog-overlay');
    if (overlay) {
        overlay.classList.remove('visible');
    }
    const error = document.getElementById('control-error');
    if (error) {
        error.textContent = '';
    }
}

// Попытка захвата управления
async function tryTakeControl(token) {
    if (!token) {
        token = document.getElementById('control-token-input')?.value?.trim();
    }
    if (!token) {
        showControlError('Token is required');
        return;
    }

    try {
        const resp = await fetch('/api/control/take', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });

        const data = await resp.json();

        if (!resp.ok) {
            showControlError(data.error || 'Failed to take control');
            return;
        }

        // Успешно
        state.control.token = token;
        localStorage.setItem('control-token', token);
        updateControlStatus(data);
        closeControlDialog();
        startControlPing();

        // Переподключаем SSE с токеном
        reconnectSSEWithToken();

    } catch (e) {
        showControlError('Network error: ' + e.message);
    }
}

// Освобождение управления
async function releaseControl() {
    if (!state.control.token) return;

    try {
        const resp = await fetch('/api/control/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: state.control.token })
        });

        const data = await resp.json();

        if (resp.ok) {
            stopControlPing();
            updateControlStatus(data);
        }
    } catch (e) {
        console.error('Failed to release control:', e);
    }
}

// Показать ошибку в диалоге
function showControlError(message) {
    const error = document.getElementById('control-error');
    if (error) {
        error.textContent = message;
    }
}

// Запуск периодического ping
function startControlPing() {
    stopControlPing();
    if (!state.control.isController || !state.control.token) return;

    // Ping каждые 30 секунд
    state.control.pingIntervalId = setInterval(async () => {
        try {
            await fetch('/api/control/ping', {
                method: 'POST',
                headers: { 'X-Control-Token': state.control.token }
            });
        } catch (e) {
            console.warn('Control ping failed:', e);
        }
    }, 30000);
}

// Остановка ping
function stopControlPing() {
    if (state.control.pingIntervalId) {
        clearInterval(state.control.pingIntervalId);
        state.control.pingIntervalId = null;
    }
}

// Переподключение SSE с токеном
function reconnectSSEWithToken() {
    if (state.sse.eventSource) {
        state.sse.eventSource.close();
    }
    initSSE();
}

// Fetch wrapper с автоматическим добавлением токена контроля
async function controlledFetch(url, options = {}) {
    // Добавляем токен для не-GET запросов
    if (options.method && options.method !== 'GET' && state.control.token) {
        options.headers = {
            ...options.headers,
            'X-Control-Token': state.control.token
        };
    }

    const response = await fetch(url, options);

    // Обработка ошибки контроля
    if (response.status === 403) {
        try {
            const data = await response.clone().json();
            if (data.code === 'CONTROL_REQUIRED') {
                showControlRequiredNotification();
                throw new Error('Control required');
            }
        } catch (e) {
            // Игнорируем ошибку парсинга
        }
    }

    return response;
}

// Показать уведомление о необходимости контроля
function showControlRequiredNotification() {
    // Показываем диалог контроля
    showControlDialog();
}

// ========== Recording Functions ==========

// State for recording
const recordingState = {
    enabled: false,
    isRecording: false,
    recordCount: 0,
    sizeBytes: 0,
    statusPollInterval: null
};

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return '0B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
}

// Format number with abbreviation
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
}

// Initialize recording UI
function initRecordingUI() {
    const statusEl = document.getElementById('recording-status');
    const toggleBtn = document.getElementById('recording-toggle-btn');
    const downloadBtn = document.getElementById('recording-download-btn');
    const dropdownMenu = document.getElementById('recording-dropdown-menu');

    if (!statusEl) return;

    // Toggle recording button
    toggleBtn?.addEventListener('click', async () => {
        try {
            const endpoint = recordingState.isRecording ? '/api/recording/stop' : '/api/recording/start';
            const response = await fetch(endpoint, { method: 'POST' });
            if (response.ok) {
                await updateRecordingStatus();
            } else {
                console.error('Recording toggle failed:', response.status);
            }
        } catch (err) {
            console.error('Recording toggle error:', err);
        }
    });

    // Download dropdown toggle
    downloadBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu?.classList.toggle('hidden');
    });

    // Close dropdown on outside click
    document.addEventListener('click', () => {
        dropdownMenu?.classList.add('hidden');
    });

    // Dropdown menu items
    dropdownMenu?.addEventListener('click', async (e) => {
        const item = e.target.closest('.recording-dropdown-item');
        if (!item) return;

        e.stopPropagation();
        dropdownMenu.classList.add('hidden');

        const format = item.dataset.format;
        const action = item.dataset.action;

        if (action === 'clear') {
            if (confirm('Clear all recording data?\n\nThis will delete all recorded history and cannot be undone.')) {
                try {
                    const response = await fetch('/api/recording/clear', { method: 'DELETE' });
                    if (response.ok) {
                        await updateRecordingStatus();
                    }
                } catch (err) {
                    console.error('Clear recording error:', err);
                }
            }
            return;
        }

        if (format) {
            // Download export file
            let url;
            switch (format) {
                case 'sqlite':
                    url = '/api/export/database';
                    break;
                case 'csv':
                    url = '/api/export/csv';
                    break;
                case 'json':
                    url = '/api/export/json';
                    break;
            }
            if (url) {
                window.location.href = url;
            }
        }
    });

    // Initial status fetch
    updateRecordingStatus();

    // Start polling for status updates (every 5 seconds)
    recordingState.statusPollInterval = setInterval(updateRecordingStatus, 5000);
}

// Update recording status from API
async function updateRecordingStatus() {
    try {
        const response = await fetch('/api/recording/status');
        if (!response.ok) {
            // API not available - hide UI
            recordingState.enabled = false;
            updateRecordingUI();
            return;
        }

        const data = await response.json();
        // Check if recording is configured on server
        recordingState.enabled = data.configured === true;
        recordingState.isRecording = data.isRecording || false;
        recordingState.recordCount = data.recordCount || 0;
        recordingState.sizeBytes = data.sizeBytes || 0;

        updateRecordingUI();
    } catch (err) {
        // API error - hide UI
        recordingState.enabled = false;
        updateRecordingUI();
    }
}

// Update recording UI based on state
function updateRecordingUI() {
    const statusEl = document.getElementById('recording-status');
    const badge = document.getElementById('recording-badge');
    const toggleBtn = document.getElementById('recording-toggle-btn');

    if (!statusEl) return;

    // Show/hide entire recording section
    if (!recordingState.enabled) {
        statusEl.classList.add('hidden');
        return;
    }
    statusEl.classList.remove('hidden');

    // Update recording state
    if (recordingState.isRecording) {
        statusEl.classList.add('recording');
        toggleBtn.textContent = 'Stop';
        toggleBtn.title = 'Stop recording';
        badge.classList.remove('hidden');
        badge.textContent = `${formatNumber(recordingState.recordCount)} / ${formatBytes(recordingState.sizeBytes)}`;
    } else {
        statusEl.classList.remove('recording');
        toggleBtn.textContent = 'Record';
        toggleBtn.title = 'Start recording';
        // Show badge if there's data
        if (recordingState.recordCount > 0) {
            badge.classList.remove('hidden');
            badge.textContent = `${formatNumber(recordingState.recordCount)} / ${formatBytes(recordingState.sizeBytes)}`;
        } else {
            badge.classList.add('hidden');
        }
    }
}

function initSSE() {
    if (state.sse.eventSource) {
        state.sse.eventSource.close();
    }

    // Формируем URL с токеном если есть
    let url = '/api/events';
    if (state.control.token) {
        url += `?token=${encodeURIComponent(state.control.token)}`;
    }
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

            // Обновляем статус контроля
            if (data.data?.control) {
                updateControlStatus(data.data.control);
                // Если мы контроллер, запускаем ping
                if (state.control.isController) {
                    startControlPing();
                }
            }

            // Обновляем индикатор статуса
            updateSSEStatus('connected', new Date());

            // Обновляем доступность кнопок "Add sensor"
            updateAddSensorButtons();

            // Отключаем polling для всех открытых вкладок
            state.tabs.forEach((tabState, objectName) => {
                if (tabState.updateInterval) {
                    clearInterval(tabState.updateInterval);
                    tabState.updateInterval = null;
                    console.log('SSE: Отключен polling для', objectName);
                }
            });
        } catch (err) {
            console.warn('SSE: Error парсинга connected:', err);
        }
    });

    eventSource.addEventListener('object_data', (e) => {
        try {
            const event = JSON.parse(e.data);
            const { objectName, serverId, data, timestamp } = event;

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

                // Обновляем графики напрямую из SSE данных (без запроса истории)
                const eventTimestamp = new Date(timestamp);
                const maxPoints = 1000;

                tabState.charts.forEach((chartData, varName) => {
                    // Пропускаем внешние датчики (ext:) - они обновляются через sensor_data
                    if (varName.startsWith('ext:')) {
                        return;
                    }

                    // Извлекаем значение из data в зависимости от типа переменной
                    let value = undefined;

                    // Проверяем io.in.* переменные
                    if (varName.startsWith('io.in.')) {
                        const ioKey = varName.substring('io.in.'.length);
                        if (data.io?.in?.[ioKey]) {
                            value = data.io.in[ioKey].value;
                        }
                    }
                    // Проверяем io.out.* переменные
                    else if (varName.startsWith('io.out.')) {
                        const ioKey = varName.substring('io.out.'.length);
                        if (data.io?.out?.[ioKey]) {
                            value = data.io.out[ioKey].value;
                        }
                    }

                    // Если нашли значение - добавляем точку на график
                    if (value !== undefined) {
                        const dataPoint = { x: eventTimestamp, y: value };
                        chartData.chart.data.datasets[0].data.push(dataPoint);

                        // Ограничиваем количество точек
                        if (chartData.chart.data.datasets[0].data.length > maxPoints) {
                            chartData.chart.data.datasets[0].data.shift();
                        }
                    }
                });

                // Синхронизируем временную шкалу для всех графиков объекта
                syncAllChartsTimeRange(tabKey);

                // Обновляем все графики одним batch update
                tabState.charts.forEach((chartData, varName) => {
                    if (!varName.startsWith('ext:')) {
                        chartData.chart.update('none');
                    }
                });
            }
        } catch (err) {
            console.warn('SSE: Error обработки object_data:', err);
        }
    });

    // Обработка обновлений внешних датчиков из SM (SharedMemory)
    // Backend отправляет serverId="sm" для SM событий
    eventSource.addEventListener('sensor_data', (e) => {
        try {
            const event = JSON.parse(e.data);
            const { objectName, serverId } = event;
            const sensor = event.data;

            // Формируем tabKey из serverId и objectName
            // serverId="sm" для SharedMemory событий
            const tabKey = serverId
                ? `${serverId}:${objectName}`
                : findTabKeyByDisplayName(objectName); // fallback для legacy
            if (!tabKey) return;

            // Находим вкладку и график для этого датчика
            const tabState = state.tabs.get(tabKey);
            if (tabState) {
                const displayName = tabState.displayName || objectName;
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
                    syncAllChartsTimeRange(tabKey);

                    // Обновляем значение в легенде
                    const safeVarName = varName.replace(/:/g, '-');
                    const legendEl = document.getElementById(`legend-value-${displayName}-${safeVarName}`);
                    if (legendEl) {
                        legendEl.textContent = formatValue(value);
                    }
                }
            }
        } catch (err) {
            console.warn('SSE: Error обработки sensor_data:', err);
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

                // Обновляем график если есть (IONC использует prefix 'io')
                const varName = `io:${sensor.name}`;
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
                syncAllChartsTimeRange(tabKey);
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
            console.warn('SSE: Error обработки ionc_sensor_batch:', err);
        }
    });

    // Обработка батча обновлений Modbus регистров (ModbusMaster, ModbusSlave)
    eventSource.addEventListener('modbus_register_batch', (e) => {
        try {
            const event = JSON.parse(e.data);
            const { objectName, serverId } = event;
            const registers = event.data; // массив регистров

            // Формируем ключ вкладки: serverId:objectName
            const tabKey = `${serverId}:${objectName}`;

            // Находим вкладку с Modbus рендерером
            const tabState = state.tabs.get(tabKey);
            if (!tabState) return;

            // Проверяем, что это Modbus рендерер (Master или Slave)
            const renderer = tabState.renderer;
            if (!renderer) return;

            const isMaster = renderer.constructor.name === 'ModbusMasterRenderer';
            const isSlave = renderer.constructor.name === 'ModbusSlaveRenderer';
            if (!isMaster && !isSlave) return;

            // Вызываем обработчик обновления регистров (для таблицы)
            if (typeof renderer.handleModbusRegisterUpdates === 'function') {
                renderer.handleModbusRegisterUpdates(registers);
            }

            // Обновляем графики
            // ModbusMaster и ModbusSlave используют одинаковый prefix 'mb' в getChartOptions()
            const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();
            const chartsToUpdate = new Set();

            for (const reg of registers) {
                // varName формируется как prefix:sensor.name в createExternalSensorChart
                const varName = `mb:${reg.name}`;
                const chartData = tabState.charts.get(varName);
                if (chartData) {
                    const value = reg.value;
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

            // Синхронизируем временную шкалу и обновляем графики
            if (chartsToUpdate.size > 0) {
                syncAllChartsTimeRange(tabKey);

                // Batch update для графиков с изменениями
                tabState.charts.forEach((chartData, varName) => {
                    // Ограничиваем количество точек
                    const data = chartData.chart.data.datasets[0].data;
                    const maxPoints = 1000;
                    while (data.length > maxPoints) {
                        data.shift();
                    }
                    chartData.chart.update('none');
                });
            }
        } catch (err) {
            console.warn('SSE: Error обработки modbus_register_batch:', err);
        }
    });

    // Обработка батча обновлений OPCUA датчиков (OPCUAExchange, OPCUAServer)
    eventSource.addEventListener('opcua_sensor_batch', (e) => {
        try {
            const event = JSON.parse(e.data);
            const { objectName, serverId } = event;
            const sensors = event.data; // массив датчиков

            // Формируем ключ вкладки: serverId:objectName
            const tabKey = `${serverId}:${objectName}`;

            // Находим вкладку с OPCUA рендерером
            const tabState = state.tabs.get(tabKey);
            if (!tabState) return;

            // Проверяем, что это OPCUAExchange или OPCUAServer рендерер
            const renderer = tabState.renderer;
            const isExchange = renderer && renderer.constructor.name === 'OPCUAExchangeRenderer';
            const isServer = renderer && renderer.constructor.name === 'OPCUAServerRenderer';
            if (!isExchange && !isServer) return;

            // Вызываем обработчик обновления датчиков (для таблицы)
            if (typeof renderer.handleOPCUASensorUpdates === 'function') {
                renderer.handleOPCUASensorUpdates(sensors);
            }

            // Обновляем графики
            // OPCUAExchange и OPCUAServer не переопределяют getChartOptions(), используют default prefix 'ext'
            const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();
            const chartsToUpdate = new Set();

            for (const sensor of sensors) {
                // varName формируется как prefix:sensor.name в createExternalSensorChart
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

            // Синхронизируем временную шкалу и обновляем графики
            if (chartsToUpdate.size > 0) {
                syncAllChartsTimeRange(tabKey);

                // Batch update для графиков с изменениями
                tabState.charts.forEach((chartData, varName) => {
                    // Ограничиваем количество точек
                    const data = chartData.chart.data.datasets[0].data;
                    const maxPoints = 1000;
                    while (data.length > maxPoints) {
                        data.shift();
                    }
                    chartData.chart.update('none');
                });
            }
        } catch (err) {
            console.warn('SSE: Error обработки opcua_sensor_batch:', err);
        }
    });

    // Обработка батча обновлений UWebSocketGate датчиков
    eventSource.addEventListener('uwsgate_sensor_batch', (e) => {
        try {
            const event = JSON.parse(e.data);
            const { objectName, serverId } = event;
            const sensors = event.data; // массив датчиков

            // Формируем ключ вкладки: serverId:objectName
            const tabKey = `${serverId}:${objectName}`;

            // Находим вкладку с UWebSocketGate рендерером
            const tabState = state.tabs.get(tabKey);
            if (!tabState) return;

            // Проверяем, что это UWebSocketGate рендерер
            const renderer = tabState.renderer;
            if (!renderer || renderer.constructor.name !== 'UWebSocketGateRenderer') return;

            // Вызываем обработчик обновления датчиков (для таблицы)
            if (typeof renderer.handleSSEUpdate === 'function') {
                renderer.handleSSEUpdate(sensors);
            }

            // Обновляем графики (UWebSocketGate использует prefix 'ws')
            const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();
            const chartsToUpdate = new Set();

            for (const sensor of sensors) {
                // varName формируется как prefix:sensor.name в createExternalSensorChart
                const varName = `ws:${sensor.name}`;
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

            // Синхронизируем временную шкалу и обновляем графики
            if (chartsToUpdate.size > 0) {
                syncAllChartsTimeRange(tabKey);

                // Batch update для графиков с изменениями
                tabState.charts.forEach((chartData, varName) => {
                    // Ограничиваем количество точек
                    const data = chartData.chart.data.datasets[0].data;
                    const maxPoints = 1000;
                    while (data.length > maxPoints) {
                        data.shift();
                    }
                    chartData.chart.update('none');
                });
            }
        } catch (err) {
            console.warn('SSE: Error обработки uwsgate_sensor_batch:', err);
        }
    });

    // Обработка изменений статуса серверов
    eventSource.addEventListener('server_status', (e) => {
        try {
            const event = JSON.parse(e.data);
            const serverId = event.serverId;
            const connected = event.data?.connected ?? false;
            console.log(`SSE: Сервер ${serverId} ${connected ? 'подключен' : 'отключен'}`);
            updateServerStatus(serverId, connected);
        } catch (err) {
            console.warn('SSE: Error обработки server_status:', err);
        }
    });

    // Обработка обновления списка объектов (при восстановлении связи)
    eventSource.addEventListener('objects_list', (e) => {
        try {
            const event = JSON.parse(e.data);
            const serverId = event.serverId;
            const serverName = event.serverName;
            const objects = event.data?.objects ?? [];
            console.log(`SSE: Сервер ${serverId} восстановил связь, объектов: ${objects.length}`);

            // Обновляем статус сервера
            updateServerStatus(serverId, true);

            // Обновляем список объектов в sidebar
            refreshObjectsList();
        } catch (err) {
            console.warn('SSE: Error обработки objects_list:', err);
        }
    });

    // Обработка изменения статуса контроля
    eventSource.addEventListener('control_status', (e) => {
        try {
            const event = JSON.parse(e.data);
            console.log('SSE: Control status changed:', event.data);
            // Обновляем isController на основе нашего токена
            const status = event.data;
            status.isController = state.control.token &&
                status.hasController &&
                state.control.isController; // сохраняем если мы были контроллером

            // Сервер не знает чей это токен, нужно запросить статус
            fetch('/api/control/status', {
                headers: { 'X-Control-Token': state.control.token || '' }
            })
                .then(r => r.json())
                .then(data => {
                    updateControlStatus(data);
                })
                .catch(err => {
                    console.warn('Failed to refresh control status:', err);
                    // Fallback: используем данные из события
                    updateControlStatus(status);
                });
        } catch (err) {
            console.warn('SSE: Error обработки control_status:', err);
        }
    });

    eventSource.onerror = (e) => {
        console.warn('SSE: Error соединения');
        state.sse.connected = false;

        if (state.sse.reconnectAttempts < state.sse.maxReconnectAttempts) {
            state.sse.reconnectAttempts++;
            // Exponential backoff: baseDelay * 2^(attempt-1) с jitter ±10%
            const expDelay = state.sse.baseReconnectDelay * Math.pow(2, state.sse.reconnectAttempts - 1);
            const cappedDelay = Math.min(expDelay, state.sse.maxReconnectDelay);
            const jitter = cappedDelay * 0.1 * (Math.random() * 2 - 1); // ±10%
            const delay = Math.round(cappedDelay + jitter);
            console.log(`SSE: Переподключение через ${delay}ms (попытка ${state.sse.reconnectAttempts}/${state.sse.maxReconnectAttempts})`);
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

// Close SSE соединение
function closeSSE() {
    if (state.sse.eventSource) {
        state.sse.eventSource.close();
        state.sse.eventSource = null;
        state.sse.connected = false;
    }
}

// Обработчик visibility change — обновить графики при возврате из hidden
// Данные накапливаются в массивах Chart.js пока страница hidden,
// но chart.update() может не отрисовывать canvas в hidden состоянии.
// При возврате в visible принудительно перерисовываем все графики.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        console.log('SSE: Страница снова visible — обновляю графики');

        // Обновляем все графики во всех вкладках
        state.tabs.forEach((tabState, tabKey) => {
            if (tabState.charts && tabState.charts.size > 0) {
                tabState.charts.forEach((chartData, varName) => {
                    if (chartData.chart) {
                        try {
                            // Синхронизируем временную шкалу
                            syncAllChartsTimeRange(tabKey);
                            // Принудительно перерисовываем график
                            chartData.chart.update();
                        } catch (err) {
                            console.warn('SSE: Error обновления графика при visibility change:', varName, err);
                        }
                    }
                });
            }
        });
    }
});

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
    applyFilters(items, nameField = 'name', typeField = 'type', statusField = null) {
        let result = items;

        if (this.filter) {
            const filterLower = this.filter.toLowerCase();
            result = result.filter(item =>
                (item[nameField] || '').toLowerCase().includes(filterLower) ||
                String(item.id).includes(filterLower)
            );
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
        setupFilterHandlers(this.tabKey);
        setupChartsResize(this.tabKey);
        loadIOLayoutState(this.objectName);
        setupIOSections(this.tabKey);
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
        renderVariables(this.tabKey, allVariables);
        renderIO(this.tabKey, 'inputs', data.io?.in || {});
        renderIO(this.tabKey, 'outputs', data.io?.out || {});
        renderTimers(this.tabKey, data.Timers || {});
        renderObjectInfo(this.tabKey, data.object);
        renderStatistics(this.tabKey, data.Statistics);
        updateChartLegends(this.tabKey, data);
        this.handleLogServer(data.LogServer);
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
        setupFilterHandlers(this.tabKey);
        setupChartsResize(this.tabKey);
    }

    update(data) {
        // Объединяем Variables и extra (дополнительные переменные не входящие в стандартные поля)
        const allVariables = { ...(data.Variables || {}), ...(data.extra || {}) };
        renderVariables(this.tabKey, allVariables);
        renderObjectInfo(this.tabKey, data.object);
        renderStatistics(this.tabKey, data.Statistics);
        updateChartLegends(this.tabKey, data);
        this.handleLogServer(data.LogServer);
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
                    Object type "<span class="fallback-type"></span>" is not supported
                </div>
                <div class="fallback-hint">Raw JSON response displayed</div>
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
        renderObjectInfo(this.tabKey, data.object);
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
                <input type="text" class="filter-input" id="opcua-sensors-filter-${this.objectName}" placeholder="Filter by name...">
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
                                <th class="col-chart"></th>
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
            tbody.innerHTML = '<tr><td colspan="10" class="opcua-no-sensors">No sensors</td></tr>';
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
                ${this.renderChartToggleCell(sensor.id, sensor.name, 'opcua')}
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

        // Checkbox для переключения режима поиска
        const searchSensorCheckbox = document.getElementById(`mb-search-sensor-${this.objectName}`);
        const filterInput = document.getElementById(`mb-registers-filter-${this.objectName}`);
        if (searchSensorCheckbox && filterInput) {
            searchSensorCheckbox.addEventListener('change', (e) => {
                this.searchBySensor = e.target.checked;
                filterInput.placeholder = this.searchBySensor ? 'Filter by sensor...' : 'Filter by mbreg...';
                // При переключении режима и наличии фильтра - перезагружаем или перерисовываем
                if (this.filter) {
                    if (this.searchBySensor) {
                        this.loadRegisters(); // Перезагрузка с серверным поиском
                    } else {
                        this.loadRegisters(); // Перезагрузка для получения всех регистров, затем локальная фильтрация
                    }
                }
            });
        }

        // Используем методы из FilterMixin (переопределяем поведение)
        this.setupMBFilterListeners(
            `mb-registers-filter-${this.objectName}`,
            `mb-type-filter-${this.objectName}`
        );
    }

    // Специальная настройка фильтров для Modbus с учётом режима поиска
    setupMBFilterListeners(filterInputId, typeFilterId) {
        const filterInput = document.getElementById(filterInputId);
        const typeFilter = document.getElementById(typeFilterId);

        if (filterInput) {
            filterInput.addEventListener('input', (e) => {
                clearTimeout(this.filterDebounce);
                this.filterDebounce = setTimeout(() => {
                    this.filter = e.target.value.trim();
                    if (this.searchBySensor) {
                        this.loadRegisters(); // Серверный поиск по датчику
                    } else {
                        this.renderRegisters(); // Локальная фильтрация по mbreg
                    }
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
                <input type="text" class="filter-input" id="mb-registers-filter-${this.objectName}" placeholder="Filter by mbreg...">
                <label class="mb-search-mode" title="Search by sensor name instead of register number">
                    <input type="checkbox" id="mb-search-sensor-${this.objectName}">
                    <span>by sensor</span>
                </label>
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
                                <th class="col-chart"></th>
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
            // search передаём только если поиск по датчикам (searchBySensor = true)
            if (this.filter && this.searchBySensor) {
                url += `&search=${encodeURIComponent(this.filter)}`;
            }
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
            } else {
                this.allRegisters = this.allRegisters.concat(registers);
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

        // Фильтруем регистры
        let registersToShow = this.allRegisters;

        // Локальная фильтрация по mbreg (если не поиск по датчику)
        if (this.filter && !this.searchBySensor) {
            const filterLower = this.filter.toLowerCase();
            registersToShow = this.allRegisters.filter(r => {
                const regInfo = r.register || {};
                const mbreg = String(regInfo.mbreg || '');
                return mbreg.includes(filterLower);
            });
        }

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
                    ${this.renderChartToggleCell(reg.id, reg.name, 'mbreg')}
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

// ============================================================================
// ModbusSlaveRenderer - рендерер для ModbusSlave объектов
// ============================================================================

class ModbusSlaveRenderer extends BaseObjectRenderer {
    static getTypeName() {
        return 'ModbusSlave';
    }

    constructor(objectName, tabKey = null) {
        super(objectName, tabKey);
        this.status = null;
        this.params = {};
        // Параметры ModbusSlave отличаются от ModbusMaster
        this.paramNames = [
            'force',
            'sockTimeout',
            'sessTimeout',
            'updateStatTime'
        ];
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
            ${this.createMBSStatusSection()}
            ${this.createMBSTcpSessionsSection()}
            ${this.createMBSParamsSection()}
            ${this.createMBSRegistersSection()}
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

    // ModbusSlave регистры - показываем badge "MB"
    getChartOptions() {
        return { badge: 'MB', prefix: 'mb' };
    }

    async reloadAll() {
        await Promise.allSettled([
            this.loadStatus(),
            this.loadParams(),
            this.loadRegisters()
        ]);
    }

    bindEvents() {
        const refreshParams = document.getElementById(`mbs-params-refresh-${this.objectName}`);
        if (refreshParams) {
            refreshParams.addEventListener('click', () => this.loadParams());
        }

        const saveParams = document.getElementById(`mbs-params-save-${this.objectName}`);
        if (saveParams) {
            saveParams.addEventListener('click', () => this.saveParams());
        }

        // Checkbox для переключения режима поиска
        const searchSensorCheckbox = document.getElementById(`mbs-search-sensor-${this.objectName}`);
        const filterInput = document.getElementById(`mbs-registers-filter-${this.objectName}`);
        if (searchSensorCheckbox && filterInput) {
            searchSensorCheckbox.addEventListener('change', (e) => {
                this.searchBySensor = e.target.checked;
                filterInput.placeholder = this.searchBySensor ? 'Filter by sensor...' : 'Filter by mbreg...';
                if (this.filter) {
                    if (this.searchBySensor) {
                        this.loadRegisters();
                    } else {
                        this.loadRegisters();
                    }
                }
            });
        }

        // Используем методы из FilterMixin (переопределяем поведение)
        this.setupMBSFilterListeners(
            `mbs-registers-filter-${this.objectName}`,
            `mbs-type-filter-${this.objectName}`
        );
    }

    // Специальная настройка фильтров для ModbusSlave с учётом режима поиска
    setupMBSFilterListeners(filterInputId, typeFilterId) {
        const filterInput = document.getElementById(filterInputId);
        const typeFilter = document.getElementById(typeFilterId);

        if (filterInput) {
            filterInput.addEventListener('input', (e) => {
                clearTimeout(this.filterDebounce);
                this.filterDebounce = setTimeout(() => {
                    this.filter = e.target.value.trim();
                    if (this.searchBySensor) {
                        this.loadRegisters();
                    } else {
                        this.renderRegisters();
                    }
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
                this.loadRegisters();
            });
        }
    }

    createMBSStatusSection() {
        return this.createCollapsibleSection('mbs-status', 'ModbusSlave Status', `
            <div class="mb-actions">
                <span class="mb-note" id="mbs-status-note-${this.objectName}"></span>
            </div>
            <table class="info-table">
                <tbody id="mbs-status-${this.objectName}"></tbody>
            </table>
        `, { sectionId: `mbs-status-section-${this.objectName}`, headerExtra: this.createStatusHeaderExtra() });
    }

    createMBSTcpSessionsSection() {
        return this.createCollapsibleSection('mbs-tcp-sessions', 'TCP Sessions', `
            <table class="sensors-table">
                <thead>
                    <tr>
                        <th>IP</th>
                        <th>Ask Count</th>
                    </tr>
                </thead>
                <tbody id="mbs-tcp-sessions-${this.objectName}"></tbody>
            </table>
            <div class="tcp-sessions-info" id="mbs-tcp-sessions-info-${this.objectName}"></div>
        `, { sectionId: `mbs-tcp-sessions-section-${this.objectName}` });
    }

    createMBSParamsSection() {
        return this.createCollapsibleSection('mbs-params', 'Parameters', `
            <div class="mb-actions">
                <button class="btn" id="mbs-params-refresh-${this.objectName}">Refresh</button>
                <button class="btn primary" id="mbs-params-save-${this.objectName}">Apply</button>
                <span class="mb-note" id="mbs-params-note-${this.objectName}"></span>
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
                    <tbody id="mbs-params-${this.objectName}"></tbody>
                </table>
            </div>
        `, { sectionId: `mbs-params-section-${this.objectName}` });
    }

    createMBSRegistersSection() {
        return this.createCollapsibleSection('mbs-registers', 'Registers', `
            <div class="filter-bar mb-actions">
                <input type="text" class="filter-input" id="mbs-registers-filter-${this.objectName}" placeholder="Filter by mbreg...">
                <label class="mb-search-mode" title="Search by sensor name instead of register number">
                    <input type="checkbox" id="mbs-search-sensor-${this.objectName}">
                    <span>by sensor</span>
                </label>
                <select class="type-filter" id="mbs-type-filter-${this.objectName}">
                    <option value="all">All types</option>
                    <option value="AI">AI</option>
                    <option value="AO">AO</option>
                    <option value="DI">DI</option>
                    <option value="DO">DO</option>
                </select>
                <span class="sensor-count" id="mbs-register-count-${this.objectName}">0</span>
                <span class="mb-note" id="mbs-registers-note-${this.objectName}"></span>
            </div>
            <div class="mb-registers-container" id="mbs-registers-container-${this.objectName}" style="height: ${this.registersHeight}px">
                <div class="mb-registers-viewport" id="mbs-registers-viewport-${this.objectName}">
                    <div class="mb-registers-spacer" id="mbs-registers-spacer-${this.objectName}"></div>
                    <table class="sensors-table variables-table mb-registers-table">
                        <thead>
                            <tr>
                                <th class="col-pin">
                                    <span class="mbs-unpin-all" id="mbs-unpin-${this.objectName}" title="Unpin all" style="display:none">✕</span>
                                </th>
                                <th class="col-chart"></th>
                                <th class="col-id">ID</th>
                                <th class="col-name">Name</th>
                                <th class="col-type">Type</th>
                                <th class="col-value">Value</th>
                                <th class="col-mbaddr">MB Addr</th>
                                <th class="col-register">Register</th>
                                <th class="col-func">Function</th>
                                <th class="col-access">Access</th>
                            </tr>
                        </thead>
                        <tbody id="mbs-registers-tbody-${this.objectName}"></tbody>
                    </table>
                    <div class="mb-loading-more" id="mbs-loading-more-${this.objectName}" style="display: none;">Loading...</div>
                </div>
            </div>
            <div class="resize-handle" id="mbs-registers-resize-${this.objectName}"></div>
        `, { sectionId: `mbs-registers-section-${this.objectName}` });
    }

    async loadStatus() {
        try {
            const data = await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/modbus/status`);
            this.status = data.status || null;
            this.renderStatus();
            this.updateParamsAccessibility('mbs');
            this.updateStatusTimestamp();
            this.setNote(`mbs-status-note-${this.objectName}`, '');
        } catch (err) {
            this.setNote(`mbs-status-note-${this.objectName}`, err.message, true);
        }
    }

    renderStatus() {
        const tbody = document.getElementById(`mbs-status-${this.objectName}`);
        if (!tbody) return;

        tbody.innerHTML = '';

        if (!this.status) {
            tbody.innerHTML = '<tr><td colspan="2" class="text-muted">No data</td></tr>';
            this.renderTcpSessions();
            return;
        }

        const status = this.status;
        const rows = [
            { label: 'Name', value: status.name },
            { label: 'TCP', value: status.tcp ? `${status.tcp.ip}:${status.tcp.port}` : null },
            { label: 'force', value: status.force },
            { label: 'sockTimeout', value: status.sockTimeout },
            { label: 'sessTimeout', value: status.sessTimeout },
            { label: 'updateStatTime', value: status.updateStatTime }
        ];

        // Статистика
        if (status.stat) {
            rows.push({ label: 'connectionCount', value: status.stat.connectionCount });
            rows.push({ label: 'smPingOK', value: status.stat.smPingOK });
            rows.push({ label: 'restartTCPServerCount', value: status.stat.restartTCPServerCount });
        }

        // Обслуживаемые адреса
        if (status.myaddr) {
            rows.push({ label: 'MB addresses', value: status.myaddr });
        }

        rows.forEach(row => {
            if (row.value === undefined || row.value === null) return;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="info-label">${row.label}</td>
                <td class="info-value">${formatValue(row.value)}</td>
            `;
            tbody.appendChild(tr);
        });

        this.renderTcpSessions();
    }

    renderTcpSessions() {
        const tbody = document.getElementById(`mbs-tcp-sessions-${this.objectName}`);
        const info = document.getElementById(`mbs-tcp-sessions-info-${this.objectName}`);
        if (!tbody) return;

        tbody.innerHTML = '';

        const sessions = this.status?.tcp_sessions;
        if (!sessions || !sessions.items || sessions.items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="2" class="text-muted">No active sessions</td></tr>';
            if (info) info.innerHTML = '';
            return;
        }

        sessions.items.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.ip}</td>
                <td>${item.askCount}</td>
            `;
            tbody.appendChild(tr);
        });

        if (info) {
            info.innerHTML = `<span class="text-muted">Sessions: ${sessions.count} / ${sessions.max_sessions}</span>`;
        }
    }

    async loadParams() {
        try {
            const query = this.paramNames.map(n => `name=${encodeURIComponent(n)}`).join('&');
            const data = await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/modbus/params?${query}`);
            this.params = data.params || {};
            this.renderParams();
            this.updateParamsAccessibility('mbs');
            this.setNote(`mbs-params-note-${this.objectName}`, '');
        } catch (err) {
            this.setNote(`mbs-params-note-${this.objectName}`, err.message, true);
        }
    }

    renderParams() {
        const tbody = document.getElementById(`mbs-params-${this.objectName}`);
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
        const inputs = document.querySelectorAll(`#mbs-params-${this.objectName} input.param-field`);
        const params = {};

        inputs.forEach(input => {
            const name = input.dataset.param;
            const val = input.value.trim();
            if (val !== '') {
                params[name] = val;
            }
        });

        if (Object.keys(params).length === 0) {
            this.setNote(`mbs-params-note-${this.objectName}`, 'No changes');
            return;
        }

        try {
            await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/modbus/params`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ params })
            });
            this.setNote(`mbs-params-note-${this.objectName}`, 'Saved');
            this.loadParams();
        } catch (err) {
            this.setNote(`mbs-params-note-${this.objectName}`, err.message, true);
        }
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

        const loadingEl = document.getElementById(`mbs-loading-more-${this.objectName}`);
        if (loadingEl) loadingEl.style.display = 'block';

        try {
            let url = `/api/objects/${encodeURIComponent(this.objectName)}/modbus/registers?offset=${offset}&limit=${this.chunkSize}`;
            // search передаём только если поиск по датчикам (searchBySensor = true)
            if (this.filter && this.searchBySensor) {
                url += `&search=${encodeURIComponent(this.filter)}`;
            }
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
            } else {
                this.allRegisters = this.allRegisters.concat(registers);
            }

            this.hasMore = this.allRegisters.length < this.registersTotal;
            this.renderRegisters();
            this.setNote(`mbs-registers-note-${this.objectName}`, '');

            this.updateItemCount(`mbs-register-count-${this.objectName}`, this.allRegisters.length, this.registersTotal);

            // Подписываемся на SSE обновления после загрузки
            this.subscribeToSSE();
        } catch (err) {
            this.setNote(`mbs-registers-note-${this.objectName}`, err.message, true);
        } finally {
            this.isLoadingChunk = false;
            if (loadingEl) loadingEl.style.display = 'none';
        }
    }

    renderRegisters() {
        const tbody = document.getElementById(`mbs-registers-tbody-${this.objectName}`);
        if (!tbody) return;

        // Получаем закрепленные регистры
        const pinnedRegisters = this.getPinnedRegisters();
        const hasPinned = pinnedRegisters.size > 0;

        // Показываем/скрываем кнопку "снять все"
        const unpinBtn = document.getElementById(`mbs-unpin-${this.objectName}`);
        if (unpinBtn) {
            unpinBtn.style.display = hasPinned ? 'inline' : 'none';
        }

        // Фильтруем регистры
        let registersToShow = this.allRegisters;

        // Локальная фильтрация по mbreg (если не поиск по датчику)
        if (this.filter && !this.searchBySensor) {
            const filterLower = this.filter.toLowerCase();
            registersToShow = this.allRegisters.filter(r => {
                const regInfo = r.register || {};
                const mbreg = String(regInfo.mbreg !== undefined ? regInfo.mbreg : (r.mbreg || ''));
                return mbreg.includes(filterLower);
            });
        }

        // Если есть закрепленные и нет фильтра — показываем только их
        if (hasPinned && !this.filter) {
            registersToShow = registersToShow.filter(r => pinnedRegisters.has(String(r.id)));
        }

        // Обновляем счётчик с учётом фильтрации
        this.updateItemCount(`mbs-register-count-${this.objectName}`, registersToShow.length, this.registersTotal);

        // Update registerMap for chart support
        registersToShow.forEach(reg => {
            if (reg.id) {
                this.registerMap.set(reg.id, reg);
            }
        });

        // ModbusSlave формат: device - это mbaddr, register содержит mbreg/mbfunc, есть amode
        const html = registersToShow.map(reg => {
            const isPinned = pinnedRegisters.has(String(reg.id));
            const pinToggleClass = isPinned ? 'pin-toggle pinned' : 'pin-toggle';
            const pinIcon = isPinned ? '📌' : '○';
            const pinTitle = isPinned ? 'Unpin' : 'Pin';

            const mbAddr = reg.device;
            const regInfo = reg.register || {};
            const mbreg = regInfo.mbreg !== undefined ? regInfo.mbreg : reg.mbreg;
            const mbfunc = regInfo.mbfunc;
            return `
                <tr data-sensor-id="${reg.id}">
                    <td class="col-pin">
                        <span class="${pinToggleClass}" data-id="${reg.id}" title="${pinTitle}">
                            ${pinIcon}
                        </span>
                    </td>
                    ${this.renderChartToggleCell(reg.id, reg.name, 'mbsreg')}
                    <td class="col-id">${reg.id}</td>
                    <td class="col-name" title="${escapeHtml(reg.textname || reg.comment || '')}">${escapeHtml(reg.name || '')}</td>
                    <td class="col-type">${reg.iotype ? `<span class="type-badge type-${reg.iotype}">${reg.iotype}</span>` : ''}</td>
                    <td class="col-value">${reg.value !== undefined ? reg.value : ''}</td>
                    <td class="col-mbaddr">${mbAddr || ''}</td>
                    <td class="col-register">${mbreg !== undefined ? mbreg : ''}</td>
                    <td class="col-func">${mbfunc !== undefined ? mbfunc : ''}</td>
                    <td class="col-access">${reg.amode || ''}</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = html;

        // Bind chart toggle events
        this.attachChartToggleListeners(tbody, this.registerMap);

        // Bind pin toggle events
        tbody.querySelectorAll('.pin-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => this.toggleRegisterPin(parseInt(toggle.dataset.id)));
        });

        // Обработчик кнопки "снять все"
        if (unpinBtn) {
            unpinBtn.onclick = () => this.unpinAllRegisters();
        }
    }

    // Override to use ModbusSlave SSE subscription
    subscribeToChartSensor(sensorId) {
        // ModbusSlave registers are already subscribed through main SSE
        if (!this.subscribedSensorIds.has(sensorId)) {
            this.subscribedSensorIds.add(sensorId);
        }
    }

    setupVirtualScroll() {
        const viewport = document.getElementById(`mbs-registers-viewport-${this.objectName}`);
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
        return this.loadSectionHeight('uniset-panel-mbs-registers', 320);
    }

    saveRegistersHeight(value) {
        this.registersHeight = value;
        this.saveSectionHeight('uniset-panel-mbs-registers', value);
    }

    setupRegistersResize() {
        this.setupSectionResize(
            `mbs-registers-resize-${this.objectName}`,
            `mbs-registers-container-${this.objectName}`,
            'uniset-panel-mbs-registers',
            'registersHeight',
            { minHeight: 200, maxHeight: 700 }
        );
    }

    // === SSE подписка на обновления регистров (использует SSESubscriptionMixin) ===

    async subscribeToSSE() {
        const registerIds = this.allRegisters.map(r => r.id);
        await this.subscribeToSSEFor('/modbus', registerIds, 'register_ids', 'ModbusSlave SSE');
    }

    async unsubscribeFromSSE() {
        await this.unsubscribeFromSSEFor('/modbus', 'register_ids', 'ModbusSlave SSE');
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
        const tbody = document.getElementById(`mbs-registers-tbody-${this.objectName}`);
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
        return this.getPinnedItems('uniset-panel-mbs-pinned');
    }

    savePinnedRegisters(pinnedSet) {
        this.savePinnedItems('uniset-panel-mbs-pinned', pinnedSet);
    }

    toggleRegisterPin(registerId) {
        this.toggleItemPin('uniset-panel-mbs-pinned', registerId, this.renderRegisters);
    }

    unpinAllRegisters() {
        this.unpinAllItems('uniset-panel-mbs-pinned', this.renderRegisters);
    }
}

// Apply mixins to ModbusSlaveRenderer
applyMixin(ModbusSlaveRenderer, VirtualScrollMixin);
applyMixin(ModbusSlaveRenderer, SSESubscriptionMixin);
applyMixin(ModbusSlaveRenderer, ResizableSectionMixin);
applyMixin(ModbusSlaveRenderer, FilterMixin);
applyMixin(ModbusSlaveRenderer, ParamsAccessibilityMixin);
applyMixin(ModbusSlaveRenderer, ItemCounterMixin);
applyMixin(ModbusSlaveRenderer, SectionHeightMixin);
applyMixin(ModbusSlaveRenderer, PinManagementMixin);

// ModbusSlave рендерер (по extensionType)
registerRenderer('ModbusSlave', ModbusSlaveRenderer);

// Fallback для старых версий (по objectType)
registerRenderer('MBSlave', ModbusSlaveRenderer);
registerRenderer('MBSlave1', ModbusSlaveRenderer);

// OPCUAServerRenderer - рендерер для OPCUAServer extensionType
// OPCUAServer - это OPC UA сервер, который предоставляет доступ к переменным через OPC UA протокол

class OPCUAServerRenderer extends BaseObjectRenderer {
    static getTypeName() {
        return 'OPCUAServer';
    }

    constructor(objectName, tabKey = null) {
        super(objectName, tabKey);
        this.status = null;
        this.params = {};
        this.paramNames = [
            'updateTime_msec',
            'httpEnabledSetParams'
        ];
        this.loadingNote = '';
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
            ${this.createOPCUAServerStatusSection()}
            ${this.createOPCUAServerParamsSection()}
            ${this.createOPCUAServerSensorsSection()}
            ${this.createLogViewerSection()}
            ${this.createLogServerSection()}
            ${this.createObjectInfoSection()}
        `;
    }

    initialize() {
        this.bindEvents();
        this.reloadAll();
        setupChartsResize(this.tabKey);
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
            this.loadSensors()
        ]);
    }

    bindEvents() {
        const refreshParams = document.getElementById(`opcuasrv-params-refresh-${this.objectName}`);
        if (refreshParams) {
            refreshParams.addEventListener('click', () => this.loadParams());
        }

        const saveParams = document.getElementById(`opcuasrv-params-save-${this.objectName}`);
        if (saveParams) {
            saveParams.addEventListener('click', () => this.saveParams());
        }

        // Используем методы из FilterMixin
        this.setupFilterListeners(
            `opcuasrv-sensors-filter-${this.objectName}`,
            `opcuasrv-type-filter-${this.objectName}`,
            () => this.loadSensors()
        );
    }

    createOPCUAServerStatusSection() {
        return this.createCollapsibleSection('opcuasrv-status', 'OPC UA Server Status', `
            <div class="opcua-actions">
                <span class="opcua-note" id="opcuasrv-status-note-${this.objectName}"></span>
            </div>
            <table class="info-table">
                <tbody id="opcuasrv-status-${this.objectName}"></tbody>
            </table>
            <div class="opcuasrv-endpoints" id="opcuasrv-endpoints-${this.objectName}"></div>
            <div class="opcuasrv-config" id="opcuasrv-config-${this.objectName}"></div>
        `, { sectionId: `opcuasrv-status-section-${this.objectName}`, headerExtra: this.createStatusHeaderExtra() });
    }

    createOPCUAServerParamsSection() {
        const headerIndicator = `
            <span class="header-indicator-dot fail" id="opcuasrv-ind-params-${this.objectName}" onclick="event.stopPropagation()" title="Parameters: loading..."></span>
        `;
        return this.createCollapsibleSection('opcuasrv-params', 'Server Parameters', `
            <div class="opcua-actions">
                <button class="btn" id="opcuasrv-params-refresh-${this.objectName}">Refresh</button>
                <button class="btn primary" id="opcuasrv-params-save-${this.objectName}">Apply</button>
                <span class="opcua-note" id="opcuasrv-params-note-${this.objectName}"></span>
            </div>
            <div class="opcua-params-table-wrapper">
                <table class="variables-table opcua-params-table">
                    <thead>
                        <tr>
                            <th>Parameter</th>
                            <th>Current</th>
                            <th>New value</th>
                        </tr>
                    </thead>
                    <tbody id="opcuasrv-params-${this.objectName}"></tbody>
                </table>
            </div>
        `, { sectionId: `opcuasrv-params-section-${this.objectName}`, headerExtra: headerIndicator });
    }

    createOPCUAServerSensorsSection() {
        return this.createCollapsibleSection('opcuasrv-sensors', 'OPC UA Variables', `
            <div class="filter-bar opcua-actions">
                <input type="text" class="filter-input" id="opcuasrv-sensors-filter-${this.objectName}" placeholder="Filter by name...">
                <select class="type-filter" id="opcuasrv-type-filter-${this.objectName}">
                    <option value="all">All types</option>
                    <option value="AI">AI</option>
                    <option value="AO">AO</option>
                    <option value="DI">DI</option>
                    <option value="DO">DO</option>
                </select>
                <span class="sensor-count" id="opcuasrv-sensor-count-${this.objectName}">0</span>
                <span class="opcua-note" id="opcuasrv-sensors-note-${this.objectName}"></span>
            </div>
            <div class="opcua-sensors-container" id="opcuasrv-sensors-container-${this.objectName}" style="height: ${this.sensorsHeight}px">
                <div class="opcua-sensors-viewport" id="opcuasrv-sensors-viewport-${this.objectName}">
                    <div class="opcua-sensors-spacer" id="opcuasrv-sensors-spacer-${this.objectName}"></div>
                    <table class="sensors-table variables-table opcua-sensors-table">
                        <thead>
                            <tr>
                                <th class="col-pin">
                                    <span class="opcuasrv-unpin-all" id="opcuasrv-unpin-${this.objectName}" title="Unpin all" style="display:none">✕</span>
                                </th>
                                <th class="col-chart"></th>
                                <th class="col-id">ID</th>
                                <th class="col-name">Name</th>
                                <th class="col-type">Type</th>
                                <th class="col-value">Value</th>
                                <th class="col-vtype">VType</th>
                                <th class="col-precision">Precision</th>
                            </tr>
                        </thead>
                        <tbody id="opcuasrv-sensors-${this.objectName}"></tbody>
                    </table>
                    <div class="opcua-loading-more" id="opcuasrv-loading-more-${this.objectName}" style="display: none;">Loading...</div>
                </div>
            </div>
            <div class="resize-handle" id="opcuasrv-sensors-resize-${this.objectName}"></div>
        `, { sectionId: `opcuasrv-sensors-section-${this.objectName}` });
    }

    async loadStatus() {
        try {
            const data = await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/opcua/status`);
            this.status = data.status || null;
            this.renderStatus();
            this.updateParamsAccessibility('opcuasrv');
            this.updateStatusTimestamp();
            this.setNote(`opcuasrv-status-note-${this.objectName}`, '');
        } catch (err) {
            this.setNote(`opcuasrv-status-note-${this.objectName}`, err.message, true);
        }
    }

    renderStatus() {
        const tbody = document.getElementById(`opcuasrv-status-${this.objectName}`);
        const endpointsContainer = document.getElementById(`opcuasrv-endpoints-${this.objectName}`);
        const configContainer = document.getElementById(`opcuasrv-config-${this.objectName}`);
        if (!tbody || !endpointsContainer || !configContainer) return;

        tbody.innerHTML = '';
        endpointsContainer.innerHTML = '';
        configContainer.innerHTML = '';

        if (!this.status) {
            tbody.innerHTML = '<tr><td colspan="2" class="text-muted">No data</td></tr>';
            return;
        }

        const status = this.status;

        // Main status rows
        const rows = [
            { label: 'Name', value: status.name },
            { label: 'httpEnabledSetParams', value: status.httpEnabledSetParams }
        ];

        // Variables info
        if (status.variables) {
            rows.push({ label: 'Total variables', value: status.variables.total });
            rows.push({ label: 'Read', value: status.variables.read });
            rows.push({ label: 'Write', value: status.variables.write });
            rows.push({ label: 'Methods', value: status.variables.methods });
        }

        // Params
        if (status.params) {
            rows.push({ label: 'updateTime_msec', value: status.params.updateTime_msec });
        }

        rows.forEach(row => {
            if (row.value === undefined || row.value === null) return;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="info-label">${row.label}</td>
                <td class="info-value">${formatValue(row.value)}</td>
            `;
            tbody.appendChild(tr);
        });

        // Endpoints
        if (Array.isArray(status.endpoints) && status.endpoints.length > 0) {
            endpointsContainer.innerHTML = '<h4 class="opcuasrv-section-title">Endpoints</h4>';
            status.endpoints.forEach(ep => {
                const div = document.createElement('div');
                div.className = 'opcuasrv-endpoint-card';
                div.innerHTML = `
                    <div class="opcuasrv-endpoint-name">${ep.name || 'Endpoint'}</div>
                    <div class="opcuasrv-endpoint-url">${ep.url || '—'}</div>
                `;
                endpointsContainer.appendChild(div);
            });
        }

        // Config
        if (status.config) {
            configContainer.innerHTML = '<h4 class="opcuasrv-section-title">Configuration</h4>';
            const configTable = document.createElement('table');
            configTable.className = 'info-table';
            const configTbody = document.createElement('tbody');

            const configRows = [
                { label: 'maxSubscriptions', value: status.config.maxSubscriptions },
                { label: 'maxSessions', value: status.config.maxSessions },
                { label: 'maxSecureChannels', value: status.config.maxSecureChannels },
                { label: 'maxSessionTimeout', value: status.config.maxSessionTimeout }
            ];

            configRows.forEach(row => {
                if (row.value === undefined || row.value === null) return;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="info-label">${row.label}</td>
                    <td class="info-value">${formatValue(row.value)}</td>
                `;
                configTbody.appendChild(tr);
            });

            configTable.appendChild(configTbody);
            configContainer.appendChild(configTable);
        }

        // Render LogServer section
        this.handleLogServer(status.LogServer);
    }

    async loadParams() {
        try {
            const query = this.paramNames.map(n => `name=${encodeURIComponent(n)}`).join('&');
            const data = await this.fetchJSON(`/api/objects/${encodeURIComponent(this.objectName)}/opcua/params?${query}`);
            this.params = data.params || {};
            this.renderParams();
            this.updateParamsAccessibility('opcuasrv');
            this.setNote(`opcuasrv-params-note-${this.objectName}`, '');
        } catch (err) {
            this.setNote(`opcuasrv-params-note-${this.objectName}`, err.message, true);
        }
    }

    renderParams() {
        const tbody = document.getElementById(`opcuasrv-params-${this.objectName}`);
        if (!tbody) return;

        tbody.innerHTML = '';
        if (!this.params || Object.keys(this.params).length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-muted">No data</td></tr>';
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
        const tbody = document.getElementById(`opcuasrv-params-${this.objectName}`);
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
            this.setNote(`opcuasrv-params-note-${this.objectName}`, 'No changes');
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
            this.setNote(`opcuasrv-params-note-${this.objectName}`, 'Parameters applied');
            this.loadStatus();
        } catch (err) {
            this.setNote(`opcuasrv-params-note-${this.objectName}`, err.message, true);
        }
    }

    async loadSensors() {
        // Reset state for fresh load
        this.allSensors = [];
        this.hasMore = true;
        this.startIndex = 0;
        this.endIndex = 0;

        // Reset viewport scroll position
        const viewport = document.getElementById(`opcuasrv-sensors-viewport-${this.objectName}`);
        if (viewport) viewport.scrollTop = 0;

        try {
            let url = `/api/objects/${encodeURIComponent(this.objectName)}/opcua/sensors?limit=${this.chunkSize}&offset=0`;

            if (this.filter) {
                url += `&search=${encodeURIComponent(this.filter)}`;
            }
            if (this.typeFilter && this.typeFilter !== 'all') {
                url += `&iotype=${this.typeFilter}`;
            }

            const data = await this.fetchJSON(url);
            let sensors = data.sensors || [];
            this.sensorsTotal = typeof data.total === 'number' ? data.total : sensors.length;

            this.allSensors = sensors;
            this.hasMore = (data.sensors?.length || 0) === this.chunkSize;
            this.updateVisibleRows();
            this.updateSensorCount();
            this.setNote(`opcuasrv-sensors-note-${this.objectName}`, '');

            // Подписываемся на SSE обновления после загрузки
            this.subscribeToSSE();
        } catch (err) {
            this.setNote(`opcuasrv-sensors-note-${this.objectName}`, err.message, true);
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
                url += `&search=${encodeURIComponent(this.filter)}`;
            }
            if (this.typeFilter && this.typeFilter !== 'all') {
                url += `&iotype=${this.typeFilter}`;
            }

            const data = await this.fetchJSON(url);
            let newSensors = data.sensors || [];

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
        const viewport = document.getElementById(`opcuasrv-sensors-viewport-${this.objectName}`);
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
        const viewport = document.getElementById(`opcuasrv-sensors-viewport-${this.objectName}`);
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
        const tbody = document.getElementById(`opcuasrv-sensors-${this.objectName}`);
        const spacer = document.getElementById(`opcuasrv-sensors-spacer-${this.objectName}`);
        if (!tbody || !spacer) return;

        // Получаем закрепленные датчики
        const pinnedSensors = this.getPinnedSensors();
        const hasPinned = pinnedSensors.size > 0;

        // Показываем/скрываем кнопку "снять все"
        const unpinBtn = document.getElementById(`opcuasrv-unpin-${this.objectName}`);
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
            tbody.innerHTML = '<tr><td colspan="8" class="opcua-no-sensors">No variables</td></tr>';
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
                ${this.renderChartToggleCell(sensor.id, sensor.name, 'opcuasrv')}
                <td>${sensor.id || ''}</td>
                <td class="sensor-name" title="${escapeHtml(sensor.textname || sensor.comment || '')}">${sensor.name || ''}</td>
                <td><span class="${typeBadgeClass}">${iotype}</span></td>
                <td class="sensor-value">${sensor.value !== undefined ? formatValue(sensor.value) : '—'}</td>
                <td>${sensor.vtype || ''}</td>
                <td>${sensor.precision !== undefined ? sensor.precision : ''}</td>
            </tr>
            `;
        }).join('');

        // Bind chart toggle events
        this.attachChartToggleListeners(tbody, this.sensorMap);

        // Bind pin toggle events
        tbody.querySelectorAll('.pin-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => this.toggleSensorPin(parseInt(toggle.dataset.id)));
        });

        // Обработчик кнопки "снять все"
        if (unpinBtn) {
            unpinBtn.onclick = () => this.unpinAllSensors();
        }
    }

    // Override to use OPCUAServer SSE subscription
    subscribeToChartSensor(sensorId) {
        // OPCUAServer sensors are already subscribed through main SSE
        if (!this.subscribedSensorIds.has(sensorId)) {
            this.subscribedSensorIds.add(sensorId);
        }
    }

    checkInfiniteScroll(viewport) {
        const scrollTop = viewport.scrollTop;
        const scrollHeight = viewport.scrollHeight;
        const clientHeight = viewport.clientHeight;

        // Load more when scrolled to 80% of content
        if (scrollTop + clientHeight >= scrollHeight * 0.8) {
            this.loadMoreSensors();
        }
    }

    showLoadingIndicator(show) {
        const indicator = document.getElementById(`opcuasrv-loading-more-${this.objectName}`);
        if (indicator) {
            indicator.style.display = show ? 'block' : 'none';
        }
    }

    updateSensorCount() {
        this.updateItemCount(`opcuasrv-sensor-count-${this.objectName}`, this.allSensors.length, this.sensorsTotal);
    }

    loadSensorsHeight() {
        // Используем формат JSON как другие рендереры
        return this.loadSectionHeight('uniset-panel-opcuasrv-sensors', 300);
    }

    saveSensorsHeight(height) {
        this.saveSectionHeight('uniset-panel-opcuasrv-sensors', height);
    }

    setupSensorsResize() {
        this.setupSectionResize(
            `opcuasrv-sensors-resize-${this.objectName}`,
            `opcuasrv-sensors-container-${this.objectName}`,
            'uniset-panel-opcuasrv-sensors',
            'sensorsHeight',
            { minHeight: 200, maxHeight: 700 }
        );
    }

    // SSE subscription methods (использует SSESubscriptionMixin)
    async subscribeToSSE() {
        const sensorIds = this.allSensors.map(s => s.id).filter(id => id != null);
        // OPCUAServer использует другой API параметр (id= вместо filter=), указываем extension_type
        await this.subscribeToSSEFor('/opcua', sensorIds, 'sensor_ids', 'OPCUAServer SSE', { extension_type: 'OPCUAServer' });
    }

    async unsubscribeFromSSE() {
        await this.unsubscribeFromSSEFor('/opcua', 'sensor_ids', 'OPCUAServer SSE');
    }

    handleOPCUASensorUpdates(sensors) {
        if (!sensors || !Array.isArray(sensors)) return;

        // Queue updates for batch rendering
        this.pendingUpdates.push(...sensors);

        if (!this.renderScheduled) {
            this.renderScheduled = true;
            requestAnimationFrame(() => this.batchRenderUpdates());
        }
    }

    batchRenderUpdates() {
        this.renderScheduled = false;

        if (this.pendingUpdates.length === 0) return;

        const updateMap = new Map();
        this.pendingUpdates.forEach(u => updateMap.set(u.id, u));
        this.pendingUpdates = [];

        // Update allSensors array
        this.allSensors.forEach(sensor => {
            const update = updateMap.get(sensor.id);
            if (update) {
                sensor.value = update.value;
            }
        });

        // Update visible rows in DOM
        const tbody = document.getElementById(`opcuasrv-sensors-${this.objectName}`);
        if (!tbody) return;

        tbody.querySelectorAll('tr[data-sensor-id]').forEach(row => {
            const sensorId = parseInt(row.dataset.sensorId, 10);
            const update = updateMap.get(sensorId);
            if (update) {
                const valueCell = row.querySelector('.sensor-value');
                if (valueCell) {
                    valueCell.textContent = formatValue(update.value);
                    // CSS animation trigger via reflow
                    valueCell.classList.remove('value-updated');
                    void valueCell.offsetWidth;
                    valueCell.classList.add('value-updated');
                }
            }
        });
    }

    // Pin management для датчиков
    getPinnedSensors() {
        return this.getPinnedItems('uniset-panel-opcuasrv-pinned');
    }

    savePinnedSensors(pinnedSet) {
        this.savePinnedItems('uniset-panel-opcuasrv-pinned', pinnedSet);
    }

    toggleSensorPin(sensorId) {
        this.toggleItemPin('uniset-panel-opcuasrv-pinned', sensorId, this.renderVisibleSensors);
    }

    unpinAllSensors() {
        this.unpinAllItems('uniset-panel-opcuasrv-pinned', this.renderVisibleSensors);
    }
}

// Apply mixins to OPCUAServerRenderer
applyMixin(OPCUAServerRenderer, VirtualScrollMixin);
applyMixin(OPCUAServerRenderer, SSESubscriptionMixin);
applyMixin(OPCUAServerRenderer, ResizableSectionMixin);
applyMixin(OPCUAServerRenderer, FilterMixin);
applyMixin(OPCUAServerRenderer, ParamsAccessibilityMixin);
applyMixin(OPCUAServerRenderer, ItemCounterMixin);
applyMixin(OPCUAServerRenderer, SectionHeightMixin);
applyMixin(OPCUAServerRenderer, PinManagementMixin);

// OPCUAServer рендерер (по extensionType)
registerRenderer('OPCUAServer', OPCUAServerRenderer);

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

        // Filter: name contains query, not already subscribed
        const matches = allSensors
            .filter(s =>
                s.name.toLowerCase().includes(queryLower) &&
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
    constructor(objectName, container, serverId = null, tabKey = null) {
        this.objectName = objectName;
        this.container = container;
        this.serverId = serverId;
        this.tabKey = tabKey;
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
                    <span class="logviewer-title">Logs</span>
                    <div class="logviewer-controls" onclick="event.stopPropagation()">
                        <div class="log-level-wrapper" id="log-level-wrapper-${this.objectName}">
                            <button class="log-level-btn" id="log-level-btn-${this.objectName}" title="Select log levels">
                                Levels ▼
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
                                    <button class="log-preset-btn" data-preset="errors">Errors</button>
                                    <button class="log-preset-btn" data-preset="info">Info+</button>
                                    <button class="log-preset-btn" data-preset="all">All</button>
                                    <button class="log-preset-btn" data-preset="reset">Reset</button>
                                </div>
                                <button class="log-level-apply log-command-btn" id="log-level-apply-${this.objectName}">Apply</button>
                            </div>
                        </div>
                        <div class="log-filter-wrapper">
                            <input type="text" class="log-filter-input" id="log-filter-${this.objectName}"
                                   placeholder="Filter (/ to focus)..." title="Filter (/ to focus, Esc to clear)">
                            <div class="log-filter-options">
                                <label class="log-filter-option" title="Regular expressions">
                                    <input type="checkbox" id="log-filter-regex-${this.objectName}" checked> Regex
                                </label>
                                <label class="log-filter-option" title="Case sensitive">
                                    <input type="checkbox" id="log-filter-case-${this.objectName}"> Case
                                </label>
                                <label class="log-filter-option" title="Show matches only">
                                    <input type="checkbox" id="log-filter-only-${this.objectName}"> Only
                                </label>
                            </div>
                            <span class="log-match-count" id="log-match-count-${this.objectName}"></span>
                        </div>
                        <div class="log-controls-spacer"></div>
                        <span class="log-stats" id="log-stats-${this.objectName}"></span>
                        <div class="logviewer-status">
                            <span class="logviewer-status-dot" id="log-status-dot-${this.objectName}"></span>
                            <span id="log-status-text-${this.objectName}">Disconnected</span>
                        </div>
                        <button class="log-pause-btn" id="log-pause-${this.objectName}" title="Pause/Resume (Esc)">
                            <span class="pause-icon">⏸</span>
                            <span class="pause-count" id="log-pause-count-${this.objectName}"></span>
                        </button>
                        <button class="log-connect-btn" id="log-connect-${this.objectName}">Connect</button>
                        <select class="log-buffer-select" id="log-buffer-${this.objectName}" title="Buffer size">
                            <option value="500">500</option>
                            <option value="1000">1000</option>
                            <option value="2000">2000</option>
                            <option value="5000">5000</option>
                            <option value="10000" selected>10000</option>
                            <option value="20000">20000</option>
                            <option value="50000">50000</option>
                        </select>
                        <button class="log-download-btn" id="log-download-${this.objectName}" title="Download logs">💾</button>
                        <button class="log-clear-btn" id="log-clear-${this.objectName}" title="Clear">Clear</button>
                    </div>
                    <div class="section-reorder-buttons" onclick="event.stopPropagation()">
                        <button class="section-move-btn section-move-up" onclick="moveSectionUp('${this.tabKey}', 'logviewer')" title="Move up">↑</button>
                        <button class="section-move-btn section-move-down" onclick="moveSectionDown('${this.tabKey}', 'logviewer')" title="Move down">↓</button>
                    </div>
                </div>
                <div class="logviewer-content">
                    <div class="log-container" id="log-container-${this.objectName}" style="height: ${this.height}px">
                        <div class="log-placeholder" id="log-placeholder-${this.objectName}">
                            <span class="log-placeholder-icon">📋</span>
                            <span>Click "Connect" to view logs</span>
                        </div>
                        <div class="log-waiting" id="log-waiting-${this.objectName}" style="display: none">
                            <span class="log-waiting-text">Waiting for messages...</span>
                            <span class="log-waiting-hint">Select log level or wait for messages from the process</span>
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
            const saved = JSON.parse(localStorage.getItem('uniset-panel-filter-options') || '{}');
            saved[this.objectName] = {
                regex: this.filterRegex,
                case: this.filterCase,
                only: this.filterOnlyMatches
            };
            localStorage.setItem('uniset-panel-filter-options', JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save filter options:', err);
        }
    }

    loadFilterOptions() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset-panel-filter-options') || '{}');
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
            const saved = JSON.parse(localStorage.getItem('uniset-panel-buffersize') || '{}');
            saved[this.objectName] = this.maxLines;
            localStorage.setItem('uniset-panel-buffersize', JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save buffer size:', err);
        }
    }

    loadSavedBufferSize() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset-panel-buffersize') || '{}');
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
            btn.textContent = 'Levels ▼';
        } else if (this.selectedLevels.has('ANY')) {
            btn.textContent = 'All ▼';
        } else {
            btn.textContent = `Levels (${this.selectedLevels.size}) ▼`;
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
            const saved = JSON.parse(localStorage.getItem('uniset-panel-loglevels') || '{}');
            saved[this.objectName] = Array.from(this.selectedLevels);
            localStorage.setItem('uniset-panel-loglevels', JSON.stringify(saved));
        } catch (err) {
            console.warn('Failed to save log levels:', err);
        }
    }

    loadSavedLevels() {
        try {
            const saved = JSON.parse(localStorage.getItem('uniset-panel-loglevels') || '{}');
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

        // Batch event handler (new format)
        this.eventSource.addEventListener('logs', (e) => {
            try {
                const lines = JSON.parse(e.data);
                this.addLines(lines);
            } catch (err) {
                console.error('LogViewer: Failed to parse logs batch:', err);
            }
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
            let url = `/api/logs/${encodeURIComponent(this.objectName)}/command`;
            if (this.serverId) {
                url += `?server=${encodeURIComponent(this.serverId)}`;
            }
            await controlledFetch(url, {
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

    // Batch add lines (for batched SSE events)
    addLines(texts) {
        if (!texts || texts.length === 0) return;

        // При первом логе скрываем "ожидание" и показываем логи
        if (!this.hasReceivedLogs) {
            this.hasReceivedLogs = true;
            this.showLogLines();
        }

        const timestamp = new Date();
        const newLines = texts.map(text => ({ text, type: '', timestamp }));

        // Если на паузе - накапливаем в буфер
        if (this.paused) {
            this.pausedBuffer.push(...newLines);
            this.updatePauseCount();
            return;
        }

        this.lines.push(...newLines);

        // Limit lines - also need to remove from DOM
        if (this.lines.length > this.maxLines) {
            const excess = this.lines.length - this.maxLines;
            this.lines = this.lines.slice(-this.maxLines);
            // Remove old lines from DOM
            const linesContainer = document.getElementById(`log-lines-${this.objectName}`);
            if (linesContainer) {
                const toRemove = Math.min(excess, linesContainer.children.length);
                for (let i = 0; i < toRemove; i++) {
                    linesContainer.removeChild(linesContainer.firstChild);
                }
            }
        }

        // Render all new lines using DocumentFragment for better performance
        const linesContainer = document.getElementById(`log-lines-${this.objectName}`);
        if (!linesContainer) return;

        const fragment = document.createDocumentFragment();
        let matchCount = 0;

        newLines.forEach((line, i) => {
            const index = this.lines.length - newLines.length + i;
            const div = document.createElement('div');
            div.className = 'log-line';
            div.dataset.index = index;

            // Detect log level from text
            const levelClass = this.detectLogLevel(line.text);
            if (levelClass) {
                div.classList.add(levelClass);
            }

            // Apply filter highlighting
            const { html, matches } = this.highlightText(line.text);
            if (matches) {
                div.innerHTML = html;
                div.classList.add('has-match');
                matchCount++;
            } else {
                div.textContent = line.text;
                if (this.filterOnlyMatches && this.filter) {
                    div.classList.add('hidden');
                }
            }

            fragment.appendChild(div);
        });

        linesContainer.appendChild(fragment);
        this.matchCount += matchCount;
        this.updateMatchCount();
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
                countEl.textContent = `${this.matchCount} matches`;
                countEl.classList.add('has-matches');
            } else if (this.filter) {
                countEl.textContent = '0 matches';
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
                text.textContent = 'Connected';
                btn.textContent = 'Disconnect';
                btn.classList.add('connected');
                break;
            case 'connecting':
                dot.classList.add('connecting');
                text.textContent = 'Connecting...';
                btn.textContent = 'Stop';
                break;
            case 'reconnecting':
                dot.classList.add('reconnecting');
                text.textContent = 'Reconnecting...';
                btn.textContent = 'Stop';
                btn.classList.add('reconnecting');
                break;
            default: // disconnected
                text.textContent = 'Disconnected';
                btn.textContent = 'Connect';
        }
    }

    saveHeight() {
        try {
            const heights = JSON.parse(localStorage.getItem('uniset-panel-logheights') || '{}');
            heights[this.objectName] = this.height;
            localStorage.setItem('uniset-panel-logheights', JSON.stringify(heights));
        } catch (err) {
            console.warn('Failed to save log height:', err);
        }
    }

    loadSavedHeight() {
        try {
            const heights = JSON.parse(localStorage.getItem('uniset-panel-logheights') || '{}');
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
        throw new Error('Failed to load server list');
    }

    // Сохраняем кешированные объекты перед очисткой
    const cachedObjectsMap = new Map();
    state.servers.forEach((server, serverId) => {
        if (server.cachedObjects && server.cachedObjects.length > 0) {
            cachedObjectsMap.set(serverId, server.cachedObjects);
        }
    });

    state.servers.clear();
    serversData.servers.forEach(server => {
        state.servers.set(server.id, {
            id: server.id,
            url: server.url,
            name: server.name || server.url,
            connected: server.connected,
            cachedObjects: cachedObjectsMap.get(server.id) || [] // восстанавливаем кеш
        });
    });

    // Отображаем секцию серверов в sidebar
    renderServersSection();

    // Загружаем объекты со всех серверов
    const response = await fetch('/api/all-objects');
    if (!response.ok) throw new Error('Failed to load objects list');
    return response.json();
}

// Обновить список объектов (вызывается при восстановлении связи с сервером)
async function refreshObjectsList() {
    try {
        const data = await fetchObjects();
        renderObjectsList(data);
        console.log('Список объектов обновлён');
    } catch (err) {
        console.error('Error обновления списка объектов:', err);
    }
}

async function fetchObjectData(name, serverId = null) {
    let url = `/api/objects/${encodeURIComponent(name)}`;
    if (serverId) {
        url += `?server=${encodeURIComponent(serverId)}`;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load object data');
    return response.json();
}

async function watchObject(name, serverId = null) {
    let url = `/api/objects/${encodeURIComponent(name)}/watch`;
    if (serverId) {
        url += `?server=${encodeURIComponent(serverId)}`;
    }
    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to start watching');
    return response.json();
}

async function unwatchObject(name, serverId = null) {
    let url = `/api/objects/${encodeURIComponent(name)}/watch`;
    if (serverId) {
        url += `?server=${encodeURIComponent(serverId)}`;
    }
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to stop watching');
    return response.json();
}

async function fetchVariableHistory(objectName, variableName, count = 100, serverId = null) {
    let url = `/api/objects/${encodeURIComponent(objectName)}/variables/${encodeURIComponent(variableName)}/history?count=${count}`;
    if (serverId) {
        url += `&server=${encodeURIComponent(serverId)}`;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load history');
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

// Loading конфигурации сенсоров
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
        console.error('Error загрузки конфигурации сенсоров:', err);
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
function renderObjectsList(data) {
    const list = document.getElementById('objects-list');
    list.innerHTML = '';

    // Проверяем есть ли хоть что-то для отображения (данные или кеш)
    let hasAnyObjects = false;
    if (data && data.objects) {
        for (const serverData of data.objects) {
            const existingServer = state.servers.get(serverData.serverId);
            const apiObjects = serverData.objects || [];
            const cachedObjects = existingServer?.cachedObjects || [];
            if (apiObjects.length > 0 || cachedObjects.length > 0) {
                hasAnyObjects = true;
                break;
            }
        }
    }

    if (!hasAnyObjects) {
        list.innerHTML = '<li class="loading">No objects found</li>';
        renderServersSection();
        return;
    }

    // data.objects - массив { serverId, serverName, objects: [...] }
    data.objects.forEach(serverData => {
        const serverId = serverData.serverId;
        const serverName = serverData.serverName || serverId;
        const serverConnected = serverData.connected !== false;
        const apiObjects = serverData.objects || [];

        // Получаем существующий сервер из state
        const existingServer = state.servers.get(serverId);

        // Определяем какие объекты отображать
        let objectsToRender;
        if (serverConnected && apiObjects.length > 0) {
            // Сервер подключен и есть объекты - обновляем кеш и используем их
            objectsToRender = apiObjects;
            if (existingServer) {
                existingServer.cachedObjects = [...apiObjects];
            }
        } else if (!serverConnected && existingServer?.cachedObjects?.length > 0) {
            // Сервер отключен - используем кешированные объекты
            objectsToRender = existingServer.cachedObjects;
        } else {
            // Нет ни данных, ни кеша - пропускаем
            objectsToRender = apiObjects;
        }

        const objectCount = objectsToRender.length;

        // Обновляем информацию о сервере в state
        if (existingServer) {
            existingServer.objectCount = objectCount;
        }

        if (objectCount === 0) return;

        // Создаём группу для сервера
        const group = document.createElement('div');
        group.className = 'server-group';
        group.dataset.serverId = serverId;
        if (state.collapsedServerGroups.has(serverId)) {
            group.classList.add('collapsed');
        }

        // Заголовок группы
        const header = document.createElement('div');
        header.className = 'server-group-header';
        header.innerHTML = `
            <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
            </svg>
            <span class="server-status-dot${serverConnected ? '' : ' disconnected'}"></span>
            <span class="server-name">${escapeHtml(serverName)}</span>
            <span class="server-objects-count">${objectCount}</span>
        `;
        header.addEventListener('click', () => toggleServerGroup(serverId));
        group.appendChild(header);

        // Список объектов группы
        const objectsList = document.createElement('ul');
        objectsList.className = 'server-group-objects';

        objectsToRender.forEach(name => {
            const li = document.createElement('li');
            li.dataset.name = name;
            li.dataset.serverId = serverId;
            li.dataset.serverName = serverName;

            // Если сервер отключен - добавляем класс disconnected к объектам
            if (!serverConnected) {
                li.classList.add('disconnected');
            }

            const nameSpan = document.createElement('span');
            nameSpan.className = 'object-name';
            nameSpan.textContent = name;

            li.appendChild(nameSpan);
            li.addEventListener('click', () => openObjectTab(name, serverId, serverName));
            objectsList.appendChild(li);
        });

        group.appendChild(objectsList);
        list.appendChild(group);
    });

    // Рендерим секцию серверов
    renderServersSection();
}

// Переключить свёрнутость группы сервера в списке объектов
function toggleServerGroup(serverId) {
    const group = document.querySelector(`.server-group[data-server-id="${serverId}"]`);
    if (!group) return;

    if (state.collapsedServerGroups.has(serverId)) {
        state.collapsedServerGroups.delete(serverId);
        group.classList.remove('collapsed');
    } else {
        state.collapsedServerGroups.add(serverId);
        group.classList.add('collapsed');
    }
    saveSettings();
}

// Рендеринг секции "Servers" в sidebar
function renderServersSection() {
    const section = document.getElementById('servers-section');
    const list = document.getElementById('servers-list');
    const countEl = document.getElementById('servers-count');
    const header = document.getElementById('servers-section-header');

    if (!section || !list) return;

    // Применяем сохранённое состояние свёрнутости
    if (state.serversSectionCollapsed) {
        section.classList.add('collapsed');
    } else {
        section.classList.remove('collapsed');
    }

    // Обработчик клика на заголовок секции
    if (!header.dataset.listenerAdded) {
        header.addEventListener('click', toggleServersSection);
        header.dataset.listenerAdded = 'true';
    }

    // Обновляем счётчик
    if (countEl) {
        countEl.textContent = state.servers.size;
    }

    // Рендерим список серверов
    list.innerHTML = '';

    state.servers.forEach((server, serverId) => {
        const li = document.createElement('li');
        li.className = 'server-item' + (server.connected ? ' connected' : ' disconnected');
        li.dataset.serverId = serverId;

        const objectCount = server.objectCount || 0;
        const connectedCount = server.connected ? objectCount : 0;

        let statsClass = '';
        if (objectCount === 0) {
            statsClass = '';
        } else if (connectedCount === objectCount) {
            statsClass = 'all-connected';
        } else if (connectedCount === 0) {
            statsClass = 'all-disconnected';
        } else {
            statsClass = 'some-disconnected';
        }

        const statusClass = server.connected ? '' : ' disconnected';
        const displayName = server.name || `${server.url.replace(/^https?:\/\//, '')}`;
        const statsText = objectCount > 0 ? `${connectedCount}/${objectCount}` : '-/-';

        li.innerHTML = `
            <span class="server-status-dot${statusClass}"></span>
            <span class="server-name" title="${escapeHtml(server.url)}">${escapeHtml(displayName)}</span>
            <span class="server-stats ${statsClass}">${statsText}</span>
        `;

        // Клик на сервер — развернуть/свернуть его группу в списке объектов
        li.addEventListener('click', () => {
            // Находим группу сервера и прокручиваем к ней
            const group = document.querySelector(`.server-group[data-server-id="${serverId}"]`);
            if (group) {
                // Если группа свёрнута — разворачиваем
                if (state.collapsedServerGroups.has(serverId)) {
                    toggleServerGroup(serverId);
                }
                // Прокручиваем к группе
                group.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });

        list.appendChild(li);
    });
}

// Переключить свёрнутость секции "Servers"
function toggleServersSection() {
    const section = document.getElementById('servers-section');
    if (!section) return;

    state.serversSectionCollapsed = !state.serversSectionCollapsed;
    section.classList.toggle('collapsed', state.serversSectionCollapsed);
    saveSettings();
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
        console.error(`Error открытия вкладки ${name}:`, err);
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
    const serverData = state.servers.get(serverId);
    const serverConnected = serverData?.connected !== false;

    const tabBtn = document.createElement('button');
    tabBtn.className = 'tab-btn' + (serverConnected ? '' : ' server-disconnected');
    tabBtn.dataset.name = tabKey;
    tabBtn.dataset.objectType = rendererInfo.rendererType;
    tabBtn.dataset.serverId = serverId;

    const badgeType = rendererInfo.badgeType || rendererInfo.rendererType || 'Default';

    // Формируем HTML вкладки
    const tabHTML = `
        <span class="tab-type-badge">${badgeType}</span>
        <span class="tab-server-badge${serverConnected ? '' : ' disconnected'}" data-server-id="${serverId}">${serverName}</span>
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
    panel.className = 'tab-panel' + (serverConnected ? '' : ' server-disconnected');
    panel.dataset.name = tabKey;
    panel.dataset.objectType = rendererInfo.rendererType;
    panel.dataset.serverId = serverId;
    panel.innerHTML = renderer.createPanelHTML();
    tabsContent.appendChild(panel);

    // Восстановить состояние спойлеров
    restoreCollapsedSections(displayName);

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
    restoreExternalSensors(tabKey, displayName);

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
        tabsContent.innerHTML = '<div class="placeholder">Select an object from the list on the left</div>';
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
        console.error(`Error загрузки ${name}:`, err);
    }
}

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
function renderTimers(tabKey, timersData) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const displayName = tabState.displayName || tabKey;

    const tbody = getElementInTab(tabKey, `timers-${displayName}`);
    const countBadge = getElementInTab(tabKey, `timers-count-${displayName}`);
    if (!tbody) return;

    // Извлечь таймеры из объекта (исключая count)
    const timers = [];
    Object.entries(timersData).forEach(([key, timer]) => {
        if (key !== 'count' && typeof timer === 'object') {
            timers.push({...timer, _key: key});
        }
    });

    // Сохраняем в кэш для локального обновления
    timerDataCache[tabKey] = {
        timers: timers,
        lastUpdate: Date.now()
    };

    if (countBadge) {
        countBadge.textContent = timers.length;
    }

    renderTimersTable(tabKey, timers);

    // Запускаем интервал локального обновления если ещё не запущен
    startTimerUpdateInterval();
}

// Отрисовка таблицы таймеров
function renderTimersTable(tabKey, timers) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const displayName = tabState.displayName || tabKey;

    const tbody = getElementInTab(tabKey, `timers-${displayName}`);
    if (!tbody) return;

    // Получаем текущий фильтр (глобальный) и закреплённые строки
    const filterInput = getElementInTab(tabKey, `io-filter-global-${displayName}`);
    const filterText = filterInput ? filterInput.value.toLowerCase() : '';
    const pinnedRows = getIOPinnedRows(tabKey, 'timers');
    const hasPinned = pinnedRows.size > 0;

    // Показываем/скрываем кнопку "снять все"
    const unpinBtn = getElementInTab(tabKey, `io-unpin-timers-${displayName}`);
    if (unpinBtn) {
        unpinBtn.style.display = hasPinned ? 'inline' : 'none';
    }

    tbody.innerHTML = '';

    if (timers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No timers</td></tr>';
        return;
    }

    timers.forEach(timer => {
        const rowKey = timer.id || timer._key;
        const isPinned = pinnedRows.has(String(rowKey));

        // Filterация
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
                <span class="io-pin-toggle ${isPinned ? 'pinned' : ''}" data-row-key="${rowKey}" title="${isPinned ? 'Unpin' : 'Pin'}">
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
            toggleIOPin(tabKey, 'timers', rowKey);
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
function renderObjectInfo(tabKey, objectData) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const displayName = tabState.displayName || tabKey;

    const tbody = getElementInTab(tabKey, `object-info-${displayName}`);
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
        { key: 'name', label: 'Name' },
        { key: 'id', label: 'ID' },
        { key: 'objectType', label: 'Type' },
        { key: 'extensionType', label: 'Extension' },
        { key: 'isActive', label: 'Active', format: v => v ? 'Yes' : 'No' }
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
function renderLogServer(tabKey, logServerData) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const displayName = tabState.displayName || tabKey;

    const section = getElementInTab(tabKey, `logserver-section-${displayName}`);
    const tbody = getElementInTab(tabKey, `logserver-${displayName}`);
    if (!section || !tbody) return;

    if (!logServerData) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    tbody.innerHTML = '';

    const fields = [
        { key: 'host', label: 'Host' },
        { key: 'port', label: 'Port' },
        { key: 'state', label: 'Status', formatState: true }
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
function renderStatistics(tabKey, statsData) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const displayName = tabState.displayName || tabKey;

    const section = getElementInTab(tabKey, `statistics-section-${displayName}`);
    const container = getElementInTab(tabKey, `statistics-${displayName}`);
    if (!section || !container) return;

    if (!statsData) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    // Сохраняем данные статистики в state для фильтрации
    tabState.statisticsData = statsData;

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
                <div class="stats-subtitle">Sensors</div>
                <input type="text"
                       class="filter-input stats-filter"
                       id="filter-stats-${displayName}"
                       placeholder="Filter by sensor name..."
                       data-object="${tabKey}">
                <table class="variables-table stats-sensors-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Срабатываний</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        `;

        // Настроить обработчик фильтра
        const filterInput = container.querySelector(`#filter-stats-${displayName}`);
        if (filterInput) {
            filterInput.addEventListener('input', (e) => {
                renderStatisticsSensors(tabKey, e.target.value);
            });
            filterInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    filterInput.value = '';
                    filterInput.blur();
                    renderStatisticsSensors(tabKey, '');
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
        const currentFilter = container.querySelector(`#filter-stats-${displayName}`)?.value || '';
        renderStatisticsSensors(tabKey, currentFilter);
    } else {
        sensorsSection.style.display = 'none';
    }
}

// Рендеринг таблицы сенсоров в статистике с фильтрацией
function renderStatisticsSensors(tabKey, filterText = '') {
    const tabState = state.tabs.get(tabKey);
    if (!tabState || !tabState.statisticsData?.sensors) return;

    const displayName = tabState.displayName || tabKey;

    const container = getElementInTab(tabKey, `statistics-${displayName}`);
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
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No data</td></tr>';
    }
}

// Восстановление состояния спойлеров из localStorage
function restoreCollapsedSections(objectName) {
    try {
        const saved = localStorage.getItem('uniset-panel-collapsed');
        if (saved) {
            state.collapsedSections = JSON.parse(saved);
        }
    } catch (err) {
        console.warn('Error загрузки состояния спойлеров:', err);
    }

    // Apply сохранённые состояния к секциям этого объекта
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
        localStorage.setItem('uniset-panel-collapsed', JSON.stringify(collapsed));
    } catch (err) {
        console.warn('Error сохранения состояния спойлеров:', err);
    }
}

// Color picker для изменения цвета графика
let activeColorPicker = null;

function showColorPicker(element, tabKey, varName) {
    // Close предыдущий picker если открыт
    hideColorPicker();

    const tabState = state.tabs.get(tabKey);
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
            changeChartColor(tabKey, varName, color);
            hideColorPicker();
        });
        popup.appendChild(option);
    });

    document.body.appendChild(popup);
    activeColorPicker = popup;

    // Close по клику вне popup
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

function changeChartColor(tabKey, varName, newColor) {
    const tabState = state.tabs.get(tabKey);
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
    // Используем displayName для ID элемента (objectName)
    const displayName = tabState.displayName || tabKey;
    const safeVarName = varName.replace(/:/g, '-');
    const colorPicker = document.querySelector(`#chart-panel-${displayName}-${safeVarName} .legend-color-picker`);
    if (colorPicker) {
        colorPicker.style.background = newColor;
    }
}

// Переключение заливки графика
// tabKey - ключ вкладки (serverId:objectName)
function toggleChartFill(tabKey, varName, fillEnabled) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const chartData = tabState.charts.get(varName);
    if (!chartData) return;

    chartData.chart.data.datasets[0].fill = fillEnabled;
    chartData.chart.update('none');
}

// Переключение сглаживания линии графика
// tabKey - ключ вкладки (serverId:objectName)
function toggleChartSmooth(tabKey, varName, smoothEnabled) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const chartData = tabState.charts.get(varName);
    if (!chartData) return;

    chartData.chart.data.datasets[0].tension = smoothEnabled ? 0.3 : 0;
    chartData.chart.update('none');
}

// Переключение stepped режима графика (меандр)
// tabKey - ключ вкладки (serverId:objectName)
function toggleChartStepped(tabKey, varName, steppedEnabled) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const chartData = tabState.charts.get(varName);
    if (!chartData) return;

    chartData.chart.data.datasets[0].stepped = steppedEnabled ? 'before' : false;
    chartData.chart.update('none');
}

// Делегирование события для color picker
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('legend-color-picker')) {
        const tabKey = e.target.dataset.object; // data-object содержит tabKey
        const varName = e.target.dataset.variable;
        showColorPicker(e.target, tabKey, varName);
    }
});

// Настройка обработчиков фильтра для вкладки
function setupFilterHandlers(tabKey) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const displayName = tabState.displayName || tabKey;

    const filterInput = getElementInTab(tabKey, `filter-variables-${displayName}`);
    if (!filterInput) return;

    // Обработка ввода
    filterInput.addEventListener('input', (e) => {
        const tabState = state.tabs.get(tabKey);
        if (tabState && tabState.variables) {
            renderVariables(tabKey, tabState.variables, e.target.value);
        }
    });

    // Обработка ESC
    filterInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            filterInput.value = '';
            filterInput.blur();
            const tabState = state.tabs.get(tabKey);
            if (tabState && tabState.variables) {
                renderVariables(tabKey, tabState.variables, '');
            }
        }
    });
}

// Настройка resize для графиков
function setupChartsResize(tabKey) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const displayName = tabState.displayName || tabKey;

    const resizeHandle = getElementInTab(tabKey, `charts-resize-${displayName}`);
    const chartsContainer = getElementInTab(tabKey, `charts-container-${displayName}`);

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
        saveChartsHeight(tabKey, chartsContainer.offsetHeight);
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
    loadChartsHeight(tabKey);
}

function saveChartsHeight(tabKey, height) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset-panel-charts-height') || '{}');
        saved[tabKey] = height;
        localStorage.setItem('uniset-panel-charts-height', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save charts height:', err);
    }
}

function loadChartsHeight(tabKey) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;

    const displayName = tabState.displayName || tabKey;

    try {
        const saved = JSON.parse(localStorage.getItem('uniset-panel-charts-height') || '{}');
        if (saved[tabKey]) {
            const chartsContainer = getElementInTab(tabKey, `charts-container-${displayName}`);
            if (chartsContainer) {
                chartsContainer.style.height = `${saved[tabKey]}px`;
                chartsContainer.style.maxHeight = `${saved[tabKey]}px`;
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
        const saved = JSON.parse(localStorage.getItem('uniset-panel-ionc-height') || '{}');
        saved[objectName] = height;
        localStorage.setItem('uniset-panel-ionc-height', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save IONC sensors height:', err);
    }
}

function loadIONCSensorsHeight(objectName) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset-panel-ionc-height') || '{}');
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
        const saved = JSON.parse(localStorage.getItem('uniset-panel-io-layout') || '{}');
        saved[objectName] = isSequential;
        localStorage.setItem('uniset-panel-io-layout', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save IO layout state:', err);
    }
}

function loadIOLayoutState(objectName) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset-panel-io-layout') || '{}');
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

// tabKey - ключ вкладки (serverId:objectName)
function moveSectionUp(tabKey, sectionId) {
    const section = getSectionElement(tabKey, sectionId);
    if (!section) return;

    const prev = getPreviousReorderableSection(section);
    if (prev) {
        section.parentNode.insertBefore(section, prev);
        saveSectionOrder(tabKey);
        updateReorderButtons(tabKey);
    }
}

// tabKey - ключ вкладки (serverId:objectName)
function moveSectionDown(tabKey, sectionId) {
    const section = getSectionElement(tabKey, sectionId);
    if (!section) return;

    const next = getNextReorderableSection(section);
    if (next) {
        section.parentNode.insertBefore(next, section);
        saveSectionOrder(tabKey);
        updateReorderButtons(tabKey);
    }
}

function getSectionElement(tabKey, sectionId) {
    // Ищем секцию по data-section-id внутри панели вкладки
    const panel = document.querySelector(`.tab-panel[data-name="${tabKey}"]`);
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

// tabKey - ключ вкладки (serverId:objectName)
function saveSectionOrder(tabKey) {
    try {
        const panel = document.querySelector(`.tab-panel[data-name="${tabKey}"]`);
        if (!panel) return;

        const sections = panel.querySelectorAll('.reorderable-section[data-section-id]');
        const order = Array.from(sections).map(s => s.dataset.sectionId);

        const saved = JSON.parse(localStorage.getItem('uniset-panel-section-order') || '{}');
        saved[tabKey] = order;
        localStorage.setItem('uniset-panel-section-order', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save section order:', err);
    }
}

// tabKey - ключ вкладки (serverId:objectName)
function loadSectionOrder(tabKey) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset-panel-section-order') || '{}');
        const order = saved[tabKey];
        if (!order || !Array.isArray(order)) return;

        const panel = document.querySelector(`.tab-panel[data-name="${tabKey}"]`);
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

// tabKey - ключ вкладки (serverId:objectName)
function updateReorderButtons(tabKey) {
    const panel = document.querySelector(`.tab-panel[data-name="${tabKey}"]`);
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
// tabKey - ключ вкладки (serverId:objectName)
function setupIOSections(tabKey) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState) return;
    const objectName = tabState.displayName || tabKey;

    // Setup global filter for all IO sections
    setupIOGlobalFilter(tabKey, objectName);

    ['inputs', 'outputs', 'timers'].forEach(type => {
        setupIOResize(objectName, type);
        setupIOUnpinAll(tabKey, objectName, type);
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
        const saved = JSON.parse(localStorage.getItem('uniset-panel-io-collapse') || '{}');
        const key = `${objectName}-${type}`;
        saved[key] = collapsed ? 'collapsed' : 'expanded';
        localStorage.setItem('uniset-panel-io-collapse', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save IO collapse state:', err);
    }
}

function loadIOCollapseState(objectName, type) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset-panel-io-collapse') || '{}');
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
        const saved = JSON.parse(localStorage.getItem('uniset-panel-io-heights') || '{}');
        const key = `${objectName}-${type}`;
        saved[key] = height;
        localStorage.setItem('uniset-panel-io-heights', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save IO height:', err);
    }
}

function loadIOHeight(objectName, type) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset-panel-io-heights') || '{}');
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

// tabKey - ключ вкладки, objectName - displayName для DOM селекторов
function setupIOGlobalFilter(tabKey, objectName) {
    const filterInput = document.getElementById(`io-filter-global-${objectName}`);
    if (!filterInput) return;

    let filterTimeout = null;

    const refilterAll = () => {
        const tabState = state.tabs.get(tabKey);
        if (tabState) {
            if (tabState.ioData?.in) {
                renderIO(tabKey, 'inputs', tabState.ioData.in);
            }
            if (tabState.ioData?.out) {
                renderIO(tabKey, 'outputs', tabState.ioData.out);
            }
            if (tabState.timersData) {
                renderTimers(tabKey, tabState.timersData);
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

// tabKey - ключ вкладки, objectName - displayName для DOM селекторов
function setupIOUnpinAll(tabKey, objectName, type) {
    const unpinBtn = document.getElementById(`io-unpin-${type}-${objectName}`);
    if (!unpinBtn) return;

    unpinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearIOPinnedRows(tabKey, type);
        // Перерисовываем
        const tabState = state.tabs.get(tabKey);
        if (tabState) {
            if (type === 'inputs' && tabState.ioData?.in) {
                renderIO(tabKey, 'inputs', tabState.ioData.in);
            } else if (type === 'outputs' && tabState.ioData?.out) {
                renderIO(tabKey, 'outputs', tabState.ioData.out);
            } else if (type === 'timers' && tabState.timersData) {
                renderTimers(tabKey, tabState.timersData);
            }
        }
    });
}

// Pinned rows management
function getIOPinnedRows(tabKey, type) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset-panel-io-pinned') || '{}');
        const key = `${tabKey}-${type}`;
        return new Set(saved[key] || []);
    } catch (err) {
        return new Set();
    }
}

function saveIOPinnedRows(tabKey, type, pinnedSet) {
    try {
        const saved = JSON.parse(localStorage.getItem('uniset-panel-io-pinned') || '{}');
        const key = `${tabKey}-${type}`;
        saved[key] = Array.from(pinnedSet);
        localStorage.setItem('uniset-panel-io-pinned', JSON.stringify(saved));
    } catch (err) {
        console.warn('Failed to save pinned rows:', err);
    }
}

function toggleIOPin(tabKey, type, rowKey) {
    const pinned = getIOPinnedRows(tabKey, type);
    const keyStr = String(rowKey);

    if (pinned.has(keyStr)) {
        pinned.delete(keyStr);
    } else {
        pinned.add(keyStr);
    }

    saveIOPinnedRows(tabKey, type, pinned);

    // Перерисовываем
    const tabState = state.tabs.get(tabKey);
    if (tabState) {
        if (type === 'inputs' && tabState.ioData?.in) {
            renderIO(tabKey, 'inputs', tabState.ioData.in);
        } else if (type === 'outputs' && tabState.ioData?.out) {
            renderIO(tabKey, 'outputs', tabState.ioData.out);
        } else if (type === 'timers' && tabState.timersData) {
            renderTimers(tabKey, tabState.timersData);
        }
    }
}

function clearIOPinnedRows(tabKey, type) {
    saveIOPinnedRows(tabKey, type, new Set());
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
        sidebarCollapsed: state.sidebarCollapsed,
        collapsedServerGroups: Array.from(state.collapsedServerGroups),
        serversSectionCollapsed: state.serversSectionCollapsed
    };
    localStorage.setItem('uniset-panel-settings', JSON.stringify(settings));
}

// Loading настроек из localStorage
function loadSettings() {
    try {
        const saved = localStorage.getItem('uniset-panel-settings');
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

            // Восстановить свёрнутые группы серверов
            if (settings.collapsedServerGroups && Array.isArray(settings.collapsedServerGroups)) {
                state.collapsedServerGroups = new Set(settings.collapsedServerGroups);
            }

            // Восстановить состояние секции "Servers"
            if (settings.serversSectionCollapsed !== undefined) {
                state.serversSectionCollapsed = settings.serversSectionCollapsed;
            }
        }
    } catch (err) {
        console.warn('Error загрузки настроек:', err);
    }
}

// Loading конфигурации приложения
async function loadAppConfig() {
    try {
        const response = await fetch('/api/config');
        if (response.ok) {
            const config = await response.json();
            state.config = { ...state.config, ...config };
            console.log('App config loaded:', state.config);
        }
    } catch (err) {
        console.warn('Failed to load app config:', err);
    }
}

// Загрузка версии приложения
async function loadAppVersion() {
    try {
        const response = await fetch('/api/version');
        if (response.ok) {
            const data = await response.json();
            const versionEl = document.getElementById('app-version');
            if (versionEl && data.version) {
                versionEl.textContent = `v${data.version}`;
            }
        }
    } catch (err) {
        console.warn('Failed to load app version:', err);
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    // Загружаем версию приложения
    loadAppVersion();

    // Инициализация токена контроля (из URL или localStorage)
    initControlToken();

    // Загружаем конфигурацию приложения (не блокируем загрузку объектов)
    loadAppConfig();

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
            console.error('Error загрузки объектов:', err);
            document.getElementById('objects-list').innerHTML =
                '<li class="alert alert-error">Error loading objects</li>';
        });

    // Кнопка обновления
    document.getElementById('refresh-objects').addEventListener('click', () => {
        fetchObjects()
            .then(renderObjectsList)
            .catch(console.error);
    });

    // Кнопка очистки кэша
    document.getElementById('clear-cache').addEventListener('click', () => {
        if (confirm('Clear all saved settings?\n\nWill be deleted:\n- section order\n- selected charts\n- LogViewer settings\n- sidebar state')) {
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

    // Инициализация селектора poll interval
    initPollIntervalSelector();

    // Инициализация UI записи
    initRecordingUI();

    // Loading сохранённых настроек
    loadSettings();
});

// Инициализация селектора интервала опроса
function initPollIntervalSelector() {
    const buttons = document.querySelectorAll('.poll-btn');
    const savedInterval = localStorage.getItem('pollInterval');

    // Set активную кнопку
    const setActive = (interval) => {
        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.interval === String(interval));
        });
    };

    // Восстановить из localStorage или использовать значение с сервера
    if (savedInterval) {
        setActive(savedInterval);
    } else {
        // По умолчанию 1s
        setActive(1000);
    }

    // Обработчики кликов
    buttons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const interval = parseInt(btn.dataset.interval);
            setActive(interval);
            localStorage.setItem('pollInterval', interval);

            // Обновляем глобальный интервал и перезапускаем автообновление статуса
            state.sse.pollInterval = interval;
            restartAllStatusAutoRefresh();

            // Отправляем на сервер
            try {
                const response = await fetch('/api/settings/poll-interval', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ interval })
                });
                if (response.ok) {
                    console.log(`Poll interval изменён на ${interval}ms`);
                } else {
                    console.warn('Не удалось изменить poll interval');
                }
            } catch (err) {
                console.error('Error изменения poll interval:', err);
            }
        });
    });
}

// Перезапуск автообновления статуса для всех активных табов
function restartAllStatusAutoRefresh() {
    for (const tabKey of Object.keys(state.tabs)) {
        const tab = state.tabs[tabKey];
        if (tab && tab.renderer && typeof tab.renderer.startStatusAutoRefresh === 'function') {
            tab.renderer.startStatusAutoRefresh();
        }
    }
}
