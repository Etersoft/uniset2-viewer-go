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

