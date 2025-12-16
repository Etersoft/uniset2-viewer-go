const http = require('http');

const PORT = process.env.PORT || 9394;
const SERVER_NAME = process.env.SERVER_NAME || 'Server2';

// Mock data for second server - different objects
const objects = ['Server2Controller', 'BackupProcess', 'SM2', 'OPCUAClient2'];

// Mock sensors for SM2 (IONotifyController)
const mockSensors = [];
for (let i = 1; i <= 50; i++) {
  const types = ['AI', 'DI', 'AO', 'DO'];
  mockSensors.push({
    id: 1000 + i,
    name: `S2_Sensor${i}`,
    type: types[i % 4],
    value: Math.floor(Math.random() * 500),
    frozen: i % 10 === 0,
    blocked: i % 15 === 0,
    readonly: i % 5 === 0,
    undefined: false
  });
}

// SM2 data (IONotifyController)
const sm2Data = {
  SM2: {
    LogServer: {
      host: 'server2-sm-loghost',
      port: 7002,
      state: 'RUNNING',
      info: {
        host: 'server2-sm-loghost',
        name: 'server2-sm-loghost:7002',
        port: 7002,
        sessMaxCount: 5,
        sessions: []
      }
    }
  },
  object: {
    id: 7002,
    isActive: true,
    lostMessages: 0,
    maxSizeOfMessageQueue: 500,
    msgCount: 0,
    name: 'SM2',
    objectType: 'IONotifyController'
  }
};

// OPCUAClient2 data (OPCUAExchange)
const opcua2Params = {
  polltime: 500,
  updatetime: 500,
  reconnectPause: 15000,
  timeoutIterate: 0,
  exchangeMode: 0,
  writeToAllChannels: 0,
  currentChannel: 0,
  connectCount: 1,
  activated: 1,
  iolistSize: 20,
  httpControlAllow: 1,
  httpControlActive: 0,
  errorHistoryMax: 50
};

const opcua2Status = {
  result: 'OK',
  status: {
    subscription: { enabled: true, items: 5 },
    iolist_size: 20,
    monitor: 'OK',
    httpEnabledSetParams: true,
    httpControlAllow: true,
    httpControlActive: false,
    errorHistorySize: 0,
    errorHistoryMax: 50,
    channels: [
      { index: 0, status: 'OK', ok: true, addr: 'opc.tcp://server2:48010' }
    ]
  }
};

const opcua2Sensors = [];
const sensorTypes = ['AI', 'AO', 'DI', 'DO'];
const vtypes = { AI: 'Double', AO: 'Double', DI: 'Bool', DO: 'Bool' };

for (let i = 1; i <= 30; i++) {
  const iotype = sensorTypes[(i - 1) % 4];
  const isAnalog = iotype.startsWith('A');
  opcua2Sensors.push({
    id: 2000 + i,
    name: `S2_${iotype}${String(i).padStart(3, '0')}_OPC`,
    iotype: iotype,
    value: isAnalog ? (100.5 + i * 0.2) : (i % 2),
    tick: 20 + i,
    vtype: vtypes[iotype],
    precision: isAnalog ? 2 : 0,
    status: 'OK',
    nodeid: `ns=3;s=Server2.${iotype}.Item${i}`
  });
}

const opcua2Diagnostics = {
  result: 'OK',
  summary: {
    reconnects: 0,
    errors: 0,
    warnings: 0
  },
  lastErrors: [],
  errorHistoryMax: 50,
  errorHistorySize: 0
};

const opcuaClient2Data = {
  OPCUAClient2: {
    LogServer: {
      host: 'server2-opcua-loghost',
      port: 7003,
      state: 'RUNNING',
      info: {
        host: 'server2-opcua-loghost',
        name: 'server2-opcua-loghost:7003',
        port: 7003,
        sessMaxCount: 5,
        sessions: []
      }
    },
    params: opcua2Params
  },
  object: {
    id: 7003,
    isActive: true,
    lostMessages: 0,
    maxSizeOfMessageQueue: 200,
    msgCount: 0,
    name: 'OPCUAClient2',
    objectType: 'OPCUAExchange'
  }
};

const server2ControllerData = {
  Server2Controller: {
    LogServer: {
      host: 'server2-loghost',
      port: 7000,
      state: 'RUNNING',
      info: {
        host: 'server2-loghost',
        name: 'server2-loghost:7000',
        port: 7000,
        sessMaxCount: 10,
        sessions: []
      }
    },
    Variables: {
      serverName: 'Server2Controller',
      status: 'active',
      uptime: '3600',
      version: '2.0.0'
    },
    type: 'UniSetObject'
  }
};

const backupProcessData = {
  BackupProcess: {
    LogServer: {
      host: 'backup-loghost',
      port: 7001,
      state: 'RUNNING',
      info: {
        host: 'backup-loghost',
        name: 'backup-loghost:7001',
        port: 7001,
        sessMaxCount: 5,
        sessions: []
      }
    },
    Variables: {
      processName: 'BackupProcess',
      lastBackup: '2024-01-15T10:30:00',
      interval: '3600',
      enabled: '1'
    },
    type: 'UniSetObject'
  }
};

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = req.url;

  // List objects
  if (url === '/api/v2/list') {
    res.writeHead(200);
    res.end(JSON.stringify(objects));
    return;
  }

  // Get object data
  if (url === '/api/v2/Server2Controller') {
    res.writeHead(200);
    res.end(JSON.stringify(server2ControllerData));
    return;
  }

  if (url === '/api/v2/BackupProcess') {
    res.writeHead(200);
    res.end(JSON.stringify(backupProcessData));
    return;
  }

  // SM2 (IONotifyController) endpoints
  if (url === '/api/v2/SM2') {
    res.writeHead(200);
    res.end(JSON.stringify(sm2Data));
    return;
  }

  if (url === '/api/v2/SM2/sensors' || url.startsWith('/api/v2/SM2/sensors?')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0');
    const limit = parseInt(urlObj.searchParams.get('limit') || '100');

    const paginatedSensors = mockSensors.slice(offset, offset + limit);
    res.writeHead(200);
    res.end(JSON.stringify({
      sensors: paginatedSensors,
      size: mockSensors.length,
      offset: offset,
      limit: limit
    }));
    return;
  }

  // SM2 get sensor value
  const getSensorMatch = url.match(/^\/api\/v2\/SM2\/get\?id=(\d+)$/);
  if (getSensorMatch) {
    const id = parseInt(getSensorMatch[1]);
    const sensor = mockSensors.find(s => s.id === id);
    if (sensor) {
      res.writeHead(200);
      res.end(JSON.stringify({ id, value: sensor.value, result: 'OK' }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Sensor not found' }));
    }
    return;
  }

  // SM2 set/freeze/unfreeze (GET handlers - actual UniSet2 API format)
  if (url.startsWith('/api/v2/SM2/set?')) {
    res.writeHead(200);
    res.end(JSON.stringify({ result: 'OK' }));
    return;
  }

  if (url.startsWith('/api/v2/SM2/freeze?')) {
    res.writeHead(200);
    res.end(JSON.stringify({ result: 'OK' }));
    return;
  }

  if (url.startsWith('/api/v2/SM2/unfreeze?')) {
    res.writeHead(200);
    res.end(JSON.stringify({ result: 'OK' }));
    return;
  }

  // SM2 set/freeze/unfreeze (POST handlers - for backward compatibility)
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (url === '/api/v2/SM2/set') {
        res.writeHead(200);
        res.end(JSON.stringify({ result: 'OK' }));
        return;
      }
      if (url === '/api/v2/SM2/freeze') {
        res.writeHead(200);
        res.end(JSON.stringify({ result: 'OK' }));
        return;
      }
      if (url === '/api/v2/SM2/unfreeze') {
        res.writeHead(200);
        res.end(JSON.stringify({ result: 'OK' }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });
    return;
  }

  // SM2 consumers
  if (url.startsWith('/api/v2/SM2/consumers/')) {
    res.writeHead(200);
    res.end(JSON.stringify({ consumers: [] }));
    return;
  }

  if (url.startsWith('/api/v2/SM2/lostconsumers/')) {
    res.writeHead(200);
    res.end(JSON.stringify({ lost: [] }));
    return;
  }

  // OPCUAClient2 (OPCUAExchange) endpoints
  if (url === '/api/v2/OPCUAClient2') {
    res.writeHead(200);
    res.end(JSON.stringify(opcuaClient2Data));
    return;
  }

  if (url === '/api/v2/OPCUAClient2/opcua/params') {
    res.writeHead(200);
    res.end(JSON.stringify({ result: 'OK', params: opcua2Params }));
    return;
  }

  if (url === '/api/v2/OPCUAClient2/opcua/status') {
    res.writeHead(200);
    res.end(JSON.stringify(opcua2Status));
    return;
  }

  if (url === '/api/v2/OPCUAClient2/opcua/sensors' || url.startsWith('/api/v2/OPCUAClient2/opcua/sensors?')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0');
    const limit = parseInt(urlObj.searchParams.get('limit') || '100');
    const filter = urlObj.searchParams.get('filter') || '';

    let filteredSensors = opcua2Sensors;
    if (filter) {
      const filterLower = filter.toLowerCase();
      filteredSensors = opcua2Sensors.filter(s =>
        s.name.toLowerCase().includes(filterLower) ||
        s.iotype.toLowerCase() === filterLower
      );
    }

    const paginatedSensors = filteredSensors.slice(offset, offset + limit);
    res.writeHead(200);
    res.end(JSON.stringify({
      result: 'OK',
      sensors: paginatedSensors,
      size: filteredSensors.length,
      offset: offset,
      limit: limit
    }));
    return;
  }

  if (url === '/api/v2/OPCUAClient2/opcua/diagnostics') {
    res.writeHead(200);
    res.end(JSON.stringify(opcua2Diagnostics));
    return;
  }

  // Not found
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Mock UniSet2 ${SERVER_NAME} server running on port ${PORT}`);
});
