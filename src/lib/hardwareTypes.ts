/**
 * EDENS AI - Hardware Integration Data Types & Contracts
 * Main Controller (ESP32) and ESP32-CAM interfaces
 */

export type DataSource = 'REAL_HARDWARE' | 'SIMULATED' | 'CACHED' | 'STALE' | 'DISCONNECTED';

export type ConnectionMode = 'direct' | 'proxy' | 'simulation';

export interface EnvironmentalTelemetry {
  temperature: number;      // °C
  humidity: number;         // %
  soilMoisture: number;     // %
  sunlight: number;         // lux
  growLight: number;        // lux
  rain: boolean;            // true if rain detected
  rainGaugeLevel: number;   // mm
  waterLevel: number;       // %
  batteryVoltage: number;   // V
}

export interface ActuatorStates {
  pumpActive: boolean;
  fanActive: boolean;
  lightActive: boolean;
  heaterActive: boolean;
  peltierActive: boolean;
  peltierFan1Active: boolean;
  peltierFan2Active: boolean;
  roofActive: boolean;      // true if open, false if closed
}

export interface SafetyInterlocks {
  rainLocked: boolean;         // roof locked closed due to rain
  waterLowLocked: boolean;     // pump locked off due to low water reservoir
  thermalLocked: boolean;      // heaters locked off due to high temperature
  overIrrigationLocked: boolean; // pump locked off due to max duration cap
}

export interface Esp32StatusResponse {
  connected: boolean;
  uptimeSeconds: number;
  firmwareVersion: string;
  wifiRssi: number;
  freeHeapBytes: number;
  telemetry: EnvironmentalTelemetry;
  actuators: ActuatorStates;
  interlocks: SafetyInterlocks;
  activeCropId: string;
  activeCropName: string;
  autonomousPaused: boolean;
  pauseRemainingSeconds: number;
  timestamp: string;
  dataSource: DataSource;
  latencyMs?: number;
}

export interface CropProfile {
  id: string;
  name: string;
  scientificName?: string;
  nativeNames?: {
    hausa?: string;
    yoruba?: string;
    igbo?: string;
    pidgin?: string;
  };
  tempMin: number;
  tempMax: number;
  humMin: number;
  humMax: number;
  soilMin: number;
  soilMax: number;
  daysToHarvest: number;
  description: string;
}

export interface HardwareConfig {
  controllerHost: string;       // e.g. "http://192.168.1.100" or mDNS "http://edens-esp32.local"
  controllerPort: number;       // e.g. 80
  controllerApiKey: string;     // Auth token / API key
  cameraHost: string;           // e.g. "http://192.168.1.101"
  cameraPort: number;           // e.g. 81
  cameraStreamPath: string;     // default "/stream"
  cameraCapturePath: string;    // default "/capture"
  cameraStatusPath: string;     // default "/status"
  mode: ConnectionMode;         // 'simulation' | 'direct' | 'proxy'
  pollIntervalMs: number;       // default 3000ms
  timeoutMs: number;            // default 5000ms
  safetyInterlocksEnabled: boolean; // default true
  proxyGatewayUrl: string;      // default "/api/hardware"
}

export interface CameraStatusResponse {
  connected: boolean;
  sensorModel: string;          // e.g. "OV2640" or "OV5640"
  resolution: string;           // e.g. "SVGA (800x600)"
  frameRate: number;            // fps
  wifiRssi: number;
  uptimeSeconds: number;
  streamUrl: string;
  captureUrl: string;
  dataSource: DataSource;
  latencyMs?: number;
  lastCaptureTimestamp?: string;
}

export interface DiagnosticLog {
  id: string;
  timestamp: string;
  endpoint: string;
  status: 'SUCCESS' | 'ERROR' | 'WARNING' | 'TIMEOUT';
  statusCode?: number;
  latencyMs: number;
  message: string;
  dataSource: DataSource;
  details?: any;
}

export interface CameraUploadResponse {
  success: boolean;
  message: string;
  imageId: string;
  timestamp: string;
  sizeBytes: number;
  mimeType: string;
  url: string;
  totalUploadsReceived: number;
  readyForVisionAnalysis?: boolean;
}

export interface LatestUploadedImage {
  exists: boolean;
  status: 'ONLINE' | 'IDLE' | 'CACHED' | 'STALE' | 'WAITING_FOR_UPLOAD' | 'OFFLINE';
  freshness?: 'FRESH' | 'CACHED' | 'STALE' | 'NONE';
  isFresh?: boolean;
  isStale?: boolean;
  isLiveStream?: boolean;
  id?: string;
  timestamp?: string;
  capturedAt?: string;
  ageSeconds?: number;
  sizeBytes?: number;
  mimeType?: string;
  url?: string;
  base64?: string;
  acquisitionMethod?: 'ESP32_CAM_UPLOAD' | 'LAN_GATEWAY_PULL';
  cameraAddress?: string | null;
  analyzed?: boolean;
  analysis?: any;
  dataSource: DataSource;
  totalUploadsCount?: number;
  freshMaxSeconds?: number;
  uploadEndpoint?: string;
}

export interface CameraUploadInfo {
  endpoint: string;
  method: string;
  supportedContentTypes: string[];
  authHeader: string;
  authQueryParam?: string;
  maxSizeMb: number;
  freshMaxSeconds?: number;
  authConfigured: boolean;
  cloudHosted?: boolean;
  lanGatewayConfigured?: boolean;
  latestUploadTimestamp: string | null;
  latestImageId?: string | null;
  latestSizeBytes?: number;
  latestFreshness?: string;
  latestIsFresh?: boolean;
  latestAgeSeconds?: number | null;
  latestDataSource?: DataSource;
  totalUploadsReceived: number;
  hasUploadedImage: boolean;
}

