/**
 * Проверка реальной работы генератора:
 * - изменение значений датчика
 * - обновление в таблице через SSE
 * - работа графика
 */
const { chromium } = require('@playwright/test');

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 200 });
    const page = await browser.newPage();

    // Перехват запросов set
    const setRequests = [];
    page.on('request', request => {
        if (request.url().includes('/ionc/set') && request.method() === 'POST') {
            const data = JSON.parse(request.postData());
            setRequests.push(data);
            console.log(`>> SET sensor_id=${data.sensor_id} value=${data.value}`);
        }
    });

    // Перехват SSE событий
    page.on('response', async response => {
        if (response.url().includes('/api/events')) {
            console.log('<< SSE connected');
        }
    });

    console.log('=== Opening viewer ===');
    await page.goto('http://localhost:8000');
    await page.waitForTimeout(2000);

    // Ждём загрузки объектов
    await page.waitForSelector('#objects-list li', { timeout: 10000 });
    console.log('Objects loaded');

    // Открываем SharedMemory
    const smObject = page.locator('#objects-list li', { hasText: 'SharedMemory' });
    if (await smObject.isVisible()) {
        await smObject.click();
        console.log('Clicked SharedMemory');
        await page.waitForTimeout(1000);
    } else {
        console.log('SharedMemory not found, trying SM');
        const sm = page.locator('#objects-list li', { hasText: 'SM' }).first();
        await sm.click();
        await page.waitForTimeout(1000);
    }

    // Ждём загрузки датчиков
    await page.waitForSelector('.ionc-sensor-row', { timeout: 10000 });
    console.log('Sensors loaded');

    // Получаем первый датчик
    const firstRow = page.locator('.ionc-sensor-row').first();
    const sensorId = await firstRow.getAttribute('data-sensor-id');
    const sensorName = await firstRow.locator('.ionc-col-name').textContent();
    console.log(`First sensor ID: ${sensorId}, name: ${sensorName}`);

    // Получаем текущее значение
    const valueCell = firstRow.locator('.ionc-value');
    const initialValue = await valueCell.textContent();
    console.log(`Initial value: ${initialValue}`);

    // === ТЕСТ 0: Включаем график ДО запуска генератора ===
    console.log('\n=== TEST 0: Enabling chart BEFORE generator ===');

    // Прокрутка к строке чтобы чекбокс был видимым
    await firstRow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    const chartCheckbox = firstRow.locator('.ionc-chart-checkbox');
    const isCheckedBefore = await chartCheckbox.isChecked();
    console.log(`Chart checkbox checked before: ${isCheckedBefore}`);

    if (!isCheckedBefore) {
        // Use evaluate to click the checkbox directly since it's hidden
        await chartCheckbox.evaluate(el => el.click());
        console.log('Chart checkbox clicked');
        await page.waitForTimeout(1000);
    }

    // Проверяем что график появился
    const chartSection = page.locator('[data-section="charts-SharedMemory"]');
    const chartVisible = await chartSection.isVisible().catch(() => false);
    console.log(`Chart section visible: ${chartVisible}`);

    if (chartVisible) {
        const chartCanvas = chartSection.locator('canvas').first();
        const canvasVisible = await chartCanvas.isVisible().catch(() => false);
        console.log(`Chart canvas visible: ${canvasVisible}`);
    }

    // === ТЕСТ 1: Запуск генератора ===
    console.log('\n=== TEST 1: Starting generator ===');

    // Прокрутка обратно к строке
    await firstRow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    // Кликаем на кнопку генератора
    const genBtn = firstRow.locator('.ionc-btn-gen');
    await genBtn.click();
    await page.waitForSelector('.ionc-dialog-overlay.visible');
    console.log('Dialog opened');

    // Настраиваем генератор
    await page.fill('#ionc-gen-min', '10');
    await page.fill('#ionc-gen-max', '90');
    await page.fill('#ionc-gen-period', '2000');
    await page.selectOption('#ionc-gen-type', 'sin');
    console.log('Generator configured: sin, min=10, max=90, period=2000ms');

    // Запускаем
    await page.click('#ionc-gen-start');
    console.log('Generator started');

    // Проверяем индикаторы
    await page.waitForTimeout(500);
    const hasGeneratingClass = await firstRow.evaluate(el => el.classList.contains('ionc-sensor-generating'));
    console.log(`Row has generating class: ${hasGeneratingClass}`);

    const hasGenFlag = await firstRow.locator('.ionc-flag-generator').isVisible();
    console.log(`Generator flag visible: ${hasGenFlag}`);

    const hasStopBtn = await firstRow.locator('.ionc-btn-gen-stop').isVisible();
    console.log(`Stop button visible: ${hasStopBtn}`);

    // === ТЕСТ 2: Проверка изменения значений в таблице ===
    console.log('\n=== TEST 2: Checking value changes in table ===');

    // Ждём 3 секунды и собираем значения
    const values = [];
    for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(500);
        const currentValue = await valueCell.textContent();
        values.push(currentValue);
        console.log(`  Value at ${i * 500}ms: ${currentValue}`);
    }

    // Проверяем что значения менялись
    const uniqueValues = [...new Set(values)];
    console.log(`Unique values in table: ${uniqueValues.length}`);
    console.log(`SET requests sent: ${setRequests.length}`);

    // === ТЕСТ 3: Проверка графика во время работы генератора ===
    console.log('\n=== TEST 3: Checking chart while generator runs ===');

    // Проверяем данные на графике (через evaluate)
    const chartDataInfo = await page.evaluate((sensorName) => {
        // Находим TabState для SharedMemory
        for (const [tabKey, tabState] of state.tabs.entries()) {
            if (tabKey.includes('SharedMemory')) {
                const varName = `io:${sensorName}`;
                const chartData = tabState.charts.get(varName);
                if (chartData) {
                    return {
                        found: true,
                        varName: varName,
                        dataPoints: chartData.data.length,
                        lastValue: chartData.data.length > 0 ? chartData.data[chartData.data.length - 1].value : null
                    };
                }
                return { found: false, varName: varName, availableCharts: [...tabState.charts.keys()] };
            }
        }
        return { found: false, error: 'No SharedMemory tab found' };
    }, sensorName.trim());

    console.log('Chart data info:', JSON.stringify(chartDataInfo, null, 2));

    // Ждём ещё несколько секунд для накопления данных
    console.log('Waiting 3 more seconds for chart data...');
    await page.waitForTimeout(3000);

    const chartDataInfoAfter = await page.evaluate((sensorName) => {
        for (const [tabKey, tabState] of state.tabs.entries()) {
            if (tabKey.includes('SharedMemory')) {
                const varName = `io:${sensorName}`;
                const chartData = tabState.charts.get(varName);
                if (chartData) {
                    return {
                        found: true,
                        dataPoints: chartData.data.length,
                        values: chartData.data.slice(-10).map(d => d.value)
                    };
                }
                return { found: false };
            }
        }
        return { found: false };
    }, sensorName.trim());

    console.log('Chart data after wait:', JSON.stringify(chartDataInfoAfter, null, 2));

    // === ТЕСТ 4: Остановка генератора ===
    console.log('\n=== TEST 4: Stopping generator ===');

    // Прокрутка к строке
    await firstRow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    await firstRow.locator('.ionc-btn-gen-stop').click();
    console.log('Stop button clicked');

    await page.waitForTimeout(500);
    const stillGenerating = await firstRow.evaluate(el => el.classList.contains('ionc-sensor-generating'));
    console.log(`Row still has generating class: ${stillGenerating}`);

    const genBtnBack = await firstRow.locator('.ionc-btn-gen').isVisible();
    console.log(`Generator button is back: ${genBtnBack}`);

    // === ИТОГИ ===
    console.log('\n=== SUMMARY ===');
    console.log(`Total SET requests: ${setRequests.length}`);
    console.log(`Values changed in table: ${uniqueValues.length > 1 ? 'YES' : 'NO'} (${uniqueValues.length} unique values)`);
    console.log(`Generator indicators work: ${hasGeneratingClass && hasGenFlag && hasStopBtn ? 'YES' : 'NO'}`);
    console.log(`Generator stopped correctly: ${!stillGenerating && genBtnBack ? 'YES' : 'NO'}`);
    console.log(`Chart has data: ${chartDataInfoAfter.found && chartDataInfoAfter.dataPoints > 0 ? 'YES' : 'NO'}`);

    if (setRequests.length > 0) {
        console.log('\nSample SET requests (first 5):');
        setRequests.slice(0, 5).forEach((req, i) => {
            console.log(`  ${i + 1}. sensor_id=${req.sensor_id}, value=${req.value}`);
        });
    }

    console.log('\nTest complete. Browser will stay open for 10 seconds...');
    await page.waitForTimeout(10000);
    await browser.close();
})();
