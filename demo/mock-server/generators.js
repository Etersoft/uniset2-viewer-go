/**
 * Diesel Generator Simulation with Scenario Manager
 *
 * Simulates realistic behavior of two diesel generators with:
 * - State machine: STOPPED -> STARTING -> RUNNING -> STOPPING -> STOPPED
 * - Interdependent parameters (RPM affects Power, Load affects Temperature)
 * - Automatic cyclic demo scenario
 */

const sensors = require('./sensors');

// Generator states
const STATE = {
    STOPPED: 'STOPPED',
    STARTING: 'STARTING',
    RUNNING: 'RUNNING',
    STOPPING: 'STOPPING',
    ALARM: 'ALARM'
};

// Configuration constants
const CONFIG = {
    NOMINAL_RPM: 1500,
    MAX_RPM: 2000,
    NOMINAL_VOLTAGE: 380,
    NOMINAL_FREQUENCY: 50,
    MAX_POWER: 400,  // Nominal power at 100% load
    AMBIENT_TEMP: 25,
    IDLE_TEMP: 75,
    MAX_TEMP: 110,
    NOMINAL_OIL_PRESSURE: 4,
    START_DURATION: 5000,
    STOP_DURATION: 3000,
    FUEL_CONSUMPTION_RATE: 0.00005,
};

/**
 * Diesel Generator class
 */
class DieselGenerator {
    constructor(id) {
        this.id = id;
        this.state = STATE.STOPPED;

        this.running = 0;
        this.ready = 1;
        this.alarm = 0;
        this.remote = 1;

        this.rpm = 0;
        this.coolantTemp = CONFIG.AMBIENT_TEMP;
        this.oilPressure = 0;
        this.voltage = 0;
        this.frequency = 0;
        this.fuelLevel = id === 'DG1' ? 90 : 85;
        this.power = 0;
        this.load = 0;
        this.i1 = 0;
        this.i2 = 0;
        this.i3 = 0;
        this.airPressure = 100; // Compressed air tank %

        this.targetLoad = 0;
        this.stateStartTime = null;
    }

    start() {
        if (this.state === STATE.STOPPED && this.fuelLevel > 5 && this.airPressure > 20) {
            this.state = STATE.STARTING;
            this.stateStartTime = Date.now();
            this.ready = 0;
            // Consume compressed air for starting (15-20%)
            this.airPressure = Math.max(0, this.airPressure - 15 - Math.random() * 5);
            console.log(`[${this.id}] Starting... (Air: ${this.airPressure.toFixed(0)}%)`);
        }
    }

    stop() {
        if (this.state === STATE.RUNNING) {
            this.state = STATE.STOPPING;
            this.stateStartTime = Date.now();
            this.targetLoad = 0;
            console.log(`[${this.id}] Stopping...`);
        }
    }

    setLoad(percent) {
        this.targetLoad = Math.max(0, Math.min(100, percent));
    }

    triggerAlarm(type) {
        if (this.state !== STATE.ALARM) {
            this.state = STATE.ALARM;
            this.alarm = 1;
            this.running = 0;
            this.ready = 0;
            console.log(`[${this.id}] ALARM: ${type}`);
        }
    }

    clearAlarm() {
        if (this.state === STATE.ALARM) {
            this.state = STATE.STOPPED;
            this.alarm = 0;
            this.ready = 1;
            this.rpm = 0;
            this.power = 0;
            this.load = 0;
            this.voltage = 0;
            this.frequency = 0;
            this.oilPressure = 0;
            console.log(`[${this.id}] Alarm cleared`);
        }
    }

    // Refuel the generator
    refuel(amount = 50) {
        this.fuelLevel = Math.min(100, this.fuelLevel + amount);
    }

    tick(deltaMs) {
        const now = Date.now();

        switch (this.state) {
            case STATE.STOPPED:
                this._tickStopped(deltaMs);
                break;
            case STATE.STARTING:
                this._tickStarting(deltaMs, now);
                break;
            case STATE.RUNNING:
                this._tickRunning(deltaMs, now);
                break;
            case STATE.STOPPING:
                this._tickStopping(deltaMs, now);
                break;
            case STATE.ALARM:
                this._tickAlarm(deltaMs);
                break;
        }

        this._updateTemperature(deltaMs);
        this._syncToSensors();
    }

    _tickStopped(deltaMs) {
        this.rpm = 0;
        this.power = 0;
        this.load = 0;
        this.voltage = 0;
        this.frequency = 0;
        this.oilPressure = 0;
        this.i1 = 0;
        this.i2 = 0;
        this.i3 = 0;
        this.running = 0;
        this.ready = this.fuelLevel > 5 ? 1 : 0;
    }

    _tickStarting(deltaMs, now) {
        const elapsed = now - this.stateStartTime;
        const progress = Math.min(1, elapsed / CONFIG.START_DURATION);
        const easedProgress = this._easeInOut(progress);

        this.rpm = easedProgress * CONFIG.NOMINAL_RPM;
        this.oilPressure = (this.rpm / CONFIG.NOMINAL_RPM) * CONFIG.NOMINAL_OIL_PRESSURE;

        if (this.rpm > 1000) {
            const elecProgress = (this.rpm - 1000) / (CONFIG.NOMINAL_RPM - 1000);
            this.voltage = elecProgress * CONFIG.NOMINAL_VOLTAGE;
            this.frequency = elecProgress * CONFIG.NOMINAL_FREQUENCY;
        }

        if (progress >= 1) {
            this.state = STATE.RUNNING;
            this.running = 1;
            this.ready = 0;
            console.log(`[${this.id}] Running`);
        }
    }

    _tickRunning(deltaMs, now) {
        const rpmNoise = (Math.random() - 0.5) * 20;
        this.rpm = CONFIG.NOMINAL_RPM + rpmNoise;

        // Smooth load changes toward target
        const loadDiff = this.targetLoad - this.load;
        this.load += loadDiff * 0.02;

        this.power = (this.load / 100) * CONFIG.MAX_POWER;

        this.voltage = CONFIG.NOMINAL_VOLTAGE + (Math.random() - 0.5) * 4;
        this.frequency = CONFIG.NOMINAL_FREQUENCY + (Math.random() - 0.5) * 0.4;
        this.oilPressure = CONFIG.NOMINAL_OIL_PRESSURE + (Math.random() - 0.5) * 0.5;

        // Phase currents: I = P / (sqrt(3) * U * cos_phi)
        // For 380V, cos_phi ~0.85, power in kW -> current in A
        const baseCurrent = (this.power * 1000) / (Math.sqrt(3) * this.voltage * 0.85);
        // Add slight imbalance between phases (±5%)
        this.i1 = baseCurrent * (1 + (Math.random() - 0.5) * 0.1);
        this.i2 = baseCurrent * (1 + (Math.random() - 0.5) * 0.1);
        this.i3 = baseCurrent * (1 + (Math.random() - 0.5) * 0.1);

        // Fuel consumption
        const consumptionRate = (this.power / CONFIG.MAX_POWER) * CONFIG.FUEL_CONSUMPTION_RATE;
        this.fuelLevel = Math.max(0, this.fuelLevel - consumptionRate * deltaMs);

        // Compressor fills air tank when running (slow recovery)
        if (this.airPressure < 100) {
            this.airPressure = Math.min(100, this.airPressure + 0.005 * deltaMs);
        }

        this.running = 1;
    }

    _tickStopping(deltaMs, now) {
        const elapsed = now - this.stateStartTime;
        const progress = Math.min(1, elapsed / CONFIG.STOP_DURATION);
        const easedProgress = 1 - this._easeInOut(progress);

        this.rpm = easedProgress * CONFIG.NOMINAL_RPM;
        this.power = 0;
        this.load = Math.max(0, this.load - deltaMs * 0.05);
        this.voltage = easedProgress * CONFIG.NOMINAL_VOLTAGE;
        this.frequency = easedProgress * CONFIG.NOMINAL_FREQUENCY;
        this.oilPressure = easedProgress * CONFIG.NOMINAL_OIL_PRESSURE;

        if (progress >= 1) {
            this.state = STATE.STOPPED;
            this.running = 0;
            this.ready = 1;
            this.rpm = 0;
            this.power = 0;
            this.load = 0;
            this.voltage = 0;
            this.frequency = 0;
            this.oilPressure = 0;
            this.i1 = 0;
            this.i2 = 0;
            this.i3 = 0;
            console.log(`[${this.id}] Stopped`);
        }
    }

    _tickAlarm(deltaMs) {
        this.rpm = Math.max(0, this.rpm - deltaMs * 0.5);
        this.power = 0;
        this.load = 0;
        this.voltage = Math.max(0, this.voltage - deltaMs * 0.2);
        this.frequency = Math.max(0, this.frequency - deltaMs * 0.02);
        this.oilPressure = Math.max(0, this.oilPressure - deltaMs * 0.002);
        this.i1 = 0;
        this.i2 = 0;
        this.i3 = 0;
    }

    _updateTemperature(deltaMs) {
        let targetTemp;
        if (this.state === STATE.RUNNING) {
            targetTemp = CONFIG.IDLE_TEMP + (this.load / 100) * (CONFIG.MAX_TEMP - CONFIG.IDLE_TEMP);
        } else if (this.state === STATE.STARTING) {
            targetTemp = CONFIG.AMBIENT_TEMP + 10;
        } else {
            targetTemp = CONFIG.AMBIENT_TEMP;
        }

        const tempRate = 0.00005;
        const tempDiff = targetTemp - this.coolantTemp;
        this.coolantTemp += tempDiff * tempRate * deltaMs;
    }

    _syncToSensors() {
        sensors.setSensor(`${this.id}_Running`, this.running);
        sensors.setSensor(`${this.id}_Ready`, this.ready);
        sensors.setSensor(`${this.id}_Alarm`, this.alarm);
        sensors.setSensor(`${this.id}_Remote`, this.remote);
        sensors.setSensor(`${this.id}_RPM`, Math.round(this.rpm));
        sensors.setSensor(`${this.id}_CoolantTemp`, Math.round(this.coolantTemp));
        sensors.setSensor(`${this.id}_OilPressure`, Math.round(this.oilPressure));
        sensors.setSensor(`${this.id}_Voltage`, Math.round(this.voltage));
        sensors.setSensor(`${this.id}_Frequency`, Math.round(this.frequency));
        sensors.setSensor(`${this.id}_FuelLevel`, Math.round(this.fuelLevel));
        sensors.setSensor(`${this.id}_Power`, Math.round(this.power));
        sensors.setSensor(`${this.id}_Load`, Math.round(this.load));
        sensors.setSensor(`${this.id}_I1`, Math.round(this.i1));
        sensors.setSensor(`${this.id}_I2`, Math.round(this.i2));
        sensors.setSensor(`${this.id}_I3`, Math.round(this.i3));
        sensors.setSensor(`${this.id}_AirPressure`, Math.round(this.airPressure));
    }

    _easeInOut(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    getStateInfo() {
        return {
            id: this.id,
            state: this.state,
            rpm: Math.round(this.rpm),
            temp: +this.coolantTemp.toFixed(1),
            load: Math.round(this.load),
            power: Math.round(this.power),
            fuel: +this.fuelLevel.toFixed(1)
        };
    }
}

// ============================================================================
// SCENARIO MANAGER
// ============================================================================

/**
 * Demo scenario phases
 * Each phase has: name, duration (ms), tick function
 */
const SCENARIO_PHASES = [
    // PHASE 1: Waiting - DG1 Ready (15 sec)
    {
        name: 'WAITING',
        duration: 15000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: WAITING - DG1 ready to start');
        },
        tick: (dg1, dg2, elapsed, progress) => {
            // DG1 ready, DG2 stopped
        }
    },

    // PHASE 2: Starting DG1 (5 sec)
    {
        name: 'DG1_STARTING',
        duration: 5000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: DG1_STARTING');
            dg1.start();
        },
        tick: (dg1, dg2, elapsed, progress) => {
            // Generator handles startup internally
        }
    },

    // PHASE 3: Load growth on DG1 (60 sec) - 30% to 85%
    {
        name: 'DG1_LOAD_GROWTH',
        duration: 60000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: DG1_LOAD_GROWTH (30% -> 85%)');
            dg1.setLoad(30);
        },
        tick: (dg1, dg2, elapsed, progress) => {
            // Gradually increase load from 30% to 85%
            const targetLoad = 30 + progress * 55;
            dg1.setLoad(targetLoad);
        }
    },

    // PHASE 4: Start backup DG2 (5 sec)
    {
        name: 'DG2_STARTING',
        duration: 5000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: DG2_STARTING - Load at 85%, starting backup');
            dg2.start();
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg1.setLoad(85);
        }
    },

    // PHASE 5: Load distribution (30 sec) - DG1: 85->45, DG2: 0->40
    {
        name: 'LOAD_DISTRIBUTION',
        duration: 30000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: LOAD_DISTRIBUTION');
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg1.setLoad(85 - progress * 40); // 85 -> 45
            dg2.setLoad(progress * 40);       // 0 -> 40
        }
    },

    // PHASE 6: Load decrease (30 sec) - both decrease
    {
        name: 'LOAD_DECREASE',
        duration: 30000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: LOAD_DECREASE');
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg1.setLoad(45 - progress * 30); // 45 -> 15
            dg2.setLoad(40 - progress * 25); // 40 -> 15
        }
    },

    // PHASE 7: Stop DG2 (5 sec)
    {
        name: 'DG2_STOPPING',
        duration: 5000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: DG2_STOPPING - Low load, stopping backup');
            dg2.stop();
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg1.setLoad(15 + progress * 15); // 15 -> 30
        }
    },

    // PHASE 8: DG1 alone, moderate load (30 sec)
    {
        name: 'DG1_ALONE_MODERATE',
        duration: 30000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: DG1_ALONE_MODERATE (30% -> 50%)');
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg1.setLoad(30 + progress * 20); // 30 -> 50
        }
    },

    // PHASE 9: Load growth again (30 sec) - 50% to 85%
    {
        name: 'DG1_LOAD_GROWTH_2',
        duration: 30000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: DG1_LOAD_GROWTH_2 (50% -> 85%)');
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg1.setLoad(50 + progress * 35); // 50 -> 85
        }
    },

    // PHASE 10: Start DG2 again (5 sec)
    {
        name: 'DG2_STARTING_2',
        duration: 5000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: DG2_STARTING_2');
            dg2.start();
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg1.setLoad(85);
        }
    },

    // PHASE 11: Load distribution again (30 sec)
    {
        name: 'LOAD_DISTRIBUTION_2',
        duration: 30000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: LOAD_DISTRIBUTION_2');
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg1.setLoad(85 - progress * 40);
            dg2.setLoad(progress * 40);
        }
    },

    // PHASE 12: Load decrease again (60 sec)
    {
        name: 'LOAD_DECREASE_2',
        duration: 60000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: LOAD_DECREASE_2');
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg1.setLoad(45 - progress * 30);
            dg2.setLoad(40 - progress * 25);
        }
    },

    // PHASE 13: Stop DG2 again (5 sec)
    {
        name: 'DG2_STOPPING_2',
        duration: 5000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: DG2_STOPPING_2');
            dg2.stop();
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg1.setLoad(15 + progress * 15);
        }
    },

    // PHASE 14: Switchover - Stop DG1, start DG2 as primary (10 sec)
    {
        name: 'SWITCHOVER',
        duration: 10000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: SWITCHOVER - DG1 maintenance, DG2 takes over');
            dg1.stop();
            dg2.start();
            // Refuel both generators
            dg1.refuel(30);
            dg2.refuel(30);
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg2.setLoad(progress * 30); // Gradually take load
        }
    },

    // PHASE 15: DG2 as primary, load growth (60 sec)
    {
        name: 'DG2_PRIMARY_GROWTH',
        duration: 60000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: DG2_PRIMARY_GROWTH');
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg2.setLoad(30 + progress * 40); // 30 -> 70
        }
    },

    // PHASE 16: Return to DG1 (10 sec)
    {
        name: 'RETURN_TO_DG1',
        duration: 10000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: RETURN_TO_DG1');
            dg1.start();
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg2.setLoad(70 - progress * 40); // 70 -> 30
            if (dg1.state === STATE.RUNNING) {
                dg1.setLoad(progress * 30);
            }
        }
    },

    // PHASE 17: Stop DG2, DG1 takes over (10 sec)
    {
        name: 'DG1_TAKEOVER',
        duration: 10000,
        onEnter: (dg1, dg2) => {
            console.log('[SCENARIO] Phase: DG1_TAKEOVER');
            dg2.stop();
        },
        tick: (dg1, dg2, elapsed, progress) => {
            dg1.setLoad(30 + progress * 20); // 30 -> 50
        }
    },
];

/**
 * Scenario Manager - controls the demo cycle
 */
class ScenarioManager {
    constructor(dg1, dg2) {
        this.dg1 = dg1;
        this.dg2 = dg2;
        this.phases = SCENARIO_PHASES;
        this.currentPhaseIndex = 0;
        this.phaseStartTime = Date.now();
        this.isPaused = false;
        this.cycleCount = 0;
    }

    getCurrentPhase() {
        return this.phases[this.currentPhaseIndex];
    }

    tick(deltaMs) {
        if (this.isPaused) return;

        const phase = this.getCurrentPhase();
        const now = Date.now();
        const elapsed = now - this.phaseStartTime;
        const progress = Math.min(1, elapsed / phase.duration);

        // Execute phase tick
        if (phase.tick) {
            phase.tick(this.dg1, this.dg2, elapsed, progress);
        }

        // Check if phase is complete
        if (elapsed >= phase.duration) {
            this._nextPhase();
        }
    }

    _nextPhase() {
        this.currentPhaseIndex++;

        // Loop back to beginning
        if (this.currentPhaseIndex >= this.phases.length) {
            this.currentPhaseIndex = 0;
            this.cycleCount++;
            console.log(`[SCENARIO] === Cycle ${this.cycleCount} complete, restarting ===`);
        }

        this.phaseStartTime = Date.now();
        const phase = this.getCurrentPhase();

        // Execute phase enter callback
        if (phase.onEnter) {
            phase.onEnter(this.dg1, this.dg2);
        }
    }

    pause() {
        this.isPaused = true;
        console.log('[SCENARIO] Paused');
    }

    resume() {
        this.isPaused = false;
        this.phaseStartTime = Date.now(); // Reset phase timer
        console.log('[SCENARIO] Resumed');
    }

    skipToNext() {
        this._nextPhase();
    }

    restart() {
        this.currentPhaseIndex = 0;
        this.phaseStartTime = Date.now();
        this.cycleCount = 0;

        // Reset generators
        this.dg1.clearAlarm();
        this.dg2.clearAlarm();
        if (this.dg1.state === STATE.RUNNING) this.dg1.stop();
        if (this.dg2.state === STATE.RUNNING) this.dg2.stop();

        console.log('[SCENARIO] Restarted');

        // Trigger first phase
        const phase = this.getCurrentPhase();
        if (phase.onEnter) {
            phase.onEnter(this.dg1, this.dg2);
        }
    }

    getStatus() {
        const phase = this.getCurrentPhase();
        const elapsed = Date.now() - this.phaseStartTime;
        return {
            phase: phase.name,
            phaseIndex: this.currentPhaseIndex,
            totalPhases: this.phases.length,
            elapsed: elapsed,
            duration: phase.duration,
            progress: Math.min(1, elapsed / phase.duration),
            isPaused: this.isPaused,
            cycleCount: this.cycleCount
        };
    }
}

// ============================================================================
// MAIN
// ============================================================================

// Create generator instances
const dg1 = new DieselGenerator('DG1');
const dg2 = new DieselGenerator('DG2');

// Create scenario manager
const scenario = new ScenarioManager(dg1, dg2);

// Simulation loop
let lastTick = Date.now();
const TICK_INTERVAL = 100;

function simulationLoop() {
    const now = Date.now();
    const deltaMs = now - lastTick;
    lastTick = now;

    // Tick generators
    dg1.tick(deltaMs);
    dg2.tick(deltaMs);

    // Tick scenario
    scenario.tick(deltaMs);
}

const simulationTimer = setInterval(simulationLoop, TICK_INTERVAL);

// Start scenario after 1 second
setTimeout(() => {
    console.log('[SCENARIO] Starting demo scenario...');
    const phase = scenario.getCurrentPhase();
    if (phase.onEnter) {
        phase.onEnter(dg1, dg2);
    }
}, 1000);

// Export
module.exports = {
    dg1,
    dg2,
    scenario,
    DieselGenerator,
    ScenarioManager,
    STATE,
    stopSimulation: () => clearInterval(simulationTimer)
};
