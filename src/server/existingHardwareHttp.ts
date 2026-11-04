import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import express from 'express';
import { CameraImageStore } from './cameraStorage.ts';
import { GreenhouseCameraStoreRegistry, isPrivateRfc1918Ipv4 } from './cameraAcquisition.ts';
import { type AuthenticatedUser, PlatformDatabase } from './database.ts';
import {
  generateSecureId,
  hasDisallowedQuerySecret,
  redactSecretsFromText,
  validateControllerTelemetryPayload
} from './telemetryContract.ts';

export const MONITORING_MODE_BANNER = 'MONITORING MODE — PHYSICAL CONTROL DISABLED.';

export type ExistingHardwareConnectionState =
  | 'CONNECTED'
  | 'IMAGE_RECEIVED'
  | 'RECONNECTING'
  | 'OFFLINE'
  | 'CONNECTION_BLOCKED'
  | 'INVALID_ADDRESS';

export type ControllerTelemetryProvenance = 'REAL_HARDWARE' | 'SIMULATED' | 'STALE' | 'OFFLINE';

export type HardwareDataCategory =
  | 'REAL_HARDWARE_DATA'
  | 'SIMULATED_DATA'
  | 'STALE_DATA'
  | 'OFFLINE';

export type HardwareConnectionMethod = 'LOCAL' | 'CLOUD';

export type SensorValidityState =
  | 'VALID'
  | 'UNAVAILABLE'
  | 'DISCONNECTED'
  | 'OUT_OF_RANGE'
  | 'STALE';

export interface DiscoveredSensorCapability {
  key: string;
  label: string;
  value: number | boolean | null;
  formattedValue: string;
  unit: string;
  connected: boolean;
  validity: SensorValidityState;
  timestamp: string;
  sourceDevice: string;
}

export interface SavedExistingCameraConfig {
  cameraName: string;
  cameraIp: string;
  streamUrl: string;
  photoUrl: string;
  statusUrl: string;
  connectionMethod: HardwareConnectionMethod;
  disconnectedByUser?: boolean;
  firmwareVersion?: string | null;
  streamSupported?: boolean;
  lastTestedAt: string | null;
  lastSuccessfulConnAt: string | null;
  lastFrameId: string | null;
  lastState: ExistingHardwareConnectionState;
}

export interface SavedExistingControllerConfig {
  controllerName: string;
  host: string;
  port: number;
  baseUrl: string;
  statusUrl: string;
  telemetryUrl: string;
  connectionMethod: HardwareConnectionMethod;
  disconnectedByUser?: boolean;
  firmwareVersion?: string | null;
  lastHeartbeatAt?: string | null;
  lastTestedAt: string | null;
  lastSuccessfulConnAt: string | null;
  lastState: ExistingHardwareConnectionState;
  lastProvenance: ControllerTelemetryProvenance;
  firmwareSupportSummary: string | null;
  cachedReadings?: Record<string, number | boolean | null> | null;
  cachedSensorHealth?: Record<string, string> | null;
  cachedReadingsAt?: string | null;
  discoveredSensors?: DiscoveredSensorCapability[];
}

interface PersistedScopeEntry {
  updatedAt: string;
  camera: SavedExistingCameraConfig | null;
  controller: SavedExistingControllerConfig | null;
}

export interface ValidatedHardwareEndpointUrl {
  valid: true;
  normalizedUrl: string;
  origin: string;
  pathname: string;
  search: string;
  hostname: string;
  port: number;
  protocol: 'http:';
  isPrivateLanOrMdns: boolean;
  isLoopback: boolean;
}

export interface InvalidHardwareEndpointUrl {
  valid: false;
  connectionState: 'INVALID_ADDRESS';
  errorCode: string;
  message: string;
}

export function isRemoteCloudForPrivateLan(): boolean {
  if (
    process.env.EDENS_FORCE_LOCAL_GATEWAY_FOR_TEST === '1' ||
    process.env.EDENS_LOCAL_GATEWAY_MODE === '1'
  ) {
    return false;
  }
  if (process.env.EDENS_FORCE_CLOUD_MODE_FOR_TEST === '1') {
    return true;
  }
  const appUrl = (process.env.APP_URL || '').trim().toLowerCase();
  return Boolean(
    process.env.RENDER ||
      process.env.RENDER_EXTERNAL_URL ||
      process.env.FLY_APP_NAME ||
      process.env.VERCEL ||
      process.env.K_SERVICE ||
      process.env.CLOUD_RUN_JOB ||
      appUrl.includes('.run.app') ||
      appUrl.includes('.onrender.com') ||
      appUrl.includes('.vercel.app')
  );
}

function isMdnsHostname(hostname: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.local$/i.test(hostname);
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname.startsWith('127.') ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function isBlockedMetadataOrInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !h ||
    h === '0.0.0.0' ||
    h === '255.255.255.255' ||
    h === '169.254.169.254' ||
    h === '100.100.100.200' ||
    h === 'metadata.google.internal' ||
    h === 'metadata' ||
    h.endsWith('.internal') ||
    h.startsWith('169.254.') ||
    h.startsWith('fe80:') ||
    h.startsWith('fc00:') ||
    h.startsWith('fd00:')
  ) {
    return true;
  }
  // Block RFC6598 Carrier-Grade NAT / internal cloud fabrics (100.64.0.0/10) & multicast (224.0.0.0/4)
  const ipv4Parts = h.split('.');
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d+$/.test(p))) {
    const a = Number(ipv4Parts[0]);
    const b = Number(ipv4Parts[1]);
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    if (a === 0) return true;
  }
  return false;
}

/**
 * Validates a bare IPv4/mDNS hostname + TCP port (e.g., `10.87.237.36` or `edens-esp32.local`).
 */
export function validateHardwareHostAndPort(
  rawHost: unknown,
  rawPort: unknown = 80,
  options: { fieldName?: string; allowLoopback?: boolean } = {}
):
  | {
      valid: true;
      hostname: string;
      port: number;
      origin: string;
      isPrivateLanOrMdns: boolean;
      isLoopback: boolean;
    }
  | InvalidHardwareEndpointUrl {
  const fieldLabel = options.fieldName || 'Device IP / Hostname';
  const allowLoopback = Boolean(options.allowLoopback);

  if (typeof rawHost !== 'string' || !rawHost.trim()) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'EMPTY_HOST',
      message: `${fieldLabel} is required (for example, 10.87.237.36 or edens-esp32.local).`
    };
  }

  let candidateHost = rawHost.trim().toLowerCase();
  let portNum = typeof rawPort === 'number' ? rawPort : Number.parseInt(String(rawPort ?? '80'), 10);

  // If user pasted http://host:port into the host field, extract cleanly only if valid
  if (/^https?:\/\//i.test(candidateHost)) {
    const asUrl = validateExistingHardwareEndpointUrl(candidateHost, {
      fieldName: fieldLabel,
      allowLoopback
    });
    if ('errorCode' in asUrl) return asUrl;
    candidateHost = asUrl.hostname;
    if (rawPort === undefined || rawPort === null || rawPort === '' || Number(rawPort) === 80) {
      portNum = asUrl.port;
    }
  } else if (candidateHost.includes('/') || candidateHost.includes('@') || /\s/.test(candidateHost)) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'MALFORMED_HOST',
      message: `${fieldLabel} must be an IPv4 address or .local hostname without paths or credentials.`
    };
  }

  if (isBlockedMetadataOrInternalHost(candidateHost)) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'FORBIDDEN_METADATA_OR_LINK_LOCAL_HOST',
      message: `${fieldLabel} "${candidateHost}" is blocked by SSRF security policy.`
    };
  }

  const isPrivateIp = isPrivateRfc1918Ipv4(candidateHost);
  const isMdns = isMdnsHostname(candidateHost);
  const isLoopback = allowLoopback && isLoopbackHostname(candidateHost);

  if (!isPrivateIp && !isMdns && !isLoopback) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'NON_PRIVATE_LAN_HOST_REJECTED',
      message: `${fieldLabel} "${candidateHost}" must be a private greenhouse LAN IPv4 address (10.x.x.x, 172.16-31.x.x, 192.168.x.x) or .local mDNS hostname.`
    };
  }

  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'INVALID_TCP_PORT',
      message: `${fieldLabel} port must be an integer between 1 and 65535.`
    };
  }

  const origin = portNum === 80 ? `http://${candidateHost}` : `http://${candidateHost}:${portNum}`;
  return {
    valid: true,
    hostname: candidateHost,
    port: portNum,
    origin,
    isPrivateLanOrMdns: isPrivateIp || isMdns,
    isLoopback
  };
}

/**
 * Strictly validates an existing ESP32 HTTP endpoint URL (stream, photo, status, telemetry, or base URL).
 * Prevents SSRF to public internet hosts or cloud metadata services, blocks embedded credentials
 * and query-string secrets, and returns `INVALID_ADDRESS` on any invalid address.
 */
export function validateExistingHardwareEndpointUrl(
  rawUrl: unknown,
  options: {
    fieldName?: string;
    allowLoopback?: boolean;
  } = {}
): ValidatedHardwareEndpointUrl | InvalidHardwareEndpointUrl {
  const fieldLabel = options.fieldName || 'Endpoint URL';
  const allowLoopback = Boolean(options.allowLoopback);

  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'EMPTY_URL',
      message: `${fieldLabel} is required. Enter a complete http:// address (for example, http://10.87.237.36/photo).`
    };
  }

  const trimmed = rawUrl.trim();
  if (/\s/.test(trimmed) || trimmed.includes('placeholder-ip')) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'MALFORMED_URL',
      message: `${fieldLabel} contains invalid characters or placeholder text.`
    };
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'MISSING_HTTP_SCHEME',
      message: `${fieldLabel} must start with http:// (for example, http://10.87.237.36/photo).`
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'MALFORMED_URL',
      message: `${fieldLabel} is not a valid URL.`
    };
  }

  if (parsed.protocol !== 'http:') {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'UNSUPPORTED_URL_SCHEME',
      message: `${fieldLabel} must use http:// for local ESP32 endpoints (received "${parsed.protocol}"). For cloud HTTPS push, select Cloud connection method.`
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'EMBEDDED_CREDENTIALS_FORBIDDEN',
      message: `${fieldLabel} must not embed username:password credentials in the URL.`
    };
  }

  const queryEntries: Record<string, string> = {};
  parsed.searchParams.forEach((v, k) => {
    queryEntries[k] = v;
  });
  const disallowedSecret = hasDisallowedQuerySecret(queryEntries);
  if (disallowedSecret) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'QUERY_SECRET_FORBIDDEN',
      message: `${fieldLabel} must not pass secrets or tokens in query parameter "${disallowedSecret}".`
    };
  }

  if (parsed.pathname.includes('..') || parsed.pathname.includes('//')) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'INVALID_URL_PATH',
      message: `${fieldLabel} path contains disallowed traversal segments.`
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || isBlockedMetadataOrInternalHost(hostname)) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'FORBIDDEN_METADATA_OR_LINK_LOCAL_HOST',
      message: `${fieldLabel} host "${hostname}" is blocked by SSRF security policy.`
    };
  }

  const isPrivateIp = isPrivateRfc1918Ipv4(hostname);
  const isMdns = isMdnsHostname(hostname);
  const isLoopback = allowLoopback && isLoopbackHostname(hostname);

  if (!isPrivateIp && !isMdns && !isLoopback) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'NON_PRIVATE_LAN_HOST_REJECTED',
      message: `${fieldLabel} host "${hostname}" is not a private greenhouse LAN IPv4 address (10.x.x.x, 172.16-31.x.x, 192.168.x.x) or .local mDNS hostname.`
    };
  }

  const resolvedPort = parsed.port ? Number.parseInt(parsed.port, 10) : 80;
  if (!Number.isInteger(resolvedPort) || resolvedPort < 1 || resolvedPort > 65535) {
    return {
      valid: false,
      connectionState: 'INVALID_ADDRESS',
      errorCode: 'INVALID_TCP_PORT',
      message: `${fieldLabel} TCP port must be between 1 and 65535.`
    };
  }

  const origin = resolvedPort === 80 ? `http://${hostname}` : `http://${hostname}:${resolvedPort}`;
  const pathname = parsed.pathname || '/';
  const search = parsed.search || '';

  return {
    valid: true,
    normalizedUrl: `${origin}${pathname}${search}`,
    origin,
    pathname,
    search,
    hostname,
    port: resolvedPort,
    protocol: 'http:',
    isPrivateLanOrMdns: isPrivateIp || isMdns,
    isLoopback
  };
}

interface StandardSensorSpec {
  key: string;
  aliases: string[];
  label: string;
  unit: string;
  precision?: number;
  healthKey?: string;
}

const STANDARD_SENSOR_CATALOG: StandardSensorSpec[] = [
  {
    key: 'temperature',
    aliases: ['temperature', 'temperatureC', 'temp', 'tempC'],
    label: 'Temperature',
    unit: '°C',
    precision: 1,
    healthKey: 'dht22'
  },
  {
    key: 'humidity',
    aliases: ['humidity', 'humidityPct', 'hum'],
    label: 'Humidity',
    unit: '%',
    precision: 0,
    healthKey: 'dht22'
  },
  {
    key: 'soilMoisture',
    aliases: ['soilMoisture', 'soilMoisturePct', 'soil_moisture', 'soil'],
    label: 'Soil Moisture',
    unit: '%',
    precision: 0,
    healthKey: 'soilMoisture'
  },
  {
    key: 'waterLevel',
    aliases: ['waterLevel', 'waterLevelPct', 'water_level', 'tankLevel'],
    label: 'Water Level',
    unit: '%',
    precision: 0,
    healthKey: 'waterLevel'
  },
  {
    key: 'sunlight',
    aliases: ['sunlight', 'sunlightLux', 'lightIntensity', 'light', 'lux'],
    label: 'Light Intensity',
    unit: 'lx',
    precision: 0,
    healthKey: 'ldr'
  },
  {
    key: 'growLight',
    aliases: ['growLight', 'growLightLux', 'grow_light'],
    label: 'Supplemental Grow Light',
    unit: 'lx',
    precision: 0
  },
  {
    key: 'batteryVoltage',
    aliases: ['batteryVoltage', 'battery_voltage', 'voltage', 'vbat'],
    label: 'Battery / Bus Voltage',
    unit: 'V',
    precision: 2,
    healthKey: 'power'
  },
  {
    key: 'rain',
    aliases: ['rain', 'rainDetected', 'rain_detected'],
    label: 'Rain Detector',
    unit: 'boolean',
    healthKey: 'rain'
  },
  {
    key: 'co2Ppm',
    aliases: ['co2Ppm', 'co2_ppm', 'co2'],
    label: 'CO2 Concentration',
    unit: 'ppm',
    precision: 0
  },
  {
    key: 'parUmol',
    aliases: ['parUmol', 'par_umol', 'par', 'ppfd'],
    label: 'PAR / PPFD',
    unit: 'µmol/m²/s',
    precision: 0
  },
  {
    key: 'ph',
    aliases: ['ph', 'nutrientPh'],
    label: 'Nutrient pH',
    unit: 'pH',
    precision: 2
  },
  {
    key: 'ecMsCm',
    aliases: ['ecMsCm', 'ec_ms_cm', 'ec'],
    label: 'Electrical Conductivity',
    unit: 'mS/cm',
    precision: 2
  }
];

const IGNORED_META_KEYS = new Set([
  'timestamp',
  'recordedAt',
  'receivedAt',
  'uptimeSeconds',
  'uptime',
  'wifiRssi',
  'rssi',
  'freeHeapBytes',
  'freeHeap',
  'firmwareVersion',
  'version',
  'deviceId',
  'greenhouseId',
  'zoneId',
  'dataSource',
  'actuators',
  'interlocks',
  'sensorHealth',
  'deviceHealth',
  'sensors',
  'capabilities',
  'status',
  'ok',
  'success',
  'pumpActive',
  'fanActive',
  'heaterActive',
  'growLightActive',
  'roofOpen',
  'localSafetyControlActive'
]);

function humanizeDynamicSensorKey(rawKey: string): { label: string; unit: string } {
  const lower = rawKey.toLowerCase();
  let unit = '';
  if (lower.endsWith('tempc') || lower.endsWith('temperaturec')) unit = '°C';
  else if (lower.endsWith('pct') || lower.endsWith('percent')) unit = '%';
  else if (lower.endsWith('lux')) unit = 'lx';
  else if (lower.endsWith('hpa')) unit = 'hPa';
  else if (lower.endsWith('kpa')) unit = 'kPa';
  else if (lower.endsWith('ppm')) unit = 'ppm';
  else if (lower.endsWith('voltage') || lower.endsWith('volts')) unit = 'V';
  else if (lower.endsWith('mm')) unit = 'mm';

  const words = rawKey
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));

  return {
    label: words.join(' ') || rawKey,
    unit
  };
}

/**
 * Dynamically discovers sensor capabilities from actual telemetry readings and optional
 * `sensorHealth` / `sensors` metadata.
 *
 * CRITICAL GUARANTEE:
 * Unavailable (`null` / `undefined` / `NaN` / `DISCONNECTED` / `OUT_OF_RANGE`) sensors are
 * NEVER marked `connected: true`. Every sensor carries a timestamp, unit, validity state,
 * and source device identifier.
 */
export function discoverSensorCapabilities(params: {
  readings: Record<string, unknown> | null | undefined;
  rawPayload?: Record<string, unknown> | null;
  sensorHealth?: Record<string, unknown> | null;
  timestampIso: string | null;
  sourceDevice: string;
  isStale?: boolean;
}): DiscoveredSensorCapability[] {
  const readings = params.readings || {};
  const rawPayload = params.rawPayload || {};
  const nestedSensors =
    rawPayload.sensors && typeof rawPayload.sensors === 'object' && !Array.isArray(rawPayload.sensors)
      ? (rawPayload.sensors as Record<string, unknown>)
      : {};
  const healthMap = params.sensorHealth || {};
  const ts = params.timestampIso || new Date().toISOString();
  const sourceDevice = params.sourceDevice || 'Greenhouse ESP32 Controller';
  const isStale = Boolean(params.isStale);

  const consumedKeys = new Set<string>();
  const capabilities: DiscoveredSensorCapability[] = [];

  // Core 5 primary sensors are always audited so farmers can clearly see which core sensors
  // are actually connected vs unavailable; optional secondary sensors appear when reported.
  const coreAlwaysShownKeys = new Set([
    'temperature',
    'humidity',
    'soilMoisture',
    'waterLevel',
    'sunlight'
  ]);

  for (const spec of STANDARD_SENSOR_CATALOG) {
    let rawVal: unknown = undefined;
    let matchedKeyFound = false;

    for (const alias of spec.aliases) {
      consumedKeys.add(alias);
      if (alias in readings && readings[alias] !== undefined) {
        rawVal = readings[alias];
        matchedKeyFound = true;
        break;
      }
      if (alias in rawPayload && rawPayload[alias] !== undefined) {
        rawVal = rawPayload[alias];
        matchedKeyFound = true;
        break;
      }
      if (alias in nestedSensors && nestedSensors[alias] !== undefined) {
        rawVal = nestedSensors[alias];
        matchedKeyFound = true;
        break;
      }
    }

    const rawHealth = String(
      healthMap[spec.key] || (spec.healthKey ? healthMap[spec.healthKey] : '') || ''
    ).toUpperCase();

    const isCore = coreAlwaysShownKeys.has(spec.key);
    if (!isCore && !matchedKeyFound && !rawHealth) {
      continue;
    }

    let validity: SensorValidityState = 'UNAVAILABLE';
    let connected = false;
    let normalizedVal: number | boolean | null = null;
    let formattedValue = 'Unavailable';

    if (rawHealth === 'DISCONNECTED' || rawHealth === 'FAULT') {
      validity = 'DISCONNECTED';
    } else if (rawHealth === 'OUT_OF_RANGE') {
      validity = 'OUT_OF_RANGE';
    } else if (spec.unit === 'boolean') {
      if (typeof rawVal === 'boolean' || rawVal === 0 || rawVal === 1) {
        normalizedVal = typeof rawVal === 'boolean' ? rawVal : rawVal === 1;
        connected = true;
        validity = isStale ? 'STALE' : 'VALID';
        formattedValue = normalizedVal ? 'Rain Detected' : 'Dry';
      }
    } else if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
      normalizedVal = rawVal;
      connected = rawHealth !== 'UNAVAILABLE';
      validity = !connected ? 'UNAVAILABLE' : isStale ? 'STALE' : 'VALID';
      if (connected) {
        const digits = spec.precision ?? 1;
        formattedValue = `${rawVal.toFixed(digits)}${spec.unit === 'lx' || spec.unit === 'ppm' || spec.unit === 'µmol/m²/s' || spec.unit === 'mS/cm' ? ` ${spec.unit}` : spec.unit}`;
      }
    }

    capabilities.push({
      key: spec.key,
      label: spec.label,
      value: connected ? normalizedVal : null,
      formattedValue: connected ? formattedValue : validity === 'DISCONNECTED' ? 'Disconnected' : validity === 'OUT_OF_RANGE' ? 'Out of Range' : 'Unavailable',
      unit: spec.unit,
      connected,
      validity,
      timestamp: ts,
      sourceDevice
    });
  }

  // Dynamically discover any extra custom sensors reported by the controller JSON!
  const extraCandidateSources: Array<Record<string, unknown>> = [nestedSensors, rawPayload, readings];
  for (const src of extraCandidateSources) {
    for (const [k, v] of Object.entries(src)) {
      if (consumedKeys.has(k) || IGNORED_META_KEYS.has(k)) continue;
      consumedKeys.add(k);

      if (typeof v === 'number' && Number.isFinite(v)) {
        const meta = humanizeDynamicSensorKey(k);
        capabilities.push({
          key: k,
          label: meta.label,
          value: v,
          formattedValue: meta.unit ? `${Number(v.toFixed(2))} ${meta.unit}` : `${Number(v.toFixed(2))}`,
          unit: meta.unit || 'raw',
          connected: true,
          validity: isStale ? 'STALE' : 'VALID',
          timestamp: ts,
          sourceDevice
        });
      } else if (typeof v === 'boolean') {
        const meta = humanizeDynamicSensorKey(k);
        capabilities.push({
          key: k,
          label: meta.label,
          value: v,
          formattedValue: v ? 'Active / True' : 'Inactive / False',
          unit: 'boolean',
          connected: true,
          validity: isStale ? 'STALE' : 'VALID',
          timestamp: ts,
          sourceDevice
        });
      } else if (v === null && src === nestedSensors) {
        const meta = humanizeDynamicSensorKey(k);
        capabilities.push({
          key: k,
          label: meta.label,
          value: null,
          formattedValue: 'Unavailable',
          unit: meta.unit || 'unreported',
          connected: false,
          validity: 'UNAVAILABLE',
          timestamp: ts,
          sourceDevice
        });
      }
    }
  }

  return capabilities;
}

export class ExistingHardwareConfigStore {
  private readonly filePath: string;
  private cache: Record<string, PersistedScopeEntry> = {};

  constructor(storageBaseDir?: string) {
    const rootDir =
      storageBaseDir ||
      process.env.CAMERA_STORAGE_PATH ||
      process.env.UPLOADS_DIR ||
      path.join(process.cwd(), 'uploads');
    this.filePath = path.join(rootDir, 'existing_hardware_connections.json');
    this.loadFromDisk();
  }

  private normalizeScopeKey(greenhouseId?: string | null): string {
    const clean = String(greenhouseId || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '');
    return clean ? `gh:${clean}` : 'global';
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (raw && typeof raw === 'object') {
        this.cache = raw as Record<string, PersistedScopeEntry>;
      }
    } catch {
      this.cache = {};
    }
  }

  private saveToDisk(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
    } catch (err: any) {
      console.warn('[ExistingHardwareConfigStore] Persist warning:', err?.message || err);
    }
  }

  public getScope(greenhouseId?: string | null): PersistedScopeEntry {
    const key = this.normalizeScopeKey(greenhouseId);
    return (
      this.cache[key] || {
        updatedAt: new Date(0).toISOString(),
        camera: null,
        controller: null
      }
    );
  }

  public saveCamera(
    greenhouseId: string | null | undefined,
    camera: SavedExistingCameraConfig
  ): SavedExistingCameraConfig {
    const key = this.normalizeScopeKey(greenhouseId);
    const existing = this.getScope(greenhouseId);
    this.cache[key] = {
      updatedAt: new Date().toISOString(),
      camera,
      controller: existing.controller
    };
    this.saveToDisk();
    return camera;
  }

  public saveController(
    greenhouseId: string | null | undefined,
    controller: SavedExistingControllerConfig
  ): SavedExistingControllerConfig {
    const key = this.normalizeScopeKey(greenhouseId);
    const existing = this.getScope(greenhouseId);
    this.cache[key] = {
      updatedAt: new Date().toISOString(),
      camera: existing.camera,
      controller
    };
    this.saveToDisk();
    return controller;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function safeJsonParseObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export interface RegisterExistingHardwareHttpOptions {
  platformDb: PlatformDatabase;
  globalCameraStore: CameraImageStore;
  cameraRegistry: GreenhouseCameraStoreRegistry;
  requireAuthenticatedUser: (req: express.Request) => AuthenticatedUser | null;
  getLatestGlobalTelemetry?: () => {
    exists: boolean;
    dataSource: string;
    explicitState: string;
    timestamp: string | null;
    ageSeconds: number | null;
    readings: Record<string, unknown> | null;
  };
  allowLoopbackTargets?: boolean;
  isCloudHosted?: () => boolean;
  storageBaseDir?: string;
}

export function registerExistingHardwareHttpRoutes(
  app: express.Express,
  options: RegisterExistingHardwareHttpOptions
): { configStore: ExistingHardwareConfigStore } {
  const configStore = new ExistingHardwareConfigStore(options.storageBaseDir);
  const isCloud = options.isCloudHosted || isRemoteCloudForPrivateLan;
  const allowLoopback =
    options.allowLoopbackTargets ??
    (process.env.EDENS_ALLOW_LOOPBACK_CONTROLLER === '1' ||
      process.env.EDENS_ALLOW_LOOPBACK_CAMERA === '1' ||
      !isRemoteCloudForPrivateLan());

  /**
   * Synchronizes saved controller or camera configuration (and discovered sensor capabilities)
   * into the authenticated SQLite `PlatformDatabase` (`devices.label`, `devices.capabilities_json`,
   * `devices.firmware_version`, and `device_capabilities`) without storing any secrets in browser storage.
   */
  function syncConfigToDatabase(params: {
    greenhouseId: string | null;
    deviceType: 'esp32_controller' | 'esp32_cam';
    label: string;
    connectionSettings: Record<string, unknown>;
    firmwareVersion?: string | null;
    discoveredSensors?: DiscoveredSensorCapability[];
  }): { deviceId: string | null; enrolledFirmwareVersion: string | null } {
    if (!params.greenhouseId || !options.platformDb.isInitialized()) {
      return { deviceId: null, enrolledFirmwareVersion: null };
    }
    try {
      const driver = options.platformDb.getDriver();
      const row = driver.queryOne<{
        id: string;
        capabilities_json: string;
        firmware_version: string | null;
      }>(
        `SELECT id, capabilities_json, firmware_version
         FROM devices
         WHERE greenhouse_id = ? AND device_type = ? AND replaced_by_device_id IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [params.greenhouseId, params.deviceType]
      );
      if (!row) {
        return { deviceId: null, enrolledFirmwareVersion: null };
      }

      const existingCaps = safeJsonParseObject(row.capabilities_json);
      const mergedCaps = {
        ...existingCaps,
        connectionSettings: params.connectionSettings
      };
      const nowIso = new Date().toISOString();
      const nextFw =
        params.firmwareVersion && params.firmwareVersion.trim()
          ? params.firmwareVersion.trim().slice(0, 64)
          : row.firmware_version;

      driver.run(
        `UPDATE devices
         SET label = ?, capabilities_json = ?, firmware_version = ?, updated_at = ?
         WHERE id = ?`,
        [params.label, JSON.stringify(mergedCaps), nextFw, nowIso, row.id]
      );

      if (
        params.deviceType === 'esp32_controller' &&
        Array.isArray(params.discoveredSensors) &&
        params.discoveredSensors.length > 0
      ) {
        for (const sensor of params.discoveredSensors) {
          const existingCapRow = driver.queryOne<{ id: string }>(
            `SELECT id FROM device_capabilities
             WHERE device_id = ? AND capability_kind = 'sensor' AND channel_key = ?`,
            [row.id, sensor.key]
          );
          const metaJson = JSON.stringify({
            validity: sensor.validity,
            connected: sensor.connected,
            lastObservedValue: sensor.value,
            lastObservedAt: sensor.timestamp
          });
          if (existingCapRow) {
            driver.run(
              `UPDATE device_capabilities
               SET display_label = ?, unit = ?, is_enabled = ?, calibration_json = ?, updated_at = ?
               WHERE id = ?`,
              [sensor.label, sensor.unit, sensor.connected ? 1 : 0, metaJson, nowIso, existingCapRow.id]
            );
          } else {
            driver.run(
              `INSERT INTO device_capabilities (
                 id, device_id, greenhouse_id, capability_kind, channel_key,
                 display_label, unit, calibration_json, is_enabled, updated_at
               ) VALUES (?, ?, ?, 'sensor', ?, ?, ?, ?, ?, ?)`,
              [
                generateSecureId('cap', 6),
                row.id,
                params.greenhouseId,
                sensor.key,
                sensor.label,
                sensor.unit,
                metaJson,
                sensor.connected ? 1 : 0,
                nowIso
              ]
            );
          }
        }
      }

      return { deviceId: row.id, enrolledFirmwareVersion: nextFw };
    } catch (err: any) {
      console.warn('[ExistingHardwareHttp DB Sync Warning]:', err?.message || err);
      return { deviceId: null, enrolledFirmwareVersion: null };
    }
  }

  function loadPersistedScopeWithDbFallback(greenhouseId: string | null): {
    camera: SavedExistingCameraConfig | null;
    controller: SavedExistingControllerConfig | null;
    enrolledControllerRow: {
      id: string;
      label: string;
      firmwareVersion: string | null;
      lastSeenAt: string | null;
      lastTelemetryAt: string | null;
    } | null;
    enrolledCameraRow: {
      id: string;
      label: string;
      firmwareVersion: string | null;
      lastSeenAt: string | null;
      lastUploadAt: string | null;
    } | null;
  } {
    const diskScope = configStore.getScope(greenhouseId);
    let camera = diskScope.camera;
    let controller = diskScope.controller;
    let enrolledControllerRow: {
      id: string;
      label: string;
      firmwareVersion: string | null;
      lastSeenAt: string | null;
      lastTelemetryAt: string | null;
    } | null = null;
    let enrolledCameraRow: {
      id: string;
      label: string;
      firmwareVersion: string | null;
      lastSeenAt: string | null;
      lastUploadAt: string | null;
    } | null = null;

    if (greenhouseId && options.platformDb.isInitialized()) {
      try {
        const driver = options.platformDb.getDriver();
        const rows = driver.queryAll<{
          id: string;
          device_type: string;
          label: string;
          firmware_version: string | null;
          last_seen_at: string | null;
          last_telemetry_at: string | null;
          last_upload_at: string | null;
          capabilities_json: string;
        }>(
          `SELECT id, device_type, label, firmware_version, last_seen_at, last_telemetry_at, last_upload_at, capabilities_json
           FROM devices
           WHERE greenhouse_id = ? AND replaced_by_device_id IS NULL
           ORDER BY created_at DESC`,
          [greenhouseId]
        );

        for (const r of rows) {
          const caps = safeJsonParseObject(r.capabilities_json);
          const dbConn =
            caps.connectionSettings && typeof caps.connectionSettings === 'object'
              ? (caps.connectionSettings as Record<string, any>)
              : null;

          if (r.device_type === 'esp32_controller' && !enrolledControllerRow) {
            enrolledControllerRow = {
              id: r.id,
              label: r.label,
              firmwareVersion: r.firmware_version,
              lastSeenAt: r.last_seen_at,
              lastTelemetryAt: r.last_telemetry_at
            };
            if (!controller && dbConn) {
              controller = {
                controllerName: String(dbConn.controllerName || r.label || 'Greenhouse ESP32 Controller'),
                host: String(dbConn.host || ''),
                port: Number(dbConn.port || 80),
                baseUrl: String(dbConn.baseUrl || ''),
                statusUrl: String(dbConn.statusUrl || ''),
                telemetryUrl: String(dbConn.telemetryUrl || ''),
                connectionMethod: dbConn.connectionMethod === 'CLOUD' ? 'CLOUD' : 'LOCAL',
                disconnectedByUser: Boolean(dbConn.disconnectedByUser),
                firmwareVersion: r.firmware_version || (dbConn.firmwareVersion ? String(dbConn.firmwareVersion) : null),
                lastHeartbeatAt: r.last_seen_at || null,
                lastTestedAt: dbConn.lastTestedAt ? String(dbConn.lastTestedAt) : null,
                lastSuccessfulConnAt: dbConn.lastSuccessfulConnAt ? String(dbConn.lastSuccessfulConnAt) : null,
                lastState: (dbConn.lastState as ExistingHardwareConnectionState) || 'OFFLINE',
                lastProvenance: 'OFFLINE',
                firmwareSupportSummary: dbConn.firmwareSupportSummary ? String(dbConn.firmwareSupportSummary) : null
              };
            }
          } else if (r.device_type === 'esp32_cam' && !enrolledCameraRow) {
            enrolledCameraRow = {
              id: r.id,
              label: r.label,
              firmwareVersion: r.firmware_version,
              lastSeenAt: r.last_seen_at,
              lastUploadAt: r.last_upload_at
            };
            if (!camera && dbConn) {
              camera = {
                cameraName: String(dbConn.cameraName || r.label || 'Greenhouse ESP32-CAM'),
                cameraIp: String(dbConn.cameraIp || '10.87.237.36'),
                streamUrl: String(dbConn.streamUrl || ''),
                photoUrl: String(dbConn.photoUrl || ''),
                statusUrl: String(dbConn.statusUrl || ''),
                connectionMethod: dbConn.connectionMethod === 'CLOUD' ? 'CLOUD' : 'LOCAL',
                disconnectedByUser: Boolean(dbConn.disconnectedByUser),
                firmwareVersion: r.firmware_version || (dbConn.firmwareVersion ? String(dbConn.firmwareVersion) : null),
                lastTestedAt: dbConn.lastTestedAt ? String(dbConn.lastTestedAt) : null,
                lastSuccessfulConnAt: dbConn.lastSuccessfulConnAt ? String(dbConn.lastSuccessfulConnAt) : null,
                lastFrameId: dbConn.lastFrameId ? String(dbConn.lastFrameId) : null,
                lastState: (dbConn.lastState as ExistingHardwareConnectionState) || 'OFFLINE'
              };
            }
          }
        }
      } catch {
        // Ignore transient SQLite read error
      }
    }

    return {
      camera,
      controller,
      enrolledControllerRow,
      enrolledCameraRow
    };
  }

  function resolveScopeAccess(
    req: express.Request,
    requireWritePermission: boolean
  ):
    | {
        ok: true;
        greenhouseId: string | null;
        targetCameraStore: CameraImageStore;
        user: AuthenticatedUser | null;
      }
    | {
        ok: false;
        statusCode: number;
        errorCode: string;
        message: string;
      } {
    const rawGhId = String(req.body?.greenhouseId || req.query?.greenhouseId || '').trim();
    const user = options.requireAuthenticatedUser(req);

    if (requireWritePermission && !user) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: 'UNAUTHENTICATED',
        message: 'Sign in required to configure, test, or disconnect greenhouse hardware.'
      };
    }

    if (user?.isGuest && requireWritePermission) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'GUEST_HARDWARE_CONTROL_FORBIDDEN',
        message:
          'Guest accounts operate in read-only / practice mode and cannot modify physical hardware connection endpoints.'
      };
    }

    if (!rawGhId) {
      return {
        ok: true,
        greenhouseId: null,
        targetCameraStore: options.globalCameraStore,
        user
      };
    }

    if (!user) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: 'UNAUTHENTICATED',
        message: 'Sign in required to access or test greenhouse hardware connections.'
      };
    }

    const gh = options.platformDb.getGreenhouseForUser(rawGhId, user.id);
    if (!gh) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'FORBIDDEN_GREENHOUSE',
        message: 'You do not have permission to access this greenhouse.'
      };
    }

    if (requireWritePermission) {
      const role = options.platformDb.getMemberRole(gh.id, user.id);
      if (role !== 'owner' && role !== 'operator') {
        return {
          ok: false,
          statusCode: 403,
          errorCode: 'FORBIDDEN_ROLE',
          message: 'Only greenhouse owners or operators may configure or test hardware connections.'
        };
      }
    }

    return {
      ok: true,
      greenhouseId: gh.id,
      targetCameraStore: options.cameraRegistry.getStore(gh.id),
      user
    };
  }

  /**
   * GET /api/hardware-http/state
   * Read-only state summary for Settings > Hardware Connections:
   * - Monitoring Mode status
   * - Dedicated ESP32 CONTROLLER live status card + dynamically discovered sensors
   * - Dedicated ESP32-CAM live status card
   * - Persisted controller & camera configurations (secrets never stored or exposed)
   */
  app.get('/api/hardware-http/state', (req, res) => {
    const scope = resolveScopeAccess(req, false);
    if ('errorCode' in scope) {
      return res.status(scope.statusCode).json({
        success: false,
        error: scope.errorCode,
        message: scope.message
      });
    }

    const loaded = loadPersistedScopeWithDbFallback(scope.greenhouseId);
    const persistedCam = loaded.camera;
    const persistedCtrl = loaded.controller;
    const latestCam = scope.targetCameraStore.getLatest();
    const cloudHosted = isCloud();

    const ctrlSourceLabel = persistedCtrl?.controllerName
      ? loaded.enrolledControllerRow
        ? `${persistedCtrl.controllerName} (${loaded.enrolledControllerRow.id})`
        : persistedCtrl.controllerName
      : loaded.enrolledControllerRow
        ? `${loaded.enrolledControllerRow.label} (${loaded.enrolledControllerRow.id})`
        : 'Greenhouse ESP32 Controller';

    const camSourceLabel = persistedCam?.cameraName
      ? loaded.enrolledCameraRow
        ? `${persistedCam.cameraName} (${loaded.enrolledCameraRow.id})`
        : persistedCam.cameraName
      : loaded.enrolledCameraRow
        ? `${loaded.enrolledCameraRow.label} (${loaded.enrolledCameraRow.id})`
        : 'Greenhouse ESP32-CAM';

    let controllerTelemetry: {
      provenance: ControllerTelemetryProvenance;
      dataCategory: HardwareDataCategory;
      timestamp: string | null;
      ageSeconds: number | null;
      readings: Record<string, unknown> | null;
      sensorHealth: Record<string, unknown> | null;
      firmwareVersion: string | null;
      lastHeartbeatAt: string | null;
      sourceMechanism: 'CLOUD_PUSH_UPLOAD' | 'LOCAL_HTTP_STATUS' | 'NONE';
    } = {
      provenance: 'OFFLINE',
      dataCategory: 'OFFLINE',
      timestamp: null,
      ageSeconds: null,
      readings: null,
      sensorHealth: null,
      firmwareVersion:
        persistedCtrl?.firmwareVersion || loaded.enrolledControllerRow?.firmwareVersion || null,
      lastHeartbeatAt:
        persistedCtrl?.lastHeartbeatAt || loaded.enrolledControllerRow?.lastSeenAt || null,
      sourceMechanism: 'NONE'
    };

    const ctrlDisconnected = Boolean(persistedCtrl?.disconnectedByUser);

    if (!ctrlDisconnected && scope.greenhouseId && options.platformDb.isInitialized()) {
      const ghTel = options.platformDb.getLatestTelemetryForGreenhouse(scope.greenhouseId);
      if (ghTel.dataSource === 'REAL_HARDWARE') {
        controllerTelemetry = {
          provenance: 'REAL_HARDWARE',
          dataCategory: 'REAL_HARDWARE_DATA',
          timestamp: ghTel.timestamp,
          ageSeconds: ghTel.ageSeconds,
          readings: ghTel.readings,
          sensorHealth: ghTel.sensorHealth,
          firmwareVersion:
            (ghTel.deviceHealth?.firmwareVersion as string | undefined) ||
            loaded.enrolledControllerRow?.firmwareVersion ||
            persistedCtrl?.firmwareVersion ||
            null,
          lastHeartbeatAt:
            loaded.enrolledControllerRow?.lastSeenAt || ghTel.receivedAt || ghTel.timestamp,
          sourceMechanism: 'CLOUD_PUSH_UPLOAD'
        };
      } else if (ghTel.dataSource === 'CACHED' || ghTel.dataSource === 'STALE') {
        controllerTelemetry = {
          provenance: 'STALE',
          dataCategory: 'STALE_DATA',
          timestamp: ghTel.timestamp,
          ageSeconds: ghTel.ageSeconds,
          readings: ghTel.readings,
          sensorHealth: ghTel.sensorHealth,
          firmwareVersion:
            (ghTel.deviceHealth?.firmwareVersion as string | undefined) ||
            loaded.enrolledControllerRow?.firmwareVersion ||
            persistedCtrl?.firmwareVersion ||
            null,
          lastHeartbeatAt:
            loaded.enrolledControllerRow?.lastSeenAt || ghTel.receivedAt || ghTel.timestamp,
          sourceMechanism: 'CLOUD_PUSH_UPLOAD'
        };
      }
    } else if (!ctrlDisconnected && options.getLatestGlobalTelemetry) {
      const globTel = options.getLatestGlobalTelemetry();
      if (globTel.exists && globTel.readings) {
        const prov: ControllerTelemetryProvenance =
          globTel.dataSource === 'REAL_HARDWARE'
            ? 'REAL_HARDWARE'
            : globTel.dataSource === 'SIMULATED'
              ? 'SIMULATED'
              : 'STALE';
        const cat: HardwareDataCategory =
          prov === 'REAL_HARDWARE'
            ? 'REAL_HARDWARE_DATA'
            : prov === 'SIMULATED'
              ? 'SIMULATED_DATA'
              : 'STALE_DATA';
        controllerTelemetry = {
          provenance: prov,
          dataCategory: cat,
          timestamp: globTel.timestamp,
          ageSeconds: globTel.ageSeconds,
          readings: globTel.readings,
          sensorHealth: null,
          firmwareVersion: persistedCtrl?.firmwareVersion || null,
          lastHeartbeatAt: globTel.timestamp,
          sourceMechanism: 'CLOUD_PUSH_UPLOAD'
        };
      }
    }

    // Fallback to cached local HTTP controller poll if not disconnected and no newer cloud push exists
    if (
      !ctrlDisconnected &&
      controllerTelemetry.provenance === 'OFFLINE' &&
      persistedCtrl?.cachedReadings &&
      persistedCtrl?.cachedReadingsAt
    ) {
      const ageSec = Math.max(
        0,
        Math.round((Date.now() - new Date(persistedCtrl.cachedReadingsAt).getTime()) / 1000)
      );
      if (ageSec <= 90) {
        controllerTelemetry = {
          provenance: 'REAL_HARDWARE',
          dataCategory: 'REAL_HARDWARE_DATA',
          timestamp: persistedCtrl.cachedReadingsAt,
          ageSeconds: ageSec,
          readings: persistedCtrl.cachedReadings,
          sensorHealth: persistedCtrl.cachedSensorHealth || null,
          firmwareVersion: persistedCtrl.firmwareVersion || null,
          lastHeartbeatAt: persistedCtrl.lastHeartbeatAt || persistedCtrl.cachedReadingsAt,
          sourceMechanism: 'LOCAL_HTTP_STATUS'
        };
      } else if (ageSec <= 3600) {
        controllerTelemetry = {
          provenance: 'STALE',
          dataCategory: 'STALE_DATA',
          timestamp: persistedCtrl.cachedReadingsAt,
          ageSeconds: ageSec,
          readings: persistedCtrl.cachedReadings,
          sensorHealth: persistedCtrl.cachedSensorHealth || null,
          firmwareVersion: persistedCtrl.firmwareVersion || null,
          lastHeartbeatAt: persistedCtrl.lastHeartbeatAt || persistedCtrl.cachedReadingsAt,
          sourceMechanism: 'LOCAL_HTTP_STATUS'
        };
      }
    }

    const discoveredSensors =
      controllerTelemetry.readings && controllerTelemetry.provenance !== 'OFFLINE'
        ? discoverSensorCapabilities({
            readings: controllerTelemetry.readings,
            sensorHealth: controllerTelemetry.sensorHealth,
            timestampIso: controllerTelemetry.timestamp,
            sourceDevice: ctrlSourceLabel,
            isStale: controllerTelemetry.provenance === 'STALE'
          })
        : [];

    const ctrlConnStatus: ExistingHardwareConnectionState = ctrlDisconnected
      ? 'OFFLINE'
      : controllerTelemetry.provenance === 'REAL_HARDWARE'
        ? 'CONNECTED'
        : persistedCtrl?.lastState === 'CONNECTION_BLOCKED'
          ? 'CONNECTION_BLOCKED'
          : persistedCtrl?.lastState === 'INVALID_ADDRESS'
            ? 'INVALID_ADDRESS'
            : 'OFFLINE';

    const camDisconnected = Boolean(persistedCam?.disconnectedByUser);
    const hasFreshCam = Boolean(!camDisconnected && latestCam && latestCam.state.isFresh);
    const hasAnyCam = Boolean(!camDisconnected && latestCam);

    const camDataCategory: HardwareDataCategory = hasFreshCam
      ? 'REAL_HARDWARE_DATA'
      : hasAnyCam
        ? 'STALE_DATA'
        : 'OFFLINE';

    const camConnStatus: ExistingHardwareConnectionState = camDisconnected
      ? 'OFFLINE'
      : hasFreshCam
        ? 'IMAGE_RECEIVED'
        : persistedCam?.lastState === 'CONNECTION_BLOCKED'
          ? 'CONNECTION_BLOCKED'
          : persistedCam?.lastState === 'INVALID_ADDRESS'
            ? 'INVALID_ADDRESS'
            : 'OFFLINE';

    const configuredStreamUrl = persistedCam?.streamUrl || '';
    let streamStatus:
      | 'LIVE_STREAM_READY'
      | 'SNAPSHOT_ONLY_NO_STREAM'
      | 'STREAM_BLOCKED_CLOUD_OR_HTTPS'
      | 'OFFLINE' = 'OFFLINE';
    let streamStatusLabel = 'Offline — no active camera stream';

    if (!camDisconnected && configuredStreamUrl) {
      if (cloudHosted) {
        streamStatus = 'STREAM_BLOCKED_CLOUD_OR_HTTPS';
        streamStatusLabel =
          'Stream blocked from cloud/HTTPS — private LAN MJPEG requires local gateway or snapshot upload';
      } else if (hasFreshCam || persistedCam?.lastState === 'IMAGE_RECEIVED') {
        streamStatus = 'LIVE_STREAM_READY';
        streamStatusLabel = 'Local MJPEG stream proxy available (not active until Preview clicked)';
      } else {
        streamStatus = 'OFFLINE';
        streamStatusLabel = 'Stream configured — verify connection first';
      }
    } else if (!camDisconnected && hasAnyCam) {
      streamStatus = 'SNAPSHOT_ONLY_NO_STREAM';
      streamStatusLabel = 'Uploaded JPEG snapshot only — not a live video stream';
    }

    // Only expose saved private LAN URLs to authenticated non-guest sessions or local gateway mode
    const canViewSavedUrls = Boolean(scope.user && !scope.user.isGuest) || !cloudHosted;

    const publicCamUrl =
      latestCam && scope.greenhouseId
        ? `/api/greenhouses/${encodeURIComponent(scope.greenhouseId)}/camera/latest.jpg?frame=${encodeURIComponent(latestCam.frame.id)}`
        : latestCam?.frame.url || null;

    return res.status(200).json({
      success: true,
      monitoringMode: {
        active: true,
        physicalControlDisabled: true,
        banner: MONITORING_MODE_BANNER
      },
      environment: {
        cloudHosted,
        localDirectHttpSupported: !cloudHosted,
        dualArchitectureSupported: true,
        browserMixedContentNote:
          'Modern browsers on HTTPS pages block direct plain-HTTP requests to private LAN IPs (10.x / 192.168.x) via Mixed Content & Private Network Access policies. Never port-forward unauthenticated ESP32 boards to the public internet; use Local Gateway mode or authenticated outbound HTTPS uploads.',
        localRelayCommandHint:
          'CAMERA_PHOTO_URL="http://10.87.237.36/photo" CAMERA_UPLOAD_KEY="<X-Camera-Key>" npm run camera:relay',
        cloudCameraUploadEndpoint: '/api/camera/upload',
        cloudTelemetryUploadEndpoint: '/api/telemetry/upload'
      },
      defaultCameraExamples: canViewSavedUrls
        ? {
            cameraIp: '10.87.237.36',
            streamUrl: 'http://10.87.237.36:81/stream',
            photoUrl: 'http://10.87.237.36/photo',
            statusUrl: 'http://10.87.237.36/status'
          }
        : null,
      defaultControllerExamples: canViewSavedUrls
        ? {
            host: 'edens-esp32.local',
            port: 80,
            statusUrl: 'http://edens-esp32.local/status',
            telemetryUrl: 'http://edens-esp32.local/status'
          }
        : null,
      controllerStatusCard: {
        connectionStatus: ctrlConnStatus,
        dataCategory: controllerTelemetry.dataCategory,
        lastHeartbeatAt: controllerTelemetry.lastHeartbeatAt,
        lastTelemetryAt: controllerTelemetry.timestamp,
        ageSeconds: controllerTelemetry.ageSeconds,
        firmwareVersion: controllerTelemetry.firmwareVersion,
        sourceDeviceLabel: ctrlSourceLabel,
        connectionMethod: persistedCtrl?.connectionMethod || 'CLOUD',
        discoveredSensors,
        connectedSensorCount: discoveredSensors.filter((s) => s.connected).length
      },
      cameraStatusCard: {
        connectionStatus: camConnStatus,
        dataCategory: camDataCategory,
        lastImageReceivedAt: !camDisconnected && latestCam ? latestCam.frame.capturedAt : null,
        ageSeconds: !camDisconnected && latestCam ? latestCam.state.ageSeconds : null,
        streamStatus,
        streamStatusLabel,
        firmwareVersion:
          persistedCam?.firmwareVersion || loaded.enrolledCameraRow?.firmwareVersion || null,
        sourceDeviceLabel: camSourceLabel,
        connectionMethod: persistedCam?.connectionMethod || 'LOCAL'
      },
      savedCamera:
        canViewSavedUrls && persistedCam
          ? persistedCam
          : persistedCam
            ? {
                cameraName: persistedCam.cameraName,
                cameraIp: '',
                streamUrl: '',
                photoUrl: '',
                statusUrl: '',
                connectionMethod: persistedCam.connectionMethod || 'LOCAL',
                disconnectedByUser: Boolean(persistedCam.disconnectedByUser),
                firmwareVersion: persistedCam.firmwareVersion || null,
                lastTestedAt: persistedCam.lastTestedAt,
                lastSuccessfulConnAt: persistedCam.lastSuccessfulConnAt,
                lastFrameId: persistedCam.lastFrameId,
                lastState: persistedCam.lastState
              }
            : null,
      savedController:
        canViewSavedUrls && persistedCtrl
          ? {
              controllerName: persistedCtrl.controllerName,
              host: persistedCtrl.host || '',
              port: persistedCtrl.port || 80,
              baseUrl: persistedCtrl.baseUrl,
              statusUrl: persistedCtrl.statusUrl || '',
              telemetryUrl: persistedCtrl.telemetryUrl || '',
              connectionMethod: persistedCtrl.connectionMethod || 'LOCAL',
              disconnectedByUser: Boolean(persistedCtrl.disconnectedByUser),
              firmwareVersion: persistedCtrl.firmwareVersion || null,
              lastHeartbeatAt: persistedCtrl.lastHeartbeatAt || null,
              lastTestedAt: persistedCtrl.lastTestedAt,
              lastSuccessfulConnAt: persistedCtrl.lastSuccessfulConnAt,
              lastState: persistedCtrl.lastState,
              lastProvenance: persistedCtrl.lastProvenance,
              firmwareSupportSummary: persistedCtrl.firmwareSupportSummary
            }
          : null,
      latestCamera:
        !camDisconnected && latestCam
          ? {
              exists: true,
              id: latestCam.frame.id,
              url: publicCamUrl,
              capturedAt: latestCam.frame.capturedAt,
              timestamp: latestCam.frame.timestamp,
              ageSeconds: latestCam.state.ageSeconds,
              freshness: latestCam.state.freshness,
              isFresh: latestCam.state.isFresh,
              isStale: latestCam.state.isStale,
              sizeBytes: latestCam.frame.sizeBytes,
              sha256: latestCam.frame.sha256,
              acquisitionMethod: latestCam.frame.acquisitionMethod,
              imageOriginLabel: 'REAL_CAMERA_IMAGE'
            }
          : {
              exists: false,
              isFresh: false,
              isStale: true,
              imageOriginLabel: 'REAL_CAMERA_IMAGE'
            },
      latestController: {
        provenance: controllerTelemetry.provenance,
        dataCategory: controllerTelemetry.dataCategory,
        timestamp: controllerTelemetry.timestamp,
        ageSeconds: controllerTelemetry.ageSeconds,
        readings: controllerTelemetry.readings,
        discoveredSensors,
        sourceMechanism: controllerTelemetry.sourceMechanism
      }
    });
  });

  /**
   * POST /api/hardware-http/camera/save
   * Validates and persists ESP32-CAM configuration to SQLite + backend store.
   * NEVER marks the camera CONNECTED simply because its address was saved.
   */
  app.post('/api/hardware-http/camera/save', (req, res) => {
    const scope = resolveScopeAccess(req, true);
    if ('errorCode' in scope) {
      return res.status(scope.statusCode).json({
        success: false,
        connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
        error: scope.errorCode,
        message: scope.message
      });
    }

    const cameraName =
      String(req.body?.cameraName || 'Greenhouse ESP32-CAM').trim().slice(0, 80) ||
      'Greenhouse ESP32-CAM';
    const connectionMethod: HardwareConnectionMethod =
      String(req.body?.connectionMethod || 'LOCAL').toUpperCase() === 'CLOUD' ? 'CLOUD' : 'LOCAL';
    const rawCameraIp = typeof req.body?.cameraIp === 'string' ? req.body.cameraIp.trim() : '';
    const rawStreamUrl = typeof req.body?.streamUrl === 'string' ? req.body.streamUrl.trim() : '';
    const rawPhotoUrl = typeof req.body?.photoUrl === 'string' ? req.body.photoUrl.trim() : '';
    const rawStatusUrl = typeof req.body?.statusUrl === 'string' ? req.body.statusUrl.trim() : '';

    let validatedIp = '';
    if (rawCameraIp) {
      const hostCheck = validateHardwareHostAndPort(rawCameraIp, 80, {
        fieldName: 'Camera IP',
        allowLoopback
      });
      if ('errorCode' in hostCheck) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          error: hostCheck.errorCode,
          message: hostCheck.message
        });
      }
      validatedIp = hostCheck.hostname;
    }

    let normalizedPhotoUrl = '';
    if (rawPhotoUrl || connectionMethod === 'LOCAL') {
      const photoCheck = validateExistingHardwareEndpointUrl(
        rawPhotoUrl || (validatedIp ? `http://${validatedIp}/photo` : ''),
        { fieldName: 'Photo URL', allowLoopback }
      );
      if ('errorCode' in photoCheck) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          error: photoCheck.errorCode,
          message: photoCheck.message
        });
      }
      normalizedPhotoUrl = photoCheck.normalizedUrl;
      if (!validatedIp) validatedIp = photoCheck.hostname;
    }

    let normalizedStreamUrl = '';
    if (rawStreamUrl) {
      const streamCheck = validateExistingHardwareEndpointUrl(rawStreamUrl, {
        fieldName: 'Stream URL',
        allowLoopback
      });
      if ('errorCode' in streamCheck) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          error: streamCheck.errorCode,
          message: streamCheck.message
        });
      }
      normalizedStreamUrl = streamCheck.normalizedUrl;
    }

    let normalizedStatusUrl = '';
    if (rawStatusUrl) {
      const statusCheck = validateExistingHardwareEndpointUrl(rawStatusUrl, {
        fieldName: 'Status URL',
        allowLoopback
      });
      if ('errorCode' in statusCheck) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          error: statusCheck.errorCode,
          message: statusCheck.message
        });
      }
      normalizedStatusUrl = statusCheck.normalizedUrl;
    }

    const prevSaved = loadPersistedScopeWithDbFallback(scope.greenhouseId).camera;
    const urlsUnchanged =
      prevSaved &&
      prevSaved.photoUrl === normalizedPhotoUrl &&
      prevSaved.streamUrl === normalizedStreamUrl &&
      prevSaved.statusUrl === normalizedStatusUrl &&
      prevSaved.connectionMethod === connectionMethod;

    // Never mark a device CONNECTED simply because its address was saved!
    const nextState: ExistingHardwareConnectionState =
      urlsUnchanged && prevSaved?.lastState === 'IMAGE_RECEIVED' && !prevSaved.disconnectedByUser
        ? 'IMAGE_RECEIVED'
        : 'OFFLINE';

    const savedObj: SavedExistingCameraConfig = {
      cameraName,
      cameraIp: validatedIp,
      streamUrl: normalizedStreamUrl,
      photoUrl: normalizedPhotoUrl,
      statusUrl: normalizedStatusUrl,
      connectionMethod,
      disconnectedByUser: false,
      firmwareVersion: prevSaved?.firmwareVersion || null,
      lastTestedAt: urlsUnchanged ? prevSaved?.lastTestedAt || null : null,
      lastSuccessfulConnAt: urlsUnchanged ? prevSaved?.lastSuccessfulConnAt || null : null,
      lastFrameId: urlsUnchanged ? prevSaved?.lastFrameId || null : null,
      lastState: nextState
    };

    configStore.saveCamera(scope.greenhouseId, savedObj);
    syncConfigToDatabase({
      greenhouseId: scope.greenhouseId,
      deviceType: 'esp32_cam',
      label: cameraName,
      connectionSettings: savedObj as unknown as Record<string, unknown>,
      firmwareVersion: savedObj.firmwareVersion
    });

    return res.status(200).json({
      success: true,
      cameraConnected: false,
      connectionState: nextState,
      savedCamera: savedObj,
      message:
        nextState === 'IMAGE_RECEIVED'
          ? 'Camera configuration saved. Existing verified image remains available.'
          : 'Camera configuration saved (unverified). Click "Test Camera Connection" to verify status and retrieve a real JPEG.'
    });
  });

  /**
   * POST /api/hardware-http/camera/disconnect
   * Disconnects the active ESP32-CAM HTTP session and marks status OFFLINE.
   */
  app.post('/api/hardware-http/camera/disconnect', (req, res) => {
    const scope = resolveScopeAccess(req, true);
    if ('errorCode' in scope) {
      return res.status(scope.statusCode).json({
        success: false,
        error: scope.errorCode,
        message: scope.message
      });
    }

    const prevSaved = loadPersistedScopeWithDbFallback(scope.greenhouseId).camera;
    const nextSaved: SavedExistingCameraConfig = {
      cameraName: prevSaved?.cameraName || 'Greenhouse ESP32-CAM',
      cameraIp: prevSaved?.cameraIp || '10.87.237.36',
      streamUrl: prevSaved?.streamUrl || 'http://10.87.237.36:81/stream',
      photoUrl: prevSaved?.photoUrl || 'http://10.87.237.36/photo',
      statusUrl: prevSaved?.statusUrl || 'http://10.87.237.36/status',
      connectionMethod: prevSaved?.connectionMethod || 'LOCAL',
      disconnectedByUser: true,
      firmwareVersion: prevSaved?.firmwareVersion || null,
      lastTestedAt: prevSaved?.lastTestedAt || null,
      lastSuccessfulConnAt: prevSaved?.lastSuccessfulConnAt || null,
      lastFrameId: null,
      lastState: 'OFFLINE'
    };

    configStore.saveCamera(scope.greenhouseId, nextSaved);
    syncConfigToDatabase({
      greenhouseId: scope.greenhouseId,
      deviceType: 'esp32_cam',
      label: nextSaved.cameraName,
      connectionSettings: nextSaved as unknown as Record<string, unknown>
    });

    return res.status(200).json({
      success: true,
      connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
      cameraConnected: false,
      message: 'Camera disconnected. Stream preview and live polling stopped.'
    });
  });

  /**
   * POST /api/hardware-http/camera/test
   * Validates supplied URLs, tests connection through supported mechanism:
   * - If Connection Method === 'CLOUD': checks whether authenticated outbound JPEG uploads
   *   have arrived in the backend store (never falsely claiming connected if none/stale).
   * - If Connection Method === 'LOCAL': verifies status endpoint, retrieves JPEG from photoUrl,
   *   validates SOI..EOI bytes, checks stream availability, and stores verified frame.
   */
  app.post('/api/hardware-http/camera/test', async (req, res) => {
    const scope = resolveScopeAccess(req, true);
    if ('errorCode' in scope) {
      return res.status(scope.statusCode).json({
        success: false,
        connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
        error: scope.errorCode,
        message: scope.message
      });
    }

    const cameraName =
      String(req.body?.cameraName || 'Greenhouse ESP32-CAM').trim().slice(0, 80) ||
      'Greenhouse ESP32-CAM';
    const connectionMethod: HardwareConnectionMethod =
      String(req.body?.connectionMethod || 'LOCAL').toUpperCase() === 'CLOUD' ? 'CLOUD' : 'LOCAL';
    const rawCameraIp = typeof req.body?.cameraIp === 'string' ? req.body.cameraIp.trim() : '';
    const rawStreamUrl = typeof req.body?.streamUrl === 'string' ? req.body.streamUrl.trim() : '';
    const rawPhotoUrl = typeof req.body?.photoUrl === 'string' ? req.body.photoUrl.trim() : '';
    const rawStatusUrl = typeof req.body?.statusUrl === 'string' ? req.body.statusUrl.trim() : '';

    const nowIso = new Date().toISOString();
    const loadedScope = loadPersistedScopeWithDbFallback(scope.greenhouseId);
    const prevSaved = loadedScope.camera;

    // Cloud Upload Mode Check: verify actual authenticated JPEG uploads received by backend
    if (connectionMethod === 'CLOUD' && !rawPhotoUrl) {
      const latest = scope.targetCameraStore.getLatest();
      if (latest && latest.state.isFresh) {
        const publicUrl = scope.greenhouseId
          ? `/api/greenhouses/${encodeURIComponent(scope.greenhouseId)}/camera/latest.jpg?frame=${encodeURIComponent(latest.frame.id)}`
          : latest.frame.url;

        const savedCam: SavedExistingCameraConfig = {
          cameraName,
          cameraIp: rawCameraIp,
          streamUrl: '',
          photoUrl: '',
          statusUrl: '',
          connectionMethod: 'CLOUD',
          disconnectedByUser: false,
          firmwareVersion:
            loadedScope.enrolledCameraRow?.firmwareVersion || prevSaved?.firmwareVersion || null,
          lastTestedAt: nowIso,
          lastSuccessfulConnAt: latest.frame.timestamp,
          lastFrameId: latest.frame.id,
          lastState: 'IMAGE_RECEIVED'
        };
        configStore.saveCamera(scope.greenhouseId, savedCam);
        syncConfigToDatabase({
          greenhouseId: scope.greenhouseId,
          deviceType: 'esp32_cam',
          label: cameraName,
          connectionSettings: savedCam as unknown as Record<string, unknown>,
          firmwareVersion: savedCam.firmwareVersion
        });

        return res.status(200).json({
          success: true,
          connectionState: 'IMAGE_RECEIVED' as ExistingHardwareConnectionState,
          cameraConnected: true,
          cameraName,
          message: `Cloud upload verified: fresh JPEG (${Math.max(1, Math.round(latest.frame.sizeBytes / 1024))} KB) received ${latest.state.ageSeconds}s ago.`,
          lastSuccessfulConnAt: latest.frame.timestamp,
          frame: {
            id: latest.frame.id,
            url: publicUrl,
            base64DataUri: latest.frame.base64DataUri,
            sizeBytes: latest.frame.sizeBytes,
            sha256: latest.frame.sha256,
            mimeType: latest.frame.mimeType,
            capturedAt: latest.frame.capturedAt,
            timestamp: latest.frame.timestamp,
            acquisitionMethod: latest.frame.acquisitionMethod,
            imageOriginLabel: 'REAL_CAMERA_IMAGE'
          }
        });
      }

      const staleNote = latest
        ? `Latest cloud-uploaded camera JPEG is stale (${latest.state.ageSeconds}s old; >90s threshold). Ensure ESP32-CAM or Local Relay Bridge is actively uploading to POST /api/camera/upload.`
        : 'No cloud-uploaded JPEG has arrived at POST /api/camera/upload yet. Ensure ESP32-CAM or Local Relay Bridge is configured with a valid X-Camera-Key.';

      return res.status(200).json({
        success: false,
        connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
        cameraConnected: false,
        error: latest ? 'STALE_CLOUD_CAMERA_IMAGE' : 'NO_CLOUD_CAMERA_IMAGE',
        message: staleNote,
        lastSuccessfulConnAt: latest?.frame.timestamp || prevSaved?.lastSuccessfulConnAt || null
      });
    }

    // 1. Validate IP & URLs strictly (never fetch unvalidated targets)
    let validatedIp = '';
    if (rawCameraIp) {
      const ipValidation = validateHardwareHostAndPort(rawCameraIp, 80, {
        fieldName: 'Camera IP',
        allowLoopback
      });
      if ('errorCode' in ipValidation) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          error: ipValidation.errorCode,
          message: ipValidation.message
        });
      }
      validatedIp = ipValidation.hostname;
    }

    const photoValidation = validateExistingHardwareEndpointUrl(
      rawPhotoUrl || (validatedIp ? `http://${validatedIp}/photo` : ''),
      {
        fieldName: 'Camera photo URL',
        allowLoopback
      }
    );
    if ('errorCode' in photoValidation) {
      return res.status(400).json({
        success: false,
        connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
        error: photoValidation.errorCode,
        message: photoValidation.message
      });
    }
    if (!validatedIp) validatedIp = photoValidation.hostname;

    let streamValidation: ValidatedHardwareEndpointUrl | null = null;
    if (rawStreamUrl) {
      const sv = validateExistingHardwareEndpointUrl(rawStreamUrl, {
        fieldName: 'Camera stream URL',
        allowLoopback
      });
      if ('errorCode' in sv) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          error: sv.errorCode,
          message: sv.message
        });
      }
      streamValidation = sv;
    }

    let statusValidation: ValidatedHardwareEndpointUrl | null = null;
    if (rawStatusUrl) {
      const stv = validateExistingHardwareEndpointUrl(rawStatusUrl, {
        fieldName: 'Camera status URL',
        allowLoopback
      });
      if ('errorCode' in stv) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          error: stv.errorCode,
          message: stv.message
        });
      }
      statusValidation = stv;
    }

    // 2. Check Cloud-to-Private-LAN Network Boundary Honestly
    const cloudHosted = isCloud();
    if (cloudHosted && photoValidation.isPrivateLanOrMdns) {
      const blockedCam: SavedExistingCameraConfig = {
        cameraName,
        cameraIp: validatedIp,
        streamUrl: streamValidation?.normalizedUrl || '',
        photoUrl: photoValidation.normalizedUrl,
        statusUrl: statusValidation?.normalizedUrl || '',
        connectionMethod,
        disconnectedByUser: false,
        firmwareVersion: prevSaved?.firmwareVersion || null,
        lastTestedAt: nowIso,
        lastSuccessfulConnAt: prevSaved?.lastSuccessfulConnAt || null,
        lastFrameId: prevSaved?.lastFrameId || null,
        lastState: 'CONNECTION_BLOCKED'
      };
      configStore.saveCamera(scope.greenhouseId, blockedCam);
      syncConfigToDatabase({
        greenhouseId: scope.greenhouseId,
        deviceType: 'esp32_cam',
        label: cameraName,
        connectionSettings: blockedCam as unknown as Record<string, unknown>
      });

      return res.status(200).json({
        success: false,
        connectionState: 'CONNECTION_BLOCKED' as ExistingHardwareConnectionState,
        cameraConnected: false,
        error: 'PRIVATE_LAN_UNREACHABLE_FROM_CLOUD',
        message:
          `This EDENS AI backend is running in the cloud and cannot route directly to private Wi-Fi LAN address "${photoValidation.hostname}". Browsers on HTTPS also block plain HTTP private-network requests (Mixed Content / Private Network Access). Never expose unauthenticated ESP32 devices directly to the public internet; use the Local Bridge or Outbound Cloud Upload below.`,
        remediationOptions: [
          {
            id: 'local_bridge',
            title: 'Run Local EDENS Camera Bridge (Zero Firmware Changes)',
            description:
              'Run the included lightweight bridge on any laptop or Raspberry Pi connected to the same Wi-Fi as your ESP32-CAM. It pulls from your camera /photo URL and uploads over authenticated HTTPS to EDENS AI.',
            command: `CAMERA_PHOTO_URL="${photoValidation.normalizedUrl}"${statusValidation ? ` CAMERA_STATUS_URL="${statusValidation.normalizedUrl}"` : ''} CAMERA_UPLOAD_KEY="<YOUR_X_CAMERA_KEY>" npm run camera:relay`
          },
          {
            id: 'local_server',
            title: 'Run EDENS AI Locally on the Same Greenhouse Wi-Fi',
            description:
              'Start EDENS AI with "npm run dev" or "npm start" on a machine on the same 2.4 GHz network so the local gateway can pull /status, /photo, and :81/stream directly.'
          },
          {
            id: 'esp32_cloud_push',
            title: 'Outbound ESP32-CAM Cloud Upload',
            description:
              'Configure firmware/esp32_cam_cloud_sync/edens_cloud_upload.h to POST JPEG frames directly to /api/camera/upload with X-Camera-Key.'
          }
        ],
        lastSuccessfulConnAt: prevSaved?.lastSuccessfulConnAt || null
      });
    }

    // 3. Probe Status Endpoint (Read-Only GET) if supplied
    const statusProbe: {
      attempted: boolean;
      reachable: boolean;
      ok: boolean;
      httpStatus: number | null;
      latencyMs: number | null;
      firmwareVersion: string | null;
      sensorSummary: Record<string, unknown> | null;
      error: string | null;
    } = {
      attempted: Boolean(statusValidation),
      reachable: false,
      ok: false,
      httpStatus: null,
      latencyMs: null,
      firmwareVersion: null,
      sensorSummary: null,
      error: null
    };

    if (statusValidation) {
      const t0 = Date.now();
      try {
        const stRes = await fetchWithTimeout(
          statusValidation.normalizedUrl,
          {
            method: 'GET',
            headers: { Accept: 'application/json, text/plain, */*' }
          },
          3500
        );
        statusProbe.latencyMs = Date.now() - t0;
        statusProbe.httpStatus = stRes.status;
        if (stRes.ok) {
          statusProbe.reachable = true;
          statusProbe.ok = true;
          const text = await stRes.text();
          try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object') {
              const obj = parsed as Record<string, unknown>;
              statusProbe.sensorSummary = obj;
              if (typeof obj.firmwareVersion === 'string') {
                statusProbe.firmwareVersion = obj.firmwareVersion;
              } else if (typeof obj.version === 'string') {
                statusProbe.firmwareVersion = obj.version;
              } else if (typeof obj.camera === 'string') {
                statusProbe.firmwareVersion = obj.camera;
              }
            } else {
              statusProbe.sensorSummary = { raw: text.slice(0, 120) };
            }
          } catch {
            statusProbe.sensorSummary = { statusText: text.slice(0, 120) };
          }
        } else {
          statusProbe.error = `Status endpoint returned HTTP ${stRes.status}`;
        }
      } catch (err: any) {
        statusProbe.latencyMs = Date.now() - t0;
        statusProbe.error =
          err?.name === 'AbortError'
            ? 'Status endpoint timed out after 3500ms'
            : redactSecretsFromText(err?.message || 'Status endpoint unreachable');
      }
    }

    // 4. Probe Stream Endpoint Header Availability (Non-blocking 1500ms check when supplied)
    let streamVerified = false;
    let streamError: string | null = null;
    if (streamValidation) {
      const streamAbort = new AbortController();
      const stTimer = setTimeout(() => streamAbort.abort(), 1800);
      try {
        const sRes = await fetch(streamValidation.normalizedUrl, { signal: streamAbort.signal });
        clearTimeout(stTimer);
        if (sRes.ok) {
          streamVerified = true;
        } else {
          streamError = `Stream endpoint returned HTTP ${sRes.status}`;
        }
        streamAbort.abort();
      } catch (err: any) {
        clearTimeout(stTimer);
        streamError =
          err?.name === 'AbortError'
            ? 'Stream endpoint did not respond within 1800ms'
            : redactSecretsFromText(err?.message || 'Stream unreachable');
      }
    }

    // 5. Retrieve Real Snapshot from Photo Endpoint & Validate Genuine JPEG Bytes
    const photoStartMs = Date.now();
    try {
      const photoRes = await fetchWithTimeout(
        photoValidation.normalizedUrl,
        {
          method: 'GET',
          headers: { Accept: 'image/jpeg,*/*' }
        },
        6000
      );
      const photoLatencyMs = Date.now() - photoStartMs;

      if (!photoRes.ok) {
        const failCam: SavedExistingCameraConfig = {
          cameraName,
          cameraIp: validatedIp,
          streamUrl: streamValidation?.normalizedUrl || '',
          photoUrl: photoValidation.normalizedUrl,
          statusUrl: statusValidation?.normalizedUrl || '',
          connectionMethod,
          disconnectedByUser: false,
          firmwareVersion: statusProbe.firmwareVersion || prevSaved?.firmwareVersion || null,
          lastTestedAt: nowIso,
          lastSuccessfulConnAt: prevSaved?.lastSuccessfulConnAt || null,
          lastFrameId: prevSaved?.lastFrameId || null,
          lastState: 'OFFLINE'
        };
        configStore.saveCamera(scope.greenhouseId, failCam);
        syncConfigToDatabase({
          greenhouseId: scope.greenhouseId,
          deviceType: 'esp32_cam',
          label: cameraName,
          connectionSettings: failCam as unknown as Record<string, unknown>,
          firmwareVersion: failCam.firmwareVersion
        });

        return res.status(200).json({
          success: false,
          connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
          cameraConnected: false,
          error: 'PHOTO_HTTP_ERROR',
          message: `Camera photo endpoint responded with HTTP ${photoRes.status}. Verify the capture path (e.g., /photo or /capture).`,
          statusProbe,
          statusCheck: statusProbe,
          photoLatencyMs,
          lastSuccessfulConnAt: prevSaved?.lastSuccessfulConnAt || null
        });
      }

      const rawArrayBuffer = await photoRes.arrayBuffer();
      const rawBuffer = Buffer.from(rawArrayBuffer);

      // 6. Validate JPEG SOI (0xFF 0xD8), marker segment, and EOI (0xFF 0xD9) & Store
      const stored = scope.targetCameraStore.validateAndStoreJpeg(rawBuffer, {
        acquisitionMethod: 'LAN_GATEWAY_PULL',
        cameraAddress: `${photoValidation.origin}${photoValidation.pathname}`
      });

      if ('errorCode' in stored) {
        const invalidJpegCam: SavedExistingCameraConfig = {
          cameraName,
          cameraIp: validatedIp,
          streamUrl: streamValidation?.normalizedUrl || '',
          photoUrl: photoValidation.normalizedUrl,
          statusUrl: statusValidation?.normalizedUrl || '',
          connectionMethod,
          disconnectedByUser: false,
          firmwareVersion: statusProbe.firmwareVersion || prevSaved?.firmwareVersion || null,
          lastTestedAt: nowIso,
          lastSuccessfulConnAt: prevSaved?.lastSuccessfulConnAt || null,
          lastFrameId: prevSaved?.lastFrameId || null,
          lastState: 'OFFLINE'
        };
        configStore.saveCamera(scope.greenhouseId, invalidJpegCam);
        syncConfigToDatabase({
          greenhouseId: scope.greenhouseId,
          deviceType: 'esp32_cam',
          label: cameraName,
          connectionSettings: invalidJpegCam as unknown as Record<string, unknown>
        });

        return res.status(200).json({
          success: false,
          connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
          cameraConnected: false,
          error: 'INVALID_JPEG_BYTES',
          message: `Camera endpoint responded, but payload failed JPEG validation: ${stored.message}`,
          statusProbe,
          statusCheck: statusProbe,
          photoLatencyMs,
          receivedBytes: rawBuffer.length,
          lastSuccessfulConnAt: prevSaved?.lastSuccessfulConnAt || null
        });
      }

      const { frame } = stored;
      const publicUrl = scope.greenhouseId
        ? `/api/greenhouses/${encodeURIComponent(scope.greenhouseId)}/camera/latest.jpg?frame=${encodeURIComponent(frame.id)}`
        : frame.url;

      const proxyStreamUrl = streamValidation
        ? `/api/hardware-http/camera/stream?streamUrl=${encodeURIComponent(streamValidation.normalizedUrl)}${scope.greenhouseId ? `&greenhouseId=${encodeURIComponent(scope.greenhouseId)}` : ''}`
        : null;

      const resolvedFw =
        statusProbe.firmwareVersion ||
        prevSaved?.firmwareVersion ||
        loadedScope.enrolledCameraRow?.firmwareVersion ||
        null;

      const okCam: SavedExistingCameraConfig = {
        cameraName,
        cameraIp: validatedIp,
        streamUrl: streamValidation?.normalizedUrl || '',
        photoUrl: photoValidation.normalizedUrl,
        statusUrl: statusValidation?.normalizedUrl || '',
        connectionMethod,
        disconnectedByUser: false,
        firmwareVersion: resolvedFw,
        streamSupported: streamVerified,
        lastTestedAt: nowIso,
        lastSuccessfulConnAt: frame.timestamp,
        lastFrameId: frame.id,
        lastState: 'IMAGE_RECEIVED'
      };

      configStore.saveCamera(scope.greenhouseId, okCam);
      syncConfigToDatabase({
        greenhouseId: scope.greenhouseId,
        deviceType: 'esp32_cam',
        label: cameraName,
        connectionSettings: okCam as unknown as Record<string, unknown>,
        firmwareVersion: resolvedFw
      });

      return res.status(200).json({
        success: true,
        connectionState: 'IMAGE_RECEIVED' as ExistingHardwareConnectionState,
        cameraConnected: true,
        cameraName,
        firmwareVersion: resolvedFw,
        message: `Verified genuine JPEG photograph (${Math.max(1, Math.round(frame.sizeBytes / 1024))} KB) from ${cameraName}.`,
        statusProbe,
        statusCheck: statusProbe,
        photoCheck: {
          ok: true,
          latencyMs: photoLatencyMs,
          sizeBytes: frame.sizeBytes,
          sha256: frame.sha256
        },
        streamCheck: {
          configured: Boolean(streamValidation),
          verified: streamVerified,
          proxyStreamUrl,
          error: streamError
        },
        photoLatencyMs,
        lastSuccessfulConnAt: frame.timestamp,
        proxyStreamUrl,
        directStreamUrl: streamValidation?.normalizedUrl || null,
        frame: {
          id: frame.id,
          url: publicUrl,
          base64DataUri: frame.base64DataUri,
          sizeBytes: frame.sizeBytes,
          sha256: frame.sha256,
          mimeType: frame.mimeType,
          capturedAt: frame.capturedAt,
          timestamp: frame.timestamp,
          acquisitionMethod: frame.acquisitionMethod,
          imageOriginLabel: 'REAL_CAMERA_IMAGE'
        }
      });
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError';
      const errCam: SavedExistingCameraConfig = {
        cameraName,
        cameraIp: validatedIp,
        streamUrl: streamValidation?.normalizedUrl || '',
        photoUrl: photoValidation.normalizedUrl,
        statusUrl: statusValidation?.normalizedUrl || '',
        connectionMethod,
        disconnectedByUser: false,
        firmwareVersion: statusProbe.firmwareVersion || prevSaved?.firmwareVersion || null,
        lastTestedAt: nowIso,
        lastSuccessfulConnAt: prevSaved?.lastSuccessfulConnAt || null,
        lastFrameId: prevSaved?.lastFrameId || null,
        lastState: 'OFFLINE'
      };
      configStore.saveCamera(scope.greenhouseId, errCam);
      syncConfigToDatabase({
        greenhouseId: scope.greenhouseId,
        deviceType: 'esp32_cam',
        label: cameraName,
        connectionSettings: errCam as unknown as Record<string, unknown>
      });

      return res.status(200).json({
        success: false,
        connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
        cameraConnected: false,
        error: isTimeout ? 'CAMERA_HTTP_TIMEOUT' : 'CAMERA_HTTP_UNREACHABLE',
        message: isTimeout
          ? `Camera photo endpoint timed out after 6000ms (${photoValidation.origin}). Ensure the ESP32-CAM is powered on and on the same 2.4 GHz network.`
          : `Could not reach ESP32-CAM at ${photoValidation.origin}: ${redactSecretsFromText(err?.message || 'network unreachable')}`,
        statusProbe,
        statusCheck: statusProbe,
        lastSuccessfulConnAt: prevSaved?.lastSuccessfulConnAt || null
      });
    }
  });

  /**
   * POST /api/hardware-http/camera/capture
   * Captures a fresh verified JPEG from the saved (or supplied) camera photoUrl and stores it
   * in the EDENS AI backend for cloud storage and Plant Vision AI diagnosis.
   */
  app.post('/api/hardware-http/camera/capture', async (req, res) => {
    const scope = resolveScopeAccess(req, true);
    if ('errorCode' in scope) {
      return res.status(scope.statusCode).json({
        success: false,
        connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
        error: scope.errorCode,
        message: scope.message
      });
    }

    const persisted = loadPersistedScopeWithDbFallback(scope.greenhouseId).camera;
    const candidatePhotoUrl =
      (typeof req.body?.photoUrl === 'string' && req.body.photoUrl.trim()) ||
      persisted?.photoUrl ||
      '';

    const photoValidation = validateExistingHardwareEndpointUrl(candidatePhotoUrl, {
      fieldName: 'Camera photo URL',
      allowLoopback
    });
    if ('errorCode' in photoValidation) {
      return res.status(400).json({
        success: false,
        connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
        error: photoValidation.errorCode,
        message: photoValidation.message
      });
    }

    if (isCloud() && photoValidation.isPrivateLanOrMdns) {
      return res.status(200).json({
        success: false,
        connectionState: 'CONNECTION_BLOCKED' as ExistingHardwareConnectionState,
        error: 'PRIVATE_LAN_UNREACHABLE_FROM_CLOUD',
        message:
          'Cloud server cannot pull directly from a private LAN IP. Run "npm run camera:relay" on the local Wi-Fi or use direct ESP32-CAM uploads to POST /api/camera/upload.'
      });
    }

    try {
      const photoRes = await fetchWithTimeout(
        photoValidation.normalizedUrl,
        {
          method: 'GET',
          headers: { Accept: 'image/jpeg,*/*' }
        },
        6000
      );
      if (!photoRes.ok) {
        return res.status(200).json({
          success: false,
          connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
          error: 'PHOTO_HTTP_ERROR',
          message: `Camera returned HTTP ${photoRes.status} on capture.`
        });
      }

      const rawBuf = Buffer.from(await photoRes.arrayBuffer());
      const stored = scope.targetCameraStore.validateAndStoreJpeg(rawBuf, {
        acquisitionMethod: 'LAN_GATEWAY_PULL',
        cameraAddress: `${photoValidation.origin}${photoValidation.pathname}`
      });

      if ('errorCode' in stored) {
        return res.status(200).json({
          success: false,
          connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
          error: 'INVALID_JPEG_BYTES',
          message: stored.message
        });
      }

      const publicUrl = scope.greenhouseId
        ? `/api/greenhouses/${encodeURIComponent(scope.greenhouseId)}/camera/latest.jpg?frame=${encodeURIComponent(stored.frame.id)}`
        : stored.frame.url;

      if (persisted) {
        const updatedCam: SavedExistingCameraConfig = {
          ...persisted,
          disconnectedByUser: false,
          lastTestedAt: new Date().toISOString(),
          lastSuccessfulConnAt: stored.frame.timestamp,
          lastFrameId: stored.frame.id,
          lastState: 'IMAGE_RECEIVED'
        };
        configStore.saveCamera(scope.greenhouseId, updatedCam);
        syncConfigToDatabase({
          greenhouseId: scope.greenhouseId,
          deviceType: 'esp32_cam',
          label: updatedCam.cameraName,
          connectionSettings: updatedCam as unknown as Record<string, unknown>,
          firmwareVersion: updatedCam.firmwareVersion
        });
      }

      return res.status(200).json({
        success: true,
        connectionState: 'IMAGE_RECEIVED' as ExistingHardwareConnectionState,
        frame: {
          id: stored.frame.id,
          url: publicUrl,
          base64DataUri: stored.frame.base64DataUri,
          sizeBytes: stored.frame.sizeBytes,
          sha256: stored.frame.sha256,
          capturedAt: stored.frame.capturedAt,
          timestamp: stored.frame.timestamp,
          imageOriginLabel: 'REAL_CAMERA_IMAGE'
        }
      });
    } catch (err: any) {
      return res.status(200).json({
        success: false,
        connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
        error: err?.name === 'AbortError' ? 'CAMERA_HTTP_TIMEOUT' : 'CAMERA_HTTP_UNREACHABLE',
        message: redactSecretsFromText(err?.message || 'Camera capture failed')
      });
    }
  });

  /**
   * GET /api/hardware-http/camera/stream
   * Safe local-gateway MJPEG stream proxy for any validated private LAN / loopback streamUrl.
   */
  app.get('/api/hardware-http/camera/stream', async (req, res) => {
    const scope = resolveScopeAccess(req, false);
    if ('errorCode' in scope) {
      return res.status(scope.statusCode).json({
        error: scope.errorCode,
        message: scope.message
      });
    }

    const rawStreamUrl = String(req.query.streamUrl || '').trim();
    const validation = validateExistingHardwareEndpointUrl(rawStreamUrl, {
      fieldName: 'Camera stream URL',
      allowLoopback
    });
    if ('errorCode' in validation) {
      return res.status(400).json({
        error: validation.errorCode,
        connectionState: 'INVALID_ADDRESS',
        message: validation.message
      });
    }

    if (isCloud() && validation.isPrivateLanOrMdns) {
      return res.status(503).json({
        error: 'PRIVATE_LAN_UNREACHABLE_FROM_CLOUD',
        connectionState: 'CONNECTION_BLOCKED',
        message: 'Live MJPEG private LAN streams cannot be proxied directly from cloud hosting.'
      });
    }

    const upstreamAbort = new AbortController();
    req.on('close', () => upstreamAbort.abort());

    const connectTimer = setTimeout(() => upstreamAbort.abort(), 5000);
    try {
      const upstream = await fetch(validation.normalizedUrl, {
        signal: upstreamAbort.signal
      });
      clearTimeout(connectTimer);

      if (!upstream.ok || !upstream.body) {
        return res.status(502).json({
          error: 'STREAM_UNAVAILABLE',
          connectionState: 'OFFLINE',
          message: `Camera stream returned HTTP ${upstream.status}`
        });
      }

      const contentType =
        upstream.headers.get('content-type') || 'multipart/x-mixed-replace; boundary=frame';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Connection', 'close');

      const nodeStream = Readable.fromWeb(upstream.body as any);
      nodeStream.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      nodeStream.pipe(res);
    } catch (err: any) {
      clearTimeout(connectTimer);
      if (!res.headersSent) {
        return res.status(502).json({
          error: 'STREAM_UNREACHABLE',
          connectionState: 'OFFLINE',
          message: `Cannot connect to camera stream at ${validation.origin}: ${redactSecretsFromText(err?.message || 'unreachable')}`
        });
      }
    }
  });

  /**
   * POST /api/hardware-http/controller/save
   * Validates and persists ESP32 Controller configuration (`deviceName`, `host`, `port`,
   * `statusUrl`, `telemetryUrl`, `connectionMethod: 'LOCAL' | 'CLOUD'`) to SQLite + disk.
   * NEVER marks the controller CONNECTED simply because its address was saved.
   */
  app.post('/api/hardware-http/controller/save', (req, res) => {
    const scope = resolveScopeAccess(req, true);
    if ('errorCode' in scope) {
      return res.status(scope.statusCode).json({
        success: false,
        connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
        error: scope.errorCode,
        message: scope.message
      });
    }

    const controllerName =
      String(req.body?.controllerName || req.body?.deviceName || 'Greenhouse ESP32 Controller')
        .trim()
        .slice(0, 80) || 'Greenhouse ESP32 Controller';
    const connectionMethod: HardwareConnectionMethod =
      String(req.body?.connectionMethod || 'LOCAL').toUpperCase() === 'CLOUD' ? 'CLOUD' : 'LOCAL';
    const rawHost = typeof req.body?.host === 'string' ? req.body.host.trim() : '';
    const rawPort = req.body?.port ?? 80;
    const rawBaseUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : '';
    const rawStatusUrl = typeof req.body?.statusUrl === 'string' ? req.body.statusUrl.trim() : '';
    const rawTelemetryUrl =
      typeof req.body?.telemetryUrl === 'string' ? req.body.telemetryUrl.trim() : '';

    let validatedHost = '';
    let validatedPort = 80;
    let validatedOrigin = '';

    if (rawHost || connectionMethod === 'LOCAL') {
      const hostOrBase = rawHost || rawBaseUrl;
      if (!hostOrBase && !rawStatusUrl && !rawTelemetryUrl) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          error: 'EMPTY_HOST',
          message:
            'Controller IP / Hostname (or Status/Telemetry URL) is required when using Local connection mode.'
        });
      }
      if (hostOrBase) {
        const hv = validateHardwareHostAndPort(hostOrBase, rawPort, {
          fieldName: 'Controller IP / Hostname',
          allowLoopback
        });
        if ('errorCode' in hv) {
          return res.status(400).json({
            success: false,
            connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
            error: hv.errorCode,
            message: hv.message
          });
        }
        validatedHost = hv.hostname;
        validatedPort = hv.port;
        validatedOrigin = hv.origin;
      }
    }

    let normalizedStatusUrl = '';
    if (rawStatusUrl) {
      const sv = validateExistingHardwareEndpointUrl(rawStatusUrl, {
        fieldName: 'Controller Status URL',
        allowLoopback
      });
      if ('errorCode' in sv) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          error: sv.errorCode,
          message: sv.message
        });
      }
      normalizedStatusUrl = sv.normalizedUrl;
      if (!validatedHost) {
        validatedHost = sv.hostname;
        validatedPort = sv.port;
        validatedOrigin = sv.origin;
      }
    } else if (validatedOrigin && connectionMethod === 'LOCAL') {
      normalizedStatusUrl = `${validatedOrigin}/status`;
    }

    let normalizedTelemetryUrl = '';
    if (rawTelemetryUrl && connectionMethod === 'LOCAL') {
      const tv = validateExistingHardwareEndpointUrl(rawTelemetryUrl, {
        fieldName: 'Sensor Telemetry URL',
        allowLoopback
      });
      if ('errorCode' in tv) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          error: tv.errorCode,
          message: tv.message
        });
      }
      normalizedTelemetryUrl = tv.normalizedUrl;
      if (!validatedHost) {
        validatedHost = tv.hostname;
        validatedPort = tv.port;
        validatedOrigin = tv.origin;
      }
    } else if (rawTelemetryUrl && connectionMethod === 'CLOUD') {
      // Allow optional LAN fallback telemetry URL only if valid
      if (/^https?:\/\//i.test(rawTelemetryUrl)) {
        const tv = validateExistingHardwareEndpointUrl(rawTelemetryUrl, {
          fieldName: 'Sensor Telemetry URL',
          allowLoopback
        });
        if ('errorCode' in tv) {
          return res.status(400).json({
            success: false,
            connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
            error: tv.errorCode,
            message: tv.message
          });
        }
        normalizedTelemetryUrl = tv.normalizedUrl;
      }
    } else if (validatedOrigin && connectionMethod === 'LOCAL') {
      normalizedTelemetryUrl = `${validatedOrigin}/status`;
    }

    const prevCtrl = loadPersistedScopeWithDbFallback(scope.greenhouseId).controller;
    const savedCtrl: SavedExistingControllerConfig = {
      controllerName,
      host: validatedHost,
      port: validatedPort,
      baseUrl: validatedOrigin,
      statusUrl: normalizedStatusUrl,
      telemetryUrl: normalizedTelemetryUrl,
      connectionMethod,
      disconnectedByUser: false,
      firmwareVersion: prevCtrl?.firmwareVersion || null,
      lastHeartbeatAt: null,
      lastTestedAt: null,
      lastSuccessfulConnAt: null,
      lastState: 'OFFLINE',
      lastProvenance: 'OFFLINE',
      firmwareSupportSummary: prevCtrl?.firmwareSupportSummary || null,
      cachedReadings: null,
      cachedSensorHealth: null,
      cachedReadingsAt: null
    };

    configStore.saveController(scope.greenhouseId, savedCtrl);
    syncConfigToDatabase({
      greenhouseId: scope.greenhouseId,
      deviceType: 'esp32_controller',
      label: controllerName,
      connectionSettings: savedCtrl as unknown as Record<string, unknown>,
      firmwareVersion: savedCtrl.firmwareVersion
    });

    return res.status(200).json({
      success: true,
      controllerConnected: false,
      connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
      provenance: 'OFFLINE' as ControllerTelemetryProvenance,
      savedController: savedCtrl,
      message:
        'Controller configuration saved (unverified). Click "Test Connection" to verify reachability and discover sensors.'
    });
  });

  /**
   * POST /api/hardware-http/controller/disconnect
   * Disconnects the controller session, clears cached HTTP readings, and sets state to OFFLINE.
   */
  app.post('/api/hardware-http/controller/disconnect', (req, res) => {
    const scope = resolveScopeAccess(req, true);
    if ('errorCode' in scope) {
      return res.status(scope.statusCode).json({
        success: false,
        error: scope.errorCode,
        message: scope.message
      });
    }

    const prevCtrl = loadPersistedScopeWithDbFallback(scope.greenhouseId).controller;
    const disconnectedCtrl: SavedExistingControllerConfig = {
      controllerName: prevCtrl?.controllerName || 'Greenhouse ESP32 Controller',
      host: prevCtrl?.host || '',
      port: prevCtrl?.port || 80,
      baseUrl: prevCtrl?.baseUrl || '',
      statusUrl: prevCtrl?.statusUrl || '',
      telemetryUrl: prevCtrl?.telemetryUrl || '',
      connectionMethod: prevCtrl?.connectionMethod || 'LOCAL',
      disconnectedByUser: true,
      firmwareVersion: prevCtrl?.firmwareVersion || null,
      lastHeartbeatAt: prevCtrl?.lastHeartbeatAt || null,
      lastTestedAt: prevCtrl?.lastTestedAt || null,
      lastSuccessfulConnAt: prevCtrl?.lastSuccessfulConnAt || null,
      lastState: 'OFFLINE',
      lastProvenance: 'OFFLINE',
      firmwareSupportSummary: prevCtrl?.firmwareSupportSummary || null,
      cachedReadings: null,
      cachedSensorHealth: null,
      cachedReadingsAt: null,
      discoveredSensors: []
    };

    configStore.saveController(scope.greenhouseId, disconnectedCtrl);
    syncConfigToDatabase({
      greenhouseId: scope.greenhouseId,
      deviceType: 'esp32_controller',
      label: disconnectedCtrl.controllerName,
      connectionSettings: disconnectedCtrl as unknown as Record<string, unknown>
    });

    return res.status(200).json({
      success: true,
      connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
      provenance: 'OFFLINE' as ControllerTelemetryProvenance,
      message: 'Controller disconnected and cached readings cleared.'
    });
  });

  /**
   * POST /api/hardware-http/controller/test
   * Genuine connection verification for the ESP32 Sensor Controller:
   * - Supports `connectionMethod: 'CLOUD'` (verifies authenticated outbound HTTPS uploads
   *   from `esp32_controller_reference.ino` + `edens_controller_sync.h` in SQLite)
   * - Supports `connectionMethod: 'LOCAL'` (verifies supplied/documented read-only HTTP
   *   Status URL / Sensor Telemetry URL / SoftAP `/api/identity`, validates telemetry,
   *   discovers available sensor capabilities dynamically, and NEVER calls actuation paths).
   */
  app.post('/api/hardware-http/controller/test', async (req, res) => {
    const scope = resolveScopeAccess(req, true);
    if ('errorCode' in scope) {
      return res.status(scope.statusCode).json({
        success: false,
        connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
        provenance: 'OFFLINE' as ControllerTelemetryProvenance,
        error: scope.errorCode,
        message: scope.message
      });
    }

    const controllerName =
      String(req.body?.controllerName || req.body?.deviceName || 'Greenhouse ESP32 Controller')
        .trim()
        .slice(0, 80) || 'Greenhouse ESP32 Controller';
    const connectionMethod: HardwareConnectionMethod =
      String(req.body?.connectionMethod || 'LOCAL').toUpperCase() === 'CLOUD' ? 'CLOUD' : 'LOCAL';
    const rawHost = typeof req.body?.host === 'string' ? req.body.host.trim() : '';
    const rawPort = req.body?.port ?? 80;
    const rawBaseUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : '';
    const rawStatusUrl = typeof req.body?.statusUrl === 'string' ? req.body.statusUrl.trim() : '';
    const rawTelemetryUrl =
      typeof req.body?.telemetryUrl === 'string' ? req.body.telemetryUrl.trim() : '';

    const nowIso = new Date().toISOString();
    const loadedScope = loadPersistedScopeWithDbFallback(scope.greenhouseId);
    const prevCtrl = loadedScope.controller;
    const sourceDeviceLabel = loadedScope.enrolledControllerRow
      ? `${controllerName} (${loadedScope.enrolledControllerRow.id})`
      : controllerName;

    // MODE A: CLOUD Outbound Protocol Check (`POST /api/telemetry/upload` with `X-Hardware-Key`)
    if (connectionMethod === 'CLOUD') {
      if (scope.greenhouseId && options.platformDb.isInitialized()) {
        const ghTel = options.platformDb.getLatestTelemetryForGreenhouse(scope.greenhouseId);
        const isLive = ghTel.dataSource === 'REAL_HARDWARE';
        const isStale = ghTel.dataSource === 'CACHED' || ghTel.dataSource === 'STALE';

        if ((isLive || isStale) && ghTel.readings) {
          const fw =
            (ghTel.deviceHealth?.firmwareVersion as string | undefined) ||
            loadedScope.enrolledControllerRow?.firmwareVersion ||
            prevCtrl?.firmwareVersion ||
            null;
          const discoveredSensors = discoverSensorCapabilities({
            readings: ghTel.readings,
            sensorHealth: ghTel.sensorHealth,
            timestampIso: ghTel.timestamp,
            sourceDevice: sourceDeviceLabel,
            isStale
          });

          const nextCtrl: SavedExistingControllerConfig = {
            controllerName,
            host: rawHost,
            port: Number(rawPort) || 80,
            baseUrl: '',
            statusUrl: '',
            telemetryUrl: '',
            connectionMethod: 'CLOUD',
            disconnectedByUser: false,
            firmwareVersion: fw,
            lastHeartbeatAt: loadedScope.enrolledControllerRow?.lastSeenAt || ghTel.receivedAt,
            lastTestedAt: nowIso,
            lastSuccessfulConnAt: isLive ? ghTel.timestamp : prevCtrl?.lastSuccessfulConnAt || null,
            lastState: isLive ? 'CONNECTED' : 'OFFLINE',
            lastProvenance: isLive ? 'REAL_HARDWARE' : 'STALE',
            firmwareSupportSummary:
              'Outbound HTTPS POST /api/telemetry/upload (edens_controller_sync.h) active.',
            discoveredSensors
          };
          configStore.saveController(scope.greenhouseId, nextCtrl);
          syncConfigToDatabase({
            greenhouseId: scope.greenhouseId,
            deviceType: 'esp32_controller',
            label: controllerName,
            connectionSettings: nextCtrl as unknown as Record<string, unknown>,
            firmwareVersion: fw,
            discoveredSensors
          });

          return res.status(200).json({
            success: isLive,
            connectionState: (isLive ? 'CONNECTED' : 'OFFLINE') as ExistingHardwareConnectionState,
            provenance: (isLive ? 'REAL_HARDWARE' : 'STALE') as ControllerTelemetryProvenance,
            dataCategory: (isLive ? 'REAL_HARDWARE_DATA' : 'STALE_DATA') as HardwareDataCategory,
            controllerName,
            firmwareVersion: fw,
            lastHeartbeatAt: nextCtrl.lastHeartbeatAt,
            lastSuccessfulConnAt: ghTel.timestamp,
            readings: ghTel.readings,
            sensorHealth: ghTel.sensorHealth,
            discoveredSensors,
            message: isLive
              ? `Verified live outbound telemetry from ${controllerName} (${discoveredSensors.filter((s) => s.connected).length} active sensor(s) discovered).`
              : `Latest cloud telemetry from ${controllerName} is stale (${ghTel.ageSeconds}s old). Verify the ESP32 has 2.4 GHz Wi-Fi and valid X-Hardware-Key.`
          });
        }
      }

      const unverifiedCtrl: SavedExistingControllerConfig = {
        controllerName,
        host: rawHost,
        port: Number(rawPort) || 80,
        baseUrl: '',
        statusUrl: '',
        telemetryUrl: '',
        connectionMethod: 'CLOUD',
        disconnectedByUser: false,
        firmwareVersion: loadedScope.enrolledControllerRow?.firmwareVersion || null,
        lastHeartbeatAt: loadedScope.enrolledControllerRow?.lastSeenAt || null,
        lastTestedAt: nowIso,
        lastSuccessfulConnAt: null,
        lastState: 'OFFLINE',
        lastProvenance: 'OFFLINE',
        firmwareSupportSummary:
          'Waiting for first authenticated outbound POST /api/telemetry/upload check-in from ESP32 controller.'
      };
      configStore.saveController(scope.greenhouseId, unverifiedCtrl);
      syncConfigToDatabase({
        greenhouseId: scope.greenhouseId,
        deviceType: 'esp32_controller',
        label: controllerName,
        connectionSettings: unverifiedCtrl as unknown as Record<string, unknown>
      });

      return res.status(200).json({
        success: false,
        connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
        provenance: 'OFFLINE' as ControllerTelemetryProvenance,
        dataCategory: 'OFFLINE' as HardwareDataCategory,
        error: 'MISSING_CLOUD_TELEMETRY_CHECKIN',
        message:
          'No outbound telemetry has arrived at POST /api/telemetry/upload yet. Generate or rotate a controller key in Enrolled Greenhouse Hardware and flash/pair your ESP32 board.',
        discoveredSensors: []
      });
    }

    // MODE B: LOCAL HTTP Read-Only Verification (`statusUrl` + `telemetryUrl` + `/api/identity` fallback)
    let originValidation: ValidatedHardwareEndpointUrl | null = null;
    if (rawBaseUrl) {
      const bv = validateExistingHardwareEndpointUrl(rawBaseUrl, {
        fieldName: 'Controller HTTP address',
        allowLoopback
      });
      if ('errorCode' in bv) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          provenance: 'OFFLINE' as ControllerTelemetryProvenance,
          error: bv.errorCode,
          message: bv.message
        });
      }
      originValidation = bv;
    } else if (rawHost) {
      const hv = validateHardwareHostAndPort(rawHost, rawPort, {
        fieldName: 'Controller IP / Hostname',
        allowLoopback
      });
      if ('errorCode' in hv) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          provenance: 'OFFLINE' as ControllerTelemetryProvenance,
          error: hv.errorCode,
          message: hv.message
        });
      }
      const bv = validateExistingHardwareEndpointUrl(hv.origin, {
        fieldName: 'Controller HTTP address',
        allowLoopback
      });
      if ('errorCode' in bv) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          provenance: 'OFFLINE' as ControllerTelemetryProvenance,
          error: bv.errorCode,
          message: bv.message
        });
      }
      originValidation = bv;
    }

    let statusValidation: ValidatedHardwareEndpointUrl | null = null;
    if (rawStatusUrl) {
      const sv = validateExistingHardwareEndpointUrl(rawStatusUrl, {
        fieldName: 'Controller Status URL',
        allowLoopback
      });
      if ('errorCode' in sv) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          provenance: 'OFFLINE' as ControllerTelemetryProvenance,
          error: sv.errorCode,
          message: sv.message
        });
      }
      statusValidation = sv;
      if (!originValidation) originValidation = sv;
    }

    let telemetryValidation: ValidatedHardwareEndpointUrl | null = null;
    if (rawTelemetryUrl) {
      const tv = validateExistingHardwareEndpointUrl(rawTelemetryUrl, {
        fieldName: 'Sensor Telemetry URL',
        allowLoopback
      });
      if ('errorCode' in tv) {
        return res.status(400).json({
          success: false,
          connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
          provenance: 'OFFLINE' as ControllerTelemetryProvenance,
          error: tv.errorCode,
          message: tv.message
        });
      }
      telemetryValidation = tv;
      if (!originValidation) originValidation = tv;
    }

    if (!originValidation) {
      return res.status(400).json({
        success: false,
        connectionState: 'INVALID_ADDRESS' as ExistingHardwareConnectionState,
        provenance: 'OFFLINE' as ControllerTelemetryProvenance,
        error: 'EMPTY_URL',
        message:
          'Enter a valid Controller IP / Hostname or Controller Status / Telemetry URL to test local HTTP connectivity.'
      });
    }

    const resolvedStatusUrl =
      statusValidation?.normalizedUrl ||
      (originValidation.pathname && originValidation.pathname !== '/'
        ? originValidation.normalizedUrl
        : `${originValidation.origin}/status`);
    const resolvedTelemetryUrl = telemetryValidation?.normalizedUrl || resolvedStatusUrl;
    const identityTargetUrl = `${originValidation.origin}/api/identity`;

    if (isCloud() && originValidation.isPrivateLanOrMdns) {
      const summary =
        'Cloud backend cannot route inbound HTTP requests to private RFC1918 LAN controller addresses. Switch Connection Method to "Cloud" (supported natively by esp32_controller_reference.ino via POST /api/telemetry/upload with X-Hardware-Key) or run EDENS AI locally on the same Wi-Fi.';
      const blockedCtrl: SavedExistingControllerConfig = {
        controllerName,
        host: originValidation.hostname,
        port: originValidation.port,
        baseUrl: originValidation.origin,
        statusUrl: resolvedStatusUrl,
        telemetryUrl: resolvedTelemetryUrl,
        connectionMethod: 'LOCAL',
        disconnectedByUser: false,
        firmwareVersion: prevCtrl?.firmwareVersion || null,
        lastHeartbeatAt: prevCtrl?.lastHeartbeatAt || null,
        lastTestedAt: nowIso,
        lastSuccessfulConnAt: prevCtrl?.lastSuccessfulConnAt || null,
        lastState: 'CONNECTION_BLOCKED',
        lastProvenance: 'OFFLINE',
        firmwareSupportSummary: summary,
        cachedReadings: prevCtrl?.cachedReadings || null,
        cachedReadingsAt: prevCtrl?.cachedReadingsAt || null
      };
      configStore.saveController(scope.greenhouseId, blockedCtrl);
      syncConfigToDatabase({
        greenhouseId: scope.greenhouseId,
        deviceType: 'esp32_controller',
        label: controllerName,
        connectionSettings: blockedCtrl as unknown as Record<string, unknown>
      });

      return res.status(200).json({
        success: false,
        connectionState: 'CONNECTION_BLOCKED' as ExistingHardwareConnectionState,
        provenance: 'OFFLINE' as ControllerTelemetryProvenance,
        dataCategory: 'OFFLINE' as HardwareDataCategory,
        error: 'PRIVATE_LAN_UNREACHABLE_FROM_CLOUD',
        message: summary,
        probedEndpoints: [],
        discoveredSensors: [],
        firmwareAudit: {
          checkedInReferenceSketch:
            'firmware/EDENS_HARDWARE_KIT/esp32_controller_adapter/esp32_controller_reference.ino',
          normalStaInboundHttpServer: false,
          outboundCloudPushSupported: true,
          outboundEndpoint: 'POST /api/telemetry/upload (X-Hardware-Key)',
          legacyLocalHttpContract: 'GET /status (standalone HTTP controller sketches only)',
          softApProvisioningEndpoint: 'GET /api/identity (192.168.4.1 during EDENS-SETUP pairing)'
        }
      });
    }

    const probedEndpoints: Array<{
      endpoint: string;
      httpStatus: number | null;
      reachable: boolean;
      latencyMs: number;
      note: string;
    }> = [];

    let anyHttpResponse = false;
    let statusEndpointOk = false;
    let discoveredFirmwareVersion: string | null = prevCtrl?.firmwareVersion || null;
    let candidateTelemetryObjects: Array<{ url: string; latencyMs: number; json: Record<string, unknown> }> = [];

    // Probe Status URL
    const s0 = Date.now();
    try {
      const statusRes = await fetchWithTimeout(
        resolvedStatusUrl,
        {
          method: 'GET',
          headers: { Accept: 'application/json' }
        },
        4000
      );
      const statusLatency = Date.now() - s0;
      anyHttpResponse = true;

      if (statusRes.ok) {
        statusEndpointOk = true;
        const rawText = await statusRes.text();
        try {
          const parsed = JSON.parse(rawText);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const obj = parsed as Record<string, unknown>;
            if (typeof obj.firmwareVersion === 'string') discoveredFirmwareVersion = obj.firmwareVersion;
            else if (
              obj.deviceHealth &&
              typeof obj.deviceHealth === 'object' &&
              typeof (obj.deviceHealth as any).firmwareVersion === 'string'
            ) {
              discoveredFirmwareVersion = String((obj.deviceHealth as any).firmwareVersion);
            }
            candidateTelemetryObjects.push({ url: resolvedStatusUrl, latencyMs: statusLatency, json: obj });
            probedEndpoints.push({
              endpoint: resolvedStatusUrl,
              httpStatus: statusRes.status,
              reachable: true,
              latencyMs: statusLatency,
              note: 'Status JSON endpoint responded.'
            });
          } else {
            probedEndpoints.push({
              endpoint: resolvedStatusUrl,
              httpStatus: statusRes.status,
              reachable: true,
              latencyMs: statusLatency,
              note: 'Status endpoint responded (non-object payload).'
            });
          }
        } catch {
          probedEndpoints.push({
            endpoint: resolvedStatusUrl,
            httpStatus: statusRes.status,
            reachable: true,
            latencyMs: statusLatency,
            note: 'Status endpoint returned non-JSON text.'
          });
        }
      } else {
        probedEndpoints.push({
          endpoint: resolvedStatusUrl,
          httpStatus: statusRes.status,
          reachable: false,
          latencyMs: statusLatency,
          note: `Returned HTTP ${statusRes.status}`
        });
      }
    } catch (err: any) {
      probedEndpoints.push({
        endpoint: resolvedStatusUrl,
        httpStatus: null,
        reachable: false,
        latencyMs: Date.now() - s0,
        note:
          err?.name === 'AbortError'
            ? 'Timed out after 4000ms'
            : redactSecretsFromText(err?.message || 'Unreachable')
      });
    }

    // Probe separate Sensor Telemetry URL if distinct from Status URL
    if (resolvedTelemetryUrl !== resolvedStatusUrl) {
      const t0 = Date.now();
      try {
        const telRes = await fetchWithTimeout(
          resolvedTelemetryUrl,
          {
            method: 'GET',
            headers: { Accept: 'application/json' }
          },
          4000
        );
        const telLatency = Date.now() - t0;
        anyHttpResponse = true;

        if (telRes.ok) {
          const rawText = await telRes.text();
          try {
            const parsed = JSON.parse(rawText);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              // Prioritize explicit telemetryUrl payload first
              candidateTelemetryObjects.unshift({
                url: resolvedTelemetryUrl,
                latencyMs: telLatency,
                json: parsed as Record<string, unknown>
              });
              probedEndpoints.push({
                endpoint: resolvedTelemetryUrl,
                httpStatus: telRes.status,
                reachable: true,
                latencyMs: telLatency,
                note: 'Sensor telemetry JSON endpoint responded.'
              });
            }
          } catch {
            probedEndpoints.push({
              endpoint: resolvedTelemetryUrl,
              httpStatus: telRes.status,
              reachable: true,
              latencyMs: telLatency,
              note: 'Sensor telemetry endpoint returned invalid JSON.'
            });
          }
        } else {
          probedEndpoints.push({
            endpoint: resolvedTelemetryUrl,
            httpStatus: telRes.status,
            reachable: false,
            latencyMs: telLatency,
            note: `Returned HTTP ${telRes.status}`
          });
        }
      } catch (err: any) {
        probedEndpoints.push({
          endpoint: resolvedTelemetryUrl,
          httpStatus: null,
          reachable: false,
          latencyMs: Date.now() - t0,
          note:
            err?.name === 'AbortError'
              ? 'Timed out after 4000ms'
              : redactSecretsFromText(err?.message || 'Unreachable')
        });
      }
    }

    // Validate retrieved telemetry & dynamically discover sensors
    for (const candidate of candidateTelemetryObjects) {
      const rawObj = candidate.json;
      if (
        String(rawObj.dataSource || '').toUpperCase() === 'SIMULATED' ||
        String(rawObj.source || '').toUpperCase() === 'SIMULATED' ||
        rawObj.simulated === true
      ) {
        return res.status(400).json({
          success: false,
          connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
          provenance: 'OFFLINE' as ControllerTelemetryProvenance,
          dataCategory: 'OFFLINE' as HardwareDataCategory,
          error: 'SIMULATED_DATA_REJECTED',
          message: 'Simulated sensor payloads are rejected by the physical controller connection test.'
        });
      }

      const normalizedCandidate: Record<string, unknown> = {
        ...rawObj,
        temperature: rawObj.temperature ?? rawObj.temperatureC ?? rawObj.temp ?? rawObj.tempC,
        humidity: rawObj.humidity ?? rawObj.humidityPct ?? rawObj.hum,
        soilMoisture: rawObj.soilMoisture ?? rawObj.soilMoisturePct ?? rawObj.soil_moisture,
        sunlight: rawObj.sunlight ?? rawObj.sunlightLux ?? rawObj.lightIntensity ?? rawObj.lux,
        growLight: rawObj.growLight ?? rawObj.growLightLux ?? rawObj.grow_light,
        waterLevel: rawObj.waterLevel ?? rawObj.waterLevelPct ?? rawObj.water_level,
        batteryVoltage: rawObj.batteryVoltage ?? rawObj.battery_voltage ?? rawObj.voltage,
        rain: rawObj.rain ?? rawObj.rainDetected ?? rawObj.rain_detected
      };

      const validated = validateControllerTelemetryPayload(normalizedCandidate);
      if ('errorCode' in validated && validated.errorCode !== 'MISSING_REQUIRED_SENSORS') {
        return res.status(400).json({
          success: false,
          connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
          provenance: 'OFFLINE' as ControllerTelemetryProvenance,
          dataCategory: 'OFFLINE' as HardwareDataCategory,
          error: validated.errorCode,
          message: validated.message
        });
      }

      const readingsMap: Record<string, number | boolean | null> =
        !('errorCode' in validated)
          ? {
              temperature: validated.temperature,
              humidity: validated.humidity,
              soilMoisture: validated.soilMoisture,
              sunlight: validated.sunlight,
              growLight: validated.growLight,
              waterLevel: validated.waterLevel,
              batteryVoltage: validated.batteryVoltage,
              rain: validated.rain
            }
          : {};

      const sensorHealthObj =
        !('errorCode' in validated)
          ? (validated.sensorHealth as unknown as Record<string, unknown>)
          : rawObj.sensorHealth && typeof rawObj.sensorHealth === 'object'
            ? (rawObj.sensorHealth as Record<string, unknown>)
            : null;

      const discoveredSensors = discoverSensorCapabilities({
        readings: readingsMap,
        rawPayload: rawObj,
        sensorHealth: sensorHealthObj,
        timestampIso: nowIso,
        sourceDevice: sourceDeviceLabel,
        isStale: false
      });

      const connectedCount = discoveredSensors.filter((s) => s.connected).length;
      if (connectedCount === 0) {
        // Reachable JSON object with zero valid sensor values -> report MISSING_SENSOR_TELEMETRY honestly!
        continue;
      }

      // Preserve any dynamically discovered connected sensors in cachedReadings so GET /state retains them
      for (const ds of discoveredSensors) {
        if (ds.connected && ds.value !== null && !(ds.key in readingsMap)) {
          readingsMap[ds.key] = ds.value;
        }
      }

      const resolvedFw =
        (!('errorCode' in validated) ? validated.deviceHealth?.firmwareVersion : undefined) ||
        discoveredFirmwareVersion ||
        loadedScope.enrolledControllerRow?.firmwareVersion ||
        null;

      const summary = `Verified HTTP sensor telemetry from ${candidate.url} (${connectedCount} active sensor(s)).`;
      const okCtrl: SavedExistingControllerConfig = {
        controllerName,
        host: originValidation.hostname,
        port: originValidation.port,
        baseUrl: originValidation.origin,
        statusUrl: resolvedStatusUrl,
        telemetryUrl: resolvedTelemetryUrl,
        connectionMethod: 'LOCAL',
        disconnectedByUser: false,
        firmwareVersion: resolvedFw,
        lastHeartbeatAt: nowIso,
        lastTestedAt: nowIso,
        lastSuccessfulConnAt: nowIso,
        lastState: 'CONNECTED',
        lastProvenance: 'REAL_HARDWARE',
        firmwareSupportSummary: summary,
        cachedReadings: readingsMap,
        cachedSensorHealth: sensorHealthObj as Record<string, string> | null,
        cachedReadingsAt: nowIso,
        discoveredSensors
      };

      configStore.saveController(scope.greenhouseId, okCtrl);
      syncConfigToDatabase({
        greenhouseId: scope.greenhouseId,
        deviceType: 'esp32_controller',
        label: controllerName,
        connectionSettings: okCtrl as unknown as Record<string, unknown>,
        firmwareVersion: resolvedFw,
        discoveredSensors
      });

      return res.status(200).json({
        success: true,
        connectionState: 'CONNECTED' as ExistingHardwareConnectionState,
        provenance: 'REAL_HARDWARE' as ControllerTelemetryProvenance,
        dataCategory: 'REAL_HARDWARE_DATA' as HardwareDataCategory,
        controllerName,
        firmwareVersion: resolvedFw,
        lastHeartbeatAt: nowIso,
        lastSuccessfulConnAt: nowIso,
        message: `Connected to ${controllerName} (${candidate.latencyMs}ms). Discovered ${connectedCount} active sensor(s).`,
        readings: readingsMap,
        sensorHealth: sensorHealthObj,
        interlocks: !('errorCode' in validated) ? validated.interlocks : {},
        discoveredSensors,
        statusEndpoint: { ok: statusEndpointOk, url: resolvedStatusUrl },
        identityEndpoint: { ok: false, url: identityTargetUrl },
        probedEndpoints,
        missingFirmwareSupport: null
      });
    }

    // If HTTP JSON responded on Status/Telemetry URL but contained zero valid sensor measurements:
    if (candidateTelemetryObjects.length > 0) {
      const emptySensors = discoverSensorCapabilities({
        readings: {},
        timestampIso: nowIso,
        sourceDevice: sourceDeviceLabel,
        isStale: false
      });
      const msg =
        'Controller HTTP endpoint responded, but returned no valid numeric/boolean sensor telemetry readings. Verify sensor wiring or telemetry JSON keys.';
      const missingTelCtrl: SavedExistingControllerConfig = {
        controllerName,
        host: originValidation.hostname,
        port: originValidation.port,
        baseUrl: originValidation.origin,
        statusUrl: resolvedStatusUrl,
        telemetryUrl: resolvedTelemetryUrl,
        connectionMethod: 'LOCAL',
        disconnectedByUser: false,
        firmwareVersion: discoveredFirmwareVersion,
        lastHeartbeatAt: nowIso,
        lastTestedAt: nowIso,
        lastSuccessfulConnAt: prevCtrl?.lastSuccessfulConnAt || null,
        lastState: 'OFFLINE',
        lastProvenance: 'OFFLINE',
        firmwareSupportSummary: msg,
        cachedReadings: null,
        cachedReadingsAt: null,
        discoveredSensors: emptySensors
      };
      configStore.saveController(scope.greenhouseId, missingTelCtrl);
      syncConfigToDatabase({
        greenhouseId: scope.greenhouseId,
        deviceType: 'esp32_controller',
        label: controllerName,
        connectionSettings: missingTelCtrl as unknown as Record<string, unknown>
      });

      return res.status(200).json({
        success: false,
        connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
        provenance: 'OFFLINE' as ControllerTelemetryProvenance,
        dataCategory: 'OFFLINE' as HardwareDataCategory,
        error: 'MISSING_SENSOR_TELEMETRY',
        message: msg,
        discoveredSensors: emptySensors,
        statusEndpoint: { ok: statusEndpointOk, url: resolvedStatusUrl },
        identityEndpoint: { ok: false, url: identityTargetUrl },
        probedEndpoints
      });
    }

    // Probe 2: Documented SoftAP provisioning portal identity endpoint: GET <origin>/api/identity
    const i0 = Date.now();
    try {
      const idRes = await fetchWithTimeout(
        identityTargetUrl,
        {
          method: 'GET',
          headers: { Accept: 'application/json' }
        },
        3000
      );
      const idLatency = Date.now() - i0;
      anyHttpResponse = true;

      if (idRes.ok) {
        const idJson = (await idRes.json().catch(() => null)) as Record<string, unknown> | null;
        if (
          idJson &&
          (idJson.hardwareIdentityUid || idJson.hardwareUid || idJson.deviceType || idJson.macAddress)
        ) {
          const fw =
            typeof idJson.firmwareVersion === 'string'
              ? idJson.firmwareVersion
              : discoveredFirmwareVersion;

          probedEndpoints.push({
            endpoint: identityTargetUrl,
            httpStatus: idRes.status,
            reachable: true,
            latencyMs: idLatency,
            note: 'EDENS SoftAP provisioning/recovery identity endpoint responded.'
          });

          const missingNote =
            'Board is currently in EDENS-SETUP SoftAP provisioning/recovery mode (GET /api/identity responded), so live sensor telemetry (GET /status) is not served here. Note: checked-in esp32_controller_reference.ino pushes telemetry outbound to POST /api/telemetry/upload with X-Hardware-Key once paired and does not expose an inbound HTTP GET /status server in normal Wi-Fi mode.';

          const softApCtrl: SavedExistingControllerConfig = {
            controllerName,
            host: originValidation.hostname,
            port: originValidation.port,
            baseUrl: originValidation.origin,
            statusUrl: resolvedStatusUrl,
            telemetryUrl: resolvedTelemetryUrl,
            connectionMethod: 'LOCAL',
            disconnectedByUser: false,
            firmwareVersion: fw,
            lastHeartbeatAt: nowIso,
            lastTestedAt: nowIso,
            lastSuccessfulConnAt: nowIso,
            lastState: 'CONNECTED',
            lastProvenance: 'OFFLINE',
            firmwareSupportSummary: missingNote,
            cachedReadings: null,
            cachedReadingsAt: null,
            discoveredSensors: []
          };
          configStore.saveController(scope.greenhouseId, softApCtrl);
          syncConfigToDatabase({
            greenhouseId: scope.greenhouseId,
            deviceType: 'esp32_controller',
            label: controllerName,
            connectionSettings: softApCtrl as unknown as Record<string, unknown>,
            firmwareVersion: fw
          });

          return res.status(200).json({
            success: true,
            connectionState: 'CONNECTED' as ExistingHardwareConnectionState,
            provenance: 'OFFLINE' as ControllerTelemetryProvenance,
            dataCategory: 'OFFLINE' as HardwareDataCategory,
            controllerName,
            firmwareVersion: fw,
            lastHeartbeatAt: nowIso,
            identity: idJson,
            statusEndpoint: { ok: false, url: resolvedStatusUrl },
            identityEndpoint: { ok: true, url: identityTargetUrl },
            discoveredSensors: [],
            message:
              'Reached board SoftAP identity endpoint (GET /api/identity). No sensor telemetry HTTP endpoint is active in setup mode.',
            probedEndpoints,
            missingFirmwareSupport: missingNote
          });
        }
      } else {
        probedEndpoints.push({
          endpoint: identityTargetUrl,
          httpStatus: idRes.status,
          reachable: false,
          latencyMs: idLatency,
          note: `Returned HTTP ${idRes.status}`
        });
      }
    } catch (err: any) {
      probedEndpoints.push({
        endpoint: identityTargetUrl,
        httpStatus: null,
        reachable: false,
        latencyMs: Date.now() - i0,
        note:
          err?.name === 'AbortError'
            ? 'Timed out after 3000ms'
            : redactSecretsFromText(err?.message || 'Unreachable')
      });
    }

    const missingFirmwareSupport = anyHttpResponse
      ? `Host ${originValidation.origin} responded over HTTP, but neither documented read-only endpoint (${resolvedStatusUrl} for sensor telemetry, GET /api/identity for SoftAP identity) returned valid data. Firmware audit note: checked-in esp32_controller_reference.ino + edens_controller_sync.h push outbound HTTPS telemetry to POST /api/telemetry/upload and do not run an inbound HTTP GET /status server unless added to the controller sketch.`
      : `No HTTP response from ${originValidation.origin}. Either the ESP32 controller is offline/on a different subnet, or it is running esp32_controller_reference.ino which pushes outbound telemetry to POST /api/telemetry/upload (Cloud mode) without listening on inbound TCP port ${originValidation.port}.`;

    const failCtrl: SavedExistingControllerConfig = {
      controllerName,
      host: originValidation.hostname,
      port: originValidation.port,
      baseUrl: originValidation.origin,
      statusUrl: resolvedStatusUrl,
      telemetryUrl: resolvedTelemetryUrl,
      connectionMethod: 'LOCAL',
      disconnectedByUser: false,
      firmwareVersion: prevCtrl?.firmwareVersion || null,
      lastHeartbeatAt: prevCtrl?.lastHeartbeatAt || null,
      lastTestedAt: nowIso,
      lastSuccessfulConnAt: prevCtrl?.lastSuccessfulConnAt || null,
      lastState: 'OFFLINE',
      lastProvenance: 'OFFLINE',
      firmwareSupportSummary: missingFirmwareSupport,
      cachedReadings: prevCtrl?.cachedReadings || null,
      cachedReadingsAt: prevCtrl?.cachedReadingsAt || null
    };
    configStore.saveController(scope.greenhouseId, failCtrl);
    syncConfigToDatabase({
      greenhouseId: scope.greenhouseId,
      deviceType: 'esp32_controller',
      label: controllerName,
      connectionSettings: failCtrl as unknown as Record<string, unknown>
    });

    return res.status(200).json({
      success: false,
      connectionState: 'OFFLINE' as ExistingHardwareConnectionState,
      provenance: 'OFFLINE' as ControllerTelemetryProvenance,
      dataCategory: 'OFFLINE' as HardwareDataCategory,
      httpHostResponded: anyHttpResponse,
      error: anyHttpResponse
        ? 'MISSING_FIRMWARE_HTTP_TELEMETRY_ENDPOINT'
        : 'CONTROLLER_HTTP_UNREACHABLE',
      message: missingFirmwareSupport,
      statusEndpoint: { ok: false, url: resolvedStatusUrl },
      identityEndpoint: { ok: false, url: identityTargetUrl },
      discoveredSensors: [],
      probedEndpoints,
      missingFirmwareSupport
    });
  });

  return { configStore };
}
