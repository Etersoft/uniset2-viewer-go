/**
 * Скрипт для создания скриншотов приложения для документации
 * Запуск: cd tests && node take-screenshots.js
 */
const { chromium } = require('@playwright/test');
const path = require('path');

const SCREENSHOT_DIR = path.join(__dirname, '..', 'docs', 'images');
const BASE_URL = 'http://localhost:8000';

async function takeScreenshots() {
  // Запуск браузера в полноэкранном режиме (1920x1080)
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  console.log('Opening application...');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Ждём загрузки списка объектов (группы серверов)
  await page.waitForSelector('.server-group', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // 1. Скриншот главной страницы
  console.log('Taking screenshot: main page...');
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'main-page.png'),
    fullPage: false,
  });

  // 2. Ищем объект с поддержкой графиков (MBSlave, MBMaster, SharedMemory, IONotifyController)
  const objects = page.locator('.server-group-objects li');
  const objectCount = await objects.count();

  let chartObjectFound = false;

  for (let i = 0; i < objectCount; i++) {
    const obj = objects.nth(i);
    const name = await obj.locator('.object-name').textContent();

    // Ищем объекты с графиками
    if (name && (name.includes('MBSlave') || name.includes('MBMaster') ||
        name.includes('SharedMemory') || name.includes('IONotifyController') ||
        name.includes('OPCUAExchange'))) {

      console.log(`Opening object with charts: ${name}...`);
      await obj.click();
      await page.waitForTimeout(2000);

      // Скриншот объекта
      console.log('Taking screenshot: object with data table...');
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'object-tab.png'),
        fullPage: false,
      });

      // Включаем график через label (checkbox скрыт, используется styled label)
      const chartLabel = page.locator('.chart-toggle-label').first();
      if (await chartLabel.count() > 0) {
        console.log('Enabling chart...');
        await chartLabel.click();
        await page.waitForTimeout(4000); // Даём время на отрисовку графика и сбор данных

        // Скриншот с графиком
        console.log('Taking screenshot: with chart...');
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, 'object-with-chart.png'),
          fullPage: false,
        });
        chartObjectFound = true;
      }
      break;
    }
  }

  // 3. Если объект с графиком не найден, открываем первый объект
  if (!chartObjectFound) {
    const firstObj = objects.first();
    const firstName = await firstObj.locator('.object-name').textContent();
    console.log(`Opening first object: ${firstName}...`);
    await firstObj.click();
    await page.waitForTimeout(2000);

    console.log('Taking screenshot: object tab...');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'object-tab.png'),
      fullPage: false,
    });
  }

  // 4. Открываем объект другого типа для разнообразия
  const currentTabs = await page.locator('.tab-button').count();
  if (currentTabs > 0) {
    // Ищем UniSetActivator или другой общий объект
    for (let i = 0; i < objectCount; i++) {
      const obj = objects.nth(i);
      const name = await obj.locator('.object-name').textContent();

      if (name && name.includes('UniSetActivator')) {
        console.log(`Opening different object: ${name}...`);
        await obj.click();
        await page.waitForTimeout(2000);

        console.log('Taking screenshot: activator object...');
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, 'object-activator.png'),
          fullPage: false,
        });
        break;
      }
    }
  }

  await browser.close();
  console.log('\nScreenshots saved to docs/images/');
  console.log('Done!');
}

takeScreenshots().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
