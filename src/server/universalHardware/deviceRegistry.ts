/**
 * EDENS AI — Universal Device Registry
 * Manages device enrollment, hardware identity profiles, adapter mapping, and state views.
 */

import type { DeviceRecord, PlatformDatabase } from '../database.ts';
import { generateSecureId } from '../telemetryContract.ts';
import { globalCapabilityRegistry } from './capabilityRegistry.ts';
import { globalAdapterManager } from './adapterManager.ts';
import type {
  BoardCategory,
  DeviceProfile,
  Esp32ChipFamily,
  HardwareDeviceStateView,
  SupportedIotProtocol,
  TruthfulDeviceState
} from './types.ts';

export class UniversalDeviceRegistry {
  private readonly platformDb: PlatformDatabase;

  constructor(platformDb: PlatformDatabase) {
    this.platformDb = platformDb;
  }

  /**
   * Registers a new physical or edge hardware device slot in a greenhouse.
   */
  public registerDeviceSlot(params: {
    greenhouseId: string;
    actorUserId: string;
    zoneId?: string | null;
    deviceType: 'esp32_controller' | 'esp32_cam' | 'environmental_node';
    label: string;
    boardManufacturer?: string;
    boardModel?: string;
    chipFamily?: Esp32ChipFamily;
    firmwareVersion?: string;
    serialNumber?: string;
    capabilities?: string[];
  }):
    | { ok: true; device: DeviceRecord; profile: DeviceProfile }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    if (params.deviceType === 'environmental_node') {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'UNSUPPORTED_DEVICE_TYPE',
        message: 'environmental_node devices are not yet supported by the platform device registry.'
      };
    }

    const res = this.platformDb.registerOrUpdateDevice({
      greenhouseId: params.greenhouseId,
      actorUserId: params.actorUserId,
      deviceType: params.deviceType,
      zoneId: params.zoneId || null,
      label: params.label,
      serialNumber: params.serialNumber,
      capabilities: {
        sensors: params.capabilities || [],
        actuators: []
      },
      createAdditionalSlot: true
    });

    if ('errorCode' in res) {
      return res;
    }

    const dev = res.device;
    const nowIso = new Date().toISOString();

    // Persist hardware profile info
    const driver = this.platformDb.getDriver();
    const boardModel = params.boardModel || (params.deviceType === 'esp32_cam' ? 'esp32_cam' : 'esp32_devkit_v1');
    const spec = globalCapabilityRegistry.getBoardSpec(boardModel);
    const chipFamily = params.chipFamily || spec?.chipFamily || 'esp32';
    const manufacturer = params.boardManufacturer || 'Espressif Systems';

    driver.run(
      `UPDATE devices
       SET manufacturer = ?,
           hardware_model = ?,
           firmware_version = ?,
           updated_at = ?
       WHERE id = ?`,
      [manufacturer, boardModel, params.firmwareVersion || '1.0.0', nowIso, dev.id]
    );

    const profile: DeviceProfile = {
      deviceId: dev.id,
      greenhouseId: params.greenhouseId,
      zoneId: dev.zoneId || null,
      label: dev.label,
      boardManufacturer: manufacturer,
      boardModel,
      chipFamily,
      boardCategory: spec?.category || 'controller_standard',
      firmwareVersion: params.firmwareVersion || '1.0.0',
      cameraCapable: params.deviceType === 'esp32_cam' || spec?.cameraCapable || false,
      supportedProtocols: spec?.supportedProtocols || ['http_rest', 'mqtt'],
      hardwareFeatures: spec?.defaultFeatures || [],
      declaredSensors: [],
      declaredActuators: []
    };

    return { ok: true, device: dev, profile };
  }

  /**
   * Retrieves the comprehensive device profile for an enrolled device.
   */
  public getDeviceProfile(deviceId: string): DeviceProfile | null {
    const driver = this.platformDb.getDriver();
    const dev = driver.queryOne<any>('SELECT * FROM devices WHERE id = ?', [deviceId]);
    if (!dev) return null;

    const boardModel = dev.hardware_model || (dev.device_type === 'esp32_cam' ? 'esp32_cam' : 'esp32_devkit_v1');
    const spec = globalCapabilityRegistry.getBoardSpec(boardModel);
    const chipFamily = (spec?.chipFamily || 'esp32') as Esp32ChipFamily;

    return {
      deviceId: dev.id,
      greenhouseId: dev.greenhouse_id,
      zoneId: dev.zone_id || null,
      label: dev.label,
      boardManufacturer: dev.manufacturer || 'Espressif Systems',
      boardModel,
      chipFamily,
      boardCategory: spec?.category || 'controller_standard',
      firmwareVersion: dev.firmware_version || '1.0.0',
      cameraCapable: dev.device_type === 'esp32_cam' || spec?.cameraCapable || false,
      supportedProtocols: spec?.supportedProtocols || ['http_rest', 'mqtt'],
      hardwareFeatures: spec?.defaultFeatures || [],
      declaredSensors: [],
      declaredActuators: []
    };
  }

  /**
   * Updates firmware version or hardware identity when reported by device beacon.
   */
  public updateDeviceIdentity(params: {
    deviceId: string;
    boardManufacturer?: string;
    boardModel?: string;
    chipFamily?: Esp32ChipFamily;
    firmwareVersion?: string;
    macAddress?: string;
  }): void {
    const driver = this.platformDb.getDriver();
    const nowIso = new Date().toISOString();

    driver.run(
      `UPDATE devices
       SET manufacturer = COALESCE(?, manufacturer),
           hardware_model = COALESCE(?, hardware_model),
           firmware_version = COALESCE(?, firmware_version),
           updated_at = ?
       WHERE id = ?`,
      [
        params.boardManufacturer || null,
        params.boardModel || null,
        params.firmwareVersion || null,
        nowIso,
        params.deviceId
      ]
    );
  }
}
