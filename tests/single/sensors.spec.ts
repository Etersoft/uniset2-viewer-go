import { test, expect } from '@playwright/test';

test.describe('Sensors API Tests', () => {

  test('should return sensors list from API', async ({ request }) => {
    const response = await request.get('/api/sensors');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('sensors');
    expect(data).toHaveProperty('count');
    expect(Array.isArray(data.sensors)).toBeTruthy();
  });

  test('should return sensors with name as primary key (no ID required)', async ({ request }) => {
    const response = await request.get('/api/sensors');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.count).toBeGreaterThan(0);

    // Each sensor should have a name
    for (const sensor of data.sensors) {
      expect(sensor).toHaveProperty('name');
      expect(sensor.name).toBeTruthy();
      expect(typeof sensor.name).toBe('string');

      // ID can be 0 (not set in XML config)
      expect(sensor).toHaveProperty('id');

      // IOType should be present
      expect(sensor).toHaveProperty('iotype');
      expect(['DI', 'DO', 'AI', 'AO']).toContain(sensor.iotype);
    }
  });

  test('should get sensor by name', async ({ request }) => {
    // First get the list of sensors
    const listResponse = await request.get('/api/sensors');
    const listData = await listResponse.json();

    if (listData.count > 0) {
      const sensorName = listData.sensors[0].name;

      // Get sensor by name
      const response = await request.get(`/api/sensors/by-name/${encodeURIComponent(sensorName)}`);
      expect(response.ok()).toBeTruthy();

      const sensor = await response.json();
      expect(sensor.name).toBe(sensorName);
    }
  });

  test('should return 404 for non-existent sensor name', async ({ request }) => {
    const response = await request.get('/api/sensors/by-name/NonExistentSensorName12345');
    expect(response.status()).toBe(404);
  });

  test('should handle sensors with special characters in name', async ({ request }) => {
    // Get sensors list and check if there are any with dots (common in UniSet)
    const listResponse = await request.get('/api/sensors');
    const listData = await listResponse.json();

    // Find a sensor with a dot in the name (like SES.AMC1_OPCUA_EM1)
    const sensorWithDot = listData.sensors.find((s: any) => s.name.includes('.'));

    if (sensorWithDot) {
      const response = await request.get(`/api/sensors/by-name/${encodeURIComponent(sensorWithDot.name)}`);
      expect(response.ok()).toBeTruthy();

      const sensor = await response.json();
      expect(sensor.name).toBe(sensorWithDot.name);
    }
  });

  test('should have correct isDiscrete and isInput properties', async ({ request }) => {
    const response = await request.get('/api/sensors');
    const data = await response.json();

    for (const sensor of data.sensors) {
      // DI and DO are discrete
      if (sensor.iotype === 'DI' || sensor.iotype === 'DO') {
        expect(sensor.isDiscrete).toBe(true);
      }

      // AI and AO are analog (not discrete)
      if (sensor.iotype === 'AI' || sensor.iotype === 'AO') {
        expect(sensor.isDiscrete).toBe(false);
      }

      // DI and AI are inputs
      if (sensor.iotype === 'DI' || sensor.iotype === 'AI') {
        expect(sensor.isInput).toBe(true);
      }

      // DO and AO are outputs
      if (sensor.iotype === 'DO' || sensor.iotype === 'AO') {
        expect(sensor.isInput).toBe(false);
      }
    }
  });

  test('sensors should have textname property', async ({ request }) => {
    const response = await request.get('/api/sensors');
    const data = await response.json();

    // All sensors should have textname (description)
    for (const sensor of data.sensors) {
      expect(sensor).toHaveProperty('textname');
      expect(typeof sensor.textname).toBe('string');
    }
  });

  test('should work with sensors without ID in XML config', async ({ request }) => {
    const response = await request.get('/api/sensors');
    const data = await response.json();

    // Check that we have sensors
    expect(data.count).toBeGreaterThan(0);

    // Even if ID is 0, sensor should be accessible by name
    const sensorsWithZeroId = data.sensors.filter((s: any) => s.id === 0);

    for (const sensor of sensorsWithZeroId) {
      // Should be able to get sensor by name
      const byNameResponse = await request.get(`/api/sensors/by-name/${encodeURIComponent(sensor.name)}`);
      expect(byNameResponse.ok()).toBeTruthy();

      const retrieved = await byNameResponse.json();
      expect(retrieved.name).toBe(sensor.name);
      expect(retrieved.iotype).toBe(sensor.iotype);
    }
  });

  test('all sensors should be unique by name', async ({ request }) => {
    const response = await request.get('/api/sensors');
    const data = await response.json();

    const names = data.sensors.map((s: any) => s.name);
    const uniqueNames = new Set(names);

    // All names should be unique
    expect(names.length).toBe(uniqueNames.size);
  });

});

test.describe('Config API Tests', () => {

  test('should return config with controlsEnabled property', async ({ request }) => {
    const response = await request.get('/api/config');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('controlsEnabled');
    expect(typeof data.controlsEnabled).toBe('boolean');
  });

  test('controlsEnabled should be true when uniset-config is specified', async ({ request }) => {
    // Server is started with --uniset-config, so controlsEnabled should be true
    const response = await request.get('/api/config');
    const data = await response.json();

    // When server is started with uniset-config, controls should be enabled
    expect(data.controlsEnabled).toBe(true);
  });

});
