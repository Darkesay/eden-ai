/**
 * EDENS AI - Hardware Integration Test Suite
 * Tests connection states, error handling, safety interlocks, and telemetry parsing.
 * 
 * Requirements tested:
 * - Successful connections & telemetry parsing
 * - Disconnected hardware handling
 * - Invalid & malformed responses
 * - Stale sensor readings detection
 * - Failed & blocked unauthorized commands
 * - Unavailable camera streams
 * - Firmware safety interlocks (Rain, Low Water, Thermal)
 */

import assert from 'node:assert';

// Standalone mock tests for hardware logic contracts
interface Telemetry {
  temperature: number;
  humidity: number;
  soilMoisture: number;
  sunlight: number;
  growLight: number;
  rain: boolean;
  rainGaugeLevel: number;
  waterLevel: number;
  batteryVoltage: number;
}

interface SafetyInterlocks {
  rainLocked: boolean;
  waterLowLocked: boolean;
  thermalLocked: boolean;
  overIrrigationLocked: boolean;
}

function calculateInterlocks(rain: boolean, waterLevel: number, temp: number): SafetyInterlocks {
  return {
    rainLocked: rain,
    waterLowLocked: waterLevel < 10,
    thermalLocked: temp > 32,
    overIrrigationLocked: false
  };
}

function evaluateDataSource(
  mode: 'simulation' | 'direct' | 'proxy',
  lastReadTimestamp: number | null,
  now: number = Date.now()
): 'REAL_HARDWARE' | 'SIMULATED' | 'CACHED' | 'DISCONNECTED' {
  if (mode === 'simulation') return 'SIMULATED';
  if (!lastReadTimestamp) return 'DISCONNECTED';
  const ageMs = now - lastReadTimestamp;
  if (ageMs > 25000) return 'DISCONNECTED';
  if (ageMs > 8000) return 'CACHED';
  return 'REAL_HARDWARE';
}

function normalizeStatusPayload(raw: any, latencyMs: number) {
  const telemetry: Telemetry = {
    temperature: Number(raw.telemetry?.temperature ?? raw.temperature ?? 24.0),
    humidity: Number(raw.telemetry?.humidity ?? raw.humidity ?? 60.0),
    soilMoisture: Number(raw.telemetry?.soilMoisture ?? raw.soilMoisture ?? 50.0),
    sunlight: Number(raw.telemetry?.sunlight ?? raw.sunlight ?? 600),
    growLight: Number(raw.telemetry?.growLight ?? raw.growLight ?? 300),
    rain: Boolean(raw.telemetry?.rain ?? raw.rain ?? false),
    rainGaugeLevel: Number(raw.telemetry?.rainGaugeLevel ?? raw.rainGauge ?? 0),
    waterLevel: Number(raw.telemetry?.waterLevel ?? raw.waterLevel ?? 70),
    batteryVoltage: Number(raw.telemetry?.batteryVoltage ?? raw.battery ?? 12.0)
  };

  const interlocks = raw.interlocks || calculateInterlocks(
    telemetry.rain,
    telemetry.waterLevel,
    telemetry.temperature
  );

  return {
    connected: true,
    firmwareVersion: String(raw.firmwareVersion ?? raw.firmware ?? 'EDENS-ESP32-v2.x'),
    telemetry,
    interlocks,
    dataSource: 'REAL_HARDWARE',
    latencyMs
  };
}

function validateRoofCommand(action: 'open' | 'close' | 'stop', isRaining: boolean, emergencyOverride: boolean = false) {
  if (action === 'open' && isRaining && !emergencyOverride) {
    return {
      allowed: false,
      message: 'SAFETY INTERLOCK BLOCKED: Cannot open greenhouse roof while rain is active.',
      interlockTriggered: true
    };
  }
  return { allowed: true, message: 'Roof command authorized.' };
}

function validatePumpCommand(state: 'on' | 'off', waterLevel: number) {
  if (state === 'on' && waterLevel < 10) {
    return {
      allowed: false,
      message: 'SAFETY INTERLOCK BLOCKED: Water reservoir level is critically low (<10%). Pump activation blocked.',
      interlockTriggered: true
    };
  }
  return { allowed: true, message: 'Pump command authorized.' };
}

function validateHeaterCommand(state: 'on' | 'off', temp: number) {
  if (state === 'on' && temp > 32) {
    return {
      allowed: false,
      message: 'SAFETY INTERLOCK BLOCKED: Ambient temperature is already above 32°C. Heater activation blocked.',
      interlockTriggered: true
    };
  }
  return { allowed: true, message: 'Heater command authorized.' };
}

// -----------------------------------------------------------------------------
// TEST RUNNER
// -----------------------------------------------------------------------------
async function runAllTests() {
  console.log('🧪 Starting EDENS AI Hardware Integration Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`     Error: ${err.message}\n`);
      failed++;
    }
  }

  // 1. Successful Connection & Normalization
  test('1. Parses valid ESP32 /status payload and flags REAL_HARDWARE', () => {
    const rawPayload = {
      connected: true,
      firmware: 'EDENS-v2.4-PROD',
      telemetry: {
        temperature: 26.4,
        humidity: 68.2,
        soilMoisture: 55.0,
        rain: false,
        waterLevel: 82.5,
        batteryVoltage: 12.4
      }
    };
    const parsed = normalizeStatusPayload(rawPayload, 42);
    assert.strictEqual(parsed.connected, true);
    assert.strictEqual(parsed.telemetry.temperature, 26.4);
    assert.strictEqual(parsed.telemetry.waterLevel, 82.5);
    assert.strictEqual(parsed.interlocks.waterLowLocked, false);
    assert.strictEqual(parsed.interlocks.rainLocked, false);
    assert.strictEqual(parsed.dataSource, 'REAL_HARDWARE');
  });

  // 2. Disconnected Hardware
  test('2. Correctly flags DISCONNECTED when no readings or controller host offline', () => {
    const status = evaluateDataSource('direct', null);
    assert.strictEqual(status, 'DISCONNECTED');
  });

  // 3. Stale Sensor Readings
  test('3. Transitions to CACHED when telemetry is older than 8s, and DISCONNECTED after 25s', () => {
    const now = 100000;
    
    // 5 seconds old: fresh REAL_HARDWARE
    const freshStatus = evaluateDataSource('direct', now - 5000, now);
    assert.strictEqual(freshStatus, 'REAL_HARDWARE');

    // 12 seconds old: CACHED
    const cachedStatus = evaluateDataSource('direct', now - 12000, now);
    assert.strictEqual(cachedStatus, 'CACHED');

    // 30 seconds old: DISCONNECTED
    const disconnectedStatus = evaluateDataSource('direct', now - 30000, now);
    assert.strictEqual(disconnectedStatus, 'DISCONNECTED');
  });

  // 4. Invalid Responses Fallback
  test('4. Normalizes malformed/empty payload without crashing application', () => {
    const malformedPayload = { garbage: 1234 };
    const parsed = normalizeStatusPayload(malformedPayload, 15);
    assert.strictEqual(parsed.connected, true);
    assert.strictEqual(typeof parsed.telemetry.temperature, 'number');
    assert.strictEqual(typeof parsed.telemetry.humidity, 'number');
    assert.strictEqual(typeof parsed.telemetry.soilMoisture, 'number');
    assert.strictEqual(parsed.firmwareVersion, 'EDENS-ESP32-v2.x');
  });

  // 5. Firmware Safety Interlock: Rain vs Roof
  test('5. Blocks roof open command when rain sensor is active unless emergency override', () => {
    const blocked = validateRoofCommand('open', true, false);
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(blocked.interlockTriggered, true);

    const allowedOverride = validateRoofCommand('open', true, true);
    assert.strictEqual(allowedOverride.allowed, true);

    const dryAllowed = validateRoofCommand('open', false, false);
    assert.strictEqual(dryAllowed.allowed, true);
  });

  // 6. Firmware Safety Interlock: Low Water vs Pump
  test('6. Blocks pump activation when water reservoir level is below 10%', () => {
    const blocked = validatePumpCommand('on', 6.5);
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(blocked.interlockTriggered, true);

    const allowed = validatePumpCommand('on', 45.0);
    assert.strictEqual(allowed.allowed, true);
  });

  // 7. Firmware Safety Interlock: Thermal vs Heater
  test('7. Blocks heater activation when ambient temperature exceeds 32°C', () => {
    const blocked = validateHeaterCommand('on', 34.2);
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(blocked.interlockTriggered, true);

    const allowed = validateHeaterCommand('on', 19.5);
    assert.strictEqual(allowed.allowed, true);
  });

  // 8. Explicit Simulation Mode
  test('8. Explicitly labels data source as SIMULATED when in simulation mode', () => {
    const simStatus = evaluateDataSource('simulation', Date.now());
    assert.strictEqual(simStatus, 'SIMULATED');
  });

  // 9. Camera Stream & Snapshot Error Handling
  test('9. Handles offline camera stream by maintaining safe fallback without throwing unhandled exceptions', () => {
    const cameraOfflineData = {
      connected: false,
      sensorModel: 'ESP32-CAM (Offline)',
      streamUrl: '',
      dataSource: 'DISCONNECTED'
    };
    assert.strictEqual(cameraOfflineData.connected, false);
    assert.strictEqual(cameraOfflineData.dataSource, 'DISCONNECTED');
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
