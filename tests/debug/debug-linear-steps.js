const { chromium } = require('@playwright/test');

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 100 });
    const page = await browser.newPage();

    console.log('=== Linear Generator Step-by-Step Test ===\n');

    await page.goto('http://localhost:8000');
    await page.waitForTimeout(2000);

    // Открываем SharedMemory
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    const smObject = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    await smObject.click();
    await page.waitForTimeout(1000);

    await page.waitForSelector('.ionc-sensor-row', { timeout: 10000 });

    const firstRow = page.locator('.ionc-sensor-row').first();
    const sensorName = await firstRow.locator('.ionc-col-name').textContent();
    console.log(`Monitoring sensor: ${sensorName}\n`);

    // Открываем диалог генератора
    await firstRow.locator('.ionc-btn-gen').click();
    await page.waitForSelector('.ionc-dialog-overlay.visible');

    // Настраиваем linear генератор
    await page.selectOption('#ionc-gen-type', 'linear');
    await page.waitForTimeout(500);

    // Проверяем что видим правильное поле
    const periodLabelEl = page.locator('#ionc-gen-period-label');
    const exists = await periodLabelEl.count() > 0;

    if (exists) {
        const periodLabel = await periodLabelEl.textContent();
        console.log(`Field label: "${periodLabel}"`);
        console.log(`Expected: "Пауза между шагами (мс)"\n`);
    } else {
        console.log('WARNING: #ionc-gen-period-label not found, checking alternative...');
        const labelText = await page.locator('label[for="ionc-gen-period"]').textContent();
        console.log(`Label text: "${labelText}"\n`);
    }

    // Устанавливаем параметры для легкого отслеживания
    await page.fill('#ionc-gen-min', '0');
    await page.fill('#ionc-gen-max', '100');
    await page.fill('#ionc-gen-step', '10');
    await page.fill('#ionc-gen-period', '500');  // Пауза 500мс между шагами

    console.log('Generator config: linear, min=0, max=100, step=10, pause=500ms\n');
    console.log('Expected sequence:');
    console.log('  Up:   0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 (11 values)');
    console.log('  Down: 90, 80, 70, 60, 50, 40, 30, 20, 10, 0 (10 values)');
    console.log('  Total: 21 steps × 500ms = 10500ms per cycle\n');

    // Запускаем генератор
    await page.click('#ionc-gen-start');
    await page.waitForTimeout(300);

    console.log('Starting monitoring...\n');

    // Отслеживаем изменения значений
    const values = [];
    const valueCell = firstRow.locator('.ionc-value');
    let previousValue = null;
    const startTime = Date.now();
    const monitorDuration = 12000; // 12 секунд - чуть больше одного цикла

    while (Date.now() - startTime < monitorDuration) {
        const currentValue = await valueCell.textContent();
        const timestamp = Date.now() - startTime;

        if (currentValue !== previousValue) {
            values.push({
                timestamp,
                value: parseInt(currentValue),
                delta: values.length > 0 ? timestamp - values[values.length - 1].timestamp : 0
            });

            const stepNum = values.length;
            const delta = values.length > 1 ? values[values.length - 1].delta : 0;
            console.log(`[Step ${stepNum.toString().padStart(2)}] [${timestamp.toString().padStart(5)}ms] Value: ${currentValue.padStart(3)} (Δt: ${delta}ms)`);

            previousValue = currentValue;
        }

        await page.waitForTimeout(50);
    }

    // Останавливаем генератор
    await firstRow.locator('.ionc-btn-gen-stop').click();

    // Анализ
    console.log('\n=== ANALYSIS ===\n');
    console.log(`Total value changes: ${values.length}`);
    console.log(`Expected: 21 per cycle`);

    // Найдём где происходит переход от "вверх" к "вниз"
    let peakIndex = -1;
    for (let i = 1; i < values.length; i++) {
        if (values[i].value < values[i - 1].value) {
            peakIndex = i - 1;
            break;
        }
    }

    if (peakIndex > 0) {
        const upValues = values.slice(0, peakIndex + 1).map(v => v.value);
        const downValues = values.slice(peakIndex + 1).filter((v, i, arr) =>
            i === 0 || v.value !== arr[i - 1].value
        ).map(v => v.value);

        console.log(`\nUp phase (${upValues.length} values):`);
        console.log(`  ${upValues.join(', ')}`);
        console.log(`  Expected: 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 (11 values)`);

        // Берём только первые значения нисходящей фазы до возврата к началу
        let firstCycleDown = [];
        for (const v of downValues) {
            if (firstCycleDown.length > 0 && v.value > firstCycleDown[firstCycleDown.length - 1]) {
                break;
            }
            firstCycleDown.push(v);
        }

        console.log(`\nDown phase (${firstCycleDown.length} values):`);
        console.log(`  ${firstCycleDown.join(', ')}`);
        console.log(`  Expected: 90, 80, 70, 60, 50, 40, 30, 20, 10, 0 (10 values)`);
    }

    // Проверка интервалов
    if (values.length > 1) {
        const deltas = values.slice(1).map(v => v.delta);
        const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const minDelta = Math.min(...deltas);
        const maxDelta = Math.max(...deltas);

        console.log('\nStep intervals:');
        console.log(`  Average: ${avgDelta.toFixed(0)}ms`);
        console.log(`  Min: ${minDelta}ms`);
        console.log(`  Max: ${maxDelta}ms`);
        console.log(`  Expected: ~500ms`);

        const withinTolerance = Math.abs(avgDelta - 500) < 100;
        console.log(`  Within tolerance: ${withinTolerance ? 'YES ✓' : 'NO ✗'}`);
    }

    console.log('\n\nTest complete. Browser will close in 5 seconds...');
    await page.waitForTimeout(5000);
    await browser.close();
})();
