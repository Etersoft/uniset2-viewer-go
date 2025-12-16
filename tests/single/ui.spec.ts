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

    // Должно быть минимум 3 объекта (UniSetActivator, TestProc, SharedMemory, OPCUAClient1)
    const count = await page.locator('#objects-list li').count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Проверяем что TestProc в списке
    await expect(page.locator('#objects-list')).toContainText('TestProc');
  });

  test('should show placeholder when no object selected', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.placeholder')).toBeVisible();
    // Плейсхолдер на русском
    await expect(page.locator('.placeholder')).toContainText('Select an object');
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
    await expect(page.locator('[data-section^="variables-"] .collapsible-title')).toContainText('Settings');
    await expect(page.locator('[data-section^="variables-"] tbody tr')).not.toHaveCount(0);
  });

  test('should display inputs and outputs sections', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    // Ждём загрузки данных (в io-section внутри io-grid)
    await page.waitForSelector('.io-grid .io-section', { timeout: 10000 });

    // Проверяем секции Входы и Выходы (в заголовке таблицы)
    await expect(page.locator('.io-grid .io-section-title', { hasText: 'Inputs' })).toBeVisible();
    await expect(page.locator('.io-grid .io-section-title', { hasText: 'Outputs' })).toBeVisible();
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

    // Ждём загрузки IO (в io-section внутри io-grid)
    await page.waitForSelector('.io-grid .io-section tbody tr', { timeout: 10000 });

    // Находим первый чекбокс в секции Входы (inputs) и кликаем на лейбл
    const firstToggleLabel = page.locator('.io-grid .io-section').first().locator('tbody tr:first-child .chart-toggle-label');
    await firstToggleLabel.click();

    // Проверяем что появился график (или хотя бы панель с графиком)
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

  test('should have time range selector in Charts section', async ({ page }) => {
    await page.goto('/');

    // Открываем объект чтобы появилась секция Графики
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    // Ждём загрузки секции графиков в активной вкладке
    const activePanel = page.locator('.tab-panel.active');
    await activePanel.waitFor({ timeout: 10000 });

    // Проверяем наличие селектора временного диапазона в секции Графики
    await expect(activePanel.locator('.charts-time-range .time-range-selector')).toBeVisible();

    // Проверяем наличие кнопок (используем exact match)
    await expect(activePanel.locator('.time-range-btn', { hasText: /^5m$/ })).toBeVisible();
    await expect(activePanel.locator('.time-range-btn', { hasText: /^15m$/ })).toBeVisible();
    await expect(activePanel.locator('.time-range-btn', { hasText: /^1h$/ })).toBeVisible();

    // По умолчанию активен 15m
    await expect(activePanel.locator('.time-range-btn', { hasText: /^15m$/ })).toHaveClass(/active/);
  });

  test('should change time range on click', async ({ page }) => {
    await page.goto('/');

    // Открываем объект
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    const activePanel = page.locator('.tab-panel.active');
    await activePanel.waitFor({ timeout: 10000 });

    // Кликаем на 5m (exact match)
    await activePanel.locator('.time-range-btn', { hasText: /^5m$/ }).click();
    await expect(activePanel.locator('.time-range-btn', { hasText: /^5m$/ })).toHaveClass(/active/);
    await expect(activePanel.locator('.time-range-btn', { hasText: /^15m$/ })).not.toHaveClass(/active/);

    // Кликаем на 1h
    await activePanel.locator('.time-range-btn', { hasText: /^1h$/ }).click();
    await expect(activePanel.locator('.time-range-btn', { hasText: /^1h$/ })).toHaveClass(/active/);
    await expect(activePanel.locator('.time-range-btn', { hasText: /^5m$/ })).not.toHaveClass(/active/);
  });

  test('should sync time range across multiple tabs', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // Открываем TestProc
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();
    await page.locator('.tab-panel.active').waitFor({ timeout: 10000 });

    // Открываем SharedMemory (или другой объект если есть)
    const smObject = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    if (await smObject.isVisible()) {
      await smObject.click();
      await page.waitForSelector('.tab-btn.active', { hasText: 'SharedMemory' });

      // Меняем диапазон на 3m в активной вкладке
      const activePanel = page.locator('.tab-panel.active');
      await activePanel.locator('.time-range-btn', { hasText: /^3m$/ }).click();

      // Переключаемся на TestProc
      await page.locator('.tab-btn', { hasText: 'TestProc' }).click();

      // Проверяем что диапазон 3m активен и там тоже
      const testProcPanel = page.locator('.tab-panel.active');
      await expect(testProcPanel.locator('.time-range-btn', { hasText: /^3m$/ })).toHaveClass(/active/);
    }
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
      await expect(page.locator('.fallback-message')).toContainText('is not supported');

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
    await expect(page.locator('.logviewer-title')).toContainText('Logs');
  });

  test('should have log level dropdown with pills', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Проверяем кнопку выбора уровня логов
    const levelBtn = page.locator('.log-level-btn');
    await expect(levelBtn).toBeVisible();
    await expect(levelBtn).toContainText('Levels');

    // Открываем dropdown
    await levelBtn.click();

    // Проверяем что dropdown открылся
    const dropdown = page.locator('.log-level-dropdown');
    await expect(dropdown).toHaveClass(/open/);

    // Проверяем наличие pills для уровней
    await expect(page.locator('.log-level-pill[data-level="CRIT"]')).toBeVisible();
    await expect(page.locator('.log-level-pill[data-level="WARN"]')).toBeVisible();
    await expect(page.locator('.log-level-pill[data-level="INFO"]')).toBeVisible();
    await expect(page.locator('.log-level-pill[data-level="DEBUG"]')).toBeVisible();
    await expect(page.locator('.log-level-pill[data-level="ANY"]')).toBeVisible();

    // Проверяем пресеты
    await expect(page.locator('.log-preset-btn[data-preset="errors"]')).toBeVisible();
    await expect(page.locator('.log-preset-btn[data-preset="all"]')).toBeVisible();

    // Закрываем dropdown кликом вне
    await page.locator('.logviewer-title').click();
    await expect(dropdown).not.toHaveClass(/open/);
  });

  test('should show connect button in LogViewer', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Проверяем кнопку подключения
    const connectBtn = page.locator('.log-connect-btn');
    await expect(connectBtn).toBeVisible();
    await expect(connectBtn).toContainText('Connect');
  });

  test('should show placeholder before connecting', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Проверяем placeholder
    const placeholder = page.locator('.log-placeholder');
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toContainText('Connect');
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

  test('should show Stop button during reconnection on connection failure', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Нажимаем кнопку подключения
    const connectBtn = page.locator('.log-connect-btn');
    await expect(connectBtn).toContainText('Connect');
    await connectBtn.click();

    // После нажатия кнопка должна показать "Остановить" (сначала при connecting, потом при reconnecting)
    // Ждём пока кнопка изменится на "Остановить"
    await expect(connectBtn).toContainText('Stop', { timeout: 5000 });

    // Проверяем что статус показывает переподключение или подключение
    // Статус текст находится в span внутри .logviewer-status (второй span после точки)
    const statusText = page.locator('.logviewer-status span:nth-child(2)');
    // Статус может быть "Подключение..." или "Переподключение..."
    await expect(statusText).toHaveText(/Connecting|Reconnecting/, { timeout: 5000 });

    // Кликаем остановить чтобы отключиться
    await connectBtn.click();

    // После остановки кнопка должна вернуться к "Подключить"
    await expect(connectBtn).toContainText('Connect', { timeout: 5000 });
    await expect(statusText).toHaveText('Disconnected', { timeout: 5000 });
  });

  // === Новые тесты на функциональность LogViewer ===

  test('should toggle level pills in dropdown', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Открываем dropdown
    await page.locator('.log-level-btn').click();
    await expect(page.locator('.log-level-dropdown')).toHaveClass(/open/);

    // Кликаем на pill CRIT
    const critPill = page.locator('.log-level-pill[data-level="CRIT"]');
    await critPill.click();
    await expect(critPill).toHaveClass(/active/);

    // Кликаем на pill WARN
    const warnPill = page.locator('.log-level-pill[data-level="WARN"]');
    await warnPill.click();
    await expect(warnPill).toHaveClass(/active/);

    // Проверяем что кнопка показывает количество выбранных
    await expect(page.locator('.log-level-btn')).toContainText('(2)');

    // Снимаем выбор с CRIT
    await critPill.click();
    await expect(critPill).not.toHaveClass(/active/);
    await expect(page.locator('.log-level-btn')).toContainText('(1)');
  });

  test('should apply level presets', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Открываем dropdown
    await page.locator('.log-level-btn').click();

    // Применяем пресет "Ошибки" (CRIT + WARN)
    await page.locator('.log-preset-btn[data-preset="errors"]').click();
    await expect(page.locator('.log-level-pill[data-level="CRIT"]')).toHaveClass(/active/);
    await expect(page.locator('.log-level-pill[data-level="WARN"]')).toHaveClass(/active/);
    await expect(page.locator('.log-level-pill[data-level="INFO"]')).not.toHaveClass(/active/);

    // Применяем пресет "Всё"
    await page.locator('.log-preset-btn[data-preset="all"]').click();
    await expect(page.locator('.log-level-pill[data-level="ANY"]')).toHaveClass(/active/);
    await expect(page.locator('.log-level-btn')).toContainText('All');

    // Сброс
    await page.locator('.log-preset-btn[data-preset="reset"]').click();
    await expect(page.locator('.log-level-pill[data-level="ANY"]')).not.toHaveClass(/active/);
    await expect(page.locator('.log-level-btn')).toContainText('Levels ▼');
  });

  test('should have filter options (Regex, Case, Only)', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Проверяем наличие input фильтра
    const filterInput = page.locator('.log-filter-input');
    await expect(filterInput).toBeVisible();

    // Проверяем наличие чекбоксов
    await expect(page.locator('.log-filter-option').filter({ hasText: 'Regex' })).toBeVisible();
    await expect(page.locator('.log-filter-option').filter({ hasText: 'Case' })).toBeVisible();
    await expect(page.locator('.log-filter-option').filter({ hasText: 'Only' })).toBeVisible();

    // По умолчанию Regex включен
    const regexCheckbox = page.locator('input[id*="log-filter-regex"]');
    await expect(regexCheckbox).toBeChecked();

    // Case и Only выключены по умолчанию
    const caseCheckbox = page.locator('input[id*="log-filter-case"]');
    await expect(caseCheckbox).not.toBeChecked();

    const onlyCheckbox = page.locator('input[id*="log-filter-only"]');
    await expect(onlyCheckbox).not.toBeChecked();
  });

  test('should have buffer size selector', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Проверяем наличие селектора размера буфера
    const bufferSelect = page.locator('.log-buffer-select');
    await expect(bufferSelect).toBeVisible();

    // По умолчанию 10000
    await expect(bufferSelect).toHaveValue('10000');

    // Проверяем наличие опций
    const options = bufferSelect.locator('option');
    await expect(options).toHaveCount(7); // 500, 1000, 2000, 5000, 10000, 20000, 50000

    // Меняем на 5000
    await bufferSelect.selectOption('5000');
    await expect(bufferSelect).toHaveValue('5000');
  });

  test('should have download button', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Проверяем наличие кнопки скачивания (дискета)
    const downloadBtn = page.locator('.log-download-btn');
    await expect(downloadBtn).toBeVisible();
    await expect(downloadBtn).toHaveText('💾');
  });

  test('should have stats display', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Проверяем наличие элемента статистики (span может быть пустым изначально)
    const stats = page.locator('.log-stats');
    await expect(stats).toHaveCount(1);

    // Stats обновляется при добавлении строк - проверяем структуру
    // Элемент существует, текст появится при получении логов
    const statsId = await stats.getAttribute('id');
    expect(statsId).toContain('log-stats-TestProc');
  });

  test('should show match count when filtering', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.logviewer-section', { timeout: 10000 });

    // Вводим текст в фильтр
    const filterInput = page.locator('.log-filter-input');
    await filterInput.fill('test');

    // Проверяем что счётчик совпадений появился (может быть 0 совп. т.к. логов нет)
    const matchCount = page.locator('.log-match-count');
    await expect(matchCount).toHaveText('0 matches', { timeout: 2000 });

    // Очищаем фильтр
    await filterInput.fill('');

    // Счётчик должен исчезнуть
    await expect(matchCount).toHaveText('');
  });

  test('should reorder sections with up/down buttons', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    // Ждём загрузки секций
    await page.waitForSelector('.reorderable-section[data-section-id]', { timeout: 10000 });

    // Получаем начальный порядок секций
    const getSectionOrder = async () => {
      return await page.evaluate(() => {
        const sections = document.querySelectorAll('.tab-panel.active .reorderable-section[data-section-id]');
        return Array.from(sections).map(s => (s as HTMLElement).dataset.sectionId);
      });
    };

    const initialOrder = await getSectionOrder();
    expect(initialOrder.length).toBeGreaterThan(2);

    // Первая секция — кнопка вверх должна быть disabled
    const firstSection = page.locator('.tab-panel.active .reorderable-section[data-section-id]').first();
    const firstUpBtn = firstSection.locator('.section-move-up');
    await expect(firstUpBtn).toBeDisabled();

    // Последняя секция — кнопка вниз должна быть disabled
    const lastSection = page.locator('.tab-panel.active .reorderable-section[data-section-id]').last();
    const lastDownBtn = lastSection.locator('.section-move-down');
    await expect(lastDownBtn).toBeDisabled();

    // Нажимаем кнопку "вниз" у первой секции (перемещаем вниз)
    const firstDownBtn = firstSection.locator('.section-move-down');
    await firstDownBtn.click();

    // Проверяем что порядок изменился
    const newOrder = await getSectionOrder();
    expect(newOrder[0]).toBe(initialOrder[1]);
    expect(newOrder[1]).toBe(initialOrder[0]);

    // Проверяем что кнопка "вверх" теперь не disabled (секция не первая)
    // Нужно заново получить первую секцию т.к. DOM изменился
    const movedSection = page.locator(`.tab-panel.active .reorderable-section[data-section-id="${initialOrder[0]}"]`);
    const movedUpBtn = movedSection.locator('.section-move-up');
    await expect(movedUpBtn).not.toBeDisabled();
  });

  test('should persist section order in localStorage', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.reorderable-section[data-section-id]', { timeout: 10000 });

    // Получаем начальный порядок
    const getSectionOrder = async () => {
      return await page.evaluate(() => {
        const sections = document.querySelectorAll('.tab-panel.active .reorderable-section[data-section-id]');
        return Array.from(sections).map(s => (s as HTMLElement).dataset.sectionId);
      });
    };

    const initialOrder = await getSectionOrder();

    // Перемещаем первую секцию вниз
    const firstSection = page.locator('.tab-panel.active .reorderable-section[data-section-id]').first();
    await firstSection.locator('.section-move-down').click();

    const orderAfterMove = await getSectionOrder();

    // Перезагружаем страницу
    await page.reload();

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'TestProc' }).click();

    await page.waitForSelector('.reorderable-section[data-section-id]', { timeout: 10000 });

    // Проверяем что порядок восстановился
    const orderAfterReload = await getSectionOrder();
    expect(orderAfterReload).toEqual(orderAfterMove);
    expect(orderAfterReload).not.toEqual(initialOrder);
  });

  // === Тесты на группы серверов ===

  test('should display server groups for connected servers with green status dot', async ({ page }) => {
    await page.goto('/');

    // Ждём загрузки списка объектов
    await page.waitForSelector('.server-group', { timeout: 10000 });

    // Проверяем что есть группы серверов
    const groupHeaders = page.locator('.server-group-header');
    await expect(groupHeaders.first()).toBeVisible();

    // Все status dots должны быть без класса disconnected (сервер подключён)
    const statusDots = page.locator('.server-group-header .server-status-dot');
    const allDots = await statusDots.all();
    for (const dot of allDots) {
      await expect(dot).not.toHaveClass(/disconnected/);
    }
  });

  test('should display server group with disconnected status when server is down', async ({ page }) => {
    // Мокаем ответ API чтобы симулировать отключённый сервер
    await page.route('**/api/all-objects', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 2,
          objects: [
            {
              serverId: 'test-server-1',
              serverName: 'Connected Server',
              connected: true,
              objects: ['TestObj1']
            },
            {
              serverId: 'test-server-2',
              serverName: 'Disconnected Server',
              connected: false,
              objects: ['TestObj2']
            }
          ]
        })
      });
    });

    await page.route('**/api/servers', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 2,
          servers: [
            { id: 'test-server-1', url: 'http://localhost:9191', name: 'Connected Server', connected: true },
            { id: 'test-server-2', url: 'http://localhost:9393', name: 'Disconnected Server', connected: false }
          ]
        })
      });
    });

    await page.goto('/');

    // Ждём загрузки списка объектов
    await page.waitForSelector('.server-group', { timeout: 10000 });

    // Находим заголовок группы подключённого сервера
    const connectedGroup = page.locator('.server-group[data-server-id="test-server-1"] .server-group-header');
    await expect(connectedGroup).toBeVisible();
    const connectedDot = connectedGroup.locator('.server-status-dot');
    await expect(connectedDot).not.toHaveClass(/disconnected/);

    // Находим заголовок группы отключённого сервера
    const disconnectedGroup = page.locator('.server-group[data-server-id="test-server-2"] .server-group-header');
    await expect(disconnectedGroup).toBeVisible();
    const disconnectedDot = disconnectedGroup.locator('.server-status-dot');
    await expect(disconnectedDot).toHaveClass(/disconnected/);
  });

  test('should have clear cache button', async ({ page }) => {
    await page.goto('/');

    // Проверяем наличие кнопки очистки кэша
    const clearCacheBtn = page.locator('#clear-cache');
    await expect(clearCacheBtn).toBeVisible();
    await expect(clearCacheBtn).toHaveAttribute('title', 'Clear cache (LocalStorage)');
  });

  test('should clear localStorage on clear cache button click', async ({ page }) => {
    await page.goto('/');

    // Добавляем что-то в localStorage
    await page.evaluate(() => {
      localStorage.setItem('test-key', 'test-value');
    });

    // Проверяем что localStorage не пуст
    const beforeClear = await page.evaluate(() => localStorage.length);
    expect(beforeClear).toBeGreaterThan(0);

    // Устанавливаем обработчик диалога подтверждения
    page.on('dialog', async dialog => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('Clear all saved settings');
      await dialog.accept();
    });

    // Кликаем на кнопку очистки кэша
    await page.locator('#clear-cache').click();

    // Страница должна перезагрузиться, ждём загрузки
    await page.waitForLoadState('domcontentloaded');

    // Проверяем что localStorage очищен (кроме настроек которые создаются при загрузке)
    const afterClear = await page.evaluate(() => localStorage.getItem('test-key'));
    expect(afterClear).toBeNull();
  });

  test('should display server status indicators in sidebar for multi-server setup', async ({ page }) => {
    // Мокаем ответ API с несколькими серверами
    await page.route('**/api/all-objects', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 2,
          objects: [
            { serverId: 'srv1', serverName: 'Server1', connected: true, objects: ['Obj1'] },
            { serverId: 'srv2', serverName: 'Server2', connected: false, objects: ['Obj2'] }
          ]
        })
      });
    });

    await page.route('**/api/servers', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 2,
          servers: [
            { id: 'srv1', url: 'http://server1', name: 'Server1', connected: true },
            { id: 'srv2', url: 'http://server2', name: 'Server2', connected: false }
          ]
        })
      });
    });

    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // Проверяем что секция серверов в sidebar появилась
    const serversSection = page.locator('#servers-section');
    await expect(serversSection).toBeVisible();

    // Проверяем счётчик серверов
    const serversCount = page.locator('#servers-count');
    await expect(serversCount).toHaveText('2');

    // Проверяем индикаторы серверов
    const connectedItem = page.locator('.server-item[data-server-id="srv1"]');
    await expect(connectedItem).toBeVisible();
    await expect(connectedItem).toHaveClass(/connected/);

    const disconnectedItem = page.locator('.server-item[data-server-id="srv2"]');
    await expect(disconnectedItem).toBeVisible();
    await expect(disconnectedItem).toHaveClass(/disconnected/);

    // Проверяем имена серверов
    await expect(connectedItem.locator('.server-name')).toHaveText('Server1');
    await expect(disconnectedItem.locator('.server-name')).toHaveText('Server2');
  });

  test('should display server status in sidebar for single server setup', async ({ page }) => {
    // Мокаем ответ API с одним сервером
    await page.route('**/api/all-objects', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          objects: [
            { serverId: 'srv1', serverName: 'Server1', connected: true, objects: ['Obj1'] }
          ]
        })
      });
    });

    await page.route('**/api/servers', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          servers: [{ id: 'srv1', url: 'http://server1', name: 'Server1', connected: true }]
        })
      });
    });

    await page.goto('/');
    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // Секция серверов должна быть видна даже для одного сервера
    const serversSection = page.locator('#servers-section');
    await expect(serversSection).toBeVisible();

    // Счётчик показывает 1
    const serversCount = page.locator('#servers-count');
    await expect(serversCount).toHaveText('1');

    // Сервер должен отображаться
    const serverItem = page.locator('.server-item[data-server-id="srv1"]');
    await expect(serverItem).toBeVisible();
  });

  test('should show correct tooltip for server items in sidebar', async ({ page }) => {
    // Мокаем ответ API
    await page.route('**/api/all-objects', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 2,
          objects: [
            {
              serverId: 'srv1',
              serverName: 'Server1',
              connected: true,
              objects: ['Obj1']
            },
            {
              serverId: 'srv2',
              serverName: 'Server2',
              connected: false,
              objects: ['Obj2']
            }
          ]
        })
      });
    });

    await page.route('**/api/servers', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 2,
          servers: [
            { id: 'srv1', url: 'http://server1', name: 'Server1', connected: true },
            { id: 'srv2', url: 'http://server2', name: 'Server2', connected: false }
          ]
        })
      });
    });

    await page.goto('/');

    await page.waitForSelector('.server-item', { timeout: 10000 });

    // Проверяем title для сервера (показывает URL)
    const server1Name = page.locator('.server-item[data-server-id="srv1"] .server-name');
    await expect(server1Name).toHaveAttribute('title', 'http://server1');

    const server2Name = page.locator('.server-item[data-server-id="srv2"] .server-name');
    await expect(server2Name).toHaveAttribute('title', 'http://server2');
  });

  test('should disable tab panel when server disconnects', async ({ page }) => {
    // Мокаем API для получения списка объектов
    await page.route('**/api/all-objects', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          objects: [
            {
              serverId: 'srv1',
              serverName: 'Server1',
              connected: true,
              objects: ['TestProc']
            }
          ]
        })
      });
    });

    // Мокаем API для данных объекта
    await page.route('**/api/objects/TestProc**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          object: {
            Name: 'TestProc',
            Variables: { var1: '100' }
          }
        })
      });
    });

    // Мокаем API серверов
    await page.route('**/api/servers', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          servers: [
            { id: 'srv1', url: 'http://server1', name: 'Server1', connected: true }
          ]
        })
      });
    });

    await page.goto('/');
    await page.waitForSelector('#objects-list li');

    // Открываем таб
    await page.click('#objects-list li');
    await page.waitForSelector('.tab-panel.active');

    // Проверяем что таб активен и не имеет класса server-disconnected
    const tabPanel = page.locator('.tab-panel.active');
    await expect(tabPanel).not.toHaveClass(/server-disconnected/);

    const tabBtn = page.locator('.tab-btn[data-server-id="srv1"]');
    await expect(tabBtn).not.toHaveClass(/server-disconnected/);

    // Симулируем SSE событие отключения сервера
    await page.evaluate(() => {
      const event = new CustomEvent('server_status_test');
      // Вызываем функцию updateServerStatus напрямую
      (window as any).updateServerStatus?.('srv1', false);
    });

    // Ждем применения класса
    await page.waitForTimeout(100);

    // Проверяем что таб стал неактивным
    await expect(tabPanel).toHaveClass(/server-disconnected/);
    await expect(tabBtn).toHaveClass(/server-disconnected/);
  });

  test('should re-enable tab panel when server reconnects', async ({ page }) => {
    // Мокаем API для получения списка объектов
    await page.route('**/api/all-objects', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          objects: [
            {
              serverId: 'srv1',
              serverName: 'Server1',
              connected: true,
              objects: ['TestProc']
            }
          ]
        })
      });
    });

    // Мокаем API для данных объекта
    await page.route('**/api/objects/TestProc**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          object: {
            Name: 'TestProc',
            Variables: { var1: '100' }
          }
        })
      });
    });

    // Мокаем API серверов
    await page.route('**/api/servers', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          servers: [
            { id: 'srv1', url: 'http://server1', name: 'Server1', connected: true }
          ]
        })
      });
    });

    await page.goto('/');
    await page.waitForSelector('#objects-list li');

    // Открываем таб
    await page.click('#objects-list li');
    await page.waitForSelector('.tab-panel.active');

    const tabPanel = page.locator('.tab-panel.active');
    const tabBtn = page.locator('.tab-btn[data-server-id="srv1"]');

    // Симулируем отключение сервера
    await page.evaluate(() => {
      (window as any).updateServerStatus?.('srv1', false);
    });
    await page.waitForTimeout(100);

    // Проверяем что таб стал неактивным
    await expect(tabPanel).toHaveClass(/server-disconnected/);
    await expect(tabBtn).toHaveClass(/server-disconnected/);

    // Симулируем восстановление связи
    await page.evaluate(() => {
      (window as any).updateServerStatus?.('srv1', true);
    });
    await page.waitForTimeout(100);

    // Проверяем что таб снова активен
    await expect(tabPanel).not.toHaveClass(/server-disconnected/);
    await expect(tabBtn).not.toHaveClass(/server-disconnected/);
  });

  test('should show overlay message when tab is disabled', async ({ page }) => {
    // Мокаем API для получения списка объектов
    await page.route('**/api/all-objects', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          objects: [
            {
              serverId: 'srv1',
              serverName: 'Server1',
              connected: true,
              objects: ['TestProc']
            }
          ]
        })
      });
    });

    // Мокаем API для данных объекта
    await page.route('**/api/objects/TestProc**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          object: {
            Name: 'TestProc',
            Variables: { var1: '100' }
          }
        })
      });
    });

    // Мокаем API серверов
    await page.route('**/api/servers', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          servers: [
            { id: 'srv1', url: 'http://server1', name: 'Server1', connected: true }
          ]
        })
      });
    });

    await page.goto('/');
    await page.waitForSelector('#objects-list li');

    // Открываем таб
    await page.click('#objects-list li');
    await page.waitForSelector('.tab-panel.active');

    const tabPanel = page.locator('.tab-panel.active');

    // Симулируем отключение сервера
    await page.evaluate(() => {
      (window as any).updateServerStatus?.('srv1', false);
    });
    await page.waitForTimeout(100);

    // Проверяем наличие CSS ::after с текстом через computed style
    const hasOverlay = await tabPanel.evaluate((el) => {
      const style = window.getComputedStyle(el, '::after');
      return style.content.includes('Сервер недоступен');
    });
    expect(hasOverlay).toBe(true);
  });

});
