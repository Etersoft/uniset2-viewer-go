/**
 * Demo Mock Server - Diesel Generator Simulator
 *
 * Implements standard UniSet2 API with IONC (IONotifyController) object.
 * The generator simulator updates sensor values in real-time.
 */

const http = require('http');
const sensors = require('./sensors');
const { dg1, dg2, scenario } = require('./generators');

const PORT = process.env.PORT || 9393;
const OBJECT_NAME = 'DemoGenerator';
const SERVER_ID = 'demo';

// SSE clients
const sseClients = new Set();

// Object metadata
const objectData = {
    [OBJECT_NAME]: {
        LogServer: {
            host: 'localhost',
            port: 5003,
            state: 'RUNNING',
            info: {
                host: 'localhost',
                name: 'localhost:5003',
                port: 5003,
                sessMaxCount: 10,
                sessions: []
            }
        },
        Variables: {},
        io: { in: {}, out: {} }
    },
    object: {
        id: 1000,
        isActive: true,
        lostMessages: 0,
        maxSizeOfMessageQueue: 1000,
        msgCount: 0,
        name: OBJECT_NAME,
        objectType: 'UniSetObject',
        extensionType: 'IONotifyController'
    }
};

// HTTP Server
const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    res.setHeader('Content-Type', 'application/json');

    const url = req.url;
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const path = urlObj.pathname;

    // Route handling
    if (path === '/api/v2/list') {
        // List of objects
        res.end(JSON.stringify([OBJECT_NAME, 'SharedMemory']));

    } else if (path === `/api/v2/${OBJECT_NAME}`) {
        // Object data
        res.end(JSON.stringify(objectData));

    } else if (path === '/api/v2/SharedMemory') {
        // SharedMemory object data
        res.end(JSON.stringify({
            object: {
                id: 2000,
                name: 'SharedMemory',
                isActive: true,
                objectType: 'UniSetObject',
                extensionType: 'SharedMemory'
            }
        }));

    } else if (path === '/api/v2/SharedMemory/sensors') {
        // SharedMemory sensors - same as IONC with filtering
        const offset = parseInt(urlObj.searchParams.get('offset') || '0');
        const limit = parseInt(urlObj.searchParams.get('limit') || '100');
        const search = (urlObj.searchParams.get('search') || '').toLowerCase();
        const result = sensors.getSensorsFiltered({ offset, limit, search });
        res.end(JSON.stringify({
            sensors: result.sensors,
            size: result.count,
            offset: result.offset,
            limit: result.limit
        }));

    } else if (path === `/api/v2/${OBJECT_NAME}/sensors`) {
        // IONC sensors list with pagination and filtering
        const offset = parseInt(urlObj.searchParams.get('offset') || '0');
        const limit = parseInt(urlObj.searchParams.get('limit') || '100');
        const search = (urlObj.searchParams.get('search') || '').toLowerCase();
        const iotype = (urlObj.searchParams.get('iotype') || '').toUpperCase();

        const result = sensors.getSensorsFiltered({
            offset,
            limit,
            search,
            iotype: iotype === 'ALL' ? '' : iotype
        });

        res.end(JSON.stringify({
            sensors: result.sensors,
            size: result.count,
            offset: result.offset,
            limit: result.limit
        }));

    } else if (path === `/api/v2/${OBJECT_NAME}/get`) {
        // Get sensor values by filter (comma-separated IDs)
        const filter = urlObj.searchParams.get('filter') || '';

        let sensorList;
        if (filter === '*') {
            // Return all sensors
            sensorList = sensors.getAllSensors();
        } else {
            // Return specific sensors by ID
            const sensorIds = filter.split(',').filter(Boolean).map(Number);
            sensorList = sensorIds.map(id => {
                const sensor = sensors.getSensorById(id);
                if (sensor) {
                    return sensor;
                }
                return { id, name: `Unknown_${id}`, value: 0 };
            });
        }

        res.end(JSON.stringify({
            sensors: sensorList.map(s => ({
                id: s.id,
                name: s.name,
                value: s.value,
                real_value: s.value,
                frozen: s.frozen || false,
                blocked: s.blocked || false
            }))
        }));

    } else if (path === `/api/v2/${OBJECT_NAME}/set`) {
        // Set sensor value
        // Format: /api/v2/DemoGenerator/set?supplier=...&{id}={value}
        for (const [key, value] of urlObj.searchParams) {
            if (key !== 'supplier') {
                const sensorId = parseInt(key, 10);
                const newValue = parseFloat(value);
                if (!isNaN(sensorId) && !isNaN(newValue)) {
                    sensors.setSensorById(sensorId, newValue);
                }
            }
        }
        res.end(JSON.stringify({ result: 'OK' }));

    } else if (path === `/api/v2/${OBJECT_NAME}/lost`) {
        // Lost consumers
        res.end(JSON.stringify({ 'lost consumers': [] }));

    } else if (path === `/api/v2/${OBJECT_NAME}/consumers`) {
        // Sensor consumers
        const sensorsParam = urlObj.searchParams.get('sensors') || '';
        const sensorIds = sensorsParam.split(',').filter(s => s).map(Number);
        const result = sensorIds.map(id => {
            const sensor = sensors.getSensorById(id);
            return {
                id: id,
                name: sensor ? sensor.name : `Unknown_${id}`,
                consumers: []
            };
        });
        res.end(JSON.stringify({ sensors: result }));

    } else if (path === '/api/events') {
        // SSE endpoint
        handleSSE(req, res);

    } else if (path === '/api/v2/version' || path === '/api/version') {
        // Version info
        res.end(JSON.stringify({
            version: '1.0.0',
            name: 'Demo Mock Server',
            description: 'Diesel Generator Simulator'
        }));

    } else if (path === '/health' || path === '/api/health') {
        // Health check
        res.end(JSON.stringify({ status: 'ok' }));

    } else if (path === '/api/sm/sensors') {
        // SharedMemory sensors endpoint - return all sensors
        const allSensors = sensors.getAllSensors();
        res.end(JSON.stringify({
            sensors: allSensors.map(s => ({
                id: s.id,
                name: s.name,
                value: s.value,
                real_value: s.value,
                type: s.type
            }))
        }));

    } else if (path === '/demo/status') {
        // Demo-specific: generator status
        res.end(JSON.stringify({
            dg1: dg1.getStateInfo(),
            dg2: dg2.getStateInfo()
        }));

    } else if (path === '/demo/control') {
        // Demo-specific: control generators
        const action = urlObj.searchParams.get('action');
        const gen = urlObj.searchParams.get('gen') || 'dg1';
        const generator = gen === 'dg2' ? dg2 : dg1;

        switch (action) {
            case 'start':
                generator.start();
                break;
            case 'stop':
                generator.stop();
                break;
            case 'setload':
                const load = parseInt(urlObj.searchParams.get('load') || '50');
                generator.setLoad(load);
                break;
            case 'alarm':
                generator.triggerAlarm('manual');
                break;
            case 'clear':
                generator.clearAlarm();
                break;
        }
        res.end(JSON.stringify({ result: 'OK', state: generator.getStateInfo() }));

    } else if (path === '/demo/scenario') {
        // Demo-specific: scenario control
        const action = urlObj.searchParams.get('action');

        switch (action) {
            case 'pause':
                scenario.pause();
                break;
            case 'resume':
                scenario.resume();
                break;
            case 'next':
                scenario.skipToNext();
                break;
            case 'restart':
                scenario.restart();
                break;
        }
        res.end(JSON.stringify(scenario.getStatus()));

    } else {
        // Not found
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found', path }));
    }
});

/**
 * Handle SSE connection
 */
function handleSSE(req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Send initial connected event
    const connectedEvent = {
        type: 'connected',
        serverId: SERVER_ID,
        serverName: 'Demo Server',
        timestamp: new Date().toISOString()
    };
    res.write(`event: connected\ndata: ${JSON.stringify(connectedEvent)}\n\n`);

    // Send objects list
    const objectsEvent = {
        type: 'objects_list',
        serverId: SERVER_ID,
        data: [OBJECT_NAME],
        timestamp: new Date().toISOString()
    };
    res.write(`event: objects_list\ndata: ${JSON.stringify(objectsEvent)}\n\n`);

    // Add to clients
    sseClients.add(res);
    console.log(`SSE client connected. Total: ${sseClients.size}`);

    // Handle disconnect
    req.on('close', () => {
        sseClients.delete(res);
        console.log(`SSE client disconnected. Total: ${sseClients.size}`);
    });
}

/**
 * Broadcast SSE event to all clients
 */
function broadcastSSE() {
    if (sseClients.size === 0) return;

    const sensorData = sensors.getSensorsForSSE();

    const event = {
        type: 'ionc_sensor_batch',
        serverId: SERVER_ID,
        serverName: 'Demo Server',
        objectName: OBJECT_NAME,
        data: sensorData,
        timestamp: new Date().toISOString()
    };

    const message = `event: ionc_sensor_batch\ndata: ${JSON.stringify(event)}\n\n`;

    for (const client of sseClients) {
        try {
            client.write(message);
        } catch (err) {
            console.error('SSE write error:', err.message);
            sseClients.delete(client);
        }
    }
}

// SSE broadcast interval
const SSE_INTERVAL = 500; // ms
setInterval(broadcastSSE, SSE_INTERVAL);

// Start server
server.listen(PORT, () => {
    console.log(`Demo Mock Server running on port ${PORT}`);
    console.log(`Object: ${OBJECT_NAME}`);
    console.log(`Sensors: ${sensors.getAllSensors().length}`);
    console.log(`SSE broadcast interval: ${SSE_INTERVAL}ms`);
    console.log('');
    console.log('Demo scenario will start automatically in 1 second');
    console.log('Cycle duration: ~5 minutes, runs infinitely');
    console.log('');
    console.log('Control endpoints:');
    console.log(`  GET /demo/status - Generator status`);
    console.log(`  GET /demo/scenario - Scenario status`);
    console.log(`  GET /demo/scenario?action=pause - Pause scenario`);
    console.log(`  GET /demo/scenario?action=resume - Resume scenario`);
    console.log(`  GET /demo/scenario?action=next - Skip to next phase`);
    console.log(`  GET /demo/scenario?action=restart - Restart scenario`);
});
