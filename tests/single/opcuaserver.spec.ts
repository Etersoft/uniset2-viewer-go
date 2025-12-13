import { test, expect } from '@playwright/test';

const OPCUA_SERVER_OBJECT = 'OPCUAServer1';

test.describe('OPCUAServer renderer', () => {
  test('shows OPCUAServer sections', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

    const panel = page.locator('.tab-panel.active');
    await panel.waitFor({ timeout: 10000 });

    // OPCUAServer has status, params, and variables sections
    await expect(panel.locator('.collapsible-title', { hasText: 'Статус OPC UA Server' })).toBeVisible();
    await expect(panel.locator('.collapsible-title', { hasText: 'Параметры сервера' })).toBeVisible();
    await expect(panel.locator('.collapsible-title', { hasText: 'OPC UA переменные' })).toBeVisible();

    // Check status content
    await expect(panel.locator(`#opcuasrv-status-${OPCUA_SERVER_OBJECT} tr`)).not.toHaveCount(0);

    // Check params exist
    await expect(panel.locator(`#opcuasrv-params-${OPCUA_SERVER_OBJECT} tr`)).not.toHaveCount(0);

    // Check sensors/variables exist
    await expect(panel.locator(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`)).not.toHaveCount(0);
  });

  test('shows endpoints and config in status', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

    const panel = page.locator('.tab-panel.active');
    await panel.waitFor({ timeout: 10000 });

    // Wait for status to load
    await page.waitForSelector(`#opcuasrv-status-${OPCUA_SERVER_OBJECT} tr`);

    // Endpoints section should be visible
    const endpointsContainer = panel.locator(`#opcuasrv-endpoints-${OPCUA_SERVER_OBJECT}`);
    await expect(endpointsContainer).toBeVisible();

    // Config section should be visible
    const configContainer = panel.locator(`#opcuasrv-config-${OPCUA_SERVER_OBJECT}`);
    await expect(configContainer).toBeVisible();
  });

  test('should display sensor values for SSE updates', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

    const panel = page.locator('.tab-panel.active');
    await panel.waitFor({ timeout: 10000 });

    // Wait for sensors to load
    await page.waitForSelector(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`);

    // Check that sensor rows exist with proper structure
    const sensorRow = panel.locator(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`).first();
    await expect(sensorRow).toBeVisible();

    // Row should have data-sensor-id attribute for SSE targeting
    const sensorId = await sensorRow.getAttribute('data-sensor-id');
    expect(sensorId).toBeTruthy();

    // Value cell should exist and be visible (4th column)
    const valueCell = sensorRow.locator('td').nth(3);
    await expect(valueCell).toBeVisible();
  });

  test.describe('Variable Filtering', () => {
    test('should filter variables by name', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      // Wait for sensors to load
      await page.waitForSelector(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`);

      // Get initial row count
      const initialCount = await panel.locator(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`).count();
      expect(initialCount).toBeGreaterThan(0);

      // Enter filter text
      const filterInput = panel.locator(`#opcuasrv-sensors-filter-${OPCUA_SERVER_OBJECT}`);
      await filterInput.fill('AI');

      // Wait for debounce and reload
      await page.waitForTimeout(400);

      // Should show filtered results
      const filteredCount = await panel.locator(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`).count();
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
    });

    test('should filter variables by type using dropdown', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`);

      // Select AI type filter
      const typeFilter = panel.locator(`#opcuasrv-type-filter-${OPCUA_SERVER_OBJECT}`);
      await typeFilter.selectOption('AI');

      await page.waitForTimeout(400);

      // All visible variables should be AI type
      const rows = panel.locator(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`);
      const rowCount = await rows.count();

      // If there are AI type variables, check they have AI badge
      if (rowCount > 0) {
        const firstRow = rows.first();
        // Check first row doesn't have "Нет переменных" message
        const text = await firstRow.textContent();
        if (!text?.includes('Нет переменных')) {
          await expect(firstRow.locator('.type-AI')).toBeVisible();
        }
      }
    });

    test('should reset filter on ESC key', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      const filterInput = panel.locator(`#opcuasrv-sensors-filter-${OPCUA_SERVER_OBJECT}`);
      await filterInput.fill('TEST');
      await page.waitForTimeout(400);

      // Press ESC
      await filterInput.press('Escape');

      // Filter should be cleared
      await expect(filterInput).toHaveValue('');

      // Input should lose focus
      await expect(filterInput).not.toBeFocused();
    });

    test('should show "no variables" message when filter returns empty', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      const filterInput = panel.locator(`#opcuasrv-sensors-filter-${OPCUA_SERVER_OBJECT}`);
      await filterInput.fill('NONEXISTENT_VARIABLE_XYZ');

      await page.waitForTimeout(400);

      // Should show "no variables" message
      await expect(panel.locator(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT}`)).toContainText(/Нет переменных/);
    });
  });

  test.describe('UI Consistency', () => {
    test('should have type filter dropdown', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      // Type filter dropdown should exist
      const typeFilter = panel.locator(`#opcuasrv-type-filter-${OPCUA_SERVER_OBJECT}`);
      await expect(typeFilter).toBeVisible();

      // Should have all type options
      await expect(typeFilter.locator('option[value="all"]')).toHaveCount(1);
      await expect(typeFilter.locator('option[value="AI"]')).toHaveCount(1);
      await expect(typeFilter.locator('option[value="AO"]')).toHaveCount(1);
      await expect(typeFilter.locator('option[value="DI"]')).toHaveCount(1);
      await expect(typeFilter.locator('option[value="DO"]')).toHaveCount(1);
    });

    test('should display variable count badge', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`);

      const countBadge = panel.locator(`#opcuasrv-sensor-count-${OPCUA_SERVER_OBJECT}`);
      await expect(countBadge).toBeVisible();

      const countText = await countBadge.textContent();
      expect(parseInt(countText?.replace('+', '') || '0')).toBeGreaterThanOrEqual(0);
    });

    test('should have resize handle for variables section', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      const resizeHandle = panel.locator(`#opcuasrv-sensors-resize-${OPCUA_SERVER_OBJECT}`);
      await expect(resizeHandle).toBeVisible();
    });
  });

  test.describe('Parameters Section', () => {
    test('should display parameter values', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      // Wait for params to load
      await page.waitForSelector(`#opcuasrv-params-${OPCUA_SERVER_OBJECT} tr`);

      // Check params table has rows
      const paramsRows = panel.locator(`#opcuasrv-params-${OPCUA_SERVER_OBJECT} tr`);
      await expect(paramsRows).not.toHaveCount(0);
    });

    test('should have refresh and save buttons', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      const refreshBtn = panel.locator(`#opcuasrv-params-refresh-${OPCUA_SERVER_OBJECT}`);
      const saveBtn = panel.locator(`#opcuasrv-params-save-${OPCUA_SERVER_OBJECT}`);

      await expect(refreshBtn).toBeVisible();
      await expect(saveBtn).toBeVisible();
    });
  });

  test.describe('Chart Toggle', () => {
    test('should have chart toggle for each variable row', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`, { timeout: 10000 });

      const firstRow = panel.locator(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`).first();
      const chartToggle = firstRow.locator('.chart-toggle');
      await expect(chartToggle).toBeVisible({ timeout: 5000 });

      // Checkbox is hidden (display:none), label is visible
      const checkbox = chartToggle.locator('input[type="checkbox"]');
      const label = chartToggle.locator('.chart-toggle-label');
      await expect(checkbox).toHaveCount(1);
      await expect(label).toBeVisible();
    });

    test('should add variable to chart on checkbox click', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`, { timeout: 10000 });

      const firstRow = panel.locator(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`).first();
      const chartCheckbox = firstRow.locator('.chart-toggle input[type="checkbox"]');

      // Initially unchecked
      await expect(chartCheckbox).not.toBeChecked();

      // Click on label to toggle
      const chartLabel = firstRow.locator('.chart-toggle-label');
      await chartLabel.click();

      // Should be checked now
      await expect(chartCheckbox).toBeChecked();

      // Chart container should have a chart
      const chartsContainer = panel.locator(`#charts-${OPCUA_SERVER_OBJECT}`);
      await expect(chartsContainer.locator('.chart-wrapper')).toHaveCount(1);
    });

    test('should remove variable from chart on second click', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_SERVER_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`, { timeout: 10000 });

      const firstRow = panel.locator(`#opcuasrv-sensors-${OPCUA_SERVER_OBJECT} tr`).first();
      const chartLabel = firstRow.locator('.chart-toggle-label');
      const chartCheckbox = firstRow.locator('.chart-toggle input[type="checkbox"]');

      // Add to chart
      await chartLabel.click();
      await expect(chartCheckbox).toBeChecked();

      // Remove from chart
      await chartLabel.click();
      await expect(chartCheckbox).not.toBeChecked();
    });
  });
});
