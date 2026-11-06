/**
 * EDENS AI — Universal Telemetry Ingestion Service
 * Protocol-agnostic telemetry intake, zero vs null preservation, offline replay deduplication,
 * and Agricultural Intelligence bridge.
 */

import type { PlatformDatabase } from '../database.ts';
import { generateSecureId } from '../telemetryContract.ts';
import { globalAdapterManager } from './adapterManager.ts';
import type { DynamicSensorRegistry } from './sensorRegistry.ts';
import type {
  IngestionContext,
  NormalizedIngestionOutput,
  StandardReadingOutput,
  SupportedIotProtocol,
  TelemetrySource
} from './types.ts';

export interface IngestionResult {
  ok: boolean;
  statusCode: number;
  readingId?: string;
  sampleId?: string;
  errorCode?: string;
  message?: string;
  normalizedCount: number;
  readings: StandardReadingOutput[];
}

export class TelemetryIngestionService {
  private readonly platformDb: PlatformDatabase;
  private readonly sensorRegistry: DynamicSensorRegistry;
  private readonly processedSampleHashes = new Set<string>();

  constructor(deps: {
    platformDb: PlatformDatabase;
    sensorRegistry: DynamicSensorRegistry;
  }) {
    this.platformDb = deps.platformDb;
    this.sensorRegistry = deps.sensorRegistry;
  }

  /**
   * Ingests, validates, deduplicates, and stores telemetry from any supported protocol.
   */
  public ingestTelemetry(params: {
    deviceId: string;
    greenhouseId: string;
    zoneId?: string | null;
    protocol: SupportedIotProtocol;
    rawPayload: unknown;
    remoteIp?: string;
    topicOrPath?: string;
  }): IngestionResult {
    const { deviceId, greenhouseId, zoneId, protocol, rawPayload, remoteIp, topicOrPath } = params;
    const nowIso = new Date().toISOString();

    // Context
    const context: IngestionContext = {
      deviceId,
      greenhouseId,
      zoneId: zoneId || null,
      protocol,
      topicOrPath,
      remoteIp,
      receivedAtIso: nowIso
    };

    // Lookup device profile to pick best adapter
    const driver = this.platformDb.getDriver();
    const devRow = driver.queryOne<any>('SELECT * FROM devices WHERE id = ?', [deviceId]);
    const boardModel = devRow?.hardware_model || 'esp32_devkit_v1';
    const adapterMatch = globalAdapterManager.selectBestAdapter({
      deviceId,
      boardModel,
      chipFamily: 'esp32',
      cameraCapable: false
    });

    const plugin = globalAdapterManager.getPlugin(adapterMatch.selectedAdapterId) || globalAdapterManager.listPlugins()[0];
    const normalized: NormalizedIngestionOutput = plugin.normalizePayload(rawPayload, context);

    if (!normalized.ok) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: normalized.errorCode || 'NORMALIZATION_FAILED',
        message: normalized.message || 'Payload normalization failed.',
        normalizedCount: 0,
        readings: []
      };
    }

    // Deduplication check: (deviceId + timestamp)
    const primaryTs = normalized.readings[0]?.timestamp || nowIso;
    const dedupeKey = `${deviceId}:${primaryTs}`;
    if (this.processedSampleHashes.has(dedupeKey)) {
      return {
        ok: true,
        statusCode: 200,
        message: 'Duplicate sample acknowledged without redundant storage.',
        normalizedCount: normalized.readings.length,
        readings: normalized.readings
      };
    }
    this.processedSampleHashes.add(dedupeKey);
    // Keep deduplication set bounded (LRU-like cap)
    if (this.processedSampleHashes.size > 2000) {
      const iter = this.processedSampleHashes.values();
      for (let i = 0; i < 500; i++) {
        const val = iter.next().value;
        if (val) this.processedSampleHashes.delete(val);
      }
    }

    // Store in iot_sensor_registry and update device telemetry
    const mappedReadings: Record<string, number | null> = {};
    let provenance: TelemetrySource = 'REAL_HARDWARE';

    for (const r of normalized.readings) {
      provenance = r.source;
      mappedReadings[r.sensorType] = r.value;
      this.sensorRegistry.updateSensorReading({
        deviceId,
        greenhouseId,
        zoneId: zoneId || null,
        rawKey: r.sensorId.split(':').pop() || r.sensorType,
        rawValue: r.value,
        timestampIso: r.timestamp,
        provenance: r.source,
        sensorModel: r.sensorModel
      });
    }

    // Also persist in legacy / analytical telemetry_readings table for Agricultural Intelligence
    let readingId: string | undefined;
    if (Object.keys(mappedReadings).length > 0) {
      readingId = generateSecureId('read', 12);
      driver.run(
        `INSERT INTO telemetry_readings (
           id, greenhouse_id, zone_id, device_id, temperature, humidity,
           soil_moisture, sunlight, grow_light, water_level, battery_voltage,
           rain_detected, raw_payload_json, ip_address, recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          readingId,
          greenhouseId,
          zoneId || null,
          deviceId,
          mappedReadings.temperature ?? null,
          mappedReadings.humidity ?? null,
          mappedReadings.soil_moisture ?? null,
          mappedReadings.light_intensity ?? null,
          null, // grow_light
          mappedReadings.water_level ?? null,
          mappedReadings.battery_voltage ?? null,
          mappedReadings.rainfall !== undefined && mappedReadings.rainfall !== null ? (mappedReadings.rainfall > 0 ? 1 : 0) : null,
          JSON.stringify(rawPayload),
          remoteIp || null,
          primaryTs
        ]
      );
    }

    // Record device check-in
    this.platformDb.recordDeviceCheckIn({
      deviceId,
      greenhouseId,
      ipAddress: remoteIp,
      checkInKind: 'telemetry_upload',
      dataTimestamp: primaryTs
    });

    return {
      ok: true,
      statusCode: 200,
      readingId,
      sampleId: dedupeKey,
      normalizedCount: normalized.readings.length,
      readings: normalized.readings
    };
  }
}
