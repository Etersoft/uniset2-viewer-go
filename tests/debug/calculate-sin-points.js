// Вычисляем все точки синусоиды для проверки
const numPoints = 20;
const min = -50;
const max = 50;
const pause = 250;

console.log('Calculating all sin points for min=-50, max=50, numPoints=20, pause=250ms:\n');

for (let i = 0; i <= numPoints; i++) {
    const phase = (i / numPoints) * 2 * Math.PI;
    const wave = Math.sin(phase);
    const value = Math.round(min + (wave + 1) / 2 * (max - min));
    const time = i * pause;
    console.log(`Point ${i.toString().padStart(2)} [${time.toString().padStart(4)}ms]: phase=${phase.toFixed(3)}, sin=${wave.toFixed(3)}, value=${value.toString().padStart(4)}`);
}

console.log('\nUnique values with first occurrence:');
const values = [];
for (let i = 0; i <= numPoints; i++) {
    const phase = (i / numPoints) * 2 * Math.PI;
    const wave = Math.sin(phase);
    const value = Math.round(min + (wave + 1) / 2 * (max - min));
    if (i === 0 || value !== values[values.length - 1]) {
        const time = i * pause;
        console.log(`  ${time.toString().padStart(4)}ms: ${value.toString().padStart(4)}`);
    }
    values.push(value);
}
