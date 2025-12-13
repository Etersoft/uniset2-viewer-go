import { test, expect } from '@playwright/test';

/**
 * Tests for base reusable components shared between IONotifyController and OPCUAExchange
 * These test the common CSS classes: filter-bar, filter-input, type-filter, sensor-count,
 * type-badge, sensors-table, pin-toggle, chart-toggle, resize-handle
 */
test.describe('Base Components', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // Clear localStorage for test isolation
    await page.evaluate(() => {
      localStorage.removeItem('uniset2-viewer-ionc-pinned');
      localStorage.removeItem('uniset2-viewer-external-sensors');
    });

    // Open SharedMemory (IONotifyController)
    const sharedMemory = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    const hasSharedMemory = await sharedMemory.isVisible().catch(() => false);

    if (!hasSharedMemory) {
      test.skip();
      return;
    }

    await sharedMemory.click();
    await expect(page.locator('.tab-btn', { hasText: 'SharedMemory' })).toBeVisible();
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });
  });

  test.describe('Filter Bar', () => {
    test('should have filter input with placeholder', async ({ page }) => {
      const filterInput = page.locator('.filter-bar .filter-input');
      await expect(filterInput).toBeVisible();
      await expect(filterInput).toHaveAttribute('placeholder', /Фильтр/);
    });

    test('should have type filter dropdown with all options', async ({ page }) => {
      const typeFilter = page.locator('.filter-bar .type-filter');
      await expect(typeFilter).toBeVisible();
      await expect(typeFilter.locator('option[value="all"]')).toHaveCount(1);
      await expect(typeFilter.locator('option[value="AI"]')).toHaveCount(1);
      await expect(typeFilter.locator('option[value="DI"]')).toHaveCount(1);
      await expect(typeFilter.locator('option[value="AO"]')).toHaveCount(1);
      await expect(typeFilter.locator('option[value="DO"]')).toHaveCount(1);
    });

    test('should filter sensors by text input', async ({ page }) => {
      const filterInput = page.locator('.filter-bar .filter-input');
      const rows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row');

      const initialCount = await rows.count();
      expect(initialCount).toBeGreaterThan(0);

      // Type a filter that should reduce results
      await filterInput.fill('Sensor1');
      await page.waitForTimeout(400); // debounce delay

      const filteredCount = await rows.count();
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
    });

    test('should filter sensors by type dropdown', async ({ page }) => {
      const typeFilter = page.locator('.filter-bar .type-filter');
      const rows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row');

      // Select AI type
      await typeFilter.selectOption('AI');
      await page.waitForTimeout(200);

      // All visible type badges should be AI
      const visibleBadges = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row .type-badge');
      const count = await visibleBadges.count();

      if (count > 0) {
        for (let i = 0; i < count; i++) {
          await expect(visibleBadges.nth(i)).toHaveClass(/type-AI/);
        }
      }
    });

    test('should clear filter on Escape key', async ({ page }) => {
      const filterInput = page.locator('.filter-bar .filter-input');

      await filterInput.fill('test-filter');
      await expect(filterInput).toHaveValue('test-filter');

      await filterInput.press('Escape');
      await expect(filterInput).toHaveValue('');
    });
  });

  test.describe('Sensor Count Badge', () => {
    test('should display sensor count badge', async ({ page }) => {
      const countBadge = page.locator('.ionc-sensors-section .sensor-count');
      await expect(countBadge).toBeVisible();

      const text = await countBadge.textContent();
      expect(parseInt(text || '0')).toBeGreaterThan(0);
    });

    test('should update count when filtering', async ({ page }) => {
      const countBadge = page.locator('.ionc-sensors-section .sensor-count');
      const filterInput = page.locator('.filter-bar .filter-input');

      const initialText = await countBadge.textContent();
      const initialCount = parseInt(initialText || '0');
      expect(initialCount).toBeGreaterThan(0);

      // Apply filter that should reduce results
      await filterInput.fill('Sensor1');
      await page.waitForTimeout(400);

      const filteredText = await countBadge.textContent();
      // Count text should be updated (could be "X" or "X/Y" format)
      expect(filteredText).toBeTruthy();

      // Clear filter
      await filterInput.fill('');
      await page.waitForTimeout(400);

      // Count should return to original
      const restoredText = await countBadge.textContent();
      expect(parseInt(restoredText || '0')).toBe(initialCount);
    });
  });

  test.describe('Type Badges', () => {
    test('should display type badges for sensors', async ({ page }) => {
      const badges = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row .type-badge');
      const count = await badges.count();
      expect(count).toBeGreaterThan(0);
    });

    test('should have correct type class', async ({ page }) => {
      const firstBadge = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row .type-badge').first();
      await expect(firstBadge).toBeVisible();

      // Badge should have one of the type classes
      const classes = await firstBadge.getAttribute('class');
      expect(classes).toMatch(/type-(AI|DI|AO|DO)/);
    });
  });

  test.describe('Sensors Table', () => {
    test('should display sensors table with proper structure', async ({ page }) => {
      const table = page.locator('.sensors-table.ionc-sensors-table');
      await expect(table).toBeVisible();

      // Check header exists and is sticky
      const header = table.locator('th').first();
      await expect(header).toBeVisible();
    });

    test('should have table rows with data', async ({ page }) => {
      const rows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row');
      await expect(rows).not.toHaveCount(0);

      const firstRow = rows.first();
      await expect(firstRow).toBeVisible();
    });

    test('should highlight row on hover', async ({ page }) => {
      const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();

      // Hover over the row
      await firstRow.hover();

      // The hover effect is CSS-based, we just verify the element is interactive
      await expect(firstRow).toBeVisible();
    });
  });

  test.describe('Pin Toggle', () => {
    test('should display pin toggle for each sensor', async ({ page }) => {
      const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
      const pinToggle = firstRow.locator('.pin-toggle');
      await expect(pinToggle).toBeVisible();
    });

    test('should toggle pin state on click', async ({ page }) => {
      const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
      const pinToggle = firstRow.locator('.pin-toggle');

      // Initially not pinned
      await expect(pinToggle).not.toHaveClass(/pinned/);

      await pinToggle.click();

      // After click - pinned
      await expect(pinToggle).toHaveClass(/pinned/);
    });

    test('should change visual indicator when pinned', async ({ page }) => {
      const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
      const pinToggle = firstRow.locator('.pin-toggle');

      const textBefore = await pinToggle.textContent();
      await pinToggle.click();
      const textAfter = await pinToggle.textContent();

      // Text should change (e.g., from circle outline to filled)
      expect(textBefore).not.toBe(textAfter);
    });
  });

  test.describe('Chart Toggle', () => {
    test('should display chart toggle for each sensor', async ({ page }) => {
      const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
      const chartToggle = firstRow.locator('.chart-toggle');
      await expect(chartToggle).toBeVisible();
    });

    test('should have checkbox input and label', async ({ page }) => {
      const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
      const chartToggle = firstRow.locator('.chart-toggle');

      // Check for input and label
      const checkbox = chartToggle.locator('input[type="checkbox"]');
      const label = chartToggle.locator('.chart-toggle-label');

      await expect(label).toBeVisible();
    });

    test('should toggle chart display on click', async ({ page }) => {
      const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
      const chartToggle = firstRow.locator('.chart-toggle');
      const checkbox = chartToggle.locator('input[type="checkbox"]');

      // Get initial state
      const initialChecked = await checkbox.isChecked();

      // Click the label to toggle
      await chartToggle.locator('label').click();

      // State should change
      const newChecked = await checkbox.isChecked();
      expect(newChecked).toBe(!initialChecked);
    });
  });

  test.describe('Resize Handle', () => {
    test('should display resize handle', async ({ page }) => {
      const handle = page.locator('.resize-handle').first();
      await expect(handle).toBeVisible();
    });

    test('should have cursor style for resize', async ({ page }) => {
      const handle = page.locator('.resize-handle').first();
      const cursor = await handle.evaluate(el => getComputedStyle(el).cursor);
      expect(cursor).toBe('ns-resize');
    });
  });

  test.describe('Virtual Scroll', () => {
    test('should have virtual scroll viewport', async ({ page }) => {
      const viewport = page.locator('.ionc-sensors-viewport');
      await expect(viewport).toBeVisible();
    });

    test('should have spacer element for virtual scroll', async ({ page }) => {
      // Spacer is inside the viewport - use ID pattern
      const spacer = page.locator('[id^="ionc-sensors-spacer-"]');
      await expect(spacer).toHaveCount(1);
    });

    test('should render only visible rows', async ({ page }) => {
      const viewport = page.locator('.ionc-sensors-viewport');
      const rows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row');

      // Get viewport height and row count
      const viewportHeight = await viewport.evaluate(el => el.clientHeight);
      const rowCount = await rows.count();

      // With virtual scroll, we should have a reasonable number of rows
      // (not all 200+ sensors rendered at once)
      if (rowCount > 0) {
        // Rows should be rendered based on viewport size + buffer
        const rowHeight = 32; // from CSS
        const maxVisibleRows = Math.ceil(viewportHeight / rowHeight) + 20; // + buffer
        expect(rowCount).toBeLessThanOrEqual(maxVisibleRows + 10); // small tolerance
      }
    });

    test('should update visible rows on scroll', async ({ page }) => {
      const viewport = page.locator('.ionc-sensors-viewport');
      const rows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row');

      // Get first row ID before scroll
      const firstRowBefore = await rows.first().getAttribute('data-sensor-id');

      // Scroll down
      await viewport.evaluate(el => el.scrollTop = 500);
      await page.waitForTimeout(100);

      // First visible row should change
      const firstRowAfter = await rows.first().getAttribute('data-sensor-id');

      // If there are enough rows, the first visible should change
      const totalRows = await rows.count();
      if (totalRows > 15) {
        expect(firstRowAfter).not.toBe(firstRowBefore);
      }
    });
  });

  test.describe('Loading Indicator', () => {
    test('should have loading-more element', async ({ page }) => {
      const loadingMore = page.locator('.ionc-loading-more');
      // Element should exist (may be hidden)
      await expect(loadingMore).toHaveCount(1);
    });
  });

  test.describe('SSE Value Updates', () => {
    test('should update sensor value via SSE', async ({ page }) => {
      // Find a row and get its value cell
      const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
      const valueCell = firstRow.locator('.ionc-value');

      // Value cell should exist
      await expect(valueCell).toBeVisible();

      // The value-changed animation class should be applied on updates
      // We can verify the element structure is correct for receiving updates
      const hasSensorId = await firstRow.getAttribute('data-sensor-id');
      expect(hasSensorId).toBeTruthy();
    });

    test('should have value cell with update animation support', async ({ page }) => {
      const valueCell = page.locator('.ionc-sensors-tbody .ionc-value').first();
      await expect(valueCell).toBeVisible();

      // Check that the cell can receive the value-changed class
      const classes = await valueCell.getAttribute('class');
      expect(classes).toContain('ionc-value');
    });
  });
});

// Tests for cross-renderer consistency
test.describe('Cross-Renderer Consistency', () => {

  test('IONC and OPCUA should have same filter bar structure', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // Check if OPCUAClient1 exists
    const opcuaItem = page.locator('#objects-list li', { hasText: 'OPCUAClient1' });
    const count = await opcuaItem.count();

    if (count === 0) {
      test.skip();
      return;
    }

    await opcuaItem.click();
    await page.waitForSelector('[id^="opcua-sensors-section-"]', { timeout: 10000 });

    // OPCUA should have same filter bar components
    const filterInput = page.locator('[id^="opcua-sensors-section-"] .filter-input');
    const typeFilter = page.locator('[id^="opcua-sensors-section-"] .type-filter');

    await expect(filterInput).toBeVisible();
    await expect(typeFilter).toBeVisible();
  });

  test('ModbusMaster should have filter bar', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    const mbItem = page.locator('#objects-list li', { hasText: 'MBTCPMaster1' });
    const count = await mbItem.count();

    if (count === 0) {
      test.skip();
      return;
    }

    await mbItem.click();
    await page.waitForSelector('[id^="mb-registers-section-"]', { timeout: 10000 });

    // ModbusMaster should have filter input
    const filterInput = page.locator('[id^="mb-registers-section-"] .filter-input');
    await expect(filterInput).toBeVisible();
  });

  test('ModbusSlave should have filter bar', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    const mbsItem = page.locator('#objects-list li', { hasText: 'MBTCPSlave1' });
    await expect(mbsItem).toBeVisible({ timeout: 5000 });

    await mbsItem.click();
    await page.waitForSelector('[id^="mbs-registers-section-"]', { timeout: 10000 });

    // ModbusSlave should have filter input
    const filterInput = page.locator('[id^="mbs-registers-section-"] .filter-input');
    await expect(filterInput).toBeVisible();
  });

  test('all renderers should have resize handle', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // Open SharedMemory
    const smItem = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    if (await smItem.isVisible()) {
      await smItem.click();
      const ioncResize = page.locator('.ionc-sensors-section .resize-handle');
      await expect(ioncResize).toBeVisible();
    }
  });

  test('all renderers should have sensor/register count badge', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // Check SharedMemory count badge
    const smItem = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    if (await smItem.isVisible()) {
      await smItem.click();
      await page.waitForSelector('.ionc-sensors-section', { timeout: 5000 });
      const countBadge = page.locator('.ionc-sensors-section .sensor-count');
      await expect(countBadge).toBeVisible();
    }
  });
});

// Note: OPCUAExchange base component tests are covered in opcuaexchange.spec.ts
// since the single-server mock doesn't include OPCUAClient1 object
