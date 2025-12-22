/**
 * Автоматический тест: эмуляция сворачивания браузера через CDP
 * 
 * Использует Page.setWebLifecycleState для эмуляции frozen/hidden состояния
 */

const { chromium } = require('@playwright/test');

(async () => {
    console.log('=== Test: SSE updates during visibility change ===\n');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Получаем CDP session
    const cdp = await context.newCDPSession(page);

    let sseEvents = [];
    let lastEventTime = 0;

    // Перехватываем SSE через CDP Network
    await cdp.send('Network.enable');
    cdp.on('Network.eventSourceMessageReceived', (params) => {
        const now = Date.now();
        const gap = lastEventTime ? now - lastEventTime : 0;
        sseEvents.push({ time: now, gap: gap, data: params.data?.substring(0, 50) });
        lastEventTime = now;
    });

    console.log('1. Открываю страницу...');
    await page.goto('http://localhost:8000');
    await page.waitForTimeout(2000);

    // Открываем объект
    console.log('2. Открываю объект...');
    await page.locator('.objects-list li').first().click();
    await page.waitForTimeout(2000);

    // Собираем события 10 секунд в нормальном режиме
    console.log('3. Собираю SSE события (10 сек, visible)...');
    await page.waitForTimeout(10000);
    const visibleEvents = sseEvents.length;
    console.log('   Получено событий: ' + visibleEvents);

    // Эмулируем сворачивание через Page lifecycle
    console.log('4. Эмулирую сворачивание (Page.setWebLifecycleState: frozen)...');
    try {
        await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    } catch (e) {
        console.log('   CDP frozen не поддерживается, пробую другой метод...');
        // Альтернатива: эмулируем через visibility
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
            Object.defineProperty(document, 'hidden', { value: true, writable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
    }

    // Ждём 30 секунд в frozen состоянии
    console.log('5. Ожидание 30 сек в frozen/hidden состоянии...');
    await page.waitForTimeout(30000);
    const frozenEvents = sseEvents.length - visibleEvents;
    console.log('   Событий во время frozen: ' + frozenEvents);

    // Размораживаем
    console.log('6. Размораживаю (active/visible)...');
    try {
        await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    } catch (e) {
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
            Object.defineProperty(document, 'hidden', { value: false, writable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
    }

    // Ждём ещё 10 секунд
    console.log('7. Собираю SSE события после разморозки (10 сек)...');
    await page.waitForTimeout(10000);
    const afterEvents = sseEvents.length - visibleEvents - frozenEvents;
    console.log('   Событий после разморозки: ' + afterEvents);

    // Анализ
    console.log('\n=== Результаты ===');
    console.log('События visible (10s): ' + visibleEvents);
    console.log('События frozen (30s):  ' + frozenEvents);
    console.log('События после (10s):   ' + afterEvents);

    // Проверяем пропуски
    const maxGap = Math.max(...sseEvents.map(e => e.gap));
    console.log('Макс. промежуток: ' + (maxGap / 1000).toFixed(1) + 's');

    if (frozenEvents < visibleEvents / 3) {
        console.log('\n⚠️  ПРОБЛЕМА: во время frozen состояния SSE события приходили реже');
    }
    if (afterEvents < visibleEvents / 2) {
        console.log('⚠️  ПРОБЛЕМА: после разморозки SSE события не восстановились');
    }

    await browser.close();
    
    if (frozenEvents < visibleEvents / 3 || afterEvents < visibleEvents / 2) {
        process.exit(1);
    }
    console.log('\n✓ Тест пройден');
})();
