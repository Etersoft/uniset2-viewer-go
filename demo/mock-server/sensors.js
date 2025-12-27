/**
 * IONC Sensor Storage - simulates SharedMemory/IONotifyController
 *
 * Contains all diesel generator sensors with their current values.
 * The generator simulator updates these values, and the HTTP API reads them.
 */

// Sensor definitions for two diesel generators
const sensorDefinitions = [
    // DG1 Status sensors (boolean - 0/1)
    { id: 1, name: 'DG1_Running', type: 'DI', defaultValue: 0 },
    { id: 2, name: 'DG1_Ready', type: 'DI', defaultValue: 1 },
    { id: 3, name: 'DG1_Alarm', type: 'DI', defaultValue: 0 },
    { id: 4, name: 'DG1_Remote', type: 'DI', defaultValue: 1 },

    // DG1 Analog sensors
    { id: 5, name: 'DG1_RPM', type: 'AI', defaultValue: 0 },
    { id: 6, name: 'DG1_CoolantTemp', type: 'AI', defaultValue: 25 },
    { id: 7, name: 'DG1_OilPressure', type: 'AI', defaultValue: 0 },
    { id: 8, name: 'DG1_Voltage', type: 'AI', defaultValue: 0 },
    { id: 9, name: 'DG1_Frequency', type: 'AI', defaultValue: 0 },
    { id: 10, name: 'DG1_FuelLevel', type: 'AI', defaultValue: 85 },
    { id: 11, name: 'DG1_Power', type: 'AI', defaultValue: 0 },
    { id: 12, name: 'DG1_Load', type: 'AI', defaultValue: 0 },
    { id: 25, name: 'DG1_I1', type: 'AI', defaultValue: 0 },
    { id: 26, name: 'DG1_I2', type: 'AI', defaultValue: 0 },
    { id: 27, name: 'DG1_I3', type: 'AI', defaultValue: 0 },
    { id: 31, name: 'DG1_AirPressure', type: 'AI', defaultValue: 100 },

    // DG2 Status sensors (boolean - 0/1)
    { id: 13, name: 'DG2_Running', type: 'DI', defaultValue: 0 },
    { id: 14, name: 'DG2_Ready', type: 'DI', defaultValue: 1 },
    { id: 15, name: 'DG2_Alarm', type: 'DI', defaultValue: 0 },
    { id: 16, name: 'DG2_Remote', type: 'DI', defaultValue: 1 },

    // DG2 Analog sensors
    { id: 17, name: 'DG2_RPM', type: 'AI', defaultValue: 0 },
    { id: 18, name: 'DG2_CoolantTemp', type: 'AI', defaultValue: 25 },
    { id: 19, name: 'DG2_OilPressure', type: 'AI', defaultValue: 0 },
    { id: 20, name: 'DG2_Voltage', type: 'AI', defaultValue: 0 },
    { id: 21, name: 'DG2_Frequency', type: 'AI', defaultValue: 0 },
    { id: 22, name: 'DG2_FuelLevel', type: 'AI', defaultValue: 75 },
    { id: 23, name: 'DG2_Power', type: 'AI', defaultValue: 0 },
    { id: 24, name: 'DG2_Load', type: 'AI', defaultValue: 0 },
    { id: 28, name: 'DG2_I1', type: 'AI', defaultValue: 0 },
    { id: 29, name: 'DG2_I2', type: 'AI', defaultValue: 0 },
    { id: 30, name: 'DG2_I3', type: 'AI', defaultValue: 0 },
    { id: 32, name: 'DG2_AirPressure', type: 'AI', defaultValue: 100 },
];

// Initialize sensors with full IONC structure
const sensors = sensorDefinitions.map(def => ({
    id: def.id,
    name: def.name,
    type: def.type,
    value: def.defaultValue,
    frozen: false,
    blocked: false,
    readonly: false,
    undefined: false,
    dbignore: false,
    nchanges: 0,
    tv_sec: Math.floor(Date.now() / 1000),
    tv_nsec: 0,
    calibration: {
        cmax: 0,
        cmin: 0,
        rmax: 0,
        rmin: 0,
        precision: def.type === 'AI' ? 1 : 0
    }
}));

// Index for fast lookup by name
const sensorsByName = new Map();
sensors.forEach(s => sensorsByName.set(s.name, s));

// Index for fast lookup by id
const sensorsById = new Map();
sensors.forEach(s => sensorsById.set(s.id, s));

/**
 * Get sensor by name
 * @param {string} name - Sensor name
 * @returns {object|undefined} Sensor object or undefined
 */
function getSensor(name) {
    return sensorsByName.get(name);
}

/**
 * Get sensor by ID
 * @param {number} id - Sensor ID
 * @returns {object|undefined} Sensor object or undefined
 */
function getSensorById(id) {
    return sensorsById.get(id);
}

/**
 * Set sensor value by name
 * @param {string} name - Sensor name
 * @param {number} value - New value
 * @returns {boolean} True if sensor was found and updated
 */
function setSensor(name, value) {
    const sensor = sensorsByName.get(name);
    if (sensor) {
        sensor.value = value;
        sensor.nchanges++;
        sensor.tv_sec = Math.floor(Date.now() / 1000);
        sensor.tv_nsec = (Date.now() % 1000) * 1000000;
        return true;
    }
    return false;
}

/**
 * Set sensor value by ID
 * @param {number} id - Sensor ID
 * @param {number} value - New value
 * @returns {boolean} True if sensor was found and updated
 */
function setSensorById(id, value) {
    const sensor = sensorsById.get(id);
    if (sensor) {
        sensor.value = value;
        sensor.nchanges++;
        sensor.tv_sec = Math.floor(Date.now() / 1000);
        sensor.tv_nsec = (Date.now() % 1000) * 1000000;
        return true;
    }
    return false;
}

/**
 * Get all sensors
 * @returns {Array} Array of all sensors
 */
function getAllSensors() {
    return sensors;
}

/**
 * Get sensors with pagination and filtering
 * @param {object} options - Query options
 * @param {number} options.offset - Start offset
 * @param {number} options.limit - Max results
 * @param {string} options.search - Search string for name
 * @param {string} options.iotype - Filter by type (AI, DI, AO, DO)
 * @returns {object} { sensors, count, offset, limit }
 */
function getSensorsFiltered({ offset = 0, limit = 100, search = '', iotype = '' } = {}) {
    let filtered = sensors;

    if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(s => s.name.toLowerCase().includes(searchLower));
    }

    if (iotype) {
        filtered = filtered.filter(s => s.type === iotype);
    }

    const total = filtered.length;
    const result = filtered.slice(offset, offset + limit);

    return {
        sensors: result,
        count: total,
        offset: offset,
        limit: limit
    };
}

/**
 * Get sensors for SSE batch event
 * @returns {Array} Array of {name, value, error} objects
 */
function getSensorsForSSE() {
    return sensors.map(s => ({
        name: s.name,
        value: s.value,
        error: null
    }));
}

module.exports = {
    getSensor,
    getSensorById,
    setSensor,
    setSensorById,
    getAllSensors,
    getSensorsFiltered,
    getSensorsForSSE
};
