import { test, expect } from '@playwright/test';

const OPCUA_OBJECT = 'OPCUAClient1';

test.describe('OPCUAExchange renderer', () => {
  test('shows OPCUA sections and disables control when not allowed', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

    const panel = page.locator('.tab-panel.active');
    await panel.waitFor({ timeout: 10000 });

    await expect(panel.locator('.collapsible-title', { hasText: 'Статус OPC UA' })).toBeVisible();
    await expect(panel.locator('.collapsible-title', { hasText: 'HTTP-контроль' })).toBeVisible();
    await expect(panel.locator('.collapsible-title', { hasText: 'Параметры обмена' })).toBeVisible();
    await expect(panel.locator('.collapsible-title', { hasText: /Датчики|Сенсоры OPC UA/ })).toBeVisible();
    await expect(panel.locator('.collapsible-title', { hasText: 'Диагностика' })).toBeVisible();

    const takeBtn = panel.locator(`#opcua-control-take-${OPCUA_OBJECT}`);
    const releaseBtn = panel.locator(`#opcua-control-release-${OPCUA_OBJECT}`);
    await expect(takeBtn).toBeDisabled();
    await expect(releaseBtn).toBeDisabled();

    // Проверяем индикатор "Разрешён" - должен быть красным (fail) когда контроль не разрешён
    const allowIndicator = panel.locator(`#opcua-ind-allow-${OPCUA_OBJECT}`);
    await expect(allowIndicator).toBeVisible();
    await expect(allowIndicator).toHaveClass(/fail/);

    // Проверяем что параметры загружены (readonly или writable)
    const paramsReadonly = panel.locator(`#opcua-params-readonly-${OPCUA_OBJECT} tr`);
    const paramsWritable = panel.locator(`#opcua-params-writable-${OPCUA_OBJECT} tr`);
    const paramsCount = await paramsReadonly.count() + await paramsWritable.count();
    expect(paramsCount).toBeGreaterThan(0);

    await expect(panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`)).not.toHaveCount(0);
    await expect(panel.locator(`#opcua-diagnostics-${OPCUA_OBJECT}`)).toBeVisible();
  });

  test('should display sensor values for SSE updates', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

    const panel = page.locator('.tab-panel.active');
    await panel.waitFor({ timeout: 10000 });

    // Wait for sensors to load
    await page.waitForSelector(`#opcua-sensors-${OPCUA_OBJECT} tr`);

    // Check that sensor rows exist with proper structure
    const sensorRow = panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`).first();
    await expect(sensorRow).toBeVisible();

    // Row should have data-sensor-id attribute for SSE targeting
    const sensorId = await sensorRow.getAttribute('data-sensor-id');
    expect(sensorId).toBeTruthy();

    // Value cell should exist and be visible (4th column)
    const valueCell = sensorRow.locator('td').nth(3);
    await expect(valueCell).toBeVisible();
  });

  test.describe('Sensor Filtering', () => {
    test('should filter sensors by name', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      // Wait for sensors to load
      await page.waitForSelector(`#opcua-sensors-${OPCUA_OBJECT} tr`);

      // Get initial row count
      const initialCount = await panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`).count();
      expect(initialCount).toBeGreaterThan(0);

      // Enter filter text
      const filterInput = panel.locator(`#opcua-sensors-filter-${OPCUA_OBJECT}`);
      await filterInput.fill('AI001');

      // Wait for debounce and reload
      await page.waitForTimeout(400);

      // Should show filtered results
      const filteredCount = await panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`).count();
      expect(filteredCount).toBeLessThanOrEqual(initialCount);

      // Verify filtered sensor contains the filter text
      const firstRow = panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`).first();
      await expect(firstRow).toContainText('AI001');
    });

    test('should filter sensors by type using dropdown', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcua-sensors-${OPCUA_OBJECT} tr`);

      // Select AI type filter
      const typeFilter = panel.locator(`#opcua-type-filter-${OPCUA_OBJECT}`);
      await typeFilter.selectOption('AI');

      await page.waitForTimeout(400);

      // All visible sensors should be AI type
      const rows = panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`);
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);

      // Check that at least first row contains AI badge
      const firstRow = rows.first();
      await expect(firstRow.locator('.type-AI')).toBeVisible();
    });

    test('should reset filter on ESC key', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      const filterInput = panel.locator(`#opcua-sensors-filter-${OPCUA_OBJECT}`);
      await filterInput.fill('AI001');
      await page.waitForTimeout(400);

      // Press ESC
      await filterInput.press('Escape');

      // Filter should be cleared
      await expect(filterInput).toHaveValue('');

      // Input should lose focus
      await expect(filterInput).not.toBeFocused();
    });

    test('should show "no sensors" message when filter returns empty', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      const filterInput = panel.locator(`#opcua-sensors-filter-${OPCUA_OBJECT}`);
      await filterInput.fill('NONEXISTENT_SENSOR_XYZ');

      await page.waitForTimeout(400);

      // Should show "no sensors" message
      await expect(panel.locator(`#opcua-sensors-${OPCUA_OBJECT}`)).toContainText(/Нет сенсоров/);
    });

    test('should have status filter dropdown with correct options', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      // Status filter dropdown should exist
      const statusFilter = panel.locator(`#opcua-status-filter-${OPCUA_OBJECT}`);
      await expect(statusFilter).toBeVisible();

      // Should have all status options
      await expect(statusFilter.locator('option[value="all"]')).toHaveCount(1);
      await expect(statusFilter.locator('option[value="ok"]')).toHaveCount(1);
      await expect(statusFilter.locator('option[value="bad"]')).toHaveCount(1);
    });

    test('should filter sensors by status using dropdown', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcua-sensors-${OPCUA_OBJECT} tr`);

      // Get initial row count
      const initialCount = await panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`).count();
      expect(initialCount).toBeGreaterThan(0);

      // Select "Ok" status filter
      const statusFilter = panel.locator(`#opcua-status-filter-${OPCUA_OBJECT}`);
      await statusFilter.selectOption('ok');

      await page.waitForTimeout(400);

      // All visible sensors should have OK status
      const rows = panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`);
      const rowCount = await rows.count();

      // Should have at least one row with OK status
      if (rowCount > 0) {
        // Check first row status cell (last column)
        const firstRow = rows.first();
        const statusCell = firstRow.locator('td').last();
        const statusText = await statusCell.textContent();
        expect(statusText?.toLowerCase()).toContain('ok');
      }

      // Select "Bad" status filter
      await statusFilter.selectOption('bad');
      await page.waitForTimeout(400);

      const badRows = panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`);
      const badRowCount = await badRows.count();

      // If there are bad sensors, verify they have Bad status
      if (badRowCount > 0) {
        const firstBadRow = badRows.first();
        const badStatusCell = firstBadRow.locator('td').last();
        await expect(badStatusCell).toHaveClass(/status-bad/);
      }

      // Reset to all
      await statusFilter.selectOption('all');
      await page.waitForTimeout(400);

      // Should show all sensors again
      const allCount = await panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`).count();
      expect(allCount).toBe(initialCount);
    });
  });

  test.describe('UI Consistency', () => {
    test('should have type filter dropdown', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      // Type filter dropdown should exist
      const typeFilter = panel.locator(`#opcua-type-filter-${OPCUA_OBJECT}`);
      await expect(typeFilter).toBeVisible();

      // Should have all type options
      await expect(typeFilter.locator('option[value="all"]')).toHaveCount(1);
      await expect(typeFilter.locator('option[value="AI"]')).toHaveCount(1);
      await expect(typeFilter.locator('option[value="AO"]')).toHaveCount(1);
      await expect(typeFilter.locator('option[value="DI"]')).toHaveCount(1);
      await expect(typeFilter.locator('option[value="DO"]')).toHaveCount(1);
    });

    test('should display sensor count badge', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcua-sensors-${OPCUA_OBJECT} tr`);

      const countBadge = panel.locator(`#opcua-sensor-count-${OPCUA_OBJECT}`);
      await expect(countBadge).toBeVisible();

      const countText = await countBadge.textContent();
      expect(parseInt(countText?.replace('+', '') || '0')).toBeGreaterThan(0);
    });

    test('should have type badges with correct colors', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcua-sensors-${OPCUA_OBJECT} tr`);

      // Check that type badges exist with proper classes
      const badges = panel.locator('.type-badge');
      const count = await badges.count();
      expect(count).toBeGreaterThan(0);

      // Verify first badge has correct class
      const firstBadge = badges.first();
      const badgeClass = await firstBadge.getAttribute('class');
      expect(badgeClass).toMatch(/type-(AI|AO|DI|DO)/);
    });

    test('should have resize handle for sensors section', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });

      const resizeHandle = panel.locator(`#opcua-sensors-resize-${OPCUA_OBJECT}`);
      await expect(resizeHandle).toBeVisible();
    });
  });

  test.describe('Chart Toggle', () => {
    test('should have chart toggle for each sensor row', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcua-sensors-${OPCUA_OBJECT} tr`, { timeout: 10000 });

      const firstRow = panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`).first();
      const chartToggle = firstRow.locator('.chart-toggle');
      await expect(chartToggle).toBeVisible({ timeout: 5000 });

      // Checkbox is hidden (display:none), label is visible
      const checkbox = chartToggle.locator('input[type="checkbox"]');
      const label = chartToggle.locator('.chart-toggle-label');
      await expect(checkbox).toHaveCount(1);
      await expect(label).toBeVisible();
    });

    test('should add sensor to chart on checkbox click', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcua-sensors-${OPCUA_OBJECT} tr`, { timeout: 10000 });

      const firstRow = panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`).first();
      const chartCheckbox = firstRow.locator('.chart-toggle input[type="checkbox"]');

      // Initially unchecked
      await expect(chartCheckbox).not.toBeChecked();

      // Click on label to toggle
      const chartLabel = firstRow.locator('.chart-toggle-label');
      await chartLabel.click();

      // Should be checked now
      await expect(chartCheckbox).toBeChecked();

      // Chart container should have a chart
      const chartsContainer = panel.locator(`#charts-${OPCUA_OBJECT}`);
      await expect(chartsContainer.locator('.chart-wrapper')).toHaveCount(1);
    });

    test('should remove sensor from chart on second click', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcua-sensors-${OPCUA_OBJECT} tr`, { timeout: 10000 });

      const firstRow = panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`).first();
      const chartLabel = firstRow.locator('.chart-toggle-label');
      const chartCheckbox = firstRow.locator('.chart-toggle input[type="checkbox"]');

      // Add to chart
      await chartLabel.click();
      await expect(chartCheckbox).toBeChecked();

      // Remove from chart
      await chartLabel.click();
      await expect(chartCheckbox).not.toBeChecked();
    });

    test('should create stepped chart for DI sensor', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcua-sensors-${OPCUA_OBJECT} tr`, { timeout: 10000 });

      // Find a DI type sensor row
      const diRow = panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`, { hasText: 'DI' }).first();
      await expect(diRow).toBeVisible();

      // Click on chart toggle for DI sensor
      const chartLabel = diRow.locator('.chart-toggle-label');
      await chartLabel.click();

      // Wait for chart to be created
      const chartsContainer = panel.locator(`#charts-${OPCUA_OBJECT}`);
      await expect(chartsContainer.locator('.chart-wrapper')).toHaveCount(1);

      // Get the canvas element and verify chart has stepped option
      const canvas = chartsContainer.locator('canvas').first();
      const canvasId = await canvas.getAttribute('id');

      // Verify stepped option is set to 'before' for discrete sensor
      const isStepped = await page.evaluate((id) => {
        const canvas = document.getElementById(id) as HTMLCanvasElement;
        if (!canvas) return false;
        // @ts-ignore - Chart.js stores chart instance on canvas
        const chart = Chart.getChart(canvas);
        if (!chart) return false;
        const dataset = chart.data.datasets[0];
        return dataset.stepped === 'before';
      }, canvasId);

      expect(isStepped).toBe(true);
    });

    test('should create smooth chart for AI sensor (not stepped)', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 10000 });
      await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

      const panel = page.locator('.tab-panel.active');
      await panel.waitFor({ timeout: 10000 });
      await page.waitForSelector(`#opcua-sensors-${OPCUA_OBJECT} tr`, { timeout: 10000 });

      // Find an AI type sensor row
      const aiRow = panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`, { hasText: 'AI' }).first();
      await expect(aiRow).toBeVisible();

      // Click on chart toggle for AI sensor
      const chartLabel = aiRow.locator('.chart-toggle-label');
      await chartLabel.click();

      // Wait for chart to be created
      const chartsContainer = panel.locator(`#charts-${OPCUA_OBJECT}`);
      await expect(chartsContainer.locator('.chart-wrapper')).toHaveCount(1);

      // Get the canvas element and verify chart does NOT have stepped option
      const canvas = chartsContainer.locator('canvas').first();
      const canvasId = await canvas.getAttribute('id');

      // Verify stepped option is false for analog sensor
      const isStepped = await page.evaluate((id) => {
        const canvas = document.getElementById(id) as HTMLCanvasElement;
        if (!canvas) return true; // fail if can't find
        // @ts-ignore - Chart.js stores chart instance on canvas
        const chart = Chart.getChart(canvas);
        if (!chart) return true; // fail if can't find chart
        const dataset = chart.data.datasets[0];
        return dataset.stepped === 'before';
      }, canvasId);

      expect(isStepped).toBe(false);
    });
  });
});
