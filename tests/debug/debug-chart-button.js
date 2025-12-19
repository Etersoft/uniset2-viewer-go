const { chromium } = require('@playwright/test');

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 300 });
    const page = await browser.newPage();

    page.on('console', msg => console.log('BROWSER:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    console.log('Opening viewer...');
    await page.goto('http://localhost:8000');
    await page.waitForTimeout(2000);

    // Wait for objects
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    console.log('Objects loaded');

    // Click on SharedMemory (or first IONC object)
    const smObject = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    if (await smObject.isVisible().catch(() => false)) {
        await smObject.click();
        console.log('Clicked SharedMemory');
    } else {
        const firstIONC = page.locator('#objects-list li').first();
        await firstIONC.click();
        console.log('Clicked first object');
    }

    await page.waitForTimeout(2000);

    // Wait for sensors
    await page.waitForSelector('.ionc-sensor-row', { timeout: 10000 });
    console.log('Sensors loaded');

    // Find chart checkbox
    const firstRow = page.locator('.ionc-sensor-row').first();
    const checkbox = firstRow.locator('.ionc-chart-checkbox');
    
    console.log('Checkbox exists:', await checkbox.count() > 0);
    console.log('Checkbox visible:', await checkbox.isVisible().catch(() => 'error'));
    
    // Try to click
    try {
        await checkbox.evaluate(el => {
            console.log('Checkbox element:', el);
            console.log('Checkbox checked:', el.checked);
            el.click();
        });
        console.log('Clicked checkbox via evaluate');
    } catch (err) {
        console.log('Error clicking:', err.message);
    }

    await page.waitForTimeout(1000);

    // Check if chart section appeared
    const chartSection = page.locator('[data-section^="charts-"]');
    console.log('Chart section visible:', await chartSection.isVisible().catch(() => false));

    // Check for errors in state
    const stateInfo = await page.evaluate(() => {
        const tabs = window.state?.tabs;
        if (!tabs) return { error: 'No state.tabs' };
        
        for (const [key, tabState] of tabs.entries()) {
            if (key.includes('SharedMemory') || key.includes('SM')) {
                return {
                    tabKey: key,
                    chartsCount: tabState.charts?.size || 0,
                    chartKeys: [...(tabState.charts?.keys() || [])]
                };
            }
        }
        return { error: 'No matching tab' };
    });
    console.log('State info:', JSON.stringify(stateInfo, null, 2));

    console.log('\nKeeping browser open for 30 seconds...');
    await page.waitForTimeout(30000);
    await browser.close();
})();
