import { useEffect, useState } from 'react';
import { useAuth, type ExplicitDeviceConnectionState, type GreenhouseSummary } from './auth';
import { hardwareService, DEFAULT_CROPS } from './hardwareService';
import { useStoreTable, useStoreValue } from './store';
import type { DataSource } from './hardwareTypes';

export type MetricProvenance =
  | 'REAL_HARDWARE'
  | 'CACHED'
  | 'STALE'
  | 'SIMULATED'
  | 'UNAVAILABLE';

export type RangeComparison = 'within' | 'low' | 'high' | 'unavailable';

export interface EnvironmentalMetricSummary {
  key: 'temperature' | 'humidity' | 'soilMoisture';
  label: string;
  value: number | null;
  formattedValue: string;
  unit: string;
  targetMin: number;
  targetMax: number;
  status: RangeComparison;
  statusLabel: string;
  guidance: string;
  provenance: MetricProvenance;
  provenanceLabel: string;
}

export interface FarmerAlertItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  whatHappened: string;
  nextStep: string;
  actionLabel?: string;
  actionTo?: string;
  timestamp?: string;
}

export interface UnifiedGreenhouseView {
  hasEnrolledGreenhouse: boolean;
  activeGreenhouse: GreenhouseSummary | null;
  greenhouses: GreenhouseSummary[];
  greenhouseName: string;
  locationLabel: string;
  cropName: string;
  isSimulationMode: boolean;
  overallConnectionState:
    | 'CONNECTED'
    | 'PARTIAL'
    | 'STALE'
    | 'WAITING_CHECKIN'
    | 'SETUP_REQUIRED'
    | 'SIMULATION'
    | 'OFFLINE';
  connectionHeadline: string;
  connectionSummary: string;
  nextActionLabel: string;
  nextActionTo: string;
  provenance: MetricProvenance;
  provenanceLabel: string;
  lastUpdatedAt: string | null;
  lastUpdatedAgeSeconds: number | null;
  metrics: {
    temperature: EnvironmentalMetricSummary;
    humidity: EnvironmentalMetricSummary;
    soilMoisture: EnvironmentalMetricSummary;
  };
  secondaryReadings: {
    waterLevel: number | null;
    sunlight: number | null;
    growLight: number | null;
    batteryVoltage: number | null;
    rain: boolean | null;
  };
  alerts: FarmerAlertItem[];
}

export function formatRelativeAge(ageSeconds: number | null, isoTimestamp?: string | null): string {
  let sec = ageSeconds;
  if ((sec === null || sec === undefined || !Number.isFinite(sec)) && isoTimestamp) {
    const parsed = new Date(isoTimestamp).getTime();
    if (Number.isFinite(parsed)) {
      sec = Math.max(0, Math.round((Date.now() - parsed) / 1000));
    }
  }
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) {
    return 'No update received yet';
  }
  if (sec < 5) return 'Just now';
  if (sec < 60) return `${sec}s ago`;
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatExplicitDeviceState(
  state?: ExplicitDeviceConnectionState | string | null
): {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  explanation: string;
} {
  switch (state) {
    case 'ONLINE':
    case 'CONNECTED':
      return {
        label: 'Connected',
        tone: 'success',
        explanation: 'Device is sending verified updates on schedule.'
      };
    case 'STALE':
      return {
        label: 'Stale Signal',
        tone: 'warning',
        explanation: 'Last reading is older than expected. Check power and Wi-Fi signal.'
      };
    case 'WAITING_FOR_FIRST_CONNECTION':
    case 'AWAITING_FIRST_CHECKIN':
      return {
        label: 'Waiting for First Check-In',
        tone: 'neutral',
        explanation: 'Device key is issued. Power on the board so it sends its first reading.'
      };
    case 'CONFIGURATION_REQUIRED':
    case 'PENDING_SETUP':
      return {
        label: 'Setup Needed',
        tone: 'neutral',
        explanation: 'Device credentials have not been configured yet.'
      };
    case 'AUTHENTICATION_ERROR':
    case 'REVOKED':
      return {
        label: 'Key Rejected',
        tone: 'danger',
        explanation: 'Device key did not match or was revoked. Issue a fresh key in Settings.'
      };
    case 'CONNECTION_ERROR':
      return {
        label: 'Upload Error',
        tone: 'danger',
        explanation: 'Device sent an unreadable reading. Check sensor wiring.'
      };
    case 'OFFLINE':
    case 'DISCONNECTED':
    default:
      return {
        label: 'Offline',
        tone: 'danger',
        explanation: 'No recent signal received from this device.'
      };
  }
}

function provenanceToLabel(p: MetricProvenance): string {
  switch (p) {
    case 'REAL_HARDWARE':
      return 'Live Hardware';
    case 'CACHED':
      return 'Recent Hardware';
    case 'STALE':
      return 'Outdated Reading';
    case 'SIMULATED':
      return 'Practice Mode';
    case 'UNAVAILABLE':
    default:
      return 'Unavailable';
  }
}

function buildMetricSummary(opts: {
  key: 'temperature' | 'humidity' | 'soilMoisture';
  label: string;
  value: number | null;
  decimals: number;
  unit: string;
  targetMin: number;
  targetMax: number;
  provenance: MetricProvenance;
  lowHint: string;
  highHint: string;
  withinHint: string;
}): EnvironmentalMetricSummary {
  const { key, label, value, decimals, unit, targetMin, targetMax, provenance, lowHint, highHint, withinHint } = opts;
  const provLabel = provenanceToLabel(provenance);

  if (value === null || value === undefined || !Number.isFinite(value) || provenance === 'UNAVAILABLE') {
    return {
      key,
      label,
      value: null,
      formattedValue: 'Unavailable',
      unit,
      targetMin,
      targetMax,
      status: 'unavailable',
      statusLabel: 'No live reading',
      guidance: 'Waiting for verified sensor data from your greenhouse controller.',
      provenance: 'UNAVAILABLE',
      provenanceLabel: 'Unavailable'
    };
  }

  const formattedValue = `${value.toFixed(decimals)}${unit}`;

  if (value < targetMin) {
    return {
      key,
      label,
      value,
      formattedValue,
      unit,
      targetMin,
      targetMax,
      status: 'low',
      statusLabel: `Below target (${targetMin}–${targetMax}${unit})`,
      guidance: lowHint,
      provenance,
      provenanceLabel: provLabel
    };
  }

  if (value > targetMax) {
    return {
      key,
      label,
      value,
      formattedValue,
      unit,
      targetMin,
      targetMax,
      status: 'high',
      statusLabel: `Above target (${targetMin}–${targetMax}${unit})`,
      guidance: highHint,
      provenance,
      provenanceLabel: provLabel
    };
  }

  return {
    key,
    label,
    value,
    formattedValue,
    unit,
    targetMin,
    targetMax,
    status: 'within',
    statusLabel: `Within target (${targetMin}–${targetMax}${unit})`,
    guidance: withinHint,
    provenance,
    provenanceLabel: provLabel
  };
}

export function useFarmerGreenhouseState(): UnifiedGreenhouseView {
  const { greenhouses, activeGreenhouse } = useAuth();
  const [hwConfig, setHwConfig] = useState(() => hardwareService.getConfig());
  const [localDataSource, setLocalDataSource] = useState<DataSource>(() => hardwareService.getDataSource());
  const [localAgeSec, setLocalAgeSec] = useState<number>(() => hardwareService.getSensorFreshnessSeconds());

  useEffect(() => {
    const unsub = hardwareService.subscribe(() => {
      setHwConfig(hardwareService.getConfig());
      setLocalDataSource(hardwareService.getDataSource());
      setLocalAgeSec(hardwareService.getSensorFreshnessSeconds());
    });
    const timer = window.setInterval(() => {
      setHwConfig(hardwareService.getConfig());
      setLocalDataSource(hardwareService.getDataSource());
      setLocalAgeSec(hardwareService.getSensorFreshnessSeconds());
    }, 2000);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, []);

  // Store values (used for targets & explicit practice simulation mode)
  const storeCrop = String(useStoreValue('cropType', 'tomato'));
  const storeFarmName = String(useStoreValue('farmName', '') || '');
  const storeLocation = String(useStoreValue('location', '') || '');

  const matchedCrop =
    DEFAULT_CROPS.find(
      (c) =>
        c.id.toLowerCase() === (activeGreenhouse?.cropType || storeCrop).toLowerCase() ||
        c.name.toLowerCase().includes((activeGreenhouse?.cropType || storeCrop).toLowerCase())
    ) || DEFAULT_CROPS[0];

  const tempMin = Number(useStoreValue('tempMinThreshold', matchedCrop.tempMin)) || matchedCrop.tempMin;
  const tempMax = Number(useStoreValue('tempMaxThreshold', matchedCrop.tempMax)) || matchedCrop.tempMax;
  const humMin = Number(useStoreValue('humMinThreshold', matchedCrop.humMin)) || matchedCrop.humMin;
  const humMax = Number(useStoreValue('humMaxThreshold', matchedCrop.humMax)) || matchedCrop.humMax;
  const soilMin = Number(useStoreValue('soilMinThreshold', matchedCrop.soilMin)) || matchedCrop.soilMin;
  const soilMax = Number(useStoreValue('soilMaxThreshold', matchedCrop.soilMax)) || matchedCrop.soilMax;

  const simTemp = useStoreValue<number | null>('temperature', null);
  const simHum = useStoreValue<number | null>('humidity', null);
  const simSoil = useStoreValue<number | null>('soilMoisture', null);
  const simWater = useStoreValue<number | null>('waterLevel', null);
  const simSunlight = useStoreValue<number | null>('sunlight', null);
  const simGrowLight = useStoreValue<number | null>('growLight', null);
  const simBattery = useStoreValue<number | null>('batteryVoltage', null);
  const simRain = useStoreValue<boolean | null>('rain', null);

  const pendingActions = useStoreTable('pendingActions') || {};

  // Determine whether we have live/cached/stale cloud greenhouse data vs local LAN hardware vs explicit Practice Mode
  const hasEnrolled = Boolean(activeGreenhouse);
  const cloudCtrl = activeGreenhouse?.controller;
  const cloudReadings = cloudCtrl?.readings || null;
  const cloudHasRealTelemetry = Boolean(
    cloudCtrl &&
      cloudCtrl.lastTelemetryAt &&
      cloudReadings &&
      cloudCtrl.dataSource !== 'DISCONNECTED'
  );

  // Only show simulated numbers when user is explicitly in simulation mode AND does not have an enrolled cloud greenhouse
  // (or if they have no enrolled greenhouse at all and simulation mode is active).
  // Never mask an enrolled physical greenhouse's offline/pending state with simulated numbers unless simulation mode is explicitly chosen while no cloud telemetry exists AND no enrolled greenhouse is selected.
  const useCloudSource = hasEnrolled && (cloudHasRealTelemetry || hwConfig.mode !== 'simulation');
  const useLocalDirectSource = !useCloudSource && hwConfig.mode !== 'simulation' && localDataSource !== 'DISCONNECTED';
  const isSimulationMode = !useCloudSource && !useLocalDirectSource && hwConfig.mode === 'simulation';

  let provenance: MetricProvenance = 'UNAVAILABLE';
  let rawTemp: number | null = null;
  let rawHum: number | null = null;
  let rawSoil: number | null = null;
  let rawWater: number | null = null;
  let rawSun: number | null = null;
  let rawGrow: number | null = null;
  let rawBattery: number | null = null;
  let rawRain: boolean | null = null;
  let lastUpdatedAt: string | null = null;
  let lastUpdatedAgeSeconds: number | null = null;

  if (useCloudSource && activeGreenhouse) {
    lastUpdatedAt = activeGreenhouse.controller.lastTelemetryAt;
    lastUpdatedAgeSeconds = activeGreenhouse.controller.ageSeconds;
    if (cloudHasRealTelemetry && cloudReadings) {
      provenance =
        activeGreenhouse.controller.dataSource === 'REAL_HARDWARE'
          ? 'REAL_HARDWARE'
          : activeGreenhouse.controller.dataSource === 'CACHED'
            ? 'CACHED'
            : activeGreenhouse.controller.dataSource === 'STALE'
              ? 'STALE'
              : 'UNAVAILABLE';
      rawTemp = cloudReadings.temperature;
      rawHum = cloudReadings.humidity;
      rawSoil = cloudReadings.soilMoisture;
      rawWater = cloudReadings.waterLevel;
      rawSun = cloudReadings.sunlight;
      rawGrow = cloudReadings.growLight;
      rawBattery = cloudReadings.batteryVoltage;
      rawRain = cloudReadings.rain;
    } else {
      provenance = 'UNAVAILABLE';
    }
  } else if (useLocalDirectSource) {
    provenance =
      localDataSource === 'REAL_HARDWARE'
        ? 'REAL_HARDWARE'
        : localDataSource === 'CACHED'
          ? 'CACHED'
          : localDataSource === 'STALE'
            ? 'STALE'
            : 'UNAVAILABLE';
    lastUpdatedAgeSeconds = Number.isFinite(localAgeSec) ? localAgeSec : null;
    lastUpdatedAt =
      lastUpdatedAgeSeconds !== null ? new Date(Date.now() - lastUpdatedAgeSeconds * 1000).toISOString() : null;
    rawTemp = typeof simTemp === 'number' ? simTemp : null;
    rawHum = typeof simHum === 'number' ? simHum : null;
    rawSoil = typeof simSoil === 'number' ? simSoil : null;
    rawWater = typeof simWater === 'number' ? simWater : null;
    rawSun = typeof simSunlight === 'number' ? simSunlight : null;
    rawGrow = typeof simGrowLight === 'number' ? simGrowLight : null;
    rawBattery = typeof simBattery === 'number' ? simBattery : null;
    rawRain = typeof simRain === 'boolean' ? simRain : null;
  } else if (isSimulationMode) {
    provenance = 'SIMULATED';
    lastUpdatedAt = new Date().toISOString();
    lastUpdatedAgeSeconds = 0;
    rawTemp = typeof simTemp === 'number' ? Number(simTemp) : 24.5;
    rawHum = typeof simHum === 'number' ? Number(simHum) : 62;
    rawSoil = typeof simSoil === 'number' ? Number(simSoil) : 48;
    rawWater = typeof simWater === 'number' ? Number(simWater) : 76;
    rawSun = typeof simSunlight === 'number' ? Number(simSunlight) : 650;
    rawGrow = typeof simGrowLight === 'number' ? Number(simGrowLight) : 380;
    rawBattery = typeof simBattery === 'number' ? Number(simBattery) : 12.3;
    rawRain = typeof simRain === 'boolean' ? simRain : false;
  }

  const cropDisplayName = activeGreenhouse?.cropType || matchedCrop.name.split(' (')[0] || 'Tomato';
  const greenhouseName =
    activeGreenhouse?.name || storeFarmName || (isSimulationMode ? 'Practice Greenhouse' : 'My Greenhouse');
  const locationLabel =
    activeGreenhouse?.locationLabel || storeLocation || (isSimulationMode ? 'Practice Environment' : 'Location not set');

  const temperatureMetric = buildMetricSummary({
    key: 'temperature',
    label: 'Temperature',
    value: rawTemp,
    decimals: 1,
    unit: '°C',
    targetMin: tempMin,
    targetMax: tempMax,
    provenance,
    lowHint: `Cooler than ${tempMin}°C target for ${cropDisplayName}. Close roof vents or check heating.`,
    highHint: `Warmer than ${tempMax}°C target for ${cropDisplayName}. Increase airflow or open the roof vent if dry.`,
    withinHint: `Comfortable temperature for ${cropDisplayName}.`
  });

  const humidityMetric = buildMetricSummary({
    key: 'humidity',
    label: 'Air Humidity',
    value: rawHum,
    decimals: 0,
    unit: '%',
    targetMin: humMin,
    targetMax: humMax,
    provenance,
    lowHint: `Air is drier than ${humMin}% target. Check watering schedule and reduce excess airflow.`,
    highHint: `Humidity above ${humMax}% increases leaf fungus risk. Run circulation fans to move air.`,
    withinHint: `Healthy air moisture for ${cropDisplayName}.`
  });

  const soilMetric = buildMetricSummary({
    key: 'soilMoisture',
    label: 'Soil Moisture',
    value: rawSoil,
    decimals: 0,
    unit: '%',
    targetMin: soilMin,
    targetMax: soilMax,
    provenance,
    lowHint: `Soil is drier than ${soilMin}% target. Check water reservoir and irrigate root zone.`,
    highHint: `Soil is wetter than ${soilMax}% target. Pause watering so roots can breathe.`,
    withinHint: `Root zone moisture is balanced for ${cropDisplayName}.`
  });

  // Overall connection summary & primary next action
  let overallConnectionState: UnifiedGreenhouseView['overallConnectionState'] = 'OFFLINE';
  let connectionHeadline = 'Greenhouse Offline';
  let connectionSummary = 'No live sensor signal is currently reaching EDENS AI.';
  let nextActionLabel = 'Set Up My Greenhouse';
  let nextActionTo = '/greenhouses/setup';

  if (activeGreenhouse) {
    if (activeGreenhouse.overallStatus === 'ONLINE') {
      overallConnectionState = 'CONNECTED';
      connectionHeadline = 'Greenhouse Connected';
      connectionSummary = 'Controller and camera are online and reporting verified greenhouse data.';
      nextActionLabel = 'Open My Greenhouse';
      nextActionTo = `/greenhouses/${activeGreenhouse.id}`;
    } else if (activeGreenhouse.overallStatus === 'PARTIAL') {
      overallConnectionState = 'PARTIAL';
      const ctrlOnline =
        activeGreenhouse.controller.explicitState === 'ONLINE' ||
        activeGreenhouse.controller.connectionStatus === 'CONNECTED';
      connectionHeadline = ctrlOnline
        ? 'Sensors Online · Camera Waiting'
        : 'Camera Online · Sensors Waiting';
      connectionSummary = ctrlOnline
        ? 'Environmental readings are live, but the greenhouse camera has not uploaded a recent snapshot yet.'
        : 'Camera snapshots are arriving, but the main sensor controller has not checked in recently.';
      nextActionLabel = 'Check Device Status';
      nextActionTo = `/greenhouses/${activeGreenhouse.id}`;
    } else if (activeGreenhouse.overallStatus === 'SETUP_INCOMPLETE') {
      overallConnectionState = 'SETUP_REQUIRED';
      connectionHeadline = 'Finish Connecting Hardware';
      connectionSummary = `${activeGreenhouse.name} is registered, but device keys or Wi-Fi setup still need to be completed.`;
      nextActionLabel = 'Continue Setup Guide';
      nextActionTo = `/greenhouses/${activeGreenhouse.id}/setup`;
    } else if (
      activeGreenhouse.controller.explicitState === 'WAITING_FOR_FIRST_CONNECTION' ||
      activeGreenhouse.camera.explicitState === 'WAITING_FOR_FIRST_CONNECTION'
    ) {
      overallConnectionState = 'WAITING_CHECKIN';
      connectionHeadline = 'Waiting for First Hardware Check-In';
      connectionSummary =
        'Device credentials have been issued. Power on your ESP32 controller and camera on 2.4 GHz Wi-Fi to begin monitoring.';
      nextActionLabel = 'Run Connection Check';
      nextActionTo = `/greenhouses/${activeGreenhouse.id}/setup`;
    } else if (activeGreenhouse.overallStatus === 'STALE') {
      overallConnectionState = 'STALE';
      connectionHeadline = 'Sensor Signal Delayed';
      connectionSummary =
        'Your greenhouse reported earlier, but recent updates are delayed. Shown values may not reflect current conditions.';
      nextActionLabel = 'Check Connection';
      nextActionTo = `/greenhouses/${activeGreenhouse.id}`;
    } else if (isSimulationMode) {
      overallConnectionState = 'SIMULATION';
      connectionHeadline = 'Practice Mode Active';
      connectionSummary = `${activeGreenhouse.name} has no live hardware check-in yet. Showing clearly labeled practice readings.`;
      nextActionLabel = 'Connect Real Hardware';
      nextActionTo = `/greenhouses/${activeGreenhouse.id}/setup`;
    } else {
      overallConnectionState = 'OFFLINE';
      connectionHeadline = 'Greenhouse Hardware Offline';
      connectionSummary = `No active signal from ${activeGreenhouse.name}. Check 5V power supply and greenhouse 2.4 GHz Wi-Fi.`;
      nextActionLabel = 'Troubleshoot Connection';
      nextActionTo = `/greenhouses/${activeGreenhouse.id}`;
    }
  } else if (useLocalDirectSource) {
    overallConnectionState = provenance === 'REAL_HARDWARE' ? 'CONNECTED' : 'STALE';
    connectionHeadline =
      provenance === 'REAL_HARDWARE' ? 'Local Controller Connected' : 'Local Controller Signal Stale';
    connectionSummary = 'Receiving readings from your local network ESP32 controller.';
    nextActionLabel = 'Enroll Cloud Greenhouse';
    nextActionTo = '/greenhouses/setup';
  } else if (isSimulationMode) {
    overallConnectionState = 'SIMULATION';
    connectionHeadline = 'Practice Mode (No Hardware Connected)';
    connectionSummary =
      'You are exploring EDENS AI with simulated readings. Enroll your greenhouse kit whenever you are ready to monitor real crops.';
    nextActionLabel = 'Set Up Real Greenhouse';
    nextActionTo = '/greenhouses/setup';
  }

  // Build concise, actionable farmer alerts
  const alerts: FarmerAlertItem[] = [];

  if (activeGreenhouse?.controller.lastError) {
    alerts.push({
      id: 'ctrl-err',
      severity: 'critical',
      title: 'Controller Connection Issue',
      whatHappened: activeGreenhouse.controller.lastError.message,
      nextStep: 'Open Hardware Connections in Settings to verify your controller key and sensor wiring.',
      actionLabel: 'Check Hardware Settings',
      actionTo: '/settings?tab=hardware',
      timestamp: activeGreenhouse.controller.lastError.timestamp
    });
  }

  if (activeGreenhouse?.camera.lastError) {
    alerts.push({
      id: 'cam-err',
      severity: 'warning',
      title: 'Camera Upload Issue',
      whatHappened: activeGreenhouse.camera.lastError.message,
      nextStep: 'Verify your ESP32-CAM power adapter (5V 2A) and camera upload key.',
      actionLabel: 'Open Plant Vision',
      actionTo: '/vision',
      timestamp: activeGreenhouse.camera.lastError.timestamp
    });
  }

  if (provenance !== 'UNAVAILABLE') {
    if (temperatureMetric.status === 'high') {
      alerts.push({
        id: 'temp-high',
        severity: rawTemp !== null && rawTemp >= tempMax + 4 ? 'critical' : 'warning',
        title: `High Greenhouse Temperature (${temperatureMetric.formattedValue})`,
        whatHappened: `Air temperature is above your ${tempMax}°C upper target for ${cropDisplayName}.`,
        nextStep: 'Turn on circulation fans or open the roof vent (if it is not raining) to release trapped heat.',
        actionLabel: 'Ask EDENS AI',
        actionTo: `/assistant?q=${encodeURIComponent(`My ${cropDisplayName} greenhouse temperature is ${temperatureMetric.formattedValue}. What should I do right now?`)}`
      });
    } else if (temperatureMetric.status === 'low') {
      alerts.push({
        id: 'temp-low',
        severity: 'warning',
        title: `Low Greenhouse Temperature (${temperatureMetric.formattedValue})`,
        whatHappened: `Air temperature dropped below your ${tempMin}°C minimum target for ${cropDisplayName}.`,
        nextStep: 'Close roof vents to retain warmth and check heater operation.',
        actionLabel: 'Open My Greenhouse',
        actionTo: activeGreenhouse ? `/greenhouses/${activeGreenhouse.id}` : '/greenhouses'
      });
    }

    if (soilMetric.status === 'low') {
      alerts.push({
        id: 'soil-low',
        severity: rawSoil !== null && rawSoil < Math.max(15, soilMin - 10) ? 'critical' : 'warning',
        title: `Dry Soil Moisture (${soilMetric.formattedValue})`,
        whatHappened: `Root-zone moisture is below your ${soilMin}% target for ${cropDisplayName}.`,
        nextStep: 'Check that your water tank has enough water, then run a short watering cycle.',
        actionLabel: 'Open Controls',
        actionTo: activeGreenhouse ? `/greenhouses/${activeGreenhouse.id}` : '/greenhouses'
      });
    } else if (soilMetric.status === 'high') {
      alerts.push({
        id: 'soil-high',
        severity: 'info',
        title: `High Soil Moisture (${soilMetric.formattedValue})`,
        whatHappened: `Soil moisture is above your ${soilMax}% target.`,
        nextStep: 'Hold off on watering until the topsoil drains to prevent root rot.'
      });
    }

    if (humidityMetric.status === 'high') {
      alerts.push({
        id: 'hum-high',
        severity: 'warning',
        title: `High Air Humidity (${humidityMetric.formattedValue})`,
        whatHappened: `Humidity is above ${humMax}%, which can encourage leaf mold and blight.`,
        nextStep: 'Run ventilation fans and inspect lower leaves in Plant Vision.',
        actionLabel: 'Inspect Leaves',
        actionTo: '/vision'
      });
    }

    if (rawWater !== null && rawWater <= 15) {
      alerts.push({
        id: 'water-low',
        severity: 'critical',
        title: `Low Water Tank (${rawWater.toFixed(0)}%)`,
        whatHappened: 'Water reservoir is critically low. The controller locks the water pump below safe levels to prevent dry-run damage.',
        nextStep: 'Refill your greenhouse water reservoir before starting irrigation.'
      });
    }
  }

  // Include pending simulated/local recommendations cleanly without jargon
  Object.entries(pendingActions).forEach(([id, act]: [string, any]) => {
    alerts.push({
      id: `pending-${id}`,
      severity: act.isCritical ? 'critical' : 'info',
      title: `Suggested Action: ${act.action}`,
      whatHappened: act.reason || 'EDENS AI noticed an environmental change.',
      nextStep: 'Review and approve or dismiss this recommendation on your Home dashboard.',
      timestamp: act.timestamp
    });
  });

  return {
    hasEnrolledGreenhouse: hasEnrolled,
    activeGreenhouse,
    greenhouses,
    greenhouseName,
    locationLabel,
    cropName: cropDisplayName,
    isSimulationMode,
    overallConnectionState,
    connectionHeadline,
    connectionSummary,
    nextActionLabel,
    nextActionTo,
    provenance,
    provenanceLabel: provenanceToLabel(provenance),
    lastUpdatedAt,
    lastUpdatedAgeSeconds,
    metrics: {
      temperature: temperatureMetric,
      humidity: humidityMetric,
      soilMoisture: soilMetric
    },
    secondaryReadings: {
      waterLevel: rawWater,
      sunlight: rawSun,
      growLight: rawGrow,
      batteryVoltage: rawBattery,
      rain: rawRain
    },
    alerts
  };
}
