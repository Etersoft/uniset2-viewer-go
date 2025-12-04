# TODO - UniSet2 Viewer

## UI улучшения

### Графики и шкала времени
- [x] Шкала времени: начало с момента добавления первого графика, ширина = выбранный интервал
- [x] При добавлении последующих датчиков шкала не меняется
- [x] Когда графики доезжают до конца - смещение на 90% (настраиваемый параметр)
- [x] Дополнительные временные интервалы: 1m, 3m, 3h

### Внешний вид
- [x] Техно-шрифт для заголовка "UniSet2 Viewer"
- [x] textname датчика в шапку графика
- [x] textname в таблицы входов/выходов
- [x] Подсветка состояния LogServer: RUNNING (зелёный), STOPPED (красный)

### Новые разделы (collapsible)
- [x] Раздел "Информация об объекте" (object) - внизу
- [x] Раздел "Статистика" (Statistics) с таблицей сенсоров (ID, имя, срабатывания) и фильтром
- [x] Раздел "Таймеры" (Timers) - рядом с входами/выходами (динамическая информация)
- [x] Раздел "LogServer" (если есть в ответе)

### Сохранение состояния
- [x] Сохранение состояния спойлеров в localStorage

### Архитектура рендереров
- [x] Расширяемая система рендереров по objectType
- [x] BaseObjectRenderer — базовый класс
- [x] UniSetManagerRenderer — полный функционал (IO, Timers, Variables, Statistics, LogServer)
- [x] UniSetObjectRenderer — упрощённый вид (без IO/Timers)
- [x] Badge с типом объекта на вкладке

## В работе

### Внешние датчики из SharedMemory (SM)

**Цель:** Добавить возможность добавлять на графики датчики из конфига проекта, получая значения через HTTP API объекта SharedMemory.

**Архитектура:**
```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│   Browser   │────▶│  uniset2-viewer │────▶│     SM       │
│   (UI)      │◀────│    (Go server)  │◀────│  /get?...    │
└─────────────┘ SSE └─────────────────┘     └──────────────┘
```

**SM API:** `GET /api/v01/SharedMemory/get?id1,name2,id3&shortInfo`

Ответ (shortInfo):
```json
{
  "object": {"id": 5003, "name": "SharedMemory", "objectType": "IONotifyController", ...},
  "sensors": [
    {"id": 100, "name": "AI100_AS", "value": 0, "real_value": 0, "tv_sec": 1764866261, "tv_nsec": 952434117},
    {"error": "not found", "name": "unknown_sensor"}
  ]
}
```

#### Этап 1: UI — Диалог выбора датчиков
- [x] Кнопка "Добавить датчик" в `createChartsSection()` (в заголовке секции "Графики")
- [x] HTML/CSS модального окна
- [x] Загрузка списка датчиков через `GET /api/sensors` (+ fallback на `/api/sm/sensors`)
- [x] Фильтрация по name, textname, iotype
- [x] Обработка ESC: 1-й раз — сброс фильтра + убрать фокус, 2-й раз — закрытие окна
- [x] Сохранение выбранных датчиков в localStorage (`uniset2-viewer-external-sensors-{objectName}`)
- [x] Восстановление датчиков при открытии вкладки
- [x] Endpoint `/api/sm/sensors` для загрузки датчиков из SharedMemory

#### Этап 2: Backend — SM интеграция
- [x] Config (`internal/config/config.go`):
  - `--sm-url` — URL SharedMemory API (по умолчанию пусто = отключено)
  - `--sm-poll-interval` — интервал опроса SM (по умолчанию как poll-interval)
- [x] SM клиент (`internal/sm/client.go`):
  - `GetValues(names []string) (map[string]SensorValue, error)` — запрос к `/get?...&shortInfo`
  - Парсинг ответа SM
- [x] API endpoints (`internal/api/handlers.go`):
  - `POST /api/objects/{name}/external-sensors` — подписка `{sensors: ["name1", "name2"]}`
  - `DELETE /api/objects/{name}/external-sensors/{sensor}` — отписка
  - `GET /api/objects/{name}/external-sensors` — список подписанных с текущими значениями
- [x] SM Poller (`internal/sm/poller.go`):
  - Периодический опрос SM для подписанных датчиков
  - Отправка данных через SSE (event type `"sensor_data"`)
- [x] Сохранение истории в storage (для графиков и выгрузки)

#### Этап 3: UI — Графики внешних датчиков
- [x] Обработка SSE события `sensor_data`
- [x] Создание графиков для внешних датчиков (как для обычных переменных)
- [x] Восстановление подписок при загрузке страницы (из localStorage → POST subscribe)
- [x] Кнопка удаления внешнего датчика с графика

#### Этап 4: Тесты
- [x] Playwright тесты для UI (`tests/external-sensors.spec.ts`):
  - Отображение кнопки "+ Датчик"
  - Открытие/закрытие модального окна
  - Фильтрация датчиков
  - ESC handling (очистка фильтра, закрытие)
  - Добавление/удаление датчика
  - Сохранение в localStorage
- [x] Go тесты для SM клиента (`internal/sm/client_test.go`)
- [x] Go тесты для SM poller (`internal/sm/poller_test.go`)
- [x] Go тесты для External Sensors API (`internal/api/handlers_test.go`)

**Привязка:** Датчики привязываются к конкретной вкладке/объекту (не глобально).

**История:** Да, для графиков и возможности выгрузки.

---

### LogServer клиент (чтение логов в реальном времени)

**Цель:** Подключение к LogServer UniSet2 для чтения и отображения логов в UI.

**Протокол:** TCP, бинарное сообщение lsMessage (131 байт):
- magic: 20201222, cmd: команда, data: уровень, logname: regexp фильтр

**Этапы:**
- [x] `internal/logserver/types.go` - структура Message, команды, константы
- [x] `internal/logserver/client.go` - TCP клиент с auto-reconnect (5-10 сек)
- [x] `internal/logserver/client_test.go` - unit-тесты
- [x] `internal/logserver/manager.go` - менеджер клиентов (один на объект)
- [x] API endpoints:
  - [x] `GET /api/logs/{object}/stream` - SSE поток логов
  - [x] `POST /api/logs/{object}/command` - отправка команды
  - [x] `GET /api/logs/{object}/status` - статус подключения
  - [x] `GET /api/logs/status` - статусы всех подключений
- [x] Интеграция в `cmd/server/main.go`
- [x] UI: LogViewer компонент (terminal-like, 2000 строк буфер)
- [x] CSS стили для логов
- [x] UI: Опция "По умолчанию" в уровне логов (без отправки setLevel)
- [x] UI: Сообщение "Ожидание сообщений..." при подключении без логов
- [x] Backend: НЕ отправлять setLevel автоматически при подключении
- [x] Backend: Корректное закрытие TCP соединения при отключении SSE стрима

**Решения:**
- Reconnect: автоматический с задержкой 5-10 сек
- Фильтрация: на сервере через cmdFilterMode
- Буфер UI: 2000 строк
- setLevel: отправляется только при выборе уровня пользователем (не автоматически)

### UI исправления (текущая сессия)
- [x] Переименовать "Переменные" в "Настройки"
- [x] LogServer: исправить проверку RUNNING (опечатка RUNNIG в API)
- [x] Таймеры: добавить столбец tick
- [x] Входы/Выходы: добавить столбец textname
- [x] Графики: добавить textname в шапку панели графика
- [x] SSE: реализовать Server-Sent Events для realtime обновлений
  - [x] Backend: endpoint `/api/events` с SSE stream
  - [x] Backend: отправка событий при изменении данных объектов (через callback в poller)
  - [x] UI: подписка на SSE вместо polling
  - [x] UI: fallback на polling при отсутствии SSE (автоматическое переключение)
  - [x] Go unit-тесты для SSE (sse_test.go, poller_test.go)

### SSE улучшения
- [ ] Индикатор состояния SSE соединения в UI (connected/reconnecting/polling)
- [ ] Отображение времени polling в UI

### Тестирование
- [ ] Playwright e2e тесты на SSE функциональность
- [ ] Playwright тесты на fallback к polling при недоступности SSE
- [x] Playwright тесты на рендереры объектов (fallback renderer для UniSetActivator)
- [x] Playwright тесты для LogViewer UI:
  - [x] Отображение секции "Логи" при наличии LogServer
  - [x] Кнопка подключения, placeholder до подключения
  - [x] Dropdown выбора уровней логов с pills
  - [x] Resize handle
  - [x] Сворачивание/разворачивание секции

### LogViewer улучшения (по образцу logdb-websocket.html)
- [x] Dropdown выбора уровней логов — pills для каждого уровня, пресеты
- [x] Локальная фильтрация с подсветкой (Regex, Case, Только совпадения)
- [x] Экспорт логов в файл (кнопка скачивания)
- [x] Настройка размера буфера (500-10000)
- [x] Счётчики: текущее/максимум, количество совпадений
- [x] Горячие клавиши: "/" для фокуса на фильтр, Esc для очистки

### Информация об объекте
- [x] Первой строкой выводить: "Потеряно сообщений: xxx | Макс. размер очереди: yyy"
- [x] Остальные параметры после этого

### Таймеры
- [x] Оставшееся время (timeleft) должно постоянно обновляться (локальный интервал 100мс)
- [x] Исправить отображение tick (tick=-1 означает бесконечный таймер, отображается как "∞")
- [x] Добавлен прогресс-бар для timeleft

### Типы объектов
- [x] Fallback-рендерер: выводить сырой JSON и сообщение "тип объекта не поддерживается"
- [ ] Проработать отображение для других типов объектов
- [ ] Документировать API рендереров для расширения

### UI исправления (в очереди)
- [x] textname: приоритет справочник, потом comment из API
- [x] LogServer: добавить все параметры (sessMaxCount, список сессий)
- [x] Переменные не вошедшие в io/Variables выводить в разделе Настройки
- [x] Входы/Выходы: столбец описание разместить в конце
- [x] Потеряно > 0 подсвечивать жёлтым (warning)

### Архитектура
- [ ] Обсудить: сервер возвращает сырой JSON, парсинг на UI (сервер не знает формат полей)

## Данные от процесса

Структура ответа `/api/v01/{object}/`:
```json
{
  "TestProc": {
    "LogServer": { "host", "port", "state", "info": {...} },
    "Statistics": { "processingMessageCatchCount", "sensors": {...} },
    "Timers": { "1": { "id", "msec", "name", "tick", "timeleft" }, "count" },
    "Variables": { ... },
    "io": {
      "in": { ... },
      "out": { ... }
    },
    "myFloatVar": 42.42,
    "myMessage": "...",
    "myMode": "RUNNING",
    "myVar": 42
  },
  "object": {
    "id": 6000,
    "isActive": true,
    "lostMessages": 0,
    "maxSizeOfMessageQueue": 1000,
    "msgCount": 0,
    "name": "TestProc",
    "objectType": "UniSetManager"
  }
}
```

## Выполнено

- [x] Убрать заголовок таблицы легенды графика и вынести в шапку
- [x] Выбор цвета при клике на квадратик в легенде графика
- [x] Фильтрация переменных по имени с поддержкой ESC
- [x] Спойлеры (collapsible) для секций
- [x] Шкала времени на фиксированный интервал
- [x] Сворачиваемая боковая панель до значков
- [x] Дискретные графики без заливки по умолчанию
- [x] Чекбокс "фон" для включения/отключения заливки графика
- [x] Сохранение настроек интерфейса в localStorage (timeRange, sidebarCollapsed)
