/**
 * EDENS AI — Universal Self-Adapting Hardware Plugin
 * Main integration facade unifying all 10 hardware subsystems.
 */

import type { CameraImageStore } from '../cameraStorage.ts';
import type { PlatformDatabase } from '../database.ts';
import { CapabilityRegistry, globalCapabilityRegistry } from './capabilityRegistry.ts';
import { HardwareAdapterManager, globalAdapterManager } from './adapterManager.ts';
import { DynamicSensorRegistry } from './sensorRegistry.ts';
import { CameraIntegrationManager } from './cameraManager.ts';
import { DeviceAuthenticationService } from './authService.ts';
import { UniversalDeviceRegistry } from './deviceRegistry.ts';
import { DeviceDiscoveryService } from './discoveryService.ts';
import { TelemetryIngestionService } from './telemetryIngestionService.ts';
import { DeviceHealthMonitoring } from './healthMonitoring.ts';
import { HardwareAuditSystem } from './hardwareAuditSystem.ts';

export * from './types.ts';
export * from './capabilityRegistry.ts';
export * from './adapterManager.ts';
export * from './sensorRegistry.ts';
export * from './cameraManager.ts';
export * from './authService.ts';
export * from './deviceRegistry.ts';
export * from './discoveryService.ts';
export * from './telemetryIngestionService.ts';
export * from './healthMonitoring.ts';
export * from './hardwareAuditSystem.ts';

export interface UniversalHardwarePlugin {
  capabilityRegistry: CapabilityRegistry;
  adapterManager: HardwareAdapterManager;
  sensorRegistry: DynamicSensorRegistry;
  cameraManager: CameraIntegrationManager;
  authService: DeviceAuthenticationService;
  deviceRegistry: UniversalDeviceRegistry;
  discoveryService: DeviceDiscoveryService;
  telemetryIngestion: TelemetryIngestionService;
  healthMonitoring: DeviceHealthMonitoring;
  auditSystem: HardwareAuditSystem;
}

export function createUniversalHardwarePlugin(deps: {
  platformDb: PlatformDatabase;
  getCameraStore: (greenhouseId: string) => CameraImageStore;
}): UniversalHardwarePlugin {
  const { platformDb, getCameraStore } = deps;

  const capabilityRegistry = globalCapabilityRegistry;
  const adapterManager = globalAdapterManager;
  const sensorRegistry = new DynamicSensorRegistry(platformDb);
  const cameraManager = new CameraIntegrationManager({ platformDb, getCameraStore });
  const authService = new DeviceAuthenticationService(platformDb);
  const deviceRegistry = new UniversalDeviceRegistry(platformDb);
  const discoveryService = new DeviceDiscoveryService({ platformDb, sensorRegistry, cameraManager });
  const telemetryIngestion = new TelemetryIngestionService({ platformDb, sensorRegistry });
  const healthMonitoring = new DeviceHealthMonitoring({ platformDb, sensorRegistry, cameraManager });
  const auditSystem = new HardwareAuditSystem(platformDb);

  return {
    capabilityRegistry,
    adapterManager,
    sensorRegistry,
    cameraManager,
    authService,
    deviceRegistry,
    discoveryService,
    telemetryIngestion,
    healthMonitoring,
    auditSystem
  };
}
