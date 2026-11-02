import { apiFetch, parseApiJsonResponse } from '../lib/api';
import { hardwareService } from '../lib/hardwareService';
import { store } from '../lib/store';

export interface UnifiedAgentTelemetryContext {
  dataSource: 'REAL_HARDWARE' | 'CACHED' | 'STALE' | 'SIMULATED' | 'DISCONNECTED';
  greenhouseId?: string;
  cropType: string;
  temperature: number | null;
  humidity: number | null;
  soilMoisture: number | null;
  waterLevel: number | null;
  light: number | null;
  rain: boolean | null;
  batteryVoltage: number | null;
  roofActive: boolean;
  latestCamera: {
    exists: boolean;
    isFresh: boolean;
    ageSeconds: number | null;
    capturedAt: string | null;
  } | null;
}

let cachedCloudDetail: { ghId: string; fetchedAtMs: number; payload: any } | null = null;

function getSessionActiveGreenhouseId(): string | null {
  try {
    return sessionStorage.getItem('edens_active_greenhouse_id') || null;
  } catch {
    return null;
  }
}

async function fetchActiveCloudGreenhouseDetail(ghId: string): Promise<any | null> {
  const now = Date.now();
  if (cachedCloudDetail && cachedCloudDetail.ghId === ghId && now - cachedCloudDetail.fetchedAtMs < 4000) {
    return cachedCloudDetail.payload;
  }
  try {
    const res = await apiFetch(`/api/greenhouses/${ghId}`);
    const parsed = await parseApiJsonResponse<any>(res);
    if (!parsed.ok || !parsed.data?.greenhouse) {
      return null;
    }
    cachedCloudDetail = {
      ghId,
      fetchedAtMs: now,
      payload: parsed.data
    };
    return parsed.data;
  } catch {
    return null;
  }
}

function finiteNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

/**
 * Resolves unified, strictly honest telemetry & camera freshness for all 5 Agronomy Agents.
 * Supports:
 * 1. Enrolled cloud greenhouses receiving ESP32 / ESP32-CAM uploads
 * 2. Local LAN / proxy controller hardware
 * 3. Explicitly enabled Practice Simulation Mode
 */
export async function resolveAgentTelemetryContext(): Promise<UnifiedAgentTelemetryContext> {
  const hwConfig = hardwareService.getConfig();
  const localDataSource = hardwareService.getDataSource();
  const activeGhId = getSessionActiveGreenhouseId();
  const storeCrop = String(store.getValue('cropType') || 'Tomato');

  let cloudDetail: any | null = null;
  if (activeGhId) {
    cloudDetail = await fetchActiveCloudGreenhouseDetail(activeGhId);
  }

  const cloudTel = cloudDetail?.latestTelemetry || null;
  const cloudReadings = cloudTel?.readings || null;
  const cloudCam = cloudDetail?.latestCamera || null;
  const cloudCrop = String(cloudDetail?.greenhouse?.cropType || storeCrop);

  const cloudHasTelemetry = Boolean(
    cloudTel &&
      cloudTel.receivedAt &&
      cloudReadings &&
      cloudTel.dataSource !== 'DISCONNECTED'
  );

  const useCloudSource = Boolean(cloudDetail) && (cloudHasTelemetry || hwConfig.mode !== 'simulation');
  const useLocalDirectSource =
    !useCloudSource && hwConfig.mode !== 'simulation' && localDataSource !== 'DISCONNECTED';
  const isSimulationMode = !useCloudSource && !useLocalDirectSource && hwConfig.mode === 'simulation';

  const latestCameraSummary = cloudCam
    ? {
        exists: Boolean(cloudCam.exists),
        isFresh: Boolean(cloudCam.isFresh),
        ageSeconds: typeof cloudCam.ageSeconds === 'number' ? cloudCam.ageSeconds : null,
        capturedAt: cloudCam.capturedAt || cloudCam.timestamp || null
      }
    : null;

  if (useCloudSource) {
    if (!cloudHasTelemetry || !cloudReadings) {
      return {
        dataSource: 'DISCONNECTED',
        greenhouseId: activeGhId || undefined,
        cropType: cloudCrop,
        temperature: null,
        humidity: null,
        soilMoisture: null,
        waterLevel: null,
        light: null,
        rain: null,
        batteryVoltage: null,
        roofActive: false,
        latestCamera: latestCameraSummary
      };
    }

    const mappedSource =
      cloudTel.dataSource === 'REAL_HARDWARE'
        ? 'REAL_HARDWARE'
        : cloudTel.dataSource === 'CACHED'
          ? 'CACHED'
          : cloudTel.dataSource === 'STALE'
            ? 'STALE'
            : 'DISCONNECTED';

    return {
      dataSource: mappedSource,
      greenhouseId: activeGhId || undefined,
      cropType: cloudCrop,
      temperature: finiteNumberOrNull(cloudReadings.temperature),
      humidity: finiteNumberOrNull(cloudReadings.humidity),
      soilMoisture: finiteNumberOrNull(cloudReadings.soilMoisture),
      waterLevel: finiteNumberOrNull(cloudReadings.waterLevel),
      light: finiteNumberOrNull(cloudReadings.sunlight ?? cloudReadings.growLight),
      rain: typeof cloudReadings.rain === 'boolean' ? cloudReadings.rain : null,
      batteryVoltage: finiteNumberOrNull(cloudReadings.batteryVoltage),
      roofActive: Boolean(store.getValue('roofActive')),
      latestCamera: latestCameraSummary
    };
  }

  if (useLocalDirectSource || isSimulationMode) {
    const resolvedSource = isSimulationMode ? 'SIMULATED' : localDataSource;
    const tempAvail = isSimulationMode || store.getValue('hardware_temperatureAvailable') !== false;
    const humAvail = isSimulationMode || store.getValue('hardware_humidityAvailable') !== false;
    const soilAvail = isSimulationMode || store.getValue('hardware_soilMoistureAvailable') !== false;
    const waterAvail = isSimulationMode || store.getValue('hardware_waterLevelAvailable') !== false;
    const battAvail = isSimulationMode || store.getValue('hardware_batteryAvailable') !== false;

    return {
      dataSource: resolvedSource,
      greenhouseId: isSimulationMode ? undefined : activeGhId || undefined,
      cropType: storeCrop,
      temperature: tempAvail ? finiteNumberOrNull(store.getValue('temperature')) : null,
      humidity: humAvail ? finiteNumberOrNull(store.getValue('humidity')) : null,
      soilMoisture: soilAvail ? finiteNumberOrNull(store.getValue('soilMoisture')) : null,
      waterLevel: waterAvail ? finiteNumberOrNull(store.getValue('waterLevel')) : null,
      light: finiteNumberOrNull(store.getValue('sunlight') ?? store.getValue('growLight')),
      rain: store.getValue('rain') === true ? true : store.getValue('rain') === false ? false : null,
      batteryVoltage: battAvail ? finiteNumberOrNull(store.getValue('batteryVoltage')) : null,
      roofActive: Boolean(store.getValue('roofActive')),
      latestCamera: latestCameraSummary
    };
  }

  return {
    dataSource: 'DISCONNECTED',
    greenhouseId: activeGhId || undefined,
    cropType: storeCrop,
    temperature: null,
    humidity: null,
    soilMoisture: null,
    waterLevel: null,
    light: null,
    rain: null,
    batteryVoltage: null,
    roofActive: false,
    latestCamera: latestCameraSummary
  };
}
