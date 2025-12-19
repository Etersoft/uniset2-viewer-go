const { chromium } = require('@playwright/test');

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 100 });
    const page = await browser.newPage();

    console.log('=== Cos Wave Generator Test (New Implementation) ===\n');

    await page.goto('http://localhost:8000');
    await page.waitForTimeout(2000);

    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    const smObject = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    await smObject.click();
    await page.waitForTimeout(1000);

    await page.waitForSelector('.ionc-sensor-row', { timeout: 10000 });
    const firstRow = page.locator('.ionc-sensor-row').first();

    console.log('Adding sensor to chart for visual inspection...\n');
    await firstRow.locator('.chart-toggle-label').click();
    await page.waitForTimeout(500);

    console.log('Opening cos generator dialog...\n');
    await firstRow.locator('.ionc-btn-gen').click();
    await page.waitForSelector('.ionc-dialog-overlay.visible');

    await page.selectOption('#ionc-gen-type', 'cos');
    await page.waitForTimeout(500);

    // Проверяем UI
    console.log('=== UI Check ===\n');

    const periodLabel = await page.locator('#ionc-gen-period-label').textContent();
    console.log(`Period field label: "${periodLabel}"`);
    console.log(`Expected: "Шаг обновления (мс)"\n`);

    const stepLabel = await page.locator('#ionc-gen-step-label').textContent();
    console.log(`Step field label: "${stepLabel}"`);
    console.log(`Expected: "Количество точек на период"\n`);

    const calcPeriodVisible = await page.locator('#ionc-gen-calc-period').isVisible();
    console.log(`Calculated period field visible: ${calcPeriodVisible}`);
    console.log(`Expected: true\n`);

    // Настраиваем параметры
    console.log('=== Setting Parameters ===\n');
    await page.fill('#ionc-gen-min', '-50');
    await page.fill('#ionc-gen-max', '50');
    await page.fill('#ionc-gen-step', '20');  // 20 точек на период для более гладкой синусоиды
    await page.fill('#ionc-gen-period', '1000'); // 1000мс между точками (медленнее для надежности)

    // Ждём обновления расчётного периода
    await page.waitForTimeout(200);

    const calcPeriodValue = await page.locator('#ionc-gen-calc-period-value').textContent();
    console.log(`Min: -50, Max: 50`);
    console.log(`Количество точек: 20`);
    console.log(`Шаг обновления: 1000 мс`);
    console.log(`Полный период (автоматически): ${calcPeriodValue}`);
    console.log(`Expected: 20000 мс (20.0 сек)\n`);

    // Запускаем генератор
    console.log('=== Starting Generator ===\n');

    const valueCell = firstRow.locator('.ionc-value');
    const initialValue = await valueCell.textContent();

    await page.click('#ionc-gen-start');

    // Ждём первого реального изменения значения для синхронизации
    let attempts = 0;
    while (attempts < 20) {  // максимум 2 секунды
        await page.waitForTimeout(100);
        const currentValue = await valueCell.textContent();
        if (currentValue !== initialValue) {
            console.log(`First update detected at ~${attempts * 100}ms\n`);
            break;
        }
        attempts++;
    }

    // Проверяем состояние генератора в браузере
    const stateDebug = await page.evaluate(() => {
        const tabs = window.state?.tabs;
        if (!tabs) return { error: 'No window.state.tabs' };

        const result = { tabs: [] };
        for (const [tabKey, tab] of tabs.entries()) {
            const gens = [];
            if (tab.renderer?.activeGenerators) {
                for (const [id, gen] of tab.renderer.activeGenerators.entries()) {
                    gens.push({
                        id,
                        type: gen.type,
                        min: gen.min,
                        max: gen.max,
                        pause: gen.pause,
                        step: gen.step,
                        period: gen.period
                    });
                }
            }
            result.tabs.push({ tabKey, generators: gens });
        }
        return result;
    });
    console.log('State debug:', JSON.stringify(stateDebug, null, 2), '\n');

    // Мониторим значения, отслеживая каждое изменение
    const values = [];
    const timestamps = [];
    const startTime = Date.now();
    let lastValue = await valueCell.textContent();

    console.log('Monitoring values for one full period (20 seconds)...\n');
    console.log('Capturing each value change with timestamp...\n');

    // Захватываем изменения в течение одного полного периода + небольшой запас
    const monitoringDuration = 21000;  // 21 секунда
    const checkInterval = 100;  // проверяем каждые 100мс
    let elapsed = 0;

    while (elapsed < monitoringDuration) {
        await page.waitForTimeout(checkInterval);
        elapsed += checkInterval;

        const currentValue = await valueCell.textContent();
        if (currentValue !== lastValue) {
            const timestamp = Date.now() - startTime;
            values.push(parseInt(currentValue));
            timestamps.push(timestamp);
            console.log(`[${timestamp.toString().padStart(5)}ms] Value changed to: ${currentValue.padStart(4)}`);
            lastValue = currentValue;
        }
    }

    await firstRow.locator('.ionc-btn-gen-stop').click();

    // Анализ
    console.log('\n=== Analysis ===\n');

    console.log(`Captured ${values.length} value changes over ${timestamps[timestamps.length - 1]}ms\n`);

    // Проверяем интервалы между изменениями
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    if (intervals.length > 0) {
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        console.log(`Average interval between changes: ${avgInterval.toFixed(0)}ms (expected: 1000ms)`);
        console.log(`Min interval: ${Math.min(...intervals)}ms`);
        console.log(`Max interval: ${Math.max(...intervals)}ms\n`);
    }

    // Проверяем, соответствуют ли значения ожидаемой синусоиде
    console.log('Comparing values to expected cose wave:\n');

    // Генерируем ожидаемую последовательность уникальных значений
    const expectedSequence = [];
    let lastVal = null;
    for (let i = 0; i <= 20; i++) {
        const phase = (i / 20) * 2 * Math.PI;
        const expectedWave = Math.cos(phase);
        const val = Math.round(-50 + (expectedWave + 1) / 2 * 100);
        if (val !== lastVal) {
            expectedSequence.push(val);
            lastVal = val;
        }
    }

    console.log(`Expected ${expectedSequence.length} unique values: ${expectedSequence.join(', ')}\n`);

    const errors = [];
    for (let i = 0; i < Math.min(values.length, expectedSequence.length); i++) {
        const diff = Math.abs(values[i] - expectedSequence[i]);
        const status = diff <= 2 ? '✓' : '✗';
        console.log(`  ${status} Change ${i}: got ${values[i].toString().padStart(4)}, expected ${expectedSequence[i].toString().padStart(4)}, diff ${diff}`);
        if (diff > 2) {
            errors.push(`Change ${i}: got ${values[i]}, expected ${expectedSequence[i]}, diff ${diff}`);
        }
    }

    console.log('\n');
    if (errors.length === 0) {
        console.log('✓ All values match expected cose wave pattern!');
        console.log('✓ Cos generator produces smooth cose wave from min to max');
    } else {
        console.log('✗ Some values don\'t match expected pattern');
    }

    console.log('\n\nClocosg in 3 seconds...');
    await page.waitForTimeout(3000);
    await browser.close();
})();
