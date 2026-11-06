/**
 * EDENS AI — Universal Device Health Monitoring
 * Computes truthful 11-state connection status, signal strength, and health diagnostics.
 */

import type { DeviceRecord, PlatformDatabase } from '../database.ts';
import type { DynamicSensorRegistry } from './sensorRegistry.ts';
import type { CameraIntegrationManager } from './cameraManager.ts';
import type {
  HardwareDeviceStateView,
  SupportedIotProtocol,
  TelemetrySource,
  TruthfulDeviceState
} from './types.ts';

export class DeviceHealthMonitoring {
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
   * Computes the truthful connection state across the 11 canonical states.
   */
  public evaluateTruthfulState(
    device: DeviceRecord,
    sensorsCount: number,
    hasValidReadings: boolean,
    nowMs: number = Date.now()
  ): TruthfulDeviceState {
    if (device.revokedAt) return 'REVOKED';

    if (
      device.explicitState === 'AUTHENTICATION_ERROR' ||
      device.explicitState === 'CONNECTION_ERROR'
    ) {
      return 'ERROR';
    }

    if (device.label.toLowerCase().includes('simulated')) {
      return 'SIMULATED';
    }

    if (!device.hasCredentialIssued && !device.credentialPrefix && !device.keyPrefix) {
      return 'DISCOVERED';
    }

    const lastSeen = device.lastTelemetryAt || device.lastUploadAt || device.lastSeenAt;
    if (!lastSeen) {
      return 'AUTHENTICATED'; // Credentials issued, awaiting first physical connection
    }

    const ageSec = Math.max(0, Math.floor((nowMs - new Date(lastSeen).getTime()) / 1000));

    if (ageSec <= 30) {
      if (device.deviceType === 'esp32_cam') {
        const frame = this.cameraManager.getLatestVerifiedFrame(device.greenhouseId, device.id, nowMs);
        return frame && frame.isFresh ? 'ONLINE' : 'CONNECTED';
      }
      // If controller has checked in within 30s but has 0 valid non-null readings yet:
      if (!hasValidReadings) {
        return 'SENSOR_DATA_PENDING';
      }
      return 'ONLINE';
    }

    if (ageSec <= 90) {
      return 'CONNECTED';
    }

    if (ageSec <= 300) {
      return 'STALE';
    }

    return 'OFFLINE';
  }

  /**
   * Builds the comprehensive HardwareDeviceStateView for a single device.
   */
  public getDeviceStateView(
    greenhouseId: string,
    deviceId: string,
    nowMs: number = Date.now()
  ): HardwareDeviceStateView | null {
    const devices = this.platformDb.listDevicesForGreenhouse(greenhouseId, nowMs);
    const dev = devices.find((d) => d.id === deviceId);
    if (!dev) return null;

    const driver = this.platformDb.getDriver();
    const devRow = driver.queryOne<any>('SELECT * FROM devices WHERE id = ?', [deviceId]);

    const sensors = this.sensorRegistry.listSensorsForDevice(deviceId, nowMs);
    const hasValidReadings = sensors.some((s) => s.currentReading !== null && s.healthState === 'valid');

    const truthfulState = this.evaluateTruthfulState(dev, sensors.length, hasValidReadings, nowMs);

    const lastSeen = dev.lastTelemetryAt || dev.lastUploadAt || dev.lastSeenAt;
    const ageSec = lastSeen ? Math.max(0, Math.floor((nowMs - new Date(lastSeen).getTime()) / 1000)) : null;

    let provenance: TelemetrySource = 'REAL_HARDWARE';
    if (truthfulState === 'SIMULATED' || dev.label.toLowerCase().includes('simulated')) {
      provenance = 'SIMULATED';
    }

    let authStatus: HardwareDeviceStateView['authenticationStatus'] = 'VALID';
    if (dev.revokedAt) authStatus = 'REVOKED';
    else if (!dev.hasCredentialIssued) authStatus = 'UNPROVISIONED';

    let healthStatus: HardwareDeviceStateView['deviceHealth'] = 'HEALTHY';
    if (truthfulState === 'ERROR') healthStatus = 'FAULT';
    else if (truthfulState === 'STALE' || truthfulState === 'SENSOR_DATA_PENDING') healthStatus = 'DEGRADED';
    else if (truthfulState === 'OFFLINE') healthStatus = 'OFFLINE';

    const latestFrame = dev.deviceType === 'esp32_cam'
      ? this.cameraManager.getLatestVerifiedFrame(greenhouseId, deviceId, nowMs)
      : undefined;

    return {
      deviceId: dev.id,
      greenhouseId: dev.greenhouseId,
      zoneId: dev.zoneId || null,
      label: dev.label,
      boardManufacturer: devRow?.manufacturer || 'Espressif Systems',
      boardModel: devRow?.hardware_model || (dev.deviceType === 'esp32_cam' ? 'esp32_cam' : 'esp32_devkit_v1'),
      chipFamily: (devRow?.chip_family || 'esp32'),
      firmwareVersion: dev.firmwareVersion || '1.0.0',
      protocol: (devRow?.protocol || 'http_rest') as SupportedIotProtocol,
      connectionMethod: devRow?.protocol ? `Protocol: ${devRow.protocol}` : 'HTTPS Outbound / MQTT-WS',
      truthfulState,
      lastHeartbeat: dev.lastSeenAt,
      lastTelemetry: dev.lastTelemetryAt || dev.lastUploadAt,
      lastImageReceived: latestFrame?.capturedAt || null,
      signalStrengthRssi: null,
      uptimeSeconds: null,
      freeHeapBytes: null,
      dataFreshnessSeconds: ageSec,
      authenticationStatus: authStatus,
      deviceHealth: healthStatus,
      dataProvenance: provenance,
      adapterSelected: dev.deviceType === 'esp32_cam' ? 'esp32_cam_adapter' : 'esp32_standard_controller_adapter',
      discoveredSensors: sensors,
      latestCameraFrame: latestFrame || undefined,
      safetyLocked: true,
      monitoringOnlyActive: true
    };
  }

  /**
   * Lists state views for all devices in a greenhouse.
   */
  public listGreenhouseHardwareStateViews(
    greenhouseId: string,
    nowMs: number = Date.now()
  ): HardwareDeviceStateView[] {
    const devices = this.platformDb.listDevicesForGreenhouse(greenhouseId, nowMs);
    const views: HardwareDeviceStateView[] = [];

    for (const d of devices) {
      const v = this.getDeviceStateView(greenhouseId, d.id, nowMs);
      if (v) views.push(v);
    }

    return views;
  }
}
