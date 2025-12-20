const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('Opening http://localhost:8000...');
  await page.goto('http://localhost:8000');
  await page.waitForTimeout(2000);

  console.log('Looking for MBSlave1...');
  const mbsItem = await page.locator('#objects-list li').filter({ hasText: 'MBSlave1' }).first();
  await mbsItem.click();

  console.log('Waiting for table...');
  await page.waitForSelector('table.mb-registers-table tbody tr', { timeout: 15000 });

  console.log('\n✅ MBSlave1 opened successfully!');
  console.log('📊 Check docker logs in another terminal:');
  console.log('   docker logs -f uniset-panel-dev-viewer-1 2>&1 | grep -i modbus\n');
  console.log('Browser will stay open. Press Ctrl+C to exit.\n');

  // Keep alive
  await new Promise(() => {});
})();
