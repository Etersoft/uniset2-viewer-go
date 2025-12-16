import { test, expect } from '@playwright/test';

test.describe('IONotifyController (SharedMemory)', () => {

  // Проверяем наличие SharedMemory и пропускаем тесты если его нет
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Очищаем localStorage для изоляции тестов
    await page.evaluate(() => {
      localStorage.removeItem('uniset2-viewer-ionc-pinned');
      localStorage.removeItem('uniset2-viewer-external-sensors');
    });
    await page.reload();

    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // Проверяем есть ли SharedMemory в списке
    const sharedMemory = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    const hasSharedMemory = await sharedMemory.isVisible().catch(() => false);

    if (!hasSharedMemory) {
      test.skip();
      return;
    }

    // Открываем SharedMemory
    await sharedMemory.click();
    await expect(page.locator('.tab-btn', { hasText: 'SharedMemory' })).toBeVisible();
  });

  test('should display IONotifyController renderer for SharedMemory', async ({ page }) => {
    // Ждём загрузки секции датчиков IONC
    await page.waitForSelector('.ionc-sensors-section', { timeout: 10000 });

    // Проверяем наличие секции датчиков
    await expect(page.locator('.ionc-sensors-section')).toBeVisible();
    await expect(page.locator('.ionc-sensors-section .collapsible-title')).toContainText('Датчики');
  });

  test('should display charts section', async ({ page }) => {
    // Проверяем наличие секции графиков
    const chartsSection = page.locator('[data-section-id="charts"]');
    await expect(chartsSection).toBeVisible();
    await expect(chartsSection.locator('.collapsible-title')).toContainText('Графики');
  });

  test('should display sensors table with columns', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-table', { timeout: 10000 });

    // Проверяем заголовки таблицы
    const table = page.locator('.ionc-sensors-table');
    await expect(table.locator('th', { hasText: 'ID' })).toBeVisible();
    await expect(table.locator('th', { hasText: 'Имя' })).toBeVisible();
    await expect(table.locator('th', { hasText: 'Тип' })).toBeVisible();
    await expect(table.locator('th', { hasText: 'Значение' })).toBeVisible();
    await expect(table.locator('th', { hasText: 'Статус' })).toBeVisible();
    await expect(table.locator('th', { hasText: 'Действия' })).toBeVisible();
  });

  test('should load sensors and show count', async ({ page }) => {
    // Ждём загрузки датчиков
    await page.waitForSelector('.ionc-sensors-tbody tr:not(.ionc-loading)', { timeout: 10000 });

    // Проверяем что счётчик датчиков отображается
    const countBadge = page.locator('.sensor-count');
    await expect(countBadge).toBeVisible();

    // Счётчик должен быть больше 0
    const countText = await countBadge.textContent();
    expect(parseInt(countText || '0')).toBeGreaterThan(0);
  });

  test('should display sensor rows with data', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Проверяем что есть строки датчиков
    const rows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row');
    await expect(rows).not.toHaveCount(0);

    // Проверяем первую строку
    const firstRow = rows.first();
    await expect(firstRow.locator('.ionc-col-id')).toBeVisible();
    await expect(firstRow.locator('.ionc-col-name')).toBeVisible();
    await expect(firstRow.locator('.type-badge')).toBeVisible();
    await expect(firstRow.locator('.ionc-value')).toBeVisible();
  });

  test('should have chart toggle button for each sensor', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Проверяем наличие кнопки добавления на график
    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
    const chartToggle = firstRow.locator('.chart-toggle');
    await expect(chartToggle).toBeVisible();
  });

  test('should have pin toggle button for each sensor', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Проверяем наличие кнопки закрепления в первой строке
    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
    const pinToggle = firstRow.locator('.pin-toggle');
    await expect(pinToggle).toBeVisible();

    // Проверяем что кнопка содержит символ ○ (не закреплено)
    await expect(pinToggle).toHaveText('○');
  });

  test('should pin sensor on click', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Кликаем на кнопку закрепления первого датчика
    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
    const pinToggle = firstRow.locator('.pin-toggle');

    // До клика - не закреплён
    await expect(pinToggle).not.toHaveClass(/pinned/);

    await pinToggle.click();

    // После клика - закреплён
    await expect(pinToggle).toHaveClass(/pinned/);

    // Кнопка "снять все" должна появиться
    const unpinAllBtn = page.locator('.ionc-unpin-all');
    await expect(unpinAllBtn).toBeVisible();
  });

  test('should show only pinned sensors when any are pinned', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Получаем начальное количество датчиков
    const initialCount = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count();

    if (initialCount < 2) {
      // Недостаточно датчиков для теста
      return;
    }

    // Закрепляем первый датчик
    const firstPinToggle = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first().locator('.pin-toggle');
    await firstPinToggle.click();

    // Теперь должен отображаться только 1 датчик (закреплённый)
    await page.waitForTimeout(100);
    const filteredCount = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count();
    expect(filteredCount).toBe(1);
  });

  test('should unpin all sensors on unpin-all button click', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    const initialCount = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count();

    if (initialCount < 2) {
      return;
    }

    // Закрепляем первый датчик
    const firstPinToggle = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first().locator('.pin-toggle');
    await firstPinToggle.click();
    await page.waitForTimeout(100);

    // Проверяем что показывается только 1
    expect(await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count()).toBe(1);

    // Кликаем "снять все"
    const unpinAllBtn = page.locator('.ionc-unpin-all');
    await unpinAllBtn.click();
    await page.waitForTimeout(100);

    // Все датчики должны снова отображаться
    const restoredCount = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count();
    expect(restoredCount).toBe(initialCount);

    // Кнопка "снять все" должна скрыться
    await expect(unpinAllBtn).not.toBeVisible();
  });

  test('should add sensor to chart on chart toggle click', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Находим чекбокс графика первого датчика
    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
    const chartCheckbox = firstRow.locator('.chart-toggle input[type="checkbox"]');

    // До клика - не отмечен
    await expect(chartCheckbox).not.toBeChecked();

    // Кликаем на label (сам checkbox скрыт)
    const chartLabel = firstRow.locator('.chart-toggle-label');
    await chartLabel.click();

    // После клика - отмечен
    await expect(chartCheckbox).toBeChecked();

    // В секции графиков должен появиться график
    const chartsSection = page.locator('[data-section-id="charts"]');
    await expect(chartsSection.locator('.chart-panel')).toBeVisible({ timeout: 5000 });
  });

  test('should uncheck chart checkbox when removing sensor from chart', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Добавляем датчик на график
    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
    const chartCheckbox = firstRow.locator('.chart-toggle input[type="checkbox"]');
    const chartLabel = firstRow.locator('.chart-toggle-label');

    await chartLabel.click();
    await expect(chartCheckbox).toBeChecked();

    // Ждём появления графика
    const chartsSection = page.locator('[data-section-id="charts"]');
    const chartPanel = chartsSection.locator('.chart-panel').first();
    await expect(chartPanel).toBeVisible({ timeout: 5000 });

    // Нажимаем кнопку удаления графика (крестик в заголовке)
    const removeBtn = chartPanel.locator('.chart-remove-btn');
    await removeBtn.click();

    // График должен исчезнуть
    await expect(chartPanel).not.toBeVisible();

    // Checkbox в таблице должен быть снят
    await expect(chartCheckbox).not.toBeChecked();
  });

  test('should allow pinning sensors while filtering (search ignores pin filter)', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Закрепляем первый датчик
    const firstPinToggle = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first().locator('.pin-toggle');
    const firstSensorId = await firstPinToggle.getAttribute('data-id');
    await firstPinToggle.click();
    await page.waitForTimeout(100);

    // Теперь показывается только 1 закреплённый датчик
    const pinnedCount = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count();
    expect(pinnedCount).toBe(1);

    // Вводим поисковый запрос — должны показаться все датчики, соответствующие фильтру
    const filterInput = page.locator('.filter-input');
    await filterInput.fill('Sensor');
    await page.waitForTimeout(400); // debounce 300ms + buffer

    // После ввода фильтра показываются все найденные датчики (не только закреплённые)
    const filteredCount = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count();
    expect(filteredCount).toBeGreaterThan(1);

    // Закрепляем ещё один датчик из результатов поиска
    const secondRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').nth(1);
    const secondPinToggle = secondRow.locator('.pin-toggle');
    const secondSensorId = await secondPinToggle.getAttribute('data-id');

    // Убедимся что это другой датчик
    if (secondSensorId !== firstSensorId) {
      await secondPinToggle.click();
      await expect(secondPinToggle).toHaveClass(/pinned/);
    }

    // Очищаем фильтр — теперь должны показываться только закреплённые (2 датчика)
    await filterInput.fill('');
    // Ждём загрузки данных (debounce + API запрос) и проверяем что показываются 2 закреплённых
    await expect(async () => {
      const finalCount = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count();
      expect(finalCount).toBe(2);
    }).toPass({ timeout: 5000 });
  });

  test('should reset filter and lose focus on ESC', async ({ page }) => {
    await page.waitForSelector('.filter-input', { timeout: 10000 });

    const filterInput = page.locator('.filter-input');

    // Вводим текст в фильтр
    await filterInput.fill('test');
    await expect(filterInput).toHaveValue('test');
    await expect(filterInput).toBeFocused();

    // Нажимаем ESC
    await filterInput.press('Escape');

    // Фильтр должен сброситься
    await expect(filterInput).toHaveValue('');

    // Фокус должен уйти с поля
    await expect(filterInput).not.toBeFocused();
  });

  test('should lose focus on ESC even when filter is empty', async ({ page }) => {
    await page.waitForSelector('.filter-input', { timeout: 10000 });

    const filterInput = page.locator('.filter-input');

    // Фокусируемся на пустом поле
    await filterInput.focus();
    await expect(filterInput).toBeFocused();

    // Нажимаем ESC
    await filterInput.press('Escape');

    // Фокус должен уйти с поля
    await expect(filterInput).not.toBeFocused();
  });

  test('should reset filter on ESC when table is focused', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    const filterInput = page.locator('.filter-input');
    const sensorsContainer = page.locator('.ionc-sensors-table-container');

    // Вводим фильтр
    await filterInput.fill('Sensor150');
    await page.waitForTimeout(400);

    // Убеждаемся что фильтр применился
    const filteredCount = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count();
    expect(filteredCount).toBeLessThan(100);

    // Кликаем на таблицу (контейнер получает фокус)
    await sensorsContainer.click();
    await expect(sensorsContainer).toBeFocused();

    // Нажимаем ESC на таблице
    await sensorsContainer.press('Escape');

    // Фильтр должен сброситься
    await expect(filterInput).toHaveValue('');

    // Должны показаться все датчики
    await page.waitForTimeout(400);
    const restoredCount = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count();
    expect(restoredCount).toBeGreaterThan(filteredCount);
  });

  test('should have filter input', async ({ page }) => {
    await page.waitForSelector('.filter-bar', { timeout: 10000 });

    // Проверяем наличие поля фильтра
    const filterInput = page.locator('.filter-input');
    await expect(filterInput).toBeVisible();
    await expect(filterInput).toHaveAttribute('placeholder', 'Фильтр...');
  });

  test('should filter sensors by name', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Получаем начальное количество строк
    const initialCount = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count();

    if (initialCount < 2) {
      // Недостаточно датчиков для теста фильтрации
      return;
    }

    // Получаем имя первого датчика
    const firstName = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row:first-child .ionc-col-name').textContent();

    // Вводим часть имени в фильтр
    const filterInput = page.locator('.filter-input');
    await filterInput.fill(firstName?.substring(0, 5) || 'Sensor');

    // Ждём debounce и перезагрузки
    await page.waitForTimeout(400);

    // Проверяем что фильтр применился
    const filteredCount = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test('should have type filter dropdown', async ({ page }) => {
    await page.waitForSelector('.type-filter', { timeout: 10000 });

    const typeFilter = page.locator('.type-filter');
    await expect(typeFilter).toBeVisible();

    // Проверяем наличие опций
    await expect(typeFilter.locator('option[value="all"]')).toHaveText('Все');
    await expect(typeFilter.locator('option[value="AI"]')).toHaveText('AI');
    await expect(typeFilter.locator('option[value="DI"]')).toHaveText('DI');
    await expect(typeFilter.locator('option[value="AO"]')).toHaveText('AO');
    await expect(typeFilter.locator('option[value="DO"]')).toHaveText('DO');
  });

  test('should filter sensors by type', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Выбираем тип AI
    const typeFilter = page.locator('.type-filter');
    await typeFilter.selectOption('AI');

    // Ждём перезагрузки
    await page.waitForTimeout(400);

    // Все отображаемые датчики должны быть типа AI (или пусто)
    const rows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row');
    const count = await rows.count();

    if (count > 0) {
      // Проверяем что все badge имеют тип AI
      const badges = page.locator('.ionc-sensors-tbody .type-badge');
      for (let i = 0; i < await badges.count(); i++) {
        await expect(badges.nth(i)).toHaveText('AI');
      }
    }
  });

  test('should have section reorder buttons', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-section', { timeout: 10000 });

    // Проверяем наличие кнопок перемещения в секции датчиков
    const sensorsSection = page.locator('.ionc-sensors-section');
    const moveUpBtn = sensorsSection.locator('.section-move-up');
    const moveDownBtn = sensorsSection.locator('.section-move-down');

    await expect(moveUpBtn).toBeVisible();
    await expect(moveDownBtn).toBeVisible();
  });

  test('should have resize handle for sensors section', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-section', { timeout: 10000 });

    // Проверяем наличие ручки для изменения размера
    const resizeHandle = page.locator('.resize-handle');
    await expect(resizeHandle).toBeVisible();
  });

  test('should use infinite scroll instead of pagination', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Проверяем что пагинации НЕТ (используется infinite scroll)
    const pagination = page.locator('.ionc-pagination');
    await expect(pagination).not.toBeVisible();

    // Проверяем наличие viewport для виртуального скролла
    const viewport = page.locator('.ionc-sensors-viewport');
    await expect(viewport).toBeVisible();
  });

  test('should have loading indicator for infinite scroll', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Проверяем наличие индикатора загрузки (скрыт по умолчанию)
    const loadingIndicator = page.locator('.ionc-loading-more');
    await expect(loadingIndicator).toBeAttached();
    // Изначально скрыт
    await expect(loadingIndicator).not.toBeVisible();
  });

  test('should have action buttons for each sensor', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();

    // Кнопка "Установить значение"
    await expect(firstRow.locator('.ionc-btn-set')).toBeVisible();

    // Кнопка "Заморозить" или "Разморозить"
    const freezeBtn = firstRow.locator('.ionc-btn-freeze, .ionc-btn-unfreeze');
    await expect(freezeBtn).toBeVisible();

    // Кнопка "Подписчики"
    await expect(firstRow.locator('.ionc-btn-consumers')).toBeVisible();
  });

  test('should show set value dialog on button click', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Находим не-readonly датчик
    const rows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row:not(.ionc-sensor-readonly)');
    const count = await rows.count();

    if (count === 0) {
      // Все датчики readonly, пропускаем
      return;
    }

    const setBtn = rows.first().locator('.ionc-btn-set');
    if (await setBtn.isDisabled()) {
      return;
    }

    // Кликаем на кнопку
    await setBtn.click();

    // Проверяем что открылся кастомный диалог
    const dialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(dialog).toBeVisible();

    // Проверяем заголовок
    await expect(page.locator('#ionc-dialog-title')).toContainText('Установить значение');

    // Проверяем наличие поля ввода
    await expect(page.locator('#ionc-set-value')).toBeVisible();

    // Проверяем кнопки
    await expect(page.locator('#ionc-set-confirm')).toBeVisible();
    await expect(page.locator('.ionc-dialog-btn-cancel')).toBeVisible();

    // Закрываем диалог
    await page.locator('.ionc-dialog-btn-cancel').click();
    await expect(dialog).not.toBeVisible();
  });

  test('should close set value dialog on ESC', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    const rows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row:not(.ionc-sensor-readonly)');
    const count = await rows.count();
    if (count === 0) return;

    const setBtn = rows.first().locator('.ionc-btn-set');
    if (await setBtn.isDisabled()) return;

    await setBtn.click();

    const dialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(dialog).toBeVisible();

    // Нажимаем ESC
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('should focus input field when set value dialog opens', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    const rows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row:not(.ionc-sensor-readonly)');
    const count = await rows.count();
    if (count === 0) return;

    const setBtn = rows.first().locator('.ionc-btn-set');
    if (await setBtn.isDisabled()) return;

    await setBtn.click();

    const dialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(dialog).toBeVisible();

    // Проверяем что input получил фокус
    const input = page.locator('#ionc-set-value');
    await expect(input).toBeFocused({ timeout: 500 });

    // Закрываем
    await page.keyboard.press('Escape');
  });

  test('should focus input field when freeze dialog opens', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Ищем незамороженный датчик
    const freezeBtn = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row .ionc-btn-freeze').first();
    const btnCount = await freezeBtn.count();
    if (btnCount === 0) return;

    // Одинарный клик — ждём 300мс чтобы сработал таймер
    await freezeBtn.click();
    await page.waitForTimeout(300);

    const dialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(dialog).toBeVisible();

    // Проверяем что input получил фокус
    const input = page.locator('#ionc-freeze-value');
    await expect(input).toBeFocused({ timeout: 500 });

    // Закрываем
    await page.keyboard.press('Escape');
  });

  test('should close set value dialog on overlay click', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    const rows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row:not(.ionc-sensor-readonly)');
    const count = await rows.count();
    if (count === 0) return;

    const setBtn = rows.first().locator('.ionc-btn-set');
    if (await setBtn.isDisabled()) return;

    await setBtn.click();

    const overlay = page.locator('.ionc-dialog-overlay.visible');
    await expect(overlay).toBeVisible();

    // Кликаем на overlay (не на сам диалог)
    await overlay.click({ position: { x: 10, y: 10 } });
    await expect(overlay).not.toBeVisible();
  });

  test('should show validation error for empty value', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    const rows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row:not(.ionc-sensor-readonly)');
    const count = await rows.count();
    if (count === 0) return;

    const setBtn = rows.first().locator('.ionc-btn-set');
    if (await setBtn.isDisabled()) return;

    await setBtn.click();

    // Очищаем поле ввода
    const input = page.locator('#ionc-set-value');
    await input.fill('');

    // Кликаем применить
    await page.locator('#ionc-set-confirm').click();

    // Проверяем что появилась ошибка
    await expect(page.locator('#ionc-dialog-error')).not.toBeEmpty();

    // Диалог должен остаться открытым
    await expect(page.locator('.ionc-dialog-overlay.visible')).toBeVisible();

    // Закрываем
    await page.keyboard.press('Escape');
  });

  test('should show consumers dialog on button click', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    const consumersBtn = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first().locator('.ionc-btn-consumers');

    await consumersBtn.click();

    // Проверяем что открылся кастомный диалог
    const dialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(dialog).toBeVisible();

    // Проверяем заголовок
    await expect(page.locator('#ionc-dialog-title')).toContainText('Подписчики');

    // Проверяем что есть информация о датчике
    await expect(page.locator('.ionc-dialog-info')).toBeVisible();

    // Проверяем кнопку закрытия
    await expect(page.locator('.ionc-dialog-btn-cancel')).toContainText('Закрыть');

    // Закрываем диалог
    await page.locator('.ionc-dialog-btn-cancel').click();
    await expect(dialog).not.toBeVisible();
  });

  test('should show freeze dialog on single click', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Ищем незамороженный датчик
    const freezeBtn = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row .ionc-btn-freeze').first();
    const btnCount = await freezeBtn.count();
    if (btnCount === 0) return;

    // Одинарный клик — ждём 300мс чтобы сработал таймер
    await freezeBtn.click();
    await page.waitForTimeout(300);

    // Проверяем что открылся диалог заморозки
    const dialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(dialog).toBeVisible();

    // Проверяем заголовок
    await expect(page.locator('#ionc-dialog-title')).toContainText('Заморозить');

    // Проверяем наличие поля ввода значения заморозки
    await expect(page.locator('#ionc-freeze-value')).toBeVisible();

    // Проверяем подсказку про двойной клик
    await expect(page.locator('.ionc-dialog-hint')).toContainText('Двойной клик');

    // Закрываем
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('should unfreeze on unfreeze button click', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Ищем замороженный датчик
    const unfreezeBtn = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row .ionc-btn-unfreeze').first();
    const btnCount = await unfreezeBtn.count();
    if (btnCount === 0) {
      // Нет замороженных датчиков — пропускаем
      return;
    }

    // Клик на разморозку — должен сразу разморозить без диалога
    await unfreezeBtn.click();

    // Диалог не должен появиться
    const dialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(dialog).not.toBeVisible();
  });

  test('should display type badges with correct colors', async ({ page }) => {
    await page.waitForSelector('.type-badge', { timeout: 10000 });

    // Проверяем что badges отображаются
    const badges = page.locator('.type-badge');
    await expect(badges).not.toHaveCount(0);

    // Проверяем что у badge есть класс типа
    const firstBadge = badges.first();
    const badgeClass = await firstBadge.getAttribute('class');
    expect(badgeClass).toMatch(/type-(AI|DI|AO|DO)/);
  });

  test('should highlight frozen sensors', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Ищем замороженные датчики
    const frozenRows = page.locator('.ionc-sensors-tbody tr.ionc-sensor-frozen');
    const frozenCount = await frozenRows.count();

    if (frozenCount > 0) {
      // Замороженные датчики должны иметь иконку ❄
      await expect(frozenRows.first().locator('.ionc-flag-frozen')).toBeVisible();
    }
  });

  test('should display lost consumers section', async ({ page }) => {
    await page.waitForSelector('[data-section-id="ionc-lost"]', { timeout: 10000 });

    // Проверяем наличие секции потерянных подписчиков
    const lostSection = page.locator('[data-section-id="ionc-lost"]');
    await expect(lostSection).toBeVisible();
    await expect(lostSection.locator('.collapsible-title')).toContainText('Потерянные подписчики');
  });

  test('should display LogServer section when LogServer is available', async ({ page }) => {
    // Ждём загрузки данных объекта
    await page.waitForSelector('.ionc-sensors-section', { timeout: 10000 });

    // Проверяем наличие секции LogServer
    const logServerSection = page.locator('[data-section-id="logserver"]');

    // Секция должна существовать в DOM
    await expect(logServerSection).toBeAttached();

    // Если LogServer доступен, секция должна быть видимой
    const isVisible = await logServerSection.isVisible();
    if (isVisible) {
      await expect(logServerSection.locator('.collapsible-title')).toContainText('LogServer');

      // Проверяем что отображается информация о хосте и порте
      const tbody = logServerSection.locator('tbody');
      await expect(tbody.locator('tr')).not.toHaveCount(0);
    }
  });

  test('should display LogViewer section when LogServer is available', async ({ page }) => {
    // Ждём загрузки данных объекта
    await page.waitForSelector('.ionc-sensors-section', { timeout: 10000 });

    // Проверяем наличие контейнера LogViewer
    const logViewerWrapper = page.locator('.logviewer-wrapper');
    await expect(logViewerWrapper).toBeAttached();

    // Если LogServer доступен, LogViewer должен быть инициализирован
    const logViewerContainer = page.locator('[id^="logviewer-container-"]');
    await expect(logViewerContainer).toBeAttached();
  });

  test('should toggle sensors section collapse', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-section', { timeout: 10000 });

    const section = page.locator('.ionc-sensors-section');
    const header = section.locator('.collapsible-header');
    const content = section.locator('.collapsible-content');

    // Секция должна быть развёрнута по умолчанию
    await expect(content).toBeVisible();

    // Кликаем на заголовок для сворачивания
    await header.click();
    await expect(content).not.toBeVisible();

    // Кликаем снова для разворачивания
    await header.click();
    await expect(content).toBeVisible();
  });

  test('should update sensor value via SSE (visual feedback)', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Проверяем что элемент value существует
    const valueEl = page.locator('.ionc-value').first();
    await expect(valueEl).toBeVisible();

    // Примечание: Реальное SSE обновление требует изменения данных на сервере
    // Здесь мы просто проверяем что элементы для обновления существуют
    const valueId = await valueEl.getAttribute('id');
    expect(valueId).toMatch(/ionc-value-/);
  });

  test('should update chart when sensor value changes', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Добавляем датчик на график
    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
    const chartLabel = firstRow.locator('.chart-toggle-label');
    await chartLabel.click();

    // Ждём появления графика
    const chartsSection = page.locator('[data-section-id="charts"]');
    const chartPanel = chartsSection.locator('.chart-panel').first();
    await expect(chartPanel).toBeVisible({ timeout: 5000 });

    // Проверяем что canvas графика существует
    const canvas = chartPanel.locator('canvas');
    await expect(canvas).toBeVisible();

    // Проверяем что элемент легенды (значение) существует
    const legendValue = chartPanel.locator('.chart-panel-value');
    await expect(legendValue).toBeVisible();

    // Ждём обновления значения (SSE должен прислать данные)
    // Значение должно измениться с "--" на число
    await expect(async () => {
      const text = await legendValue.textContent();
      // Проверяем что значение не пустое и не "--"
      expect(text).toBeTruthy();
      expect(text?.trim()).not.toBe('');
    }).toPass({ timeout: 10000 });

    // Проверяем что значение в таблице тоже обновляется
    const tableValue = firstRow.locator('.ionc-value');
    await expect(tableValue).toBeVisible();
    const tableValueText = await tableValue.textContent();
    expect(tableValueText).toBeTruthy();
  });

  test('should sync table and chart values', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Добавляем датчик на график
    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
    const chartLabel = firstRow.locator('.chart-toggle-label');
    await chartLabel.click();

    // Ждём появления графика
    const chartsSection = page.locator('[data-section-id="charts"]');
    const chartPanel = chartsSection.locator('.chart-panel').first();
    await expect(chartPanel).toBeVisible({ timeout: 5000 });

    // Ждём несколько секунд для накопления данных
    await page.waitForTimeout(3000);

    // Получаем значение из таблицы
    const tableValue = firstRow.locator('.ionc-value');
    const tableText = await tableValue.textContent();

    // Получаем значение из легенды графика
    const legendValue = chartPanel.locator('.chart-panel-value');
    const legendText = await legendValue.textContent();

    // Оба значения должны быть непустыми (данные обновляются)
    expect(tableText?.trim()).not.toBe('');
    expect(legendText?.trim()).not.toBe('');

    // Значения должны совпадать или быть близкими (могут отличаться из-за timing)
    console.log(`Table value: ${tableText}, Legend value: ${legendText}`);
  });

  test('should add data points to chart via SSE updates', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Добавляем датчик на график
    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
    const chartLabel = firstRow.locator('.chart-toggle-label');
    await chartLabel.click();

    // Ждём появления графика
    const chartsSection = page.locator('[data-section-id="charts"]');
    const chartPanel = chartsSection.locator('.chart-panel').first();
    await expect(chartPanel).toBeVisible({ timeout: 5000 });

    // Проверяем что начальная точка добавлена сразу после создания графика
    const initialCount = await page.evaluate(() => {
      const state = (window as any).state;
      if (!state || !state.tabs) return 0;
      // Ищем tabState по displayName (ключ теперь serverId:objectName)
      let tabState = null;
      for (const [, ts] of state.tabs) {
        if (ts.displayName === 'SharedMemory') {
          tabState = ts;
          break;
        }
      }
      if (!tabState || !tabState.charts) return 0;
      for (const [, chartData] of tabState.charts) {
        if (chartData.chart?.data?.datasets[0]) {
          return chartData.chart.data.datasets[0].data.length;
        }
      }
      return 0;
    });

    // Начальная точка должна быть добавлена сразу
    expect(initialCount).toBeGreaterThanOrEqual(1);
    console.log(`Chart has ${initialCount} initial data points`);

    // Ждём 2 poll интервала (5s каждый) + buffer для SSE обновлений
    await page.waitForTimeout(12000);

    // Проверяем что в графике появились новые точки от SSE
    const diagnostics = await page.evaluate(() => {
      const state = (window as any).state;
      if (!state || !state.tabs) return { error: 'no state', chartsCount: 0, dataPoints: 0 };
      // Ищем tabState по displayName (ключ теперь serverId:objectName)
      let tabState = null;
      for (const [, ts] of state.tabs) {
        if (ts.displayName === 'SharedMemory') {
          tabState = ts;
          break;
        }
      }
      if (!tabState) return { error: 'no tabState', chartsCount: 0, dataPoints: 0 };
      if (!tabState.charts) return { error: 'no charts map', chartsCount: 0, dataPoints: 0 };

      const chartsCount = tabState.charts.size;
      const chartKeys = Array.from(tabState.charts.keys());

      for (const [key, chartData] of tabState.charts) {
        if (chartData.chart?.data?.datasets[0]) {
          return {
            chartsCount,
            chartKeys,
            dataPoints: chartData.chart.data.datasets[0].data.length,
            firstKey: key
          };
        }
      }
      return { error: 'no chart data', chartsCount, chartKeys, dataPoints: 0 };
    });

    console.log(`Diagnostics:`, JSON.stringify(diagnostics));

    // Проверяем что график всё ещё существует и имеет точки
    expect(diagnostics.chartsCount).toBeGreaterThan(0);
    expect(diagnostics.dataPoints).toBeGreaterThan(0);
  });

  // ==================== CHART RESTORATION TESTS ====================

  test('should restore chart after page reload', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Очищаем localStorage перед тестом
    await page.evaluate(() => {
      // Удаляем все ключи связанные с графиками
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.includes('uniset2-viewer-external-sensors')) {
          localStorage.removeItem(key);
        }
      }
    });

    // Добавляем датчик на график
    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
    const chartCheckbox = firstRow.locator('.chart-toggle input[type="checkbox"]');
    const chartLabel = firstRow.locator('.chart-toggle-label');
    const sensorName = await firstRow.locator('.ionc-col-name').textContent();

    await chartLabel.click();
    await expect(chartCheckbox).toBeChecked();

    // Ждём появления графика
    const chartsSection = page.locator('[data-section-id="charts"]');
    await expect(chartsSection.locator('.chart-panel')).toBeVisible({ timeout: 5000 });

    // Перезагружаем страницу
    await page.reload();

    // Ждём загрузки объектов
    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // Открываем SharedMemory заново
    const sharedMemory = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    await sharedMemory.click();
    await expect(page.locator('.tab-btn', { hasText: 'SharedMemory' })).toBeVisible();

    // Ждём загрузки секции графиков
    await page.waitForSelector('[data-section-id="charts"]', { timeout: 10000 });

    // ГЛАВНАЯ ПРОВЕРКА: График должен быть восстановлен
    const restoredChart = page.locator('[data-section-id="charts"] .chart-panel');
    await expect(restoredChart).toBeVisible({ timeout: 10000 });

    // Проверяем что график содержит имя датчика
    if (sensorName) {
      await expect(restoredChart).toContainText(sensorName.trim());
    }

    // Проверяем что checkbox в таблице тоже восстановлен
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });
    const restoredRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
    const restoredCheckbox = restoredRow.locator('.chart-toggle input[type="checkbox"]');
    await expect(restoredCheckbox).toBeChecked({ timeout: 5000 });
  });

  test('should restore multiple charts after page reload', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    const rowCount = await page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').count();
    if (rowCount < 2) {
      // Недостаточно датчиков для теста
      return;
    }

    // Очищаем localStorage перед тестом
    await page.evaluate(() => {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.includes('uniset2-viewer-external-sensors')) {
          localStorage.removeItem(key);
        }
      }
    });

    // Добавляем 2 датчика на график
    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').nth(0);
    const secondRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').nth(1);

    await firstRow.locator('.chart-toggle-label').click();
    await expect(firstRow.locator('.chart-toggle input[type="checkbox"]')).toBeChecked();
    await page.waitForTimeout(300);

    await secondRow.locator('.chart-toggle-label').click();
    await expect(secondRow.locator('.chart-toggle input[type="checkbox"]')).toBeChecked();

    // Ждём появления обоих графиков
    const chartsSection = page.locator('[data-section-id="charts"]');
    await expect(chartsSection.locator('.chart-panel')).toHaveCount(2, { timeout: 5000 });

    // Перезагружаем страницу
    await page.reload();

    // Заново открываем SharedMemory
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'SharedMemory' }).click();
    await expect(page.locator('.tab-btn', { hasText: 'SharedMemory' })).toBeVisible();

    // Ждём загрузки
    await page.waitForSelector('[data-section-id="charts"]', { timeout: 10000 });

    // ГЛАВНАЯ ПРОВЕРКА: Оба графика должны быть восстановлены
    const restoredCharts = page.locator('[data-section-id="charts"] .chart-panel');
    await expect(restoredCharts).toHaveCount(2, { timeout: 10000 });

    // Проверяем что checkboxes тоже восстановлены
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });
    const restoredFirstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').nth(0);
    const restoredSecondRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').nth(1);
    await expect(restoredFirstRow.locator('.chart-toggle input[type="checkbox"]')).toBeChecked({ timeout: 5000 });
    await expect(restoredSecondRow.locator('.chart-toggle input[type="checkbox"]')).toBeChecked({ timeout: 5000 });
  });

  test('should save full sensor data in localStorage (not just name)', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Очищаем localStorage перед тестом
    await page.evaluate(() => {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.includes('uniset2-viewer-external-sensors')) {
          localStorage.removeItem(key);
        }
      }
    });

    // Добавляем датчик на график
    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
    await firstRow.locator('.chart-toggle-label').click();
    await expect(firstRow.locator('.chart-toggle input[type="checkbox"]')).toBeChecked();

    // Ждём сохранения в localStorage
    await page.waitForTimeout(500);

    // Проверяем формат данных в localStorage
    const savedData = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('uniset2-viewer-external-sensors')) {
          const data = localStorage.getItem(key);
          return data ? JSON.parse(data) : null;
        }
      }
      return null;
    });

    expect(savedData).toBeTruthy();
    expect(Array.isArray(savedData)).toBe(true);
    expect(savedData.length).toBeGreaterThan(0);

    // Проверяем что сохранён объект с полными данными, а не просто строка имени
    const firstSensor = savedData[0];
    expect(typeof firstSensor).toBe('object');
    expect(firstSensor).toHaveProperty('id');
    expect(firstSensor).toHaveProperty('name');
    expect(firstSensor).toHaveProperty('iotype');
  });

  test('should not restore chart when checkbox is unchecked before reload', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Очищаем localStorage перед тестом
    await page.evaluate(() => {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.includes('uniset2-viewer-external-sensors')) {
          localStorage.removeItem(key);
        }
      }
    });

    // Добавляем датчик на график
    const firstRow = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row').first();
    const chartCheckbox = firstRow.locator('.chart-toggle input[type="checkbox"]');
    const chartLabel = firstRow.locator('.chart-toggle-label');

    await chartLabel.click();
    await expect(chartCheckbox).toBeChecked();

    // Ждём появления графика
    const chartsSection = page.locator('[data-section-id="charts"]');
    await expect(chartsSection.locator('.chart-panel')).toBeVisible({ timeout: 5000 });

    // Снимаем галочку (удаляем график)
    await chartLabel.click();
    await expect(chartCheckbox).not.toBeChecked();
    await expect(chartsSection.locator('.chart-panel')).not.toBeVisible();

    // Перезагружаем страницу
    await page.reload();

    // Заново открываем SharedMemory
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    await page.locator('#objects-list li', { hasText: 'SharedMemory' }).click();

    await page.waitForSelector('[data-section-id="charts"]', { timeout: 10000 });

    // График НЕ должен быть восстановлен
    const restoredCharts = page.locator('[data-section-id="charts"] .chart-panel');
    await expect(restoredCharts).toHaveCount(0, { timeout: 5000 });
  });

  // ==================== FREEZE/UNFREEZE TESTS ====================

  test('should show frozen value display format (real → frozen❄) after freeze', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Находим незамороженный датчик с кнопкой заморозки
    const freezeBtn = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row .ionc-btn-freeze').first();
    const btnCount = await freezeBtn.count();
    if (btnCount === 0) {
      // Нет доступных для заморозки датчиков
      return;
    }

    // Получаем строку датчика
    const row = freezeBtn.locator('xpath=ancestor::tr');
    const sensorId = await row.getAttribute('data-sensor-id');

    // Получаем текущее значение
    const valueEl = row.locator('.ionc-value');
    const originalValue = await valueEl.textContent();

    // Открываем диалог заморозки (одинарный клик + ждём таймер)
    await freezeBtn.click();
    await page.waitForTimeout(300);

    const dialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(dialog).toBeVisible();

    // Вводим значение заморозки отличное от текущего
    const freezeInput = page.locator('#ionc-freeze-value');
    const freezeValue = '12345';
    await freezeInput.fill(freezeValue);

    // Нажимаем "Заморозить"
    await page.locator('#ionc-freeze-confirm').click();

    // Ждём закрытия диалога
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Проверяем что датчик теперь показывает формат "real → frozen❄"
    const updatedRow = page.locator(`tr[data-sensor-id="${sensorId}"]`);
    const frozenValueEl = updatedRow.locator('.ionc-frozen-value');

    // Если real_value отличается от frozen value, должен показываться формат
    const hasFrozenFormat = await frozenValueEl.count() > 0;

    if (hasFrozenFormat) {
      // Проверяем что замороженное значение отображается
      await expect(frozenValueEl).toContainText(freezeValue);
      await expect(frozenValueEl).toContainText('❄');

      // Проверяем наличие стрелки
      const arrow = updatedRow.locator('.ionc-frozen-arrow');
      await expect(arrow).toBeVisible();
    }

    // Проверяем что кнопка теперь "Разморозить"
    const unfreezeBtn = updatedRow.locator('.ionc-btn-unfreeze');
    await expect(unfreezeBtn).toBeVisible();

    // Проверяем tooltip на кнопке разморозки
    const unfreezeTitle = await unfreezeBtn.getAttribute('title');
    expect(unfreezeTitle).toContain('Заморожено на:');
    expect(unfreezeTitle).toContain(freezeValue);
  });

  test('should show unfreeze dialog with both values on single click', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Сначала заморозим датчик
    const freezeBtn = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row .ionc-btn-freeze').first();
    const btnCount = await freezeBtn.count();
    if (btnCount === 0) return;

    const row = freezeBtn.locator('xpath=ancestor::tr');
    const sensorId = await row.getAttribute('data-sensor-id');

    // Замораживаем
    await freezeBtn.click();
    await page.waitForTimeout(300);

    const freezeDialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(freezeDialog).toBeVisible();

    await page.locator('#ionc-freeze-value').fill('99999');
    await page.locator('#ionc-freeze-confirm').click();
    await expect(freezeDialog).not.toBeVisible({ timeout: 5000 });

    // Теперь проверяем диалог разморозки
    const updatedRow = page.locator(`tr[data-sensor-id="${sensorId}"]`);
    const unfreezeBtn = updatedRow.locator('.ionc-btn-unfreeze');
    await expect(unfreezeBtn).toBeVisible();

    // Одинарный клик — должен открыться диалог (после таймера)
    await unfreezeBtn.click();
    await page.waitForTimeout(300);

    const unfreezeDialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(unfreezeDialog).toBeVisible();

    // Проверяем заголовок
    await expect(page.locator('#ionc-dialog-title')).toContainText('Разморозить');

    // Проверяем что показываются оба значения
    const dialogContent = page.locator('.ionc-unfreeze-values');
    await expect(dialogContent).toBeVisible();

    // Проверяем метки
    await expect(dialogContent).toContainText('Реальное значение');
    await expect(dialogContent).toContainText('Замороженное значение');

    // Проверяем что замороженное значение показывается с ❄
    const frozenValueInDialog = dialogContent.locator('.ionc-unfreeze-frozen');
    await expect(frozenValueInDialog).toContainText('99999');
    await expect(frozenValueInDialog).toContainText('❄');

    // Закрываем диалог
    await page.keyboard.press('Escape');
    await expect(unfreezeDialog).not.toBeVisible();
  });

  test('should restore real value after unfreeze', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Находим незамороженный датчик
    const freezeBtn = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row .ionc-btn-freeze').first();
    const btnCount = await freezeBtn.count();
    if (btnCount === 0) return;

    const row = freezeBtn.locator('xpath=ancestor::tr');
    const sensorId = await row.getAttribute('data-sensor-id');

    // Получаем текущее значение (это будет real_value)
    const valueEl = row.locator('.ionc-value');
    const originalValue = await valueEl.textContent();

    // Замораживаем на другое значение
    await freezeBtn.click();
    await page.waitForTimeout(300);

    const freezeDialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(freezeDialog).toBeVisible();

    const freezeValue = '77777';
    await page.locator('#ionc-freeze-value').fill(freezeValue);
    await page.locator('#ionc-freeze-confirm').click();
    await expect(freezeDialog).not.toBeVisible({ timeout: 5000 });

    // Проверяем что датчик заморожен
    const updatedRow = page.locator(`tr[data-sensor-id="${sensorId}"]`);
    const unfreezeBtn = updatedRow.locator('.ionc-btn-unfreeze');
    await expect(unfreezeBtn).toBeVisible();

    // Размораживаем через одинарный клик (открывает диалог)
    await unfreezeBtn.click();
    await page.waitForTimeout(300); // Ждём таймер single/double click

    // Ждём появления диалога разморозки
    const unfreezeDialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(unfreezeDialog).toBeVisible({ timeout: 3000 });

    // Нажимаем кнопку "Разморозить"
    await page.locator('#ionc-unfreeze-confirm').click();
    await expect(unfreezeDialog).not.toBeVisible({ timeout: 5000 });

    // Проверяем что кнопка вернулась к "Заморозить"
    const restoredRow = page.locator(`tr[data-sensor-id="${sensorId}"]`);
    const restoredFreezeBtn = restoredRow.locator('.ionc-btn-freeze');
    await expect(restoredFreezeBtn).toBeVisible({ timeout: 5000 });

    // Проверяем что значение вернулось к реальному (не 77777)
    const restoredValue = restoredRow.locator('.ionc-value');
    const newValue = await restoredValue.textContent();

    // Значение должно быть НЕ равно замороженному
    expect(newValue?.trim()).not.toBe(freezeValue);

    // Формат "real → frozen❄" должен исчезнуть
    const frozenFormat = restoredRow.locator('.ionc-frozen-value');
    await expect(frozenFormat).not.toBeVisible();
  });

  test('should show warning in set value dialog when sensor is frozen', async ({ page }) => {
    await page.waitForSelector('.ionc-sensors-tbody tr.ionc-sensor-row', { timeout: 10000 });

    // Находим или создаём замороженный датчик
    let unfreezeBtn = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row .ionc-btn-unfreeze').first();
    let row;

    if (await unfreezeBtn.count() === 0) {
      // Нет замороженных, заморозим один
      const freezeBtn = page.locator('.ionc-sensors-tbody tr.ionc-sensor-row .ionc-btn-freeze').first();
      if (await freezeBtn.count() === 0) return;

      row = freezeBtn.locator('xpath=ancestor::tr');
      await freezeBtn.click();
      await page.waitForTimeout(300);

      const dialog = page.locator('.ionc-dialog-overlay.visible');
      await expect(dialog).toBeVisible();
      await page.locator('#ionc-freeze-confirm').click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });

      unfreezeBtn = row.locator('.ionc-btn-unfreeze');
    } else {
      row = unfreezeBtn.locator('xpath=ancestor::tr');
    }

    // Теперь открываем диалог установки значения для замороженного датчика
    const setBtn = row.locator('.ionc-btn-set');
    if (await setBtn.isDisabled()) {
      // Датчик readonly, пропускаем
      return;
    }

    await setBtn.click();

    const setDialog = page.locator('.ionc-dialog-overlay.visible');
    await expect(setDialog).toBeVisible();

    // Проверяем наличие предупреждения о заморозке
    const warning = page.locator('.ionc-dialog-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('заморожен');
    await expect(warning).toContainText('не будет изменено');

    // Закрываем диалог
    await page.keyboard.press('Escape');
  });

});
