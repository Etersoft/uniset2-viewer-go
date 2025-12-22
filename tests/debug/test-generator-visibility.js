/**
 * Тест: проверка работы генератора при эмуляции скрытия страницы
 */

const { chromium } = require('@playwright/test');

(async () => {
    console.log('=== Test: Generator during visibility change ===\n');

    const browser = await chromium.launch({ headless: false, slowMo: 50 });
    const page = await browser.newPage();

    await page.goto('http://localhost:8000');
    await page.waitForTimeout(2000);

    // Открываем SharedMemory (IONotifyController)
    console.log('1. Открываю SharedMemory...');
    const obj = page.locator('.objects-list li:has-text("SharedMemory")').first();
    await obj.click();
    await page.waitForTimeout(2000);

    // Запускаем генератор на первом доступном сенсоре
    console.log('2. Запускаю генератор...');
    const genBtn = page.locator('.ionc-btn-gen').first();
    if (!(await genBtn.isVisible())) {
        console.log('   Генератор не доступен - возможно нет сенсоров');
        await browser.close();
        process.exit(0);
    }
    await genBtn.click();
    await page.waitForTimeout(500);

    // Настраиваем генератор (sin, период 2 сек)
    await page.locator('#gen-type').selectOption('sin');
    await page.locator('#gen-min').fill('0');
    await page.locator('#gen-max').fill('100');
    await page.locator('#gen-period').fill('2000');
    await page.locator('#gen-start-btn').click();
    await page.waitForTimeout(1000);

    console.log('3. Генератор запущен, собираю данные 10 сек...');
    
    // Считаем сколько раз генератор отправил значение
    let apiCalls = 0;
    page.on('request', req => {
        // SharedMemory/IONC set requests
        if (req.url().includes('/SharedMemory/set')) {
            apiCalls++;
        }
    });

    await page.waitForTimeout(10000);
    const visibleCalls = apiCalls;
    console.log('   API вызовов (visible): ' + visibleCalls);

    // Эмулируем скрытие
    console.log('4. Эмулирую скрытие страницы...');
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });

    apiCalls = 0;
    await page.waitForTimeout(30000);
    const hiddenCalls = apiCalls;
    console.log('   API вызовов (hidden, 30s): ' + hiddenCalls);

    // Возвращаем видимость
    console.log('5. Возвращаю видимость...');
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });

    apiCalls = 0;
    await page.waitForTimeout(10000);
    const afterCalls = apiCalls;
    console.log('   API вызовов (после, 10s): ' + afterCalls);

    console.log('\n=== Результаты ===');
    console.log('Visible (10s):  ' + visibleCalls + ' вызовов');
    console.log('Hidden (30s):   ' + hiddenCalls + ' вызовов');
    console.log('После (10s):    ' + afterCalls + ' вызовов');

    const expectedHidden = visibleCalls * 3; // 30s vs 10s
    if (hiddenCalls < expectedHidden * 0.5) {
        console.log('\n⚠️  ПРОБЛЕМА: генератор замедлился в hidden состоянии');
        console.log('Ожидалось ~' + expectedHidden + ', получено ' + hiddenCalls);
    } else {
        console.log('\n✓ Генератор работает нормально');
    }

    await browser.close();
})();
