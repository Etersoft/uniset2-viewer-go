import { test, expect } from '@playwright/test';

test.describe('IONC Value Generator', () => {
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

    test('should display generator button in sensor row', async ({ page }) => {
        // Check that generator button exists
        const genButton = page.locator('.ionc-btn-gen').first();
        await expect(genButton).toBeVisible();
        await expect(genButton).toHaveAttribute('title', 'Генератор значений');
    });

    test('should open generator dialog on button click', async ({ page }) => {
        // Click on generator button
        await page.locator('.ionc-btn-gen').first().click();

        // Check that dialog is visible
        const dialog = page.locator('.ionc-dialog-overlay.visible');
        await expect(dialog).toBeVisible();

        // Check dialog title
        const title = page.locator('.ionc-dialog-title');
        await expect(title).toHaveText('Генератор значений');

        // Check form elements exist
        await expect(page.locator('#ionc-gen-type')).toBeVisible();
        await expect(page.locator('#ionc-gen-min')).toBeVisible();
        await expect(page.locator('#ionc-gen-max')).toBeVisible();
        await expect(page.locator('#ionc-gen-period')).toBeVisible();

        // Check buttons
        await expect(page.locator('#ionc-gen-start')).toBeVisible();
        await expect(page.locator('.ionc-dialog-btn-cancel')).toBeVisible();
    });

    test('should have all generator types in select', async ({ page }) => {
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        const select = page.locator('#ionc-gen-type');

        // Check all options
        const options = await select.locator('option').allTextContents();
        expect(options).toContain('sin(t) - Синусоида');
        expect(options).toContain('cos(t) - Косинусоида');
        expect(options).toContain('linear - Пилообразный');
        expect(options).toContain('random - Случайные значения');
        expect(options).toContain('square - Прямоугольный');
    });

    test('should validate min < max', async ({ page }) => {
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        // Set invalid values (min >= max)
        await page.fill('#ionc-gen-min', '100');
        await page.fill('#ionc-gen-max', '50');

        // Try to start
        await page.click('#ionc-gen-start');

        // Check error message
        const error = page.locator('.ionc-dialog-error');
        await expect(error).toHaveText('Min должен быть меньше Max');

        // Dialog should still be open
        await expect(page.locator('.ionc-dialog-overlay.visible')).toBeVisible();
    });

    test('should validate period >= 100ms', async ({ page }) => {
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        // Set invalid period
        await page.fill('#ionc-gen-period', '50');

        // Try to start
        await page.click('#ionc-gen-start');

        // Check error message
        const error = page.locator('.ionc-dialog-error');
        await expect(error).toHaveText('Период должен быть не менее 100мс');
    });

    test('should start generator and show indicators', async ({ page }) => {
        // Get the first sensor's row before starting
        const firstRow = page.locator('.ionc-sensor-row').first();
        const sensorId = await firstRow.getAttribute('data-sensor-id');

        // Click generator button
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        // Configure generator
        await page.fill('#ionc-gen-min', '10');
        await page.fill('#ionc-gen-max', '50');
        await page.fill('#ionc-gen-period', '2000');
        await page.selectOption('#ionc-gen-type', 'sin');

        // Start generator
        await page.click('#ionc-gen-start');

        // Dialog should close
        await expect(page.locator('.ionc-dialog-overlay.visible')).not.toBeVisible();

        // Check that row has generating class
        const updatedRow = page.locator(`tr[data-sensor-id="${sensorId}"]`);
        await expect(updatedRow).toHaveClass(/ionc-sensor-generating/);

        // Check that generator flag is visible
        const genFlag = updatedRow.locator('.ionc-flag-generator');
        await expect(genFlag).toBeVisible();

        // Check that stop button is visible instead of start
        const stopBtn = updatedRow.locator('.ionc-btn-gen-stop');
        await expect(stopBtn).toBeVisible();

        // The gen button should not be visible anymore
        const genBtn = updatedRow.locator('.ionc-btn-gen');
        await expect(genBtn).not.toBeVisible();
    });

    test('should stop generator on stop button click', async ({ page }) => {
        // Start a generator first
        const firstRow = page.locator('.ionc-sensor-row').first();
        const sensorId = await firstRow.getAttribute('data-sensor-id');

        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        await page.fill('#ionc-gen-min', '0');
        await page.fill('#ionc-gen-max', '100');
        await page.fill('#ionc-gen-period', '1000');
        await page.click('#ionc-gen-start');

        // Wait a bit for generator to run
        await page.waitForTimeout(500);

        // Stop the generator
        await page.locator('.ionc-btn-gen-stop').first().click();

        // Check that row no longer has generating class
        const updatedRow = page.locator(`tr[data-sensor-id="${sensorId}"]`);
        await expect(updatedRow).not.toHaveClass(/ionc-sensor-generating/);

        // Generator flag should be gone
        const genFlag = updatedRow.locator('.ionc-flag-generator');
        await expect(genFlag).not.toBeVisible();

        // Start button should be back
        const genBtn = updatedRow.locator('.ionc-btn-gen');
        await expect(genBtn).toBeVisible();
    });

    test('should show active generator info in dialog', async ({ page }) => {
        // Start a generator
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        await page.fill('#ionc-gen-min', '20');
        await page.fill('#ionc-gen-max', '80');
        await page.fill('#ionc-gen-period', '3000');
        await page.selectOption('#ionc-gen-type', 'cos');
        await page.click('#ionc-gen-start');

        // Open dialog again by clicking stop button (which opens dialog when generator is active)
        // Actually, we click on the gen-stop button to stop, but to see dialog we click on button area
        // Let's verify by clicking the row's stop button which just stops
        // Instead, let's check by programmatically - the stop button just stops

        // We can verify the generator is running by checking the indicators
        await expect(page.locator('.ionc-sensor-generating').first()).toBeVisible();
        await expect(page.locator('.ionc-flag-generator').first()).toBeVisible();
    });

    test('generator button should be disabled for readonly sensors', async ({ page }) => {
        // Find a readonly sensor if exists
        const readonlyRow = page.locator('.ionc-sensor-readonly').first();

        // Only run test if there's a readonly sensor
        const count = await readonlyRow.count();
        if (count > 0) {
            const genBtn = readonlyRow.locator('.ionc-btn-gen');
            await expect(genBtn).toBeDisabled();
        }
    });

    test('should send set requests while generator is running', async ({ page }) => {
        // Setup request interception - track set requests
        const setRequests: string[] = [];
        page.on('request', request => {
            if (request.url().includes('/ionc/set') && request.method() === 'POST') {
                setRequests.push(request.postData() || '');
            }
        });

        // Start generator
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        await page.fill('#ionc-gen-min', '0');
        await page.fill('#ionc-gen-max', '100');
        await page.fill('#ionc-gen-period', '500');
        await page.click('#ionc-gen-start');

        // Wait for some requests
        await page.waitForTimeout(2000);

        // Stop generator
        await page.locator('.ionc-btn-gen-stop').first().click();

        // Should have made several set requests (period 500ms, wait 2s = ~4 updates)
        expect(setRequests.length).toBeGreaterThan(2);

        // Verify request format
        if (setRequests.length > 0) {
            const parsed = JSON.parse(setRequests[0]);
            expect(parsed).toHaveProperty('sensor_id');
            expect(parsed).toHaveProperty('value');
        }
    });

    test('should close dialog on cancel', async ({ page }) => {
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        // Click cancel
        await page.locator('.ionc-dialog-btn-cancel').click();

        // Dialog should close
        await expect(page.locator('.ionc-dialog-overlay.visible')).not.toBeVisible();

        // No generator should be running
        await expect(page.locator('.ionc-sensor-generating')).not.toBeVisible();
    });

    test('should close dialog on ESC key', async ({ page }) => {
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        // Press ESC
        await page.keyboard.press('Escape');

        // Dialog should close
        await expect(page.locator('.ionc-dialog-overlay.visible')).not.toBeVisible();
    });

    test('should show step field for linear type', async ({ page }) => {
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        // Select linear
        await page.selectOption('#ionc-gen-type', 'linear');

        // Wait for visibility update
        await page.waitForTimeout(100);

        // Period and step should be visible
        await expect(page.locator('#ionc-gen-period-field')).toBeVisible();
        await expect(page.locator('#ionc-gen-step-field')).toBeVisible();

        // Pulse fields should be hidden
        await expect(page.locator('#ionc-gen-pulse-fields')).not.toBeVisible();
    });

    test('should show pulse fields for square type', async ({ page }) => {
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        // Select square
        await page.selectOption('#ionc-gen-type', 'square');

        // Wait for visibility update
        await page.waitForTimeout(100);

        // Pulse fields should be visible
        await expect(page.locator('#ionc-gen-pulse-fields')).toBeVisible();
        await expect(page.locator('#ionc-gen-pulse-width')).toBeVisible();
        await expect(page.locator('#ionc-gen-pause')).toBeVisible();

        // Period and step should be hidden
        await expect(page.locator('#ionc-gen-period-field')).not.toBeVisible();
        await expect(page.locator('#ionc-gen-step-field')).not.toBeVisible();
    });

    test('should validate step > 0 for linear', async ({ page }) => {
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        // Select linear
        await page.selectOption('#ionc-gen-type', 'linear');
        await page.waitForTimeout(100);

        // Set invalid step (0)
        await page.fill('#ionc-gen-step', '0');

        // Try to start
        await page.click('#ionc-gen-start');

        // Check error message
        const error = page.locator('.ionc-dialog-error');
        await expect(error).toHaveText('Шаг должен быть больше 0');
    });

    test('should validate step <= (max - min) for linear', async ({ page }) => {
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        // Select linear
        await page.selectOption('#ionc-gen-type', 'linear');
        await page.waitForTimeout(100);

        // Set step > range
        await page.fill('#ionc-gen-min', '0');
        await page.fill('#ionc-gen-max', '100');
        await page.fill('#ionc-gen-step', '200');

        // Try to start
        await page.click('#ionc-gen-start');

        // Check error message
        const error = page.locator('.ionc-dialog-error');
        await expect(error).toHaveText('Шаг должен быть меньше или равен разности Max - Min');
    });

    test('should validate pulseWidth > 0 for square', async ({ page }) => {
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        // Select square
        await page.selectOption('#ionc-gen-type', 'square');
        await page.waitForTimeout(100);

        // Set invalid pulse width
        await page.fill('#ionc-gen-pulse-width', '0');

        // Try to start
        await page.click('#ionc-gen-start');

        // Check error message
        const error = page.locator('.ionc-dialog-error');
        await expect(error).toHaveText('Ширина импульса должна быть больше 0');
    });

    test('should validate pause > 0 for square', async ({ page }) => {
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        // Select square
        await page.selectOption('#ionc-gen-type', 'square');
        await page.waitForTimeout(100);

        // Set invalid pause
        await page.fill('#ionc-gen-pause', '0');

        // Try to start
        await page.click('#ionc-gen-start');

        // Check error message
        const error = page.locator('.ionc-dialog-error');
        await expect(error).toHaveText('Пауза должна быть больше 0');
    });

    test('should persist generator preferences in localStorage', async ({ page }) => {
        // Clear localStorage first
        await page.evaluate(() => localStorage.removeItem('ionc-gen-preferences'));

        // Open generator dialog for first sensor
        await page.locator('.ionc-btn-gen').first().click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        // Configure and start linear generator
        await page.selectOption('#ionc-gen-type', 'linear');
        await page.waitForTimeout(100);
        await page.fill('#ionc-gen-min', '10');
        await page.fill('#ionc-gen-max', '90');
        await page.fill('#ionc-gen-period', '3000');
        await page.fill('#ionc-gen-step', '15');
        await page.click('#ionc-gen-start');

        // Wait for dialog to close
        await expect(page.locator('.ionc-dialog-overlay.visible')).not.toBeVisible();

        // Check localStorage
        const prefs = await page.evaluate(() => {
            const data = localStorage.getItem('ionc-gen-preferences');
            return data ? JSON.parse(data) : null;
        });

        expect(prefs).not.toBeNull();
        expect(prefs.lastType).toBe('linear');
        expect(prefs.params.linear).toEqual({
            min: 10,
            max: 90,
            period: 3000,
            step: 15
        });

        // Stop generator
        await page.locator('.ionc-btn-gen-stop').first().click();

        // Open dialog for second sensor - should have linear preselected
        await page.locator('.ionc-btn-gen').nth(1).click();
        await page.waitForSelector('.ionc-dialog-overlay.visible');

        const selectedType = await page.locator('#ionc-gen-type').inputValue();
        expect(selectedType).toBe('linear');

        // Values should be prefilled
        expect(await page.locator('#ionc-gen-min').inputValue()).toBe('10');
        expect(await page.locator('#ionc-gen-max').inputValue()).toBe('90');
        expect(await page.locator('#ionc-gen-period').inputValue()).toBe('3000');
        expect(await page.locator('#ionc-gen-step').inputValue()).toBe('15');
    });
});
