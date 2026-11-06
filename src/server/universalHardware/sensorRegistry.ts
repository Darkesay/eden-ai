/**
 * EDENS AI — Dynamic Sensor Registry
 * Manages dynamically discovered sensors, calibration, readings, and provenance.
 */

import type { PlatformDatabase } from '../database.ts';
import { generateSecureId } from '../telemetryContract.ts';
import { globalCapabilityRegistry } from './capabilityRegistry.ts';
import type {
  DiscoveredSensorRecord,
  SensorCategory,
  SensorDeclaration,
  TelemetryQuality,
  TelemetrySource
} from './types.ts';

export class DynamicSensorRegistry {
  private readonly platformDb: PlatformDatabase;

  constructor(platformDb: PlatformDatabase) {
    this.platformDb = platformDb;
  }

  /**
   * Registers a discovered sensor for a device. If already registered, updates metadata.
   */
  public registerDiscoveredSensor(params: {
    deviceId: string;
    greenhouseId: string;
    zoneId?: string | null;
    sensorType: SensorCategory;
    sensorModel?: string;
    displayLabel?: string;
    unit?: string;
    pinOrBus?: string;
    rawFieldKey?: string;
    discoveryOrigin?: string;
    calibrationOffset?: number;
    calibrationMultiplier?: number;
  }): DiscoveredSensorRecord {
    const driver = this.platformDb.getDriver();
    const bounds = globalCapabilityRegistry.getSensorBounds(params.sensorType);
    const unit = params.unit || bounds.canonicalUnit;
    const label = params.displayLabel || bounds.defaultLabel;
    const model = params.sensorModel || 'Generic Probe';
    const sensorId = `${params.deviceId}:${params.rawFieldKey || params.sensorType}`;
    const nowIso = new Date().toISOString();

    driver.run(
      `INSERT INTO iot_sensor_registry (
         id, device_id, greenhouse_id, zone_id, sensor_id, sensor_type,
         display_label, unit, protocol_topic_or_path, last_value, last_quality,
         last_source, discovery_origin, metadata_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'unavailable', 'REAL_HARDWARE', ?, ?, ?)
       ON CONFLICT(device_id, sensor_id) DO UPDATE SET
         sensor_type = excluded.sensor_type,
         display_label = excluded.display_label,
         unit = excluded.unit,
         discovery_origin = excluded.discovery_origin,
         updated_at = excluded.updated_at`,
      [
        generateSecureId('sens', 8),
        params.deviceId,
        params.greenhouseId,
        params.zoneId || null,
        sensorId,
        params.sensorType,
        label,
        unit,
        params.pinOrBus || null,
        params.discoveryOrigin || 'discovery_manifest',
        JSON.stringify({
          model,
          pinOrBus: params.pinOrBus || null,
          offset: params.calibrationOffset ?? 0,
          multiplier: params.calibrationMultiplier ?? 1
        }),
        nowIso
      ]
    );

    return {
      sensorId,
      sensorType: params.sensorType,
      sensorModel: model,
      deviceId: params.deviceId,
      greenhouseId: params.greenhouseId,
      zoneId: params.zoneId || null,
      measurementUnit: unit,
      currentReading: null,
      timestamp: null,
      calibrationOffset: params.calibrationOffset ?? 0,
      calibrationMultiplier: params.calibrationMultiplier ?? 1,
      healthState: 'unavailable',
      dataProvenance: 'REAL_HARDWARE',
      rawFieldKey: params.rawFieldKey,
      pinOrBus: params.pinOrBus,
      lastUpdated: nowIso
    };
  }

  /**
   * Updates an existing sensor's reading with calibration and sanity checks.
   * Invariant: Never generates fake readings. If rawValue is null/undefined, preserves null.
   */
  public updateSensorReading(params: {
    deviceId: string;
    greenhouseId: string;
    zoneId?: string | null;
    rawKey: string;
    rawValue: number | null | undefined;
    timestampIso: string;
    provenance: TelemetrySource;
    sensorModel?: string;
  }): DiscoveredSensorRecord | null {
    const category = globalCapabilityRegistry.normalizeRawKeyToCategory(params.rawKey);
    if (!category) return null;

    const sensorId = `${params.deviceId}:${params.rawKey}`;
    const bounds = globalCapabilityRegistry.getSensorBounds(category);
    const nowIso = new Date().toISOString();

    let calibratedVal: number | null = null;
    let quality: TelemetryQuality = 'unavailable';

    if (params.rawValue !== null && params.rawValue !== undefined && Number.isFinite(params.rawValue)) {
      // Check sanity
      const sanity = globalCapabilityRegistry.validateReadingSanity(category, params.rawValue);
      quality = sanity.quality;
      calibratedVal = sanity.sanitizedValue;
    }

    const driver = this.platformDb.getDriver();
    driver.run(
      `INSERT INTO iot_sensor_registry (
         id, device_id, greenhouse_id, zone_id, sensor_id, sensor_type,
         display_label, unit, last_value, last_quality, last_source,
         last_timestamp, discovery_origin, metadata_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'telemetry_stream', ?, ?)
       ON CONFLICT(device_id, sensor_id) DO UPDATE SET
         last_value = excluded.last_value,
         last_quality = excluded.last_quality,
         last_source = excluded.last_source,
         last_timestamp = excluded.last_timestamp,
         updated_at = excluded.updated_at`,
      [
        generateSecureId('sens', 8),
        params.deviceId,
        params.greenhouseId,
        params.zoneId || null,
        sensorId,
        category,
        bounds.defaultLabel,
        bounds.canonicalUnit,
        calibratedVal,
        quality,
        params.provenance,
        params.timestampIso,
        JSON.stringify({ model: params.sensorModel || 'Reported Sensor' }),
        nowIso
      ]
    );

    return {
      sensorId,
      sensorType: category,
      sensorModel: params.sensorModel || 'Reported Sensor',
      deviceId: params.deviceId,
      greenhouseId: params.greenhouseId,
      zoneId: params.zoneId || null,
      measurementUnit: bounds.canonicalUnit,
      currentReading: calibratedVal,
      timestamp: params.timestampIso,
      calibrationOffset: 0,
      calibrationMultiplier: 1,
      healthState: quality,
      dataProvenance: params.provenance,
      rawFieldKey: params.rawKey,
      lastUpdated: nowIso
    };
  }

  /**
   * Lists all discovered sensors for a device.
   */
  public listSensorsForDevice(deviceId: string, nowMs: number = Date.now()): DiscoveredSensorRecord[] {
    const driver = this.platformDb.getDriver();
    const rows = driver.queryAll<any>(
      'SELECT * FROM iot_sensor_registry WHERE device_id = ? ORDER BY sensor_type ASC',
      [deviceId]
    );

    return rows.map((r) => {
      let meta: any = {};
      try {
        meta = JSON.parse(r.metadata_json || '{}');
      } catch {
        meta = {};
      }
      const ts = r.last_timestamp ? String(r.last_timestamp) : null;
      let quality = (r.last_quality || 'unavailable') as TelemetryQuality;
      if (ts && quality === 'valid') {
        const ageSec = Math.max(0, Math.floor((nowMs - new Date(ts).getTime()) / 1000));
        if (ageSec > 90) {
          quality = 'stale';
        }
      }

      return {
        sensorId: String(r.sensor_id),
        sensorType: (r.sensor_type || 'custom') as SensorCategory,
        sensorModel: meta.model || 'Generic Probe',
        deviceId: String(r.device_id),
        greenhouseId: String(r.greenhouse_id),
        zoneId: r.zone_id ? String(r.zone_id) : null,
        measurementUnit: String(r.unit),
        currentReading: r.last_value !== null && r.last_value !== undefined ? Number(r.last_value) : null,
        timestamp: ts,
        calibrationOffset: meta.offset ?? 0,
        calibrationMultiplier: meta.multiplier ?? 1,
        healthState: quality,
        dataProvenance: String(r.last_source || 'REAL_HARDWARE') as TelemetrySource,
        pinOrBus: meta.pinOrBus || undefined,
        lastUpdated: String(r.updated_at)
      };
    });
  }

  /**
   * Bulk synchronizes discovered sensors from a device capability manifest.
   */
  public syncDeclaredSensors(
    deviceId: string,
    greenhouseId: string,
    declarations: SensorDeclaration[],
    zoneId?: string | null
  ): DiscoveredSensorRecord[] {
    return declarations.map((decl) =>
      this.registerDiscoveredSensor({
        deviceId,
        greenhouseId,
        zoneId,
        sensorType: decl.category,
        sensorModel: decl.model,
        displayLabel: decl.label,
        unit: decl.unit,
        pinOrBus: decl.pinOrBus,
        calibrationOffset: decl.calibrationOffset,
        calibrationMultiplier: decl.calibrationMultiplier,
        discoveryOrigin: 'capability_manifest'
      })
    );
  }
}
