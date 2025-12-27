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
    sensorValuesCache: new Map(), // sensorName -> { value, error, timestamp } - cache for dashboard init
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
