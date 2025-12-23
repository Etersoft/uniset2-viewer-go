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
