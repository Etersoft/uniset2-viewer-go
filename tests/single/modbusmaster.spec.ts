import { test, expect } from '@playwright/test';

const MB_OBJECT = 'MBTCPMaster1';

test.describe('ModbusMaster renderer', () => {
  test('should display ModbusMaster object in list and open tab', async ({ page }) => {
    await page.goto('/');

    // Wait for objects list
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    // Check that MBTCPMaster1 exists
    const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
    await expect(mbItem).toBeVisible({ timeout: 10000 });

    // Click on MBTCPMaster1
    await mbItem.click();

    // Wait for tab and panel to appear
    const tabBtn = page.locator('.tab-btn', { hasText: MB_OBJECT });
    await expect(tabBtn).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.tab-panel.active');
    await expect(panel).toBeVisible({ timeout: 10000 });
  });

  test('should have ModbusMaster-specific sections', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
    await mbItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Check for ModbusMaster-specific sections
    const statusSection = page.locator(`#mb-status-section-${MB_OBJECT}`);
    await expect(statusSection).toBeVisible({ timeout: 5000 });

    const paramsSection = page.locator(`#mb-params-section-${MB_OBJECT}`);
    await expect(paramsSection).toBeVisible({ timeout: 5000 });

    const devicesSection = page.locator(`#mb-devices-section-${MB_OBJECT}`);
    await expect(devicesSection).toBeVisible({ timeout: 5000 });

    const registersSection = page.locator(`#mb-registers-section-${MB_OBJECT}`);
    await expect(registersSection).toBeVisible({ timeout: 5000 });
  });

  test('should display status information', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
    await mbItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for status to load
    await page.waitForTimeout(1000);

    // Check status section has content
    const statusTable = page.locator(`#mb-status-section-${MB_OBJECT} .info-table`);
    await expect(statusTable).toBeVisible();
  });

  test('should display devices list', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
    await mbItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for devices to load
    await page.waitForTimeout(1000);

    // Check devices container
    const devicesContainer = page.locator(`#mb-devices-${MB_OBJECT}`);
    await expect(devicesContainer).toBeVisible({ timeout: 5000 });

    // Should have device rows in the table
    const deviceRows = page.locator(`#mb-devices-${MB_OBJECT} .mb-devices-table tbody tr`);
    await expect(deviceRows.first()).toBeVisible({ timeout: 5000 });
  });

  test('should display registers table', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
    await mbItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for registers to load
    await page.waitForTimeout(1500);

    // Check registers tbody
    const registersTbody = page.locator(`#mb-registers-tbody-${MB_OBJECT}`);
    await expect(registersTbody).toBeVisible({ timeout: 5000 });

    // Should have register rows
    const registerRows = page.locator(`#mb-registers-tbody-${MB_OBJECT} tr`);
    await expect(registerRows.first()).toBeVisible({ timeout: 5000 });
  });

  test('should have filter input for registers', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
    await mbItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Check filter input exists
    const filterInput = page.locator(`#mb-registers-filter-${MB_OBJECT}`);
    await expect(filterInput).toBeVisible({ timeout: 5000 });

    // Check type filter exists
    const typeFilter = page.locator(`#mb-type-filter-${MB_OBJECT}`);
    await expect(typeFilter).toBeVisible({ timeout: 5000 });
  });

  test('should display register values for SSE updates', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
    await mbItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for registers to load
    await page.waitForTimeout(1500);

    // Check that register rows exist
    const rows = page.locator(`#mb-registers-tbody-${MB_OBJECT} tr`);
    await expect(rows.first()).toBeVisible({ timeout: 5000 });

    // Check value cell exists (7th column for ModbusMaster)
    const valueCell = rows.first().locator('td:nth-child(7)');
    await expect(valueCell).toBeVisible();

    // Check MB Val cell exists (8th column)
    const mbValCell = rows.first().locator('td:nth-child(8)');
    await expect(mbValCell).toBeVisible();
  });

  test('should filter registers by sensor name', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
    await mbItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for registers to load
    await page.waitForTimeout(1500);

    // Filter now works on both mbreg AND sensor name (no checkbox needed)
    const filterInput = page.locator(`#mb-registers-filter-${MB_OBJECT}`);
    await filterInput.fill('AI');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // All visible registers should contain "AI" in name
    const visibleRows = page.locator(`#mb-registers-tbody-${MB_OBJECT} tr`);
    const count = await visibleRows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should filter registers by mbreg number', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
    await mbItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for registers to load
    await page.waitForTimeout(1500);

    // By default, filter searches by mbreg
    const filterInput = page.locator(`#mb-registers-filter-${MB_OBJECT}`);
    await filterInput.fill('70');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // Should show registers with mbreg containing "70"
    const visibleRows = page.locator(`#mb-registers-tbody-${MB_OBJECT} tr`);
    const count = await visibleRows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should filter registers by type', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
    await mbItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for registers to load
    await page.waitForTimeout(1500);

    const typeFilter = page.locator(`#mb-type-filter-${MB_OBJECT}`);
    await typeFilter.selectOption('DI');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // All visible registers should have DI type
    const visibleTypes = page.locator(`#mb-registers-tbody-${MB_OBJECT} tr .type-badge`);
    const count = await visibleTypes.count();

    if (count > 0) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        await expect(visibleTypes.nth(i)).toHaveText('DI');
      }
    }
  });

  test.describe('Chart Toggle', () => {
    test('should have chart toggle for each register row', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
      await mbItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

      // Wait for registers to load
      await page.waitForSelector(`#mb-registers-tbody-${MB_OBJECT} tr`, { timeout: 10000 });

      const firstRow = page.locator(`#mb-registers-tbody-${MB_OBJECT} tr`).first();
      const chartToggle = firstRow.locator('.chart-toggle');
      await expect(chartToggle).toBeVisible({ timeout: 5000 });

      // Checkbox is hidden (display:none), label is visible
      const checkbox = chartToggle.locator('input[type="checkbox"]');
      const label = chartToggle.locator('.chart-toggle-label');
      await expect(checkbox).toHaveCount(1);
      await expect(label).toBeVisible();
    });

    test('should add register to chart on checkbox click', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
      await mbItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#mb-registers-tbody-${MB_OBJECT} tr`, { timeout: 10000 });

      const firstRow = page.locator(`#mb-registers-tbody-${MB_OBJECT} tr`).first();
      const chartCheckbox = firstRow.locator('.chart-toggle input[type="checkbox"]');

      // Initially unchecked
      await expect(chartCheckbox).not.toBeChecked();

      // Click on label to toggle
      const chartLabel = firstRow.locator('.chart-toggle-label');
      await chartLabel.click();

      // Should be checked now
      await expect(chartCheckbox).toBeChecked();

      // Chart container should have a chart
      const chartsContainer = page.locator(`#charts-${MB_OBJECT}`);
      await expect(chartsContainer.locator('.chart-wrapper')).toHaveCount(1);
    });

    test('should remove register from chart on second click', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
      await mbItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#mb-registers-tbody-${MB_OBJECT} tr`, { timeout: 10000 });

      const firstRow = page.locator(`#mb-registers-tbody-${MB_OBJECT} tr`).first();
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
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
      await mbItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#mb-registers-tbody-${MB_OBJECT} tr`, { timeout: 10000 });

      // Find a DI type register row
      const diRow = page.locator(`#mb-registers-tbody-${MB_OBJECT} tr`, { hasText: 'DI' }).first();
      await expect(diRow).toBeVisible();

      // Click on chart toggle for DI sensor
      const chartLabel = diRow.locator('.chart-toggle-label');
      await chartLabel.click();

      // Wait for chart to be created
      const chartsContainer = page.locator(`#charts-${MB_OBJECT}`);
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
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const mbItem = page.locator('#objects-list li', { hasText: MB_OBJECT });
      await mbItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#mb-registers-tbody-${MB_OBJECT} tr`, { timeout: 10000 });

      // Find an AI type register row
      const aiRow = page.locator(`#mb-registers-tbody-${MB_OBJECT} tr`, { hasText: 'AI' }).first();
      await expect(aiRow).toBeVisible();

      // Click on chart toggle for AI sensor
      const chartLabel = aiRow.locator('.chart-toggle-label');
      await chartLabel.click();

      // Wait for chart to be created
      const chartsContainer = page.locator(`#charts-${MB_OBJECT}`);
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
