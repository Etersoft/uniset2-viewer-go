import { test, expect } from '@playwright/test';

const OPCUA_OBJECT = 'OPCUAClient1';

test.describe('OPCUAExchange renderer', () => {
  test.beforeEach(async ({ page }) => {
    // Ускоряем автообновление статуса в тестах
    await page.addInitScript(({ name }) => {
      try {
        const saved = JSON.parse(localStorage.getItem('uniset2-viewer-opcua-status-interval') || '{}');
        saved[name] = 1000;
        localStorage.setItem('uniset2-viewer-opcua-status-interval', JSON.stringify(saved));
      } catch (err) {
        console.warn('failed to init status interval', err);
      }
    }, { name: OPCUA_OBJECT });
  });

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
    await expect(panel.locator('.opcua-flag-row', { hasText: 'Разрешён контроль:' })).toContainText('Нет');

    await expect(panel.locator(`#opcua-status-autorefresh-${OPCUA_OBJECT}`)).toBeVisible();
    await expect(panel.locator('.opcua-interval-btn[data-ms="5000"]')).toBeVisible();

    await expect(panel.locator(`#opcua-params-${OPCUA_OBJECT} tr`)).not.toHaveCount(0);
    await expect(panel.locator(`#opcua-sensors-${OPCUA_OBJECT} tr`)).not.toHaveCount(0);
    await expect(panel.locator(`#opcua-diagnostics-${OPCUA_OBJECT}`)).toBeVisible();
  });

  test('auto-refreshes status with configured interval', async ({ page }) => {
    let statusHits = 0;
    page.on('response', (response) => {
      if (response.url().includes('/opcua/status')) {
        statusHits += 1;
      }
    });

    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: OPCUA_OBJECT }).click();

    const panel = page.locator('.tab-panel.active');
    await panel.waitFor({ timeout: 10000 });

    // Дождаться первого запроса статуса
    await page.waitForResponse((resp) => resp.url().includes('/opcua/status'));
    const startHits = statusHits;

    // Ждём, чтобы автообновление сработало хотя бы один раз
    await page.waitForTimeout(2200);
    expect(statusHits).toBeGreaterThan(startHits);

    // Переключаем интервал и проверяем, что активность обновляется визуально
    const btn10s = panel.locator('.opcua-interval-btn', { hasText: '10с' });
    await btn10s.click();
    await expect(btn10s).toHaveClass(/active/);
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
});
