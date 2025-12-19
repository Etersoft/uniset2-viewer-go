/**
 * Отладочный скрипт для проверки генератора значений IONC
 * Запуск: cd tests && node debug/debug-generator.js
 */
const { chromium } = require('@playwright/test');

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 300 });
    const page = await browser.newPage();

    // Перехват запросов к API ionc/set
    page.on('request', request => {
        if (request.url().includes('/ionc/set')) {
            console.log('>> SET:', request.postData());
        }
    });

    page.on('response', async response => {
        if (response.url().includes('/ionc/set')) {
            console.log('<< SET response:', response.status());
        }
    });

    // Захват console.log
    page.on('console', msg => {
        if (msg.text().includes('Generator')) {
            console.log('BROWSER:', msg.text());
        }
    });

    console.log('Opening viewer...');
    await page.goto('http://localhost:8000');
    await page.waitForTimeout(3000);

    // Ждём загрузки объектов
    await page.waitForSelector('.object-item', { timeout: 10000 }).catch(() => {
        console.log('No object items found');
    });

    // Находим вкладки объектов
    const objectItems = await page.locator('.object-item').all();
    console.log(`Found ${objectItems.length} object items`);

    // Ищем IONotifyController
    for (const item of objectItems) {
        const text = await item.textContent();
        console.log('Object:', text.trim().substring(0, 50));
        if (text.includes('IONotifyController')) {
            console.log('Clicking on IONotifyController...');
            await item.click();
            await page.waitForTimeout(2000);
            break;
        }
    }

    // Ждём загрузки датчиков
    console.log('Waiting for sensor rows...');
    await page.waitForSelector('.ionc-sensor-row', { timeout: 15000 }).catch(() => {
        console.log('No sensor rows found after wait');
    });

    // Проверяем наличие кнопки генератора
    const genButtons = await page.locator('.ionc-btn-gen').count();
    console.log(`Found ${genButtons} generator buttons`);

    if (genButtons > 0) {
        // Кликаем на первую кнопку генератора
        console.log('Clicking on generator button...');
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForTimeout(500);

        // Проверяем диалог
        const dialogVisible = await page.locator('.ionc-dialog-overlay.visible').isVisible();
        console.log('Dialog visible:', dialogVisible);

        if (dialogVisible) {
            // Проверяем элементы диалога
            const typeSelect = await page.locator('#ionc-gen-type').isVisible();
            const minInput = await page.locator('#ionc-gen-min').isVisible();
            const maxInput = await page.locator('#ionc-gen-max').isVisible();
            const periodInput = await page.locator('#ionc-gen-period').isVisible();
            console.log('Dialog elements:', { typeSelect, minInput, maxInput, periodInput });

            // Устанавливаем значения
            await page.fill('#ionc-gen-min', '10');
            await page.fill('#ionc-gen-max', '50');
            await page.fill('#ionc-gen-period', '3000');

            // Выбираем тип sin
            await page.selectOption('#ionc-gen-type', 'sin');

            console.log('Starting generator...');
            await page.click('#ionc-gen-start');
            await page.waitForTimeout(500);

            // Проверяем что диалог закрылся
            const dialogClosed = !(await page.locator('.ionc-dialog-overlay.visible').isVisible());
            console.log('Dialog closed:', dialogClosed);

            // Проверяем индикатор активного генератора
            const generatingRow = await page.locator('.ionc-sensor-generating').count();
            console.log('Generating rows:', generatingRow);

            const genFlag = await page.locator('.ionc-flag-generator').count();
            console.log('Generator flags:', genFlag);

            const stopButtons = await page.locator('.ionc-btn-gen-stop').count();
            console.log('Stop buttons:', stopButtons);

            // Ждём несколько секунд, наблюдая за запросами
            console.log('Watching generator for 5 seconds...');
            await page.waitForTimeout(5000);

            // Останавливаем генератор
            if (stopButtons > 0) {
                console.log('Stopping generator...');
                await page.locator('.ionc-btn-gen-stop').first().click();
                await page.waitForTimeout(500);

                const genFlagAfter = await page.locator('.ionc-flag-generator').count();
                console.log('Generator flags after stop:', genFlagAfter);
            }
        }
    }

    console.log('\nTest complete. Browser will close in 10 seconds...');
    await page.waitForTimeout(10000);
    await browser.close();
})();
