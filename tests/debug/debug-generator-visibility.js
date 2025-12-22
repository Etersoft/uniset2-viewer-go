/**
 * Debug: проверка обновления графиков при сворачивании браузера
 * 
 * Запуск:
 *   docker-compose up dev-viewer -d
 *   cd tests && node debug/debug-generator-visibility.js
 * 
 * Инструкция:
 *   1. Скрипт откроет браузер и запустит генератор
 *   2. Сверни браузер в трей на 2-3 минуты
 *   3. Разверни и посмотри логи - видно ли пропуски в данных
 */

const { chromium } = require('@playwright/test');

(async () => {
    console.log('=== Debug: Generator + Visibility Test ===');
    console.log('Сверни браузер на 1-2 минуты, потом разверни.');
    console.log('Смотри на промежутки между событиями.
');

    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 100 
    });
    const page = await browser.newPage();

    let lastDataTime = Date.now();
    let maxGap = 0;
    let eventCount = 0;

    // Логируем SSE события
    page.on('response', async response => {
        if (response.url().includes('/api/events')) {
            console.log('SSE connected');
        }
    });

    console.log('Открываю страницу...');
    await page.goto('http://localhost:8000');
    await page.waitForTimeout(3000);

    // Открываем первый объект
    const firstObj = page.locator('.object-item').first();
    if (await firstObj.isVisible()) {
        await firstObj.click();
        await page.waitForTimeout(2000);
        console.log('Объект открыт');
    }

    // Мониторим состояние через evaluate
    console.log('
=== Начинаю мониторинг (3 минуты) ===');
    console.log('Сверни браузер сейчас!
');

    const startTime = Date.now();
    const duration = 180000; // 3 минуты

    while (Date.now() - startTime < duration) {
        await page.waitForTimeout(5000);
        
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const visible = await page.evaluate(() => document.visibilityState);
        const chartCount = await page.evaluate(() => {
            let count = 0;
            if (window.state && window.state.tabs) {
                window.state.tabs.forEach(tab => {
                    if (tab.charts) count += tab.charts.size;
                });
            }
            return count;
        });

        console.log('[' + elapsed + 's] visibility: ' + visible + ', charts: ' + chartCount);
    }

    console.log('
=== Тест завершён ===');
    console.log('Проверь график - есть ли пропуски в данных?');
    console.log('Браузер останется открытым на 30 секунд...');
    
    await page.waitForTimeout(30000);
    await browser.close();
})();
