/**
 * EDENS AI — Hardware Adapter Manager & Plugin Architecture
 * Modular adapter registry, selection engine, and third-party extension framework.
 */

import { globalCapabilityRegistry } from './capabilityRegistry.ts';
import type {
  DeviceProfile,
  HardwareAdapterPlugin,
  AdapterMatchResult,
  IngestionContext,
  NormalizedIngestionOutput,
  SensorDeclaration,
  StandardReadingOutput,
  SupportedIotProtocol
} from './types.ts';

function createBuiltInEsp32ControllerPlugin(): HardwareAdapterPlugin {
  return {
    adapterId: 'esp32_standard_controller_adapter',
    displayName: 'ESP32 Standard Greenhouse Sensor Controller Adapter',
    description: 'Universal telemetry adapter for ESP32 DevKit, WROOM, WROVER, S2, S3, and C3 greenhouse sensor controllers.',
    version: '3.2.0',
    author: 'EDENS AI Systems Architecture Team',
    upstreamLicense: 'Apache-2.0',
    supportedChipFamilies: ['esp32', 'esp32s2', 'esp32s3', 'esp32c3'],
    supportedBoardModels: ['esp32_devkit_v1', 'esp32_wroom', 'esp32_wrover', 'esp32_s2', 'esp32_s3', 'esp32_c3'],
    supportedBoardCategories: ['controller_standard', 'controller_psram'],
    minFirmwareVersion: '1.0.0',
    supportedProtocols: ['http_rest', 'mqtt', 'websocket', 'esphome_api', 'thingsboard_v1'],
    supportsCamera: false,
    supportsSensors: true,

    validateCompatibility(profile) {
      const chip = profile.chipFamily || 'unknown';
      const model = profile.boardModel?.toLowerCase() || '';
      const isChipSupported = ['esp32', 'esp32s2', 'esp32s3', 'esp32c3'].includes(chip);
      const isModelSupported = !model || model.includes('devkit') || model.includes('wroom') || model.includes('wrover') || model.includes('s2') || model.includes('s3') || model.includes('c3') || model.includes('controller');

      let score = 0;
      const reasons: string[] = [];
      const warnings: string[] = [];

      if (isChipSupported) {
        score += 50;
        reasons.push(`Chip family "${chip}" natively supported by Espressif IDF/Arduino HAL.`);
      } else {
        warnings.push(`Chip family "${chip}" is not in the primary supported matrix.`);
      }

      if (isModelSupported) {
        score += 40;
        reasons.push(`Board model "${profile.boardModel || 'Standard ESP32'}" matches standard pinout layout.`);
      }

      if (profile.supportedProtocols?.some((p) => ['http_rest', 'mqtt', 'websocket'].includes(p))) {
        score += 10;
        reasons.push('Device supports standard TCP/IP HTTPS or MQTT transport.');
      }

      const compatible = score >= 50;
      return {
        compatible,
        matchScore: score,
        selectedAdapterId: 'esp32_standard_controller_adapter',
        adapterDisplayName: 'ESP32 Standard Greenhouse Sensor Controller Adapter',
        matchedChipFamily: isChipSupported,
        matchedModel: isModelSupported,
        warnings,
        reasons
      };
    },

    normalizePayload(rawPayload, context) {
      if (!rawPayload || typeof rawPayload !== 'object') {
        return { ok: false, errorCode: 'INVALID_PAYLOAD', message: 'Payload must be a JSON object.', readings: [] };
      }

      const body = rawPayload as Record<string, unknown>;
      const nestedTel = (body.telemetry && typeof body.telemetry === 'object')
        ? (body.telemetry as Record<string, unknown>)
        : body;

      const readings: StandardReadingOutput[] = [];
      const detectedSensors: SensorDeclaration[] = [];
      const timestampIso = typeof body.timestamp === 'string' ? body.timestamp : context.receivedAtIso;
      const provenance = (body.source === 'SIMULATED' || body.simulated === true) ? 'SIMULATED' : 'REAL_HARDWARE';

      for (const [key, val] of Object.entries(nestedTel)) {
        if (val === null || val === undefined) continue;
        const category = globalCapabilityRegistry.normalizeRawKeyToCategory(key);
        if (!category) continue;

        let numVal: number | null = null;
        if (typeof val === 'number' && Number.isFinite(val)) {
          numVal = val;
        } else if (typeof val === 'boolean') {
          numVal = val ? 1 : 0;
        } else if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) {
          numVal = Number(val);
        }

        if (numVal === null) continue;

        const sanity = globalCapabilityRegistry.validateReadingSanity(category, numVal);
        const bounds = globalCapabilityRegistry.getSensorBounds(category);

        readings.push({
          deviceId: context.deviceId,
          sensorId: `${context.deviceId}:${key}`,
          sensorType: category,
          sensorModel: 'Physical Sensor',
          value: sanity.sanitizedValue ?? numVal,
          unit: bounds.canonicalUnit,
          timestamp: timestampIso,
          quality: sanity.quality,
          source: provenance
        });

        detectedSensors.push({
          id: key,
          category,
          label: bounds.defaultLabel,
          unit: bounds.canonicalUnit
        });
      }

      return {
        ok: true,
        readings,
        detectedSensors,
        deviceHealth: {
          uptimeSeconds: typeof body.uptimeSeconds === 'number' ? body.uptimeSeconds : undefined,
          freeHeapBytes: typeof body.freeHeapBytes === 'number' ? body.freeHeapBytes : undefined,
          wifiRssi: typeof body.wifiRssi === 'number' ? body.wifiRssi : undefined,
          batteryVoltage: typeof body.batteryVoltage === 'number' ? body.batteryVoltage : undefined
        }
      };
    }
  };
}

function createBuiltInEsp32CamPlugin(): HardwareAdapterPlugin {
  return {
    adapterId: 'esp32_cam_adapter',
    displayName: 'AI-Thinker ESP32-CAM (OV2640 / OV3660 / OV5640) Adapter',
    description: 'Hardware adapter for camera-enabled ESP32 nodes supporting dual HTTP server (Port 80 snapshot, Port 81 MJPEG stream) and HTTPS cloud sync.',
    version: '3.2.0',
    author: 'EDENS AI Vision Systems Team',
    upstreamLicense: 'Apache-2.0',
    supportedChipFamilies: ['esp32', 'esp32s3'],
    supportedBoardModels: ['esp32_cam', 'ai_thinker_esp32_cam', 'esp32_s3_cam', 'seeed_xiao_esp32s3_sense', 'freenove_esp32_cam'],
    supportedBoardCategories: ['camera_node'],
    minFirmwareVersion: '1.0.0',
    supportedProtocols: ['http_rest', 'mqtt', 'websocket'],
    supportsCamera: true,
    supportsSensors: true,

    validateCompatibility(profile) {
      const chip = profile.chipFamily || 'unknown';
      const model = profile.boardModel?.toLowerCase() || '';
      const isCameraCapable = profile.cameraCapable === true || model.includes('cam') || model.includes('ov2640') || model.includes('ov5640');

      let score = 0;
      const reasons: string[] = [];
      const warnings: string[] = [];

      if (isCameraCapable) {
        score += 60;
        reasons.push('Camera sensor hardware and DVP/MIPI interface verified.');
      } else {
        warnings.push('Device does not declare camera capability.');
      }

      if (['esp32', 'esp32s3'].includes(chip)) {
        score += 30;
        reasons.push(`Chip family "${chip}" supports external PSRAM DMA camera buffers.`);
      }

      if (profile.hasPsram !== false) {
        score += 10;
        reasons.push('PSRAM enabled for high-resolution JPEG capture.');
      }

      const compatible = score >= 50;
      return {
        compatible,
        matchScore: score,
        selectedAdapterId: 'esp32_cam_adapter',
        adapterDisplayName: 'AI-Thinker ESP32-CAM Adapter',
        matchedChipFamily: ['esp32', 'esp32s3'].includes(chip),
        matchedModel: isCameraCapable,
        warnings,
        reasons
      };
    },

    normalizePayload(rawPayload, context) {
      if (!rawPayload || typeof rawPayload !== 'object') {
        return { ok: false, errorCode: 'INVALID_PAYLOAD', message: 'Payload must be a JSON object.', readings: [] };
      }
      const body = rawPayload as Record<string, unknown>;

      return {
        ok: true,
        readings: [],
        detectedCamera: {
          cameraCapable: true,
          sensorModel: typeof body.sensorModel === 'string' ? body.sensorModel : 'OV2640',
          supportedResolutions: Array.isArray(body.supportedResolutions) ? body.supportedResolutions.map(String) : ['QVGA', 'VGA', 'SVGA'],
          hasHardwareJpeg: true,
          hasLedFlash: true,
          streamUrl: typeof body.streamUrl === 'string' ? body.streamUrl : null,
          photoUrl: typeof body.photoUrl === 'string' ? body.photoUrl : null,
          statusUrl: typeof body.statusUrl === 'string' ? body.statusUrl : null,
          transportMode: 'cloud_upload'
        },
        deviceHealth: {
          uptimeSeconds: typeof body.uptimeSeconds === 'number' ? body.uptimeSeconds : undefined,
          freeHeapBytes: typeof body.freeHeapBytes === 'number' ? body.freeHeapBytes : undefined,
          wifiRssi: typeof body.wifiRssi === 'number' ? body.wifiRssi : undefined
        }
      };
    }
  };
}

export class HardwareAdapterManager {
  private readonly plugins = new Map<string, HardwareAdapterPlugin>();

  constructor() {
    this.registerPlugin(createBuiltInEsp32ControllerPlugin());
    this.registerPlugin(createBuiltInEsp32CamPlugin());
  }

  /**
   * Registers a hardware adapter plugin into the system.
   * Untrusted / unvalidated objects are rejected.
   */
  public registerPlugin(plugin: HardwareAdapterPlugin): { ok: boolean; message: string } {
    if (!plugin.adapterId || typeof plugin.adapterId !== 'string' || plugin.adapterId.length < 3) {
      return { ok: false, message: 'Invalid adapterId.' };
    }
    if (!plugin.displayName || typeof plugin.displayName !== 'string') {
      return { ok: false, message: 'Invalid displayName.' };
    }
    if (typeof plugin.validateCompatibility !== 'function' || typeof plugin.normalizePayload !== 'function') {
      return { ok: false, message: 'Plugin must implement validateCompatibility and normalizePayload.' };
    }

    this.plugins.set(plugin.adapterId, plugin);
    return { ok: true, message: `Adapter "${plugin.displayName}" (${plugin.adapterId}) successfully registered.` };
  }

  public unregisterPlugin(adapterId: string): boolean {
    return this.plugins.delete(adapterId);
  }

  public getPlugin(adapterId: string): HardwareAdapterPlugin | undefined {
    return this.plugins.get(adapterId);
  }

  public listPlugins(): HardwareAdapterPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Selects the most compatible adapter for a given device profile.
   * If no adapter scores >= 50, returns a clear incompatible result.
   */
  public selectBestAdapter(profile: Partial<DeviceProfile>): AdapterMatchResult {
    let bestResult: AdapterMatchResult = {
      compatible: false,
      matchScore: 0,
      selectedAdapterId: 'unsupported_device',
      adapterDisplayName: 'No Compatible Adapter Found',
      matchedChipFamily: false,
      matchedModel: false,
      warnings: ['Device profile did not meet minimum compatibility threshold (>=50%) with any registered hardware adapter.'],
      reasons: []
    };

    for (const plugin of this.plugins.values()) {
      const evalRes = plugin.validateCompatibility(profile);
      if (evalRes.matchScore > bestResult.matchScore) {
        bestResult = evalRes;
      }
    }

    return bestResult;
  }
}

export const globalAdapterManager = new HardwareAdapterManager();
