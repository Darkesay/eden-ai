/**
 * EDENS AI — Universal Device Discovery Service
 * Authenticated capability discovery, board identification, and adapter assignment.
 */

import type { PlatformDatabase } from '../database.ts';
import { globalAdapterManager } from './adapterManager.ts';
import { globalCapabilityRegistry } from './capabilityRegistry.ts';
import type { DynamicSensorRegistry } from './sensorRegistry.ts';
import type { CameraIntegrationManager } from './cameraManager.ts';
import type {
  AdapterMatchResult,
  DeviceProfile,
  Esp32ChipFamily,
  SensorDeclaration
} from './types.ts';

export interface DeviceDiscoveryPayload {
  deviceId: string;
  manufacturer?: string;
  boardModel?: string;
  chipFamily?: string;
  firmwareVersion?: string;
  macAddress?: string;
  flashSizeMb?: number;
  hasPsram?: boolean;
  cameraCapable?: boolean;
  sensors?: Array<{
    id: string;
    type: string;
    model?: string;
    label?: string;
    unit?: string;
    pin?: string;
  }>;
  actuators?: string[];
  camera?: {
    sensorModel?: string;
    resolutions?: string[];
    streamUrl?: string;
    photoUrl?: string;
    statusUrl?: string;
  };
  network?: {
    ipAddress?: string;
    wifiRssi?: number;
    ssid?: string;
  };
}

export interface DiscoveryProcessResult {
  ok: boolean;
  deviceId: string;
  adapterMatch: AdapterMatchResult;
  discoveredSensorsCount: number;
  cameraConfigured: boolean;
  warnings: string[];
}

export class DeviceDiscoveryService {
  private readonly platformDb: PlatformDatabase;
  private readonly sensorRegistry: DynamicSensorRegistry;
  private readonly cameraManager: CameraIntegrationManager;

  constructor(deps: {
    platformDb: PlatformDatabase;
    sensorRegistry: DynamicSensorRegistry;
    cameraManager: CameraIntegrationManager;
  }) {
    this.platformDb = deps.platformDb;
    this.sensorRegistry = deps.sensorRegistry;
    this.cameraManager = deps.cameraManager;
  }

  /**
   * Processes an incoming hardware discovery announcement.
   * Identifies board model, selects adapter, and registers discovered sensors/camera.
   */
  public processDiscoveryAnnouncement(params: {
    greenhouseId: string;
    payload: DeviceDiscoveryPayload;
    remoteIp?: string;
  }): DiscoveryProcessResult {
    const { greenhouseId, payload } = params;
    const deviceId = payload.deviceId;

    // Check device existence
    const driver = this.platformDb.getDriver();
    const devRow = driver.queryOne<any>('SELECT * FROM devices WHERE id = ? AND greenhouse_id = ?', [
      deviceId,
      greenhouseId
    ]);

    if (!devRow) {
      return {
        ok: false,
        deviceId,
        adapterMatch: {
          compatible: false,
          matchScore: 0,
          selectedAdapterId: 'device_not_enrolled',
          adapterDisplayName: 'Unregistered Device Slot',
          matchedChipFamily: false,
          matchedModel: false,
          warnings: [`Device "${deviceId}" is not enrolled in greenhouse "${greenhouseId}". Enroll slot first.`],
          reasons: []
        },
        discoveredSensorsCount: 0,
        cameraConfigured: false,
        warnings: [`Device "${deviceId}" must be registered in the greenhouse fleet before discovery.`]
      };
    }

    // Resolve chip family & board spec
    const rawChip = (payload.chipFamily || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let resolvedChip: Esp32ChipFamily = 'esp32';
    if (rawChip.includes('s2')) resolvedChip = 'esp32s2';
    else if (rawChip.includes('s3')) resolvedChip = 'esp32s3';
    else if (rawChip.includes('c3')) resolvedChip = 'esp32c3';
    else if (rawChip.includes('c6')) resolvedChip = 'esp32c6';
    else if (rawChip.includes('h2')) resolvedChip = 'esp32h2';

    const boardModel = payload.boardModel || devRow.hardware_model || (payload.cameraCapable ? 'esp32_cam' : 'esp32_devkit_v1');
    const spec = globalCapabilityRegistry.getBoardSpec(boardModel);

    // Build profile candidate
    const profileCandidate: Partial<DeviceProfile> = {
      deviceId,
      greenhouseId,
      boardManufacturer: payload.manufacturer || 'Espressif Systems',
      boardModel,
      chipFamily: resolvedChip || spec?.chipFamily || 'esp32',
      firmwareVersion: payload.firmwareVersion || devRow.firmware_version || '1.0.0',
      cameraCapable: payload.cameraCapable ?? devRow.device_type === 'esp32_cam' ?? spec?.cameraCapable ?? false,
      hasPsram: payload.hasPsram ?? spec?.hasPsram ?? false,
      supportedProtocols: spec?.supportedProtocols || ['http_rest', 'mqtt'],
      hardwareFeatures: spec?.defaultFeatures || []
    };

    // Select adapter
    const adapterMatch = globalAdapterManager.selectBestAdapter(profileCandidate);

    const nowIso = new Date().toISOString();

    // Persist updated device hardware specs
    driver.run(
      `UPDATE devices
       SET manufacturer = ?,
           hardware_model = ?,
           firmware_version = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        profileCandidate.boardManufacturer,
        boardModel,
        profileCandidate.firmwareVersion,
        nowIso,
        deviceId
      ]
    );

    let discoveredSensorsCount = 0;
    if (Array.isArray(payload.sensors) && payload.sensors.length > 0) {
      const decls: SensorDeclaration[] = [];
      for (const s of payload.sensors) {
        const cat = globalCapabilityRegistry.normalizeRawKeyToCategory(s.type || s.id);
        if (cat) {
          decls.push({
            id: s.id,
            category: cat,
            model: s.model || 'Discovered Probe',
            label: s.label,
            unit: s.unit,
            pinOrBus: s.pin
          });
        }
      }
      const registered = this.sensorRegistry.syncDeclaredSensors(deviceId, greenhouseId, decls, devRow.zone_id);
      discoveredSensorsCount = registered.length;
    }

    let cameraConfigured = false;
    if (profileCandidate.cameraCapable) {
      this.cameraManager.registerCameraDevice({
        deviceId,
        greenhouseId,
        zoneId: devRow.zone_id,
        sensorModel: payload.camera?.sensorModel || 'OV2640',
        supportedResolutions: payload.camera?.resolutions,
        streamUrl: payload.camera?.streamUrl || null,
        photoUrl: payload.camera?.photoUrl || null,
        statusUrl: payload.camera?.statusUrl || null,
        transportMode: 'cloud_upload'
      });
      cameraConfigured = true;
    }

    return {
      ok: adapterMatch.compatible,
      deviceId,
      adapterMatch,
      discoveredSensorsCount,
      cameraConfigured,
      warnings: adapterMatch.warnings
    };
  }
}
