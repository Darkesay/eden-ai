import crypto from 'node:crypto';
import type { CameraImageStore } from './cameraStorage.ts';
import type { DeviceRecord, PlatformDatabase } from './database.ts';
import { isPrivateRfc1918Ipv4 } from './cameraAcquisition.ts';
import {
  type ExplicitDeviceConnectionState,
  type ValidatedControllerTelemetry,
  generateSecureId,
  redactSecretsFromText,
  validateControllerTelemetryPayload
} from './telemetryContract.ts';

export type SupportedIotProtocol =
  | 'mqtt'
  | 'http_rest'
  | 'websocket'
  | 'esphome_api'
  | 'thingsboard_v1';

export type NormalizedConnectionState =
  | 'online'
  | 'offline'
  | 'reconnecting'
  | 'stale'
  | 'unprovisioned'
  | 'revoked'
  | 'error';

export type UiHardwareBannerState =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'RECONNECTING'
  | 'STALE DATA'
  | 'REAL HARDWARE DATA'
  | 'SIMULATED DATA';

export type TelemetryQuality = 'valid' | 'out_of_range' | 'stale' | 'unavailable';
export type TelemetrySourceKind = 'real_hardware' | 'simulated';

export interface StandardSensorDescriptor {
  sensor_id: string;
  sensor_type: string;
  label: string;
  unit: string;
  value: number | boolean | null;
  quality: TelemetryQuality;
  source: TelemetrySourceKind;
  timestamp: string | null;
  discovery_origin: string;
}

export interface StandardCameraDescriptor {
  camera_id: string;
  stream_url: string | null;
  photo_url: string | null;
  status_url: string | null;
  transport_mode: 'local_lan_http' | 'cloud_upload' | 'esphome_camera';
  connection_state: NormalizedConnectionState;
  last_capture_at: string | null;
  last_frame_id: string | null;
  freshness_seconds: number | null;
}

export interface StandardActuatorDescriptor {
  actuator_id: string;
  actuator_type: string;
  label: string;
  current_state: 'on' | 'off' | 'open' | 'closed' | 'unknown';
  physical_control_enabled: false;
  safety_locked: boolean;
}

/**
 * Canonical EDENS AI Standard Device Model (Stage 2B Specification)
 */
export interface StandardDeviceModel {
  device_id: string;
  greenhouse_id: string;
  zone_id: string | null;
  device_type: 'greenhouse_controller' | 'greenhouse_camera' | 'environmental_node';
  manufacturer: string;
  model: string;
  firmware_version: string | null;
  protocol: SupportedIotProtocol;
  connection_state: NormalizedConnectionState;
  ui_status_label: UiHardwareBannerState;
  data_provenance_label: 'REAL HARDWARE DATA' | 'SIMULATED DATA' | 'STALE DATA' | 'DISCONNECTED';
  explicit_state: ExplicitDeviceConnectionState;
  last_seen: string | null;
  age_seconds: number | null;
  label: string;
  key_prefix: string | null;
  replaced_by_device_id: string | null;
  capabilities: string[];
  sensors: StandardSensorDescriptor[];
  cameras: StandardCameraDescriptor[];
  actuators: StandardActuatorDescriptor[];
}

/**
 * Canonical EDENS AI Standard Telemetry Model (Stage 2B Specification)
 */
export interface StandardTelemetryModel {
  device_id: string;
  sensor_id: string;
  sensor_type: string;
  value: number;
  unit: string;
  timestamp: string;
  quality: TelemetryQuality;
  source: TelemetrySourceKind;
}

export interface NormalizedIngestionResult {
  ok: boolean;
  statusCode: number;
  errorCode?: string;
  message?: string;
  readingId?: string;
  protocol: SupportedIotProtocol;
  device?: StandardDeviceModel;
  telemetryRecords: StandardTelemetryModel[];
}

export interface ProtocolAdapterDefinition {
  protocol: SupportedIotProtocol;
  displayName: string;
  version: string;
  upstreamLicense: string;
  supportsDiscovery: boolean;
  normalizePayload: (
    rawPayload: unknown,
    context: {
      deviceId: string;
      greenhouseId: string;
      zoneId: string | null;
      topicOrPath?: string;
      receivedAtIso?: string;
    }
  ) =>
    | {
        ok: true;
        controllerTelemetry?: ValidatedControllerTelemetry;
        standardReadings: StandardTelemetryModel[];
        discoveredCapabilities?: {
          manufacturer?: string;
          model?: string;
          firmwareVersion?: string;
          sensors?: Array<{ id: string; type: string; label: string; unit: string; topic?: string }>;
          actuators?: string[];
        };
      }
    | { ok: false; errorCode: string; message: string };
}

interface SensorPhysicalBound {
  sensorType: string;
  canonicalUnit: string;
  label: string;
  min: number;
  max: number;
}

const SENSOR_BOUNDS: Record<string, SensorPhysicalBound> = {
  temperature: {
    sensorType: 'temperature',
    canonicalUnit: 'celsius',
    label: 'Air Temperature',
    min: -20,
    max: 75
  },
  humidity: {
    sensorType: 'humidity',
    canonicalUnit: 'percent',
    label: 'Relative Humidity',
    min: 0,
    max: 100
  },
  soil_moisture: {
    sensorType: 'soil_moisture',
    canonicalUnit: 'percent',
    label: 'Soil Moisture',
    min: 0,
    max: 100
  },
  water_level: {
    sensorType: 'water_level',
    canonicalUnit: 'percent',
    label: 'Reservoir Water Level',
    min: 0,
    max: 100
  },
  sunlight: {
    sensorType: 'light_intensity',
    canonicalUnit: 'lux',
    label: 'Solar Light Intensity',
    min: 0,
    max: 200000
  },
  grow_light: {
    sensorType: 'supplemental_light',
    canonicalUnit: 'lux',
    label: 'Grow Light Intensity',
    min: 0,
    max: 200000
  },
  battery_voltage: {
    sensorType: 'battery_voltage',
    canonicalUnit: 'volts',
    label: 'Supply / Battery Voltage',
    min: 0,
    max: 60
  },
  vpd: {
    sensorType: 'vapor_pressure_deficit',
    canonicalUnit: 'kpa',
    label: 'Vapor Pressure Deficit',
    min: 0,
    max: 8
  },
  ph: {
    sensorType: 'soil_ph',
    canonicalUnit: 'ph',
    label: 'Root-Zone pH',
    min: 2.0,
    max: 11.0
  },
  ec: {
    sensorType: 'electrical_conductivity',
    canonicalUnit: 'ms_cm',
    label: 'Electrical Conductivity (EC)',
    min: 0,
    max: 15
  },
  co2: {
    sensorType: 'co2_concentration',
    canonicalUnit: 'ppm',
    label: 'CO2 Concentration',
    min: 200,
    max: 10000
  },
  rain_detected: {
    sensorType: 'rain_presence',
    canonicalUnit: 'boolean_0_1',
    label: 'Rain Detector',
    min: 0,
    max: 1
  }
};

function normalizeRawFieldToKey(rawKey: string): string | null {
  const k = rawKey.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['temperature', 'temp', 'temp_c', 'temperature_c', 'air_temperature', 'canopy_temperature'].includes(k)) {
    return 'temperature';
  }
  if (['humidity', 'rh', 'humidity_pct', 'relative_humidity', 'air_humidity'].includes(k)) {
    return 'humidity';
  }
  if (['soilmoisture', 'soil_moisture', 'soil_moisture_pct', 'soil', 'root_moisture'].includes(k)) {
    return 'soil_moisture';
  }
  if (['waterlevel', 'water_level', 'water_level_pct', 'tank_level', 'reservoir_level'].includes(k)) {
    return 'water_level';
  }
  if (['sunlight', 'light', 'lux', 'sunlight_lux', 'light_intensity', 'illuminance'].includes(k)) {
    return 'sunlight';
  }
  if (['growlight', 'grow_light', 'grow_light_lux'].includes(k)) {
    return 'grow_light';
  }
  if (['batteryvoltage', 'battery_voltage', 'voltage', 'vbat', 'supply_voltage'].includes(k)) {
    return 'battery_voltage';
  }
  if (['rain', 'rain_detected', 'raining', 'is_raining'].includes(k)) {
    return 'rain_detected';
  }
  if (['ph', 'soil_ph', 'water_ph'].includes(k)) {
    return 'ph';
  }
  if (['ec', 'ec_ms_cm', 'electrical_conductivity'].includes(k)) {
    return 'ec';
  }
  if (['co2', 'co2_ppm'].includes(k)) {
    return 'co2';
  }
  if (['vpd', 'vpd_kpa'].includes(k)) {
    return 'vpd';
  }
  return null;
}

function parseTimestampSafely(rawTs: unknown, fallbackIso: string): string {
  if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
    const ms = rawTs > 1e12 ? rawTs : rawTs * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof rawTs === 'string' && rawTs.trim()) {
    const d = new Date(rawTs.trim());
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallbackIso;
}

function extractFlatReadingsToStandard(params: {
  deviceId: string;
  timestampIso: string;
  fields: Record<string, unknown>;
  source: TelemetrySourceKind;
}): {
  standardReadings: StandardTelemetryModel[];
  mappedForController: Record<string, unknown>;
} {
  const standardReadings: StandardTelemetryModel[] = [];
  const mappedForController: Record<string, unknown> = {};

  for (const [rawKey, rawVal] of Object.entries(params.fields)) {
    if (rawVal === null || rawVal === undefined || rawVal === '') continue;
    const canonicalKey = normalizeRawFieldToKey(rawKey);
    if (!canonicalKey) continue;

    const spec = SENSOR_BOUNDS[canonicalKey];
    if (!spec) continue;

    let numericValue: number | null = null;
    if (canonicalKey === 'rain_detected') {
      if (typeof rawVal === 'boolean') numericValue = rawVal ? 1 : 0;
      else if (rawVal === 1 || rawVal === '1' || String(rawVal).toLowerCase() === 'on' || String(rawVal).toLowerCase() === 'wet') {
        numericValue = 1;
      } else if (rawVal === 0 || rawVal === '0' || String(rawVal).toLowerCase() === 'off' || String(rawVal).toLowerCase() === 'dry') {
        numericValue = 0;
      }
    } else if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
      numericValue = rawVal;
    } else if (typeof rawVal === 'string' && rawVal.trim() !== '' && !Number.isNaN(Number(rawVal))) {
      numericValue = Number(rawVal);
    }

    if (numericValue === null || !Number.isFinite(numericValue)) continue;

    const inBounds = numericValue >= spec.min && numericValue <= spec.max;
    const quality: TelemetryQuality = inBounds ? 'valid' : 'out_of_range';

    standardReadings.push({
      device_id: params.deviceId,
      sensor_id: `${params.deviceId}:${canonicalKey}`,
      sensor_type: spec.sensorType,
      value: Number(numericValue.toFixed(4)),
      unit: spec.canonicalUnit,
      timestamp: params.timestampIso,
      quality,
      source: params.source
    });

    if (quality === 'valid') {
      if (canonicalKey === 'temperature') mappedForController.temperature = numericValue;
      else if (canonicalKey === 'humidity') mappedForController.humidity = numericValue;
      else if (canonicalKey === 'soil_moisture') mappedForController.soilMoisture = numericValue;
      else if (canonicalKey === 'water_level') mappedForController.waterLevel = numericValue;
      else if (canonicalKey === 'sunlight') mappedForController.sunlight = numericValue;
      else if (canonicalKey === 'grow_light') mappedForController.growLight = numericValue;
      else if (canonicalKey === 'battery_voltage') mappedForController.batteryVoltage = numericValue;
      else if (canonicalKey === 'rain_detected') mappedForController.rain = numericValue === 1;
    }
  }

  return { standardReadings, mappedForController };
}

function buildValidatedTelemetryFromMapped(
  mapped: Record<string, unknown>,
  timestampIso: string,
  extraMeta?: {
    firmwareVersion?: string;
    wifiRssi?: number;
    uptimeSeconds?: number;
    actuators?: Record<string, boolean>;
  }
): ValidatedControllerTelemetry | undefined {
  const candidate = {
    timestamp: timestampIso,
    telemetry: {
      temperature: mapped.temperature ?? null,
      humidity: mapped.humidity ?? null,
      soilMoisture: mapped.soilMoisture ?? null,
      sunlight: mapped.sunlight ?? null,
      growLight: mapped.growLight ?? null,
      waterLevel: mapped.waterLevel ?? null,
      batteryVoltage: mapped.batteryVoltage ?? null,
      rain: mapped.rain ?? null
    },
    actuators: extraMeta?.actuators || {},
    deviceHealth: {
      firmwareVersion: extraMeta?.firmwareVersion || undefined,
      wifiRssi: extraMeta?.wifiRssi,
      uptimeSeconds: extraMeta?.uptimeSeconds,
      localSafetyControlActive: true
    }
  };
  const validated = validateControllerTelemetryPayload(candidate);
  return 'errorCode' in validated ? undefined : validated;
}

/**
 * Checks whether an arbitrary payload falsely claims to be simulated while targeting real hardware ingestion.
 */
function hasSimulatedMarker(obj: Record<string, unknown>): boolean {
  const src = String(obj.source || obj.dataSource || '').trim().toLowerCase();
  return src === 'simulated' || src === 'demo' || src === 'mock' || obj.simulated === true;
}

function createBuiltInAdapters(): Map<SupportedIotProtocol, ProtocolAdapterDefinition> {
  const adapters = new Map<SupportedIotProtocol, ProtocolAdapterDefinition>();

  // 1. MQTT Native & Home Assistant / ESPHome Auto-Discovery Adapter
  adapters.set('mqtt', {
    protocol: 'mqtt',
    displayName: 'MQTT v3.1.1 / v5.0 (EDENS + HA/ESPHome Auto-Discovery)',
    version: '1.0.0',
    upstreamLicense: 'MIT (aedes / mqtt.js) + Apache-2.0 (HA MQTT Discovery Spec)',
    supportsDiscovery: true,
    normalizePayload(rawPayload, context) {
      const nowIso = context.receivedAtIso || new Date().toISOString();
      const topic = context.topicOrPath || '';

      let parsed: Record<string, unknown>;
      if (Buffer.isBuffer(rawPayload) || typeof rawPayload === 'string') {
        const text = Buffer.isBuffer(rawPayload) ? rawPayload.toString('utf8').trim() : rawPayload.trim();
        // Support single-value ESPHome state topics: `<prefix>/sensor/<sensor_name>/state`
        const esphomeSensorMatch = topic.match(/\/(?:sensor|binary_sensor)\/([a-zA-Z0-9_-]+)\/state$/i);
        if (esphomeSensorMatch && !text.startsWith('{')) {
          const sensorSlug = esphomeSensorMatch[1];
          parsed = { [sensorSlug]: text };
        } else {
          try {
            parsed = JSON.parse(text);
          } catch {
            return {
              ok: false,
              errorCode: 'INVALID_MQTT_JSON',
              message: 'MQTT payload is neither valid JSON nor a recognized ESPHome sensor state.'
            };
          }
        }
      } else if (rawPayload && typeof rawPayload === 'object') {
        parsed = rawPayload as Record<string, unknown>;
      } else {
        return { ok: false, errorCode: 'EMPTY_MQTT_PAYLOAD', message: 'Empty MQTT payload.' };
      }

      if (hasSimulatedMarker(parsed)) {
        return {
          ok: false,
          errorCode: 'SIMULATED_DATA_REJECTED_ON_HARDWARE_CHANNEL',
          message: 'Simulated payloads cannot be ingested as real hardware MQTT telemetry.'
        };
      }

      // Check Home Assistant / ESPHome MQTT Auto-Discovery config topic:
      // `homeassistant/<component>/<node_id>/<object_id>/config`
      const haDiscoveryMatch = topic.match(/^homeassistant\/(sensor|binary_sensor|switch|fan|light)\/([^/]+)\/([^/]+)\/config$/i);
      if (haDiscoveryMatch) {
        const component = haDiscoveryMatch[1].toLowerCase();
        const objectId = haDiscoveryMatch[3];
        const devMeta = (parsed.device && typeof parsed.device === 'object' ? parsed.device : {}) as Record<string, unknown>;
        const unit = String(parsed.unit_of_measurement || (component === 'binary_sensor' ? 'boolean_0_1' : 'raw'));
        const devClass = String(parsed.device_class || objectId);
        const name = String(parsed.name || objectId);
        const stateTopic = typeof parsed.state_topic === 'string' ? parsed.state_topic : topic;

        return {
          ok: true,
          standardReadings: [],
          discoveredCapabilities: {
            manufacturer: devMeta.manufacturer ? String(devMeta.manufacturer) : 'Espressif / ESPHome',
            model: devMeta.model ? String(devMeta.model) : 'ESP32 Node',
            firmwareVersion: devMeta.sw_version ? String(devMeta.sw_version) : undefined,
            sensors:
              component === 'sensor' || component === 'binary_sensor'
                ? [{ id: objectId, type: devClass, label: name, unit, topic: stateTopic }]
                : [],
            actuators: ['switch', 'fan', 'light'].includes(component) ? [objectId] : []
          }
        };
      }

      // Check EDENS native nested `{ telemetry: {...} }` or flat JSON
      const nestedTel =
        parsed.telemetry && typeof parsed.telemetry === 'object'
          ? (parsed.telemetry as Record<string, unknown>)
          : parsed;
      const tsIso = parseTimestampSafely(parsed.timestamp ?? nestedTel.timestamp, nowIso);

      const { standardReadings, mappedForController } = extractFlatReadingsToStandard({
        deviceId: context.deviceId,
        timestampIso: tsIso,
        fields: nestedTel,
        source: 'real_hardware'
      });

      let controllerTelemetry: ValidatedControllerTelemetry | undefined;
      if (parsed.telemetry && typeof parsed.telemetry === 'object') {
        const fullValidated = validateControllerTelemetryPayload(parsed);
        if (!('errorCode' in fullValidated)) {
          controllerTelemetry = fullValidated;
        }
      }
      if (!controllerTelemetry && Object.keys(mappedForController).length > 0) {
        controllerTelemetry = buildValidatedTelemetryFromMapped(mappedForController, tsIso, {
          firmwareVersion: typeof parsed.firmwareVersion === 'string' ? parsed.firmwareVersion : undefined
        });
      }

      const capBlock =
        parsed.capabilities && typeof parsed.capabilities === 'object'
          ? (parsed.capabilities as Record<string, unknown>)
          : null;

      return {
        ok: true,
        controllerTelemetry,
        standardReadings,
        discoveredCapabilities: capBlock
          ? {
              manufacturer: typeof parsed.manufacturer === 'string' ? parsed.manufacturer : undefined,
              model: typeof parsed.model === 'string' ? parsed.model : undefined,
              firmwareVersion: typeof parsed.firmwareVersion === 'string' ? parsed.firmwareVersion : undefined,
              sensors: Array.isArray(capBlock.sensors)
                ? capBlock.sensors.map((s) => ({
                    id: String(s),
                    type: String(s),
                    label: String(s),
                    unit: SENSOR_BOUNDS[normalizeRawFieldToKey(String(s)) || '']?.canonicalUnit || 'unit'
                  }))
                : undefined,
              actuators: Array.isArray(capBlock.actuators) ? capBlock.actuators.map(String) : undefined
            }
          : undefined
      };
    }
  });

  // 2. ESPHome 2026.10.2 Web Server v3 / Native Discovery Adapter
  adapters.set('esphome_api', {
    protocol: 'esphome_api',
    displayName: 'ESPHome 2026.10.2 REST / Event-Stream Discovery Adapter',
    version: '2026.10.2',
    upstreamLicense: 'MIT (Python/Schema) • GPL-3.0 (Firmware Runtime)',
    supportsDiscovery: true,
    normalizePayload(rawPayload, context) {
      const nowIso = context.receivedAtIso || new Date().toISOString();
      if (!rawPayload || typeof rawPayload !== 'object') {
        return { ok: false, errorCode: 'INVALID_ESPHOME_PAYLOAD', message: 'Expected ESPHome JSON object or entity list.' };
      }

      const body = rawPayload as Record<string, unknown>;
      if (hasSimulatedMarker(body)) {
        return {
          ok: false,
          errorCode: 'SIMULATED_DATA_REJECTED',
          message: 'Simulated payloads cannot be ingested via ESPHome hardware adapter.'
        };
      }

      const entities: Array<Record<string, unknown>> = Array.isArray(body.entities)
        ? (body.entities as Array<Record<string, unknown>>)
        : [body];

      const flatFields: Record<string, unknown> = {};
      const discoveredSensors: Array<{ id: string; type: string; label: string; unit: string }> = [];
      const discoveredActuators: string[] = [];

      for (const ent of entities) {
        const entId = String(ent.id || ent.object_id || '').trim();
        if (!entId) continue;
        const domain = entId.includes('-') ? entId.split('-')[0] : String(ent.domain || 'sensor');
        const slug = entId.includes('-') ? entId.split('-').slice(1).join('_') : entId;

        if (domain === 'switch' || domain === 'fan' || domain === 'light') {
          discoveredActuators.push(slug);
          continue;
        }

        const val = ent.value;
        const unit = String(ent.unit_of_measurement || ent.uom || '');
        discoveredSensors.push({
          id: slug,
          type: normalizeRawFieldToKey(slug) || slug,
          label: String(ent.name || slug),
          unit: unit || 'raw'
        });

        if (val !== null && val !== undefined && !Number.isNaN(Number(val))) {
          flatFields[slug] = val;
        }
      }

      const { standardReadings, mappedForController } = extractFlatReadingsToStandard({
        deviceId: context.deviceId,
        timestampIso: nowIso,
        fields: flatFields,
        source: 'real_hardware'
      });

      const controllerTelemetry =
        Object.keys(mappedForController).length > 0
          ? buildValidatedTelemetryFromMapped(mappedForController, nowIso, {
              firmwareVersion: typeof body.esphome_version === 'string' ? `ESPHome-${body.esphome_version}` : undefined
            })
          : undefined;

      return {
        ok: true,
        controllerTelemetry,
        standardReadings,
        discoveredCapabilities: {
          manufacturer: String(body.manufacturer || 'Espressif (ESPHome)'),
          model: String(body.board || body.model || 'ESP32'),
          firmwareVersion: typeof body.esphome_version === 'string' ? `ESPHome-${body.esphome_version}` : undefined,
          sensors: discoveredSensors,
          actuators: discoveredActuators
        }
      };
    }
  });

  // 3. ThingsBoard CE v4.3.1.8 (Apache-2.0) Telemetry & Attributes Adapter
  adapters.set('thingsboard_v1', {
    protocol: 'thingsboard_v1',
    displayName: 'ThingsBoard CE v4.3.1.8 Telemetry/Attributes Adapter (Apache-2.0)',
    version: '4.3.1.8-compat',
    upstreamLicense: 'Apache-2.0 (Pinned <= v4.3.1.8; avoids v4.4.0+ BUSL-1.1)',
    supportsDiscovery: true,
    normalizePayload(rawPayload, context) {
      const nowIso = context.receivedAtIso || new Date().toISOString();
      if (!rawPayload || typeof rawPayload !== 'object') {
        return {
          ok: false,
          errorCode: 'INVALID_THINGSBOARD_JSON',
          message: 'ThingsBoard v1 telemetry payload must be a JSON object or array of {ts, values}.'
        };
      }

      const entries = Array.isArray(rawPayload) ? rawPayload : [rawPayload];
      const allReadings: StandardTelemetryModel[] = [];
      let latestMapped: Record<string, unknown> = {};
      let latestTsIso = nowIso;

      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const rec = entry as Record<string, unknown>;
        if (hasSimulatedMarker(rec)) {
          return {
            ok: false,
            errorCode: 'SIMULATED_DATA_REJECTED',
            message: 'Simulated payloads cannot be ingested on ThingsBoard hardware endpoint.'
          };
        }
        const valuesObj =
          rec.values && typeof rec.values === 'object' ? (rec.values as Record<string, unknown>) : rec;
        const tsIso = parseTimestampSafely(rec.ts, nowIso);
        const { standardReadings, mappedForController } = extractFlatReadingsToStandard({
          deviceId: context.deviceId,
          timestampIso: tsIso,
          fields: valuesObj,
          source: 'real_hardware'
        });
        allReadings.push(...standardReadings);
        if (Object.keys(mappedForController).length > 0) {
          latestMapped = { ...latestMapped, ...mappedForController };
          latestTsIso = tsIso;
        }
      }

      const controllerTelemetry =
        Object.keys(latestMapped).length > 0
          ? buildValidatedTelemetryFromMapped(latestMapped, latestTsIso)
          : undefined;

      return {
        ok: true,
        controllerTelemetry,
        standardReadings: allReadings
      };
    }
  });

  // 4. Native HTTP/REST Adapter
  adapters.set('http_rest', {
    protocol: 'http_rest',
    displayName: 'EDENS Native HTTPS / Local LAN HTTP REST Adapter',
    version: '2.0.0',
    upstreamLicense: 'Apache-2.0',
    supportsDiscovery: true,
    normalizePayload(rawPayload, context) {
      const mqttAdapter = adapters.get('mqtt')!;
      return mqttAdapter.normalizePayload(rawPayload, context);
    }
  });

  // 5. Authenticated Device WebSocket Adapter
  adapters.set('websocket', {
    protocol: 'websocket',
    displayName: 'EDENS Real-Time Device WebSocket Adapter',
    version: '1.0.0',
    upstreamLicense: 'MIT (ws)',
    supportsDiscovery: true,
    normalizePayload(rawPayload, context) {
      const mqttAdapter = adapters.get('mqtt')!;
      return mqttAdapter.normalizePayload(rawPayload, context);
    }
  });

  return adapters;
}

export class UniversalDeviceAdapter {
  private readonly platformDb: PlatformDatabase;
  private readonly getCameraStore: (greenhouseId: string) => CameraImageStore;
  private readonly adapters: Map<SupportedIotProtocol, ProtocolAdapterDefinition>;
  private readonly listeners = new Set<
    (event: {
      type: 'device:updated' | 'telemetry:received' | 'camera:captured';
      greenhouseId: string;
      deviceId: string;
      payload: unknown;
    }) => void
  >();

  constructor(deps: {
    platformDb: PlatformDatabase;
    getCameraStore: (greenhouseId: string) => CameraImageStore;
  }) {
    this.platformDb = deps.platformDb;
    this.getCameraStore = deps.getCameraStore;
    this.adapters = createBuiltInAdapters();
  }

  public registerProtocolAdapter(definition: ProtocolAdapterDefinition): void {
    this.adapters.set(definition.protocol, definition);
  }

  public listSupportedProtocols(): Array<{
    protocol: SupportedIotProtocol;
    displayName: string;
    version: string;
    upstreamLicense: string;
    supportsDiscovery: boolean;
  }> {
    return Array.from(this.adapters.values()).map((a) => ({
      protocol: a.protocol,
      displayName: a.displayName,
      version: a.version,
      upstreamLicense: a.upstreamLicense,
      supportsDiscovery: a.supportsDiscovery
    }));
  }

  public onNormalizedEvent(
    listener: (event: {
      type: 'device:updated' | 'telemetry:received' | 'camera:captured';
      greenhouseId: string;
      deviceId: string;
      payload: unknown;
    }) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitEvent(event: {
    type: 'device:updated' | 'telemetry:received' | 'camera:captured';
    greenhouseId: string;
    deviceId: string;
    payload: unknown;
  }): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // Never allow an observer failure to disrupt telemetry persistence
      }
    }
  }

  public recordConnectionTransition(params: {
    deviceId: string;
    greenhouseId: string;
    protocol: SupportedIotProtocol;
    newState: NormalizedConnectionState;
    reason?: string;
    remoteAddr?: string | null;
  }): void {
    const driver = this.platformDb.getDriver();
    const lastRow = driver.queryOne<{ new_state: string }>(
      'SELECT new_state FROM iot_device_connection_history WHERE device_id = ? ORDER BY recorded_at DESC LIMIT 1',
      [params.deviceId]
    );
    const previousState = lastRow ? String(lastRow.new_state) : null;
    if (previousState === params.newState && !params.reason) {
      return;
    }

    const nowIso = new Date().toISOString();
    driver.run(
      `INSERT INTO iot_device_connection_history (
         id, device_id, greenhouse_id, protocol, previous_state, new_state, reason, remote_addr, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateSecureId('connhist', 8),
        params.deviceId,
        params.greenhouseId,
        params.protocol,
        previousState,
        params.newState,
        params.reason ? redactSecretsFromText(params.reason).slice(0, 200) : null,
        params.remoteAddr || null,
        nowIso
      ]
    );

    driver.run(
      'UPDATE devices SET protocol = ?, updated_at = ? WHERE id = ?',
      [params.protocol, nowIso, params.deviceId]
    );
  }

  /**
   * Normalizes and persists incoming device telemetry or capability announcements across any supported protocol.
   */
  public ingestDevicePayload(params: {
    protocol: SupportedIotProtocol;
    device: DeviceRecord;
    rawPayload: unknown;
    topicOrPath?: string;
    remoteAddr?: string;
  }): NormalizedIngestionResult {
    const adapter = this.adapters.get(params.protocol);
    if (!adapter) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'UNSUPPORTED_PROTOCOL',
        message: `Protocol "${params.protocol}" is not registered in UniversalDeviceAdapter.`,
        protocol: params.protocol,
        telemetryRecords: []
      };
    }

    const nowIso = new Date().toISOString();
    const normalized = adapter.normalizePayload(params.rawPayload, {
      deviceId: params.device.id,
      greenhouseId: params.device.greenhouseId,
      zoneId: params.device.zoneId || null,
      topicOrPath: params.topicOrPath,
      receivedAtIso: nowIso
    });

    if ('errorCode' in normalized) {
      this.platformDb.recordDeviceError({
        greenhouseId: params.device.greenhouseId,
        deviceId: params.device.id,
        category: 'CONNECTION',
        errorCode: normalized.errorCode,
        message: normalized.message,
        ipAddress: params.remoteAddr || null
      });
      return {
        ok: false,
        statusCode: 400,
        errorCode: normalized.errorCode,
        message: normalized.message,
        protocol: params.protocol,
        telemetryRecords: []
      };
    }

    const driver = this.platformDb.getDriver();

    // Update manufacturer / model / protocol metadata if discovered
    if (normalized.discoveredCapabilities) {
      const dc = normalized.discoveredCapabilities;
      driver.run(
        `UPDATE devices
         SET manufacturer = COALESCE(?, manufacturer),
             hardware_model = COALESCE(?, hardware_model),
             firmware_version = COALESCE(?, firmware_version),
             protocol = ?,
             updated_at = ?
         WHERE id = ?`,
        [
          dc.manufacturer || null,
          dc.model || null,
          dc.firmwareVersion || null,
          params.protocol,
          nowIso,
          params.device.id
        ]
      );

      if (dc.sensors && dc.sensors.length > 0) {
        for (const s of dc.sensors) {
          driver.run(
            `INSERT INTO iot_sensor_registry (
               id, device_id, greenhouse_id, zone_id, sensor_id, sensor_type,
               display_label, unit, protocol_topic_or_path, last_quality, last_source,
               discovery_origin, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unavailable', 'real_hardware', ?, ?)
             ON CONFLICT(device_id, sensor_id) DO UPDATE SET
               sensor_type = excluded.sensor_type,
               display_label = excluded.display_label,
               unit = excluded.unit,
               protocol_topic_or_path = COALESCE(excluded.protocol_topic_or_path, iot_sensor_registry.protocol_topic_or_path),
               discovery_origin = excluded.discovery_origin,
               updated_at = excluded.updated_at`,
            [
              generateSecureId('sens', 8),
              params.device.id,
              params.device.greenhouseId,
              params.device.zoneId || null,
              `${params.device.id}:${s.id}`,
              s.type,
              s.label,
              s.unit,
              s.topic || params.topicOrPath || null,
              `${params.protocol}_discovery`,
              nowIso
            ]
          );
        }
      }

      if (dc.actuators && dc.actuators.length > 0) {
        this.platformDb.repositories.zonesAndHardware.syncReportedCapabilities(
          params.device.greenhouseId,
          params.device.id,
          {
            sensors: (dc.sensors || []).map((s) => s.id),
            actuators: dc.actuators
          }
        );
      }
    } else {
      driver.run('UPDATE devices SET protocol = ?, updated_at = ? WHERE id = ?', [
        params.protocol,
        nowIso,
        params.device.id
      ]);
    }

    // Persist individual normalized sensor state in iot_sensor_registry
    for (const reading of normalized.standardReadings) {
      const boundKey = reading.sensor_id.split(':').pop() || reading.sensor_type;
      const label = SENSOR_BOUNDS[boundKey]?.label || reading.sensor_type;
      driver.run(
        `INSERT INTO iot_sensor_registry (
           id, device_id, greenhouse_id, zone_id, sensor_id, sensor_type,
           display_label, unit, protocol_topic_or_path, last_value, last_quality,
           last_source, last_timestamp, discovery_origin, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id, sensor_id) DO UPDATE SET
           last_value = excluded.last_value,
           last_quality = excluded.last_quality,
           last_source = excluded.last_source,
           last_timestamp = excluded.last_timestamp,
           protocol_topic_or_path = COALESCE(excluded.protocol_topic_or_path, iot_sensor_registry.protocol_topic_or_path),
           updated_at = excluded.updated_at`,
        [
          generateSecureId('sens', 8),
          params.device.id,
          params.device.greenhouseId,
          params.device.zoneId || null,
          reading.sensor_id,
          reading.sensor_type,
          label,
          reading.unit,
          params.topicOrPath || null,
          reading.value,
          reading.quality,
          reading.source,
          reading.timestamp,
          params.protocol,
          nowIso
        ]
      );
    }

    let readingId: string | undefined;
    if (normalized.controllerTelemetry) {
      const stored = this.platformDb.storeControllerTelemetry({
        greenhouseId: params.device.greenhouseId,
        deviceId: params.device.id,
        zoneId: params.device.zoneId || null,
        telemetry: normalized.controllerTelemetry,
        ipAddress: params.remoteAddr
      });
      readingId = stored.readingId;
    } else {
      this.platformDb.recordDeviceCheckIn({
        deviceId: params.device.id,
        greenhouseId: params.device.greenhouseId,
        firmwareVersion: normalized.discoveredCapabilities?.firmwareVersion,
        ipAddress: params.remoteAddr,
        checkInKind: 'telemetry_upload',
        dataTimestamp: nowIso
      });
    }

    this.recordConnectionTransition({
      deviceId: params.device.id,
      greenhouseId: params.device.greenhouseId,
      protocol: params.protocol,
      newState: 'online',
      remoteAddr: params.remoteAddr || null
    });

    const stdDevice = this.getStandardDeviceModel(params.device.greenhouseId, params.device.id);
    if (stdDevice) {
      this.emitEvent({
        type: 'device:updated',
        greenhouseId: params.device.greenhouseId,
        deviceId: params.device.id,
        payload: stdDevice
      });
    }
    if (normalized.standardReadings.length > 0) {
      this.emitEvent({
        type: 'telemetry:received',
        greenhouseId: params.device.greenhouseId,
        deviceId: params.device.id,
        payload: normalized.standardReadings
      });
    }

    return {
      ok: true,
      statusCode: 200,
      readingId,
      protocol: params.protocol,
      device: stdDevice || undefined,
      telemetryRecords: normalized.standardReadings
    };
  }

  /**
   * Builds the canonical StandardDeviceModel for a specific device in a greenhouse.
   */
  public getStandardDeviceModel(
    greenhouseId: string,
    deviceId: string,
    nowMs: number = Date.now()
  ): StandardDeviceModel | null {
    const devices = this.platformDb.listDevicesForGreenhouse(greenhouseId, nowMs);
    const dev = devices.find((d) => d.id === deviceId);
    if (!dev) return null;
    return this.mapDeviceRecordToStandard(dev, nowMs);
  }

  public listStandardDevicesForGreenhouse(
    greenhouseId: string,
    nowMs: number = Date.now()
  ): StandardDeviceModel[] {
    const devices = this.platformDb.listDevicesForGreenhouse(greenhouseId, nowMs);
    return devices.map((d) => this.mapDeviceRecordToStandard(d, nowMs));
  }

  public listRecentStandardTelemetry(
    greenhouseId: string,
    options: { zoneId?: string | null; sourceFilter?: TelemetrySourceKind } = {},
    nowMs: number = Date.now()
  ): StandardTelemetryModel[] {
    const driver = this.platformDb.getDriver();
    const rows = options.zoneId
      ? driver.queryAll<any>(
          `SELECT * FROM iot_sensor_registry
           WHERE greenhouse_id = ? AND zone_id = ? AND last_value IS NOT NULL
           ORDER BY updated_at DESC`,
          [greenhouseId, options.zoneId]
        )
      : driver.queryAll<any>(
          `SELECT * FROM iot_sensor_registry
           WHERE greenhouse_id = ? AND last_value IS NOT NULL
           ORDER BY updated_at DESC`,
          [greenhouseId]
        );

    const out: StandardTelemetryModel[] = [];
    for (const r of rows) {
      const source: TelemetrySourceKind =
        String(r.last_source) === 'simulated' ? 'simulated' : 'real_hardware';
      if (options.sourceFilter && source !== options.sourceFilter) continue;

      const ts = r.last_timestamp ? String(r.last_timestamp) : String(r.updated_at);
      const ageSec = Math.max(0, Math.floor((nowMs - new Date(ts).getTime()) / 1000));
      let quality = (String(r.last_quality || 'valid') as TelemetryQuality);
      if (quality === 'valid' && ageSec > 90) {
        quality = 'stale';
      }

      out.push({
        device_id: String(r.device_id),
        sensor_id: String(r.sensor_id),
        sensor_type: String(r.sensor_type),
        value: Number(r.last_value),
        unit: String(r.unit),
        timestamp: ts,
        quality,
        source
      });
    }

    // If telemetry came through legacy `POST /api/telemetry/upload` before `iot_sensor_registry` existed,
    // project the latest verified SQLite `telemetry_readings` row cleanly without fabricating values.
    if (out.length === 0 && options.sourceFilter !== 'simulated') {
      const latest = this.platformDb.getLatestTelemetryForGreenhouse(
        greenhouseId,
        nowMs,
        options.zoneId ? { zoneId: options.zoneId } : undefined
      );
      if (latest.readings && latest.deviceId && latest.timestamp) {
        const quality: TelemetryQuality = latest.dataSource === 'REAL_HARDWARE' ? 'valid' : 'stale';
        const pairs: Array<[string, number | boolean | null | undefined]> = [
          ['temperature', latest.readings.temperature],
          ['humidity', latest.readings.humidity],
          ['soil_moisture', latest.readings.soilMoisture],
          ['water_level', latest.readings.waterLevel],
          ['sunlight', latest.readings.sunlight],
          ['grow_light', latest.readings.growLight],
          ['battery_voltage', latest.readings.batteryVoltage],
          ['rain_detected', latest.readings.rain === null ? null : latest.readings.rain ? 1 : 0]
        ];
        for (const [key, val] of pairs) {
          if (typeof val === 'number' && Number.isFinite(val)) {
            const spec = SENSOR_BOUNDS[key];
            out.push({
              device_id: latest.deviceId,
              sensor_id: `${latest.deviceId}:${key}`,
              sensor_type: spec.sensorType,
              value: val,
              unit: spec.canonicalUnit,
              timestamp: latest.timestamp,
              quality,
              source: 'real_hardware'
            });
          }
        }
      }
    }

    return out;
  }

  public getDeviceConnectionHistory(greenhouseId: string, deviceId: string, limit: number = 30) {
    const driver = this.platformDb.getDriver();
    const connRows = driver.queryAll<any>(
      `SELECT id, protocol, previous_state, new_state, reason, remote_addr, recorded_at
       FROM iot_device_connection_history
       WHERE greenhouse_id = ? AND device_id = ?
       ORDER BY recorded_at DESC
       LIMIT ?`,
      [greenhouseId, deviceId, Math.max(1, Math.min(200, limit))]
    );
    const fwRows = driver.queryAll<any>(
      `SELECT id, previous_version, reported_version, target_version, release_channel, update_status, recorded_at
       FROM device_firmware_history
       WHERE greenhouse_id = ? AND device_id = ?
       ORDER BY recorded_at DESC
       LIMIT 20`,
      [greenhouseId, deviceId]
    );

    return {
      connectionTransitions: connRows.map((r) => ({
        id: String(r.id),
        protocol: String(r.protocol),
        previousState: r.previous_state ? String(r.previous_state) : null,
        newState: String(r.new_state),
        reason: r.reason ? String(r.reason) : null,
        remoteAddr: r.remote_addr ? String(r.remote_addr) : null,
        recordedAt: String(r.recorded_at)
      })),
      firmwareHistory: fwRows.map((f) => ({
        id: String(f.id),
        previousVersion: f.previous_version ? String(f.previous_version) : null,
        reportedVersion: String(f.reported_version),
        targetVersion: f.target_version ? String(f.target_version) : null,
        releaseChannel: String(f.release_channel),
        updateStatus: String(f.update_status),
        recordedAt: String(f.recorded_at)
      }))
    };
  }

  /**
   * Performs authenticated, SSRF-guarded ESPHome HTTP v3 discovery on a local LAN node
   * or loopback test adapter. Never claims arbitrary IP addresses are compatible unless
   * verified ESPHome JSON entity responses are returned.
   */
  public async discoverEspHomeDeviceOverHttp(params: {
    greenhouseId: string;
    deviceId: string;
    baseUrl: string;
    sensorIds?: string[];
    bearerOrBasicAuth?: string;
  }): Promise<
    | {
        ok: true;
        device: StandardDeviceModel;
        discoveredEntitiesCount: number;
        telemetryRecords: StandardTelemetryModel[];
      }
    | { ok: false; statusCode: number; errorCode: string; message: string }
  > {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(params.baseUrl.trim());
    } catch {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_ESPHOME_URL',
        message: 'Invalid ESPHome HTTP URL.'
      };
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_SCHEME',
        message: 'ESPHome discovery supports http:// or https:// only.'
      };
    }
    if (parsedUrl.username || parsedUrl.password) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'CREDENTIALS_IN_URL_FORBIDDEN',
        message: 'Do not embed credentials inside URLs.'
      };
    }

    const host = parsedUrl.hostname.toLowerCase();
    const isLoopback = host === '127.0.0.1' || host === 'localhost';
    const isLocalLan = isPrivateRfc1918Ipv4(host) || host.endsWith('.local');

    if (!isLoopback && !isLocalLan) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'SSRF_NON_LAN_HOST_BLOCKED',
        message: 'Direct ESPHome HTTP discovery is restricted to private LAN or local test hosts.'
      };
    }

    const isCloud = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL || process.env.FLY_APP_NAME);
    if (isCloud && isLocalLan && !isLoopback) {
      return {
        ok: false,
        statusCode: 502,
        errorCode: 'PRIVATE_LAN_UNREACHABLE_FROM_CLOUD',
        message: `Cloud server cannot reach private LAN ESPHome node (${host}). Configure outbound MQTT-over-WSS to /api/iot/mqtt-ws instead.`
      };
    }

    const devices = this.platformDb.listDevicesForGreenhouse(params.greenhouseId);
    const dev = devices.find((d) => d.id === params.deviceId);
    if (!dev) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'DEVICE_NOT_FOUND',
        message: 'Target device slot not found in this greenhouse.'
      };
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (params.bearerOrBasicAuth) {
      headers.Authorization = params.bearerOrBasicAuth;
    }

    const origin = parsedUrl.origin;
    const candidatePaths =
      params.sensorIds && params.sensorIds.length > 0
        ? params.sensorIds.map((id) => (id.startsWith('/') ? id : `/sensor/${id}`))
        : ['/esphome/manifest', '/sensor/temperature', '/sensor/humidity', '/sensor/soil_moisture', '/sensor/water_level'];

    const entities: Array<Record<string, unknown>> = [];
    let esphomeVersion: string | undefined;
    let boardModel: string | undefined;

    for (const p of candidatePaths) {
      try {
        const resp = await fetch(`${origin}${p}`, {
          method: 'GET',
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(3500)
        });
        if (!resp.ok) continue;
        const ct = String(resp.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('application/json')) continue;
        const json = (await resp.json()) as Record<string, unknown>;
        if (Array.isArray(json.entities)) {
          if (typeof json.esphome_version === 'string') esphomeVersion = json.esphome_version;
          if (typeof json.board === 'string') boardModel = json.board;
          for (const e of json.entities) {
            if (e && typeof e === 'object') entities.push(e as Record<string, unknown>);
          }
          break;
        }
        // Standard ESPHome v2/v3 REST sensor JSON requires `id` and (`state` or `value`)
        if (typeof json.id === 'string' && ('value' in json || 'state' in json)) {
          entities.push(json);
        }
      } catch {
        // Probe next candidate endpoint
      }
    }

    if (entities.length === 0) {
      return {
        ok: false,
        statusCode: 422,
        errorCode: 'INCOMPATIBLE_DEVICE_PROTOCOL',
        message:
          'Target endpoint did not return authenticated ESPHome v3 JSON sensor entities. Arbitrary IP addresses are never marked compatible without verified protocol discovery.'
      };
    }

    const ingested = this.ingestDevicePayload({
      protocol: 'esphome_api',
      device: dev,
      rawPayload: {
        esphome_version: esphomeVersion || '2026.10.2',
        board: boardModel || 'esp32dev',
        entities
      },
      topicOrPath: origin,
      remoteAddr: host
    });

    if (!ingested.ok || !ingested.device) {
      return {
        ok: false,
        statusCode: ingested.statusCode,
        errorCode: ingested.errorCode || 'DISCOVERY_INGEST_FAILED',
        message: ingested.message || 'Failed to normalize discovered ESPHome entities.'
      };
    }

    return {
      ok: true,
      device: ingested.device,
      discoveredEntitiesCount: entities.length,
      telemetryRecords: ingested.telemetryRecords
    };
  }

  private mapDeviceRecordToStandard(dev: DeviceRecord, nowMs: number): StandardDeviceModel {
    const driver = this.platformDb.getDriver();
    const rawDevRow = driver.queryOne<{
      manufacturer: string | null;
      hardware_model: string | null;
      protocol: string | null;
    }>('SELECT manufacturer, hardware_model, protocol FROM devices WHERE id = ?', [dev.id]);

    const protocol = (rawDevRow?.protocol || 'http_rest') as SupportedIotProtocol;
    const manufacturer = rawDevRow?.manufacturer || 'Espressif';
    const model =
      rawDevRow?.hardware_model ||
      (dev.deviceType === 'esp32_cam' ? 'AI-Thinker ESP32-CAM (OV2640)' : 'ESP32 Greenhouse Node');

    let connectionState: NormalizedConnectionState = 'offline';
    let uiStatusLabel: UiHardwareBannerState = 'DISCONNECTED';
    let dataProvenanceLabel: StandardDeviceModel['data_provenance_label'] = 'DISCONNECTED';

    switch (dev.explicitState) {
      case 'ONLINE':
        connectionState = 'online';
        uiStatusLabel = 'CONNECTED';
        dataProvenanceLabel = 'REAL HARDWARE DATA';
        break;
      case 'STALE':
        connectionState = 'stale';
        uiStatusLabel = 'STALE DATA';
        dataProvenanceLabel = 'STALE DATA';
        break;
      case 'CONFIGURATION_REQUIRED':
      case 'WAITING_FOR_FIRST_CONNECTION':
        connectionState = 'unprovisioned';
        uiStatusLabel = 'DISCONNECTED';
        dataProvenanceLabel = 'DISCONNECTED';
        break;
      case 'AUTHENTICATION_ERROR':
      case 'CONNECTION_ERROR':
        connectionState = dev.revokedAt ? 'revoked' : 'reconnecting';
        uiStatusLabel = dev.revokedAt ? 'DISCONNECTED' : 'RECONNECTING';
        dataProvenanceLabel = 'DISCONNECTED';
        break;
      case 'OFFLINE':
      default:
        connectionState = 'offline';
        uiStatusLabel = 'DISCONNECTED';
        dataProvenanceLabel = 'DISCONNECTED';
        break;
    }

    const sensorRows = driver.queryAll<any>(
      'SELECT * FROM iot_sensor_registry WHERE device_id = ? ORDER BY sensor_type ASC',
      [dev.id]
    );
    const sensors: StandardSensorDescriptor[] = sensorRows.map((s) => {
      const ts = s.last_timestamp ? String(s.last_timestamp) : null;
      const ageSec = ts ? Math.max(0, Math.floor((nowMs - new Date(ts).getTime()) / 1000)) : null;
      let quality = (s.last_quality || 'unavailable') as TelemetryQuality;
      if (quality === 'valid' && ageSec !== null && ageSec > 90) {
        quality = 'stale';
      }
      return {
        sensor_id: String(s.sensor_id),
        sensor_type: String(s.sensor_type),
        label: String(s.display_label),
        unit: String(s.unit),
        value: s.last_value !== null && s.last_value !== undefined ? Number(s.last_value) : null,
        quality,
        source: String(s.last_source) === 'simulated' ? 'simulated' : 'real_hardware',
        timestamp: ts,
        discovery_origin: String(s.discovery_origin || 'reported')
      };
    });

    const capList = this.platformDb.repositories.zonesAndHardware.listDeviceCapabilities(
      dev.greenhouseId,
      dev.id
    );
    const capabilityNames = capList.map((c) => `${c.capabilityKind}:${c.channelKey}`);

    const actuators: StandardActuatorDescriptor[] = capList
      .filter((c) => c.capabilityKind === 'actuator')
      .map((c) => ({
        actuator_id: `${dev.id}:${c.channelKey}`,
        actuator_type: c.channelKey,
        label: c.displayLabel,
        current_state: 'off',
        physical_control_enabled: false,
        safety_locked: true
      }));

    const cameras: StandardCameraDescriptor[] = [];
    if (dev.deviceType === 'esp32_cam') {
      const camRow = driver.queryOne<any>(
        'SELECT * FROM iot_camera_registry WHERE device_id = ? LIMIT 1',
        [dev.id]
      );
      const camStore = this.getCameraStore(dev.greenhouseId);
      const latestEntry = camStore.getLatest(nowMs);
      const lastCapIso =
        latestEntry?.frame.capturedAt ||
        (camRow?.last_capture_at ? String(camRow.last_capture_at) : dev.lastUploadAt);
      const freshSec = lastCapIso
        ? Math.max(0, Math.floor((nowMs - new Date(lastCapIso).getTime()) / 1000))
        : null;

      cameras.push({
        camera_id: camRow ? String(camRow.camera_id) : `${dev.id}:primary_cam`,
        stream_url: camRow?.stream_url ? String(camRow.stream_url) : null,
        photo_url: camRow?.photo_url ? String(camRow.photo_url) : null,
        status_url: camRow?.status_url ? String(camRow.status_url) : null,
        transport_mode: (camRow?.transport_mode as StandardCameraDescriptor['transport_mode']) || 'cloud_upload',
        connection_state: connectionState,
        last_capture_at: lastCapIso || null,
        last_frame_id:
          latestEntry?.frame.id || (camRow?.last_frame_id ? String(camRow.last_frame_id) : null),
        freshness_seconds: freshSec
      });
    }

    return {
      device_id: dev.id,
      greenhouse_id: dev.greenhouseId,
      zone_id: dev.zoneId || null,
      device_type: dev.deviceType === 'esp32_cam' ? 'greenhouse_camera' : 'greenhouse_controller',
      manufacturer,
      model,
      firmware_version: dev.firmwareVersion,
      protocol,
      connection_state: connectionState,
      ui_status_label: uiStatusLabel,
      data_provenance_label: dataProvenanceLabel,
      explicit_state: dev.explicitState,
      last_seen: dev.lastSeenAt,
      age_seconds: dev.ageSeconds,
      label: dev.label,
      key_prefix: dev.keyPrefix || dev.credentialPrefix,
      replaced_by_device_id: dev.replacedByDeviceId || null,
      capabilities: capabilityNames,
      sensors,
      cameras,
      actuators
    };
  }
}

/**
 * Generates a ready-to-flash ESPHome 2026.10.2 YAML template for an enrolled EDENS AI device.
 * Never invents GPIO mappings, sensor IC models, or relay polarity — leaves explicit
 * hardware-engineer substitutions and enforces local Tier-1 safety interlocks.
 */
export function generateEspHomeDeviceYaml(params: {
  greenhouseId: string;
  zoneId: string | null;
  deviceId: string;
  deviceLabel: string;
  deviceType: 'esp32_controller' | 'esp32_cam';
  mqttHost: string;
  mqttPort: number;
  useMqttWsTls: boolean;
}): string {
  const safeNodeName = params.deviceId.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 28);

  if (params.deviceType === 'esp32_cam') {
    return `# ==============================================================================
# EDENS AI — ESPHome 2026.10.2 Reference Camera Configuration
# Device ID: ${params.deviceId}  |  Greenhouse: ${params.greenhouseId}
# Upstream Runtime License: GPL-3.0 (ESPHome C++ firmware) / MIT (YAML schema)
# ==============================================================================
substitutions:
  node_name: "${safeNodeName}"
  friendly_name: "${params.deviceLabel.replace(/"/g, '')}"
  greenhouse_id: "${params.greenhouseId}"
  device_id: "${params.deviceId}"

esphome:
  name: \${node_name}
  friendly_name: \${friendly_name}

esp32:
  board: esp32cam
  framework:
    type: arduino

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password
  ap:
    ssid: "EDENS-CAM-\${device_id}"
    password: !secret fallback_ap_password

captive_portal:

logger:
  level: INFO

ota:
  - platform: esphome
    password: !secret ota_password

# AI-Thinker ESP32-CAM OV2640 Standard Pinout (Verify with hardware engineer if custom PCB)
esp32_camera:
  name: "Canopy Camera"
  external_clock:
    pin: GPIO0
    frequency: 20MHz
  i2c_pins:
    sda: GPIO26
    scl: GPIO27
  data_pins: [GPIO5, GPIO18, GPIO19, GPIO21, GPIO36, GPIO39, GPIO34, GPIO35]
  vsync_pin: GPIO25
  href_pin: GPIO23
  pixel_clock_pin: GPIO22
  power_down_pin: GPIO32
  resolution: 800x600
  jpeg_quality: 12

esp32_camera_web_server:
  - port: 81
    mode: stream
  - port: 80
    mode: snapshot

mqtt:
  broker: "${params.mqttHost}"
  port: ${params.mqttPort}
  username: "${params.deviceId}"
  password: !secret edens_device_key
  discovery: true
  topic_prefix: "edens/v1/greenhouses/\${greenhouse_id}/devices/\${device_id}"
  birth_message:
    topic: "edens/v1/greenhouses/\${greenhouse_id}/devices/\${device_id}/status"
    payload: "online"
  will_message:
    topic: "edens/v1/greenhouses/\${greenhouse_id}/devices/\${device_id}/status"
    payload: "offline"
`;
  }

  return `# ==============================================================================
# EDENS AI — ESPHome 2026.10.2 Reference Greenhouse Controller Configuration
# Device ID: ${params.deviceId}  |  Greenhouse: ${params.greenhouseId}  |  Zone: ${params.zoneId || 'primary'}
# IMPORTANT: Replace TODO_GPIO_* substitutions ONLY after confirming physical
# wiring, sensor IC model, ADC calibration, and relay active-HIGH/LOW polarity
# with the hardware engineer. Physical actuator outputs remain disabled by default.
# ==============================================================================
substitutions:
  node_name: "${safeNodeName}"
  friendly_name: "${params.deviceLabel.replace(/"/g, '')}"
  greenhouse_id: "${params.greenhouseId}"
  zone_id: "${params.zoneId || 'primary'}"
  device_id: "${params.deviceId}"
  # HARDWARE ENGINEER MUST SUPPLY VERIFIED PINS BEFORE UNCOMMENTING SENSORS:
  # temp_hum_gpio: "TODO_GPIO_DHT_OR_I2C"
  # soil_adc_gpio: "TODO_GPIO_ADC1_CHANNEL"

esphome:
  name: \${node_name}
  friendly_name: \${friendly_name}

esp32:
  board: esp32dev
  framework:
    type: esp-idf

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password
  ap:
    ssid: "EDENS-CTRL-\${device_id}"
    password: !secret fallback_ap_password

captive_portal:

logger:
  level: INFO

ota:
  - platform: esphome
    password: !secret ota_password

web_server:
  port: 80
  version: 3
  auth:
    username: "edens_local"
    password: !secret local_http_password

mqtt:
  broker: "${params.mqttHost}"
  port: ${params.mqttPort}
  username: "${params.deviceId}"
  password: !secret edens_device_key
  discovery: true
  topic_prefix: "edens/v1/greenhouses/\${greenhouse_id}/devices/\${device_id}"
  birth_message:
    topic: "edens/v1/greenhouses/\${greenhouse_id}/devices/\${device_id}/status"
    payload: "online"
  will_message:
    topic: "edens/v1/greenhouses/\${greenhouse_id}/devices/\${device_id}/status"
    payload: "offline"

sensor:
  - platform: wifi_signal
    name: "WiFi Signal RSSI"
    update_interval: 30s
  - platform: uptime
    name: "Controller Uptime"
    update_interval: 30s
  # Uncomment and bind exact sensor driver once confirmed by hardware engineer:
  # - platform: dht
  #   pin: \${temp_hum_gpio}
  #   model: DHT22
  #   temperature:
  #     id: temperature
  #     name: "Temperature"
  #   humidity:
  #     id: humidity
  #     name: "Humidity"
  #   update_interval: 10s
`;
}
