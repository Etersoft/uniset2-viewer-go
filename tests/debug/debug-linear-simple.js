const { chromium } = require('@playwright/test');

(async () => {
    const browser = await chromium.launch({
        headless: false,
        slowMo: 300
    });

    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();

    // Перехват console.log из браузера
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log('[BROWSER ERROR]', msg.text());
        }
    });

    console.log('=== Linear Generator Simple Test ===\n');

    // Переходим на страницу
    await page.goto('http://localhost:8000');
    await page.waitForTimeout(2000);

    console.log('Page loaded\n');

    // Открываем SharedMemory
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    const smObject = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    await smObject.click();
    await page.waitForTimeout(1000);

    await page.waitForSelector('.ionc-sensor-row', { timeout: 10000 });
    const firstRow = page.locator('.ionc-sensor-row').first();

    console.log('Opening generator dialog...\n');
    await firstRow.locator('.ionc-btn-gen').click();
    await page.waitForSelector('.ionc-dialog-overlay.visible');

    console.log('Selecting linear type...\n');
    await page.selectOption('#ionc-gen-type', 'linear');
    await page.waitForTimeout(1000);

    // Проверяем HTML структуру диалога
    console.log('Checking dialog structure...\n');

    const periodField = await page.locator('#ionc-gen-period-field').isVisible();
    const stepField = await page.locator('#ionc-gen-step-field').isVisible();
    const pulseFields = await page.locator('#ionc-gen-pulse-fields').isVisible();

    console.log(`Period field visible: ${periodField} (expected: true)`);
    console.log(`Step field visible: ${stepField} (expected: true)`);
    console.log(`Pulse fields visible: ${pulseFields} (expected: false)\n`);

    // Проверяем текст label
    const labelHTML = await page.locator('label[for="ionc-gen-period"]').innerHTML();
    console.log(`Period label HTML: ${labelHTML}\n`);

    // Устанавливаем параметры
    console.log('Setting parameters: min=0, max=40, step=10, pause=1000ms\n');
    await page.fill('#ionc-gen-min', '0');
    await page.fill('#ionc-gen-max', '40');
    await page.fill('#ionc-gen-step', '10');
    await page.fill('#ionc-gen-period', '1000');

    console.log('Expected sequence: 0, 10, 20, 30, 40, 30, 20, 10, 0, ...\n');
    console.log('Starting generator...\n');

    await page.click('#ionc-gen-start');
    await page.waitForTimeout(500);

    // Мониторим значения
    const values = [];
    const valueCell = firstRow.locator('.ionc-value');

    for (let i = 0; i < 15; i++) {
        const value = await valueCell.textContent();
        values.push(parseInt(value));
        console.log(`[${(i * 1000).toString().padStart(5)}ms] Value: ${value}`);
        await page.waitForTimeout(1000);
    }

    // Останавливаем
    await firstRow.locator('.ionc-btn-gen-stop').click();

    console.log('\n=== RESULTS ===\n');
    console.log(`Captured values: ${values.join(', ')}\n`);
    console.log(`Expected pattern: 0, 10, 20, 30, 40, 30, 20, 10, 0, 10, 20, 30, 40, ...`);

    // Проверяем что значения соответствуют ожидаемой последовательности
    let isCorrect = true;
    const expected = [0, 10, 20, 30, 40, 30, 20, 10, 0, 10, 20, 30, 40, 30, 20];
    for (let i = 0; i < Math.min(values.length, expected.length); i++) {
        if (values[i] !== expected[i]) {
            console.log(`\n✗ Mismatch at index ${i}: got ${values[i]}, expected ${expected[i]}`);
            isCorrect = false;
        }
    }

    if (isCorrect) {
        console.log('\n✓ Linear generator works correctly!');
    } else {
        console.log('\n✗ Linear generator does NOT work as expected');
    }

    console.log('\n\nClosing in 3 seconds...');
    await page.waitForTimeout(3000);
    await browser.close();
})();
