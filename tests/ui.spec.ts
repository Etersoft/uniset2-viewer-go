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

    // Ждём загрузки переменных (в collapsible секции)
    await page.waitForSelector('[data-section^="variables-"] tbody tr', { timeout: 10000 });

    // Проверяем наличие таблицы настроек (раздел переименован в Настройки)
    await expect(page.locator('[data-section^="variables-"] .collapsible-title')).toContainText('Настройки');
    await expect(page.locator('[data-section^="variables-"] tbody tr')).not.toHaveCount(0);
  });

  test('should display inputs and outputs sections', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    // Ждём загрузки данных (в collapsible секциях внутри io-grid)
    await page.waitForSelector('.io-grid .collapsible-section', { timeout: 10000 });

    // Проверяем секции Входы и Выходы
    await expect(page.locator('.io-grid .collapsible-title', { hasText: 'Входы' })).toBeVisible();
    await expect(page.locator('.io-grid .collapsible-title', { hasText: 'Выходы' })).toBeVisible();
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

    // Ждём загрузки IO (в collapsible секции внутри io-grid)
    await page.waitForSelector('.io-grid .collapsible-section tbody tr', { timeout: 10000 });

    // Находим первый чекбокс в секции Входы (inputs) и кликаем на лейбл
    const firstToggleLabel = page.locator('.io-grid .collapsible-section').first().locator('tbody tr:first-child .chart-toggle-label');
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

  test('should show fallback renderer for unsupported object types', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // UniSetActivator имеет тип который не поддерживается явно (не UniSetManager/UniSetObject)
    const activator = page.locator('#objects-list li', { hasText: 'UniSetActivator' });
    if (await activator.isVisible()) {
      await activator.click();

      // Ждём открытия вкладки
      await expect(page.locator('.tab-btn', { hasText: 'UniSetActivator' })).toBeVisible();
      await expect(page.locator('.tab-btn', { hasText: 'UniSetActivator' })).toHaveClass(/active/);

      // Проверяем что отображается fallback warning
      await expect(page.locator('.fallback-warning')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.fallback-message')).toContainText('не поддерживается');

      // Проверяем что есть сырой JSON
      await expect(page.locator('.fallback-json')).toBeVisible();

      // Проверяем что JSON содержит данные об объекте
      const jsonContent = await page.locator('.fallback-json').textContent();
      expect(jsonContent).toContain('object');
    }
  });

  test('should display object type badge in fallback renderer', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    const activator = page.locator('#objects-list li', { hasText: 'UniSetActivator' });
    if (await activator.isVisible()) {
      await activator.click();

      // Ждём загрузки fallback контента
      await expect(page.locator('.fallback-warning')).toBeVisible({ timeout: 10000 });

      // Ждём пока тип объекта появится в сообщении (заполняется при update после SSE/polling)
      await expect(page.locator('.fallback-type')).toContainText('UniSetActivator', { timeout: 10000 });
    }
  });

  // === LogViewer тесты ===

  test('should display LogViewer section for objects with LogServer', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    // Ждём загрузки данных объекта
    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Проверяем секцию Логи
    await expect(page.locator('.logviewer-section')).toBeVisible();
    await expect(page.locator('.logviewer-title')).toContainText('Логи');
  });

  test('should have log level selector with default option', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Проверяем селектор уровня логов
    const levelSelect = page.locator('.log-level-select');
    await expect(levelSelect).toBeVisible();

    // По умолчанию выбрано "По умолчанию" (value="0")
    await expect(levelSelect).toHaveValue('0');

    // Проверяем наличие опций (опции внутри select скрыты, проверяем их количество)
    const options = levelSelect.locator('option');
    await expect(options).toHaveCount(6); // По умолчанию, CRIT, WARN+, INFO+, DEBUG+, ALL
  });

  test('should show connect button in LogViewer', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Проверяем кнопку подключения
    const connectBtn = page.locator('.log-connect-btn');
    await expect(connectBtn).toBeVisible();
    await expect(connectBtn).toContainText('Подключить');
  });

  test('should show placeholder before connecting', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Проверяем placeholder
    const placeholder = page.locator('.log-placeholder');
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toContainText('Подключить');
  });

  test('should toggle LogViewer section collapse', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    const section = page.locator('.logviewer-section');
    const content = page.locator('.logviewer-content');

    // Секция должна быть развёрнута по умолчанию
    await expect(content).toBeVisible();

    // Кликаем на заголовок (на title, не на controls) для сворачивания
    await page.locator('.logviewer-title').click();
    await expect(section).toHaveClass(/collapsed/);

    // Кликаем снова для разворачивания
    await page.locator('.logviewer-title').click();
    await expect(section).not.toHaveClass(/collapsed/);
  });

  test('should have resize handle in LogViewer', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Проверяем наличие resize handle
    await expect(page.locator('.logviewer-resize-handle')).toBeVisible();
  });

});
