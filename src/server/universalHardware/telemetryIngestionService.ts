/**
 * EDENS AI — Universal Telemetry Ingestion Service
 * Ingests, normalizes, deduplicates, and validates agricultural sensor telemetry.
 */

import type { PlatformDatabase, DeviceRecord } from '../database.ts';
import { validateControllerTelemetryPayload } from '../telemetryContract.ts';
import { globalAdapterManager } from './adapterManager.ts';
import type { DynamicSensorRegistry } from './sensorRegistry.ts';
import type {
  IngestionContext,
  NormalizedIngestionOutput,
  SupportedIotProtocol,
  TelemetrySource
} from './types.ts';

export class TelemetryIngestionService {
  private readonly platformDb: PlatformDatabase;
  private readonly sensorRegistry: DynamicSensorRegistry;
  private readonly processedSampleIds = new Set<string>();

  constructor(deps: {
    platformDb: PlatformDatabase;
    sensorRegistry: DynamicSensorRegistry;
  }) {
    this.platformDb = deps.platformDb;
    this.sensorRegistry = deps.sensorRegistry;
  }

  /**
   * Ingests a telemetry payload across any supported protocol.
   * Differentiates exact 0 (e.g. 0% tank or 0 lux) from null (unpopulated/missing probe).
   */
  public ingestTelemetry(params: {
    device: DeviceRecord;
    protocol: SupportedIotProtocol;
    rawPayload: unknown;
    remoteIp?: string;
    topicOrPath?: string;
  }): {
    ok: boolean;
    statusCode: number;
    errorCode?: string;
    message?: string;
    readingId?: string;
    normalized?: NormalizedIngestionOutput;
  } {
    const { device, protocol, rawPayload, remoteIp, topicOrPath } = params;
    const nowIso = new Date().toISOString();

    // Check for duplicate sample replay if sampleId provided
    const body = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as Record<string, unknown>;
    const sampleId = typeof body.sampleId === 'string' ? body.sampleId : undefined;
    if (sampleId && this.processedSampleIds.has(sampleId)) {
      return {
        ok: true,
        statusCode: 200,
        message: 'Duplicate sample already ingested (idempotent ignore).'
      };
    }

    const context: IngestionContext = {
      deviceId: device.id,
      greenhouseId: device.greenhouseId,
      zoneId: device.zoneId || null,
      protocol,
      topicOrPath,
      remoteIp,
      receivedAtIso: nowIso,
      rawSampleId: sampleId
    };

    // Use adapter manager to normalize
    const adapter = globalAdapterManager.getPlugin('esp32_standard_controller_adapter');
    const normalized = adapter
      ? adapter.normalizePayload(rawPayload, context)
      : { ok: false, errorCode: 'NO_ADAPTER', message: 'No telemetry adapter available.', readings: [] };

    if (!normalized.ok) {
      this.platformDb.recordDeviceError({
        greenhouseId: device.greenhouseId,
        deviceId: device.id,
        expectedType: 'esp32_controller',
        category: 'CONNECTION',
        errorCode: normalized.errorCode || 'INGESTION_ERROR',
        message: normalized.message || 'Failed to normalize telemetry.',
        ipAddress: remoteIp || null
      });

      return {
        ok: false,
        statusCode: 400,
        errorCode: normalized.errorCode,
        message: normalized.message
      };
    }

    // Persist individual normalized sensors in sensorRegistry
    const provenance: TelemetrySource = (body.source === 'SIMULATED' || body.simulated === true) ? 'SIMULATED' : 'REAL_HARDWARE';
    for (const r of normalized.readings) {
      this.sensorRegistry.updateSensorReading({
        deviceId: device.id,
        greenhouseId: device.greenhouseId,
        zoneId: device.zoneId || null,
        rawKey: r.sensorId.split(':').pop() || r.sensorType,
        rawValue: r.value,
        timestampIso: r.timestamp,
        provenance,
        sensorModel: r.sensorModel
      });
    }

    // Also persist into canonical platform database controller telemetry
    const validated = validateControllerTelemetryPayload(rawPayload);
    let readingId: string | undefined;

    if (!('errorCode' in validated)) {
      const stored = this.platformDb.storeControllerTelemetry({
        greenhouseId: device.greenhouseId,
        deviceId: device.id,
        zoneId: device.zoneId || null,
        telemetry: validated,
        ipAddress: remoteIp
      });
      readingId = stored.readingId;
    } else {
      this.platformDb.recordDeviceCheckIn({
        deviceId: device.id,
        greenhouseId: device.greenhouseId,
        ipAddress: remoteIp,
        checkInKind: 'telemetry_upload',
        dataTimestamp: nowIso
      });
    }

    if (sampleId) {
      this.processedSampleIds.add(sampleId);
      if (this.processedSampleIds.size > 2000) {
        // Prune older sample IDs
        const arr = Array.from(this.processedSampleIds);
        for (let i = 0; i < 500; i++) {
          this.processedSampleIds.delete(arr[i]);
        }
      }
    }

    return {
      ok: true,
      statusCode: 200,
      readingId,
      normalized
    };
  }
}
