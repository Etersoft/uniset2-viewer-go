/**
 * Тест visibility fix с реальным IONC сервером
 * Запускает генерирование значений для 5 датчиков
 *
 * Запуск:
 *   docker-compose --profile dev up dev-viewer -d
 *   cd tests && node debug/test-visibility-real.js
 */

const { chromium } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

(async () => {
    console.log('=== Test: Visibility fix with real IONC server ===\n');

    const browser = await chromium.launch({ headless: false, slowMo: 50 });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Логируем console.log из браузера
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('SSE:') || text.includes('visible') ||
            text.includes('DEBUG:') || text.includes('ionc_sensor')) {
            console.log('BROWSER:', text);
        }
    });

    console.log('1. Открываю страницу...');
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);

    // Очищаем localStorage
    await page.evaluate(() => {
        localStorage.clear();
    });

    // Берём управление
    console.log('2. Беру управление (токен admin123)...');

    // Кликаем на кнопку "Take" в статусе контроля
    const takeBtn = page.locator('#control-status .control-status-btn, button:has-text("Take")').first();
    if (await takeBtn.count() > 0 && await takeBtn.isVisible()) {
        await takeBtn.click();
        await page.waitForTimeout(500);

        // Вводим токен в диалоге
        const tokenInput = page.locator('input[type="password"]');
        if (await tokenInput.count() > 0) {
            await tokenInput.fill('admin123');
            await page.waitForTimeout(100);

            // Подтверждаем
            const confirmBtn = page.locator('button:has-text("Take Control")');
            if (await confirmBtn.count() > 0) {
                await confirmBtn.click();
                await page.waitForTimeout(1000);
                console.log('   Управление получено');
            }
        }
    } else {
        console.log('   Кнопка Take не найдена или контроль уже получен');
    }

    // Открываем SharedMemory на сервере 9191
    console.log('3. Открываю SharedMemory (сервер 9191)...');
    const smItem = page.locator('.objects-list li').filter({ hasText: 'SharedMemory' }).first();
    await smItem.waitFor({ state: 'visible', timeout: 10000 });
    await smItem.click();
    await page.waitForTimeout(2000);

    // Раскрываем секцию сенсоров
    console.log('4. Раскрываю секцию сенсоров...');
    const sensorsSection = page.locator('[data-section^="ionc-sensors-"]');
    if (await sensorsSection.count() > 0) {
        const isCollapsed = await sensorsSection.evaluate(el => el.classList.contains('collapsed'));
        if (isCollapsed) {
            await sensorsSection.locator('.collapsible-header').click();
            await page.waitForTimeout(500);
        }
    }

    await page.waitForTimeout(1500);

    // Включаем графики для первых 5 сенсоров
    console.log('5. Включаю графики для 5 сенсоров...');
    const chartLabels = page.locator('.chart-toggle-label');
    const count = Math.min(5, await chartLabels.count());

    for (let i = 0; i < count; i++) {
        await chartLabels.nth(i).click();
        await page.waitForTimeout(200);
    }
    console.log('   Включено графиков: ' + count);

    await page.waitForTimeout(1000);

    // Проверяем состояние charts в state
    const chartsDebug = await page.evaluate(() => {
        const result = {};
        if (window.state && window.state.tabs) {
            window.state.tabs.forEach((tabState, tabKey) => {
                if (tabState.charts && tabState.charts.size > 0) {
                    result[tabKey] = {
                        size: tabState.charts.size,
                        keys: Array.from(tabState.charts.keys())
                    };
                }
            });
        }
        return result;
    });
    console.log('   DEBUG: state.tabs.charts =', JSON.stringify(chartsDebug, null, 2));

    // Проверяем состояние DOM для секции Charts
    const domDebug = await page.evaluate(() => {
        const result = {};
        // Ищем секцию charts
        const chartsSection = document.querySelector('[data-section^="charts-"]');
        if (chartsSection) {
            result.sectionExists = true;
            result.sectionId = chartsSection.getAttribute('data-section');
            result.collapsed = chartsSection.classList.contains('collapsed');
        } else {
            result.sectionExists = false;
        }
        // Ищем конкретный контейнер charts-SharedMemory
        const chartsGrid = document.getElementById('charts-SharedMemory');
        result.chartsGridExists = !!chartsGrid;
        if (chartsGrid) {
            result.chartsGridChildren = chartsGrid.children.length;
        }
        // Ищем все chart-panel
        const chartPanels = document.querySelectorAll('.chart-panel');
        result.chartPanelCount = chartPanels.length;
        // Ищем все canvas внутри chart-wrapper
        const canvases = document.querySelectorAll('.chart-wrapper canvas, canvas[id^="canvas-"]');
        result.canvasCount = canvases.length;
        return result;
    });
    console.log('   DEBUG: DOM state =', JSON.stringify(domDebug, null, 2));

    // Запускаем генерирование значений для этих сенсоров
    console.log('6. Запускаю генерирование значений...');

    // Находим кнопки генератора (⟳)
    const genButtons = page.locator('.ionc-btn-gen:not([disabled])');
    const genCount = Math.min(5, await genButtons.count());
    console.log('   Найдено кнопок генератора: ' + genCount);
    let started = 0;

    for (let i = 0; i < genCount; i++) {
        try {
            const btn = genButtons.nth(i);
            await btn.scrollIntoViewIfNeeded();
            await btn.click();
            await page.waitForTimeout(500);

            // Ждём появления кнопки Start в overlay
            const startBtn = page.locator('#ionc-gen-start');
            if (await startBtn.count() > 0 && await startBtn.isVisible()) {
                await startBtn.click();
                started++;
                console.log('   Генератор ' + (i + 1) + ' запущен');
                await page.waitForTimeout(300);
            } else {
                // Закрываем диалог
                await page.keyboard.press('Escape');
            }

            await page.waitForTimeout(100);
        } catch (e) {
            console.log('   Ошибка генератора ' + i + ': ' + e.message);
            await page.keyboard.press('Escape');
        }
    }

    console.log('   Запущено генераторов: ' + started);

    // Добавляем отладку SSE событий в браузер
    await page.evaluate(() => {
        // Патчим обработчик SSE для логирования ionc_sensor_batch
        if (window.eventSource) {
            const originalOnMessage = window.eventSource.onmessage;
            window.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'ionc_sensor_batch') {
                        console.log('DEBUG: ionc_sensor_batch event received, sensors:', data.data?.sensors?.length || 0);
                    }
                } catch (e) {}
                if (originalOnMessage) originalOnMessage(event);
            };
        }
    });

    // Собираем данные 10 секунд в visible
    console.log('\n7. Собираю данные (10 сек, visible)...');
    await page.waitForTimeout(10000);

    const beforeChartInfo = await page.evaluate(() => {
        // Canvas находится внутри .chart-wrapper, без специального класса
        const canvases = document.querySelectorAll('.chart-wrapper canvas, canvas[id^="canvas-"]');
        let totalPoints = 0;
        const details = [];
        canvases.forEach((canvas, idx) => {
            const chart = Chart.getChart(canvas);
            if (chart && chart.data.datasets[0]) {
                const pts = chart.data.datasets[0].data.length;
                totalPoints += pts;
                details.push({ idx, points: pts, label: chart.data.datasets[0].label || 'unknown' });
            }
        });
        return { totalPoints, details, chartCount: canvases.length };
    });
    console.log('   Найдено canvas элементов: ' + beforeChartInfo.chartCount);
    console.log('   Всего точек на графиках: ' + beforeChartInfo.totalPoints);
    if (beforeChartInfo.details.length > 0) {
        console.log('   Детали:', JSON.stringify(beforeChartInfo.details));
    }
    const beforeChartPoints = beforeChartInfo.totalPoints;

    // Эмулируем hidden
    console.log('\n8. Эмулирую скрытие страницы (15 сек)...');
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(15000);

    // Возвращаем visible
    console.log('9. Возвращаю видимость...');
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });

    // Ждём обновления
    await page.waitForTimeout(2000);

    const afterChartPoints = await page.evaluate(() => {
        const canvases = document.querySelectorAll('.chart-wrapper canvas, canvas[id^="canvas-"]');
        let totalPoints = 0;
        canvases.forEach(canvas => {
            const chart = Chart.getChart(canvas);
            if (chart && chart.data.datasets[0]) {
                totalPoints += chart.data.datasets[0].data.length;
            }
        });
        return totalPoints;
    });

    // Ещё 5 секунд
    console.log('10. Ожидание 5 сек...');
    await page.waitForTimeout(5000);

    const finalChartPoints = await page.evaluate(() => {
        const canvases = document.querySelectorAll('.chart-wrapper canvas, canvas[id^="canvas-"]');
        let totalPoints = 0;
        canvases.forEach(canvas => {
            const chart = Chart.getChart(canvas);
            if (chart && chart.data.datasets[0]) {
                totalPoints += chart.data.datasets[0].data.length;
            }
        });
        return totalPoints;
    });

    console.log('\n=== Результаты ===');
    console.log('Всего точек на графиках:');
    console.log('  До hidden:     ' + beforeChartPoints);
    console.log('  После hidden:  ' + afterChartPoints);
    console.log('  Финал (+5 сек): ' + finalChartPoints);

    // Анализ
    if (afterChartPoints > beforeChartPoints) {
        console.log('\n✓ Данные накапливались во время hidden');
    } else if (beforeChartPoints === 0) {
        console.log('\n⚠️ Данные не поступали на графики');
    } else {
        console.log('\n⚠️ Данные не накапливались во время hidden');
    }

    if (finalChartPoints > afterChartPoints) {
        console.log('✓ График продолжает обновляться после visible');
    }

    console.log('\nБраузер остаётся открытым 60 сек для ручной проверки...');

    await page.waitForTimeout(60000);
    await browser.close();
})();
