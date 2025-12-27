// ============================================================================
// SSE Status UI
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
