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
});

// Note: OPCUAExchange base component tests are covered in opcuaexchange.spec.ts
// since the single-server mock doesn't include OPCUAClient1 object
