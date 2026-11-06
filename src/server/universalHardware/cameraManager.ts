/**
 * EDENS AI — Universal Camera Integration Manager
 * Manages camera discovery, authenticated JPEG ingestion, freshness, and Plant Vision connection.
 */

import crypto from 'node:crypto';
import type { CameraImageStore } from '../cameraStorage.ts';
import type { PlatformDatabase } from '../database.ts';
import { extractAndValidateJpeg } from '../cameraStorage.ts';
import { generateSecureId } from '../telemetryContract.ts';
import type {
  CameraCapabilityDetails,
  CameraFrameDetails,
  TelemetrySource
} from './types.ts';

export class CameraIntegrationManager {
  private readonly platformDb: PlatformDatabase;
  private readonly getCameraStore: (greenhouseId: string) => CameraImageStore;

  constructor(deps: {
    platformDb: PlatformDatabase;
    getCameraStore: (greenhouseId: string) => CameraImageStore;
  }) {
    this.platformDb = deps.platformDb;
    this.getCameraStore = deps.getCameraStore;
  }

  /**
   * Registers or updates camera capabilities for a device.
   */
  public registerCameraDevice(params: {
    deviceId: string;
    greenhouseId: string;
    zoneId?: string | null;
    sensorModel?: string;
    supportedResolutions?: string[];
    streamUrl?: string | null;
    photoUrl?: string | null;
    statusUrl?: string | null;
    transportMode?: 'cloud_upload' | 'local_lan_http' | 'esphome_camera';
  }): CameraCapabilityDetails {
    const driver = this.platformDb.getDriver();
    const cameraId = `${params.deviceId}:primary_cam`;
    const sensorModel = params.sensorModel || 'OV2640';
    const resolutions = params.supportedResolutions || ['QVGA', 'VGA', 'SVGA', 'XGA'];
    const transportMode = params.transportMode || 'cloud_upload';
    const nowIso = new Date().toISOString();

    driver.run(
      `INSERT INTO iot_camera_registry (
         id, device_id, greenhouse_id, zone_id, camera_id, stream_url,
         photo_url, status_url, transport_mode, connection_state,
         metadata_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting_for_upload', ?, ?)
       ON CONFLICT(device_id, camera_id) DO UPDATE SET
         stream_url = COALESCE(excluded.stream_url, iot_camera_registry.stream_url),
         photo_url = COALESCE(excluded.photo_url, iot_camera_registry.photo_url),
         status_url = COALESCE(excluded.status_url, iot_camera_registry.status_url),
         transport_mode = excluded.transport_mode,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
      [
        generateSecureId('camreg', 8),
        params.deviceId,
        params.greenhouseId,
        params.zoneId || null,
        cameraId,
        params.streamUrl || null,
        params.photoUrl || null,
        params.statusUrl || null,
        transportMode,
        JSON.stringify({
          sensorModel,
          resolutions,
          hasHardwareJpeg: true,
          hasLedFlash: true
        }),
        nowIso
      ]
    );

    return {
      cameraCapable: true,
      sensorModel,
      supportedResolutions: resolutions,
      hasHardwareJpeg: true,
      hasLedFlash: true,
      streamUrl: params.streamUrl || null,
      photoUrl: params.photoUrl || null,
      statusUrl: params.statusUrl || null,
      transportMode
    };
  }

  /**
   * Validates and persists an incoming camera snapshot.
   * Enforces binary SOI (0xFFD8) and EOI (0xFFD9) markers and records capture provenance.
   */
  public ingestCameraSnapshot(params: {
    deviceId: string;
    greenhouseId: string;
    rawBuffer: Buffer;
    capturedAtIso?: string;
    remoteIp?: string;
    provenance?: TelemetrySource;
  }): {
    ok: boolean;
    statusCode: number;
    errorCode?: string;
    message?: string;
    frame?: CameraFrameDetails;
  } {
    const validated = extractAndValidateJpeg(params.rawBuffer);
    if (!validated.valid) {
      this.platformDb.recordDeviceError({
        greenhouseId: params.greenhouseId,
        deviceId: params.deviceId,
        expectedType: 'esp32_cam',
        category: 'CONNECTION',
        errorCode: validated.errorCode || 'INVALID_JPEG_BINARY',
        message: validated.message || 'Incoming frame is not a valid JPEG binary file.',
        ipAddress: params.remoteIp || null
      });

      return {
        ok: false,
        statusCode: validated.statusCode,
        errorCode: validated.errorCode || 'INVALID_JPEG_BINARY',
        message: validated.message || 'Incoming frame is not a valid JPEG binary file.'
      };
    }

    const nowIso = new Date().toISOString();
    const capturedAt = params.capturedAtIso || nowIso;
    const sha256 = crypto.createHash('sha256').update(validated.buffer).digest('hex');

    const store = this.getCameraStore(params.greenhouseId);
    const stored = store.validateAndStoreJpeg(validated.buffer, {
      acquisitionMethod: 'ESP32_CAM_UPLOAD',
      clientIp: params.remoteIp,
      capturedAt
    });

    if ('errorCode' in stored) {
      return {
        ok: false,
        statusCode: 500,
        errorCode: 'CAMERA_STORE_FAILED',
        message: stored.message || 'Failed to persist validated frame in camera store.'
      };
    }

    const driver = this.platformDb.getDriver();
    const cameraId = `${params.deviceId}:primary_cam`;

    driver.run(
      `UPDATE iot_camera_registry
       SET last_frame_id = ?,
           last_frame_sha256 = ?,
           last_capture_at = ?,
           connection_state = 'online',
           updated_at = ?
       WHERE device_id = ? AND camera_id = ?`,
      [stored.frame.id, sha256, capturedAt, nowIso, params.deviceId, cameraId]
    );

    this.platformDb.recordDeviceCheckIn({
      deviceId: params.deviceId,
      greenhouseId: params.greenhouseId,
      ipAddress: params.remoteIp,
      checkInKind: 'camera_upload',
      dataTimestamp: capturedAt
    });

    const frameDetails: CameraFrameDetails = {
      frameId: stored.frame.id,
      deviceId: params.deviceId,
      greenhouseId: params.greenhouseId,
      capturedAt,
      receivedAt: nowIso,
      sizeBytes: validated.buffer.length,
      mimeType: 'image/jpeg',
      sha256,
      freshnessSeconds: 0,
      isFresh: true,
      dataProvenance: params.provenance || 'REAL_HARDWARE'
    };

    return {
      ok: true,
      statusCode: 200,
      frame: frameDetails
    };
  }

  /**
   * Retrieves the latest verified camera frame with accurate freshness state.
   */
  public getLatestVerifiedFrame(
    greenhouseId: string,
    deviceId?: string,
    nowMs: number = Date.now()
  ): CameraFrameDetails | null {
    const store = this.getCameraStore(greenhouseId);
    const latest = store.getLatest(nowMs);
    if (!latest || !latest.frame) return null;

    // Frames in the store carry no deviceId — attribution lives in
    // iot_camera_registry, which points each device at its last frame id.
    const frameOwner = this.platformDb
      .getDriver()
      .queryOne<{ device_id: string }>(
        'SELECT device_id FROM iot_camera_registry WHERE greenhouse_id = ? AND last_frame_id = ?',
        [greenhouseId, latest.frame.id]
      );
    if (deviceId && frameOwner && frameOwner.device_id !== deviceId) {
      return null;
    }

    const ageSec = Math.max(0, Math.floor((nowMs - new Date(latest.frame.capturedAt).getTime()) / 1000));
    const isFresh = ageSec <= 90;

    return {
      frameId: latest.frame.id,
      deviceId: frameOwner?.device_id || deviceId || 'unknown_cam',
      greenhouseId,
      capturedAt: latest.frame.capturedAt,
      // StoredCameraFrame.timestamp is stamped when the frame is received.
      receivedAt: latest.frame.timestamp,
      sizeBytes: latest.frame.sizeBytes,
      mimeType: latest.frame.mimeType,
      sha256: latest.frame.sha256,
      freshnessSeconds: ageSec,
      isFresh,
      // The store persists no provenance field; it only ever holds validated
      // JPEG uploads from the camera ingest path.
      dataProvenance: 'REAL_HARDWARE'
    };
  }
}
