import { test, expect } from '@playwright/test';

test.describe('IONC Value Generator Timing', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');

        // Wait for objects to load
        await page.waitForSelector('#objects-list li', { timeout: 10000 });

        // Click on SharedMemory (IONotifyController)
        const smObject = page.locator('#objects-list li', { hasText: 'SharedMemory' });
        const hasSM = await smObject.isVisible().catch(() => false);

        if (!hasSM) {
            test.skip();
            return;
        }

        await smObject.click();

        // Wait for tab to open
        await expect(page.locator('.tab-btn', { hasText: 'SharedMemory' })).toBeVisible();

        // Wait for sensors to load
        await page.waitForSelector('.ionc-sensor-row', { timeout: 10000 });
    });

    test('should complete full cycle in specified period (sin, 5000ms)', async ({ page }) => {
        const firstRow = page.locator('.ionc-sensor-row').first();
        const valueCell = firstRow.locator('.ionc-value');

        // Track value changes with timestamps
        interface ValueChange {
            timestamp: number;
            value: string;
        }
        const values: ValueChange[] = [];

        // Monitor values using polling
        const startMonitoring = async (duration: number) => {
            const startTime = Date.now();
            while (Date.now() - startTime < duration) {
                const value = await valueCell.textContent();
                const timestamp = Date.now();
                values.push({ timestamp, value: value || '' });
                await page.waitForTimeout(100); // Poll every 100ms
            }
        };

        // Start generator with 5s period
        await firstRow.locator('.ionc-btn-gen').click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        await page.fill('#ionc-gen-min', '0');
        await page.fill('#ionc-gen-max', '100');
        await page.fill('#ionc-gen-period', '5000');
        await page.selectOption('#ionc-gen-type', 'sin');

        const startTime = Date.now();
        await page.click('#ionc-gen-start');

        // Wait for initial value to stabilize
        await page.waitForTimeout(200);
        const initialValue = await valueCell.textContent();

        // Monitor for approximately 11 seconds (2+ full cycles)
        await startMonitoring(11000);

        // Stop generator
        await firstRow.locator('.ionc-btn-gen-stop').click();

        // Analyze cycle timing
        const initialNum = parseInt(initialValue || '0');
        const cycles: number[] = [];
        let lastCycleStart = startTime;

        // Find when value returns to approximately initial value
        for (let i = 1; i < values.length; i++) {
            const currentVal = parseInt(values[i].value);
            const prevVal = parseInt(values[i - 1].value);

            // Detect when we cross back to initial value (with tolerance)
            if (Math.abs(currentVal - initialNum) <= 3 &&
                Math.abs(prevVal - initialNum) > 5) {
                const cycleTime = values[i].timestamp - lastCycleStart;
                cycles.push(cycleTime);
                lastCycleStart = values[i].timestamp;
            }
        }

        // Should have at least 1 complete cycle
        expect(cycles.length).toBeGreaterThan(0);

        // Check each cycle is within ±10% of 5000ms
        const expectedPeriod = 5000;
        const tolerance = 0.1; // 10%

        for (const cycleTime of cycles) {
            const deviation = Math.abs(cycleTime - expectedPeriod) / expectedPeriod;
            expect(deviation).toBeLessThan(tolerance);
        }

        // Average should also be close to expected
        const avgCycle = cycles.reduce((a, b) => a + b, 0) / cycles.length;
        expect(avgCycle).toBeGreaterThan(expectedPeriod * (1 - tolerance));
        expect(avgCycle).toBeLessThan(expectedPeriod * (1 + tolerance));
    });

    test('should update values at ~20 updates per period', async ({ page }) => {
        const firstRow = page.locator('.ionc-sensor-row').first();
        const valueCell = firstRow.locator('.ionc-value');

        // Track value changes
        const changes: number[] = [];
        let previousValue: string | null = null;

        // Start generator with 5s period
        await firstRow.locator('.ionc-btn-gen').click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        await page.fill('#ionc-gen-min', '0');
        await page.fill('#ionc-gen-max', '100');
        await page.fill('#ionc-gen-period', '5000');
        await page.selectOption('#ionc-gen-type', 'sin');

        await page.click('#ionc-gen-start');

        // Monitor for 6 seconds
        const startTime = Date.now();
        const monitorDuration = 6000;

        while (Date.now() - startTime < monitorDuration) {
            const currentValue = await valueCell.textContent();
            if (currentValue !== previousValue) {
                changes.push(Date.now());
                previousValue = currentValue;
            }
            await page.waitForTimeout(50);
        }

        // Stop generator
        await firstRow.locator('.ionc-btn-gen-stop').click();

        // Expected: ~20 updates per 5s period = ~24 updates in 6s
        // Allow some variance: 18-30 updates
        expect(changes.length).toBeGreaterThan(18);
        expect(changes.length).toBeLessThan(30);
    });
});
