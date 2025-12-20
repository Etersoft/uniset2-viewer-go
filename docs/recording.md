# Recording (Запись истории)

Recording позволяет записывать историю изменений датчиков в SQLite базу данных для последующего анализа и экспорта.

## Возможности

- Динамическое включение/выключение записи через UI
- Запись всех типов датчиков: IONC, Modbus, OPCUA
- Циклический буфер с автоматической очисткой старых записей
- Экспорт в SQLite, CSV, JSON форматы
- Сохранение начальных значений при старте записи

## Конфигурация

### Флаги командной строки

| Флаг | По умолчанию | Описание |
|------|--------------|----------|
| `--recording-path` | `./recording.db` | Путь к файлу SQLite базы данных |
| `--recording-enabled` | `false` | Автоматический старт записи при запуске |
| `--max-records` | `1000000` | Максимальное количество записей (циклический буфер) |

### Пример запуска

```bash
# Стандартный запуск
./uniset-panel

# С автоматическим стартом записи
./uniset-panel --recording-enabled

# С кастомным путём и лимитом
./uniset-panel --recording-path /data/history.db --max-records 500000
```

### Docker Compose

```yaml
services:
  viewer:
    image: uniset-panel
    command: >
      --recording-path /data/recording.db
      --max-records 1000000
    volumes:
      - ./data:/data
```

## Использование UI

### Панель Recording

Панель Recording находится в правой части header, рядом с Control.

#### Состояние "Idle" (запись выключена)

![Recording Idle](images/recording-idle.png)

- Серый индикатор
- Кнопка "Record" для запуска записи
- Кнопка скачивания для экспорта (если есть данные)

#### Состояние "Recording" (запись активна)

![Recording Active](images/recording-active.png)

- Красный мигающий индикатор
- Счётчик записей и размер файла
- Кнопка "Stop" для остановки записи

#### После накопления данных

![Recording With Data](images/recording-with-data.png)

- Отображается количество записей (например, "412")
- Отображается размер файла (например, "112KB")

### Экспорт данных

Нажмите кнопку скачивания для открытия меню экспорта:

![Export Dropdown](images/recording-export-dropdown.png)

Доступные форматы:
- **SQLite Database (.db)** — полная копия базы данных
- **CSV Export (.csv)** — табличный формат
- **JSON Export (.json)** — структурированные данные

## API Endpoints

### Управление записью

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/recording/start` | POST | Начать запись |
| `/api/recording/stop` | POST | Остановить запись |
| `/api/recording/status` | GET | Получить статус и статистику |
| `/api/recording/clear` | DELETE | Очистить все записи |

### Экспорт

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/export/database` | GET | Скачать SQLite файл |
| `/api/export/csv` | GET | Экспорт в CSV |
| `/api/export/json` | GET | Экспорт в JSON |

### Примеры запросов

```bash
# Получить статус
curl http://localhost:8000/api/recording/status

# Ответ:
{
  "configured": true,
  "isRecording": true,
  "recordCount": 412,
  "sizeBytes": 114688,
  "oldestRecord": "2025-12-20T14:25:37.681025046Z",
  "newestRecord": "2025-12-20T14:25:44.727553042Z"
}

# Начать запись
curl -X POST http://localhost:8000/api/recording/start

# Остановить запись
curl -X POST http://localhost:8000/api/recording/stop

# Экспорт в JSON
curl http://localhost:8000/api/export/json > history.json

# Экспорт в CSV
curl http://localhost:8000/api/export/csv > history.csv

# Скачать SQLite базу
curl http://localhost:8000/api/export/database > recording.db
```

## Формат данных

### Структура записи

```json
{
  "serverId": "864153d2",
  "objectName": "SharedMemory",
  "variableName": "ionc:Sensor15099_S",
  "value": 42,
  "timestamp": "2025-12-20T14:25:37.681025046Z"
}
```

### Префиксы переменных

| Тип объекта | Префикс | Пример |
|-------------|---------|--------|
| IONC (IONotifyController) | `ionc:` | `ionc:AI_Temp_S` |
| Modbus (Master/Slave) | `mb:` | `mb:AI70_S` |
| OPCUA (Exchange/Server) | `ext:` | `ext:Temperature` |

### Схема SQLite

```sql
-- Таблица записей истории
CREATE TABLE recording (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL,
    object_name TEXT NOT NULL,
    variable_name TEXT NOT NULL,
    value TEXT NOT NULL,
    timestamp DATETIME NOT NULL
);

CREATE INDEX idx_recording_lookup
    ON recording(server_id, object_name, variable_name, timestamp);
CREATE INDEX idx_recording_timestamp
    ON recording(timestamp);

-- Таблица-справочник серверов
CREATE TABLE servers (
    server_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    updated_at DATETIME NOT NULL
);
```

### Структура таблицы servers

Таблица `servers` хранит метаданные о серверах для расшифровки `server_id` при анализе экспортированных данных:

| Поле | Тип | Описание |
|------|-----|----------|
| `server_id` | TEXT | Уникальный хэш-идентификатор сервера (PRIMARY KEY) |
| `name` | TEXT | Человекочитаемое имя сервера |
| `url` | TEXT | URL подключения к серверу |
| `updated_at` | DATETIME | Время последнего обновления записи (UTC, RFC3339) |

Пример данных:
```json
{
  "serverId": "77b5af18",
  "name": "UniSet Server 1",
  "url": "http://192.168.1.100:9090",
  "updatedAt": "2025-12-20T14:30:00.123456789Z"
}
```

## Циклический буфер

Recording использует циклический буфер для ограничения размера базы данных:

1. При каждой записи проверяется количество записей
2. Если превышен лимит (`--max-records`) + 10% буфер:
   - Удаляются 10% самых старых записей
   - Выполняется VACUUM для освобождения места

Пример: при `--max-records 1000000`:
- Очистка начинается при 1,100,000 записей
- Удаляется 100,000 старых записей
- Остаётся 1,000,000 записей

## Особенности работы

### Начальные значения

При старте записи автоматически сохраняются текущие значения всех подписанных датчиков. Это гарантирует, что история начинается с известного состояния.

### Батчевая запись

Изменения датчиков записываются батчами для оптимизации производительности:
- Один SQL transaction на batch
- ~10µs на запись (vs ~77µs при поштучной записи)

### Timestamps в UTC

Все timestamps хранятся в UTC формате RFC3339Nano:
```
2025-12-20T14:25:37.681025046Z
```

### WAL Mode

SQLite использует WAL (Write-Ahead Logging) режим для:
- Лучшей производительности записи
- Возможности читать данные во время записи
- Устойчивости к сбоям

## Регенерация скриншотов

Для обновления скриншотов документации:

```bash
cd tests
node generate-recording-screenshots.js
```

Требует запущенный dev-viewer:
```bash
docker-compose up dev-viewer -d
```
