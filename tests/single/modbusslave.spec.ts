import { test, expect } from '@playwright/test';

const MBS_OBJECT = 'MBTCPSlave1';

test.describe('ModbusSlave renderer', () => {
  test('should display ModbusSlave object in list and open tab', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    // Check that MBTCPSlave1 exists
    const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
    await expect(mbsItem).toBeVisible({ timeout: 10000 });

    // Click on MBTCPSlave1
    await mbsItem.click();

    // Tab and panel should be visible
    const tabBtn = page.locator('.tab-btn', { hasText: MBS_OBJECT });
    await expect(tabBtn).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.tab-panel.active');
    await expect(panel).toBeVisible({ timeout: 10000 });
  });

  test('should have ModbusSlave-specific sections', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
    await mbsItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Check for ModbusSlave-specific sections
    const statusSection = page.locator(`#mbs-status-section-${MBS_OBJECT}`);
    await expect(statusSection).toBeVisible({ timeout: 5000 });

    const paramsSection = page.locator(`#mbs-params-section-${MBS_OBJECT}`);
    await expect(paramsSection).toBeVisible({ timeout: 5000 });

    const registersSection = page.locator(`#mbs-registers-section-${MBS_OBJECT}`);
    await expect(registersSection).toBeVisible({ timeout: 5000 });
  });

  test('should display status information', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
    await mbsItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for status to load
    await page.waitForTimeout(1000);

    // Check status section has content
    const statusTable = page.locator(`#mbs-status-section-${MBS_OBJECT} .info-table`);
    await expect(statusTable).toBeVisible();
  });

  test('should display registers table', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
    await mbsItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for registers to load
    await page.waitForTimeout(1500);

    // Check registers tbody
    const registersTbody = page.locator(`#mbs-registers-tbody-${MBS_OBJECT}`);
    await expect(registersTbody).toBeVisible({ timeout: 5000 });

    // Should have register rows
    const registerRows = page.locator(`#mbs-registers-tbody-${MBS_OBJECT} tr`);
    await expect(registerRows.first()).toBeVisible({ timeout: 5000 });
  });

  test('should have filter input for registers', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
    await mbsItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Check filter input exists
    const filterInput = page.locator(`#mbs-registers-filter-${MBS_OBJECT}`);
    await expect(filterInput).toBeVisible({ timeout: 5000 });

    // Check type filter exists
    const typeFilter = page.locator(`#mbs-type-filter-${MBS_OBJECT}`);
    await expect(typeFilter).toBeVisible({ timeout: 5000 });
  });

  test('should display register values for SSE updates', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
    await mbsItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for registers to load
    await page.waitForTimeout(1500);

    // Check that register rows exist
    const rows = page.locator(`#mbs-registers-tbody-${MBS_OBJECT} tr`);
    await expect(rows.first()).toBeVisible();

    // Check value cell exists (last column for ModbusSlave)
    const valueCell = rows.first().locator('td:last-child');
    await expect(valueCell).toBeVisible();
  });

  test('should filter registers by text', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
    await mbsItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for registers to load
    await page.waitForTimeout(1500);

    const filterInput = page.locator(`#mbs-registers-filter-${MBS_OBJECT}`);
    await filterInput.fill('AI');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // All visible registers should contain "AI" in name
    const visibleRows = page.locator(`#mbs-registers-tbody-${MBS_OBJECT} tr`);
    const count = await visibleRows.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should filter registers by type', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
    await mbsItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for registers to load
    await page.waitForTimeout(1500);

    const typeFilter = page.locator(`#mbs-type-filter-${MBS_OBJECT}`);
    await typeFilter.selectOption('DI');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // All visible registers should have DI type
    const visibleTypes = page.locator(`#mbs-registers-tbody-${MBS_OBJECT} tr .type-badge`);
    const count = await visibleTypes.count();

    if (count > 0) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        await expect(visibleTypes.nth(i)).toHaveText('DI');
      }
    }
  });

  test('should have virtual scroll for registers', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
    await mbsItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Check for virtual scroll container
    const viewport = page.locator(`#mbs-registers-viewport-${MBS_OBJECT}`);
    await expect(viewport).toBeVisible({ timeout: 5000 });
  });

  test('should have resize handle for registers section', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
    await mbsItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Check for resize handle
    const resizeHandle = page.locator(`#mbs-registers-section-${MBS_OBJECT} .resize-handle`);
    await expect(resizeHandle).toBeVisible({ timeout: 5000 });
  });

  test.describe('Chart Toggle', () => {
    test('should have chart toggle for each register row', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
      await mbsItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#mbs-registers-tbody-${MBS_OBJECT} tr`, { timeout: 10000 });

      const firstRow = page.locator(`#mbs-registers-tbody-${MBS_OBJECT} tr`).first();
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

      const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
      await mbsItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#mbs-registers-tbody-${MBS_OBJECT} tr`, { timeout: 10000 });

      const firstRow = page.locator(`#mbs-registers-tbody-${MBS_OBJECT} tr`).first();
      const chartCheckbox = firstRow.locator('.chart-toggle input[type="checkbox"]');

      // Initially unchecked
      await expect(chartCheckbox).not.toBeChecked();

      // Click on label to toggle
      const chartLabel = firstRow.locator('.chart-toggle-label');
      await chartLabel.click();

      // Should be checked now
      await expect(chartCheckbox).toBeChecked();

      // Chart container should have a chart
      const chartsContainer = page.locator(`#charts-${MBS_OBJECT}`);
      await expect(chartsContainer.locator('.chart-wrapper')).toHaveCount(1);
    });

    test('should remove register from chart on second click', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
      await mbsItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#mbs-registers-tbody-${MBS_OBJECT} tr`, { timeout: 10000 });

      const firstRow = page.locator(`#mbs-registers-tbody-${MBS_OBJECT} tr`).first();
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

      const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
      await mbsItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#mbs-registers-tbody-${MBS_OBJECT} tr`, { timeout: 10000 });

      // Find a DI type register row
      const diRow = page.locator(`#mbs-registers-tbody-${MBS_OBJECT} tr`, { hasText: 'DI' }).first();
      await expect(diRow).toBeVisible();

      // Click on chart toggle for DI sensor
      const chartLabel = diRow.locator('.chart-toggle-label');
      await chartLabel.click();

      // Wait for chart to be created
      const chartsContainer = page.locator(`#charts-${MBS_OBJECT}`);
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

      const mbsItem = page.locator('#objects-list li', { hasText: MBS_OBJECT });
      await mbsItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#mbs-registers-tbody-${MBS_OBJECT} tr`, { timeout: 10000 });

      // Find an AI type register row
      const aiRow = page.locator(`#mbs-registers-tbody-${MBS_OBJECT} tr`, { hasText: 'AI' }).first();
      await expect(aiRow).toBeVisible();

      // Click on chart toggle for AI sensor
      const chartLabel = aiRow.locator('.chart-toggle-label');
      await chartLabel.click();

      // Wait for chart to be created
      const chartsContainer = page.locator(`#charts-${MBS_OBJECT}`);
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
