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

