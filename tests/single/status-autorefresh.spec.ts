import { test, expect } from '@playwright/test';

// Test objects for each renderer type (names must match mock-server objects)
const TEST_OBJECTS = {
  ModbusMaster: 'MBTCPMaster1',
  ModbusSlave: 'MBTCPSlave1',
  OPCUAExchange: 'OPCUAClient1',
  OPCUAServer: 'OPCUAServer1',
};

// Section IDs where status controls are located
const STATUS_SECTION_IDS = {
  ModbusMaster: 'mb-status-section',
  ModbusSlave: 'mbs-status-section',
  OPCUAExchange: 'opcua-status-section',
  OPCUAServer: 'opcuasrv-status-section',
};

// Prefixes for status auto-refresh elements
const STATUS_PREFIXES = {
  ModbusMaster: 'modbusmaster',
  ModbusSlave: 'modbusslave',
  OPCUAExchange: 'opcuaexchange',
  OPCUAServer: 'opcuaserver',
};

// Helper function to open object tab and wait for status section
async function openObjectAndWaitForStatus(page: any, objectName: string, sectionId: string) {
  await page.goto('/');
  await page.waitForSelector('#objects-list li', { timeout: 15000 });

  const item = page.locator('#objects-list li', { hasText: objectName });
  await item.click();
  await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

  // Wait for status section to be visible
  const statusSection = page.locator(`#${sectionId}-${objectName}`);
  await expect(statusSection).toBeVisible({ timeout: 10000 });

  // Wait a bit for status to load
  await page.waitForTimeout(1000);
}

test.describe('Status Auto-Refresh', () => {
  test.describe('ModbusMaster', () => {
    const objectName = TEST_OBJECTS.ModbusMaster;
    const prefix = STATUS_PREFIXES.ModbusMaster;
    const sectionId = STATUS_SECTION_IDS.ModbusMaster;

    test('should display status auto-refresh controls', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      // Check auto-refresh container exists
      const autoRefreshContainer = page.locator(`#${prefix}-status-autorefresh-${objectName}`);
      await expect(autoRefreshContainer).toBeVisible({ timeout: 5000 });

      // Check last update timestamp element exists
      const lastUpdate = page.locator(`#${prefix}-status-last-${objectName}`);
      await expect(lastUpdate).toBeVisible();

      // Check interval buttons exist (5 buttons: 5s, 10s, 15s, 1m, 5m)
      const intervalButtons = page.locator(`#${prefix}-status-autorefresh-${objectName} .status-interval-buttons button`);
      await expect(intervalButtons).toHaveCount(5);
    });

    test('should have correct interval button labels', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      const buttons = page.locator(`#${prefix}-status-autorefresh-${objectName} .status-interval-buttons button`);

      // English labels: 5s, 10s, 15s, 1m, 5m
      await expect(buttons.nth(0)).toHaveText('5s');
      await expect(buttons.nth(1)).toHaveText('10s');
      await expect(buttons.nth(2)).toHaveText('15s');
      await expect(buttons.nth(3)).toHaveText('1m');
      await expect(buttons.nth(4)).toHaveText('5m');
    });

    test('should have default interval button active', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      // Default is 5000ms (5s button)
      const activeButton = page.locator(`#${prefix}-status-autorefresh-${objectName} button.active`);
      await expect(activeButton).toHaveText('5s');
    });

    test('should change active button on click', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      // Click 10s button (data-ms="10000")
      const btn10s = page.locator(`#${prefix}-status-autorefresh-${objectName} button[data-ms="10000"]`);
      await btn10s.click();

      // 10s should now be active
      await expect(btn10s).toHaveClass(/active/);

      // 5s should not be active
      const btn5s = page.locator(`#${prefix}-status-autorefresh-${objectName} button[data-ms="5000"]`);
      await expect(btn5s).not.toHaveClass(/active/);
    });

    test('should update last update timestamp', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      // Wait for first status load
      await page.waitForTimeout(2000);

      const lastUpdate = page.locator(`#${prefix}-status-last-${objectName}`);
      const text = await lastUpdate.textContent();

      // Should have timestamp in format HH:MM:SS
      expect(text).toMatch(/\d{2}:\d{2}:\d{2}/);
    });

    test('should persist interval in localStorage', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      // Click 15s button
      const btn15s = page.locator(`#${prefix}-status-autorefresh-${objectName} button[data-ms="15000"]`);
      await btn15s.click();

      // Check localStorage (stored as JSON object with objectName as key)
      const storedValue = await page.evaluate(([key, objName]) => {
        const stored = JSON.parse(localStorage.getItem(key) || '{}');
        return stored[objName];
      }, [`${prefix}-status-interval`, objectName] as const);
      expect(storedValue).toBe(15000);
    });

    test('should restore interval from localStorage on reload', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      // Set interval to 60000 (1m) - stored as JSON object with objectName as key
      await page.evaluate(([key, objName]) => {
        const stored = JSON.parse(localStorage.getItem(key) || '{}');
        stored[objName] = 60000;
        localStorage.setItem(key, JSON.stringify(stored));
      }, [`${prefix}-status-interval`, objectName] as const);

      // Open tab
      const item = page.locator('#objects-list li', { hasText: objectName });
      await item.click();
      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

      // Wait for status section
      const statusSection = page.locator(`#${sectionId}-${objectName}`);
      await expect(statusSection).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(500);

      // 1m button should be active
      const btn1m = page.locator(`#${prefix}-status-autorefresh-${objectName} button[data-ms="60000"]`);
      await expect(btn1m).toHaveClass(/active/);
    });

    test('should refresh status when interval elapses', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      // Set to 5s interval
      const btn5s = page.locator(`#${prefix}-status-autorefresh-${objectName} button[data-ms="5000"]`);
      await btn5s.click();

      // Wait for first update
      await page.waitForTimeout(1500);

      const lastUpdate = page.locator(`#${prefix}-status-last-${objectName}`);
      const firstTimestamp = await lastUpdate.textContent();

      // Wait for auto-refresh (5s + buffer)
      await page.waitForTimeout(6000);

      const secondTimestamp = await lastUpdate.textContent();

      // Timestamps should be different (status was refreshed)
      expect(secondTimestamp).not.toBe(firstTimestamp);
    });
  });

  test.describe('ModbusSlave', () => {
    const objectName = TEST_OBJECTS.ModbusSlave;
    const prefix = STATUS_PREFIXES.ModbusSlave;
    const sectionId = STATUS_SECTION_IDS.ModbusSlave;

    test('should display status auto-refresh controls', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      const autoRefreshContainer = page.locator(`#${prefix}-status-autorefresh-${objectName}`);
      await expect(autoRefreshContainer).toBeVisible({ timeout: 5000 });

      const intervalButtons = page.locator(`#${prefix}-status-autorefresh-${objectName} .status-interval-buttons button`);
      await expect(intervalButtons).toHaveCount(5);
    });

    test('should change active button on click', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      const btn10s = page.locator(`#${prefix}-status-autorefresh-${objectName} button[data-ms="10000"]`);
      await btn10s.click();

      await expect(btn10s).toHaveClass(/active/);
    });

    test('should update timestamp on status refresh', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      await page.waitForTimeout(2000);

      const lastUpdate = page.locator(`#${prefix}-status-last-${objectName}`);
      const text = await lastUpdate.textContent();
      expect(text).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });

  test.describe('OPCUAExchange', () => {
    const objectName = TEST_OBJECTS.OPCUAExchange;
    const prefix = STATUS_PREFIXES.OPCUAExchange;
    const sectionId = STATUS_SECTION_IDS.OPCUAExchange;

    test('should display status auto-refresh controls', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      const autoRefreshContainer = page.locator(`#${prefix}-status-autorefresh-${objectName}`);
      await expect(autoRefreshContainer).toBeVisible({ timeout: 5000 });

      const intervalButtons = page.locator(`#${prefix}-status-autorefresh-${objectName} .status-interval-buttons button`);
      await expect(intervalButtons).toHaveCount(5);
    });

    test('should change active button on click', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      const btn1m = page.locator(`#${prefix}-status-autorefresh-${objectName} button[data-ms="60000"]`);
      await btn1m.click();

      await expect(btn1m).toHaveClass(/active/);
    });

    test('should update timestamp on status refresh', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      await page.waitForTimeout(2000);

      const lastUpdate = page.locator(`#${prefix}-status-last-${objectName}`);
      const text = await lastUpdate.textContent();
      expect(text).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });

  test.describe('OPCUAServer', () => {
    const objectName = TEST_OBJECTS.OPCUAServer;
    const prefix = STATUS_PREFIXES.OPCUAServer;
    const sectionId = STATUS_SECTION_IDS.OPCUAServer;

    test('should display status auto-refresh controls', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      const autoRefreshContainer = page.locator(`#${prefix}-status-autorefresh-${objectName}`);
      await expect(autoRefreshContainer).toBeVisible({ timeout: 5000 });

      const intervalButtons = page.locator(`#${prefix}-status-autorefresh-${objectName} .status-interval-buttons button`);
      await expect(intervalButtons).toHaveCount(5);
    });

    test('should change active button on click', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      const btn5m = page.locator(`#${prefix}-status-autorefresh-${objectName} button[data-ms="300000"]`);
      await btn5m.click();

      await expect(btn5m).toHaveClass(/active/);
    });

    test('should update timestamp on status refresh', async ({ page }) => {
      await openObjectAndWaitForStatus(page, objectName, sectionId);

      await page.waitForTimeout(2000);

      const lastUpdate = page.locator(`#${prefix}-status-last-${objectName}`);
      const text = await lastUpdate.textContent();
      expect(text).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });

  test.describe('Cross-renderer consistency', () => {
    test('all renderers should have same button structure', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      for (const [rendererType, objectName] of Object.entries(TEST_OBJECTS)) {
        const prefix = STATUS_PREFIXES[rendererType as keyof typeof STATUS_PREFIXES];
        const sectionId = STATUS_SECTION_IDS[rendererType as keyof typeof STATUS_SECTION_IDS];

        const item = page.locator('#objects-list li', { hasText: objectName });
        await item.click();
        await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

        // Wait for status section
        const statusSection = page.locator(`#${sectionId}-${objectName}`);
        await expect(statusSection).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(500);

        const buttons = page.locator(`#${prefix}-status-autorefresh-${objectName} .status-interval-buttons button`);
        const count = await buttons.count();
        expect(count).toBe(5); // 5 buttons: 5s, 10s, 15s, 1m, 5m

        // Check data-ms attributes
        const intervals = [5000, 10000, 15000, 60000, 300000];
        for (let i = 0; i < intervals.length; i++) {
          const dataMs = await buttons.nth(i).getAttribute('data-ms');
          expect(dataMs).toBe(intervals[i].toString());
        }

        // Close tab by clicking the close button
        const closeBtn = page.locator(`.tab-btn:has-text("${objectName}") .tab-close`);
        if (await closeBtn.count() > 0) {
          await closeBtn.click();
        }
      }
    });

    test('each renderer should have unique localStorage key', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      // Set different intervals for each renderer
      const testIntervals: Record<string, number> = {
        ModbusMaster: 5000,
        ModbusSlave: 10000,
        OPCUAExchange: 15000,
        OPCUAServer: 60000,
      };

      for (const [rendererType, objectName] of Object.entries(TEST_OBJECTS)) {
        const prefix = STATUS_PREFIXES[rendererType as keyof typeof STATUS_PREFIXES];
        const sectionId = STATUS_SECTION_IDS[rendererType as keyof typeof STATUS_SECTION_IDS];
        const interval = testIntervals[rendererType];

        const item = page.locator('#objects-list li', { hasText: objectName });
        await item.click();
        await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

        // Wait for status section
        const statusSection = page.locator(`#${sectionId}-${objectName}`);
        await expect(statusSection).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(500);

        // Click the button with the specified interval
        const btn = page.locator(`#${prefix}-status-autorefresh-${objectName} button[data-ms="${interval}"]`);
        await btn.click();

        // Close tab
        const closeBtn = page.locator(`.tab-btn:has-text("${objectName}") .tab-close`);
        if (await closeBtn.count() > 0) {
          await closeBtn.click();
        }
      }

      // Verify each renderer has its own stored value
      for (const [rendererType, objectName] of Object.entries(TEST_OBJECTS)) {
        const prefix = STATUS_PREFIXES[rendererType as keyof typeof STATUS_PREFIXES];
        const expectedInterval = testIntervals[rendererType];

        // Check localStorage (stored as JSON object with objectName as key)
        const storedValue = await page.evaluate(([key, objName]) => {
          const stored = JSON.parse(localStorage.getItem(key) || '{}');
          return stored[objName];
        }, [`${prefix}-status-interval`, objectName] as const);
        expect(storedValue).toBe(expectedInterval);
      }
    });
  });
});
