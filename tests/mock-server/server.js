const http = require('http');

const PORT = 9393;

// Mock data
const objects = ['UniSetActivator', 'TestProc', 'SharedMemory', 'OPCUAClient1', 'MBTCPMaster1', 'MBTCPSlave1', 'OPCUAServer1'];

const testProcData = {
  TestProc: {
    LogServer: {
      host: 'localhost',
      port: 6000,
      state: 'RUNNIG',
      info: {
        host: 'localhost',
        name: 'localhost:6000',
        port: 6000,
        sessMaxCount: 10,
        sessions: []
      }
    },
    Timers: {
      '2': { id: 2, msec: 3000, name: '', tick: -1, timeleft: 1500 },
      count: 1
    },
    Variables: {
      activateTimeout: '120000',
      argprefix: 'test-',
      bool_var: '0',
      forceOut: '0',
      idHeartBeat: '-1',
      int_var: '0',
      maxHeartBeat: '10',
      resetMsgTime: '300',
      sleep_msec: '150',
      smReadyTimeout: '15000',
      smTestID: '1',
      t_val: '0',
      test_double: '52.044000',
      test_float: '50.000000',
      test_int: '0',
      test_int2: '110',
      test_long: '110',
      test_str: 'ddd'
    },
    Statistics: {
      processingMessageCatchCount: 0,
      sensors: {
        DumpSensor1_S: { count: 1, id: 19, name: 'DumpSensor1_S' },
        Input1_S: { count: 1, id: 1, name: 'Input1_S' }
      }
    },
    io: {
      in: {
        in_input1_s: {
          comment: 'comment for input1',
          id: 1,
          name: 'Input1_S',
          textname: 'Вход 1 - Температура',
          smTestID: '1',
          value: 1,
          vartype: 'in'
        },
        in_input2_s: {
          comment: 'comment for input2',
          id: 19,
          initFromSM: '1',
          name: 'DumpSensor1_S',
          textname: 'Датчик давления',
          value: 0,
          vartype: 'in'
        }
      },
      out: {
        out_output1_c: {
          id: 7,
          name: 'DO_C',
          no_check_id: '1',
          comment: 'comment for output1',
          textname: 'Выход 1 - Насос',
          value: 1,
          vartype: 'out'
        },
        out_output2_c: {
          force: '1',
          id: 8,
          name: 'DO1_C',
          comment: 'comment for output2',
          textname: 'Выход 2 - Клапан',
          value: 0,
          vartype: 'out'
        }
      }
    },
    myFloatVar: 42.42,
    myMessage: 'This is text for test httpGetUserData',
    myMode: 'RUNNING',
    myVar: 42
  },
  object: {
    id: 6000,
    isActive: true,
    lostMessages: 0,
    maxSizeOfMessageQueue: 1000,
    msgCount: 0,
    name: 'TestProc',
    objectType: 'UniSetManager'
  }
};

const unisetActivatorData = {
  UniSetActivator: {
    Variables: {},
    io: { in: {}, out: {} }
  },
  object: {
    id: 1000,
    isActive: true,
    name: 'UniSetActivator',
    objectType: 'UniSetActivator'
  }
};

// Mock sensors for SharedMemory (IONotifyController)
const mockSensors = [];
for (let i = 1; i <= 200; i++) {
  const types = ['AI', 'DI', 'AO', 'DO'];
  mockSensors.push({
    id: i,
    name: `Sensor${i}_S`,
    type: types[i % 4],
    value: Math.floor(Math.random() * 1000),
    frozen: i % 20 === 0,
    blocked: i % 30 === 0,
    readonly: i % 10 === 0,
    undefined: false
  });
}

const sharedMemoryData = {
  SharedMemory: {
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
    }
  },
  object: {
    id: 5003,
    isActive: true,
    lostMessages: 0,
    maxSizeOfMessageQueue: 1000,
    msgCount: 0,
    name: 'SharedMemory',
    objectType: 'IONotifyController'
  }
};

// OPCUAExchange mock data
const opcuaParams = {
  polltime: 300,
  updatetime: 300,
  reconnectPause: 10000,
  timeoutIterate: 0,
  exchangeMode: 0,
  writeToAllChannels: 0,
  currentChannel: 0,
  connectCount: 0,
  activated: 1,
  iolistSize: 8,
  httpControlAllow: 0,
  httpControlActive: 0,
  errorHistoryMax: 100
};

const opcuaStatus = {
  result: 'OK',
  status: {
    subscription: { enabled: true, items: 2 },
    iolist_size: 8,
    monitor: 'OK',
    httpEnabledSetParams: true,
    httpControlAllow: false,
    httpControlActive: false,
    errorHistorySize: 1,
    errorHistoryMax: 100,
    channels: [
      { index: 0, status: 'OK', ok: true, addr: 'opc.tcp://localhost:48010' },
      { index: 1, status: 'FAIL', ok: false, addr: 'opc.tcp://localhost:48020', disabled: true }
    ]
  }
};

// Generate 100 mock OPCUA sensors for testing virtual scroll and filtering
const opcuaSensors = [];
const sensorTypes = ['AI', 'AO', 'DI', 'DO'];
const vtypes = { AI: 'Double', AO: 'Double', DI: 'Bool', DO: 'Bool' };

for (let i = 1; i <= 100; i++) {
  const iotype = sensorTypes[(i - 1) % 4];
  const isAnalog = iotype.startsWith('A');
  opcuaSensors.push({
    id: i,
    name: `${iotype}${String(i).padStart(3, '0')}_OPC`,
    iotype: iotype,
    value: isAnalog ? (42.5 + i * 0.1) : (i % 2),
    tick: 10 + i,
    vtype: vtypes[iotype],
    precision: isAnalog ? 2 : 0,
    status: i % 10 === 0 ? 'ERROR' : 'OK',
    nodeid: `ns=2;s=Demo.Dynamic.${iotype}.Item${i}`
  });
}

const opcuaDiagnostics = {
  result: 'OK',
  summary: {
    reconnects: 1,
    errors: 0,
    warnings: 2
  },
  lastErrors: [
    {
      time: '2024-01-01T10:00:00Z',
      channel: 1,
      operation: 'read',
      statusCode: 'BadCommunicationError',
      nodeid: 'ns=2;s=Demo.Dynamic.Scalar.Double'
    }
  ],
  errorHistoryMax: 100,
  errorHistorySize: 1
};

// ModbusMaster mock data
const mbDevices = [
  { addr: 1, respond: true, dtype: 'rtu', regCount: 25, mode: 0, safeMode: 0 },
  { addr: 2, respond: true, dtype: 'rtu', regCount: 10, mode: 0, safeMode: 0 },
  { addr: 3, respond: false, dtype: 'rtu', regCount: 15, mode: 0, safeMode: 1 }
];

// Generate 100 mock Modbus registers for testing
const mbRegisters = [];
const mbTypes = ['AI', 'AO', 'DI', 'DO'];
const mbVtypes = { AI: 'signed', AO: 'signed', DI: 'unsigned', DO: 'unsigned' };
const mbFuncs = { AI: 3, AO: 6, DI: 1, DO: 5 };

for (let i = 1; i <= 100; i++) {
  const iotype = mbTypes[(i - 1) % 4];
  const devAddr = ((i - 1) % 3) + 1;
  const isAnalog = iotype.startsWith('A');
  mbRegisters.push({
    id: 1000 + i,
    name: `MB_${iotype}${String(i).padStart(3, '0')}_S`,
    iotype: iotype,
    value: isAnalog ? (100 + i * 2) : (i % 2),
    vtype: mbVtypes[iotype],
    device: devAddr,  // now just addr, details in devices dict
    register: {
      mbreg: 100 + i,
      mbfunc: mbFuncs[iotype],
      mbval: isAnalog ? (100 + i * 2) : (i % 2)
    },
    nbit: -1,
    mask: 0,
    precision: isAnalog ? 1 : 0
  });
}

let mbHttpControlActive = false;

// ModbusSlave mock data
const mbsParams = {
  polltime: 100,
  default_timeout: 3000,
  maxHeartBeat: 10
};

const mbsStatus = {
  result: 'OK',
  status: {
    name: 'MBTCPSlave1',
    monitor: 'vmon: OK',
    activated: 1,
    logserver: { host: '127.0.0.1', port: 5520 },
    parameters: {
      config: 'TCP(slave): 0.0.0.0:502'
    },
    statistics: {
      text: 'Requests: 500 processed',
      interval: 30000
    },
    maxHeartBeat: 10,
    activateTimeout: 2000,
    config_params: {
      polltime: 100,
      default_timeout: 3000
    },
    httpEnabledSetParams: 1
  }
};

// Generate 80 mock ModbusSlave registers for testing
const mbsRegisters = [];
const mbsTypes = ['AI', 'AO', 'DI', 'DO'];
const mbsVtypes = { AI: 'signed', AO: 'signed', DI: 'unsigned', DO: 'unsigned' };

for (let i = 1; i <= 80; i++) {
  const iotype = mbsTypes[(i - 1) % 4];
  const isAnalog = iotype.startsWith('A');
  mbsRegisters.push({
    id: 2000 + i,
    name: `MBS_${iotype}${String(i).padStart(3, '0')}_S`,
    iotype: iotype,
    value: isAnalog ? (50 + i * 3) : (i % 2),
    vtype: mbsVtypes[iotype],
    register: {
      mbreg: 200 + i,
      mbfunc: iotype === 'AI' ? 4 : (iotype === 'AO' ? 6 : (iotype === 'DI' ? 2 : 5))
    },
    precision: isAnalog ? 1 : 0
  });
}

// OPCUAServer mock data
const opcuaServerParams = {
  updateTime_msec: 100,
  httpEnabledSetParams: 1
};

const opcuaServerStatus = {
  result: 'OK',
  status: {
    name: 'OPCUAServer1',
    extensionType: 'OPCUAServer',
    httpEnabledSetParams: 1,
    LogServer: {
      host: '',
      port: 0,
      state: 'STOPPED',
      info: {
        host: '',
        name: 'LogServer',
        port: 0,
        sessMaxCount: 10,
        sessions: []
      }
    },
    endpoints: [
      { name: 'uniset2 OPC UA gate', url: 'urn:uniset2.server' },
      { name: 'opc.tcp', url: 'opc.tcp://localhost:4840' }
    ],
    config: {
      maxSubscriptions: 10,
      maxSessions: 10,
      maxSecureChannels: 10,
      maxSessionTimeout: 5000
    },
    params: {
      updateTime_msec: 100
    },
    variables: {
      total: 50,
      read: 20,
      write: 28,
      methods: 2
    }
  }
};

// Generate mock OPCUAServer sensors (variables)
const opcuaServerSensors = [];
for (let i = 1; i <= 50; i++) {
  const iotype = sensorTypes[(i - 1) % 4];
  const isAnalog = iotype.startsWith('A');
  opcuaServerSensors.push({
    id: 5000 + i,
    name: `OPC_${iotype}${String(i).padStart(3, '0')}_Var`,
    iotype: iotype,
    value: isAnalog ? (10.5 + i * 0.5) : (i % 2),
    vtype: vtypes[iotype],
    precision: isAnalog ? 2 : 0
  });
}

const mbParams = {
  force: 0,
  force_out: 0,
  maxHeartBeat: 10,
  recv_timeout: 2000,
  sleepPause_msec: 50,
  polltime: 200,
  default_timeout: 5000
};

const mbStatus = {
  result: 'OK',
  status: {
    name: 'MBTCPMaster1',
    monitor: 'vmon: OK',
    activated: 1,
    logserver: { host: '127.0.0.1', port: 5510 },
    parameters: {
      reopenTimeout: 5000,
      config: 'TCP(master): 192.168.0.1:502 (3 devices)'
    },
    statistics: {
      text: 'Packets: 1200 ok, 5 errors',
      interval: 30000
    },
    devices: mbDevices.map(d => ({ id: d.addr, info: `Dev${d.addr} [${d.regCount} regs]` })),
    mode: { name: 'normal', id: 0, control: 'manual' },
    maxHeartBeat: 10,
    force: 0,
    force_out: 0,
    activateTimeout: 2000,
    reopenTimeout: 5000,
    notUseExchangeTimer: 0,
    config_params: {
      recv_timeout: 2000,
      sleepPause_msec: 50,
      polltime: 200,
      default_timeout: 5000
    },
    httpControlAllow: 1,
    httpControlActive: 0,
    httpEnabledSetParams: 1
  }
};

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = req.url;

  if (url === '/api/v2/list') {
    res.end(JSON.stringify(objects));
  } else if (url === '/api/v2/TestProc') {
    res.end(JSON.stringify(testProcData));
  } else if (url === '/api/v2/UniSetActivator') {
    res.end(JSON.stringify(unisetActivatorData));
  } else if (url === '/api/v2/TestProc/help') {
    res.end(JSON.stringify({
      TestProc: [
        { desc: 'get value for parameter', name: 'params/get' },
        { desc: 'set value for parameter', name: 'params/set' },
        { desc: 'show log level', name: 'log' }
      ]
    }));
  } else if (url === '/api/v2/SharedMemory') {
    res.end(JSON.stringify(sharedMemoryData));
  } else if (url === '/api/v2/SharedMemory/sensors' || url.startsWith('/api/v2/SharedMemory/sensors?')) {
    // Parse query parameters
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0');
    const limit = parseInt(urlObj.searchParams.get('limit') || '100');
    const search = (urlObj.searchParams.get('search') || '').toLowerCase();
    const iotype = (urlObj.searchParams.get('iotype') || '').toUpperCase();

    // Apply filters
    let filtered = mockSensors;
    if (search) {
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(search) ||
        String(s.id).includes(search)
      );
    }
    if (iotype && iotype !== 'ALL') {
      filtered = filtered.filter(s => s.type === iotype);
    }

    const paginatedSensors = filtered.slice(offset, offset + limit);
    res.end(JSON.stringify({
      sensors: paginatedSensors,
      size: filtered.length,
      offset: offset,
      limit: limit
    }));
  } else if (url === '/api/v2/SharedMemory/lost') {
    res.end(JSON.stringify({ 'lost consumers': [] }));
  } else if (url.startsWith('/api/v2/SharedMemory/consumers')) {
    // Parse sensor IDs from query
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const sensorsParam = urlObj.searchParams.get('sensors') || '';
    const sensorIds = sensorsParam.split(',').filter(s => s).map(Number);

    const sensors = sensorIds.map(id => ({
      id: id,
      name: `Sensor${id}_S`,
      consumers: []
    }));

    res.end(JSON.stringify({ sensors }));
  } else if (url.startsWith('/api/v2/SharedMemory/get')) {
    // Return mock sensor values to avoid noisy poller errors
    const query = url.split('?')[1] || '';
    const sensorsPart = query.split('&')[0] || '';
    const sensorIds = sensorsPart.split(',').filter(Boolean);
    const sensors = sensorIds.map(id => ({
      id: Number(id) || 0,
      name: `Sensor${id}_S`,
      value: 0,
      real_value: 0
    }));
    res.end(JSON.stringify({ sensors }));
  } else if (url === '/api/v2/OPCUAClient1') {
    res.end(JSON.stringify({
      OPCUAClient1: {},
      object: {
        id: 2001,
        isActive: true,
        name: 'OPCUAClient1',
        objectType: 'UniSetObject',
        extensionType: 'OPCUAExchange'
      }
    }));
  } else if (url === '/api/v2/OPCUAClient1/status') {
    res.end(JSON.stringify(opcuaStatus));
  } else if (url.startsWith('/api/v2/OPCUAClient1/getparam')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const names = urlObj.searchParams.getAll('name');
    const params = {};
    if (names.length === 0) {
      Object.assign(params, opcuaParams);
    } else {
      names.forEach(name => {
        if (Object.prototype.hasOwnProperty.call(opcuaParams, name)) {
          params[name] = opcuaParams[name];
        }
      });
    }
    res.end(JSON.stringify({ result: 'OK', params }));
  } else if (url.startsWith('/api/v2/OPCUAClient1/setparam')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    urlObj.searchParams.forEach((value, key) => {
      opcuaParams[key] = Number.isNaN(Number(value)) ? value : Number(value);
    });
    res.end(JSON.stringify({ result: 'OK', updated: opcuaParams }));
  } else if (url === '/api/v2/OPCUAClient1/sensors' || url.startsWith('/api/v2/OPCUAClient1/sensors?')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
    const search = (urlObj.searchParams.get('search') || '').toLowerCase();
    const iotype = (urlObj.searchParams.get('iotype') || '').toUpperCase();

    // Apply filters
    let filtered = opcuaSensors;
    if (search) {
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(search) ||
        String(s.id).includes(search)
      );
    }
    if (iotype && iotype !== 'ALL') {
      filtered = filtered.filter(s => s.iotype === iotype);
    }

    // Apply pagination
    const paginatedSensors = filtered.slice(offset, offset + limit);

    res.end(JSON.stringify({
      result: 'OK',
      sensors: paginatedSensors,
      total: filtered.length,
      limit: limit,
      offset: offset
    }));
  } else if (url.startsWith('/api/v2/OPCUAClient1/sensor')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const id = parseInt(urlObj.searchParams.get('id') || '0', 10);
    const sensor = opcuaSensors.find(s => s.id === id) || null;
    res.end(JSON.stringify({ result: 'OK', sensor }));
  } else if (url === '/api/v2/OPCUAClient1/diagnostics') {
    res.end(JSON.stringify(opcuaDiagnostics));
  } else if (url === '/api/v2/OPCUAClient1/takeControl') {
    res.end(JSON.stringify({ result: 'OK', message: 'control taken', previousMode: 0, currentMode: 1 }));
  } else if (url === '/api/v2/OPCUAClient1/releaseControl') {
    res.end(JSON.stringify({ result: 'OK', message: 'control released', previousMode: 1, currentMode: 0 }));
  // ModbusMaster endpoints
  } else if (url === '/api/v2/MBTCPMaster1') {
    res.end(JSON.stringify({
      MBTCPMaster1: {},
      object: {
        id: 3001,
        isActive: true,
        name: 'MBTCPMaster1',
        objectType: 'UniSetObject',
        extensionType: 'ModbusMaster',
        transportType: 'tcp'
      }
    }));
  } else if (url === '/api/v2/MBTCPMaster1/status') {
    mbStatus.status.httpControlActive = mbHttpControlActive ? 1 : 0;
    res.end(JSON.stringify(mbStatus));
  } else if (url === '/api/v2/MBTCPMaster1/devices') {
    res.end(JSON.stringify({
      result: 'OK',
      devices: mbDevices,
      count: mbDevices.length
    }));
  } else if (url === '/api/v2/MBTCPMaster1/registers' || url.startsWith('/api/v2/MBTCPMaster1/registers?')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
    const search = (urlObj.searchParams.get('search') || '').toLowerCase();
    const iotype = (urlObj.searchParams.get('iotype') || '').toUpperCase();

    let filtered = mbRegisters;
    if (search) {
      filtered = filtered.filter(r => r.name.toLowerCase().includes(search));
    }
    if (iotype && iotype !== 'ALL') {
      filtered = filtered.filter(r => r.iotype === iotype);
    }

    const paginatedRegs = filtered.slice(offset, offset + limit);

    // Build devices dictionary (only for devices in results)
    const usedDevices = new Set(paginatedRegs.map(r => r.device));
    const devicesDict = {};
    for (const addr of usedDevices) {
      const dev = mbDevices.find(d => d.addr === addr);
      if (dev) {
        devicesDict[addr] = {
          respond: dev.respond,
          dtype: dev.dtype,
          mode: dev.mode,
          safeMode: dev.safeMode
        };
      }
    }

    res.end(JSON.stringify({
      result: 'OK',
      devices: devicesDict,
      registers: paginatedRegs,
      total: filtered.length,
      count: paginatedRegs.length,
      offset: offset,
      limit: limit
    }));
  } else if (url.startsWith('/api/v2/MBTCPMaster1/getparam')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const names = urlObj.searchParams.getAll('name');
    const params = {};
    if (names.length === 0) {
      Object.assign(params, mbParams);
    } else {
      names.forEach(name => {
        if (Object.prototype.hasOwnProperty.call(mbParams, name)) {
          params[name] = mbParams[name];
        }
      });
    }
    res.end(JSON.stringify({ result: 'OK', params }));
  } else if (url.startsWith('/api/v2/MBTCPMaster1/setparam')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const updated = {};
    urlObj.searchParams.forEach((value, key) => {
      if (Object.prototype.hasOwnProperty.call(mbParams, key)) {
        mbParams[key] = Number.isNaN(Number(value)) ? value : Number(value);
        updated[key] = mbParams[key];
      }
    });
    res.end(JSON.stringify({ result: 'OK', updated }));
  } else if (url === '/api/v2/MBTCPMaster1/takeControl') {
    mbHttpControlActive = true;
    res.end(JSON.stringify({ result: 'OK', httpControlActive: 1, currentMode: 0 }));
  } else if (url === '/api/v2/MBTCPMaster1/releaseControl') {
    mbHttpControlActive = false;
    res.end(JSON.stringify({ result: 'OK', httpControlActive: 0, currentMode: 0 }));
  } else if (url.startsWith('/api/v2/MBTCPMaster1/mode')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    if (urlObj.searchParams.has('get')) {
      res.end(JSON.stringify({ result: 'OK', mode: mbStatus.status.mode }));
    } else if (urlObj.searchParams.has('supported')) {
      res.end(JSON.stringify({
        result: 'OK',
        supported: [
          { id: 0, name: 'normal' },
          { id: 1, name: 'writeOnly' },
          { id: 2, name: 'readOnly' },
          { id: 3, name: 'disabled' }
        ]
      }));
    } else if (urlObj.searchParams.has('set')) {
      const modeName = urlObj.searchParams.get('set');
      mbStatus.status.mode.name = modeName;
      res.end(JSON.stringify({ result: 'OK', mode: mbStatus.status.mode }));
    } else {
      res.end(JSON.stringify({ result: 'OK', mode: mbStatus.status.mode }));
    }
  // ModbusSlave endpoints
  } else if (url === '/api/v2/MBTCPSlave1') {
    res.end(JSON.stringify({
      MBTCPSlave1: {},
      object: {
        id: 3501,
        isActive: true,
        name: 'MBTCPSlave1',
        objectType: 'UniSetObject',
        extensionType: 'ModbusSlave',
        transportType: 'tcp'
      }
    }));
  } else if (url === '/api/v2/MBTCPSlave1/status') {
    res.end(JSON.stringify(mbsStatus));
  } else if (url === '/api/v2/MBTCPSlave1/registers' || url.startsWith('/api/v2/MBTCPSlave1/registers?')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
    const search = (urlObj.searchParams.get('search') || '').toLowerCase();
    const iotype = (urlObj.searchParams.get('iotype') || '').toUpperCase();

    let filtered = mbsRegisters;
    if (search) {
      filtered = filtered.filter(r => r.name.toLowerCase().includes(search));
    }
    if (iotype && iotype !== 'ALL') {
      filtered = filtered.filter(r => r.iotype === iotype);
    }

    const paginatedRegs = filtered.slice(offset, offset + limit);

    res.end(JSON.stringify({
      result: 'OK',
      registers: paginatedRegs,
      total: filtered.length,
      count: paginatedRegs.length,
      offset: offset,
      limit: limit
    }));
  } else if (url.startsWith('/api/v2/MBTCPSlave1/getparam')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const names = urlObj.searchParams.getAll('name');
    const params = {};
    if (names.length === 0) {
      Object.assign(params, mbsParams);
    } else {
      names.forEach(name => {
        if (Object.prototype.hasOwnProperty.call(mbsParams, name)) {
          params[name] = mbsParams[name];
        }
      });
    }
    res.end(JSON.stringify({ result: 'OK', params }));
  } else if (url.startsWith('/api/v2/MBTCPSlave1/setparam')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const updated = {};
    urlObj.searchParams.forEach((value, key) => {
      if (Object.prototype.hasOwnProperty.call(mbsParams, key)) {
        mbsParams[key] = Number.isNaN(Number(value)) ? value : Number(value);
        updated[key] = mbsParams[key];
      }
    });
    res.end(JSON.stringify({ result: 'OK', updated }));
  // OPCUAServer endpoints
  } else if (url === '/api/v2/OPCUAServer1') {
    res.end(JSON.stringify({
      OPCUAServer1: {},
      object: {
        id: 4001,
        isActive: true,
        name: 'OPCUAServer1',
        objectType: 'UniSetObject',
        extensionType: 'OPCUAServer'
      }
    }));
  } else if (url === '/api/v2/OPCUAServer1/status') {
    res.end(JSON.stringify(opcuaServerStatus));
  } else if (url.startsWith('/api/v2/OPCUAServer1/getparam')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const names = urlObj.searchParams.getAll('name');
    const params = {};
    if (names.length === 0) {
      Object.assign(params, opcuaServerParams);
    } else {
      names.forEach(name => {
        if (Object.prototype.hasOwnProperty.call(opcuaServerParams, name)) {
          params[name] = opcuaServerParams[name];
        }
      });
    }
    res.end(JSON.stringify({ result: 'OK', params }));
  } else if (url.startsWith('/api/v2/OPCUAServer1/setparam')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const updated = {};
    urlObj.searchParams.forEach((value, key) => {
      if (Object.prototype.hasOwnProperty.call(opcuaServerParams, key)) {
        opcuaServerParams[key] = Number.isNaN(Number(value)) ? value : Number(value);
        updated[key] = opcuaServerParams[key];
      }
    });
    res.end(JSON.stringify({ result: 'OK', updated }));
  } else if (url === '/api/v2/OPCUAServer1/sensors' || url.startsWith('/api/v2/OPCUAServer1/sensors?')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
    const search = (urlObj.searchParams.get('search') || '').toLowerCase();
    const iotype = (urlObj.searchParams.get('iotype') || '').toUpperCase();

    // Apply filters
    let filtered = opcuaServerSensors;
    if (search) {
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(search) ||
        String(s.id).includes(search)
      );
    }
    if (iotype && iotype !== 'ALL') {
      filtered = filtered.filter(s => s.iotype === iotype);
    }

    // Apply pagination
    const paginatedSensors = filtered.slice(offset, offset + limit);

    res.end(JSON.stringify({
      result: 'OK',
      sensors: paginatedSensors,
      total: filtered.length,
      limit: limit,
      offset: offset
    }));
  } else if (url.startsWith('/api/v2/OPCUAServer1/get')) {
    const urlObj = new URL(url, `http://localhost:${PORT}`);
    const names = urlObj.searchParams.getAll('name');
    const ids = urlObj.searchParams.getAll('id');
    const sensors = [];

    names.forEach(name => {
      const sensor = opcuaServerSensors.find(s => s.name === name);
      if (sensor) sensors.push(sensor);
    });
    ids.forEach(id => {
      const sensor = opcuaServerSensors.find(s => s.id === parseInt(id, 10));
      if (sensor && !sensors.find(s => s.id === sensor.id)) sensors.push(sensor);
    });

    res.end(JSON.stringify({ result: 'OK', sensors }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock UniSet2 server running on port ${PORT}`);
});
