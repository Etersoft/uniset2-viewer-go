import { test, expect } from '@playwright/test';

const UNET_OBJECT = 'UNetExchange';

test.describe('UNetExchange renderer', () => {
  test('should display UNetExchange object in list and open tab', async ({ page }) => {
    await page.goto('/');

    // Wait for objects list
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    // Check that UNetExchange exists
    const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
    await expect(unetItem).toBeVisible({ timeout: 10000 });

    // Click on UNetExchange
    await unetItem.click();

    // Wait for tab and panel to appear
    const tabBtn = page.locator('.tab-btn', { hasText: UNET_OBJECT });
    await expect(tabBtn).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.tab-panel.active');
    await expect(panel).toBeVisible({ timeout: 10000 });
  });

  test('should have UNetExchange-specific sections', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
    await unetItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Check for UNetExchange-specific sections
    const statusSection = page.locator(`#unet-status-section-${UNET_OBJECT}`);
    await expect(statusSection).toBeVisible({ timeout: 5000 });

    const receiversSection = page.locator(`#unet-receivers-section-${UNET_OBJECT}`);
    await expect(receiversSection).toBeVisible({ timeout: 5000 });

    const sendersSection = page.locator(`#unet-senders-section-${UNET_OBJECT}`);
    await expect(sendersSection).toBeVisible({ timeout: 5000 });
  });

  test('should display status information', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
    await unetItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for status to load
    await page.waitForTimeout(1000);

    // Check status section has content (status-grid with items)
    const statusGrid = page.locator(`#unet-status-${UNET_OBJECT} .status-grid`);
    await expect(statusGrid).toBeVisible({ timeout: 5000 });

    // Should show Active/Inactive status
    const statusValue = statusGrid.locator('.status-value').first();
    await expect(statusValue).toBeVisible();
  });

  test('should display receivers table', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
    await unetItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for receivers to load
    await page.waitForTimeout(1000);

    // Check receivers tbody
    const receiversTbody = page.locator(`#unet-receivers-tbody-${UNET_OBJECT}`);
    await expect(receiversTbody).toBeVisible({ timeout: 5000 });

    // Should have receiver rows
    const receiverRows = page.locator(`#unet-receivers-tbody-${UNET_OBJECT} tr`);
    await expect(receiverRows.first()).toBeVisible({ timeout: 5000 });
  });

  test('should display senders table', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
    await unetItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });

    // Wait for senders to load
    await page.waitForTimeout(1000);

    // Check senders tbody
    const sendersTbody = page.locator(`#unet-senders-tbody-${UNET_OBJECT}`);
    await expect(sendersTbody).toBeVisible({ timeout: 5000 });

    // Should have sender rows
    const senderRows = page.locator(`#unet-senders-tbody-${UNET_OBJECT} tr`);
    await expect(senderRows.first()).toBeVisible({ timeout: 5000 });
  });

  test('should display receiver channel info', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
    await unetItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Check first receiver row has expected columns
    const firstRow = page.locator(`#unet-receivers-tbody-${UNET_OBJECT} tr`).first();

    // Node column
    const nodeCell = firstRow.locator('.col-node');
    await expect(nodeCell).toBeVisible();

    // Channel column
    const channelCell = firstRow.locator('.col-channel');
    await expect(channelCell).toBeVisible();

    // Transport column
    const transportCell = firstRow.locator('.col-transport');
    await expect(transportCell).toBeVisible();

    // Mode column (ACTIVE/PASSIVE)
    const modeCell = firstRow.locator('.col-mode');
    await expect(modeCell).toBeVisible();

    // Status column (OK/ERR)
    const statusCell = firstRow.locator('.col-status');
    await expect(statusCell).toBeVisible();
  });

  test('should display Object Information section', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 15000 });

    const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
    await unetItem.click();

    await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
    await page.waitForTimeout(1500);

    // Check Object Information section exists and has content
    const objectInfoTbody = page.locator(`#object-info-${UNET_OBJECT}`);
    await expect(objectInfoTbody).toBeVisible({ timeout: 5000 });

    // Should have rows with object info
    const infoRows = objectInfoTbody.locator('tr');
    const count = await infoRows.count();
    expect(count).toBeGreaterThan(0);
  });

  test.describe('Chart Toggle', () => {
    test('should have chart toggle for each receiver row', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
      await unetItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#unet-receivers-tbody-${UNET_OBJECT} tr`, { timeout: 10000 });

      const firstRow = page.locator(`#unet-receivers-tbody-${UNET_OBJECT} tr`).first();
      const chartToggle = firstRow.locator('.chart-toggle');
      await expect(chartToggle).toBeVisible({ timeout: 5000 });

      const checkbox = chartToggle.locator('input[type="checkbox"]');
      const label = chartToggle.locator('.chart-toggle-label');
      await expect(checkbox).toHaveCount(1);
      await expect(label).toBeVisible();
    });

    test('should create multiple metric charts on receiver toggle', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
      await unetItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#unet-receivers-tbody-${UNET_OBJECT} tr`, { timeout: 10000 });

      const firstRow = page.locator(`#unet-receivers-tbody-${UNET_OBJECT} tr`).first();
      const chartLabel = firstRow.locator('.chart-toggle-label');

      // Click on chart toggle
      await chartLabel.click();

      // Should create 5 charts (one per receiver metric)
      const chartsContainer = page.locator(`#charts-${UNET_OBJECT}`);
      await expect(chartsContainer.locator('.chart-panel')).toHaveCount(5, { timeout: 5000 });

      // Verify chart titles
      const chartTitles = await chartsContainer.locator('.chart-panel-title').allTextContents();
      expect(chartTitles).toContain('Recv: Recv/s');
      expect(chartTitles).toContain('Recv: Lost Packets');
      expect(chartTitles).toContain('Recv: Updates/s');
      expect(chartTitles).toContain('Recv: Queue Size');
      expect(chartTitles).toContain('Recv: Cache Missed');
    });

    test('should add second channel to existing charts', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
      await unetItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#unet-receivers-tbody-${UNET_OBJECT} tr`, { timeout: 10000 });

      const rows = page.locator(`#unet-receivers-tbody-${UNET_OBJECT} tr`);
      const rowCount = await rows.count();

      if (rowCount >= 2) {
        // Add first channel
        const firstLabel = rows.first().locator('.chart-toggle-label');
        await firstLabel.click();
        await page.waitForTimeout(500);

        // Add second channel
        const secondLabel = rows.nth(1).locator('.chart-toggle-label');
        await secondLabel.click();
        await page.waitForTimeout(500);

        // Should still have 5 charts (not 10)
        const chartsContainer = page.locator(`#charts-${UNET_OBJECT}`);
        await expect(chartsContainer.locator('.chart-panel')).toHaveCount(5);

        // Each chart should have legend with 2 items
        const firstChart = chartsContainer.locator('.chart-panel').first();
        const canvas = firstChart.locator('canvas');
        const canvasId = await canvas.getAttribute('id');

        const datasetsCount = await page.evaluate((id) => {
          const canvas = document.getElementById(id) as HTMLCanvasElement;
          if (!canvas) return 0;
          // @ts-ignore
          const chart = Chart.getChart(canvas);
          return chart?.data?.datasets?.length || 0;
        }, canvasId);

        expect(datasetsCount).toBe(2);
      }
    });

    test('should remove channel from charts on toggle off', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
      await unetItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#unet-receivers-tbody-${UNET_OBJECT} tr`, { timeout: 10000 });

      const firstRow = page.locator(`#unet-receivers-tbody-${UNET_OBJECT} tr`).first();
      const chartLabel = firstRow.locator('.chart-toggle-label');
      const chartCheckbox = firstRow.locator('.chart-toggle input[type="checkbox"]');

      // Add to charts
      await chartLabel.click();
      await expect(chartCheckbox).toBeChecked();

      const chartsContainer = page.locator(`#charts-${UNET_OBJECT}`);
      await expect(chartsContainer.locator('.chart-panel')).toHaveCount(5);

      // Remove from charts
      await chartLabel.click();
      await expect(chartCheckbox).not.toBeChecked();

      // Charts should be removed (no channels left)
      await expect(chartsContainer.locator('.chart-panel')).toHaveCount(0);
    });

    test('should have chart toggle for sender rows', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
      await unetItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#unet-senders-tbody-${UNET_OBJECT} tr`, { timeout: 10000 });

      const firstRow = page.locator(`#unet-senders-tbody-${UNET_OBJECT} tr`).first();
      const chartToggle = firstRow.locator('.chart-toggle');
      await expect(chartToggle).toBeVisible({ timeout: 5000 });
    });

    test('should create sender metric chart on toggle', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
      await unetItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForSelector(`#unet-senders-tbody-${UNET_OBJECT} tr`, { timeout: 10000 });

      const firstRow = page.locator(`#unet-senders-tbody-${UNET_OBJECT} tr`).first();
      const chartLabel = firstRow.locator('.chart-toggle-label');

      // Click on chart toggle
      await chartLabel.click();

      // Should create 1 chart (sender has only lastpacknum metric)
      const chartsContainer = page.locator(`#charts-${UNET_OBJECT}`);
      await expect(chartsContainer.locator('.chart-panel')).toHaveCount(1, { timeout: 5000 });

      // Verify chart title
      const chartTitle = await chartsContainer.locator('.chart-panel-title').textContent();
      expect(chartTitle).toContain('Send: Pack#');
    });
  });

  test.describe('LogServer and LogViewer', () => {
    test('should display LogServer section', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
      await unetItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForTimeout(1500);

      // Check LogServer section
      const logServerSection = page.locator(`[data-section="logserver-${UNET_OBJECT}"]`);
      await expect(logServerSection).toBeVisible({ timeout: 5000 });
    });

    test('should display Logs section', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#objects-list li', { timeout: 15000 });

      const unetItem = page.locator('#objects-list li', { hasText: UNET_OBJECT });
      await unetItem.click();

      await page.waitForSelector('.tab-panel.active', { timeout: 10000 });
      await page.waitForTimeout(1500);

      // Check Logs section exists
      const logsSection = page.locator(`[data-section="logs-${UNET_OBJECT}"]`);
      await expect(logsSection).toBeVisible({ timeout: 5000 });
    });
  });
});
