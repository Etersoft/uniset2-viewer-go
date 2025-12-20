// Debug script: проверка сохранения состояния свёрнутых секций
const { chromium } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

(async () => {
    console.log('=== Debug: Collapsed Sections localStorage ===\n');

    const browser = await chromium.launch({ headless: false, slowMo: 300 });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('collapsed') || text.includes('localStorage') ||
            text.includes('toggle') || text.includes('Before') || text.includes('After')) {
            console.log('BROWSER:', text);
        }
    });

    console.log(`Opening ${BASE_URL}...`);
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);

    // Находим MBSlave1
    console.log('\nLooking for MBSlave1...');
    const mbSlaveNode = await page.locator('text=MBSlave1').first();
    if (await mbSlaveNode.isVisible()) {
        await mbSlaveNode.click();
        await page.waitForTimeout(2000);
    }

    // Проверяем, что секции есть
    console.log('\n=== Initial section state ===');
    let sectionState = await page.evaluate(() => {
        const sections = document.querySelectorAll('.collapsible-section[data-section]');
        return Array.from(sections).map(s => ({
            id: s.dataset.section,
            collapsed: s.classList.contains('collapsed')
        }));
    });
    console.log('Sections:', JSON.stringify(sectionState, null, 2));

    // Проверяем localStorage до клика
    let localStorageBefore = await page.evaluate(() => {
        return localStorage.getItem('uniset-panel-collapsed');
    });
    console.log('\nlocalStorage before:', localStorageBefore);

    // Сворачиваем секцию Charts через toggleSection напрямую
    console.log('\n=== Collapsing Charts section ===');
    await page.evaluate(() => {
        console.log('Before toggle: sections=', document.querySelectorAll('.collapsible-section[data-section]').length);
        const sectionId = 'charts-MBSlave1';
        console.log('Calling toggleSection:', sectionId);
        window.toggleSection(sectionId);
        console.log('After toggle');
    });
    await page.waitForTimeout(500);

    // Проверяем состояние после клика
    sectionState = await page.evaluate(() => {
        const sections = document.querySelectorAll('.collapsible-section[data-section]');
        return Array.from(sections).map(s => ({
            id: s.dataset.section,
            collapsed: s.classList.contains('collapsed')
        }));
    });
    console.log('Sections after collapse:', JSON.stringify(sectionState, null, 2));

    // Проверяем localStorage после клика
    let localStorageAfter = await page.evaluate(() => {
        return localStorage.getItem('uniset-panel-collapsed');
    });
    console.log('\nlocalStorage after:', localStorageAfter);

    // Перезагружаем страницу
    console.log('\n=== Reloading page ===');
    await page.reload();
    await page.waitForTimeout(2000);

    // Снова открываем MBSlave1
    console.log('\nReopening MBSlave1...');
    const mbSlaveNode2 = await page.locator('text=MBSlave1').first();
    if (await mbSlaveNode2.isVisible()) {
        await mbSlaveNode2.click();
        await page.waitForTimeout(2000);
    }

    // Проверяем, что состояние восстановлено
    console.log('\n=== Section state after reload ===');
    sectionState = await page.evaluate(() => {
        const sections = document.querySelectorAll('.collapsible-section[data-section]');
        return Array.from(sections).map(s => ({
            id: s.dataset.section,
            collapsed: s.classList.contains('collapsed')
        }));
    });
    console.log('Sections:', JSON.stringify(sectionState, null, 2));

    // Проверяем, что Charts свёрнут
    const chartsCollapsed = sectionState.find(s => s.id.includes('charts'))?.collapsed;
    if (chartsCollapsed) {
        console.log('\n SUCCESS: Charts section is collapsed after reload!');
    } else {
        console.log('\n FAIL: Charts section is NOT collapsed after reload!');
    }

    console.log('\nDone! Browser will stay open for 30 seconds...');
    await page.waitForTimeout(30000);

    await browser.close();
})();
