/**
 * Тест: проверка обновления графиков при сворачивании браузера
 *
 * Изменения данных происходят на уровне сервера (через API),
 * а не в браузере - это изолирует проблему обновления графиков.
 *
 * Запуск:
 *   docker-compose up viewer -d  # mock-сервер
 *   cd tests && node debug/test-chart-visibility.js
 */

const { chromium } = require('@playwright/test');
const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

// Отправляем запрос на изменение значения сенсора через mock-server
async function setSensorValue(sensorId, value) {
    return new Promise((resolve, reject) => {
        const url = `http://localhost:9393/api/v2/SharedMemory/set?supplier=test&${sensorId}=${value}`;
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

(async () => {
    console.log('=== Test: Chart updates during visibility change ===\n');
    console.log('Данные изменяются на сервере через API, не в браузере\n');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Получаем CDP session для отслеживания SSE
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');

    let sseEvents = 0;
    cdp.on('Network.eventSourceMessageReceived', () => {
        sseEvents++;
    });

    console.log('1. Открываю страницу...');
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);

    // Очищаем localStorage чтобы секции были развёрнуты
    await page.evaluate(() => {
        localStorage.removeItem('uniset-panel-collapsed');
        localStorage.removeItem('uniset-panel-io-collapse');
    });

    // Открываем SharedMemory
    console.log('2. Открываю SharedMemory...');
    const smItem = page.locator('.objects-list li:has-text("SharedMemory")');
    if (await smItem.count() === 0) {
        console.log('   SharedMemory не найден, пробую первый объект...');
        await page.locator('.objects-list li').first().click();
    } else {
        await smItem.first().click();
    }
    await page.waitForTimeout(2000);

    // Раскрываем секцию сенсоров если она свёрнута
    console.log('3. Раскрываю секцию сенсоров...');
    const sensorsSection = page.locator('[data-section^="ionc-sensors-"]');
    if (await sensorsSection.count() > 0) {
        const isCollapsed = await sensorsSection.evaluate(el => el.classList.contains('collapsed'));
        if (isCollapsed) {
            await sensorsSection.locator('.collapsible-header').click();
            await page.waitForTimeout(500);
        }
    }

    // Ждём загрузки сенсоров
    await page.waitForTimeout(1500);

    // Включаем график для первого сенсора
    console.log('4. Включаю график для первого сенсора...');
    // input скрыт (display: none), кликаем на label
    const chartLabel = page.locator('.chart-toggle-label').first();
    if (await chartLabel.count() > 0) {
        await chartLabel.waitFor({ state: 'visible', timeout: 10000 });
        await chartLabel.click();
        await page.waitForTimeout(500);
        console.log('   График включён');
    } else {
        console.log('   Чекбокс графика не найден!');
    }

    // Запускаем изменение значений на сервере (из Node.js, не из браузера)
    console.log('5. Запускаю изменение значений на сервере...');

    let valueChangeCount = 0;
    const changeInterval = setInterval(async () => {
        try {
            // Изменяем значение сенсора 1 (случайное число 0-1000)
            const value = Math.floor(Math.random() * 1000);
            await setSensorValue(1, value);
            valueChangeCount++;
        } catch (e) {
            // Игнорируем ошибки подключения
        }
    }, 500); // Каждые 500ms

    // Собираем события 10 секунд в visible состоянии
    console.log('6. Собираю SSE события (10 сек, visible)...');
    const startEvents = sseEvents;
    await page.waitForTimeout(10000);
    const visibleEvents = sseEvents - startEvents;
    const visibleChanges = valueChangeCount;
    console.log('   SSE событий: ' + visibleEvents + ', изменений значений: ' + visibleChanges);

    // Проверяем обновление графика
    const beforeChartPoints = await page.evaluate(() => {
        const charts = document.querySelectorAll('.chart-canvas');
        if (charts.length > 0) {
            const chart = Chart.getChart(charts[0]);
            return chart ? chart.data.datasets[0].data.length : 0;
        }
        return 0;
    });
    console.log('   Точек на графике: ' + beforeChartPoints);

    // Эмулируем скрытие страницы
    console.log('\n7. Эмулирую скрытие страницы...');
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });

    // Продолжаем изменять значения на сервере 30 секунд
    console.log('8. Жду 30 сек в hidden состоянии (сервер продолжает менять данные)...');
    const hiddenStartEvents = sseEvents;
    const hiddenStartChanges = valueChangeCount;
    await page.waitForTimeout(30000);
    const hiddenEvents = sseEvents - hiddenStartEvents;
    const hiddenChanges = valueChangeCount - hiddenStartChanges;
    console.log('   SSE событий: ' + hiddenEvents + ', изменений значений: ' + hiddenChanges);

    // Возвращаем видимость
    console.log('\n9. Возвращаю видимость...');
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });

    // Даём время на обновление UI
    await page.waitForTimeout(2000);

    // Проверяем график после восстановления
    const afterChartPoints = await page.evaluate(() => {
        const charts = document.querySelectorAll('.chart-canvas');
        if (charts.length > 0) {
            const chart = Chart.getChart(charts[0]);
            return chart ? chart.data.datasets[0].data.length : 0;
        }
        return 0;
    });

    // Продолжаем ещё 10 секунд после восстановления
    console.log('10. Собираю SSE события после восстановления (10 сек)...');
    const afterStartEvents = sseEvents;
    await page.waitForTimeout(10000);
    const afterEvents = sseEvents - afterStartEvents;
    console.log('   SSE событий: ' + afterEvents);

    const finalChartPoints = await page.evaluate(() => {
        const charts = document.querySelectorAll('.chart-canvas');
        if (charts.length > 0) {
            const chart = Chart.getChart(charts[0]);
            return chart ? chart.data.datasets[0].data.length : 0;
        }
        return 0;
    });

    clearInterval(changeInterval);

    console.log('\n=== Результаты ===');
    console.log('Visible (10s): ' + visibleEvents + ' SSE событий');
    console.log('Hidden (30s):  ' + hiddenEvents + ' SSE событий');
    console.log('После (10s):   ' + afterEvents + ' SSE событий');
    console.log('');
    console.log('Точек на графике:');
    console.log('  До hidden:    ' + beforeChartPoints);
    console.log('  После hidden: ' + afterChartPoints);
    console.log('  Финал:        ' + finalChartPoints);

    await browser.close();

    // Анализ
    let hasProblems = false;

    if (hiddenEvents < visibleEvents / 3) {
        console.log('\n⚠️  SSE события замедлились в hidden состоянии');
        hasProblems = true;
    }

    if (afterEvents < visibleEvents / 2) {
        console.log('⚠️  SSE события не восстановились после hidden');
        hasProblems = true;
    }

    if (afterChartPoints <= beforeChartPoints && hiddenChanges > 10) {
        console.log('⚠️  График не обновился во время hidden состояния');
        hasProblems = true;
    }

    if (!hasProblems) {
        console.log('\n✓ Тест пройден');
    } else {
        process.exit(1);
    }
})();
