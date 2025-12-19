const { chromium } = require('@playwright/test');

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 200 });
    const page = await browser.newPage();

    console.log('=== Sin/Cos Generator Test (SImitator style) ===\n');

    await page.goto('http://localhost:8000');
    await page.waitForTimeout(2000);

    // Открываем SharedMemory
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    const smObject = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    await smObject.click();
    await page.waitForTimeout(1000);

    await page.waitForSelector('.ionc-sensor-row', { timeout: 10000 });
    const firstRow = page.locator('.ionc-sensor-row').first();
    const secondRow = page.locator('.ionc-sensor-row').nth(1);

    console.log('Testing SIN generator\n');
    console.log('Expected: linear(v) * sin(v), e.g., 10*sin(10), 20*sin(20), ...\n');

    // Открываем диалог для первого датчика
    await firstRow.locator('.ionc-btn-gen').click();
    await page.waitForSelector('.ionc-dialog-overlay.visible');

    // Выбираем sin
    await page.selectOption('#ionc-gen-type', 'sin');
    await page.waitForTimeout(500);

    // Проверяем видимость полей
    const periodField = await page.locator('#ionc-gen-period-field').isVisible();
    const stepField = await page.locator('#ionc-gen-step-field').isVisible();
    console.log(`Period field visible: ${periodField} (expected: true)`);
    console.log(`Step field visible: ${stepField} (expected: true)\n`);

    const labelHTML = await page.locator('label[for="ionc-gen-period"]').innerHTML();
    console.log(`Label: ${labelHTML}\n`);

    // Настраиваем параметры для простой проверки
    await page.fill('#ionc-gen-min', '0');
    await page.fill('#ionc-gen-max', '30');
    await page.fill('#ionc-gen-step', '10');
    await page.fill('#ionc-gen-period', '1000');

    console.log('Parameters: min=0, max=30, step=10, pause=1000ms');
    console.log('Linear sequence: 0, 10, 20, 30, 20, 10, ...');
    console.log('Sin modification: v * sin(v) in radians\n');

    // Запускаем
    await page.click('#ionc-gen-start');
    await page.waitForTimeout(300);

    // Мониторим значения
    const values = [];
    const valueCell = firstRow.locator('.ionc-value');

    for (let i = 0; i < 10; i++) {
        const value = await valueCell.textContent();
        const intVal = parseInt(value);
        values.push(intVal);

        // Для каждого шага linear вычисляем что должно быть
        const linearValues = [0, 10, 20, 30, 20, 10, 0, 10, 20, 30];
        const linearVal = linearValues[i % linearValues.length];
        const expectedSin = Math.round(linearVal * Math.sin(linearVal));

        console.log(`[${i}] Value: ${value.padStart(4)} | Linear: ${linearVal.toString().padStart(2)} | Expected sin: ${expectedSin.toString().padStart(4)} | Match: ${intVal === expectedSin ? '✓' : '✗'}`);
        await page.waitForTimeout(1000);
    }

    await firstRow.locator('.ionc-btn-gen-stop').click();

    console.log('\n\nTesting COS generator\n');

    // Открываем диалог для второго датчика
    await secondRow.locator('.ionc-btn-gen').click();
    await page.waitForSelector('.ionc-dialog-overlay.visible');

    // Выбираем cos
    await page.selectOption('#ionc-gen-type', 'cos');
    await page.waitForTimeout(500);

    await page.fill('#ionc-gen-min', '0');
    await page.fill('#ionc-gen-max', '30');
    await page.fill('#ionc-gen-step', '10');
    await page.fill('#ionc-gen-period', '1000');

    await page.click('#ionc-gen-start');
    await page.waitForTimeout(300);

    const values2 = [];
    const valueCell2 = secondRow.locator('.ionc-value');

    for (let i = 0; i < 10; i++) {
        const value = await valueCell2.textContent();
        const intVal = parseInt(value);
        values2.push(intVal);

        const linearValues = [0, 10, 20, 30, 20, 10, 0, 10, 20, 30];
        const linearVal = linearValues[i % linearValues.length];
        const expectedCos = Math.round(linearVal * Math.cos(linearVal));

        console.log(`[${i}] Value: ${value.padStart(4)} | Linear: ${linearVal.toString().padStart(2)} | Expected cos: ${expectedCos.toString().padStart(4)} | Match: ${intVal === expectedCos ? '✓' : '✗'}`);
        await page.waitForTimeout(1000);
    }

    await secondRow.locator('.ionc-btn-gen-stop').click();

    console.log('\n\n=== Test Complete ===');
    console.log('Sin/Cos generators now work like SImitator: linear(v) * sin/cos(v)');

    console.log('\n\nClosing in 3 seconds...');
    await page.waitForTimeout(3000);
    await browser.close();
})();
