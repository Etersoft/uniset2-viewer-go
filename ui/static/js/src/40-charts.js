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

