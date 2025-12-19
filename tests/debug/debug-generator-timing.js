const { chromium } = require('@playwright/test');

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 100 });
    const page = await browser.newPage();

    console.log('=== Generator Period Timing Test ===\n');

    // Track all value changes with precise timestamps
    const valueChanges = [];
    let previousValue = null;

    await page.goto('http://localhost:8000');
    await page.waitForTimeout(2000);

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    const smObject = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    await smObject.click();
    await page.waitForTimeout(1000);

    await page.waitForSelector('.ionc-sensor-row', { timeout: 10000 });

    const firstRow = page.locator('.ionc-sensor-row').first();
    const sensorName = await firstRow.locator('.ionc-col-name').textContent();
    console.log(`Monitoring sensor: ${sensorName}\n`);

    // Start generator
    await firstRow.locator('.ionc-btn-gen').click();
    await page.waitForSelector('.ionc-dialog-overlay.visible');

    const testPeriod = 5000;
    await page.fill('#ionc-gen-min', '0');
    await page.fill('#ionc-gen-max', '100');
    await page.fill('#ionc-gen-period', testPeriod.toString());
    await page.selectOption('#ionc-gen-type', 'sin');

    console.log(`Generator config: sin, min=0, max=100, period=${testPeriod}ms\n`);
    console.log('Starting generator and monitoring for 15 seconds...\n');

    await page.click('#ionc-gen-start');
    const startTime = Date.now();

    // Monitor values
    const monitorDuration = 15000;
    const pollInterval = 50; // Check every 50ms

    while (Date.now() - startTime < monitorDuration) {
        const valueCell = firstRow.locator('.ionc-value');
        const currentValue = await valueCell.textContent();

        if (currentValue !== previousValue) {
            const timestamp = Date.now() - startTime;
            valueChanges.push({
                timestamp,
                value: currentValue,
                delta: valueChanges.length > 0 ?
                    timestamp - valueChanges[valueChanges.length - 1].timestamp : 0
            });

            console.log(`[${timestamp.toString().padStart(6)}ms] Value: ${currentValue.padStart(3)} (Δt: ${valueChanges.length > 1 ? valueChanges[valueChanges.length - 1].delta + 'ms' : 'N/A'})`);

            previousValue = currentValue;
        }

        await page.waitForTimeout(pollInterval);
    }

    // Stop generator
    await firstRow.locator('.ionc-btn-gen-stop').click();

    // Analysis
    console.log('\n=== ANALYSIS ===\n');
    console.log(`Total value changes: ${valueChanges.length}`);
    console.log(`Monitoring duration: ${monitorDuration}ms`);
    console.log(`Expected updates per period: ~20 (period/20 = ${testPeriod/20}ms interval)`);
    console.log(`Expected cycles: ~${monitorDuration/testPeriod}`);

    // Calculate statistics
    if (valueChanges.length > 1) {
        const deltas = valueChanges.slice(1).map(v => v.delta);
        const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const minDelta = Math.min(...deltas);
        const maxDelta = Math.max(...deltas);

        console.log('\nValue change intervals:');
        console.log(`  Average: ${avgDelta.toFixed(1)}ms`);
        console.log(`  Min: ${minDelta}ms`);
        console.log(`  Max: ${maxDelta}ms`);
        console.log(`  Expected: ~${testPeriod/20}ms`);

        // Detect cycles by finding when value returns near initial value
        const initialValue = parseInt(valueChanges[0].value);
        const cycles = [];
        let lastCycleTime = 0;

        for (let i = 1; i < valueChanges.length; i++) {
            const val = parseInt(valueChanges[i].value);
            const prevVal = parseInt(valueChanges[i - 1].value);

            // Detect crossing back to initial value
            if (Math.abs(val - initialValue) <= 2 &&
                Math.abs(prevVal - initialValue) > 5) {
                const cycleTime = valueChanges[i].timestamp - lastCycleTime;
                if (lastCycleTime > 0) { // Skip first cycle
                    cycles.push(cycleTime);
                    console.log(`\nCycle detected at ${valueChanges[i].timestamp}ms (duration: ${cycleTime}ms)`);
                }
                lastCycleTime = valueChanges[i].timestamp;
            }
        }

        if (cycles.length > 0) {
            const avgCycle = cycles.reduce((a, b) => a + b, 0) / cycles.length;
            console.log(`\nCycle timing:`);
            console.log(`  Detected cycles: ${cycles.length}`);
            console.log(`  Average cycle time: ${avgCycle.toFixed(0)}ms`);
            console.log(`  Expected: ${testPeriod}ms`);
            console.log(`  Deviation: ${((avgCycle - testPeriod) / testPeriod * 100).toFixed(1)}%`);

            const withinTolerance = Math.abs(avgCycle - testPeriod) <= testPeriod * 0.1;
            console.log(`  Within ±10% tolerance: ${withinTolerance ? 'YES ✓' : 'NO ✗'}`);
        }
    }

    console.log('\n\nTest complete. Browser will close in 5 seconds...');
    await page.waitForTimeout(5000);
    await browser.close();
})();
