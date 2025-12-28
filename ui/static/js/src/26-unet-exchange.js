// ============================================================================
// UNetExchangeRenderer - рендерер для объектов UNetExchange (UNet UDP)
// ============================================================================

// Метрики для receivers
const UNET_RECV_METRICS = [
    { id: 'recvPerSec', label: 'Recv/s', getter: (chan) => chan.stats?.recvPerSec || 0 },
    { id: 'lostPackets', label: 'Lost Packets', getter: (chan) => chan.lostPackets || 0 },
    { id: 'upPerSec', label: 'Updates/s', getter: (chan) => chan.stats?.upPerSec || 0 },
    { id: 'qsize', label: 'Queue Size', getter: (chan) => chan.stats?.qsize || 0 },
    { id: 'cacheMissed', label: 'Cache Missed', getter: (chan) => chan.cacheMissed || 0 }
];

// Метрики для senders
const UNET_SEND_METRICS = [
    { id: 'lastpacknum', label: 'Pack#', getter: (chan) => chan.lastpacknum || 0 }
];

class UNetExchangeRenderer extends BaseObjectRenderer {
    static getTypeName() {
        return 'UNetExchange';
    }

    constructor(objectName, tabKey = null) {
        super(objectName, tabKey);

        // Данные статуса
        this.status = null;
        this.receivers = [];
        this.senders = {};

        // Включенные каналы (для отслеживания какие каналы добавлены на графики)
        this.enabledRecvChannels = new Set(); // "node0:chan1", "node0:chan2", ...
        this.enabledSendChannels = new Set(); // "chan1", "chan2", ...

        // Скрываем кнопку "+ Sensor" - у UNet нет отдельных датчиков
        this.showAddSensorButton = false;
    }

    getChartOptions() {
        return { badge: 'UNET', prefix: 'unet' };
    }

    createPanelHTML() {
        return `
            ${this.createChartsSection()}
            ${this.createUNetStatusSection()}
            ${this.createUNetReceiversSection()}
            ${this.createUNetSendersSection()}
            ${this.createLogViewerSection()}
            ${this.createLogServerSection()}
            ${this.createObjectInfoSection()}
        `;
    }

    createUNetStatusSection() {
        return this.createCollapsibleSection('unet-status', 'Status', `
            <div class="unet-status-grid" id="unet-status-${this.objectName}">
                <div class="status-loading">Loading...</div>
            </div>
        `, { sectionId: `unet-status-section-${this.objectName}` });
    }

    createUNetReceiversSection() {
        return this.createCollapsibleSection('unet-receivers', 'Receivers', `
            <div class="unet-receivers-container" id="unet-receivers-container-${this.objectName}">
                <table class="sensors-table unet-table">
                    <thead>
                        <tr>
                            <th class="col-add-buttons"></th>
                            <th class="col-node">Node</th>
                            <th class="col-channel">Channel</th>
                            <th class="col-transport">Transport</th>
                            <th class="col-mode">Mode</th>
                            <th class="col-status">Status</th>
                            <th class="col-recv">Recv/s</th>
                            <th class="col-lost">Lost</th>
                            <th class="col-queue">Queue</th>
                        </tr>
                    </thead>
                    <tbody id="unet-receivers-tbody-${this.objectName}">
                        <tr><td colspan="9" class="loading-cell">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
            <div class="section-counter">
                <span id="unet-receivers-count-${this.objectName}">0</span> receivers
            </div>
        `, { sectionId: `unet-receivers-section-${this.objectName}` });
    }

    createUNetSendersSection() {
        return this.createCollapsibleSection('unet-senders', 'Senders', `
            <div class="unet-senders-container" id="unet-senders-container-${this.objectName}">
                <table class="sensors-table unet-table">
                    <thead>
                        <tr>
                            <th class="col-add-buttons"></th>
                            <th class="col-channel">Channel</th>
                            <th class="col-transport">Transport</th>
                            <th class="col-mode">Mode</th>
                            <th class="col-items">Items</th>
                            <th class="col-packnum">Pack#</th>
                            <th class="col-sendpause">Send Pause</th>
                        </tr>
                    </thead>
                    <tbody id="unet-senders-tbody-${this.objectName}">
                        <tr><td colspan="7" class="loading-cell">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
            <div class="section-counter">
                <span id="unet-senders-count-${this.objectName}">0</span> senders
            </div>
        `, { sectionId: `unet-senders-section-${this.objectName}` });
    }

    initialize() {
        this.loadStatus();
        this.initStatusAutoRefresh();
        setupChartsResize(this.tabKey);
    }

    destroy() {
        this.stopStatusAutoRefresh();
        this.destroyLogViewer();
        // Очищаем графики
        const tabState = state.tabs.get(this.tabKey);
        if (tabState && tabState.charts) {
            for (const [varName, chartData] of tabState.charts) {
                if (varName.startsWith('unet:')) {
                    if (chartData.chart) {
                        chartData.chart.destroy();
                    }
                    tabState.charts.delete(varName);
                }
            }
        }
        this.enabledRecvChannels.clear();
        this.enabledSendChannels.clear();
    }

    // Обновление данных объекта (вызывается из tabs.js и SSE)
    update(data) {
        renderObjectInfo(this.tabKey, data.object);
        this.handleLogServer(data.LogServer);
    }

    async loadStatus() {
        const serverParam = this.getServerParam();

        try {
            const response = await fetch(`/api/objects/${this.objectName}/unet/status?${serverParam}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            this.status = await response.json();
            this.updateStatusTimestamp();

            // Распаковываем receivers и senders из status
            if (this.status.receivers) {
                this.receivers = this.status.receivers;
            }
            if (this.status.senders) {
                this.senders = this.status.senders;
            }

            this.renderStatus();
            this.renderReceivers();
            this.renderSenders();
            this.updateCharts();

            // Handle LogServer section
            if (this.status.LogServer) {
                this.handleLogServer(this.status.LogServer);
            }

        } catch (err) {
            console.error('Failed to load UNet status:', err);
            this.renderStatusError(err.message);
        }
    }

    getServerParam() {
        const tabState = state.tabs.get(this.tabKey);
        const serverId = tabState?.serverId || '';
        return serverId ? `server=${encodeURIComponent(serverId)}` : '';
    }

    renderStatus() {
        const container = document.getElementById(`unet-status-${this.objectName}`);
        if (!container || !this.status) return;

        const activated = this.status.activated;
        const activatedClass = activated ? 'status-ok' : 'status-error';
        const activatedText = activated ? 'Active' : 'Inactive';

        container.innerHTML = `
            <div class="status-grid">
                <div class="status-item">
                    <span class="status-label">Status</span>
                    <span class="status-value ${activatedClass}">${activatedText}</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Max HeartBeat</span>
                    <span class="status-value">${this.status.maxHeartBeat || 0}</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Step Time</span>
                    <span class="status-value">${this.status.steptime || 0} ms</span>
                </div>
                <div class="status-item">
                    <span class="status-label">No Sender</span>
                    <span class="status-value">${this.status.no_sender ? 'Yes' : 'No'}</span>
                </div>
            </div>
        `;
    }

    renderStatusError(message) {
        const container = document.getElementById(`unet-status-${this.objectName}`);
        if (container) {
            container.innerHTML = `<div class="status-error">Error: ${message}</div>`;
        }
    }

    renderReceivers() {
        const tbody = document.getElementById(`unet-receivers-tbody-${this.objectName}`);
        const countEl = document.getElementById(`unet-receivers-count-${this.objectName}`);
        if (!tbody) return;

        if (!this.receivers || this.receivers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">No receivers</td></tr>';
            if (countEl) countEl.textContent = '0';
            return;
        }

        let totalChannels = 0;
        const rows = [];

        this.receivers.forEach((node, nodeIndex) => {
            const channels = Object.keys(node).filter(k => k.startsWith('chan'));

            channels.forEach(chanKey => {
                const chan = node[chanKey];
                totalChannels++;

                const channelId = `node${nodeIndex}:${chanKey}`;
                const recvOK = chan.recvOK;
                const statusClass = recvOK ? 'status-ok' : 'status-error';
                const statusText = recvOK ? 'OK' : 'ERR';

                const modeClass = chan.mode === 'ACTIVE' ? 'mode-active' : 'mode-passive';

                // Метрики
                const recvPerSec = chan.stats?.recvPerSec || 0;
                const lostPackets = chan.lostPackets || 0;
                const qsize = chan.stats?.qsize || 0;

                const isEnabled = this.enabledRecvChannels.has(channelId);

                rows.push(`
                    <tr>
                        <td class="col-add-buttons add-buttons-col">
                            <span class="chart-toggle">
                                <input type="checkbox"
                                       class="chart-checkbox chart-toggle-input"
                                       id="chart-${this.objectName}-recv-${nodeIndex}-${chanKey}"
                                       ${isEnabled ? 'checked' : ''}
                                       onchange="toggleUNetChannel('${this.tabKey}', 'recv', '${channelId}', this.checked)">
                                <label class="chart-toggle-label" for="chart-${this.objectName}-recv-${nodeIndex}-${chanKey}" title="Add to Charts">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M3 3v18h18"/>
                                        <path d="M18 9l-5 5-4-4-3 3"/>
                                    </svg>
                                </label>
                            </span>
                        </td>
                        <td class="col-node">node${nodeIndex}</td>
                        <td class="col-channel">${chanKey}</td>
                        <td class="col-transport">${chan.transport || '-'}</td>
                        <td class="col-mode"><span class="${modeClass}">${chan.mode || '-'}</span></td>
                        <td class="col-status"><span class="${statusClass}">${statusText}</span></td>
                        <td class="col-recv">${recvPerSec}</td>
                        <td class="col-lost">${lostPackets}</td>
                        <td class="col-queue">${qsize}</td>
                    </tr>
                `);
            });
        });

        tbody.innerHTML = rows.join('');
        if (countEl) countEl.textContent = totalChannels.toString();
    }

    renderSenders() {
        const tbody = document.getElementById(`unet-senders-tbody-${this.objectName}`);
        const countEl = document.getElementById(`unet-senders-count-${this.objectName}`);
        if (!tbody) return;

        const channels = Object.keys(this.senders).filter(k => k.startsWith('chan'));

        if (channels.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No senders</td></tr>';
            if (countEl) countEl.textContent = '0';
            return;
        }

        const rows = channels.map(chanKey => {
            const chan = this.senders[chanKey];
            const channelId = chanKey;

            const modeEnabled = chan.mode === 'Enabled';
            const modeClass = modeEnabled ? 'mode-enabled' : 'mode-disabled';

            const isEnabled = this.enabledSendChannels.has(channelId);

            return `
                <tr>
                    <td class="col-add-buttons add-buttons-col">
                        <span class="chart-toggle">
                            <input type="checkbox"
                                   class="chart-checkbox chart-toggle-input"
                                   id="chart-${this.objectName}-send-${chanKey}"
                                   ${isEnabled ? 'checked' : ''}
                                   onchange="toggleUNetChannel('${this.tabKey}', 'send', '${channelId}', this.checked)">
                            <label class="chart-toggle-label" for="chart-${this.objectName}-send-${chanKey}" title="Add to Charts">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M3 3v18h18"/>
                                    <path d="M18 9l-5 5-4-4-3 3"/>
                                </svg>
                            </label>
                        </span>
                    </td>
                    <td class="col-channel">${chanKey}</td>
                    <td class="col-transport">${chan.transport || '-'}</td>
                    <td class="col-mode"><span class="${modeClass}">${chan.mode || '-'}</span></td>
                    <td class="col-items">${chan.items || 0}</td>
                    <td class="col-packnum">${chan.lastpacknum || 0}</td>
                    <td class="col-sendpause">${chan.params?.sendpause || 0} ms</td>
                </tr>
            `;
        });

        tbody.innerHTML = rows.join('');
        if (countEl) countEl.textContent = channels.length.toString();
    }

    // Получить или создать график для метрики
    getOrCreateMetricChart(metricId, metricLabel, type) {
        const tabState = state.tabs.get(this.tabKey);
        if (!tabState) return null;

        if (!tabState.charts) {
            tabState.charts = new Map();
        }

        const chartKey = `unet:${type}:${metricId}`;

        if (!tabState.charts.has(chartKey)) {
            // Создаём новый график
            const chartsGrid = document.getElementById(`charts-${this.objectName}`);
            if (!chartsGrid) return null;

            const safeChartKey = chartKey.replace(/:/g, '-');

            const chartContainer = document.createElement('div');
            chartContainer.className = 'chart-panel';
            chartContainer.id = `chart-panel-${this.objectName}-${safeChartKey}`;
            chartContainer.innerHTML = `
                <div class="chart-panel-header">
                    <div class="chart-panel-info">
                        <span class="chart-panel-badge">UNET</span>
                        <span class="chart-panel-title">${type === 'recv' ? 'Recv' : 'Send'}: ${metricLabel}</span>
                    </div>
                    <div class="chart-panel-right">
                        <button class="btn-icon" title="Close" onclick="removeUNetMetricChart('${this.tabKey}', '${chartKey}')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="chart-wrapper">
                    <canvas id="chart-canvas-${this.objectName}-${safeChartKey}"></canvas>
                </div>
            `;
            chartsGrid.appendChild(chartContainer);

            const canvas = document.getElementById(`chart-canvas-${this.objectName}-${safeChartKey}`);
            const chart = new Chart(canvas, {
                type: 'line',
                data: {
                    datasets: []
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    scales: {
                        x: {
                            type: 'time',
                            time: {
                                displayFormats: { second: 'HH:mm:ss' }
                            },
                            ticks: { maxTicksLimit: 6 }
                        },
                        y: {
                            beginAtZero: true
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { boxWidth: 12, padding: 8 }
                        }
                    }
                }
            });

            tabState.charts.set(chartKey, {
                chart: chart,
                metricId: metricId,
                type: type,
                channels: new Map() // channelId -> datasetIndex
            });
        }

        return tabState.charts.get(chartKey);
    }

    // Добавить канал на график метрики
    addChannelToChart(chartData, channelId, channelLabel) {
        if (!chartData || chartData.channels.has(channelId)) return;

        const color = getNextColor();
        const datasetIndex = chartData.chart.data.datasets.length;

        chartData.chart.data.datasets.push({
            label: channelLabel,
            data: [],
            borderColor: color,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.1
        });

        chartData.channels.set(channelId, datasetIndex);
        chartData.chart.update('none');
    }

    // Удалить канал с графика метрики
    removeChannelFromChart(chartData, channelId) {
        if (!chartData || !chartData.channels.has(channelId)) return;

        const datasetIndex = chartData.channels.get(channelId);

        // Удаляем dataset
        chartData.chart.data.datasets.splice(datasetIndex, 1);
        chartData.channels.delete(channelId);

        // Пересчитываем индексы оставшихся каналов
        const newChannels = new Map();
        let newIndex = 0;
        for (const [chId, _] of chartData.channels) {
            newChannels.set(chId, newIndex++);
        }
        chartData.channels = newChannels;

        chartData.chart.update('none');
    }

    // Удалить график метрики полностью
    removeMetricChart(chartKey) {
        const tabState = state.tabs.get(this.tabKey);
        if (!tabState || !tabState.charts) return;

        const chartData = tabState.charts.get(chartKey);
        if (chartData) {
            if (chartData.chart) {
                chartData.chart.destroy();
            }
            tabState.charts.delete(chartKey);

            // Удаляем контейнер
            const safeChartKey = chartKey.replace(/:/g, '-');
            const container = document.getElementById(`chart-panel-${this.objectName}-${safeChartKey}`);
            if (container) {
                container.remove();
            }

            // Удаляем канал из enabled sets если на этом графике
            // (пользователь закрыл график - не снимаем checkboxes, чтобы другие графики остались)
        }
    }

    // Включить/выключить канал на всех графиках
    toggleChannel(type, channelId, enabled) {
        const metrics = type === 'recv' ? UNET_RECV_METRICS : UNET_SEND_METRICS;
        const enabledSet = type === 'recv' ? this.enabledRecvChannels : this.enabledSendChannels;

        if (enabled) {
            enabledSet.add(channelId);

            // Добавляем канал на все графики метрик
            metrics.forEach(metric => {
                const chartData = this.getOrCreateMetricChart(metric.id, metric.label, type);
                if (chartData) {
                    this.addChannelToChart(chartData, channelId, channelId);
                }
            });
        } else {
            enabledSet.delete(channelId);

            // Удаляем канал со всех графиков метрик
            const tabState = state.tabs.get(this.tabKey);
            if (tabState && tabState.charts) {
                metrics.forEach(metric => {
                    const chartKey = `unet:${type}:${metric.id}`;
                    const chartData = tabState.charts.get(chartKey);
                    if (chartData) {
                        this.removeChannelFromChart(chartData, channelId);

                        // Если на графике не осталось каналов - удаляем график
                        if (chartData.channels.size === 0) {
                            this.removeMetricChart(chartKey);
                        }
                    }
                });
            }
        }
    }

    updateCharts() {
        const tabState = state.tabs.get(this.tabKey);
        if (!tabState || !tabState.charts) return;

        const now = Date.now();
        const maxPoints = 300;

        // Обновляем графики receivers
        UNET_RECV_METRICS.forEach(metric => {
            const chartKey = `unet:recv:${metric.id}`;
            const chartData = tabState.charts.get(chartKey);
            if (!chartData) return;

            this.receivers.forEach((node, nodeIndex) => {
                const channels = Object.keys(node).filter(k => k.startsWith('chan'));
                channels.forEach(chanKey => {
                    const channelId = `node${nodeIndex}:${chanKey}`;
                    if (!chartData.channels.has(channelId)) return;

                    const chan = node[chanKey];
                    const value = metric.getter(chan);
                    const datasetIndex = chartData.channels.get(channelId);
                    const dataset = chartData.chart.data.datasets[datasetIndex];

                    if (dataset) {
                        dataset.data.push({ x: now, y: value });
                        if (dataset.data.length > maxPoints) {
                            dataset.data.shift();
                        }
                    }
                });
            });

            chartData.chart.update('none');
        });

        // Обновляем графики senders
        UNET_SEND_METRICS.forEach(metric => {
            const chartKey = `unet:send:${metric.id}`;
            const chartData = tabState.charts.get(chartKey);
            if (!chartData) return;

            const senderChannels = Object.keys(this.senders).filter(k => k.startsWith('chan'));
            senderChannels.forEach(chanKey => {
                const channelId = chanKey;
                if (!chartData.channels.has(channelId)) return;

                const chan = this.senders[chanKey];
                const value = metric.getter(chan);
                const datasetIndex = chartData.channels.get(channelId);
                const dataset = chartData.chart.data.datasets[datasetIndex];

                if (dataset) {
                    dataset.data.push({ x: now, y: value });
                    if (dataset.data.length > maxPoints) {
                        dataset.data.shift();
                    }
                }
            });

            chartData.chart.update('none');
        });
    }
}

// Глобальная функция для toggle канала (добавляет/удаляет на все графики метрик)
function toggleUNetChannel(tabKey, type, channelId, enabled) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState || !tabState.renderer) return;

    const renderer = tabState.renderer;
    if (renderer.toggleChannel) {
        renderer.toggleChannel(type, channelId, enabled);
    }
}

// Глобальная функция для удаления графика метрики
function removeUNetMetricChart(tabKey, chartKey) {
    const tabState = state.tabs.get(tabKey);
    if (!tabState || !tabState.renderer) return;

    const renderer = tabState.renderer;
    if (renderer.removeMetricChart) {
        renderer.removeMetricChart(chartKey);
    }
}

// Регистрация рендерера
registerRenderer('UNetExchange', UNetExchangeRenderer);
