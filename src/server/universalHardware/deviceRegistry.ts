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
    zoneId?: string | null;
    deviceType: 'esp32_controller' | 'esp32_cam' | 'environmental_node';
    label: string;
    boardManufacturer?: string;
    boardModel?: string;
    chipFamily?: Esp32ChipFamily;
    firmwareVersion?: string;
    serialNumber?: string;
    capabilities?: string[];
  }): { ok: boolean; device: DeviceRecord; profile: DeviceProfile } {
    const driver = this.platformDb.getDriver();
    const owner = driver.queryOne<{ user_id: string }>(
      'SELECT user_id FROM greenhouse_members WHERE greenhouse_id = ? AND role = "owner" LIMIT 1',
      [params.greenhouseId]
    );
    const actorUserId = owner?.user_id || 'usr_system';
    const targetType = params.deviceType === 'esp32_cam' ? 'esp32_cam' : 'esp32_controller';

    const regRes = this.platformDb.registerOrUpdateDevice({
      greenhouseId: params.greenhouseId,
      actorUserId,
      deviceType: targetType,
      label: params.label,
      zoneId: params.zoneId || null,
      serialNumber: params.serialNumber || null,
      createAdditionalSlot: true,
      capabilities: {
        sensors: params.capabilities || [],
        actuators: []
      }
    });

    if ('errorCode' in regRes || !regRes.ok || !regRes.device) {
      throw new Error(('message' in regRes && regRes.message) || 'Failed to register device slot');
    }

    const dev = regRes.device;
    const nowIso = new Date().toISOString();

    // Persist hardware profile info
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
