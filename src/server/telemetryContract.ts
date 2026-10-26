import crypto from 'node:crypto';

export type GreenhouseMemberRole = 'owner' | 'operator' | 'viewer';
export type GreenhouseDeviceType = 'esp32_cam' | 'esp32_controller';
export type DeviceProvisioningStatus = 'pending_setup' | 'awaiting_first_checkin' | 'connected' | 'revoked';
export type WifiProvisioningMethod = 'guided_secrets_header' | 'softap_portal_pending';
export type WifiProvisioningState = 'unconfigured' | 'credentials_staged' | 'pending_firmware_ap' | 'verified_online';
export type EnrollmentTokenPurpose = 'kit_qr_claim' | 'member_share_qr' | 'device_bootstrap';

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateSecureId(prefix: string, byteLength: number = 8): string {
  return `${prefix}_${crypto.randomBytes(byteLength).toString('hex')}`;
}

export function hashPasswordScrypt(password: string, existingSaltHex?: string): { hashHex: string; saltHex: string } {
  const saltBuf = existingSaltHex ? Buffer.from(existingSaltHex, 'hex') : crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, saltBuf, 64);
  return {
    hashHex: derived.toString('hex'),
    saltHex: saltBuf.toString('hex')
  };
}

export function verifyPasswordScrypt(password: string, expectedHashHex: string, saltHex: string): boolean {
  const { hashHex } = hashPasswordScrypt(password, saltHex);
  const a = Buffer.from(hashHex, 'hex');
  const b = Buffer.from(expectedHashHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(options: { windowMs: number; maxRequests: number }) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
  }

  public check(key: string, nowMs: number = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const cutoff = nowMs - this.windowMs;
    const prev = this.buckets.get(key) || [];
    const active = prev.filter((ts) => ts > cutoff);

    if (active.length >= this.maxRequests) {
      const oldest = active[0] || nowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
      this.buckets.set(key, active);
      return { allowed: false, retryAfterSeconds };
    }

    active.push(nowMs);
    this.buckets.set(key, active);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function extractRawEnrollmentCode(input: string | undefined | null): string | null {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;

  if (/^enr_[a-f0-9]{16,96}$/i.test(trimmed)) {
    return trimmed;
  }

  try {
    if (trimmed.startsWith('edens://') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const normalized = trimmed.startsWith('edens://')
        ? trimmed.replace(/^edens:\/\//i, 'https://edens.local/')
        : trimmed;
      const u = new URL(normalized);
      const code = u.searchParams.get('code') || u.searchParams.get('token');
      if (code && /^enr_[a-f0-9]{16,96}$/i.test(code.trim())) {
        return code.trim();
      }
    }
  } catch (_) {}

  try {
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      const code = parsed.code || parsed.token;
      if (typeof code === 'string' && /^enr_[a-f0-9]{16,96}$/i.test(code.trim())) {
        return code.trim();
      }
    }
  } catch (_) {}

  return null;
}

export interface ValidatedControllerTelemetry {
  timestamp: string;
  temperature: number;
  humidity: number;
  soilMoisture: number;
  sunlight: number | null;
  growLight: number | null;
  waterLevel: number | null;
  batteryVoltage: number | null;
  rain: boolean;
  rainGaugeLevel: number | null;
  sensorHealth: Record<string, 'OK' | 'OUT_OF_RANGE' | 'FAULT' | 'UNREPORTED'>;
  actuators: Record<string, boolean>;
  interlocks: Record<string, boolean>;
  deviceHealth: {
    firmwareVersion?: string;
    uptimeSeconds?: number;
    wifiRssi?: number;
    freeHeapBytes?: number;
    localSafetyControlActive: boolean;
  };
}

export function validateControllerTelemetryPayload(
  raw: any
):
  | ({ ok: true } & ValidatedControllerTelemetry)
  | { ok: false; statusCode: number; errorCode: string; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'INVALID_TELEMETRY_PAYLOAD',
      message: 'Telemetry body must be a JSON object.'
    };
  }

  if (
    String(raw.dataSource || '').toUpperCase() === 'SIMULATED' ||
    String(raw.source || '').toUpperCase() === 'SIMULATED' ||
    raw.simulated === true
  ) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'SIMULATED_DATA_REJECTED',
      message: 'Simulated sensor payloads cannot be submitted to the physical controller telemetry intake.'
    };
  }

  const src = raw.telemetry && typeof raw.telemetry === 'object' ? raw.telemetry : raw;
  const tempNum = Number(src.temperature);
  const humNum = Number(src.humidity);
  const soilNum = Number(src.soilMoisture);

  if (
    src.temperature === undefined ||
    src.temperature === null ||
    src.temperature === '' ||
    !Number.isFinite(tempNum) ||
    src.humidity === undefined ||
    src.humidity === null ||
    src.humidity === '' ||
    !Number.isFinite(humNum) ||
    src.soilMoisture === undefined ||
    src.soilMoisture === null ||
    src.soilMoisture === '' ||
    !Number.isFinite(soilNum)
  ) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'MISSING_REQUIRED_SENSORS',
      message: 'Controller telemetry must provide finite numeric temperature (°C), humidity (% RH), and soilMoisture (%) readings.'
    };
  }

  if (tempNum < -20 || tempNum > 85) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'TEMPERATURE_OUT_OF_BOUNDS',
      message: `Temperature (${tempNum}°C) is outside physical ESP32 sensor plausibility bounds (-20°C to 85°C).`
    };
  }

  if (humNum < 0 || humNum > 100) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'HUMIDITY_OUT_OF_BOUNDS',
      message: `Relative humidity (${humNum}%) must be between 0% and 100%.`
    };
  }

  if (soilNum < 0 || soilNum > 100) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'SOIL_MOISTURE_OUT_OF_BOUNDS',
      message: `Soil moisture (${soilNum}%) must be between 0% and 100%.`
    };
  }

  const parseOptionalFinite = (val: unknown): number | null => {
    if (val === undefined || val === null || val === '') return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  };

  const sunlight = parseOptionalFinite(src.sunlight);
  const growLight = parseOptionalFinite(src.growLight);
  const waterLevel = parseOptionalFinite(src.waterLevel);
  const batteryVoltage = parseOptionalFinite(src.batteryVoltage ?? src.battery);
  const rain = Boolean(src.rain ?? false);
  const rainGaugeLevel = parseOptionalFinite(src.rainGaugeLevel ?? src.rainGauge);

  let timestamp = new Date().toISOString();
  if (typeof raw.timestamp === 'string') {
    const parsedTs = new Date(raw.timestamp).getTime();
    if (Number.isFinite(parsedTs) && parsedTs <= Date.now() + 10000) {
      timestamp = new Date(parsedTs).toISOString();
    }
  }

  const upstreamHealth = raw.sensorHealth && typeof raw.sensorHealth === 'object' ? raw.sensorHealth : {};
  const normalizeHealth = (
    key: string,
    valuePresent: boolean,
    inBounds: boolean = true
  ): 'OK' | 'OUT_OF_RANGE' | 'FAULT' | 'UNREPORTED' => {
    const explicit = String(upstreamHealth[key] || '').toUpperCase();
    if (explicit === 'FAULT') return 'FAULT';
    if (explicit === 'OUT_OF_RANGE' || !inBounds) return 'OUT_OF_RANGE';
    if (explicit === 'OK' || valuePresent) return 'OK';
    return 'UNREPORTED';
  };

  const sensorHealth: Record<string, 'OK' | 'OUT_OF_RANGE' | 'FAULT' | 'UNREPORTED'> = {
    temperature: normalizeHealth('temperature', true, true),
    humidity: normalizeHealth('humidity', true, true),
    soilMoisture: normalizeHealth('soilMoisture', true, true),
    waterLevel: normalizeHealth('waterLevel', waterLevel !== null, waterLevel === null || (waterLevel >= 0 && waterLevel <= 100)),
    sunlight: normalizeHealth('sunlight', sunlight !== null, sunlight === null || sunlight >= 0),
    batteryVoltage: normalizeHealth(
      'batteryVoltage',
      batteryVoltage !== null,
      batteryVoltage === null || (batteryVoltage >= 0 && batteryVoltage <= 30)
    ),
    rainSensor: normalizeHealth('rainSensor', src.rain !== undefined, true)
  };

  const rawAct = raw.actuators && typeof raw.actuators === 'object' ? raw.actuators : {};
  const actuators: Record<string, boolean> = {
    pumpActive: Boolean(rawAct.pumpActive ?? raw.pumpActive ?? false),
    fanActive: Boolean(rawAct.fanActive ?? raw.fanActive ?? false),
    lightActive: Boolean(rawAct.lightActive ?? raw.lightActive ?? false),
    heaterActive: Boolean(rawAct.heaterActive ?? raw.heaterActive ?? false),
    peltierActive: Boolean(rawAct.peltierActive ?? raw.peltierActive ?? false),
    roofActive: Boolean(rawAct.roofActive ?? raw.roofActive ?? false)
  };

  const rawLocks = raw.interlocks && typeof raw.interlocks === 'object' ? raw.interlocks : {};
  const interlocks: Record<string, boolean> = {
    rainLocked: Boolean(rawLocks.rainLocked ?? rain),
    waterLowLocked: Boolean(rawLocks.waterLowLocked ?? (waterLevel !== null && waterLevel < 10)),
    thermalLocked: Boolean(rawLocks.thermalLocked ?? tempNum > 32),
    overIrrigationLocked: Boolean(rawLocks.overIrrigationLocked ?? false)
  };

  const rawDev = raw.deviceHealth && typeof raw.deviceHealth === 'object' ? raw.deviceHealth : {};
  const deviceHealth = {
    firmwareVersion:
      typeof (rawDev.firmwareVersion ?? raw.firmwareVersion) === 'string'
        ? String(rawDev.firmwareVersion ?? raw.firmwareVersion).slice(0, 48)
        : undefined,
    uptimeSeconds: parseOptionalFinite(rawDev.uptimeSeconds ?? raw.uptimeSeconds) ?? undefined,
    wifiRssi: parseOptionalFinite(rawDev.wifiRssi ?? raw.wifiRssi) ?? undefined,
    freeHeapBytes: parseOptionalFinite(rawDev.freeHeapBytes ?? raw.freeHeapBytes) ?? undefined,
    localSafetyControlActive: rawDev.localSafetyControlActive !== false
  };

  return {
    ok: true,
    timestamp,
    temperature: tempNum,
    humidity: humNum,
    soilMoisture: soilNum,
    sunlight,
    growLight,
    waterLevel,
    batteryVoltage,
    rain,
    rainGaugeLevel,
    sensorHealth,
    actuators,
    interlocks,
    deviceHealth
  };
}
