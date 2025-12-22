# Исследование: Графики не обновляются при сворачивании браузера

## Проблема

При запуске "генерирования значений" и сворачивании браузера в системный трей на ~5 минут, графики перестают обновляться (после развёртывания браузера).

## Что уже проверено

### 1. SSE события продолжают приходить ✓
Тест `tests/debug/test-sse-visibility.js` показал, что SSE события от сервера продолжают поступать даже когда страница в hidden состоянии. Это ожидаемо - SSE это server-push, не зависит от состояния браузера.

### 2. Код не обрабатывает visibilitychange
Поиск по коду показал, что нет обработки события `visibilitychange`. Весь код использует:
- `setInterval` для генератора значений (throttled в hidden)
- `requestAnimationFrame` для обновления UI (не выполняется в hidden)

### 3. Места использования requestAnimationFrame
Найдено в рендерерах:
- `ui/static/js/src/10-base-renderer.js`
- `ui/static/js/src/20-ionc-renderer.js`
- `ui/static/js/src/21-opcua-exchange.js`
- `ui/static/js/src/22-modbus-master.js`
- `ui/static/js/src/23-modbus-slave.js`
- `ui/static/js/src/24-opcua-server.js`

Используется в `batchRenderUpdates()` для оптимизации отрисовки.

## Гипотеза

Когда браузер свёрнут:
1. `requestAnimationFrame` не вызывается (браузер оптимизация)
2. Обновления UI накапливаются
3. Когда страница становится visible, накопленные `requestAnimationFrame` могут не выполниться корректно

## Что нужно проверить

### Тест 1: Обновление графиков при изменении данных на сервере
Файл: `tests/debug/test-chart-visibility.js`

Этот тест изменяет данные через API (не JS в браузере), чтобы изолировать проблему:
1. Открыть SharedMemory
2. Включить график
3. Менять значения через `http://localhost:9393/api/v2/SharedMemory/set`
4. Эмулировать hidden состояние
5. Продолжать менять значения
6. Вернуть visible
7. Проверить, обновился ли график

### Тест 2: Ручной тест с реальным сворачиванием
Файл: `tests/debug/debug-generator-visibility.js`

Требует ручного участия:
1. Скрипт открывает браузер
2. Пользователь сворачивает окно в трей
3. Ждёт 2-3 минуты
4. Разворачивает
5. Скрипт проверяет пропуски в данных

## Возможные решения (если проблема подтвердится)

### Вариант A: Обработка visibilitychange
```javascript
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // Принудительно обновить все графики
        state.tabs.forEach(tabState => {
            tabState.charts.forEach(chartData => {
                chartData.chart.update();
            });
        });
    }
});
```

### Вариант B: Использовать setTimeout вместо requestAnimationFrame для hidden
Проверять `document.hidden` перед использованием `requestAnimationFrame`:
```javascript
function scheduleUpdate(callback) {
    if (document.hidden) {
        setTimeout(callback, 16);
    } else {
        requestAnimationFrame(callback);
    }
}
```

### Вариант C: Очередь обновлений
Накапливать обновления в очередь, применять при visible:
```javascript
const pendingUpdates = [];
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        pendingUpdates.forEach(fn => fn());
        pendingUpdates.length = 0;
    }
});
```

## Файлы для редактирования

| Файл | Что менять |
|------|------------|
| `ui/static/js/src/04-sse.js` | Обработка visibilitychange для SSE подключения |
| `ui/static/js/src/10-base-renderer.js` | batchRenderUpdates с учётом visibility |
| `ui/static/js/src/40-charts.js` | Обновление графиков при visible |
| `ui/static/js/src/20-ionc-renderer.js` | Generator visibility handling |

## Созданные тестовые файлы

- `tests/debug/test-sse-visibility.js` - проверка SSE при visibility change (работает)
- `tests/debug/test-generator-visibility.js` - проверка генератора (требует SharedMemory с сенсорами)
- `tests/debug/test-chart-visibility.js` - проверка графиков с изменениями на сервере
- `tests/debug/debug-generator-visibility.js` - ручной тест

## Команды для продолжения

```bash
# Запустить mock-сервер
docker-compose up viewer -d

# Проверить что сервер работает
curl http://localhost:8000/api/objects

# Запустить тест графиков
cd tests && node debug/test-chart-visibility.js
```

## Статус

**РЕШЕНО**: Реализован fix в `ui/static/js/app.js` (ветка story/fix-hidden-update)

### Что было сделано

1. Тест `test-chart-visibility.js` показал что:
   - SSE события приходят стабильно независимо от visibility (70→210→70)
   - Данные добавляются в массивы Chart.js напрямую через `data.push()` — **не теряются**
   - Проблема: `chart.update()` не отрисовывает canvas когда страница hidden

2. Добавлен обработчик `visibilitychange` в `app.js` (после функции closeSSE()):
   - При переходе `hidden → visible` принудительно вызывает `chart.update()` для всех графиков
   - Синхронизирует временную шкалу через `syncAllChartsTimeRange()`

3. Тест с реальным IONC сервером `test-visibility-real.js`:
   - До hidden: 51 точка
   - После hidden (15 сек): 102 точки — данные накапливались!
   - После +5 сек visible: 117 точек — график обновляется

### Ответ на вопрос о накоплении данных

Данные **не теряются** — они накапливаются в массивах `chart.data.datasets[0].data`.
Лимит 1000 точек на график. При возврате из hidden все накопленные данные отрисовываются.

### Canvas селектор

**Важно:** Canvas элементы графиков создаются с ID вида `canvas-${objectName}-${safeVarName}` без класса `chart-canvas`. Для поиска использовать селектор:
```javascript
document.querySelectorAll('canvas[id^="canvas-"]')
```
