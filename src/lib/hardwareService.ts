/**
 * EDENS AI - Dedicated Hardware Integration Service
 * Manages communication with Main ESP32 Controller and ESP32-CAM.
 * Supports:
 * - GET /status
 * - GET /crops
 * - GET /setPlant
 * - GET /setCustom
 * - GET /roof
 * - GET /override
 * - GET /pause
 * - GET /setOption
 * - Camera GET /status, GET /stream, GET /capture
 * 
 * Enforces hardware safety interlocks, manages connection states,
 * and provides explicitly labeled simulation when physical hardware is offline.
 */

import { store } from './store';
import {
  HardwareConfig,
  Esp32StatusResponse,
  CropProfile,
  CameraStatusResponse,
  DiagnosticLog,
  DataSource,
  SafetyInterlocks,
  ActuatorStates,
  EnvironmentalTelemetry,
  LatestUploadedImage,
  CameraUploadResponse,
  CameraUploadInfo
} from './hardwareTypes';

// Default standard crops supported by EDENS AI ESP32 firmware
export const DEFAULT_CROPS: CropProfile[] = [
  {
    id: 'tomato',
    name: 'Tomato (Tumatir / Tòmátì)',
    scientificName: 'Solanum lycopersicum',
    nativeNames: {
      hausa: 'Tumatir',
      yoruba: 'Tòmátì',
      igbo: 'Tomato',
      pidgin: 'Tomato'
    },
    tempMin: 20,
    tempMax: 28,
    humMin: 55,
    humMax: 75,
    soilMin: 45,
    soilMax: 65,
    daysToHarvest: 75,
    description: 'Requires warm climate, consistent soil moisture, and good ventilation to prevent fungal blight.'
  },
  {
    id: 'pepper',
    name: 'Habanero / Rodo Pepper',
    scientificName: 'Capsicum chinense',
    nativeNames: {
      hausa: 'Barkono',
      yoruba: 'Ata Rodo',
      igbo: 'Ose Oyibo',
      pidgin: 'Hot Pepper'
    },
    tempMin: 22,
    tempMax: 32,
    humMin: 50,
    humMax: 70,
    soilMin: 40,
    soilMax: 60,
    daysToHarvest: 90,
    description: 'Loves heat, moderate watering, and bright light. Very susceptible to waterlogging.'
  },
  {
    id: 'lettuce',
    name: 'Lettuce / Salad Greens',
    scientificName: 'Lactuca sativa',
    nativeNames: {
      hausa: 'Salak / Latas',
      yoruba: 'Ẹ̀fọ́ Yáńrin',
      igbo: 'Akwụkwọ Nri Salad',
      pidgin: 'Salad Leaf'
    },
    tempMin: 16,
    tempMax: 24,
    humMin: 50,
    humMax: 70,
    soilMin: 50,
    soilMax: 70,
    daysToHarvest: 45,
    description: 'Cool season crop. High heat causes bolting and bitter taste. Keep shaded in tropical mid-day.'
  },
  {
    id: 'ugwu',
    name: 'Fluted Pumpkin (Ugwu)',
    scientificName: 'Telfairia occidentalis',
    nativeNames: {
      hausa: 'Kabewa',
      yoruba: 'Agbègbè',
      igbo: 'Ụgbọgụrụ / Ugwu',
      pidgin: 'Ugwu Vegetable'
    },
    tempMin: 22,
    tempMax: 30,
    humMin: 60,
    humMax: 85,
    soilMin: 55,
    soilMax: 75,
    daysToHarvest: 35,
    description: 'Thrives in humid tropical conditions. Rapid vegetative growth with regular drip irrigation.'
  },
  {
    id: 'cucumber',
    name: 'Cucumber',
    scientificName: 'Cucumis sativus',
    nativeNames: {
      hausa: 'Gurinji',
      yoruba: 'Kukumba',
      igbo: 'Kukumba',
      pidgin: 'Cucumber'
    },
    tempMin: 22,
    tempMax: 29,
    humMin: 60,
    humMax: 80,
    soilMin: 50,
    soilMax: 70,
    daysToHarvest: 55,
    description: 'High water requirement. Benefits from trellising and automated morning watering.'
  }
];

class HardwareService {
  private config: HardwareConfig;
  private pollTimer: any = null;
  private isPolling = false;
  private diagnosticLogs: DiagnosticLog[] = [];
  private lastSuccessfulRead: Esp32StatusResponse | null = null;
  private lastReadTimestamp: number = 0;
  private consecutiveErrors = 0;
  private currentDataSource: DataSource = 'DISCONNECTED';
  private listeners: Set<() => void> = new Set();

  // Simulated internal greenhouse physics state
  private simState = {
    temp: 24.5,
    humidity: 62.0,
    soilMoisture: 52.0,
    sunlight: 680,
    growLight: 350,
    rain: false,
    rainGauge: 0,
    waterLevel: 78.0,
    battery: 12.4,
    pump: false,
    fan: false,
    light: false,
    heater: false,
    peltier: false,
    peltierFan1: false,
    peltierFan2: false,
    roof: false,
    activeCropId: 'tomato',
    autonomousPaused: false,
    pauseRemainingSeconds: 0,
    uptimeSeconds: 12450
  };

  constructor() {
    this.config = this.loadConfig();
    this.currentDataSource = this.config.mode === 'simulation' ? 'SIMULATED' : 'DISCONNECTED';
    store.setValue('hardware_dataSource', this.currentDataSource);
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach(fn => fn());
  }

  public getConfig(): HardwareConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<HardwareConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();

    this.currentDataSource = this.getDataSource();
    store.setValue('hardware_dataSource', this.currentDataSource);

    this.notify();
    this.restartPolling();
  }

  private loadConfig(): HardwareConfig {
    try {
      const stored = localStorage.getItem('edens_hardware_config');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (!parsed.cameraHost || String(parsed.cameraHost).includes('placeholder-ip')) {
          parsed.cameraHost = '';
        }
        return parsed;
      }
    } catch (_) {}

    return {
      controllerHost: '',
      controllerPort: 80,
      controllerApiKey: '',
      cameraHost: '',
      cameraPort: 81,
      cameraStreamPath: '/stream',
      cameraCapturePath: '/photo',
      cameraStatusPath: '/status',
      mode: 'simulation', // Simulation by default until configured
      pollIntervalMs: 3000,
      timeoutMs: 5000,
      safetyInterlocksEnabled: true,
      proxyGatewayUrl: '/api/hardware'
    };
  }

  private saveConfig() {
    try {
      // Store config safely in localStorage
      localStorage.setItem('edens_hardware_config', JSON.stringify(this.config));
    } catch (_) {}
  }

  public getDataSource(): DataSource {
    if (this.config.mode === 'simulation') {
      return 'SIMULATED';
    }
    if (!this.lastSuccessfulRead || !this.lastReadTimestamp) {
      return 'DISCONNECTED';
    }
    const ageMs = Date.now() - this.lastReadTimestamp;
    if (ageMs > 120000) {
      return 'DISCONNECTED';
    }
    if (ageMs > 25000) {
      return 'STALE';
    }
    if (ageMs > 8000) {
      return 'CACHED';
    }
    return 'REAL_HARDWARE';
  }

  public getSensorFreshnessSeconds(): number {
    if (!this.lastReadTimestamp) return 999;
    return Math.floor((Date.now() - this.lastReadTimestamp) / 1000);
  }

  public getDiagnosticLogs(): DiagnosticLog[] {
    return [...this.diagnosticLogs];
  }

  private logDiagnostic(
    endpoint: string,
    status: 'SUCCESS' | 'ERROR' | 'WARNING' | 'TIMEOUT',
    message: string,
    latencyMs: number,
    statusCode?: number,
    details?: any
  ) {
    const entry: DiagnosticLog = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      endpoint,
      status,
      statusCode,
      latencyMs,
      message,
      dataSource: this.getDataSource(),
      details
    };
    this.diagnosticLogs = [entry, ...this.diagnosticLogs.slice(0, 49)];
    this.notify();
  }

  // Build full request URL and headers based on connection mode
  private buildRequest(endpoint: string, params: Record<string, string | number | boolean> = {}) {
    const isSimulation = this.config.mode === 'simulation';
    if (isSimulation) return { url: '', headers: {}, isSimulation: true };

    let baseUrl = '';
    if (this.config.mode === 'proxy') {
      baseUrl = `${this.config.proxyGatewayUrl}?endpoint=${encodeURIComponent(endpoint)}`;
    } else {
      let host = this.config.controllerHost.trim();
      if (!host.startsWith('http://') && !host.startsWith('https://')) {
        host = `http://${host}`;
      }
      if (this.config.controllerPort && this.config.controllerPort !== 80) {
        // Only append port if not already present
        const urlObj = new URL(host);
        urlObj.port = this.config.controllerPort.toString();
        baseUrl = `${urlObj.origin}${endpoint}`;
      } else {
        baseUrl = `${host.replace(/\/$/, '')}${endpoint}`;
      }
    }

    const url = new URL(baseUrl, window.location.origin);

    if (this.config.mode === 'proxy' && this.config.controllerHost.trim()) {
      url.searchParams.set('host', this.config.controllerHost.trim());
      if (this.config.controllerPort) {
        url.searchParams.set('port', String(this.config.controllerPort));
      }
    }

    // Append parameters
    Object.entries(params).forEach(([k, v]) => {
      url.searchParams.set(k, String(v));
    });

    // Append auth parameter if configured
    if (this.config.controllerApiKey) {
      url.searchParams.set('auth', this.config.controllerApiKey);
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };

    if (this.config.controllerApiKey) {
      headers['X-API-Key'] = this.config.controllerApiKey;
    }

    return { url: url.toString(), headers, isSimulation: false };
  }

  // -------------------------------------------------------------
  // ENDPOINT 1: GET /status
  // -------------------------------------------------------------
  public async getStatus(): Promise<Esp32StatusResponse> {
    const startTime = performance.now();

    if (this.config.mode === 'simulation') {
      // Simulate physics update
      this.updateSimulationPhysics();
      const latencyMs = Math.round(15 + Math.random() * 25);
      
      const response: Esp32StatusResponse = {
        connected: true,
        uptimeSeconds: this.simState.uptimeSeconds,
        firmwareVersion: 'EDENS-ESP32-v2.4.1-SIM',
        wifiRssi: -58,
        freeHeapBytes: 184520,
        telemetry: {
          temperature: this.simState.temp,
          humidity: this.simState.humidity,
          soilMoisture: this.simState.soilMoisture,
          sunlight: this.simState.sunlight,
          growLight: this.simState.growLight,
          rain: this.simState.rain,
          rainGaugeLevel: this.simState.rainGauge,
          waterLevel: this.simState.waterLevel,
          batteryVoltage: this.simState.battery
        },
        actuators: {
          pumpActive: this.simState.pump,
          fanActive: this.simState.fan,
          lightActive: this.simState.light,
          heaterActive: this.simState.heater,
          peltierActive: this.simState.peltier,
          peltierFan1Active: this.simState.peltierFan1,
          peltierFan2Active: this.simState.peltierFan2,
          roofActive: this.simState.roof
        },
        interlocks: this.calculateInterlocks(
          this.simState.rain,
          this.simState.waterLevel,
          this.simState.temp
        ),
        activeCropId: this.simState.activeCropId,
        activeCropName: DEFAULT_CROPS.find(c => c.id === this.simState.activeCropId)?.name || 'Custom Crop',
        autonomousPaused: this.simState.autonomousPaused,
        pauseRemainingSeconds: this.simState.pauseRemainingSeconds,
        timestamp: new Date().toISOString(),
        dataSource: 'SIMULATED',
        latencyMs
      };

      this.lastSuccessfulRead = response;
      this.lastReadTimestamp = Date.now();
      this.syncToStore(response);
      return response;
    }

    // Real Hardware Connection Mode
    if (this.config.mode === 'direct' && !this.config.controllerHost.trim()) {
      this.currentDataSource = 'DISCONNECTED';
      store.setValue('hardware_dataSource', 'DISCONNECTED');
      this.notify();
      const err = new Error('Main ESP32 controller host/IP address has not been configured.');
      this.logDiagnostic('/status', 'WARNING', err.message, 0);
      throw err;
    }

    const { url, headers } = this.buildRequest('/status');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - startTime);

      if (!res.ok) {
        throw new Error(`ESP32 returned HTTP ${res.status}: ${res.statusText}`);
      }

      const raw = await res.json();
      const parsed: Esp32StatusResponse = this.normalizeStatusPayload(raw, latencyMs);

      this.lastSuccessfulRead = parsed;
      this.lastReadTimestamp = new Date(parsed.timestamp).getTime() || Date.now();
      this.consecutiveErrors = 0;
      this.currentDataSource = parsed.dataSource;

      this.logDiagnostic('/status', 'SUCCESS', `Telemetry fetched (${parsed.dataSource})`, latencyMs, res.status);
      this.syncToStore(parsed);
      return parsed;

    } catch (err: any) {
      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - startTime);
      this.consecutiveErrors++;

      const isTimeout = err.name === 'AbortError';
      const targetDesc = this.config.controllerHost.trim() || this.config.proxyGatewayUrl;
      const msg = isTimeout 
        ? `Connection timed out after ${this.config.timeoutMs}ms reaching ${targetDesc}` 
        : (err.message || 'Network error reaching ESP32');

      this.logDiagnostic('/status', isTimeout ? 'TIMEOUT' : 'ERROR', msg, latencyMs, undefined, { error: String(err) });

      if (this.lastSuccessfulRead && this.lastReadTimestamp) {
        const ageMs = Date.now() - this.lastReadTimestamp;
        if (ageMs <= 25000) {
          this.currentDataSource = 'CACHED';
          store.setValue('hardware_dataSource', 'CACHED');
          this.notify();
          return { ...this.lastSuccessfulRead, dataSource: 'CACHED' };
        }
        if (ageMs <= 120000) {
          this.currentDataSource = 'STALE';
          store.setValue('hardware_dataSource', 'STALE');
          this.notify();
          return { ...this.lastSuccessfulRead, dataSource: 'STALE' };
        }
      }

      this.currentDataSource = 'DISCONNECTED';
      store.setValue('hardware_dataSource', 'DISCONNECTED');
      this.notify();
      throw new Error(`Failed to communicate with main ESP32 controller: ${msg}`);
    }
  }

  // -------------------------------------------------------------
  // ENDPOINT 2: GET /crops
  // -------------------------------------------------------------
  public async getCrops(): Promise<CropProfile[]> {
    const startTime = performance.now();

    if (this.config.mode === 'simulation') {
      return DEFAULT_CROPS;
    }

    if (this.config.mode === 'direct' && !this.config.controllerHost.trim()) {
      return DEFAULT_CROPS;
    }

    const { url, headers } = this.buildRequest('/crops');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - startTime);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      this.logDiagnostic('/crops', 'SUCCESS', `Retrieved ${data.length || 0} crop profiles from firmware`, latencyMs, res.status);
      return Array.isArray(data) && data.length > 0 ? data : DEFAULT_CROPS;
    } catch (err: any) {
      clearTimeout(timeoutId);
      this.logDiagnostic('/crops', 'WARNING', `Using built-in crops: ${err.message}`, Math.round(performance.now() - startTime));
      return DEFAULT_CROPS;
    }
  }

  // -------------------------------------------------------------
  // ENDPOINT 3: GET /setPlant
  // -------------------------------------------------------------
  public async setPlant(cropId: string): Promise<{ success: boolean; message: string }> {
    const crop = DEFAULT_CROPS.find(c => c.id === cropId) || { id: cropId, name: cropId };

    if (this.config.mode === 'simulation') {
      this.simState.activeCropId = cropId;
      store.setValue('cropType', crop.name);
      store.setValue('activeCropId', cropId);
      this.logDiagnostic('/setPlant', 'SUCCESS', `[SIMULATION] Active crop set to ${crop.name}`, 12);
      return { success: true, message: `Crop successfully configured to ${crop.name} (Simulation)` };
    }

    this.verifyCommandAuthorization();
    const { url, headers } = this.buildRequest('/setPlant', { crop: cropId });
    const res = await this.executeCommand(url, headers, '/setPlant');
    
    store.setValue('cropType', crop.name);
    store.setValue('activeCropId', cropId);
    return res;
  }

  // -------------------------------------------------------------
  // ENDPOINT 4: GET /setCustom
  // -------------------------------------------------------------
  public async setCustom(params: {
    tempMin: number;
    tempMax: number;
    humMin: number;
    humMax: number;
    soilMin: number;
    soilMax: number;
  }): Promise<{ success: boolean; message: string }> {
    if (this.config.mode === 'simulation') {
      store.setValue('tempMinThreshold', params.tempMin.toString());
      store.setValue('tempMaxThreshold', params.tempMax.toString());
      store.setValue('humMinThreshold', params.humMin.toString());
      store.setValue('humMaxThreshold', params.humMax.toString());
      store.setValue('soilMinThreshold', params.soilMin.toString());
      store.setValue('soilMaxThreshold', params.soilMax.toString());
      this.logDiagnostic('/setCustom', 'SUCCESS', `[SIMULATION] Custom thresholds updated`, 14);
      return { success: true, message: 'Custom thresholds set successfully in simulation' };
    }

    this.verifyCommandAuthorization();
    const { url, headers } = this.buildRequest('/setCustom', params);
    return this.executeCommand(url, headers, '/setCustom');
  }

  // -------------------------------------------------------------
  // ENDPOINT 5: GET /roof (With Rain Safety Interlock)
  // -------------------------------------------------------------
  public async setRoof(
    action: 'open' | 'close' | 'stop' | 'auto',
    emergencyOverride: boolean = false
  ): Promise<{ success: boolean; message: string; interlockTriggered?: boolean }> {
    const currentRain = store.getValue('rain') === true || this.simState.rain === true;

    // FIRMWARE SAFETY RESTRICTION:
    // If rain is detected, the roof MUST NOT open unless emergency override is explicitly confirmed.
    if ((action === 'open' || action === 'auto') && currentRain && !emergencyOverride) {
      const msg = 'SAFETY INTERLOCK BLOCKED: Cannot open greenhouse roof while rain is active. Hardware protection engaged.';
      this.logDiagnostic('/roof', 'WARNING', msg, 0);
      return {
        success: false,
        message: msg,
        interlockTriggered: true
      };
    }

    if (this.config.mode === 'simulation') {
      const isOpen = action === 'open';
      this.simState.roof = isOpen;
      store.setValue('roofActive', isOpen);
      this.logDiagnostic('/roof', 'SUCCESS', `[SIMULATION] Roof set to ${action.toUpperCase()}`, 15);
      return { success: true, message: `Roof command executed: ${action.toUpperCase()} (Simulation)` };
    }

    this.verifyCommandAuthorization();
    const { url, headers } = this.buildRequest('/roof', { state: action, override: emergencyOverride });
    const res = await this.executeCommand(url, headers, '/roof');
    store.setValue('roofActive', action === 'open');
    return res;
  }

  // -------------------------------------------------------------
  // ENDPOINT 6: GET /override (Manual Device Override)
  // -------------------------------------------------------------
  public async setOverride(
    device: 'pump' | 'fan' | 'light' | 'heater' | 'peltier' | 'roof',
    state: 'on' | 'off',
    durationSeconds: number = 0
  ): Promise<{ success: boolean; message: string; interlockTriggered?: boolean }> {
    const isOn = state === 'on';

    // Safety check 1: Pump dry run protection
    const waterLvl = Number(store.getValue('waterLevel') ?? this.simState.waterLevel);
    if (device === 'pump' && isOn && waterLvl < 10) {
      const msg = 'SAFETY INTERLOCK BLOCKED: Water reservoir level is critically low (<10%). Pump activation blocked to prevent motor burnout.';
      this.logDiagnostic('/override', 'WARNING', msg, 0);
      return { success: false, message: msg, interlockTriggered: true };
    }

    // Safety check 2: Heater thermal interlock
    const currentTemp = Number(store.getValue('temperature') ?? this.simState.temp);
    if (device === 'heater' && isOn && currentTemp > 32) {
      const msg = 'SAFETY INTERLOCK BLOCKED: Ambient temperature is already above 32°C. Heater activation blocked.';
      this.logDiagnostic('/override', 'WARNING', msg, 0);
      return { success: false, message: msg, interlockTriggered: true };
    }

    // Safety check 3: Roof rain interlock
    const isRaining = store.getValue('rain') === true || this.simState.rain === true;
    if (device === 'roof' && isOn && isRaining) {
      const msg = 'SAFETY INTERLOCK BLOCKED: Cannot open roof while rain sensor is triggered.';
      this.logDiagnostic('/override', 'WARNING', msg, 0);
      return { success: false, message: msg, interlockTriggered: true };
    }

    if (this.config.mode === 'simulation') {
      this.applyActuatorState(device, isOn);
      this.logDiagnostic('/override', 'SUCCESS', `[SIMULATION] Device ${device} set to ${state.toUpperCase()}`, 10);
      return { success: true, message: `Manual override applied to ${device}: ${state.toUpperCase()} (Simulation)` };
    }

    this.verifyCommandAuthorization();
    const { url, headers } = this.buildRequest('/override', {
      device,
      state,
      duration: durationSeconds
    });

    const res = await this.executeCommand(url, headers, '/override');
    this.applyActuatorState(device, isOn);
    return res;
  }

  // -------------------------------------------------------------
  // ENDPOINT 7: GET /pause
  // -------------------------------------------------------------
  public async pauseAutonomous(durationMinutes: number = 30): Promise<{ success: boolean; message: string }> {
    if (this.config.mode === 'simulation') {
      this.simState.autonomousPaused = durationMinutes > 0;
      this.simState.pauseRemainingSeconds = durationMinutes * 60;
      store.setValue('autonomousPaused', durationMinutes > 0);
      this.logDiagnostic('/pause', 'SUCCESS', `[SIMULATION] Autonomous automation paused for ${durationMinutes}m`, 8);
      return { success: true, message: `Automation paused for ${durationMinutes} minutes (Simulation)` };
    }

    this.verifyCommandAuthorization();
    const { url, headers } = this.buildRequest('/pause', { duration: durationMinutes });
    return this.executeCommand(url, headers, '/pause');
  }

  // -------------------------------------------------------------
  // ENDPOINT 8: GET /setOption
  // -------------------------------------------------------------
  public async setOption(key: string, value: string | number | boolean): Promise<{ success: boolean; message: string }> {
    if (this.config.mode === 'simulation') {
      this.logDiagnostic('/setOption', 'SUCCESS', `[SIMULATION] Option ${key}=${value}`, 5);
      return { success: true, message: `Option ${key} set to ${value} (Simulation)` };
    }

    this.verifyCommandAuthorization();
    const { url, headers } = this.buildRequest('/setOption', { key, value });
    return this.executeCommand(url, headers, '/setOption');
  }

  // -------------------------------------------------------------
  // CAMERA INTEGRATION: GET /status, GET /stream, GET /capture
  // -------------------------------------------------------------
  public getCameraStreamUrl(): string {
    if (this.config.mode === 'simulation' || !this.config.cameraHost) {
      return '';
    }
    let host = this.config.cameraHost.trim().replace(/\/$/, '');
    if (!host.startsWith('http://') && !host.startsWith('https://')) {
      host = `http://${host}`;
    }
    if (this.config.cameraPort && this.config.cameraPort !== 80) {
      const u = new URL(host);
      u.port = this.config.cameraPort.toString();
      return `${u.origin}${this.config.cameraStreamPath || '/stream'}`;
    }
    return `${host}${this.config.cameraStreamPath || '/stream'}`;
  }

  public async getCameraStatus(): Promise<CameraStatusResponse> {
    const startTime = performance.now();

    if (this.config.mode === 'simulation' || !this.config.cameraHost) {
      return {
        connected: false,
        sensorModel: 'ESP32-CAM (Offline / Simulation)',
        resolution: 'SVGA (800x600)',
        frameRate: 0,
        wifiRssi: -65,
        uptimeSeconds: 0,
        streamUrl: '',
        captureUrl: '',
        dataSource: 'SIMULATED',
        latencyMs: 10
      };
    }

    let host = this.config.cameraHost.trim().replace(/\/$/, '');
    if (!host.startsWith('http://') && !host.startsWith('https://')) {
      host = `http://${host}`;
    }
    const baseOrigin = new URL(host).origin;
    const endpoint = this.config.cameraStatusPath || '/status';
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const capturePath = this.config.cameraCapturePath || '/photo';
    const normalizedCapture = capturePath.startsWith('/') ? capturePath : `/${capturePath}`;

    // Standard ESP32-CAM serves /status and /photo on port 80 while /stream runs on port 81
    const candidateOrigins = this.config.cameraPort && this.config.cameraPort !== 80 && this.config.cameraPort !== 81
      ? [`${baseOrigin}:${this.config.cameraPort}`, baseOrigin]
      : [baseOrigin, `${baseOrigin}:${this.config.cameraPort || 81}`];

    try {
      let data: any = null;
      let activeOrigin = baseOrigin;
      let lastErr: any = null;

      for (const originCandidate of candidateOrigins) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        try {
          const res = await fetch(`${originCandidate}${normalizedEndpoint}`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          data = await res.json();
          activeOrigin = originCandidate;
          break;
        } catch (e) {
          clearTimeout(timeoutId);
          lastErr = e;
        }
      }

      if (!data) {
        throw lastErr || new Error('Camera status unreachable');
      }

      const latencyMs = Math.round(performance.now() - startTime);
      return {
        connected: true,
        sensorModel: data.model || 'OV2640',
        resolution: data.resolution || 'SVGA',
        frameRate: data.fps || 15,
        wifiRssi: data.rssi || -60,
        uptimeSeconds: data.uptime || 3600,
        streamUrl: this.getCameraStreamUrl(),
        captureUrl: `${activeOrigin}${normalizedCapture}`,
        dataSource: 'REAL_HARDWARE',
        latencyMs
      };
    } catch (err: any) {
      return {
        connected: false,
        sensorModel: 'ESP32-CAM',
        resolution: 'Unavailable',
        frameRate: 0,
        wifiRssi: 0,
        uptimeSeconds: 0,
        streamUrl: this.getCameraStreamUrl(),
        captureUrl: '',
        dataSource: 'DISCONNECTED',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }
  }

  /**
   * Retrieves the latest uploaded camera frame from the push intake endpoint.
   */
  public async getLatestUploadedCameraImage(): Promise<LatestUploadedImage> {
    try {
      const res = await fetch('/api/camera/latest', { cache: 'no-store' });
      if (!res.ok) {
        return {
          exists: false,
          status: 'OFFLINE',
          dataSource: 'DISCONNECTED',
          uploadEndpoint: '/api/camera/upload'
        };
      }
      const data: LatestUploadedImage = await res.json();
      return data;
    } catch (err: any) {
      return {
        exists: false,
        status: 'OFFLINE',
        dataSource: 'DISCONNECTED',
        uploadEndpoint: '/api/camera/upload'
      };
    }
  }

  /**
   * Retrieves configuration and telemetry for the camera upload endpoint.
   */
  public async getCameraUploadInfo(): Promise<CameraUploadInfo | null> {
    try {
      const res = await fetch('/api/camera/upload-info', { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  /**
   * Allows the frontend or test runner to send a test camera frame to POST /api/camera/upload.
   */
  public async uploadCameraImage(
    imageData: Blob | ArrayBuffer | Uint8Array,
    token?: string
  ): Promise<CameraUploadResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'image/jpeg'
    };
    if (token) {
      headers['X-Camera-Key'] = token;
    }

    const res = await fetch('/api/camera/upload', {
      method: 'POST',
      headers,
      body: imageData
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `Upload failed with HTTP ${res.status}`);
    }
    this.notify();
    return data;
  }

  /**
   * Marks a specific uploaded frame as analyzed with the AI inspection result.
   */
  public async markCameraImageAnalyzed(id: string, analysis: any): Promise<void> {
    try {
      await fetch('/api/camera/mark-analyzed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, analysis })
      });
    } catch (_) {}
  }

  /**
   * Retrieves a snapshot for VisionAgent and UI inspection.
   * Priority:
   * 1. Real uploaded frame from ESP32-CAM via POST /api/camera/upload (REAL_HARDWARE)
   * 2. Direct pull from camera host if configured (REAL_HARDWARE)
   * 3. Simulated botanical canvas ONLY if in simulation mode (SIMULATED)
   * 4. Reports disconnected when hardware is offline and simulation is disabled.
   */
  public async getCameraSnapshot(): Promise<{
    base64Image: string;
    dataSource: DataSource;
    isFresh?: boolean;
    ageSeconds?: number;
    isUploaded?: boolean;
    imageId?: string;
    timestamp?: string;
  }> {
    // 1. Check for real uploaded camera frame from push endpoint (only treat fresh frames as live captures)
    try {
      const latestUpload = await this.getLatestUploadedCameraImage();
      if (latestUpload.exists && latestUpload.base64 && latestUpload.isFresh) {
        return {
          base64Image: latestUpload.base64,
          dataSource: 'REAL_HARDWARE',
          isFresh: true,
          ageSeconds: latestUpload.ageSeconds,
          isUploaded: true,
          imageId: latestUpload.id,
          timestamp: latestUpload.timestamp
        };
      }
    } catch (_) {}

    // 2. If simulation mode is explicitly enabled and no fresh physical frame exists, generate labelled simulation preview
    if (this.config.mode === 'simulation') {
      const simBase64 = this.generateSimulatedPlantSnapshot();
      return { base64Image: simBase64, dataSource: 'SIMULATED', isFresh: false };
    }

    // 3. If cameraHost is configured, try direct HTTP pull (/photo on port 80 first, with /capture fallback)
    if (this.config.cameraHost) {
      let host = this.config.cameraHost.trim().replace(/\/$/, '');
      if (!host.startsWith('http://') && !host.startsWith('https://')) {
        host = `http://${host}`;
      }
      const baseOrigin = new URL(host).origin;
      const configuredPath = this.config.cameraCapturePath || '/photo';
      const normalizedPath = configuredPath.startsWith('/') ? configuredPath : `/${configuredPath}`;
      const candidatePaths = normalizedPath === '/photo'
        ? ['/photo', '/capture']
        : normalizedPath === '/capture'
          ? ['/capture', '/photo']
          : [normalizedPath];
      const candidateOrigins = this.config.cameraPort && this.config.cameraPort !== 80 && this.config.cameraPort !== 81
        ? [`${baseOrigin}:${this.config.cameraPort}`, baseOrigin]
        : [baseOrigin, `${baseOrigin}:${this.config.cameraPort || 81}`];

      try {
        let blob: Blob | null = null;
        let lastErr: any = null;

        outer: for (const originCandidate of candidateOrigins) {
          for (const pathCandidate of candidatePaths) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            try {
              const res = await fetch(`${originCandidate}${pathCandidate}`, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (!res.ok) {
                lastErr = new Error(`Camera returned HTTP ${res.status}`);
                continue;
              }
              blob = await res.blob();
              break outer;
            } catch (e) {
              clearTimeout(timeoutId);
              lastErr = e;
            }
          }
        }

        if (!blob) {
          throw lastErr || new Error('Camera snapshot unreachable');
        }

        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string) || '';
            resolve({ base64Image: base64, dataSource: 'REAL_HARDWARE' });
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (err: any) {
        this.logDiagnostic('/photo', 'WARNING', `Camera pull capture failed: ${err.message}.`, 0);
        throw new Error(`ESP32-CAM pull capture failed (${err.message}) and no uploaded frame is present.`);
      }
    }

    // 4. Physical hardware mode without uploaded image or reachable camera host
    throw new Error('Awaiting ESP32-CAM upload at POST /api/camera/upload. No real camera frame received yet.');
  }

  // -------------------------------------------------------------
  // SIMULATION CONTROLS FOR TESTING
  // -------------------------------------------------------------
  public setSimulationRain(isRaining: boolean) {
    this.simState.rain = isRaining;
    this.simState.rainGauge = isRaining ? 12.5 : 0;
    store.setValue('rain', isRaining);
    store.setValue('rainGaugeLevel', this.simState.rainGauge);
    this.notify();
  }

  public setSimulationTemperature(temp: number) {
    this.simState.temp = temp;
    store.setValue('temperature', temp);
    this.notify();
  }

  public setSimulationWaterLevel(lvl: number) {
    this.simState.waterLevel = lvl;
    store.setValue('waterLevel', lvl);
    this.notify();
  }

  // -------------------------------------------------------------
  // POLLING & BACKGROUND TELEMETRY REFRESH
  // -------------------------------------------------------------
  public startPolling() {
    if (this.pollTimer) return;
    this.poll();
    this.pollTimer = setInterval(() => {
      this.poll();
    }, Math.max(1500, this.config.pollIntervalMs));
  }

  public stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private restartPolling() {
    this.stopPolling();
    this.startPolling();
  }

  private async poll() {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      await this.getStatus();
    } catch (_) {
      // Error is logged in getStatus
    } finally {
      this.isPolling = false;
    }
  }

  // -------------------------------------------------------------
  // INTERNAL HELPERS
  // -------------------------------------------------------------
  private verifyCommandAuthorization() {
    // In direct mode, require controller host; in proxy mode, server-side HARDWARE_CONTROLLER_HOST may be used
    if (this.config.mode === 'direct' && !this.config.controllerHost.trim()) {
      throw new Error('Controller IP/Host is not configured. Cannot dispatch command.');
    }
  }

  private async executeCommand(url: string, headers: Record<string, string>, endpoint: string) {
    const startTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - startTime);

      if (!res.ok) {
        throw new Error(`Command ${endpoint} failed with HTTP ${res.status}: ${res.statusText}`);
      }

      let data: any = {};
      try {
        data = await res.json();
      } catch (_) {
        data = { message: 'Command accepted' };
      }

      this.logDiagnostic(endpoint, 'SUCCESS', data.message || `Command ${endpoint} succeeded`, latencyMs, res.status);
      return { success: true, message: data.message || `Command ${endpoint} executed successfully` };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - startTime);
      this.logDiagnostic(endpoint, 'ERROR', err.message || `Command ${endpoint} failed`, latencyMs);
      throw err;
    }
  }

  private applyActuatorState(device: string, isOn: boolean) {
    switch (device) {
      case 'pump':
        this.simState.pump = isOn;
        store.setValue('pumpActive', isOn);
        break;
      case 'fan':
        this.simState.fan = isOn;
        store.setValue('fanActive', isOn);
        break;
      case 'light':
        this.simState.light = isOn;
        store.setValue('lightActive', isOn);
        break;
      case 'heater':
        this.simState.heater = isOn;
        store.setValue('heaterActive', isOn);
        break;
      case 'peltier':
        this.simState.peltier = isOn;
        store.setValue('peltierActive', isOn);
        break;
      case 'roof':
        this.simState.roof = isOn;
        store.setValue('roofActive', isOn);
        break;
    }
  }

  private calculateInterlocks(rain: boolean, waterLevel: number, temp: number): SafetyInterlocks {
    return {
      rainLocked: rain,
      waterLowLocked: waterLevel < 10,
      thermalLocked: temp > 32,
      overIrrigationLocked: false
    };
  }

  private updateSimulationPhysics() {
    this.simState.uptimeSeconds += 3;

    // Small realistic ambient drift
    const drift = (Math.random() - 0.48) * 0.2;
    this.simState.temp = Math.max(15, Math.min(38, +(this.simState.temp + drift).toFixed(1)));
    
    // Actuator effects in simulation
    if (this.simState.fan) {
      this.simState.temp = Math.max(21, +(this.simState.temp - 0.15).toFixed(1));
      this.simState.humidity = Math.max(45, +(this.simState.humidity - 0.2).toFixed(1));
    }
    if (this.simState.heater) {
      this.simState.temp = Math.min(35, +(this.simState.temp + 0.25).toFixed(1));
    }
    if (this.simState.pump) {
      this.simState.soilMoisture = Math.min(85, +(this.simState.soilMoisture + 1.2).toFixed(1));
      this.simState.waterLevel = Math.max(0, +(this.simState.waterLevel - 0.1).toFixed(1));
    } else {
      this.simState.soilMoisture = Math.max(20, +(this.simState.soilMoisture - 0.05).toFixed(1));
    }

    if (this.simState.light) {
      this.simState.growLight = 850;
    } else {
      this.simState.growLight = 280;
    }
  }

  private normalizeStatusPayload(raw: any, latencyMs: number): Esp32StatusResponse {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid telemetry response: payload is not a JSON object.');
    }

    if (raw.connected === false || raw.dataSource === 'DISCONNECTED') {
      throw new Error(raw.message || 'Controller telemetry reported DISCONNECTED state.');
    }

    const rawTemp = raw.telemetry?.temperature ?? raw.temperature;
    const rawHum = raw.telemetry?.humidity ?? raw.humidity;
    const rawSoil = raw.telemetry?.soilMoisture ?? raw.soilMoisture;

    if (
      rawTemp === undefined || rawTemp === null || !Number.isFinite(Number(rawTemp)) ||
      rawHum === undefined || rawHum === null || !Number.isFinite(Number(rawHum)) ||
      rawSoil === undefined || rawSoil === null || !Number.isFinite(Number(rawSoil))
    ) {
      throw new Error(
        'Malformed telemetry payload: numeric temperature, humidity, and soilMoisture readings are required.'
      );
    }

    const telemetry: EnvironmentalTelemetry = {
      temperature: Number(rawTemp),
      humidity: Number(rawHum),
      soilMoisture: Number(rawSoil),
      sunlight: Number.isFinite(Number(raw.telemetry?.sunlight ?? raw.sunlight))
        ? Number(raw.telemetry?.sunlight ?? raw.sunlight)
        : 0,
      growLight: Number.isFinite(Number(raw.telemetry?.growLight ?? raw.growLight))
        ? Number(raw.telemetry?.growLight ?? raw.growLight)
        : 0,
      rain: Boolean(raw.telemetry?.rain ?? raw.rain ?? false),
      rainGaugeLevel: Number.isFinite(Number(raw.telemetry?.rainGaugeLevel ?? raw.rainGauge))
        ? Number(raw.telemetry?.rainGaugeLevel ?? raw.rainGauge)
        : 0,
      waterLevel: Number.isFinite(Number(raw.telemetry?.waterLevel ?? raw.waterLevel))
        ? Number(raw.telemetry?.waterLevel ?? raw.waterLevel)
        : 0,
      batteryVoltage: Number.isFinite(Number(raw.telemetry?.batteryVoltage ?? raw.battery))
        ? Number(raw.telemetry?.batteryVoltage ?? raw.battery)
        : 0
    };

    const actuators: ActuatorStates = {
      pumpActive: Boolean(raw.actuators?.pumpActive ?? raw.pumpActive ?? false),
      fanActive: Boolean(raw.actuators?.fanActive ?? raw.fanActive ?? false),
      lightActive: Boolean(raw.actuators?.lightActive ?? raw.lightActive ?? false),
      heaterActive: Boolean(raw.actuators?.heaterActive ?? raw.heaterActive ?? false),
      peltierActive: Boolean(raw.actuators?.peltierActive ?? raw.peltierActive ?? false),
      peltierFan1Active: Boolean(raw.actuators?.peltierFan1Active ?? raw.peltierFan1Active ?? false),
      peltierFan2Active: Boolean(raw.actuators?.peltierFan2Active ?? raw.peltierFan2Active ?? false),
      roofActive: Boolean(raw.actuators?.roofActive ?? raw.roofActive ?? false)
    };

    const interlocks: SafetyInterlocks = raw.interlocks || this.calculateInterlocks(
      telemetry.rain,
      telemetry.waterLevel,
      telemetry.temperature
    );

    const hasValidUpstreamTimestamp =
      typeof raw.timestamp === 'string' && !Number.isNaN(new Date(raw.timestamp).getTime());
    const resolvedTimestamp = hasValidUpstreamTimestamp
      ? new Date(raw.timestamp).toISOString()
      : new Date().toISOString();
    const ageMs = Math.max(0, Date.now() - new Date(resolvedTimestamp).getTime());

    if (ageMs > 180000) {
      throw new Error(`Telemetry reading expired (${Math.round(ageMs / 1000)}s old); marked DISCONNECTED.`);
    }

    let resolvedDataSource: DataSource = 'REAL_HARDWARE';
    if (raw.dataSource === 'SIMULATED') {
      resolvedDataSource = 'SIMULATED';
    } else if (raw.dataSource === 'STALE' || ageMs > 25000) {
      resolvedDataSource = 'STALE';
    } else if (raw.dataSource === 'CACHED' || ageMs > 15000) {
      resolvedDataSource = 'CACHED';
    }

    return {
      connected: resolvedDataSource === 'REAL_HARDWARE' || resolvedDataSource === 'CACHED',
      uptimeSeconds: Number(raw.uptimeSeconds ?? raw.uptime ?? 0),
      firmwareVersion: String(raw.firmwareVersion ?? raw.firmware ?? 'EDENS-ESP32-v2.x'),
      wifiRssi: Number(raw.wifiRssi ?? raw.rssi ?? -60),
      freeHeapBytes: Number(raw.freeHeapBytes ?? raw.heap ?? 160000),
      telemetry,
      actuators,
      interlocks,
      activeCropId: String(raw.activeCropId ?? raw.crop ?? 'tomato'),
      activeCropName: String(raw.activeCropName ?? 'Active Crop'),
      autonomousPaused: Boolean(raw.autonomousPaused ?? false),
      pauseRemainingSeconds: Number(raw.pauseRemainingSeconds ?? 0),
      timestamp: resolvedTimestamp,
      dataSource: resolvedDataSource,
      latencyMs
    };
  }

  private syncToStore(status: Esp32StatusResponse) {
    // Update TinyBase store keys
    store.setValue('temperature', status.telemetry.temperature);
    store.setValue('humidity', status.telemetry.humidity);
    store.setValue('soilMoisture', status.telemetry.soilMoisture);
    store.setValue('sunlight', status.telemetry.sunlight);
    store.setValue('growLight', status.telemetry.growLight);
    store.setValue('rain', status.telemetry.rain);
    store.setValue('rainGaugeLevel', status.telemetry.rainGaugeLevel);
    store.setValue('waterLevel', status.telemetry.waterLevel);
    store.setValue('batteryVoltage', status.telemetry.batteryVoltage);

    store.setValue('pumpActive', status.actuators.pumpActive);
    store.setValue('fanActive', status.actuators.fanActive);
    store.setValue('lightActive', status.actuators.lightActive);
    store.setValue('heaterActive', status.actuators.heaterActive);
    store.setValue('peltierActive', status.actuators.peltierActive);
    store.setValue('peltierFan1Active', status.actuators.peltierFan1Active);
    store.setValue('peltierFan2Active', status.actuators.peltierFan2Active);
    store.setValue('roofActive', status.actuators.roofActive);

    store.setValue('hardware_dataSource', status.dataSource);
    store.setValue('hardware_lastSeen', status.timestamp);
    store.setValue('hardware_wifiRssi', status.wifiRssi);
    store.setValue('hardware_firmware', status.firmwareVersion);
    store.setValue('hardware_rainLocked', status.interlocks.rainLocked);
    store.setValue('hardware_waterLowLocked', status.interlocks.waterLowLocked);
    store.setValue('hardware_thermalLocked', status.interlocks.thermalLocked);
  }

  private generateSimulatedPlantSnapshot(): string {
    // 1. In browser environment, render real botanical simulation canvas to a genuine JPEG Data URL
    if (typeof document !== 'undefined') {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Dark botanical ambient background with radial vignette
          const bgGrad = ctx.createRadialGradient(320, 240, 60, 320, 240, 380);
          bgGrad.addColorStop(0, '#14291c');
          bgGrad.addColorStop(1, '#060c08');
          ctx.fillStyle = bgGrad;
          ctx.fillRect(0, 0, 640, 480);

          // Greenhouse framework struts
          ctx.strokeStyle = 'rgba(25, 60, 38, 0.4)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(320, 0); ctx.lineTo(320, 480);
          ctx.moveTo(0, 240); ctx.lineTo(640, 240);
          ctx.moveTo(0, 120); ctx.lineTo(640, 120);
          ctx.moveTo(0, 360); ctx.lineTo(640, 360);
          ctx.stroke();

          // Main tomato stem
          ctx.save();
          ctx.translate(320, 430);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(-20, -150, 0, -290);
          ctx.lineWidth = 12;
          ctx.strokeStyle = '#1b5e32';
          ctx.lineCap = 'round';
          ctx.stroke();

          // Side stem branches
          ctx.lineWidth = 6;
          ctx.strokeStyle = '#227b42';
          ctx.beginPath();
          ctx.moveTo(-5, -110);
          ctx.quadraticCurveTo(-70, -170, -110, -200);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(0, -180);
          ctx.quadraticCurveTo(60, -230, 95, -260);
          ctx.stroke();

          // Helper to draw realistic leaves with veins
          const drawLeaf = (x: number, y: number, angle: number, scaleX: number, scaleY: number) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.scale(scaleX, scaleY);

            const leafGrad = ctx.createLinearGradient(-50, -25, 50, 25);
            leafGrad.addColorStop(0, '#10b981');
            leafGrad.addColorStop(0.5, '#059669');
            leafGrad.addColorStop(1, '#047857');
            ctx.fillStyle = leafGrad;

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(-35, -45, -70, -20, -90, 0);
            ctx.bezierCurveTo(-70, 25, -35, 35, 0, 0);
            ctx.fill();

            // Leaf primary & secondary veins
            ctx.strokeStyle = 'rgba(167, 243, 208, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-85, 0);
            ctx.moveTo(-30, 0); ctx.lineTo(-45, -12);
            ctx.moveTo(-30, 0); ctx.lineTo(-45, 12);
            ctx.moveTo(-55, 0); ctx.lineTo(-70, -8);
            ctx.moveTo(-55, 0); ctx.lineTo(-70, 8);
            ctx.stroke();

            ctx.restore();
          };

          drawLeaf(-5, -80, -0.3, 1.4, 1.2);
          drawLeaf(5, -140, 2.7, 1.5, 1.3);
          drawLeaf(-15, -190, -0.6, 1.3, 1.2);
          drawLeaf(0, -230, 2.4, 1.2, 1.1);
          drawLeaf(0, -280, -0.1, 1.0, 1.0);
          drawLeaf(-105, -195, -1.2, 0.9, 0.9);
          drawLeaf(90, -255, 1.8, 0.9, 0.9);

          // Tomato Fruits
          // Ripe red tomato
          const radRed = ctx.createRadialGradient(25, -145, 4, 30, -140, 24);
          radRed.addColorStop(0, '#f87171');
          radRed.addColorStop(0.65, '#dc2626');
          radRed.addColorStop(1, '#7f1d1d');
          ctx.fillStyle = radRed;
          ctx.beginPath();
          ctx.arc(30, -140, 22, 0, Math.PI * 2);
          ctx.fill();

          // Orange turning tomato
          const radOrange = ctx.createRadialGradient(-35, -95, 3, -30, -90, 18);
          radOrange.addColorStop(0, '#fde047');
          radOrange.addColorStop(0.65, '#ea580c');
          radOrange.addColorStop(1, '#9a3412');
          ctx.fillStyle = radOrange;
          ctx.beginPath();
          ctx.arc(-30, -90, 18, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();

          // HUD Telemetry Header
          ctx.fillStyle = 'rgba(0, 15, 8, 0.75)';
          ctx.fillRect(16, 16, 608, 54);
          ctx.strokeStyle = '#059669';
          ctx.lineWidth = 1;
          ctx.strokeRect(16, 16, 608, 54);

          ctx.font = 'bold 13px monospace';
          ctx.fillStyle = '#10b981';
          ctx.fillText('🌿 EDENS AI · BOTANICAL CANOPY SIMULATION (640x480 JPEG)', 30, 38);

          ctx.font = '11px monospace';
          ctx.fillStyle = '#a7f3d0';
          const temp = store.getValue('temperature') ?? 24.5;
          const hum = store.getValue('humidity') ?? 62;
          const soil = store.getValue('soilMoisture') ?? 50;
          ctx.fillText(`CROP: TOMATO | TEMP: ${temp}°C | HUMIDITY: ${hum}% | SOIL: ${soil}% | VIGOR: 94%`, 30, 56);

          return canvas.toDataURL('image/jpeg', 0.88);
        }
      } catch (err) {
        console.warn('Canvas simulation snapshot rendering fallback:', err);
      }
    }

    // 2. Fallback valid 1x1 JPEG Data URI (SOI 0xFF 0xD8 ... EOI 0xFF 0xD9)
    return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  }
}

export const hardwareService = new HardwareService();

// Auto-start polling on module load
if (typeof window !== 'undefined') {
  hardwareService.startPolling();
}
