# uniset-panel

Веб-сервер для мониторинга состояния uniset процессов, отслеживания изменений внутренних переменных во времени с отображением графиков.

Часть экосистемы [UniSet2](https://github.com/Etersoft/uniset2) — библиотеки для построения АСУ ТП.

⚠️ Проект пишется в качестве получения опыта создания ПО с помощью ИИ. Т.е. "just for fun"

## Возможности

- Получение списка доступных uniset объектов
- Просмотр внутренних переменных объекта в реальном времени
- Графики для аналоговых и дискретных величин (Chart.js)
- Хранение истории: in-memory или SQLite
- Единый исполняемый файл (веб-ресурсы встроены через go:embed)
- Расширяемая система рендереров — разный интерфейс для разных типов объектов
- Collapsible секции (графики, IO, переменные, статистика и др.)
- Сохранение настроек UI в localStorage
- **LogServer клиент** — просмотр логов процесса в реальном времени
- **SSE (Server-Sent Events)** — получение обновлений данных без polling
- **Recording** — запись истории изменений в SQLite с возможностью экспорта

## Скриншоты

### Мониторинг с графиками
![Главная страница](docs/images/main-page.png)

### Таблица сенсоров
![Сенсоры](docs/images/sensors-table.png)

### Modbus регистры
![Modbus](docs/images/modbus.png)

### LogServer
![Логи](docs/images/log-server.png)

### Режимы управления
| Control mode | Read-only mode |
|:---:|:---:|
| ![Control](docs/images/control.png) | ![Read-only](docs/images/read_only_mode.png) |

Подробнее: [docs/control.md](docs/control.md)

## Установка

```bash
go build -o uniset-panel ./cmd/server
```

## Запуск

```bash
./uniset-panel [опции]
```

### Параметры

| Параметр | По умолчанию | Описание |
|----------|--------------|----------|
| `--uniset-url` | `http://localhost:8080` | Адрес uniset HTTP API |
| `--port` | `8000` | Порт веб-сервера |
| `--poll-interval` | `5s` | Интервал опроса uniset |
| `--storage` | `memory` | Тип хранилища: `memory` или `sqlite` |
| `--sqlite-path` | `./history.db` | Путь к SQLite базе данных |
| `--history-ttl` | `1h` | Время хранения истории |
| `--log-format` | `text` | Формат логов: `text` или `json` |
| `--log-level` | `info` | Уровень логирования: `debug`, `info`, `warn`, `error` |
| `--uniset-config` | - | Путь к XML конфигурации uniset (для имён датчиков) |
| `--recording-path` | - | Путь к файлу записи (включает Recording) |
| `--recording-enabled` | `false` | Запись включена по умолчанию |
| `--max-records` | `1000000` | Максимальное количество записей (циклический буфер) |

### Примеры

```bash
# Базовый запуск
./uniset-panel --uniset-url http://192.168.1.100:8080

# С SQLite хранилищем
./uniset-panel --uniset-url http://192.168.1.100:8080 --storage sqlite --sqlite-path /var/lib/uniset-viewer/history.db

# С кастомным интервалом опроса
./uniset-panel --uniset-url http://192.168.1.100:8080 --poll-interval 2s
```

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (HTML/JS)                      │
│  ┌──────────────┐  ┌──────────────────────────────────────┐ │
│  │ Список       │  │ Вкладка объекта                      │ │
│  │ объектов     │  │ - таблица переменных                 │ │
│  │              │  │ - графики Chart.js                   │ │
│  └──────────────┘  └──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 uniset-panel (Go Server)               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ HTTP Server │  │ UniSet      │  │ Storage             │  │
│  │ (REST API)  │  │ Client      │  │ (memory/sqlite)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  uniset процессы (HTTP API)                │
│   /api/v2/list          - список объектов                   │
│   /api/v2/{Object}      - данные объекта                    │
│   /api/v2/{Object}/help - доступные команды                 │
└─────────────────────────────────────────────────────────────┘
```

Документация UniSet2 HTTP API: https://etersoft.github.io/uniset2/

## Структура проекта

```
uniset-panel/
├── cmd/server/main.go       # точка входа
├── internal/
│   ├── config/              # конфигурация
│   ├── uniset/              # HTTP клиент к uniset
│   ├── storage/             # хранилище истории
│   ├── poller/              # периодический опрос
│   ├── api/                 # REST API сервера + SSE
│   ├── logger/              # structured logging (slog)
│   ├── logserver/           # TCP клиент к LogServer uniset
│   ├── sensorconfig/        # парсер XML конфигурации датчиков
│   └── recording/           # система записи истории в SQLite
├── ui/
│   ├── embed.go             # go:embed + go:generate директивы
│   ├── concat.go            # скрипт сборки app.js
│   ├── static/
│   │   ├── js/
│   │   │   ├── app.js       # генерируется автоматически
│   │   │   └── src/         # исходные модули (00-*.js ... 99-*.js)
│   │   └── css/
│   └── templates/           # HTML шаблоны
├── tests/                   # Playwright e2e тесты
├── go.mod
└── README.md
```

## LogServer

Для объектов с включённым LogServer (указан host и port в ответе API) доступен просмотр логов в реальном времени:

- Подключение через кнопку "Подключить" в секции "Логи"
- Выбор уровня логов (По умолчанию, CRIT, WARN+, INFO+, DEBUG+, ALL)
- Фильтрация по regexp
- Изменяемый размер окна (перетаскивание за нижнюю границу)
- Сворачивание секции

**Важно:** При выборе "По умолчанию" используются уровни логов, установленные в процессе. Для получения логов может потребоваться выбрать конкретный уровень.

## Recording

Система записи истории позволяет сохранять все изменения переменных в SQLite базу данных для последующего анализа и экспорта.

Подробная документация: **[docs/recording.md](docs/recording.md)**

## Разработка

### Сборка JavaScript

Frontend код (`ui/static/js/app.js`) генерируется автоматически из модулей в `ui/static/js/src/`.

```bash
# Пересобрать app.js из модулей
make app

# Полная сборка (app.js + бинарник)
make build

# Или через go generate
go generate ./ui
```

### Структура модулей

Файлы нумеруются для контроля порядка конкатенации:

| Диапазон | Категория | Содержимое |
|----------|-----------|------------|
| 00-09 | Core | state, SSE, control, recording |
| 10-19 | Renderers base | BaseObjectRenderer, mixins, simple renderers |
| 20-29 | Specific renderers | IONC, OPCUA, Modbus, UWSGate |
| 30-39 | Components | LogViewer |
| 40-49 | UI | Charts, dialogs |
| 50-59 | UI | Tabs, render functions, sections, settings |
| 60-69 | Dashboard | Widgets, manager, dialogs |
| 99 | Init | DOMContentLoaded |

### Добавление нового модуля

1. Создать файл `ui/static/js/src/XX-name.js` с подходящим номером
2. Запустить `make app` для регенерации app.js
3. Проверить сборку: `make build`

**Важно:** Не редактировать `ui/static/js/app.js` напрямую — он перезаписывается при сборке.

## Лицензия

MIT
