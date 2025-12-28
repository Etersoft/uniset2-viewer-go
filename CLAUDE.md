# Claude Code Guidelines

## Testing

E2E тесты (Playwright) запускаются через docker-compose:

```bash
# Запуск всех тестов
make js-tests

# Перед запуском остановить dev-профиль (если запущен)
docker-compose --profile dev down
```

Не запускать тесты напрямую через `npx playwright test` — это может вызвать проблемы с окружением и портами.

## Development Server

```bash
# Запуск dev-сервера
docker-compose up dev-viewer -d --build

# Dev-сервер доступен на http://localhost:8000
# Подключается к реальным UniSet2 серверам на портах 9090, 9191, 9292, 9393, 9494, 9595, 9696
```

ВАЖНО: Запускать именно `docker-compose up dev-viewer`, а не `docker-compose --profile dev up`, чтобы избежать конфликта портов между сервисами dev-viewer и viewer (оба используют порт 8000).

## Build

```bash
# Сборка бинарника
go build -o uniset-panel ./cmd/server

# Сборка через make
make build
```

## JavaScript модули

**ВАЖНО:** Файл `ui/static/js/app.js` генерируется автоматически из модулей в `ui/static/js/src/`. НЕ редактировать app.js напрямую!

### После изменений в JS-файлах

```bash
# Пересобрать app.js после любых изменений в src/
make app

# Или полная сборка (app + бинарник)
make build
```

### Структура модулей

Файлы нумеруются для контроля порядка конкатенации (зависимости):

| Диапазон | Категория | Что размещать |
|----------|-----------|---------------|
| 00-09 | Core | Глобальный state, константы, SSE, control token, recording |
| 10-19 | Base renderers | BaseObjectRenderer, mixins, простые рендереры |
| 20-29 | Specific renderers | IONC, OPCUA, Modbus, UWSGate рендереры |
| 30-39 | Components | LogViewer и другие самостоятельные компоненты |
| 40-49 | Charts/Dialogs | Графики, модальные окна |
| 50-59 | UI functions | Табы, секции, настройки, render-функции |
| 99 | Init | DOMContentLoaded, инициализация |

### Правила размещения кода

- **Новый рендерер** → `2X-renderer-name.js`
- **Новая утилита** → `01-utils.js` или создать `0X-name.js`
- **Изменение SSE** → `04-sse.js`
- **Новый UI компонент** → `5X-ui-name.js`

## Debugging UI

Для отладки проблем с UI (особенно с SSE, подписками, сетевыми запросами) используй Playwright скрипты вместо ручного тестирования в браузере.

**Почему Playwright:**
- Перехватывает все HTTP запросы/ответы (включая те, что не отображаются в Network tab)
- Захватывает console.log из браузера
- Автоматизирует сценарии взаимодействия
- Позволяет инспектировать состояние приложения программно

**Пример отладочного скрипта:**

```javascript
// tests/debug-something.js
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const page = await browser.newPage();

  // Перехват запросов
  page.on('request', request => {
    if (request.url().includes('subscribe')) {
      console.log('>> REQUEST:', request.method(), request.url());
      console.log('   POST data:', request.postData());
    }
  });

  page.on('response', async response => {
    if (response.url().includes('subscribe')) {
      console.log('<< RESPONSE:', response.status(), response.url());
      console.log('   Body:', await response.text());
    }
  });

  // Захват console.log
  page.on('console', msg => {
    console.log('BROWSER:', msg.text());
  });

  await page.goto('http://localhost:8000');

  // ... сценарий взаимодействия ...

  // Инспекция состояния
  const state = await page.evaluate(() => {
    return window.state?.someProperty;
  });
  console.log('State:', state);

  await page.waitForTimeout(60000); // Держим браузер открытым
  await browser.close();
})();
```

**Запуск:**

```bash
cd tests
node debug-something.js
```

**Важно:** Скрипт должен находиться в `tests/`, где доступен `@playwright/test` из node_modules.

## UI Naming Conventions

При работе с кодом UI (`ui/static/js/app.js`) соблюдать следующие правила именования:

### Ключевые идентификаторы

| Идентификатор | Формат | Пример | Использование |
|--------------|--------|--------|---------------|
| `tabKey` | `${serverId}:${objectName}` | `77b5af18:MBSlave1` | Уникальный ключ вкладки для `state.tabs`, `moveSectionUp/Down`, `loadSectionOrder` |
| `objectName` | имя объекта | `MBSlave1` | API endpoints, DOM ID элементов, `data-section` атрибуты, `toggleSection` |
| `serverId` | хэш или константа | `77b5af18`, `sm` | Идентификация сервера |
| `sectionId` | `${prefix}-${objectName}` | `charts-MBSlave1` | `data-section` атрибут, `toggleSection` |

### Правила использования

1. **`tabKey` использовать для:**
   - `state.tabs.get(tabKey)` - доступ к состоянию вкладки
   - `moveSectionUp(tabKey, sectionId)` / `moveSectionDown(tabKey, sectionId)`
   - `loadSectionOrder(tabKey)` / `saveSectionOrder(tabKey)`
   - Атрибут `data-name` на панелях вкладок

2. **`objectName` использовать для:**
   - API endpoints: `/api/objects/${objectName}/...`
   - DOM ID элементов: `${prefix}-${objectName}`
   - `data-section` атрибуты: `${prefix}-${objectName}`
   - `toggleSection(sectionId)` и `restoreCollapsedSections(objectName)`

3. **В рендерерах:**
   ```javascript
   this.objectName  // имя объекта (MBSlave1)
   this.tabKey      // полный ключ (77b5af18:MBSlave1)
   ```

4. **`serverId` в состоянии вкладки:**
   ```javascript
   // Получение serverId из состояния вкладки
   const tabState = state.tabs.get(this.tabKey);
   const serverId = tabState?.serverId || '';  // Важно: serverId (не serverID!)

   // Формирование параметра для API запроса
   const serverParam = serverId ? `server=${encodeURIComponent(serverId)}` : '';
   ```
   **ВАЖНО:** В `state.tabs` используется `serverId` (camelCase с маленькой буквой d), а не `serverID`.

### SSE и графики (Charts)

Графики идентифицируются через `varName` в формате `${prefix}:${sensor.name}`:

| Тип объекта | Prefix | Пример varName |
|-------------|--------|----------------|
| ModbusMaster, ModbusSlave | `mb` | `mb:AI70_S` |
| OPCUAExchange, OPCUAServer | `ext` | `ext:Temperature` |
| IONotifyController | `io` | `io:AI_Temp_S` |

**При обработке SSE событий для обновления графиков:**
```javascript
// Modbus: modbus_register_batch
const varName = `mb:${reg.name}`;  // НЕ reg.id!
const chartData = tabState.charts.get(varName);

// OPCUA: opcua_sensor_batch
const varName = `ext:${sensor.name}`;  // НЕ sensor.id!
const chartData = tabState.charts.get(varName);
```

### Константы serverId

| Место | Константа | Значение | Назначение |
|-------|-----------|----------|------------|
| Frontend (app.js) | `SM_SERVER_ID` | `"sm"` | SharedMemory события |
| Backend (sse.go) | `SharedMemoryServerID` | `"sm"` | SharedMemory события |

### Поиск DOM элементов

При поиске элементов внутри вкладок использовать `getElementInTab()` вместо `document.getElementById()`:

```javascript
// ✅ ПРАВИЛЬНО - ищет элемент внутри панели конкретной вкладки
const fillCheckbox = getElementInTab(tabKey, `fill-${displayName}-${varName}`);

// ❌ НЕПРАВИЛЬНО - может найти элемент из другой вкладки с тем же ID
const fillCheckbox = document.getElementById(`fill-${displayName}-${varName}`);
```

**Почему важно:**
- При работе с несколькими серверами может быть несколько объектов с одинаковым именем (например, `SharedMemory` на разных серверах)
- `getElementById` найдёт первый элемент с таким ID, который может принадлежать другой вкладке
- `getElementInTab` сначала находит панель вкладки по `tabKey`, затем ищет элемент внутри неё

**Доступные функции:**
```javascript
// Найти один элемент по ID внутри вкладки
getElementInTab(tabKey, elementId)

// Найти все элементы по CSS-селектору внутри вкладки
getElementsInTab(tabKey, selector)
```

### Единообразие UI элементов

Одинаковые элементы интерфейса должны использовать одинаковые CSS классы и HTML структуру во всех рендерерах:

| Элемент | CSS класс | HTML структура |
|---------|-----------|----------------|
| Pin toggle | `pin-toggle`, `pin-toggle.pinned` | `<span class="pin-toggle" data-name="...">○/📌</span>` |
| Pin column | `col-pin` | `<th class="col-pin">...</th>` |
| Chart toggle | `chart-toggle`, `chart-toggle-input`, `chart-toggle-label` | Input + Label с SVG иконкой |
| Pinned row | `*-sensor-pinned` или `*-register-pinned` | Class на `<tr>` |

**Правило:** При добавлении нового рендерера или нового UI элемента проверь существующие рендереры и используй те же классы и структуру.

### Частые ошибки

- **НЕ** использовать `tabKey` для `data-section` атрибутов (использовать `objectName`)
- **НЕ** использовать `objectName` для `state.tabs` (использовать `tabKey`)
- **НЕ** путать форматы `sectionId` - всегда `${prefix}-${objectName}`
- **НЕ** использовать `id` для varName графиков - использовать `name`
- **НЕ** использовать разные prefixes для ModbusMaster/Slave - оба используют `mb`
- **НЕ** использовать `document.getElementById()` для элементов внутри вкладок (использовать `getElementInTab()`)
- **НЕ** создавать новые стили для одинаковых элементов - использовать существующие общие классы

Полная документация: `docs/naming-conventions.md`
