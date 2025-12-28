# Журнал сообщений (Journal)

Компонент для отображения сообщений из базы данных ClickHouse с фильтрацией и real-time обновлениями через SSE.

## Быстрый старт

### 1. Запуск с параметром командной строки

```bash
./uniset-panel --journal-url "clickhouse://localhost:9000/uniset"
```

### 2. Запуск с конфигурационным файлом

```yaml
# config.yaml
journals:
  - url: "clickhouse://localhost:9000/uniset"
    name: "Production"
```

```bash
./uniset-panel --config config.yaml
```

## Формат URL

```
clickhouse://[user:password@]host:port/database[?param=value]
```

**Примеры:**
```
clickhouse://localhost:9000/uniset
clickhouse://user:pass@192.168.1.50:9000/logs
clickhouse://localhost:9000/uniset?table=my_messages
```

**Query параметры:**
- `table` - имя таблицы с сообщениями (по умолчанию: `main_messages_src`)
- `name` - отображаемое имя журнала

## Структура таблицы ClickHouse

### Основная таблица сообщений

```sql
CREATE TABLE main_messages_src
(
    timestamp DateTime64(9, 'UTC'),  -- Время сообщения
    value     Float64,                -- Значение датчика
    name      String,                 -- Имя датчика
    message   String,                 -- Текст сообщения
    mtype     String,                 -- Тип: Alarm|Warning|Normal|Emergancy|Cauton|Blocking
    mgroup    String,                 -- Группа сообщений
    mcode     String                  -- Код сообщения
) ENGINE = MergeTree()
ORDER BY (timestamp, name);
```

### Пример с MaterializedView (рекомендуется)

Для интеграции с историей значений UniSet2:

```sql
-- Словарь сообщений
CREATE TABLE dict_messages_src
(
    id         UInt32,
    sensorname String,
    value      Float64,
    message    String,
    mtype      String,
    mgroup     String,
    mcode      String
) ENGINE = MergeTree()
ORDER BY id;

-- Словарь для быстрого поиска
CREATE DICTIONARY dict_messages
(
    id         UInt32,
    sensorname String,
    value      Float64,
    message    String,
    mtype      String,
    mgroup     String,
    mcode      String
)
PRIMARY KEY id
SOURCE(CLICKHOUSE(TABLE 'dict_messages_src' DB 'uniset'))
LIFETIME(MIN 30 MAX 60)
LAYOUT(HASHED());

-- MaterializedView для автоматического формирования сообщений
CREATE MATERIALIZED VIEW main_messages_src
ENGINE = MergeTree
ORDER BY (timestamp, name)
AS SELECT
    timestamp,
    value,
    name,
    dictGetOrDefault('dict_messages', 'message', msg_hid, '') AS message,
    dictGetOrDefault('dict_messages', 'mtype', msg_hid, 'Normal') AS mtype,
    dictGetOrDefault('dict_messages', 'mgroup', msg_hid, '') AS mgroup,
    dictGetOrDefault('dict_messages', 'mcode', msg_hid, '') AS mcode
FROM main_history
WHERE dictHas('dict_messages', murmurHash2_32(concat(name, toString(toInt64(value)))));
```

### Пример данных словаря

```csv
id,sensorname,value,message,mtype,mgroup,mcode
1,Temperature_S,100,Temperature exceeded 100°C,Alarm,Environment,A001
2,Temperature_S,0,Temperature back to normal,Normal,Environment,N001
3,Pressure_S,50,Pressure warning,Warning,Safety,W001
```

## Возможности UI

### Фильтрация
- **Тип сообщения** - выпадающий список (Alarm, Warning, Normal и т.д.)
- **Группа** - выпадающий список
- **Текстовый поиск** - live-поиск с подсветкой совпадений (ESC для очистки)

### Временной диапазон
Быстрые кнопки: 15m | 1h | 3h | 10h | 1d | 3d | 1w | 1M | All

### Real-time обновления
- Новые сообщения приходят через SSE
- Кнопка Pause/Resume для приостановки обновлений
- Счётчик накопленных сообщений при паузе

### Infinite Scroll
- Автоматическая подгрузка при прокрутке
- Изменяемый размер области таблицы

## API

### GET /api/journals
Список доступных журналов.

```json
[
  {
    "id": "b7cf98ab",
    "name": "Production",
    "status": "connected"
  }
]
```

### GET /api/journals/{id}/messages
Получить сообщения с фильтрацией.

**Query параметры:**
- `from` - начало периода (ISO 8601)
- `to` - конец периода (ISO 8601)
- `mtype` - фильтр по типу
- `mgroup` - фильтр по группе
- `search` - текстовый поиск
- `limit` - лимит записей (default: 100)
- `offset` - смещение для пагинации

```json
{
  "messages": [
    {
      "timestamp": "2024-01-15T10:30:00Z",
      "value": 105.5,
      "name": "Temperature_S",
      "message": "Temperature exceeded",
      "mtype": "Alarm",
      "mgroup": "Environment",
      "mcode": "A001"
    }
  ],
  "total": 1234
}
```

### GET /api/journals/{id}/mtypes
Список типов сообщений.

### GET /api/journals/{id}/mgroups
Список групп сообщений.

## SSE Events

Новые сообщения приходят через SSE endpoint `/api/sse`:

```json
{
  "type": "journal_message",
  "journalId": "b7cf98ab",
  "messages": [...]
}
```

## Docker Compose

```yaml
services:
  clickhouse:
    image: clickhouse/clickhouse-server:24.3
    ports:
      - "9000:9000"
      - "8123:8123"
    volumes:
      - ./clickhouse/init.sql:/docker-entrypoint-initdb.d/init.sql

  uniset-panel:
    image: uniset-panel
    ports:
      - "8000:8000"
    environment:
      - JOURNAL_URL=clickhouse://clickhouse:9000/uniset
    depends_on:
      - clickhouse
```

## Конфигурация в YAML

```yaml
journals:
  # Минимальная конфигурация
  - url: "clickhouse://localhost:9000/uniset"
    name: "Production"

  # Полная конфигурация
  - url: "clickhouse://192.168.1.50:9000/logs"
    name: "Test Environment"
    table: "custom_messages_table"
    database: "logs"
```

## Типы сообщений (mtype)

| Тип | Описание | Цвет |
|-----|----------|------|
| Alarm | Аварийное сообщение | Красный |
| Emergancy | Экстренное сообщение | Тёмно-красный |
| Warning | Предупреждение | Оранжевый |
| Cauton | Внимание | Жёлтый |
| Normal | Нормальное состояние | Зелёный |
| Blocking | Блокировка | Синий |
