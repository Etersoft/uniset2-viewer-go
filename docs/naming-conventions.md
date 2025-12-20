# Naming Conventions for UI Elements

## Key Identifiers

### 1. tabKey
**Format:** `${serverId}:${objectName}` (e.g., `77b5af18:MBSlave1`)

**Used for:**
- `state.tabs.get(tabKey)` - accessing tab state
- `data-name` attribute on tab panels and buttons
- `moveSectionUp(tabKey, sectionId)` / `moveSectionDown(tabKey, sectionId)`
- `loadSectionOrder(tabKey)` / `saveSectionOrder(tabKey)`
- `openSensorDialog(tabKey)`
- Anywhere that needs to uniquely identify a tab across multiple servers

**Why:** The same object name can exist on different servers, so `tabKey` ensures uniqueness.

### 2. objectName / displayName
**Format:** Just the object name (e.g., `MBSlave1`)

**Used for:**
- API endpoints: `/api/objects/${objectName}/...`
- DOM element IDs: `${prefix}-${objectName}` (e.g., `mbs-status-MBSlave1`)
- `data-section` attributes: `${sectionId}-${objectName}` (e.g., `charts-MBSlave1`)
- `toggleSection(sectionId)` where sectionId includes objectName
- `restoreCollapsedSections(objectName)`
- `this.objectName` in renderers

**Why:** Object names are human-readable and are used for display purposes.

### 3. serverId
**Format:** Hash string (e.g., `77b5af18`) or special constant

**Used for:**
- Part of `tabKey`
- `data-server-id` attributes
- Server connection tracking

**Special values:**
- `"sm"` - SharedMemory events (defined as `SM_SERVER_ID` in frontend, `SharedMemoryServerID` in backend)

### 4. sectionId (within sections)
**Format:** `${prefix}-${objectName}` (e.g., `charts-MBSlave1`, `mbs-status-MBSlave1`)

**Used for:**
- `data-section` attribute on collapsible sections
- `toggleSection(sectionId)` function
- localStorage key for collapsed state

## Renderer Properties

In `BaseObjectRenderer` and subclasses:

```javascript
class BaseObjectRenderer {
    constructor(objectName, tabKey = null) {
        this.objectName = objectName;        // e.g., "MBSlave1"
        this.tabKey = tabKey || objectName;  // e.g., "77b5af18:MBSlave1"
    }
}
```

## DOM Element ID Patterns

### Section Elements
```
id="${prefix}-section-${objectName}"      // e.g., "charts-section-MBSlave1"
data-section="${prefix}-${objectName}"    // e.g., "charts-MBSlave1"
data-section-id="${prefix}"               // e.g., "charts" (for reordering)
```

### Table Elements
```
id="${prefix}-${objectName}"              // e.g., "mbs-registers-tbody-MBSlave1"
```

### Status Elements
```
id="${prefix}-status-last-${objectName}"  // e.g., "mbslave-status-last-MBSlave1"
```

### Chart Elements
```
id="chart-${tabKey}-${varName}"           // e.g., "chart-77b5af18:MBSlave1-mb:AI70_S"
```

## Function Parameter Conventions

### Functions that take tabKey
These functions need to identify a specific tab across servers:
- `state.tabs.get(tabKey)`
- `moveSectionUp(tabKey, sectionId)` / `moveSectionDown(tabKey, sectionId)`
- `loadSectionOrder(tabKey)` / `saveSectionOrder(tabKey)`
- `openSensorDialog(tabKey)`
- `closeTab(tabKey)`
- `activateTab(tabKey)`

### Functions that take objectName
These functions operate within a single object's context:
- `restoreCollapsedSections(objectName)`
- `toggleSection(sectionId)` where sectionId = `${prefix}-${objectName}`
- API fetch functions

## localStorage Keys

| Key | Format | Description |
|-----|--------|-------------|
| `uniset-panel-collapsed` | `{sectionId: boolean}` | Collapsed state of sections |
| `uniset-panel-section-order` | `{tabKey: [sectionIds]}` | Order of sections per tab |
| `uniset-panel-pinned-*` | `{objectName: [ids]}` | Pinned sensors per object |

## SSE Events and Charts

### Chart varName Format
**Format:** `${prefix}:${sensor.name}` (e.g., `mb:AI70_S`, `ext:Temperature`)

Charts are identified by `varName` which combines a prefix and sensor name:

| Object Type | Prefix | Example varName |
|-------------|--------|-----------------|
| ModbusMaster | `mb` | `mb:AI70_S` |
| ModbusSlave | `mb` | `mb:AI70_S` |
| OPCUAExchange | `ext` | `ext:Temperature` |
| OPCUAServer | `ext` | `ext:Temperature` |
| IONotifyController | `io` | `io:AI_Temperature_S` |

**Important:** Both ModbusMaster and ModbusSlave use the same prefix `mb`.

### Chart Storage
```javascript
tabState.charts.get(varName)  // Map<varName, ChartData>
```

### SSE Event Types and Data Format

| Event Type | Object Types | Data Field | Key Fields |
|------------|--------------|------------|------------|
| `modbus_register_batch` | ModbusMaster, ModbusSlave | `registers[]` | `id`, `name`, `value` |
| `opcua_sensor_batch` | OPCUAExchange, OPCUAServer | `sensors[]` | `id`, `name`, `value` |
| `sensor_batch` | IONotifyController | `sensors[]` | `id`, `name`, `value` |

### SSE Handler Chart Update Pattern

When processing SSE events, match registers/sensors to charts:

```javascript
// For Modbus events (modbus_register_batch)
for (const reg of registers) {
    const varName = `mb:${reg.name}`;  // NOT reg.id!
    const chartData = tabState.charts.get(varName);
    if (chartData) {
        chartData.chart.data.datasets[0].data.push({ x: timestamp, y: reg.value });
    }
}

// For OPCUA events (opcua_sensor_batch)
for (const sensor of sensors) {
    const varName = `ext:${sensor.name}`;  // NOT sensor.id!
    const chartData = tabState.charts.get(varName);
    if (chartData) {
        chartData.chart.data.datasets[0].data.push({ x: timestamp, y: sensor.value });
    }
}
```

### Chart Creation (getChartOptions)

Each renderer defines `getChartOptions()` which returns the prefix:

```javascript
// ModbusMasterRenderer and ModbusSlaveRenderer
getChartOptions() {
    return { prefix: 'mb', ... };
}

// OPCUAExchangeRenderer and OPCUAServerRenderer
getChartOptions() {
    return { prefix: 'ext', ... };
}

// IONCRenderer
getChartOptions() {
    return { prefix: 'io', ... };
}
```

### SSE Subscription Flow

1. **Subscribe:** `POST /api/objects/${objectName}/.../subscribe` with `{ ids: [...] }`
2. **Backend poller:** Polls data at `pollInterval`, detects changes
3. **Broadcast:** Sends SSE event with changed values
4. **Frontend handler:** Updates tables and charts using correct `varName` format

### Server ID Constants

For events that don't come from a regular UniSet2 server:

| Location | Constant | Value | Purpose |
|----------|----------|-------|---------|
| Frontend (app.js) | `SM_SERVER_ID` | `"sm"` | SharedMemory events |
| Backend (sse.go) | `SharedMemoryServerID` | `"sm"` | SharedMemory events |

### Common SSE/Chart Mistakes

1. **Wrong varName format:** Using `${prefix}-${id}` instead of `${prefix}:${name}`
2. **Wrong prefix:** Using `mbreg` or `mbsreg` instead of `mb`
3. **Using id instead of name:** Charts use sensor name, not numeric id
4. **Missing chart update in SSE handler:** Only updating tables, forgetting charts

## Common Mistakes to Avoid

1. **Don't use tabKey for data-section attributes** - Use objectName
2. **Don't use objectName for state.tabs access** - Use tabKey
3. **Don't mix sectionId formats** - Always use `${prefix}-${objectName}`
4. **Don't hardcode objectName in generated HTML** - Use `this.objectName`

## Example: Correct Usage

```javascript
// Creating a section
createSection('mbs-status', `Status for ${this.objectName}`, {
    sectionId: `mbs-status-section-${this.objectName}`,  // ID for DOM
});

// In generated HTML
`<div data-section="mbs-status-${this.objectName}"       // For toggleSection
      onclick="toggleSection('mbs-status-${this.objectName}')">`

// For section reordering
`onclick="moveSectionUp('${this.tabKey}', 'mbs-status')"`  // tabKey for unique identification

// For localStorage persistence
restoreCollapsedSections(displayName);  // Use displayName, not tabKey
loadSectionOrder(tabKey);               // Use tabKey for unique identification
```
