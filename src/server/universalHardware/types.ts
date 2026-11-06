/**
 * EDENS AI — Universal Self-Adapting Hardware Plugin Types & Contracts
 * Phase 1 through 11 Canonical Hardware Architecture Specification
 */

export type SupportedIotProtocol =
  | 'mqtt'
  | 'http_rest'
  | 'websocket'
  | 'esphome_api'
  | 'thingsboard_v1';

export type TruthfulDeviceState =
  | 'DISCOVERED'
  | 'PAIRING'
  | 'AUTHENTICATED'
  | 'CONNECTED'
  | 'ONLINE'
  | 'SENSOR_DATA_PENDING'
  | 'OFFLINE'
  | 'STALE'
  | 'ERROR'
  | 'REVOKED'
  | 'SIMULATED';

export type Esp32ChipFamily =
  | 'esp32'          // Original dual-core Xtensa LX6 (ESP32-D0WD, DevKit V1, WROOM, WROVER)
  | 'esp32s2'        // Single-core Xtensa LX7 (USB OTG, Low Power)
  | 'esp32s3'        // Dual-core Xtensa LX7 (Vector AI instructions, USB, Camera-capable)
  | 'esp32c3'        // Single-core RISC-V RV32IMC (Cost-effective Wi-Fi 4 + BLE 5)
  | 'esp32c6'        // Wi-Fi 6 + Zigbee/Thread RISC-V
  | 'esp32h2'        // 802.15.4 / Zigbee / Thread only
  | 'unknown';

export type BoardCategory =
  | 'controller_standard'
  | 'controller_psram'
  | 'camera_node'
  | 'gateway_edge'
  | 'composite_node'
  | 'custom_experimental';

export type TelemetryQuality =
  | 'valid'
  | 'out_of_range'
  | 'stale'
  | 'sensor_fault'
  | 'uncalibrated'
  | 'unavailable';

export type TelemetrySource = 'REAL_HARDWARE' | 'SIMULATED';

export type SensorCategory =
  | 'temperature'
  | 'humidity'
  | 'soil_moisture'
  | 'light_intensity'
  | 'co2'
  | 'water_level'
  | 'ph'
  | 'ec'
  | 'atmospheric_pressure'
  | 'rainfall'
  | 'battery_voltage'
  | 'leaf_wetness'
  | 'par_light'
  | 'custom';

export interface SensorPhysicalBound {
  category: SensorCategory;
  canonicalUnit: string;
  defaultLabel: string;
  minPhysical: number;
  maxPhysical: number;
  typicalGreenhouseMin: number;
  typicalGreenhouseMax: number;
}

export interface SensorDeclaration {
  id: string;
  category: SensorCategory;
  model?: string;
  label?: string;
  unit?: string;
  pinOrBus?: string;
  calibrationOffset?: number;
  calibrationMultiplier?: number;
}

export interface DiscoveredSensorRecord {
  sensorId: string;
  sensorType: SensorCategory;
  sensorModel: string;
  deviceId: string;
  greenhouseId: string;
  zoneId: string | null;
  measurementUnit: string;
  currentReading: number | null;
  timestamp: string | null;
  calibrationOffset: number;
  calibrationMultiplier: number;
  healthState: TelemetryQuality;
  dataProvenance: TelemetrySource;
  rawFieldKey?: string;
  pinOrBus?: string;
  lastUpdated: string;
}

export interface DeviceProfile {
  deviceId: string;
  greenhouseId: string;
  zoneId: string | null;
  label: string;
  boardManufacturer: string;
  boardModel: string;
  chipFamily: Esp32ChipFamily;
  boardCategory: BoardCategory;
  firmwareVersion: string;
  firmwareBuildDate?: string;
  macAddress?: string;
  flashSizeMb?: number;
  hasPsram?: boolean;
  cameraCapable: boolean;
  supportedProtocols: SupportedIotProtocol[];
  hardwareFeatures: string[];
  declaredSensors: SensorDeclaration[];
  declaredActuators: string[];
  networkInfo?: {
    ipAddress?: string;
    ssid?: string;
    wifiRssi?: number;
    connectionType?: 'wifi' | 'ethernet' | 'cellular';
  };
}

export interface CameraCapabilityDetails {
  cameraCapable: boolean;
  sensorModel: string;      // e.g. "OV2640", "OV3660", "OV5640"
  supportedResolutions: string[]; // e.g. ["QVGA", "VGA", "SVGA", "XGA", "SXGA", "UXGA"]
  hasHardwareJpeg: boolean;
  hasLedFlash: boolean;
  streamUrl?: string | null;
  photoUrl?: string | null;
  statusUrl?: string | null;
  transportMode: 'cloud_upload' | 'local_lan_http' | 'esphome_camera';
}

export interface CameraFrameDetails {
  frameId: string;
  deviceId: string;
  greenhouseId: string;
  capturedAt: string;
  receivedAt: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
  freshnessSeconds: number;
  isFresh: boolean;
  dataProvenance: TelemetrySource;
}

export interface AdapterMatchResult {
  compatible: boolean;
  matchScore: number;     // 0-100 score
  selectedAdapterId: string;
  adapterDisplayName: string;
  matchedChipFamily: boolean;
  matchedModel: boolean;
  warnings: string[];
  reasons: string[];
}

export interface IngestionContext {
  deviceId: string;
  greenhouseId: string;
  zoneId: string | null;
  protocol: SupportedIotProtocol;
  topicOrPath?: string;
  remoteIp?: string;
  receivedAtIso: string;
  rawSampleId?: string;
}

export interface StandardReadingOutput {
  deviceId: string;
  sensorId: string;
  sensorType: SensorCategory;
  sensorModel: string;
  value: number;
  unit: string;
  timestamp: string;
  quality: TelemetryQuality;
  source: TelemetrySource;
}

export interface NormalizedIngestionOutput {
  ok: boolean;
  errorCode?: string;
  message?: string;
  sampleId?: string;
  readings: StandardReadingOutput[];
  detectedSensors?: SensorDeclaration[];
  detectedCamera?: Partial<CameraCapabilityDetails>;
  deviceHealth?: {
    uptimeSeconds?: number;
    freeHeapBytes?: number;
    wifiRssi?: number;
    batteryVoltage?: number;
    rebootCount?: number;
  };
}

export interface HardwareAdapterPlugin {
  adapterId: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  upstreamLicense: string;
  supportedChipFamilies: Esp32ChipFamily[];
  supportedBoardModels: string[];
  supportedBoardCategories: BoardCategory[];
  minFirmwareVersion: string;
  maxFirmwareVersion?: string;
  supportedProtocols: SupportedIotProtocol[];
  supportsCamera: boolean;
  supportsSensors: boolean;
  validateCompatibility: (profile: Partial<DeviceProfile>) => AdapterMatchResult;
  normalizePayload: (rawPayload: unknown, context: IngestionContext) => NormalizedIngestionOutput;
  generateConfigurationHeader?: (params: {
    deviceId: string;
    greenhouseId: string;
    deviceKey: string;
    backendUrl: string;
  }) => string;
}

export interface HardwareAuditEvent {
  id: string;
  timestamp: string;
  greenhouseId: string;
  deviceId?: string;
  actor: string;
  eventType:
    | 'DEVICE_DISCOVERED'
    | 'DEVICE_ENROLLED'
    | 'CREDENTIALS_ISSUED'
    | 'CREDENTIALS_ROTATED'
    | 'CREDENTIALS_REVOKED'
    | 'ADAPTER_SELECTED'
    | 'ADAPTER_MISMATCH'
    | 'SENSOR_DISCOVERED'
    | 'CAMERA_FRAME_RECEIVED'
    | 'TELEMETRY_INGESTED'
    | 'CONNECTION_STATE_CHANGED'
    | 'SAFETY_INTERLOCK_TRIGGERED'
    | 'UNAUTHORIZED_ACCESS_BLOCKED';
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  details: Record<string, unknown>;
}

export interface HardwareDeviceStateView {
  deviceId: string;
  greenhouseId: string;
  zoneId: string | null;
  label: string;
  boardManufacturer: string;
  boardModel: string;
  chipFamily: Esp32ChipFamily;
  firmwareVersion: string;
  protocol: SupportedIotProtocol;
  connectionMethod: string;
  truthfulState: TruthfulDeviceState;
  lastHeartbeat: string | null;
  lastTelemetry: string | null;
  lastImageReceived: string | null;
  signalStrengthRssi: number | null;
  uptimeSeconds: number | null;
  freeHeapBytes: number | null;
  dataFreshnessSeconds: number | null;
  authenticationStatus: 'VALID' | 'PENDING' | 'REVOKED' | 'EXPIRED' | 'UNPROVISIONED';
  deviceHealth: 'HEALTHY' | 'DEGRADED' | 'FAULT' | 'OFFLINE';
  dataProvenance: TelemetrySource;
  adapterSelected: string;
  discoveredSensors: DiscoveredSensorRecord[];
  cameraDetails?: CameraCapabilityDetails;
  latestCameraFrame?: CameraFrameDetails;
  safetyLocked: boolean;
  monitoringOnlyActive: true;
}
