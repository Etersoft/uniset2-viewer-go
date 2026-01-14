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

        // Reconnection settings
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.baseReconnectDelay = 1000; // 1 second
        this.maxReconnectDelay = 30000; // 30 seconds
        this.reconnectTimer = null;

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
        // Clear any pending reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
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
            this.reconnectAttempts = 0; // Reset on successful connection
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
            console.log('LogViewer: Disconnected from LogServer, will reconnect');
            this.handleConnectionError();
        });

        this.eventSource.addEventListener('error', (e) => {
            if (e.data) {
                this.addLine(`[ERROR] ${e.data}`, 'error');
            }
            this.handleConnectionError();
        });

        this.eventSource.onerror = () => {
            this.handleConnectionError();
        };
    }

    handleConnectionError() {
        if (!this.isActive) return; // Already disconnected by user

        this.connected = false;

        // Close current EventSource to prevent browser's automatic reconnection
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }

        this.reconnectAttempts++;

        if (this.reconnectAttempts <= this.maxReconnectAttempts) {
            // Exponential backoff with jitter
            const expDelay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            const cappedDelay = Math.min(expDelay, this.maxReconnectDelay);
            const jitter = cappedDelay * 0.1 * (Math.random() * 2 - 1);
            const delay = Math.round(cappedDelay + jitter);

            console.log(`LogViewer: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            this.updateStatus('reconnecting');

            // Clear any existing timer
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
            }

            this.reconnectTimer = setTimeout(() => {
                if (this.isActive) {
                    this.connect();
                }
            }, delay);
        } else {
            // Max attempts reached - disconnect
            console.warn('LogViewer: Max reconnection attempts reached, disconnecting');
            this.addLine('[WARN] Connection lost. Click Connect to retry.', 'error');
            this.isActive = false;
            this.updateStatus('disconnected');
        }
    }

    disconnect() {
        // Clear reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.connected = false;
        this.isActive = false;
        this.reconnectAttempts = 0;
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

