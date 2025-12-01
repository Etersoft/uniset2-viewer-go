import { test, expect } from '@playwright/test';

test.describe('UniSet2 Viewer UI', () => {

  test('should load main page with title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('UniSet2 Viewer');
    await expect(page.locator('h1')).toHaveText('UniSet2 Viewer');
  });

  test('should display objects list (not empty)', async ({ page }) => {
    await page.goto('/');

    // Ждём загрузки списка объектов (не должен быть пустым)
    await expect(page.locator('#objects-list li')).not.toHaveCount(0, { timeout: 10000 });

    // Должно быть минимум 2 объекта
    await expect(page.locator('#objects-list li')).toHaveCount(2, { timeout: 5000 });

    // Проверяем что TestProc в списке
    await expect(page.locator('#objects-list')).toContainText('TestProc');
  });

  test('should show placeholder when no object selected', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.placeholder')).toBeVisible();
    // Плейсхолдер на русском
    await expect(page.locator('.placeholder')).toContainText('Выберите объект');
  });

  test('should open object tab on click', async ({ page }) => {
    await page.goto('/');

    // Ждём загрузки списка
    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // Кликаем на TestProc
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    // Проверяем что открылась вкладка
    await expect(page.locator('.tab-btn', { hasText: 'TestProc' })).toBeVisible();
    await expect(page.locator('.tab-btn', { hasText: 'TestProc' })).toHaveClass(/active/);

    // Проверяем что placeholder исчез
    await expect(page.locator('.placeholder')).not.toBeVisible();
  });

  test('should display variables table', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    // Ждём загрузки переменных
    await page.waitForSelector('.variables-section tbody tr', { timeout: 10000 });

    // Проверяем наличие таблицы переменных (заголовок на русском)
    await expect(page.locator('.variables-section .section-header')).toContainText('Переменные');
    await expect(page.locator('.variables-section tbody tr')).not.toHaveCount(0);
  });

  test('should display inputs and outputs sections', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    // Ждём загрузки данных
    await page.waitForSelector('.io-section', { timeout: 10000 });

    // Проверяем секции Входы и Выходы
    await expect(page.locator('.io-section-title', { hasText: 'Входы' })).toBeVisible();
    await expect(page.locator('.io-section-title', { hasText: 'Выходы' })).toBeVisible();
  });

  test('should close tab on close button click', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    // Ждём появления вкладки
    await expect(page.locator('.tab-btn', { hasText: 'TestProc' })).toBeVisible();

    // Закрываем вкладку
    await page.locator('.tab-btn .close').click();

    // Проверяем что вкладка закрылась
    await expect(page.locator('.tab-btn', { hasText: 'TestProc' })).not.toBeVisible();
    await expect(page.locator('.placeholder')).toBeVisible();
  });

  test('should refresh objects list on button click', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    const initialCount = await page.locator('#objects-list li').count();

    // Кликаем Refresh
    await page.locator('#refresh-objects').click();

    // После рефреша количество объектов должно остаться тем же
    await expect(page.locator('#objects-list li')).toHaveCount(initialCount);
  });

  test('should enable chart for IO variable', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    // Ждём загрузки IO
    await page.waitForSelector('.io-section tbody tr', { timeout: 10000 });

    // Находим первый чекбокс в секции Входы (inputs) и кликаем на лейбл
    const firstToggleLabel = page.locator('.io-section').first().locator('tbody tr:first-child .chart-toggle-label');
    await firstToggleLabel.click();

    // Проверяем что появился график
    await expect(page.locator('.chart-panel')).toBeVisible({ timeout: 5000 });
  });

  test('should switch between multiple tabs', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // Открываем TestProc
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();
    await expect(page.locator('.tab-btn', { hasText: 'TestProc' })).toHaveClass(/active/);

    // Открываем UniSetActivator
    const activator = page.locator('#objects-list li', { hasText: 'UniSetActivator' });
    if (await activator.isVisible()) {
      await activator.click();

      // Проверяем что появилась вторая вкладка
      await expect(page.locator('.tab-btn')).toHaveCount(2);
      await expect(page.locator('.tab-btn', { hasText: 'UniSetActivator' })).toHaveClass(/active/);

      // Переключаемся обратно на TestProc
      await page.locator('.tab-btn', { hasText: 'TestProc' }).click();
      await expect(page.locator('.tab-btn', { hasText: 'TestProc' })).toHaveClass(/active/);
    }
  });

  test('should have time range selector', async ({ page }) => {
    await page.goto('/');

    // Проверяем наличие селектора временного диапазона
    await expect(page.locator('.time-range-selector')).toBeVisible();
    await expect(page.locator('.time-range-btn[data-range="300"]')).toBeVisible();
    await expect(page.locator('.time-range-btn[data-range="900"]')).toBeVisible();
    await expect(page.locator('.time-range-btn[data-range="3600"]')).toBeVisible();

    // По умолчанию активен 15m (900 секунд)
    await expect(page.locator('.time-range-btn[data-range="900"]')).toHaveClass(/active/);
  });

  test('should change time range on click', async ({ page }) => {
    await page.goto('/');

    // Кликаем на 5m (300 секунд)
    await page.locator('.time-range-btn[data-range="300"]').click();
    await expect(page.locator('.time-range-btn[data-range="300"]')).toHaveClass(/active/);
    await expect(page.locator('.time-range-btn[data-range="900"]')).not.toHaveClass(/active/);

    // Кликаем на 1h (3600 секунд)
    await page.locator('.time-range-btn[data-range="3600"]').click();
    await expect(page.locator('.time-range-btn[data-range="3600"]')).toHaveClass(/active/);
    await expect(page.locator('.time-range-btn[data-range="300"]')).not.toHaveClass(/active/);
  });

});
