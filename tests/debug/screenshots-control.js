/**
 * Скрипт для создания скриншотов системы контроля для документации
 *
 * Запуск:
 *   docker-compose up dev-viewer -d --build
 *   cd tests && node debug/screenshots-control.js
 *
 * Результат: 3 PNG файла в docs/images/
 */

const { chromium } = require('@playwright/test');
const path = require('path');

const DOCS_IMAGES = path.join(__dirname, '../../docs/images');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

(async () => {
    console.log('Starting control screenshots...');
    console.log('Output directory:', DOCS_IMAGES);
    console.log('Base URL:', BASE_URL);

    const browser = await chromium.launch({
        headless: true,
        // headless: false, slowMo: 500  // для отладки
    });

    const page = await browser.newPage({
        viewport: { width: 1280, height: 800 }
    });

    try {
        // 1. Открываем страницу
        console.log('\n1. Opening page...');
        await page.goto(BASE_URL);
        await page.waitForTimeout(2000);

        // Ждём появления control-status
        await page.waitForSelector('#control-status:not(.hidden)', { timeout: 10000 });
        console.log('   Control status visible');

        // 2. Скриншот Read-only индикатора
        console.log('\n2. Taking screenshot: control-readonly.png');

        // Находим header для скриншота
        const header = await page.locator('header');
        await header.screenshot({
            path: path.join(DOCS_IMAGES, 'control-readonly.png')
        });
        console.log('   Saved control-readonly.png');

        // 3. Кликаем Take и делаем скриншот диалога
        console.log('\n3. Opening control dialog...');
        await page.click('.control-status-btn');
        await page.waitForSelector('.control-dialog-overlay.visible', { timeout: 5000 });
        await page.waitForTimeout(300);

        console.log('   Taking screenshot: control-dialog.png');
        const dialog = await page.locator('.control-dialog');
        await dialog.screenshot({
            path: path.join(DOCS_IMAGES, 'control-dialog.png')
        });
        console.log('   Saved control-dialog.png');

        // 4. Вводим токен и берём контроль
        console.log('\n4. Taking control with token...');
        await page.fill('#control-token-input', 'admin123');
        await page.click('.control-btn-primary');

        // Ждём обновления UI - появления класса control-status-active
        await page.waitForSelector('.control-status-active', { timeout: 5000 });
        await page.waitForTimeout(300);

        // Проверяем что контроль взят
        const isController = await page.evaluate(() => window.state?.control?.isController);
        if (!isController) {
            console.log('   Warning: Control not taken');
        } else {
            console.log('   Control taken successfully');
        }

        // 5. Скриншот активного контроля
        console.log('\n5. Taking screenshot: control-active.png');
        await header.screenshot({
            path: path.join(DOCS_IMAGES, 'control-active.png')
        });
        console.log('   Saved control-active.png');

        console.log('\n=== All screenshots saved ===');
        console.log('Files:');
        console.log('  - docs/images/control-readonly.png');
        console.log('  - docs/images/control-dialog.png');
        console.log('  - docs/images/control-active.png');

    } catch (error) {
        console.error('\nError:', error.message);

        // Сохраняем скриншот для отладки
        await page.screenshot({
            path: path.join(DOCS_IMAGES, 'control-error.png'),
            fullPage: true
        });
        console.log('Debug screenshot saved: control-error.png');

        process.exit(1);
    } finally {
        await browser.close();
    }
})();
