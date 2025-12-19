const { chromium } = require('@playwright/test');

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 300 });
    const page = await browser.newPage();

    // Очищаем localStorage перед тестом
    await page.goto('http://localhost:8000');
    await page.evaluate(() => localStorage.removeItem('ionc-gen-last-type'));
    await page.reload();
    await page.waitForTimeout(2000);

    console.log('=== Test: Generator localStorage ===\n');

    // Ждём загрузки объектов
    await page.waitForSelector('#objects-list li', { timeout: 10000 });

    // Открываем SharedMemory
    const smObject = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    await smObject.click();
    await page.waitForTimeout(1500);

    // Ждём загрузки датчиков
    await page.waitForSelector('.ionc-sensor-row', { timeout: 10000 });
    console.log('Sensors loaded');

    // === ТЕСТ 1: Первый датчик - выбираем 'cos' ===
    console.log('\n--- Step 1: Open generator for sensor 1, select "cos" ---');

    const firstRow = page.locator('.ionc-sensor-row').first();
    const firstGenBtn = firstRow.locator('.ionc-btn-gen');
    await firstGenBtn.click();
    await page.waitForSelector('.ionc-dialog-overlay.visible');

    // Проверяем начальное значение (должен быть 'sin' по умолчанию)
    const initialValue = await page.locator('#ionc-gen-type').inputValue();
    console.log('Initial select value: "' + initialValue + '" (expected: "sin")');

    // Выбираем 'cos'
    await page.selectOption('#ionc-gen-type', 'cos');
    const selectedValue = await page.locator('#ionc-gen-type').inputValue();
    console.log('Selected value: "' + selectedValue + '"');

    // Запускаем генератор (это сохранит тип в localStorage)
    await page.click('#ionc-gen-start');
    await page.waitForTimeout(500);
    console.log('Generator started for sensor 1');

    // Проверяем localStorage
    const savedType = await page.evaluate(() => localStorage.getItem('ionc-gen-last-type'));
    console.log('localStorage value: "' + savedType + '" (expected: "cos")');

    // === ТЕСТ 2: Второй датчик - проверяем что 'cos' предвыбран ===
    console.log('\n--- Step 2: Open generator for sensor 2, check pre-selected ---');

    const secondRow = page.locator('.ionc-sensor-row').nth(1);
    const secondGenBtn = secondRow.locator('.ionc-btn-gen');
    await secondGenBtn.click();
    await page.waitForSelector('.ionc-dialog-overlay.visible');

    // Проверяем что 'cos' предвыбран
    const preselectedValue = await page.locator('#ionc-gen-type').inputValue();
    console.log('Pre-selected value: "' + preselectedValue + '" (expected: "cos")');

    // Закрываем диалог
    await page.click('.ionc-dialog-btn-cancel');
    await page.waitForTimeout(300);

    // === ТЕСТ 3: Выбираем 'random' и проверяем ===
    console.log('\n--- Step 3: Select "random" for sensor 2, verify persistence ---');

    await secondGenBtn.click();
    await page.waitForSelector('.ionc-dialog-overlay.visible');

    await page.selectOption('#ionc-gen-type', 'random');
    await page.click('#ionc-gen-start');
    await page.waitForTimeout(500);

    const savedType2 = await page.evaluate(() => localStorage.getItem('ionc-gen-last-type'));
    console.log('localStorage after random: "' + savedType2 + '" (expected: "random")');

    // === ТЕСТ 4: Третий датчик - проверяем что 'random' предвыбран ===
    console.log('\n--- Step 4: Open generator for sensor 3, check "random" pre-selected ---');

    const thirdRow = page.locator('.ionc-sensor-row').nth(2);
    const thirdGenBtn = thirdRow.locator('.ionc-btn-gen');
    await thirdGenBtn.click();
    await page.waitForSelector('.ionc-dialog-overlay.visible');

    const preselectedValue2 = await page.locator('#ionc-gen-type').inputValue();
    console.log('Pre-selected value: "' + preselectedValue2 + '" (expected: "random")');

    // === ИТОГИ ===
    console.log('\n=== RESULTS ===');
    const test1 = initialValue === 'sin';
    const test2 = savedType === 'cos';
    const test3 = preselectedValue === 'cos';
    const test4 = savedType2 === 'random';
    const test5 = preselectedValue2 === 'random';

    console.log('Initial default is "sin": ' + (test1 ? 'PASS' : 'FAIL'));
    console.log('localStorage saves "cos": ' + (test2 ? 'PASS' : 'FAIL'));
    console.log('Dialog pre-selects "cos": ' + (test3 ? 'PASS' : 'FAIL'));
    console.log('localStorage saves "random": ' + (test4 ? 'PASS' : 'FAIL'));
    console.log('Dialog pre-selects "random": ' + (test5 ? 'PASS' : 'FAIL'));

    const allPassed = test1 && test2 && test3 && test4 && test5;
    console.log('\nOverall: ' + (allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));

    // Останавливаем генераторы
    console.log('\nStopping generators...');
    await page.locator('.ionc-btn-gen-stop').first().click();
    await page.waitForTimeout(200);
    await page.locator('.ionc-btn-gen-stop').first().click();

    console.log('\nTest complete. Closing in 5 seconds...');
    await page.waitForTimeout(5000);
    await browser.close();

    process.exit(allPassed ? 0 : 1);
})();
