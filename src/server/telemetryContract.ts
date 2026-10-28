import crypto from 'node:crypto';

export type GreenhouseMemberRole = 'owner' | 'operator' | 'viewer';
export type GreenhouseDeviceType = 'esp32_cam' | 'esp32_controller';
export type DeviceProvisioningStatus = 'pending_setup' | 'awaiting_first_checkin' | 'connected' | 'revoked';
export type WifiProvisioningMethod = 'guided_secrets_header' | 'softap_portal_pending';
export type WifiProvisioningState = 'unconfigured' | 'credentials_staged' | 'pending_firmware_ap' | 'verified_online';
export type EnrollmentTokenPurpose = 'kit_qr_claim' | 'member_share_qr' | 'device_bootstrap';

export type ExplicitDeviceConnectionState =
  | 'CONFIGURATION_REQUIRED'
  | 'WAITING_FOR_FIRST_CONNECTION'
  | 'ONLINE'
  | 'STALE'
  | 'OFFLINE'
  | 'AUTHENTICATION_ERROR'
  | 'CONNECTION_ERROR';

export const DEVICE_STATE_THRESHOLDS = {
  esp32_controller: {
    recommendedUploadIntervalSeconds: 10,
    onlineMaxAgeSeconds: 45,
    staleMaxAgeSeconds: 180,
    errorVisibilityWindowSeconds: 900,
    description:
      'ONLINE <= 45s since last authenticated telemetry; STALE 46-180s; OFFLINE > 180s after initial connection.'
  },
  esp32_cam: {
    recommendedUploadIntervalSeconds: 15,
    onlineMaxAgeSeconds: 90,
    staleMaxAgeSeconds: 300,
    errorVisibilityWindowSeconds: 900,
    description:
      'ONLINE <= 90s since last authenticated JPEG upload; STALE 91-300s; OFFLINE > 300s after initial connection.'
  }
} as const;

const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'change_this_to_a_secure_camera_secret',
  'replace_with_render_camera_upload_key',
  'replace_with_render_hardware_api_key',
  'replace_with_issued_edcam_device_key',
  'replace_with_issued_edctrl_device_key',
  'my_gemini_api_key',
  'my_hardware_api_key',
  'my_camera_upload_key',
  'change_me',
  'changeme',
  'your_camera_key',
  'your_hardware_key'
]);

export function isPlaceholderOrEmptySecret(raw: string | undefined | null): boolean {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (KNOWN_PLACEHOLDER_SECRETS.has(lower)) return true;
  if (lower.startsWith('<your_') || lower.startsWith('replace_with_')) return true;
  return false;
}

export function constantTimeSecretMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(String(provided || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    crypto.timingSafeEqual(ha, hb);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

const DISALLOWED_QUERY_SECRET_PARAMS = [
  'token',
  'key',
  'auth',
  'api_key',
  'apikey',
  'camera_key',
  'camerakey',
  'hardware_key',
  'hardwarekey',
  'secret',
  'password',
  'sessiontoken'
];

export function hasDisallowedQuerySecret(query: Record<string, unknown> | undefined | null): string | null {
  if (!query || typeof query !== 'object') return null;
  for (const rawKey of Object.keys(query)) {
    const normalized = rawKey.trim().toLowerCase();
    if (DISALLOWED_QUERY_SECRET_PARAMS.includes(normalized)) {
      const val = query[rawKey];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return rawKey;
      }
    }
  }
  return null;
}

export function redactSecretsFromText(input: string | undefined | null): string {
  if (!input) return '';
  return String(input)
    .replace(/\b(edcam|edctrl|edsess|enr)_[a-zA-Z0-9_-]{8,}\b/g, '$1_[REDACTED]')
    .replace(/((?:x-camera-key|x-hardware-key|x-api-key|authorization)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;'"&]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:auth|key|token|api_key|camera_key|hardware_key|secret|password)=)[^&#\s'"]+/gi, '$1[REDACTED]')
    .replace(/((?:wifi_?password|edens_wifi_password|password)\s*[:=]\s*["']?)[^"'\s,;]+/gi, '$1[REDACTED]');
}

export function computeExplicitDeviceState(params: {
  deviceType: GreenhouseDeviceType;
  hasCredentialIssued: boolean;
  revokedAt?: string | null;
  lastSeenAt?: string | null;
  lastDataTimestamp?: string | null;
  lastErrorCategory?: 'AUTH' | 'CONNECTION' | null;
  lastErrorAt?: string | null;
  nowMs?: number;
}): {
  explicitState: ExplicitDeviceConnectionState;
  ageSeconds: number | null;
  onlineMaxAgeSeconds: number;
  staleMaxAgeSeconds: number;
} {
  const nowMs = params.nowMs ?? Date.now();
  const thresholds = DEVICE_STATE_THRESHOLDS[params.deviceType];

  if (!params.hasCredentialIssued || Boolean(params.revokedAt)) {
    return {
      explicitState: 'CONFIGURATION_REQUIRED',
      ageSeconds: null,
      onlineMaxAgeSeconds: thresholds.onlineMaxAgeSeconds,
      staleMaxAgeSeconds: thresholds.staleMaxAgeSeconds
    };
  }

  const effectiveSuccessIso = params.lastDataTimestamp || params.lastSeenAt || null;
  const successMs = effectiveSuccessIso ? new Date(effectiveSuccessIso).getTime() : NaN;
  const hasValidSuccess = Number.isFinite(successMs);

  const errMs = params.lastErrorAt ? new Date(params.lastErrorAt).getTime() : NaN;
  const hasRecentError =
    Boolean(params.lastErrorCategory) &&
    Number.isFinite(errMs) &&
    nowMs - errMs <= thresholds.errorVisibilityWindowSeconds * 1000 &&
    (!hasValidSuccess || errMs >= successMs);

  if (hasRecentError) {
    const ageSeconds = hasValidSuccess ? Math.max(0, Math.round((nowMs - successMs) / 1000)) : null;
    return {
      explicitState: params.lastErrorCategory === 'AUTH' ? 'AUTHENTICATION_ERROR' : 'CONNECTION_ERROR',
      ageSeconds,
      onlineMaxAgeSeconds: thresholds.onlineMaxAgeSeconds,
      staleMaxAgeSeconds: thresholds.staleMaxAgeSeconds
    };
  }

  if (!hasValidSuccess) {
    return {
      explicitState: 'WAITING_FOR_FIRST_CONNECTION',
      ageSeconds: null,
      onlineMaxAgeSeconds: thresholds.onlineMaxAgeSeconds,
      staleMaxAgeSeconds: thresholds.staleMaxAgeSeconds
    };
  }

  const ageSeconds = Math.max(0, Math.round((nowMs - successMs) / 1000));
  if (ageSeconds <= thresholds.onlineMaxAgeSeconds) {
    return {
      explicitState: 'ONLINE',
      ageSeconds,
      onlineMaxAgeSeconds: thresholds.onlineMaxAgeSeconds,
      staleMaxAgeSeconds: thresholds.staleMaxAgeSeconds
    };
  }
  if (ageSeconds <= thresholds.staleMaxAgeSeconds) {
    return {
      explicitState: 'STALE',
      ageSeconds,
      onlineMaxAgeSeconds: thresholds.onlineMaxAgeSeconds,
      staleMaxAgeSeconds: thresholds.staleMaxAgeSeconds
    };
  }
  return {
    explicitState: 'OFFLINE',
    ageSeconds,
    onlineMaxAgeSeconds: thresholds.onlineMaxAgeSeconds,
    staleMaxAgeSeconds: thresholds.staleMaxAgeSeconds
  };
}

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
  temperature: number | null;
  humidity: number | null;
  soilMoisture: number | null;
  sunlight: number | null;
  growLight: number | null;
  waterLevel: number | null;
  batteryVoltage: number | null;
  rain: boolean | null;
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

function parseStrictNullableNumber(
  rawVal: unknown,
  fieldName: string
): { ok: boolean; value: number | null; message?: string } {
  if (rawVal === undefined || rawVal === null || rawVal === '') {
    return { ok: true, value: null };
  }
  if (typeof rawVal === 'boolean' || typeof rawVal === 'object') {
    return { ok: false, value: null, message: `Field "${fieldName}" must be a finite number or null when unavailable.` };
  }
  const num = Number(rawVal);
  if (!Number.isFinite(num)) {
    return { ok: false, value: null, message: `Field "${fieldName}" contains a non-finite numeric value.` };
  }
  // Preserve 0 vs null strictly: Number(0) === 0
  return { ok: true, value: num };
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

  const src = raw.telemetry && typeof raw.telemetry === 'object' && !Array.isArray(raw.telemetry) ? raw.telemetry : raw;

  const tempParsed = parseStrictNullableNumber(src.temperature, 'temperature');
  if (!tempParsed.ok) return { ok: false, statusCode: 400, errorCode: 'MALFORMED_SENSOR_VALUE', message: tempParsed.message || 'Invalid temperature.' };
  const humParsed = parseStrictNullableNumber(src.humidity, 'humidity');
  if (!humParsed.ok) return { ok: false, statusCode: 400, errorCode: 'MALFORMED_SENSOR_VALUE', message: humParsed.message || 'Invalid humidity.' };
  const soilParsed = parseStrictNullableNumber(src.soilMoisture, 'soilMoisture');
  if (!soilParsed.ok) return { ok: false, statusCode: 400, errorCode: 'MALFORMED_SENSOR_VALUE', message: soilParsed.message || 'Invalid soilMoisture.' };
  const sunParsed = parseStrictNullableNumber(src.sunlight, 'sunlight');
  if (!sunParsed.ok) return { ok: false, statusCode: 400, errorCode: 'MALFORMED_SENSOR_VALUE', message: sunParsed.message || 'Invalid sunlight.' };
  const growParsed = parseStrictNullableNumber(src.growLight, 'growLight');
  if (!growParsed.ok) return { ok: false, statusCode: 400, errorCode: 'MALFORMED_SENSOR_VALUE', message: growParsed.message || 'Invalid growLight.' };
  const waterParsed = parseStrictNullableNumber(src.waterLevel, 'waterLevel');
  if (!waterParsed.ok) return { ok: false, statusCode: 400, errorCode: 'MALFORMED_SENSOR_VALUE', message: waterParsed.message || 'Invalid waterLevel.' };
  const battParsed = parseStrictNullableNumber(src.batteryVoltage ?? src.battery, 'batteryVoltage');
  if (!battParsed.ok) return { ok: false, statusCode: 400, errorCode: 'MALFORMED_SENSOR_VALUE', message: battParsed.message || 'Invalid batteryVoltage.' };
  const rainGaugeParsed = parseStrictNullableNumber(src.rainGaugeLevel ?? src.rainGauge, 'rainGaugeLevel');
  if (!rainGaugeParsed.ok) return { ok: false, statusCode: 400, errorCode: 'MALFORMED_SENSOR_VALUE', message: rainGaugeParsed.message || 'Invalid rainGaugeLevel.' };

  const tempNum = tempParsed.value;
  const humNum = humParsed.value;
  const soilNum = soilParsed.value;
  const sunlight = sunParsed.value;
  const growLight = growParsed.value;
  const waterLevel = waterParsed.value;
  const batteryVoltage = battParsed.value;
  const rainGaugeLevel = rainGaugeParsed.value;
  const rain: boolean | null =
    src.rain === undefined || src.rain === null ? null : Boolean(src.rain);

  // At least one primary environmental sensor must be present as a real finite measurement
  if (tempNum === null && humNum === null && soilNum === null) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'MISSING_REQUIRED_SENSORS',
      message:
        'Controller telemetry must provide at least one finite numeric environmental reading (temperature, humidity, or soilMoisture). Unavailable sensors may be null.'
    };
  }

  if (tempNum !== null && (tempNum < -20 || tempNum > 85)) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'TEMPERATURE_OUT_OF_BOUNDS',
      message: `Temperature (${tempNum}°C) is outside physical ESP32 sensor plausibility bounds (-20°C to 85°C).`
    };
  }

  if (humNum !== null && (humNum < 0 || humNum > 100)) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'HUMIDITY_OUT_OF_BOUNDS',
      message: `Relative humidity (${humNum}%) must be between 0% and 100%.`
    };
  }

  if (soilNum !== null && (soilNum < 0 || soilNum > 100)) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'SOIL_MOISTURE_OUT_OF_BOUNDS',
      message: `Soil moisture (${soilNum}%) must be between 0% and 100%.`
    };
  }

  if (waterLevel !== null && (waterLevel < 0 || waterLevel > 100)) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'WATER_LEVEL_OUT_OF_BOUNDS',
      message: `Water level (${waterLevel}%) must be between 0% and 100%.`
    };
  }

  if (batteryVoltage !== null && (batteryVoltage < 0 || batteryVoltage > 36)) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'BATTERY_OUT_OF_BOUNDS',
      message: `Battery voltage (${batteryVoltage}V) must be between 0V and 36V.`
    };
  }

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
    if (!valuePresent) return explicit === 'UNREPORTED' ? 'UNREPORTED' : 'UNREPORTED';
    return 'OK';
  };

  const sensorHealth: Record<string, 'OK' | 'OUT_OF_RANGE' | 'FAULT' | 'UNREPORTED'> = {
    temperature: normalizeHealth('temperature', tempNum !== null, true),
    humidity: normalizeHealth('humidity', humNum !== null, true),
    soilMoisture: normalizeHealth('soilMoisture', soilNum !== null, true),
    waterLevel: normalizeHealth('waterLevel', waterLevel !== null, true),
    sunlight: normalizeHealth('sunlight', sunlight !== null, sunlight === null || sunlight >= 0),
    batteryVoltage: normalizeHealth('batteryVoltage', batteryVoltage !== null, true),
    rainSensor: normalizeHealth('rainSensor', rain !== null, true)
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
    rainLocked: Boolean(rawLocks.rainLocked ?? (rain === true)),
    waterLowLocked: Boolean(rawLocks.waterLowLocked ?? (waterLevel !== null && waterLevel < 10)),
    thermalLocked: Boolean(rawLocks.thermalLocked ?? (tempNum !== null && tempNum > 32)),
    overIrrigationLocked: Boolean(rawLocks.overIrrigationLocked ?? false)
  };

  const rawDev = raw.deviceHealth && typeof raw.deviceHealth === 'object' ? raw.deviceHealth : {};
  const uptimeParsed = parseStrictNullableNumber(rawDev.uptimeSeconds ?? raw.uptimeSeconds, 'uptimeSeconds');
  const rssiParsed = parseStrictNullableNumber(rawDev.wifiRssi ?? raw.wifiRssi, 'wifiRssi');
  const heapParsed = parseStrictNullableNumber(rawDev.freeHeapBytes ?? raw.freeHeapBytes, 'freeHeapBytes');

  const deviceHealth = {
    firmwareVersion:
      typeof (rawDev.firmwareVersion ?? raw.firmwareVersion) === 'string'
        ? String(rawDev.firmwareVersion ?? raw.firmwareVersion).slice(0, 48)
        : undefined,
    uptimeSeconds: uptimeParsed.ok && uptimeParsed.value !== null ? uptimeParsed.value : undefined,
    wifiRssi: rssiParsed.ok && rssiParsed.value !== null ? rssiParsed.value : undefined,
    freeHeapBytes: heapParsed.ok && heapParsed.value !== null ? heapParsed.value : undefined,
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
