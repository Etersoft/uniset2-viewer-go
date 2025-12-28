// Journal (Message Log) Component
// Displays messages from ClickHouse database with filtering and real-time updates

class JournalRenderer {
    constructor(journalId, journalName) {
        this.journalId = journalId;
        this.journalName = journalName;
        this.messages = [];
        this.isPaused = false;
        this.pendingMessages = [];
        this.filters = {
            mtype: 'all',
            mgroup: 'all',
            search: '',
            from: null,
            to: null
        };
        this.offset = 0;
        this.limit = 100;
        this.total = 0;
        this.mtypes = [];
        this.mgroups = [];
        this.containerId = `journal-${journalId}`;
        this.isLoading = false;
        this.hasMore = true;
        this.searchDebounceTimer = null;
        this.activeTimeRange = '1h'; // Default time range
    }

    createPanelHTML() {
        return `
            <div class="journal-panel" id="${this.containerId}">
                <div class="journal-toolbar">
                    <div class="journal-filters">
                        <select id="journal-mtype-${this.journalId}" class="journal-select" title="Filter by type">
                            <option value="all">All types</option>
                        </select>
                        <select id="journal-mgroup-${this.journalId}" class="journal-select" title="Filter by group">
                            <option value="all">All groups</option>
                        </select>
                        <div class="journal-search-wrap">
                            <input type="text" id="journal-search-${this.journalId}" class="journal-search" placeholder="Search..." title="Search in messages (ESC to clear)">
                            <span class="journal-search-clear" id="journal-search-clear-${this.journalId}" title="Clear search">&times;</span>
                        </div>
                    </div>
                    <div class="journal-time-range">
                        <button class="journal-time-btn" data-range="15m">15m</button>
                        <button class="journal-time-btn active" data-range="1h">1h</button>
                        <button class="journal-time-btn" data-range="3h">3h</button>
                        <button class="journal-time-btn" data-range="10h">10h</button>
                        <button class="journal-time-btn" data-range="1d">1d</button>
                        <button class="journal-time-btn" data-range="3d">3d</button>
                        <button class="journal-time-btn" data-range="1w">1w</button>
                        <button class="journal-time-btn" data-range="1M">1M</button>
                        <button class="journal-time-btn" data-range="all">All</button>
                    </div>
                    <div class="journal-controls">
                        <button id="journal-pause-${this.journalId}" class="journal-btn journal-pause-btn" title="Pause updates">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="6" y="4" width="4" height="16"/>
                                <rect x="14" y="4" width="4" height="16"/>
                            </svg>
                            <span>Pause</span>
                        </button>
                        <span id="journal-pending-${this.journalId}" class="journal-pending hidden">0 pending</span>
                    </div>
                </div>
                <div class="journal-table-container" id="journal-container-${this.journalId}">
                    <div class="journal-table-wrapper" id="journal-wrapper-${this.journalId}">
                        <table class="journal-table">
                            <thead>
                                <tr>
                                    <th class="col-time">Time</th>
                                    <th class="col-type">Type</th>
                                    <th class="col-message">Message</th>
                                    <th class="col-code">Code</th>
                                    <th class="col-group">Group</th>
                                    <th class="col-name">Sensor</th>
                                    <th class="col-value">Value</th>
                                </tr>
                            </thead>
                            <tbody id="journal-tbody-${this.journalId}">
                                <tr class="journal-loading"><td colspan="7">Loading...</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="journal-resize-handle" id="journal-resize-${this.journalId}" title="Drag to resize"></div>
                </div>
                <div class="journal-footer">
                    <span id="journal-info-${this.journalId}" class="journal-info">Loading...</span>
                </div>
            </div>
        `;
    }

    async initialize() {
        this.bindEvents();
        this.setupInfiniteScroll();
        this.setupResize();
        this.setTimeRange(this.activeTimeRange);
        await Promise.all([
            this.loadMTypes(),
            this.loadMGroups()
        ]);
        await this.loadMessages();
    }

    bindEvents() {
        const pauseBtn = document.getElementById(`journal-pause-${this.journalId}`);
        const searchInput = document.getElementById(`journal-search-${this.journalId}`);
        const searchClear = document.getElementById(`journal-search-clear-${this.journalId}`);
        const mtypeSelect = document.getElementById(`journal-mtype-${this.journalId}`);
        const mgroupSelect = document.getElementById(`journal-mgroup-${this.journalId}`);

        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => this.togglePause());
        }

        // Live search with debounce
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    this.filters.search = searchInput.value;
                    this.offset = 0;
                    this.loadMessages();
                }, 300);
                // Show/hide clear button
                if (searchClear) {
                    searchClear.style.display = searchInput.value ? 'block' : 'none';
                }
            });

            // ESC to clear search
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    searchInput.value = '';
                    this.filters.search = '';
                    this.offset = 0;
                    this.loadMessages();
                    if (searchClear) searchClear.style.display = 'none';
                }
            });
        }

        // Clear search button
        if (searchClear) {
            searchClear.style.display = 'none';
            searchClear.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    this.filters.search = '';
                    this.offset = 0;
                    this.loadMessages();
                }
                searchClear.style.display = 'none';
            });
        }

        // Filter selects - apply on change
        if (mtypeSelect) {
            mtypeSelect.addEventListener('change', () => {
                this.filters.mtype = mtypeSelect.value;
                this.offset = 0;
                this.loadMessages();
            });
        }

        if (mgroupSelect) {
            mgroupSelect.addEventListener('change', () => {
                this.filters.mgroup = mgroupSelect.value;
                this.offset = 0;
                this.loadMessages();
            });
        }

        // Time range buttons
        const container = document.getElementById(this.containerId);
        if (container) {
            container.querySelectorAll('.journal-time-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const range = btn.dataset.range;
                    this.setTimeRange(range);
                    // Update active button
                    container.querySelectorAll('.journal-time-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.activeTimeRange = range;
                    this.offset = 0;
                    this.loadMessages();
                });
            });
        }
    }

    setTimeRange(range) {
        const now = new Date();
        let from = null;

        if (range === 'all') {
            this.filters.from = null;
            this.filters.to = null;
            return;
        }

        const multipliers = {
            '15m': 15 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '3h': 3 * 60 * 60 * 1000,
            '10h': 10 * 60 * 60 * 1000,
            '1d': 24 * 60 * 60 * 1000,
            '3d': 3 * 24 * 60 * 60 * 1000,
            '1w': 7 * 24 * 60 * 60 * 1000,
            '1M': 30 * 24 * 60 * 60 * 1000
        };

        if (multipliers[range]) {
            from = new Date(now.getTime() - multipliers[range]);
        }

        this.filters.from = from ? from.toISOString() : null;
        this.filters.to = null; // Always to now for real-time
    }

    setupInfiniteScroll() {
        const wrapper = document.getElementById(`journal-wrapper-${this.journalId}`);
        if (!wrapper) return;

        wrapper.addEventListener('scroll', () => {
            if (this.isLoading || !this.hasMore) return;

            const { scrollTop, scrollHeight, clientHeight } = wrapper;
            // Load more when scrolled to 80% of the content
            if (scrollTop + clientHeight >= scrollHeight * 0.8) {
                this.loadMore();
            }
        });
    }

    setupResize() {
        const handle = document.getElementById(`journal-resize-${this.journalId}`);
        const container = document.getElementById(`journal-container-${this.journalId}`);
        if (!handle || !container) return;

        let startY, startHeight;

        const onMouseMove = (e) => {
            const delta = e.clientY - startY;
            const newHeight = Math.max(150, Math.min(800, startHeight + delta));
            container.style.height = `${newHeight}px`;
            container.style.flex = 'none'; // Override flex: 1 to allow fixed height
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        handle.addEventListener('mousedown', (e) => {
            startY = e.clientY;
            startHeight = container.offsetHeight;
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    async loadMTypes() {
        try {
            const response = await fetch(`/api/journals/${this.journalId}/mtypes`);
            if (response.ok) {
                this.mtypes = await response.json();
                this.updateMTypeSelect();
            }
        } catch (err) {
            console.error('Failed to load mtypes:', err);
        }
    }

    async loadMGroups() {
        try {
            const response = await fetch(`/api/journals/${this.journalId}/mgroups`);
            if (response.ok) {
                this.mgroups = await response.json();
                this.updateMGroupSelect();
            }
        } catch (err) {
            console.error('Failed to load mgroups:', err);
        }
    }

    updateMTypeSelect() {
        const select = document.getElementById(`journal-mtype-${this.journalId}`);
        if (!select) return;

        select.innerHTML = '<option value="all">All types</option>';
        for (const mtype of this.mtypes) {
            const option = document.createElement('option');
            option.value = mtype;
            option.textContent = mtype;
            select.appendChild(option);
        }
    }

    updateMGroupSelect() {
        const select = document.getElementById(`journal-mgroup-${this.journalId}`);
        if (!select) return;

        select.innerHTML = '<option value="all">All groups</option>';
        for (const mgroup of this.mgroups) {
            const option = document.createElement('option');
            option.value = mgroup;
            option.textContent = mgroup;
            select.appendChild(option);
        }
    }

    async loadMessages(append = false) {
        if (this.isLoading) return;
        this.isLoading = true;

        const params = new URLSearchParams();
        params.set('limit', this.limit);
        params.set('offset', append ? this.offset : 0);

        if (this.filters.mtype !== 'all') {
            params.set('mtype', this.filters.mtype);
        }
        if (this.filters.mgroup !== 'all') {
            params.set('mgroup', this.filters.mgroup);
        }
        if (this.filters.search) {
            params.set('search', this.filters.search);
        }
        if (this.filters.from) {
            params.set('from', this.filters.from);
        }
        if (this.filters.to) {
            params.set('to', this.filters.to);
        }

        try {
            const response = await fetch(`/api/journals/${this.journalId}/messages?${params}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();

            if (append) {
                this.messages = [...this.messages, ...(data.messages || [])];
            } else {
                this.messages = data.messages || [];
                this.offset = 0;
            }

            this.total = data.total || 0;
            this.hasMore = this.messages.length < this.total;

            this.renderMessages();
            this.updateInfo();
        } catch (err) {
            console.error('Failed to load messages:', err);
            this.showError('Failed to load messages');
        } finally {
            this.isLoading = false;
        }
    }

    renderMessages() {
        const tbody = document.getElementById(`journal-tbody-${this.journalId}`);
        if (!tbody) return;

        if (this.messages.length === 0) {
            tbody.innerHTML = '<tr class="journal-empty"><td colspan="7">No messages</td></tr>';
            return;
        }

        tbody.innerHTML = this.messages.map(msg => this.renderMessageRow(msg)).join('');
    }

    renderMessageRow(msg) {
        const time = new Date(msg.timestamp);
        const today = new Date();
        const isToday = time.toDateString() === today.toDateString();

        const timeStr = time.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const dateStr = time.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit'
        });

        // Show date if not today
        const displayTime = isToday ? timeStr : `${dateStr} ${timeStr}`;

        const mtypeClass = this.getMTypeClass(msg.mtype);
        const searchTerm = this.filters.search;

        // Highlight search matches
        const highlightText = (text) => {
            if (!searchTerm || !text) return this.escapeHtml(text || '');
            const escaped = this.escapeHtml(text);
            const regex = new RegExp(`(${this.escapeRegex(searchTerm)})`, 'gi');
            return escaped.replace(regex, '<mark class="journal-highlight">$1</mark>');
        };

        return `
            <tr class="journal-row ${mtypeClass}">
                <td class="col-time" title="${time.toLocaleString('ru-RU')}">${displayTime}</td>
                <td class="col-type"><span class="journal-badge ${mtypeClass}">${this.escapeHtml(msg.mtype || '')}</span></td>
                <td class="col-message" title="${this.escapeHtml(msg.message || '')}">${highlightText(msg.message)}</td>
                <td class="col-code">${highlightText(msg.mcode)}</td>
                <td class="col-group">${highlightText(msg.mgroup)}</td>
                <td class="col-name" title="${this.escapeHtml(msg.name || '')}">${highlightText(msg.name)}</td>
                <td class="col-value">${msg.value !== undefined ? msg.value : ''}</td>
            </tr>
        `;
    }

    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    getMTypeClass(mtype) {
        const type = (mtype || '').toLowerCase();
        if (type === 'alarm' || type === 'emergancy') return 'journal-alarm';
        if (type === 'warning' || type === 'cauton') return 'journal-warning';
        if (type === 'normal') return 'journal-normal';
        if (type === 'blocking') return 'journal-blocking';
        return '';
    }

    updateInfo() {
        const info = document.getElementById(`journal-info-${this.journalId}`);
        if (info) {
            const showing = this.messages.length;
            if (this.total === 0) {
                info.textContent = 'No messages';
            } else {
                info.textContent = `Showing ${showing} of ${this.total}`;
            }
        }
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        const pauseBtn = document.getElementById(`journal-pause-${this.journalId}`);

        if (pauseBtn) {
            pauseBtn.classList.toggle('paused', this.isPaused);
            pauseBtn.querySelector('span').textContent = this.isPaused ? 'Resume' : 'Pause';
        }

        if (!this.isPaused && this.pendingMessages.length > 0) {
            this.addNewMessages(this.pendingMessages);
            this.pendingMessages = [];
            this.updatePendingCount();
        }
    }

    loadMore() {
        if (this.isLoading || !this.hasMore) return;
        this.offset = this.messages.length;
        this.loadMessages(true);
    }

    handleNewMessages(messages) {
        if (this.isPaused) {
            this.pendingMessages.push(...messages);
            this.updatePendingCount();
        } else {
            this.addNewMessages(messages);
        }
    }

    addNewMessages(messages) {
        const tbody = document.getElementById(`journal-tbody-${this.journalId}`);
        if (!tbody) return;

        const emptyRow = tbody.querySelector('.journal-empty');
        if (emptyRow) emptyRow.remove();

        for (const msg of messages) {
            // Check if message matches current filters
            if (!this.matchesFilters(msg)) continue;

            const row = document.createElement('tr');
            row.className = `journal-row ${this.getMTypeClass(msg.mtype)} journal-new`;
            row.innerHTML = this.renderMessageRowContent(msg);
            tbody.insertBefore(row, tbody.firstChild);

            setTimeout(() => row.classList.remove('journal-new'), 2000);
        }

        this.total += messages.length;
        this.updateInfo();
    }

    matchesFilters(msg) {
        if (this.filters.mtype !== 'all' && msg.mtype !== this.filters.mtype) return false;
        if (this.filters.mgroup !== 'all' && msg.mgroup !== this.filters.mgroup) return false;
        if (this.filters.search) {
            const search = this.filters.search.toLowerCase();
            const matchesName = (msg.name || '').toLowerCase().includes(search);
            const matchesMessage = (msg.message || '').toLowerCase().includes(search);
            const matchesCode = (msg.mcode || '').toLowerCase().includes(search);
            const matchesGroup = (msg.mgroup || '').toLowerCase().includes(search);
            if (!matchesName && !matchesMessage && !matchesCode && !matchesGroup) return false;
        }
        return true;
    }

    renderMessageRowContent(msg) {
        const time = new Date(msg.timestamp);
        const today = new Date();
        const isToday = time.toDateString() === today.toDateString();

        const timeStr = time.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const dateStr = time.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit'
        });

        const displayTime = isToday ? timeStr : `${dateStr} ${timeStr}`;
        const mtypeClass = this.getMTypeClass(msg.mtype);
        const searchTerm = this.filters.search;

        const highlightText = (text) => {
            if (!searchTerm || !text) return this.escapeHtml(text || '');
            const escaped = this.escapeHtml(text);
            const regex = new RegExp(`(${this.escapeRegex(searchTerm)})`, 'gi');
            return escaped.replace(regex, '<mark class="journal-highlight">$1</mark>');
        };

        return `
            <td class="col-time" title="${time.toLocaleString('ru-RU')}">${displayTime}</td>
            <td class="col-type"><span class="journal-badge ${mtypeClass}">${this.escapeHtml(msg.mtype || '')}</span></td>
            <td class="col-message" title="${this.escapeHtml(msg.message || '')}">${highlightText(msg.message)}</td>
            <td class="col-code">${highlightText(msg.mcode)}</td>
            <td class="col-group">${highlightText(msg.mgroup)}</td>
            <td class="col-name" title="${this.escapeHtml(msg.name || '')}">${highlightText(msg.name)}</td>
            <td class="col-value">${msg.value !== undefined ? msg.value : ''}</td>
        `;
    }

    updatePendingCount() {
        const pendingEl = document.getElementById(`journal-pending-${this.journalId}`);
        if (pendingEl) {
            const count = this.pendingMessages.length;
            pendingEl.textContent = `${count} pending`;
            pendingEl.classList.toggle('hidden', count === 0);
        }
    }

    showError(message) {
        const tbody = document.getElementById(`journal-tbody-${this.journalId}`);
        if (tbody) {
            tbody.innerHTML = `<tr class="journal-error"><td colspan="7">${this.escapeHtml(message)}</td></tr>`;
        }
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    destroy() {
        clearTimeout(this.searchDebounceTimer);
    }
}

// Journal Manager
class JournalManager {
    constructor() {
        this.journals = new Map();
        this.renderers = new Map();
        this.activeJournalId = null;
    }

    async loadJournals() {
        try {
            const response = await fetch('/api/journals');
            if (!response.ok) return [];

            const journals = await response.json();
            this.journals.clear();
            for (const j of journals) {
                this.journals.set(j.id, j);
            }
            return journals;
        } catch (err) {
            console.error('Failed to load journals:', err);
            return [];
        }
    }

    renderJournalsList(journals) {
        const list = document.getElementById('journals-list');
        const countEl = document.getElementById('journals-count');

        if (!list) return;

        if (journals.length === 0) {
            list.innerHTML = '<li class="journal-item-empty">No journals configured</li>';
            if (countEl) countEl.textContent = '0';
            return;
        }

        list.innerHTML = journals.map(j => `
            <li class="journal-item" data-id="${j.id}">
                <span class="journal-item-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10 9 9 9 8 9"/>
                    </svg>
                </span>
                <span class="journal-item-name">${this.escapeHtml(j.name)}</span>
                <span class="journal-item-status ${j.status}">${j.status}</span>
            </li>
        `).join('');

        if (countEl) countEl.textContent = journals.length;

        // Add click handlers
        list.querySelectorAll('.journal-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.id;
                this.openJournal(id);
            });
        });
    }

    openJournal(journalId) {
        const journal = this.journals.get(journalId);
        if (!journal) return;

        // Switch to journals view if not active
        switchView('journals');

        // Activate journal in sidebar
        document.querySelectorAll('.journal-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === journalId);
        });

        this.activeJournalId = journalId;

        // Get or create renderer
        let renderer = this.renderers.get(journalId);
        if (!renderer) {
            renderer = new JournalRenderer(journalId, journal.name);
            this.renderers.set(journalId, renderer);
        }

        // Render journal panel
        const content = document.getElementById('journals-content');
        if (content) {
            content.innerHTML = renderer.createPanelHTML();
            renderer.initialize();
        }
    }

    handleSSEMessage(data) {
        const { journalId, messages } = data;
        const renderer = this.renderers.get(journalId);
        if (renderer) {
            renderer.handleNewMessages(messages);
        }
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// Global journal manager instance
let journalManager = null;

// Global View Switcher
// All sidebar sections (Objects, Dashboards, Journals) are always visible
// Only the main content view changes
function switchView(viewName) {
    const objectsBtn = document.getElementById('view-objects-btn');
    const dashboardBtn = document.getElementById('view-dashboard-btn');
    const journalsBtn = document.getElementById('view-journals-btn');
    const objectsView = document.getElementById('objects-view');
    const dashboardView = document.getElementById('dashboard-view');
    const journalsView = document.getElementById('journals-view');
    const sidebar = document.getElementById('sidebar');
    const sidebarTitle = document.querySelector('.sidebar-title');

    // Reset all buttons
    objectsBtn?.classList.remove('active');
    dashboardBtn?.classList.remove('active');
    journalsBtn?.classList.remove('active');

    // Reset all views
    objectsView?.classList.remove('active');
    dashboardView?.classList.remove('active');
    journalsView?.classList.remove('active');

    // Activate selected view
    if (viewName === 'objects') {
        objectsBtn?.classList.add('active');
        objectsView?.classList.add('active');
        if (sidebarTitle) sidebarTitle.textContent = 'Navigation';
    } else if (viewName === 'dashboard') {
        dashboardBtn?.classList.add('active');
        dashboardView?.classList.add('active');
        if (sidebarTitle) sidebarTitle.textContent = 'Navigation';
        // Refresh dashboard widgets
        if (window.dashboardManager) {
            window.dashboardManager.refreshAllWidgets();
        }
    } else if (viewName === 'journals') {
        journalsBtn?.classList.add('active');
        journalsView?.classList.add('active');
        if (sidebarTitle) sidebarTitle.textContent = 'Navigation';
    }

    sidebar?.classList.remove('hidden');

    // Save current view to state
    if (typeof dashboardState !== 'undefined') {
        dashboardState.currentView = viewName;
    }
}

// Toggle journals section collapse
function toggleJournalsSection() {
    const section = document.getElementById('journals-section');
    if (!section) return;

    state.journalsSectionCollapsed = !state.journalsSectionCollapsed;
    section.classList.toggle('collapsed', state.journalsSectionCollapsed);
    saveSettings();
}

// Initialize journals on page load
async function initJournals() {
    journalManager = new JournalManager();
    const journals = await journalManager.loadJournals();

    const journalsSection = document.getElementById('journals-section');
    const journalsSectionHeader = document.getElementById('journals-section-header');
    const journalsBtn = document.getElementById('view-journals-btn');

    if (journals.length === 0) {
        // Hide journals section and button if no journals configured
        if (journalsSection) journalsSection.style.display = 'none';
        if (journalsBtn) journalsBtn.style.display = 'none';
    } else {
        // Show journals button and section, render the list
        if (journalsBtn) journalsBtn.style.display = '';
        if (journalsSection) {
            journalsSection.style.display = '';
            // Apply saved collapse state
            if (state.journalsSectionCollapsed) {
                journalsSection.classList.add('collapsed');
            }
        }
        journalManager.renderJournalsList(journals);
    }

    // Add click handler for journals section header collapse
    if (journalsSectionHeader && !journalsSectionHeader.dataset.listenerAdded) {
        journalsSectionHeader.addEventListener('click', toggleJournalsSection);
        journalsSectionHeader.dataset.listenerAdded = 'true';
    }

    // Add view switcher handler for journals
    if (journalsBtn) {
        journalsBtn.addEventListener('click', () => {
            switchView('journals');
        });
    }
}
