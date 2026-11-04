import {
  type DataRetentionPolicyConfig,
  type TwoTierSafetyEnvelope,
  createDefaultTwoTierSafetyEnvelope,
  getDefaultDataRetentionConfig,
  resolveEffectiveSafetyEnvelope
} from './safetyDefaults.ts';
import type { SqliteDriver } from './sqliteDriver.ts';
import {
  type ValidatedControllerTelemetry,
  generateSecureId,
  redactSecretsFromText
} from './telemetryContract.ts';

// ============================================================================
// DOMAIN TYPES & REPOSITORY INTERFACES
// ============================================================================

export type AuthorizationMode = 'mode_1_individual' | 'mode_2_limited' | 'mode_3_advanced';

export interface GreenhouseZoneRecord {
  id: string;
  greenhouseId: string;
  name: string;
  zoneType: string;
  cropProfileId: string | null;
  activeCropType: string | null;
  activeVariety: string | null;
  growthStage: string;
  plantingDate: string | null;
  cultivationMethod: string;
  areaSqm: number | null;
  safetyOverrides: Record<string, unknown>;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceCapabilityRecord {
  id: string;
  deviceId: string;
  greenhouseId: string;
  capabilityKind: 'sensor' | 'actuator' | 'camera' | 'power';
  capabilityType?: 'sensor' | 'actuator' | 'camera' | 'power';
  channelKey: string;
  capabilityKey?: string;
  displayLabel: string;
  unit: string | null;
  minSafeValue: number | null;
  maxSafeValue: number | null;
  maxDurationSeconds: number | null;
  cooldownSeconds: number | null;
  calibration: Record<string, unknown>;
  isEnabled: boolean;
  updatedAt: string;
}

export interface DeviceFirmwareHistoryRecord {
  id: string;
  deviceId: string;
  greenhouseId: string;
  previousVersion: string | null;
  reportedVersion: string;
  targetVersion: string | null;
  releaseChannel: string;
  sha256Digest: string | null;
  updateStatus: string;
  recordedAt: string;
}

export interface EquipmentEventRecord {
  id: string;
  greenhouseId: string;
  zoneId: string | null;
  deviceId: string | null;
  actuatorKey: string;
  eventKind: string;
  previousState: string | null;
  newState: string;
  triggerSource: string;
  commandId: string | null;
  durationSeconds: number | null;
  safetyContext: Record<string, unknown>;
  recordedAt: string;
}

export interface TelemetryPointRecord {
  id: string;
  greenhouseId: string;
  zoneId: string | null;
  deviceId: string;
  recordedAt: string;
  receivedAtMs: number;
  temperature: number | null;
  humidity: number | null;
  soilMoisture: number | null;
  sunlight: number | null;
  growLight: number | null;
  waterLevel: number | null;
  batteryVoltage: number | null;
  rain: boolean | null;
  rainGaugeLevel: number | null;
  vpdKpa: number | null;
  qualityFlag: string;
}

export interface HourlyRollupRecord {
  id: string;
  greenhouseId: string;
  zoneId: string | null;
  deviceId: string;
  bucketStartIso: string;
  bucketStartMs: number;
  sampleCount: number;
  tempMin: number | null;
  tempMax: number | null;
  tempAvg: number | null;
  humidityMin: number | null;
  humidityMax: number | null;
  humidityAvg: number | null;
  soilMin: number | null;
  soilMax: number | null;
  soilAvg: number | null;
  waterMin: number | null;
  waterAvg: number | null;
  sunlightAvg: number | null;
  batteryMin: number | null;
  batteryAvg: number | null;
  vpdAvg: number | null;
  rainSamples: number;
  pumpActiveSamples: number;
  updatedAt: string;
}

export interface DailyRollupRecord {
  id: string;
  greenhouseId: string;
  zoneId: string | null;
  deviceId: string;
  dayDate: string;
  bucketStartMs: number;
  sampleCount: number;
  tempMin: number | null;
  tempMax: number | null;
  tempAvg: number | null;
  humidityMin: number | null;
  humidityMax: number | null;
  humidityAvg: number | null;
  soilMin: number | null;
  soilMax: number | null;
  soilAvg: number | null;
  waterMin: number | null;
  waterAvg: number | null;
  sunlightAvg: number | null;
  gddBase10: number;
  rainSamples: number;
  pumpActiveSamples: number;
  updatedAt: string;
}

export interface CropKnowledgeProfileRecord {
  id: string;
  cropCode: string;
  commonName: string;
  localNames: string[];
  scientificName: string;
  variety: string;
  cultivationMethod: string;
  standardDaysToHarvest: number;
  summary: string;
  riskProfile: Record<string, unknown>;
  evidenceReferences: Record<string, unknown>[];
  confidenceLevel: string;
  validationStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface CropGrowthStageStandardRecord {
  id: string;
  cropProfileId: string;
  stageName: string;
  stageOrder: number;
  dayStart: number;
  dayEnd: number;
  tempMinC: number;
  tempMaxC: number;
  tempOptimalC: number | null;
  humidityMinPct: number;
  humidityMaxPct: number;
  soilMoistureMinPct: number;
  soilMoistureMaxPct: number;
  vpdMinKpa: number | null;
  vpdMaxKpa: number | null;
  lightDliMin: number | null;
  lightDliMax: number | null;
  phMin: number | null;
  phMax: number | null;
  ecMinMs: number | null;
  ecMaxMs: number | null;
  irrigationNotes: string | null;
  citationRefs: string[];
  createdAt: string;
}

export interface CropStandardVersionRecord {
  id: string;
  greenhouseId: string;
  zoneId: string | null;
  cropProfileId: string | null;
  versionNumber: number;
  status: 'active' | 'proposed' | 'superseded' | 'rolled_back';
  thresholds: Record<string, unknown>;
  evidence: Record<string, unknown>;
  references: Record<string, unknown>[];
  proposedBy: string;
  approvedByUserId: string | null;
  rollbackOfVersionId: string | null;
  createdAt: string;
  activatedAt: string | null;
}

export interface FarmerAuthorizationPolicyRecord {
  id: string;
  greenhouseId: string;
  zoneId: string | null;
  mode: AuthorizationMode;
  cropType: string;
  equipmentKey: string;
  permittedAction: string;
  thresholds: Record<string, unknown>;
  maxDurationSeconds: number;
  cooldownSeconds: number;
  maxDailyCumulativeSeconds: number;
  operatingConditions: Record<string, unknown>;
  expiresAt: string | null;
  reviewRequiredAt: string | null;
  status: 'active' | 'paused' | 'revoked' | 'expired';
  createdByUserId: string;
  revokedByUserId: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HardwareCommandRecord {
  id: string;
  greenhouseId: string;
  zoneId: string | null;
  deviceId: string;
  recommendationId: string | null;
  policyId: string | null;
  authorizedByUserId: string | null;
  authorizationMode: AuthorizationMode | 'manual_farmer';
  commandType: string;
  targetEquipment: string;
  parameters: Record<string, unknown>;
  safetyTierSnapshot: TwoTierSafetyEnvelope;
  idempotencyKey: string;
  sequenceNo: number;
  status: 'queued' | 'dispatched' | 'acked' | 'rejected_safety' | 'failed' | 'expired' | 'cancelled_estop';
  expiresAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface HarvestCycleRecord {
  id: string;
  greenhouseId: string;
  zoneId: string | null;
  cropProfileId: string | null;
  cropType: string;
  variety: string | null;
  cultivationMethod: string;
  plantingDate: string;
  expectedHarvestDate: string | null;
  actualHarvestDate: string | null;
  currentGrowthStage: string;
  plantCount: number | null;
  status: 'active' | 'harvested' | 'terminated';
  yieldKg: number | null;
  marketableYieldKg: number | null;
  qualityGrade: string | null;
  waterUsedLiters: number | null;
  energyUsedKwh: number | null;
  diseaseIncidentsCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MlModelVersionRecord {
  id: string;
  modelFamily: string;
  modelName: string;
  versionTag: string;
  framework: string;
  artifactPath: string | null;
  artifactSha256: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  metrics: Record<string, unknown>;
  calibration: Record<string, unknown>;
  fallbackRuleId: string;
  deploymentStage: 'registered' | 'validated' | 'shadow' | 'active' | 'deprecated' | 'rolled_back';
  createdAt: string;
  activatedAt: string | null;
}

export interface RlPolicyRecord {
  id: string;
  policyName: string;
  versionTag: string;
  algorithm: string;
  stateSpec: Record<string, unknown>;
  actionSpec: Record<string, unknown>;
  rewardWeights: Record<string, unknown>;
  safetyBounds: Record<string, unknown>;
  artifactPath: string | null;
  artifactSha256: string | null;
  benchmarkVsBaseline: Record<string, unknown>;
  approvalStatus: 'simulated_only' | 'pending_review' | 'approved_shadow' | 'approved_bounded' | 'revoked';
  approvedByUserId: string | null;
  rollbackPolicyId: string | null;
  createdAt: string;
  updatedAt: string;
}

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toNullableNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Magnus-Tetens saturation vapor pressure calculation -> Vapor Pressure Deficit (kPa).
 * Returns null if temperature or relative humidity is missing.
 */
export function calculateVpdKpa(tempC: number | null, humidityPct: number | null): number | null {
  if (tempC === null || humidityPct === null) return null;
  if (!Number.isFinite(tempC) || !Number.isFinite(humidityPct)) return null;
  const clampedRh = Math.max(0, Math.min(100, humidityPct));
  const es = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const ea = es * (clampedRh / 100);
  const vpd = Math.max(0, es - ea);
  return Math.round(vpd * 1000) / 1000;
}

function runningAvg(prevAvg: number | null, prevCount: number, nextVal: number | null): number | null {
  if (nextVal === null) return prevAvg;
  if (prevAvg === null || prevCount <= 0) return nextVal;
  return (prevAvg * prevCount + nextVal) / (prevCount + 1);
}

function minVal(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function maxVal(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

// ============================================================================
// 1. MULTI-ZONE & HARDWARE CAPABILITY / FIRMWARE REPOSITORY
// ============================================================================

export class ZoneAndHardwareRepository {
  private readonly driver: SqliteDriver;

  constructor(driver: SqliteDriver) {
    this.driver = driver;
  }

  public createZone(params: {
    greenhouseId: string;
    name: string;
    zoneType?: string;
    cropProfileId?: string | null;
    activeCropType?: string | null;
    activeVariety?: string | null;
    growthStage?: string;
    plantingDate?: string | null;
    cultivationMethod?: string;
    areaSqm?: number | null;
    safetyOverrides?: Record<string, unknown>;
    isPrimary?: boolean;
  }): GreenhouseZoneRecord {
    const id = generateSecureId('zone', 6);
    const nowIso = new Date().toISOString();
    const name = String(params.name || 'Canopy Zone').trim().slice(0, 80);
    const zoneType = String(params.zoneType || 'canopy_bay').trim();
    const growthStage = String(params.growthStage || 'vegetative').trim();
    const cultivationMethod = String(params.cultivationMethod || 'soil_bed').trim();
    const safetyOverrides = params.safetyOverrides || {};

    this.driver.run(
      `INSERT INTO greenhouse_zones (
         id, greenhouse_id, name, zone_type, crop_profile_id, active_crop_type, active_variety,
         growth_stage, planting_date, cultivation_method, area_sqm, safety_overrides_json,
         is_primary, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.greenhouseId,
        name,
        zoneType,
        params.cropProfileId || null,
        params.activeCropType || null,
        params.activeVariety || null,
        growthStage,
        params.plantingDate || null,
        cultivationMethod,
        params.areaSqm ?? null,
        JSON.stringify(safetyOverrides),
        params.isPrimary ? 1 : 0,
        nowIso,
        nowIso
      ]
    );

    return this.getZoneById(params.greenhouseId, id)!;
  }

  public getZoneById(greenhouseId: string, zoneId: string): GreenhouseZoneRecord | null {
    const r = this.driver.queryOne<any>(
      'SELECT * FROM greenhouse_zones WHERE greenhouse_id = ? AND id = ?',
      [greenhouseId, zoneId]
    );
    return r ? this.mapZone(r) : null;
  }

  public listZonesForGreenhouse(greenhouseId: string): GreenhouseZoneRecord[] {
    return this.driver
      .queryAll<any>(
        'SELECT * FROM greenhouse_zones WHERE greenhouse_id = ? ORDER BY is_primary DESC, created_at ASC',
        [greenhouseId]
      )
      .map((r) => this.mapZone(r));
  }

  public updateZone(
    greenhouseId: string,
    zoneId: string,
    patch: {
      name?: string;
      zoneType?: string;
      cropProfileId?: string | null;
      activeCropType?: string | null;
      activeVariety?: string | null;
      growthStage?: string;
      plantingDate?: string | null;
      cultivationMethod?: string;
      areaSqm?: number | null;
      safetyOverrides?: Record<string, unknown>;
      isPrimary?: boolean;
    }
  ): GreenhouseZoneRecord | null {
    const existing = this.getZoneById(greenhouseId, zoneId);
    if (!existing) return null;

    const nowIso = new Date().toISOString();
    const nextName =
      patch.name !== undefined ? String(patch.name).trim().slice(0, 80) || existing.name : existing.name;
    const nextType =
      patch.zoneType !== undefined
        ? String(patch.zoneType).trim().slice(0, 40) || existing.zoneType
        : existing.zoneType;
    const nextCropProfileId =
      patch.cropProfileId !== undefined ? patch.cropProfileId || null : existing.cropProfileId;
    const nextCropType =
      patch.activeCropType !== undefined
        ? patch.activeCropType
          ? String(patch.activeCropType).trim().slice(0, 60)
          : null
        : existing.activeCropType;
    const nextVariety =
      patch.activeVariety !== undefined
        ? patch.activeVariety
          ? String(patch.activeVariety).trim().slice(0, 60)
          : null
        : existing.activeVariety;
    const nextStage =
      patch.growthStage !== undefined
        ? String(patch.growthStage).trim().slice(0, 40) || existing.growthStage
        : existing.growthStage;
    const nextPlantingDate =
      patch.plantingDate !== undefined ? patch.plantingDate || null : existing.plantingDate;
    const nextMethod =
      patch.cultivationMethod !== undefined
        ? String(patch.cultivationMethod).trim().slice(0, 40) || existing.cultivationMethod
        : existing.cultivationMethod;
    const nextArea = patch.areaSqm !== undefined ? toNullableNum(patch.areaSqm) : existing.areaSqm;
    const nextOverrides =
      patch.safetyOverrides !== undefined ? patch.safetyOverrides : existing.safetyOverrides;
    const nextPrimary = patch.isPrimary !== undefined ? Boolean(patch.isPrimary) : existing.isPrimary;

    this.driver.runInTransaction(() => {
      if (nextPrimary && !existing.isPrimary) {
        this.driver.run(
          'UPDATE greenhouse_zones SET is_primary = 0, updated_at = ? WHERE greenhouse_id = ?',
          [nowIso, greenhouseId],
          false
        );
      }
      this.driver.run(
        `UPDATE greenhouse_zones
         SET name = ?, zone_type = ?, crop_profile_id = ?, active_crop_type = ?, active_variety = ?,
             growth_stage = ?, planting_date = ?, cultivation_method = ?, area_sqm = ?,
             safety_overrides_json = ?, is_primary = ?, updated_at = ?
         WHERE greenhouse_id = ? AND id = ?`,
        [
          nextName,
          nextType,
          nextCropProfileId,
          nextCropType,
          nextVariety,
          nextStage,
          nextPlantingDate,
          nextMethod,
          nextArea,
          JSON.stringify(nextOverrides || {}),
          nextPrimary ? 1 : 0,
          nowIso,
          greenhouseId,
          zoneId
        ],
        false
      );
    });

    return this.getZoneById(greenhouseId, zoneId);
  }

  private mapZone(r: any): GreenhouseZoneRecord {
    return {
      id: String(r.id),
      greenhouseId: String(r.greenhouse_id),
      name: String(r.name),
      zoneType: String(r.zone_type),
      cropProfileId: r.crop_profile_id ? String(r.crop_profile_id) : null,
      activeCropType: r.active_crop_type ? String(r.active_crop_type) : null,
      activeVariety: r.active_variety ? String(r.active_variety) : null,
      growthStage: String(r.growth_stage),
      plantingDate: r.planting_date ? String(r.planting_date) : null,
      cultivationMethod: String(r.cultivation_method),
      areaSqm: toNullableNum(r.area_sqm),
      safetyOverrides: safeParseJson(r.safety_overrides_json, {}),
      isPrimary: Number(r.is_primary) === 1,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  public upsertDeviceCapability(params: {
    deviceId: string;
    greenhouseId: string;
    capabilityKind: 'sensor' | 'actuator' | 'camera' | 'power';
    channelKey: string;
    displayLabel: string;
    unit?: string | null;
    minSafeValue?: number | null;
    maxSafeValue?: number | null;
    maxDurationSeconds?: number | null;
    cooldownSeconds?: number | null;
    calibration?: Record<string, unknown>;
    isEnabled?: boolean;
  }): DeviceCapabilityRecord {
    const nowIso = new Date().toISOString();
    const existing = this.driver.queryOne<{ id: string }>(
      'SELECT id FROM device_capabilities WHERE device_id = ? AND capability_kind = ? AND channel_key = ?',
      [params.deviceId, params.capabilityKind, params.channelKey]
    );

    const id = existing ? String(existing.id) : generateSecureId('cap', 6);
    if (existing) {
      this.driver.run(
        `UPDATE device_capabilities
         SET display_label = ?, unit = ?, min_safe_value = ?, max_safe_value = ?,
             max_duration_seconds = ?, cooldown_seconds = ?, calibration_json = ?,
             is_enabled = ?, updated_at = ?
         WHERE id = ?`,
        [
          params.displayLabel,
          params.unit ?? null,
          params.minSafeValue ?? null,
          params.maxSafeValue ?? null,
          params.maxDurationSeconds ?? null,
          params.cooldownSeconds ?? null,
          JSON.stringify(params.calibration || {}),
          params.isEnabled === false ? 0 : 1,
          nowIso,
          id
        ]
      );
    } else {
      this.driver.run(
        `INSERT INTO device_capabilities (
           id, device_id, greenhouse_id, capability_kind, channel_key, display_label,
           unit, min_safe_value, max_safe_value, max_duration_seconds, cooldown_seconds,
           calibration_json, is_enabled, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          params.deviceId,
          params.greenhouseId,
          params.capabilityKind,
          params.channelKey,
          params.displayLabel,
          params.unit ?? null,
          params.minSafeValue ?? null,
          params.maxSafeValue ?? null,
          params.maxDurationSeconds ?? null,
          params.cooldownSeconds ?? null,
          JSON.stringify(params.calibration || {}),
          params.isEnabled === false ? 0 : 1,
          nowIso
        ]
      );
    }

    const row = this.driver.queryOne<any>('SELECT * FROM device_capabilities WHERE id = ?', [id])!;
    return {
      id: String(row.id),
      deviceId: String(row.device_id),
      greenhouseId: String(row.greenhouse_id),
      capabilityKind: String(row.capability_kind) as DeviceCapabilityRecord['capabilityKind'],
      channelKey: String(row.channel_key),
      displayLabel: String(row.display_label),
      unit: row.unit ? String(row.unit) : null,
      minSafeValue: toNullableNum(row.min_safe_value),
      maxSafeValue: toNullableNum(row.max_safe_value),
      maxDurationSeconds: toNullableNum(row.max_duration_seconds),
      cooldownSeconds: toNullableNum(row.cooldown_seconds),
      calibration: safeParseJson(row.calibration_json, {}),
      isEnabled: Number(row.is_enabled) === 1,
      updatedAt: String(row.updated_at)
    };
  }

  /**
   * Normalizes and persists hardware capability manifests reported during ESP32 bootstrap
   * or device registration (accepts array of capability items OR grouped `{ sensors, actuators, camera, power }` object).
   */
  public syncReportedCapabilities(
    greenhouseId: string,
    deviceId: string,
    rawCapabilities: unknown
  ): DeviceCapabilityRecord[] {
    if (!rawCapabilities || typeof rawCapabilities !== 'object') {
      return this.listDeviceCapabilities(greenhouseId, deviceId);
    }

    const validKinds = new Set(['sensor', 'actuator', 'camera', 'power']);
    const normalizeEntry = (
      entry: any,
      defaultKind: 'sensor' | 'actuator' | 'camera' | 'power'
    ) => {
      if (typeof entry === 'string' && entry.trim()) {
        const key = entry.trim().slice(0, 48);
        return {
          capabilityKind: defaultKind,
          channelKey: key,
          displayLabel: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        };
      }
      if (entry && typeof entry === 'object') {
        const kindRaw = String(
          entry.capabilityKind || entry.capabilityType || entry.kind || entry.type || defaultKind
        ).toLowerCase();
        const capabilityKind = (validKinds.has(kindRaw) ? kindRaw : defaultKind) as
          | 'sensor'
          | 'actuator'
          | 'camera'
          | 'power';
        const channelKey = String(
          entry.channelKey || entry.capabilityKey || entry.key || entry.channel || ''
        )
          .trim()
          .slice(0, 48);
        if (!channelKey) return null;
        const safetyLimits =
          entry.safetyLimits && typeof entry.safetyLimits === 'object' ? entry.safetyLimits : null;
        const baseCalibration =
          entry.calibration && typeof entry.calibration === 'object'
            ? (entry.calibration as Record<string, unknown>)
            : {};
        return {
          capabilityKind,
          channelKey,
          displayLabel:
            String(entry.displayLabel || entry.label || channelKey)
              .trim()
              .slice(0, 80) || channelKey,
          unit: entry.unit ? String(entry.unit).slice(0, 20) : null,
          minSafeValue: toNullableNum(entry.minSafeValue ?? safetyLimits?.minWaterPct),
          maxSafeValue: toNullableNum(entry.maxSafeValue ?? safetyLimits?.maxTempC),
          maxDurationSeconds: toNullableNum(
            entry.maxDurationSeconds ?? safetyLimits?.maxContinuousSec
          ),
          cooldownSeconds: toNullableNum(entry.cooldownSeconds),
          calibration: safetyLimits ? { ...baseCalibration, safetyLimits } : baseCalibration,
          isEnabled: entry.isEnabled === false ? false : true
        };
      }
      return null;
    };

    const itemsToUpsert: Array<NonNullable<ReturnType<typeof normalizeEntry>>> = [];
    if (Array.isArray(rawCapabilities)) {
      for (const item of rawCapabilities.slice(0, 32)) {
        const norm = normalizeEntry(item, 'sensor');
        if (norm) itemsToUpsert.push(norm);
      }
    } else {
      const obj = rawCapabilities as Record<string, unknown>;
      const groupMap: Array<[string, 'sensor' | 'actuator' | 'camera' | 'power']> = [
        ['sensors', 'sensor'],
        ['actuators', 'actuator'],
        ['camera', 'camera'],
        ['cameras', 'camera'],
        ['power', 'power']
      ];
      for (const [groupKey, kind] of groupMap) {
        const list = obj[groupKey];
        if (Array.isArray(list)) {
          for (const entry of list.slice(0, 24)) {
            const norm = normalizeEntry(entry, kind);
            if (norm) itemsToUpsert.push(norm);
          }
        }
      }
    }

    for (const item of itemsToUpsert) {
      this.upsertDeviceCapability({
        deviceId,
        greenhouseId,
        ...item
      });
    }

    return this.listDeviceCapabilities(greenhouseId, deviceId);
  }

  public listDeviceCapabilities(greenhouseId: string, deviceId?: string): DeviceCapabilityRecord[] {
    const rows = deviceId
      ? this.driver.queryAll<any>(
          'SELECT * FROM device_capabilities WHERE greenhouse_id = ? AND device_id = ? ORDER BY capability_kind, channel_key',
          [greenhouseId, deviceId]
        )
      : this.driver.queryAll<any>(
          'SELECT * FROM device_capabilities WHERE greenhouse_id = ? ORDER BY device_id, capability_kind, channel_key',
          [greenhouseId]
        );
    return rows.map((row) => {
      const capabilityKind = String(row.capability_kind) as DeviceCapabilityRecord['capabilityKind'];
      const channelKey = String(row.channel_key);
      return {
        id: String(row.id),
        deviceId: String(row.device_id),
        greenhouseId: String(row.greenhouse_id),
        capabilityKind,
        capabilityType: capabilityKind,
        channelKey,
        capabilityKey: channelKey,
        displayLabel: String(row.display_label),
        unit: row.unit ? String(row.unit) : null,
        minSafeValue: toNullableNum(row.min_safe_value),
        maxSafeValue: toNullableNum(row.max_safe_value),
        maxDurationSeconds: toNullableNum(row.max_duration_seconds),
        cooldownSeconds: toNullableNum(row.cooldown_seconds),
        calibration: safeParseJson(row.calibration_json, {}),
        isEnabled: Number(row.is_enabled) === 1,
        updatedAt: String(row.updated_at)
      };
    });
  }

  public recordFirmwareVersionReport(params: {
    deviceId: string;
    greenhouseId: string;
    previousVersion?: string | null;
    reportedVersion: string;
    targetVersion?: string | null;
    releaseChannel?: string;
    sha256Digest?: string | null;
    updateStatus?: string;
  }): DeviceFirmwareHistoryRecord {
    const id = generateSecureId('fwh', 6);
    const nowIso = new Date().toISOString();
    this.driver.run(
      `INSERT INTO device_firmware_history (
         id, device_id, greenhouse_id, previous_version, reported_version, target_version,
         release_channel, sha256_digest, update_status, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.deviceId,
        params.greenhouseId,
        params.previousVersion || null,
        params.reportedVersion,
        params.targetVersion || null,
        params.releaseChannel || 'stable',
        params.sha256Digest || null,
        params.updateStatus || 'reported',
        nowIso
      ]
    );
    return {
      id,
      deviceId: params.deviceId,
      greenhouseId: params.greenhouseId,
      previousVersion: params.previousVersion || null,
      reportedVersion: params.reportedVersion,
      targetVersion: params.targetVersion || null,
      releaseChannel: params.releaseChannel || 'stable',
      sha256Digest: params.sha256Digest || null,
      updateStatus: params.updateStatus || 'reported',
      recordedAt: nowIso
    };
  }

  public listFirmwareHistory(
    greenhouseId: string,
    deviceId?: string,
    limit: number = 20
  ): DeviceFirmwareHistoryRecord[] {
    const capped = Math.max(1, Math.min(100, limit));
    const rows = deviceId
      ? this.driver.queryAll<any>(
          `SELECT * FROM device_firmware_history
           WHERE greenhouse_id = ? AND device_id = ?
           ORDER BY recorded_at DESC LIMIT ?`,
          [greenhouseId, deviceId, capped]
        )
      : this.driver.queryAll<any>(
          `SELECT * FROM device_firmware_history
           WHERE greenhouse_id = ?
           ORDER BY recorded_at DESC LIMIT ?`,
          [greenhouseId, capped]
        );
    return rows.map((r) => ({
      id: String(r.id),
      deviceId: String(r.device_id),
      greenhouseId: String(r.greenhouse_id),
      previousVersion: r.previous_version ? String(r.previous_version) : null,
      reportedVersion: String(r.reported_version),
      targetVersion: r.target_version ? String(r.target_version) : null,
      releaseChannel: String(r.release_channel || 'stable'),
      sha256Digest: r.sha256_digest ? String(r.sha256_digest) : null,
      updateStatus: String(r.update_status || 'reported'),
      recordedAt: String(r.recorded_at)
    }));
  }

  public setDeviceOtaTarget(params: {
    greenhouseId: string;
    deviceId: string;
    targetFirmwareVersion: string | null;
    otaStatus?: 'idle' | 'staged' | 'downloading' | 'verifying' | 'applied' | 'rollback_required';
    releaseChannel?: string;
    sha256Digest?: string | null;
  }): boolean {
    const dev = this.driver.queryOne<any>(
      'SELECT id, firmware_version FROM devices WHERE id = ? AND greenhouse_id = ?',
      [params.deviceId, params.greenhouseId]
    );
    if (!dev) return false;

    const nowIso = new Date().toISOString();
    const nextOtaStatus =
      params.otaStatus || (params.targetFirmwareVersion ? 'staged' : 'idle');

    this.driver.runInTransaction(() => {
      this.driver.run(
        `UPDATE devices
         SET target_firmware_version = ?, ota_status = ?, updated_at = ?
         WHERE id = ? AND greenhouse_id = ?`,
        [params.targetFirmwareVersion, nextOtaStatus, nowIso, params.deviceId, params.greenhouseId],
        false
      );

      if (params.targetFirmwareVersion) {
        this.recordFirmwareVersionReport({
          deviceId: params.deviceId,
          greenhouseId: params.greenhouseId,
          previousVersion: dev.firmware_version ? String(dev.firmware_version) : null,
          reportedVersion: dev.firmware_version ? String(dev.firmware_version) : 'unreported',
          targetVersion: params.targetFirmwareVersion,
          releaseChannel: params.releaseChannel || 'stable',
          sha256Digest: params.sha256Digest || null,
          updateStatus: `ota_${nextOtaStatus}`
        });
      }
    });

    return true;
  }

  public recordEquipmentEvent(params: {
    greenhouseId: string;
    zoneId?: string | null;
    deviceId?: string | null;
    actuatorKey: string;
    eventKind: string;
    previousState?: string | null;
    newState: string;
    triggerSource: string;
    commandId?: string | null;
    durationSeconds?: number | null;
    safetyContext?: Record<string, unknown>;
  }): EquipmentEventRecord {
    const id = generateSecureId('eqe', 8);
    const nowIso = new Date().toISOString();
    this.driver.run(
      `INSERT INTO equipment_events (
         id, greenhouse_id, zone_id, device_id, actuator_key, event_kind,
         previous_state, new_state, trigger_source, command_id, duration_seconds,
         safety_context_json, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.greenhouseId,
        params.zoneId || null,
        params.deviceId || null,
        params.actuatorKey,
        params.eventKind,
        params.previousState || null,
        params.newState,
        params.triggerSource,
        params.commandId || null,
        params.durationSeconds ?? null,
        JSON.stringify(params.safetyContext || {}),
        nowIso
      ]
    );
    return {
      id,
      greenhouseId: params.greenhouseId,
      zoneId: params.zoneId || null,
      deviceId: params.deviceId || null,
      actuatorKey: params.actuatorKey,
      eventKind: params.eventKind,
      previousState: params.previousState || null,
      newState: params.newState,
      triggerSource: params.triggerSource,
      commandId: params.commandId || null,
      durationSeconds: params.durationSeconds ?? null,
      safetyContext: params.safetyContext || {},
      recordedAt: nowIso
    };
  }
}

// ============================================================================
// 2. TIERED TELEMETRY HISTORY, ROLLUPS & RETENTION REPOSITORY
// ============================================================================

export class TelemetryHistoryRepository {
  private readonly driver: SqliteDriver;
  private lastRetentionSweepByGh = new Map<string, number>();

  constructor(driver: SqliteDriver) {
    this.driver = driver;
  }

  public getRetentionPolicy(greenhouseId: string): DataRetentionPolicyConfig {
    const row = this.driver.queryOne<any>(
      'SELECT * FROM data_retention_policies WHERE greenhouse_id = ?',
      [greenhouseId]
    );
    const defaults = getDefaultDataRetentionConfig();
    if (!row) return defaults;
    return {
      rawTelemetryDays: Number(row.raw_telemetry_days ?? defaults.rawTelemetryDays),
      hourlyRollupDays: Number(row.hourly_rollup_days ?? defaults.hourlyRollupDays),
      dailyRollupDays: Number(row.daily_rollup_days ?? defaults.dailyRollupDays),
      aiObservationDays: Number(row.ai_observation_days ?? defaults.aiObservationDays),
      auditLogDays: Number(row.audit_log_days ?? defaults.auditLogDays),
      routineCameraMaxFiles: Number(row.routine_camera_max_files ?? defaults.routineCameraMaxFiles),
      routineCameraMaxDays: Number(row.routine_camera_max_days ?? defaults.routineCameraMaxDays),
      curatedDatasetMaxFiles: Number(row.curated_dataset_max_files ?? defaults.curatedDatasetMaxFiles)
    };
  }

  public upsertRetentionPolicy(
    greenhouseId: string,
    overrides: Partial<DataRetentionPolicyConfig>,
    actorUserId?: string | null
  ): DataRetentionPolicyConfig {
    const current = this.getRetentionPolicy(greenhouseId);
    const merged: DataRetentionPolicyConfig = {
      rawTelemetryDays: Math.max(1, Math.min(3650, overrides.rawTelemetryDays ?? current.rawTelemetryDays)),
      hourlyRollupDays: Math.max(7, Math.min(3650, overrides.hourlyRollupDays ?? current.hourlyRollupDays)),
      dailyRollupDays: Math.max(30, Math.min(7300, overrides.dailyRollupDays ?? current.dailyRollupDays)),
      aiObservationDays: Math.max(7, Math.min(3650, overrides.aiObservationDays ?? current.aiObservationDays)),
      auditLogDays: Math.max(365, Math.min(7300, overrides.auditLogDays ?? current.auditLogDays)),
      routineCameraMaxFiles: Math.max(5, Math.min(1000, overrides.routineCameraMaxFiles ?? current.routineCameraMaxFiles)),
      routineCameraMaxDays: Math.max(1, Math.min(90, overrides.routineCameraMaxDays ?? current.routineCameraMaxDays)),
      curatedDatasetMaxFiles: Math.max(
        10,
        Math.min(10000, overrides.curatedDatasetMaxFiles ?? current.curatedDatasetMaxFiles)
      )
    };

    const nowIso = new Date().toISOString();
    this.driver.run(
      `INSERT INTO data_retention_policies (
         greenhouse_id, raw_telemetry_days, hourly_rollup_days, daily_rollup_days,
         ai_observation_days, audit_log_days, routine_camera_max_files,
         routine_camera_max_days, curated_dataset_max_files, updated_by_user_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(greenhouse_id) DO UPDATE SET
         raw_telemetry_days = excluded.raw_telemetry_days,
         hourly_rollup_days = excluded.hourly_rollup_days,
         daily_rollup_days = excluded.daily_rollup_days,
         ai_observation_days = excluded.ai_observation_days,
         audit_log_days = excluded.audit_log_days,
         routine_camera_max_files = excluded.routine_camera_max_files,
         routine_camera_max_days = excluded.routine_camera_max_days,
         curated_dataset_max_files = excluded.curated_dataset_max_files,
         updated_by_user_id = excluded.updated_by_user_id,
         updated_at = excluded.updated_at`,
      [
        greenhouseId,
        merged.rawTelemetryDays,
        merged.hourlyRollupDays,
        merged.dailyRollupDays,
        merged.aiObservationDays,
        merged.auditLogDays,
        merged.routineCameraMaxFiles,
        merged.routineCameraMaxDays,
        merged.curatedDatasetMaxFiles,
        actorUserId || null,
        nowIso
      ]
    );
    return merged;
  }

  /**
   * Incrementally updates both the Hourly Rollup and Daily Rollup buckets
   * inside the caller's transaction so historical analytics remain O(1) per packet.
   */
  public upsertRollupsForSample(params: {
    greenhouseId: string;
    zoneId: string | null;
    deviceId: string;
    receivedAtMs: number;
    telemetry: ValidatedControllerTelemetry;
    vpdKpa: number | null;
  }): void {
    const { greenhouseId, zoneId, deviceId, receivedAtMs, telemetry, vpdKpa } = params;
    const nowIso = new Date(receivedAtMs).toISOString();

    const hourBucketMs = Math.floor(receivedAtMs / 3_600_000) * 3_600_000;
    const hourBucketIso = new Date(hourBucketMs).toISOString();
    const dayBucketMs = Math.floor(receivedAtMs / 86_400_000) * 86_400_000;
    const dayDate = new Date(dayBucketMs).toISOString().slice(0, 10);

    const rainInc = telemetry.rain === true ? 1 : 0;
    const pumpInc = telemetry.actuators?.pumpActive === true ? 1 : 0;

    // 1. Hourly Rollup Upsert
    const existingHour = this.driver.queryOne<any>(
      'SELECT * FROM telemetry_rollups_hourly WHERE greenhouse_id = ? AND device_id = ? AND bucket_start_ms = ?',
      [greenhouseId, deviceId, hourBucketMs]
    );

    if (!existingHour) {
      this.driver.run(
        `INSERT INTO telemetry_rollups_hourly (
           id, greenhouse_id, zone_id, device_id, bucket_start_iso, bucket_start_ms,
           sample_count, temp_min, temp_max, temp_avg, humidity_min, humidity_max, humidity_avg,
           soil_min, soil_max, soil_avg, water_min, water_avg, sunlight_avg,
           battery_min, battery_avg, vpd_avg, rain_samples, pump_active_samples, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateSecureId('trh', 6),
          greenhouseId,
          zoneId,
          deviceId,
          hourBucketIso,
          hourBucketMs,
          telemetry.temperature,
          telemetry.temperature,
          telemetry.temperature,
          telemetry.humidity,
          telemetry.humidity,
          telemetry.humidity,
          telemetry.soilMoisture,
          telemetry.soilMoisture,
          telemetry.soilMoisture,
          telemetry.waterLevel,
          telemetry.waterLevel,
          telemetry.sunlight,
          telemetry.batteryVoltage,
          telemetry.batteryVoltage,
          vpdKpa,
          rainInc,
          pumpInc,
          nowIso
        ],
        false
      );
    } else {
      const n = Number(existingHour.sample_count || 0);
      this.driver.run(
        `UPDATE telemetry_rollups_hourly SET
           sample_count = ?,
           temp_min = ?, temp_max = ?, temp_avg = ?,
           humidity_min = ?, humidity_max = ?, humidity_avg = ?,
           soil_min = ?, soil_max = ?, soil_avg = ?,
           water_min = ?, water_avg = ?,
           sunlight_avg = ?,
           battery_min = ?, battery_avg = ?,
           vpd_avg = ?,
           rain_samples = ?, pump_active_samples = ?,
           updated_at = ?
         WHERE id = ?`,
        [
          n + 1,
          minVal(toNullableNum(existingHour.temp_min), telemetry.temperature),
          maxVal(toNullableNum(existingHour.temp_max), telemetry.temperature),
          runningAvg(toNullableNum(existingHour.temp_avg), n, telemetry.temperature),
          minVal(toNullableNum(existingHour.humidity_min), telemetry.humidity),
          maxVal(toNullableNum(existingHour.humidity_max), telemetry.humidity),
          runningAvg(toNullableNum(existingHour.humidity_avg), n, telemetry.humidity),
          minVal(toNullableNum(existingHour.soil_min), telemetry.soilMoisture),
          maxVal(toNullableNum(existingHour.soil_max), telemetry.soilMoisture),
          runningAvg(toNullableNum(existingHour.soil_avg), n, telemetry.soilMoisture),
          minVal(toNullableNum(existingHour.water_min), telemetry.waterLevel),
          runningAvg(toNullableNum(existingHour.water_avg), n, telemetry.waterLevel),
          runningAvg(toNullableNum(existingHour.sunlight_avg), n, telemetry.sunlight),
          minVal(toNullableNum(existingHour.battery_min), telemetry.batteryVoltage),
          runningAvg(toNullableNum(existingHour.battery_avg), n, telemetry.batteryVoltage),
          runningAvg(toNullableNum(existingHour.vpd_avg), n, vpdKpa),
          Number(existingHour.rain_samples || 0) + rainInc,
          Number(existingHour.pump_active_samples || 0) + pumpInc,
          nowIso,
          String(existingHour.id)
        ],
        false
      );
    }

    // 2. Daily Rollup Upsert (with Growing Degree Days base 10°C calculation)
    const existingDay = this.driver.queryOne<any>(
      'SELECT * FROM telemetry_rollups_daily WHERE greenhouse_id = ? AND device_id = ? AND day_date = ?',
      [greenhouseId, deviceId, dayDate]
    );

    if (!existingDay) {
      const gdd =
        telemetry.temperature !== null ? Math.max(0, Math.min(30, telemetry.temperature) - 10) : 0;
      this.driver.run(
        `INSERT INTO telemetry_rollups_daily (
           id, greenhouse_id, zone_id, device_id, day_date, bucket_start_ms,
           sample_count, temp_min, temp_max, temp_avg, humidity_min, humidity_max, humidity_avg,
           soil_min, soil_max, soil_avg, water_min, water_avg, sunlight_avg,
           gdd_base10, rain_samples, pump_active_samples, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateSecureId('trd', 6),
          greenhouseId,
          zoneId,
          deviceId,
          dayDate,
          dayBucketMs,
          telemetry.temperature,
          telemetry.temperature,
          telemetry.temperature,
          telemetry.humidity,
          telemetry.humidity,
          telemetry.humidity,
          telemetry.soilMoisture,
          telemetry.soilMoisture,
          telemetry.soilMoisture,
          telemetry.waterLevel,
          telemetry.waterLevel,
          telemetry.sunlight,
          gdd,
          rainInc,
          pumpInc,
          nowIso
        ],
        false
      );
    } else {
      const n = Number(existingDay.sample_count || 0);
      const nextTMin = minVal(toNullableNum(existingDay.temp_min), telemetry.temperature);
      const nextTMax = maxVal(toNullableNum(existingDay.temp_max), telemetry.temperature);
      const gdd =
        nextTMin !== null && nextTMax !== null
          ? Math.max(0, (Math.min(30, nextTMax) + Math.max(10, nextTMin)) / 2 - 10)
          : Number(existingDay.gdd_base10 || 0);

      this.driver.run(
        `UPDATE telemetry_rollups_daily SET
           sample_count = ?,
           temp_min = ?, temp_max = ?, temp_avg = ?,
           humidity_min = ?, humidity_max = ?, humidity_avg = ?,
           soil_min = ?, soil_max = ?, soil_avg = ?,
           water_min = ?, water_avg = ?,
           sunlight_avg = ?,
           gdd_base10 = ?,
           rain_samples = ?, pump_active_samples = ?,
           updated_at = ?
         WHERE id = ?`,
        [
          n + 1,
          nextTMin,
          nextTMax,
          runningAvg(toNullableNum(existingDay.temp_avg), n, telemetry.temperature),
          minVal(toNullableNum(existingDay.humidity_min), telemetry.humidity),
          maxVal(toNullableNum(existingDay.humidity_max), telemetry.humidity),
          runningAvg(toNullableNum(existingDay.humidity_avg), n, telemetry.humidity),
          minVal(toNullableNum(existingDay.soil_min), telemetry.soilMoisture),
          maxVal(toNullableNum(existingDay.soil_max), telemetry.soilMoisture),
          runningAvg(toNullableNum(existingDay.soil_avg), n, telemetry.soilMoisture),
          minVal(toNullableNum(existingDay.water_min), telemetry.waterLevel),
          runningAvg(toNullableNum(existingDay.water_avg), n, telemetry.waterLevel),
          runningAvg(toNullableNum(existingDay.sunlight_avg), n, telemetry.sunlight),
          Math.round(gdd * 100) / 100,
          Number(existingDay.rain_samples || 0) + rainInc,
          Number(existingDay.pump_active_samples || 0) + pumpInc,
          nowIso,
          String(existingDay.id)
        ],
        false
      );
    }
  }

  /**
   * Throttled, configurable time-based retention sweep (replaces destructive 100-row hard delete).
   */
  public applyRetentionSweepIfDue(greenhouseId: string, nowMs: number = Date.now(), force: boolean = false): {
    rawDeleted: number;
    hourlyDeleted: number;
    dailyDeleted: number;
    observationsDeleted: number;
  } {
    const lastSweep = this.lastRetentionSweepByGh.get(greenhouseId) || 0;
    if (!force && nowMs - lastSweep < 15 * 60 * 1000) {
      return { rawDeleted: 0, hourlyDeleted: 0, dailyDeleted: 0, observationsDeleted: 0 };
    }
    this.lastRetentionSweepByGh.set(greenhouseId, nowMs);

    const policy = this.getRetentionPolicy(greenhouseId);
    const rawCutoffMs = nowMs - policy.rawTelemetryDays * 86_400_000;
    const hourlyCutoffMs = nowMs - policy.hourlyRollupDays * 86_400_000;
    const dailyCutoffMs = nowMs - policy.dailyRollupDays * 86_400_000;
    const obsCutoffIso = new Date(nowMs - policy.aiObservationDays * 86_400_000).toISOString();

    const rawRes = this.driver.run(
      'DELETE FROM telemetry_readings WHERE greenhouse_id = ? AND received_at_ms < ?',
      [greenhouseId, rawCutoffMs],
      false
    );
    const hourlyRes = this.driver.run(
      'DELETE FROM telemetry_rollups_hourly WHERE greenhouse_id = ? AND bucket_start_ms < ?',
      [greenhouseId, hourlyCutoffMs],
      false
    );
    const dailyRes = this.driver.run(
      'DELETE FROM telemetry_rollups_daily WHERE greenhouse_id = ? AND bucket_start_ms < ?',
      [greenhouseId, dailyCutoffMs],
      false
    );
    const obsRes = this.driver.run(
      'DELETE FROM ai_observations WHERE greenhouse_id = ? AND created_at < ?',
      [greenhouseId, obsCutoffIso],
      false
    );

    return {
      rawDeleted: rawRes.changes,
      hourlyDeleted: hourlyRes.changes,
      dailyDeleted: dailyRes.changes,
      observationsDeleted: obsRes.changes
    };
  }

  public queryRawTelemetryHistory(params: {
    greenhouseId: string;
    deviceId?: string;
    sinceMs?: number;
    untilMs?: number;
    limit?: number;
  }): TelemetryPointRecord[] {
    const sinceMs = params.sinceMs ?? 0;
    const untilMs = params.untilMs ?? Date.now() + 60_000;
    const limit = Math.max(1, Math.min(10_000, params.limit ?? 500));

    const rows = params.deviceId
      ? this.driver.queryAll<any>(
          `SELECT id, greenhouse_id, zone_id, device_id, recorded_at, received_at_ms,
                  temperature, humidity, soil_moisture, sunlight, grow_light,
                  water_level, battery_voltage, rain_detected, rain_gauge_level, vpd_kpa, quality_flag
           FROM telemetry_readings
           WHERE greenhouse_id = ? AND device_id = ? AND received_at_ms >= ? AND received_at_ms <= ?
           ORDER BY received_at_ms DESC
           LIMIT ?`,
          [params.greenhouseId, params.deviceId, sinceMs, untilMs, limit]
        )
      : this.driver.queryAll<any>(
          `SELECT id, greenhouse_id, zone_id, device_id, recorded_at, received_at_ms,
                  temperature, humidity, soil_moisture, sunlight, grow_light,
                  water_level, battery_voltage, rain_detected, rain_gauge_level, vpd_kpa, quality_flag
           FROM telemetry_readings
           WHERE greenhouse_id = ? AND received_at_ms >= ? AND received_at_ms <= ?
           ORDER BY received_at_ms DESC
           LIMIT ?`,
          [params.greenhouseId, sinceMs, untilMs, limit]
        );

    return rows.map((r) => ({
      id: String(r.id),
      greenhouseId: String(r.greenhouse_id),
      zoneId: r.zone_id ? String(r.zone_id) : null,
      deviceId: String(r.device_id),
      recordedAt: String(r.recorded_at),
      receivedAtMs: Number(r.received_at_ms),
      temperature: toNullableNum(r.temperature),
      humidity: toNullableNum(r.humidity),
      soilMoisture: toNullableNum(r.soil_moisture),
      sunlight: toNullableNum(r.sunlight),
      growLight: toNullableNum(r.grow_light),
      waterLevel: toNullableNum(r.water_level),
      batteryVoltage: toNullableNum(r.battery_voltage),
      rain:
        r.rain_detected === null || r.rain_detected === undefined ? null : Number(r.rain_detected) === 1,
      rainGaugeLevel: toNullableNum(r.rain_gauge_level),
      vpdKpa: toNullableNum(r.vpd_kpa),
      qualityFlag: String(r.quality_flag || 'VALID')
    }));
  }

  public queryHourlyRollups(params: {
    greenhouseId: string;
    sinceMs?: number;
    limit?: number;
  }): HourlyRollupRecord[] {
    const sinceMs = params.sinceMs ?? 0;
    const limit = Math.max(1, Math.min(2000, params.limit ?? 168));
    const rows = this.driver.queryAll<any>(
      `SELECT * FROM telemetry_rollups_hourly
       WHERE greenhouse_id = ? AND bucket_start_ms >= ?
       ORDER BY bucket_start_ms DESC
       LIMIT ?`,
      [params.greenhouseId, sinceMs, limit]
    );
    return rows.map((r) => ({
      id: String(r.id),
      greenhouseId: String(r.greenhouse_id),
      zoneId: r.zone_id ? String(r.zone_id) : null,
      deviceId: String(r.device_id),
      bucketStartIso: String(r.bucket_start_iso),
      bucketStartMs: Number(r.bucket_start_ms),
      sampleCount: Number(r.sample_count),
      tempMin: toNullableNum(r.temp_min),
      tempMax: toNullableNum(r.temp_max),
      tempAvg: toNullableNum(r.temp_avg),
      humidityMin: toNullableNum(r.humidity_min),
      humidityMax: toNullableNum(r.humidity_max),
      humidityAvg: toNullableNum(r.humidity_avg),
      soilMin: toNullableNum(r.soil_min),
      soilMax: toNullableNum(r.soil_max),
      soilAvg: toNullableNum(r.soil_avg),
      waterMin: toNullableNum(r.water_min),
      waterAvg: toNullableNum(r.water_avg),
      sunlightAvg: toNullableNum(r.sunlight_avg),
      batteryMin: toNullableNum(r.battery_min),
      batteryAvg: toNullableNum(r.battery_avg),
      vpdAvg: toNullableNum(r.vpd_avg),
      rainSamples: Number(r.rain_samples || 0),
      pumpActiveSamples: Number(r.pump_active_samples || 0),
      updatedAt: String(r.updated_at)
    }));
  }

  public queryDailyRollups(params: {
    greenhouseId: string;
    sinceMs?: number;
    limit?: number;
  }): DailyRollupRecord[] {
    const sinceMs = params.sinceMs ?? 0;
    const limit = Math.max(1, Math.min(1825, params.limit ?? 90));
    const rows = this.driver.queryAll<any>(
      `SELECT * FROM telemetry_rollups_daily
       WHERE greenhouse_id = ? AND bucket_start_ms >= ?
       ORDER BY bucket_start_ms DESC
       LIMIT ?`,
      [params.greenhouseId, sinceMs, limit]
    );
    return rows.map((r) => ({
      id: String(r.id),
      greenhouseId: String(r.greenhouse_id),
      zoneId: r.zone_id ? String(r.zone_id) : null,
      deviceId: String(r.device_id),
      dayDate: String(r.day_date),
      bucketStartMs: Number(r.bucket_start_ms),
      sampleCount: Number(r.sample_count),
      tempMin: toNullableNum(r.temp_min),
      tempMax: toNullableNum(r.temp_max),
      tempAvg: toNullableNum(r.temp_avg),
      humidityMin: toNullableNum(r.humidity_min),
      humidityMax: toNullableNum(r.humidity_max),
      humidityAvg: toNullableNum(r.humidity_avg),
      soilMin: toNullableNum(r.soil_min),
      soilMax: toNullableNum(r.soil_max),
      soilAvg: toNullableNum(r.soil_avg),
      waterMin: toNullableNum(r.water_min),
      waterAvg: toNullableNum(r.water_avg),
      sunlightAvg: toNullableNum(r.sunlight_avg),
      gddBase10: Number(r.gdd_base10 || 0),
      rainSamples: Number(r.rain_samples || 0),
      pumpActiveSamples: Number(r.pump_active_samples || 0),
      updatedAt: String(r.updated_at)
    }));
  }
}

// ============================================================================
// 3. CROP KNOWLEDGE BASE & VERSIONED STANDARDS REPOSITORY
// ============================================================================

export class CropKnowledgeRepository {
  private readonly driver: SqliteDriver;

  constructor(driver: SqliteDriver) {
    this.driver = driver;
  }

  public upsertCropKnowledgeProfile(params: {
    cropCode: string;
    commonName: string;
    localNames?: string[];
    scientificName: string;
    variety?: string;
    cultivationMethod?: string;
    standardDaysToHarvest: number;
    summary: string;
    riskProfile?: Record<string, unknown>;
    evidenceReferences?: Record<string, unknown>[];
    confidenceLevel?: string;
    validationStatus?: string;
  }): CropKnowledgeProfileRecord {
    const nowIso = new Date().toISOString();
    const variety = String(params.variety || 'Standard').trim();
    const cultivationMethod = String(params.cultivationMethod || 'soil_bed').trim();
    const cropCode = String(params.cropCode).trim().toLowerCase();

    const existing = this.driver.queryOne<{ id: string }>(
      'SELECT id FROM crop_knowledge_profiles WHERE crop_code = ? AND variety = ? AND cultivation_method = ?',
      [cropCode, variety, cultivationMethod]
    );
    const id = existing ? String(existing.id) : generateSecureId('ckp', 6);

    if (existing) {
      this.driver.run(
        `UPDATE crop_knowledge_profiles
         SET common_name = ?, local_names_json = ?, scientific_name = ?, standard_days_to_harvest = ?,
             summary = ?, risk_profile_json = ?, evidence_references_json = ?, confidence_level = ?,
             validation_status = ?, updated_at = ?
         WHERE id = ?`,
        [
          params.commonName,
          JSON.stringify(params.localNames || []),
          params.scientificName,
          params.standardDaysToHarvest,
          params.summary,
          JSON.stringify(params.riskProfile || {}),
          JSON.stringify(params.evidenceReferences || []),
          params.confidenceLevel || 'extension_verified',
          params.validationStatus || 'verified',
          nowIso,
          id
        ]
      );
    } else {
      this.driver.run(
        `INSERT INTO crop_knowledge_profiles (
           id, crop_code, common_name, local_names_json, scientific_name, variety,
           cultivation_method, standard_days_to_harvest, summary, risk_profile_json,
           evidence_references_json, confidence_level, validation_status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          cropCode,
          params.commonName,
          JSON.stringify(params.localNames || []),
          params.scientificName,
          variety,
          cultivationMethod,
          params.standardDaysToHarvest,
          params.summary,
          JSON.stringify(params.riskProfile || {}),
          JSON.stringify(params.evidenceReferences || []),
          params.confidenceLevel || 'extension_verified',
          params.validationStatus || 'verified',
          nowIso,
          nowIso
        ]
      );
    }

    const row = this.driver.queryOne<any>('SELECT * FROM crop_knowledge_profiles WHERE id = ?', [id])!;
    return {
      id: String(row.id),
      cropCode: String(row.crop_code),
      commonName: String(row.common_name),
      localNames: safeParseJson(row.local_names_json, []),
      scientificName: String(row.scientific_name),
      variety: String(row.variety),
      cultivationMethod: String(row.cultivation_method),
      standardDaysToHarvest: Number(row.standard_days_to_harvest),
      summary: String(row.summary),
      riskProfile: safeParseJson(row.risk_profile_json, {}),
      evidenceReferences: safeParseJson(row.evidence_references_json, []),
      confidenceLevel: String(row.confidence_level),
      validationStatus: String(row.validation_status),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  public upsertGrowthStageStandard(params: {
    cropProfileId: string;
    stageName: string;
    stageOrder: number;
    dayStart: number;
    dayEnd: number;
    tempMinC: number;
    tempMaxC: number;
    tempOptimalC?: number | null;
    humidityMinPct: number;
    humidityMaxPct: number;
    soilMoistureMinPct: number;
    soilMoistureMaxPct: number;
    vpdMinKpa?: number | null;
    vpdMaxKpa?: number | null;
    lightDliMin?: number | null;
    lightDliMax?: number | null;
    phMin?: number | null;
    phMax?: number | null;
    ecMinMs?: number | null;
    ecMaxMs?: number | null;
    irrigationNotes?: string | null;
    citationRefs?: string[];
  }): CropGrowthStageStandardRecord {
    const id = generateSecureId('cgs', 6);
    const nowIso = new Date().toISOString();

    this.driver.run(
      `INSERT INTO crop_growth_stage_standards (
         id, crop_profile_id, stage_name, stage_order, day_start, day_end,
         temp_min_c, temp_max_c, temp_optimal_c, humidity_min_pct, humidity_max_pct,
         soil_moisture_min_pct, soil_moisture_max_pct, vpd_min_kpa, vpd_max_kpa,
         light_dli_min, light_dli_max, ph_min, ph_max, ec_min_ms, ec_max_ms,
         irrigation_notes, citation_refs_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(crop_profile_id, stage_name) DO UPDATE SET
         stage_order = excluded.stage_order,
         day_start = excluded.day_start,
         day_end = excluded.day_end,
         temp_min_c = excluded.temp_min_c,
         temp_max_c = excluded.temp_max_c,
         temp_optimal_c = excluded.temp_optimal_c,
         humidity_min_pct = excluded.humidity_min_pct,
         humidity_max_pct = excluded.humidity_max_pct,
         soil_moisture_min_pct = excluded.soil_moisture_min_pct,
         soil_moisture_max_pct = excluded.soil_moisture_max_pct,
         vpd_min_kpa = excluded.vpd_min_kpa,
         vpd_max_kpa = excluded.vpd_max_kpa,
         light_dli_min = excluded.light_dli_min,
         light_dli_max = excluded.light_dli_max,
         ph_min = excluded.ph_min,
         ph_max = excluded.ph_max,
         ec_min_ms = excluded.ec_min_ms,
         ec_max_ms = excluded.ec_max_ms,
         irrigation_notes = excluded.irrigation_notes,
         citation_refs_json = excluded.citation_refs_json`,
      [
        id,
        params.cropProfileId,
        params.stageName,
        params.stageOrder,
        params.dayStart,
        params.dayEnd,
        params.tempMinC,
        params.tempMaxC,
        params.tempOptimalC ?? null,
        params.humidityMinPct,
        params.humidityMaxPct,
        params.soilMoistureMinPct,
        params.soilMoistureMaxPct,
        params.vpdMinKpa ?? null,
        params.vpdMaxKpa ?? null,
        params.lightDliMin ?? null,
        params.lightDliMax ?? null,
        params.phMin ?? null,
        params.phMax ?? null,
        params.ecMinMs ?? null,
        params.ecMaxMs ?? null,
        params.irrigationNotes || null,
        JSON.stringify(params.citationRefs || []),
        nowIso
      ]
    );

    const row = this.driver.queryOne<any>(
      'SELECT * FROM crop_growth_stage_standards WHERE crop_profile_id = ? AND stage_name = ?',
      [params.cropProfileId, params.stageName]
    )!;
    return {
      id: String(row.id),
      cropProfileId: String(row.crop_profile_id),
      stageName: String(row.stage_name),
      stageOrder: Number(row.stage_order),
      dayStart: Number(row.day_start),
      dayEnd: Number(row.day_end),
      tempMinC: Number(row.temp_min_c),
      tempMaxC: Number(row.temp_max_c),
      tempOptimalC: toNullableNum(row.temp_optimal_c),
      humidityMinPct: Number(row.humidity_min_pct),
      humidityMaxPct: Number(row.humidity_max_pct),
      soilMoistureMinPct: Number(row.soil_moisture_min_pct),
      soilMoistureMaxPct: Number(row.soil_moisture_max_pct),
      vpdMinKpa: toNullableNum(row.vpd_min_kpa),
      vpdMaxKpa: toNullableNum(row.vpd_max_kpa),
      lightDliMin: toNullableNum(row.light_dli_min),
      lightDliMax: toNullableNum(row.light_dli_max),
      phMin: toNullableNum(row.ph_min),
      phMax: toNullableNum(row.ph_max),
      ecMinMs: toNullableNum(row.ec_min_ms),
      ecMaxMs: toNullableNum(row.ec_max_ms),
      irrigationNotes: row.irrigation_notes ? String(row.irrigation_notes) : null,
      citationRefs: safeParseJson(row.citation_refs_json, []),
      createdAt: String(row.created_at)
    };
  }

  public createCropStandardVersion(params: {
    greenhouseId: string;
    zoneId?: string | null;
    cropProfileId?: string | null;
    thresholds: Record<string, unknown>;
    evidence?: Record<string, unknown>;
    references?: Record<string, unknown>[];
    proposedBy: string;
    activateImmediatelyWithApprover?: string | null;
    rollbackOfVersionId?: string | null;
  }): CropStandardVersionRecord {
    return this.driver.runInTransaction(() => {
      const maxRow = this.driver.queryOne<{ max_v: number | null }>(
        'SELECT MAX(version_number) AS max_v FROM crop_standard_versions WHERE greenhouse_id = ?',
        [params.greenhouseId]
      );
      const nextVersion = Number(maxRow?.max_v || 0) + 1;
      const nowIso = new Date().toISOString();
      const id = generateSecureId('csv', 6);
      const activateNow = Boolean(params.activateImmediatelyWithApprover);

      if (activateNow) {
        this.driver.run(
          `UPDATE crop_standard_versions
           SET status = 'superseded'
           WHERE greenhouse_id = ? AND status = 'active'`,
          [params.greenhouseId],
          false
        );
      }

      this.driver.run(
        `INSERT INTO crop_standard_versions (
           id, greenhouse_id, zone_id, crop_profile_id, version_number, status,
           thresholds_json, evidence_json, references_json, proposed_by,
           approved_by_user_id, rollback_of_version_id, created_at, activated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          params.greenhouseId,
          params.zoneId || null,
          params.cropProfileId || null,
          nextVersion,
          activateNow ? 'active' : 'proposed',
          JSON.stringify(params.thresholds),
          JSON.stringify(params.evidence || {}),
          JSON.stringify(params.references || []),
          params.proposedBy,
          params.activateImmediatelyWithApprover || null,
          params.rollbackOfVersionId || null,
          nowIso,
          activateNow ? nowIso : null
        ],
        false
      );

      const row = this.driver.queryOne<any>('SELECT * FROM crop_standard_versions WHERE id = ?', [id])!;
      return {
        id: String(row.id),
        greenhouseId: String(row.greenhouse_id),
        zoneId: row.zone_id ? String(row.zone_id) : null,
        cropProfileId: row.crop_profile_id ? String(row.crop_profile_id) : null,
        versionNumber: Number(row.version_number),
        status: String(row.status) as CropStandardVersionRecord['status'],
        thresholds: safeParseJson(row.thresholds_json, {}),
        evidence: safeParseJson(row.evidence_json, {}),
        references: safeParseJson(row.references_json, []),
        proposedBy: String(row.proposed_by),
        approvedByUserId: row.approved_by_user_id ? String(row.approved_by_user_id) : null,
        rollbackOfVersionId: row.rollback_of_version_id ? String(row.rollback_of_version_id) : null,
        createdAt: String(row.created_at),
        activatedAt: row.activated_at ? String(row.activated_at) : null
      };
    });
  }
}

// ============================================================================
// 4. FARMER AUTHORIZATION, COMMAND QUEUE, ACKS & OUTCOME VERIFICATION REPO
// ============================================================================

export class AuthorizationAndCommandRepository {
  private readonly driver: SqliteDriver;

  constructor(driver: SqliteDriver) {
    this.driver = driver;
  }

  private assertNotGuestAccount(userId: string): void {
    const userRow = this.driver.queryOne<{ id: string; is_guest: number; email: string }>(
      'SELECT id, is_guest, email FROM users WHERE id = ?',
      [userId]
    );
    if (!userRow) {
      throw new Error('USER_NOT_FOUND: Authorized farmer account does not exist.');
    }
    if (Number(userRow.is_guest) === 1 || String(userRow.email).endsWith('@preview.edens-ai.local')) {
      const err: any = new Error(
        'Guest accounts are restricted to simulation and read-only testing and cannot authorize or control physical greenhouse equipment.'
      );
      err.code = 'GUEST_HARDWARE_CONTROL_FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }
  }

  public getGreenhouseSafetyEnvelope(greenhouseId: string): TwoTierSafetyEnvelope {
    const row = this.driver.queryOne<{ safety_defaults_json: string }>(
      'SELECT safety_defaults_json FROM greenhouses WHERE id = ?',
      [greenhouseId]
    );
    if (!row?.safety_defaults_json) {
      return createDefaultTwoTierSafetyEnvelope();
    }
    const parsed = safeParseJson<Partial<TwoTierSafetyEnvelope>>(row.safety_defaults_json, {});
    return resolveEffectiveSafetyEnvelope(parsed.policyDefaults, parsed.hardwareProtection);
  }

  public createAuthorizationPolicy(params: {
    greenhouseId: string;
    zoneId?: string | null;
    mode: AuthorizationMode;
    cropType: string;
    equipmentKey: string;
    permittedAction: string;
    thresholds: Record<string, unknown>;
    maxDurationSeconds?: number;
    cooldownSeconds?: number;
    maxDailyCumulativeSeconds?: number;
    operatingConditions?: Record<string, unknown>;
    expiresAt?: string | null;
    reviewRequiredAt?: string | null;
    createdByUserId: string;
  }): FarmerAuthorizationPolicyRecord {
    this.assertNotGuestAccount(params.createdByUserId);

    const safety = this.getGreenhouseSafetyEnvelope(params.greenhouseId);
    const requestedMaxDuration =
      params.maxDurationSeconds ?? safety.policyDefaults.maxIndividualIrrigationPulseSeconds;

    // Never allow a policy duration exceeding Tier 1 hardware protection ceiling
    const boundedDuration = Math.max(
      1,
      Math.min(safety.hardwareProtection.maxContinuousPumpSeconds, requestedMaxDuration)
    );
    const cooldownSeconds = Math.max(
      safety.policyDefaults.minPumpCooldownSeconds,
      params.cooldownSeconds ?? safety.policyDefaults.minPumpCooldownSeconds
    );
    const maxDailyCumulativeSeconds = Math.min(
      86_400,
      params.maxDailyCumulativeSeconds ?? safety.policyDefaults.maxDailyCumulativePumpSeconds
    );

    const id = generateSecureId('pol', 8);
    const nowIso = new Date().toISOString();

    this.driver.run(
      `INSERT INTO farmer_authorization_policies (
         id, greenhouse_id, zone_id, mode, crop_type, equipment_key, permitted_action,
         thresholds_json, max_duration_seconds, cooldown_seconds, max_daily_cumulative_seconds,
         operating_conditions_json, expires_at, review_required_at, status,
         created_by_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [
        id,
        params.greenhouseId,
        params.zoneId || null,
        params.mode,
        params.cropType,
        params.equipmentKey,
        params.permittedAction,
        JSON.stringify(params.thresholds || {}),
        boundedDuration,
        cooldownSeconds,
        maxDailyCumulativeSeconds,
        JSON.stringify(params.operatingConditions || {}),
        params.expiresAt || null,
        params.reviewRequiredAt || null,
        params.createdByUserId,
        nowIso,
        nowIso
      ]
    );

    const row = this.driver.queryOne<any>('SELECT * FROM farmer_authorization_policies WHERE id = ?', [id])!;
    return {
      id: String(row.id),
      greenhouseId: String(row.greenhouse_id),
      zoneId: row.zone_id ? String(row.zone_id) : null,
      mode: String(row.mode) as AuthorizationMode,
      cropType: String(row.crop_type),
      equipmentKey: String(row.equipment_key),
      permittedAction: String(row.permitted_action),
      thresholds: safeParseJson(row.thresholds_json, {}),
      maxDurationSeconds: Number(row.max_duration_seconds),
      cooldownSeconds: Number(row.cooldown_seconds),
      maxDailyCumulativeSeconds: Number(row.max_daily_cumulative_seconds),
      operatingConditions: safeParseJson(row.operating_conditions_json, {}),
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      reviewRequiredAt: row.review_required_at ? String(row.review_required_at) : null,
      status: String(row.status) as FarmerAuthorizationPolicyRecord['status'],
      createdByUserId: String(row.created_by_user_id),
      revokedByUserId: row.revoked_by_user_id ? String(row.revoked_by_user_id) : null,
      revokedAt: row.revoked_at ? String(row.revoked_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  public recordRecommendationAndDecision(params: {
    greenhouseId: string;
    zoneId?: string | null;
    agentName: string;
    category: string;
    observationSummary: string;
    evidence?: Record<string, unknown>;
    confidenceScore: number;
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    proposedAction: Record<string, unknown>;
    expectedOutcome?: Record<string, unknown>;
    fallbackPlan?: string;
    modelVersionId?: string | null;
    requiresFarmerApproval?: boolean;
  }): { recommendationId: string; createdAt: string } {
    const id = generateSecureId('rec', 8);
    const nowIso = new Date().toISOString();
    this.driver.run(
      `INSERT INTO ai_recommendations (
         id, greenhouse_id, zone_id, agent_name, category, observation_summary,
         evidence_json, confidence_score, risk_level, proposed_action_json,
         expected_outcome_json, fallback_plan, model_version_id,
         requires_farmer_approval, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        id,
        params.greenhouseId,
        params.zoneId || null,
        params.agentName,
        params.category,
        redactSecretsFromText(params.observationSummary),
        JSON.stringify(params.evidence || {}),
        Math.max(0, Math.min(1, params.confidenceScore)),
        params.riskLevel || 'low',
        JSON.stringify(params.proposedAction),
        JSON.stringify(params.expectedOutcome || {}),
        params.fallbackPlan || null,
        params.modelVersionId || null,
        params.requiresFarmerApproval === false ? 0 : 1,
        nowIso
      ]
    );
    return { recommendationId: id, createdAt: nowIso };
  }

  public recordFarmerDecision(params: {
    greenhouseId: string;
    actorUserId: string;
    recommendationId?: string | null;
    policyId?: string | null;
    decision: 'approve' | 'reject' | 'modify' | 'request_explanation' | 'revoke' | 'emergency_stop';
    modifiedParameters?: Record<string, unknown>;
    rationale?: string;
  }): { decisionId: string; createdAt: string } {
    this.assertNotGuestAccount(params.actorUserId);

    return this.driver.runInTransaction(() => {
      const id = generateSecureId('dec', 8);
      const nowIso = new Date().toISOString();

      this.driver.run(
        `INSERT INTO farmer_decisions (
           id, recommendation_id, policy_id, greenhouse_id, actor_user_id,
           decision, modified_parameters_json, rationale, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          params.recommendationId || null,
          params.policyId || null,
          params.greenhouseId,
          params.actorUserId,
          params.decision,
          JSON.stringify(params.modifiedParameters || {}),
          params.rationale || null,
          nowIso
        ],
        false
      );

      if (params.recommendationId) {
        const nextRecStatus =
          params.decision === 'approve'
            ? 'approved'
            : params.decision === 'reject'
              ? 'rejected'
              : params.decision === 'modify'
                ? 'modified'
                : null;
        if (nextRecStatus) {
          this.driver.run(
            'UPDATE ai_recommendations SET status = ? WHERE id = ? AND greenhouse_id = ?',
            [nextRecStatus, params.recommendationId, params.greenhouseId],
            false
          );
        }
      }

      if (params.decision === 'emergency_stop') {
        this.driver.run(
          `UPDATE greenhouses
           SET emergency_stop_active = 1, emergency_stop_reason = ?, emergency_stop_at = ?, updated_at = ?
           WHERE id = ?`,
          [params.rationale || 'Farmer Emergency Stop activated', nowIso, nowIso, params.greenhouseId],
          false
        );
        this.driver.run(
          `UPDATE hardware_command_queue
           SET status = 'cancelled_estop', completed_at = ?
           WHERE greenhouse_id = ? AND status IN ('queued', 'dispatched')`,
          [nowIso, params.greenhouseId],
          false
        );
      }

      return { decisionId: id, createdAt: nowIso };
    });
  }

  /**
   * Prepares a bounded command record in the database foundation (Phase 1 stores schema/queue
   * readiness ONLY; physical dispatch remains disabled in Phase 1).
   */
  public stageAuthorizedCommandRecord(params: {
    greenhouseId: string;
    zoneId?: string | null;
    deviceId: string;
    recommendationId?: string | null;
    policyId?: string | null;
    authorizedByUserId: string;
    authorizationMode: AuthorizationMode | 'manual_farmer';
    commandType: string;
    targetEquipment: string;
    parameters: Record<string, unknown>;
    idempotencyKey: string;
    ttlSeconds?: number;
  }): HardwareCommandRecord {
    this.assertNotGuestAccount(params.authorizedByUserId);

    const ghRow = this.driver.queryOne<{ emergency_stop_active: number }>(
      'SELECT emergency_stop_active FROM greenhouses WHERE id = ?',
      [params.greenhouseId]
    );
    if (Number(ghRow?.emergency_stop_active) === 1) {
      const err: any = new Error('Emergency Stop is active on this greenhouse; commands cannot be queued.');
      err.code = 'EMERGENCY_STOP_ACTIVE';
      err.statusCode = 409;
      throw err;
    }

    const safety = this.getGreenhouseSafetyEnvelope(params.greenhouseId);
    const id = generateSecureId('cmd', 8);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + Math.max(15, Math.min(3600, params.ttlSeconds ?? 120)) * 1000).toISOString();

    return this.driver.runInTransaction(() => {
      const seqRow = this.driver.queryOne<{ max_seq: number | null }>(
        'SELECT MAX(sequence_no) AS max_seq FROM hardware_command_queue WHERE device_id = ?',
        [params.deviceId]
      );
      const sequenceNo = Number(seqRow?.max_seq || 0) + 1;

      this.driver.run(
        `INSERT INTO hardware_command_queue (
           id, greenhouse_id, zone_id, device_id, recommendation_id, policy_id,
           authorized_by_user_id, authorization_mode, command_type, target_equipment,
           parameters_json, safety_tier_snapshot_json, idempotency_key, sequence_no,
           status, expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        [
          id,
          params.greenhouseId,
          params.zoneId || null,
          params.deviceId,
          params.recommendationId || null,
          params.policyId || null,
          params.authorizedByUserId,
          params.authorizationMode,
          params.commandType,
          params.targetEquipment,
          JSON.stringify(params.parameters || {}),
          JSON.stringify(safety),
          params.idempotencyKey,
          sequenceNo,
          expiresAt,
          nowIso
        ],
        false
      );

      return {
        id,
        greenhouseId: params.greenhouseId,
        zoneId: params.zoneId || null,
        deviceId: params.deviceId,
        recommendationId: params.recommendationId || null,
        policyId: params.policyId || null,
        authorizedByUserId: params.authorizedByUserId,
        authorizationMode: params.authorizationMode,
        commandType: params.commandType,
        targetEquipment: params.targetEquipment,
        parameters: params.parameters || {},
        safetyTierSnapshot: safety,
        idempotencyKey: params.idempotencyKey,
        sequenceNo,
        status: 'queued',
        expiresAt,
        dispatchedAt: null,
        completedAt: null,
        createdAt: nowIso
      };
    });
  }

  public recordEquipmentAck(params: {
    commandId: string;
    deviceId: string;
    greenhouseId: string;
    ackStatus: 'executed' | 'blocked_local_interlock' | 'invalid_params' | 'hardware_fault';
    firmwareVersion?: string | null;
    preState?: Record<string, unknown>;
    postState?: Record<string, unknown>;
    interlocks?: Record<string, unknown>;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): { ackId: string; receivedAt: string } {
    const id = generateSecureId('ack', 8);
    const nowIso = new Date().toISOString();
    const cmdNextStatus =
      params.ackStatus === 'executed'
        ? 'acked'
        : params.ackStatus === 'blocked_local_interlock'
          ? 'rejected_safety'
          : 'failed';

    this.driver.runInTransaction(() => {
      this.driver.run(
        `INSERT INTO equipment_acknowledgements (
           id, command_id, device_id, greenhouse_id, ack_status, firmware_version,
           pre_state_json, post_state_json, interlocks_json, error_code, error_message, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          params.commandId,
          params.deviceId,
          params.greenhouseId,
          params.ackStatus,
          params.firmwareVersion || null,
          JSON.stringify(params.preState || {}),
          JSON.stringify(params.postState || {}),
          JSON.stringify(params.interlocks || {}),
          params.errorCode || null,
          params.errorMessage ? redactSecretsFromText(params.errorMessage) : null,
          nowIso
        ],
        false
      );

      this.driver.run(
        'UPDATE hardware_command_queue SET status = ?, completed_at = ? WHERE id = ? AND greenhouse_id = ?',
        [cmdNextStatus, nowIso, params.commandId, params.greenhouseId],
        false
      );
    });

    return { ackId: id, receivedAt: nowIso };
  }

  public recordOutcomeVerification(params: {
    greenhouseId: string;
    commandId?: string | null;
    recommendationId?: string | null;
    verificationWindowSeconds: number;
    baselineMetrics: Record<string, unknown>;
    observedMetrics: Record<string, unknown>;
    expectedDelta: Record<string, unknown>;
    actualDelta: Record<string, unknown>;
    outcomeStatus:
      | 'pending'
      | 'verified_effective'
      | 'partial_effect'
      | 'no_effect'
      | 'adverse_effect'
      | 'inconclusive_stale_sensor';
    effectivenessScore?: number | null;
    notes?: string | null;
  }): { verificationId: string; verifiedAt: string | null } {
    const id = generateSecureId('ovf', 8);
    const nowIso = new Date().toISOString();
    const verifiedAt = params.outcomeStatus === 'pending' ? null : nowIso;

    this.driver.run(
      `INSERT INTO outcome_verifications (
         id, command_id, recommendation_id, greenhouse_id, verification_window_seconds,
         baseline_metrics_json, observed_metrics_json, expected_delta_json, actual_delta_json,
         outcome_status, effectiveness_score, notes, verified_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.commandId || null,
        params.recommendationId || null,
        params.greenhouseId,
        params.verificationWindowSeconds,
        JSON.stringify(params.baselineMetrics),
        JSON.stringify(params.observedMetrics),
        JSON.stringify(params.expectedDelta),
        JSON.stringify(params.actualDelta),
        params.outcomeStatus,
        params.effectivenessScore ?? null,
        params.notes || null,
        verifiedAt,
        nowIso
      ]
    );
    return { verificationId: id, verifiedAt };
  }
}

// ============================================================================
// 5. AGRICULTURAL LEARNING, INSPECTIONS, GROWTH & HARVEST CYCLES REPOSITORY
// ============================================================================

export class AgriculturalLearningRepository {
  private readonly driver: SqliteDriver;

  constructor(driver: SqliteDriver) {
    this.driver = driver;
  }

  public recordPlantInspection(params: {
    greenhouseId: string;
    zoneId?: string | null;
    deviceId?: string | null;
    imageFrameId?: string | null;
    imageSha256?: string | null;
    curatedDatasetFlag?: boolean;
    retentionTier?: 'routine_ephemeral' | 'diagnostic_retained' | 'curated_training';
    cropType: string;
    growthStageDetected?: string | null;
    healthStatus: string;
    primaryCondition?: string | null;
    confidenceScore?: number | null;
    expertConfirmationRequired?: boolean;
    differentialCauses?: Record<string, unknown>[];
    visualEvidence?: Record<string, unknown>;
    recommendationSummary: string;
    modelVersionId?: string | null;
  }): { inspectionId: string; createdAt: string } {
    const id = generateSecureId('pin', 8);
    const nowIso = new Date().toISOString();
    this.driver.run(
      `INSERT INTO plant_inspections (
         id, greenhouse_id, zone_id, device_id, image_frame_id, image_sha256,
         curated_dataset_flag, retention_tier, crop_type, growth_stage_detected,
         health_status, primary_condition, confidence_score, expert_confirmation_required,
         differential_causes_json, visual_evidence_json, recommendation_summary,
         model_version_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.greenhouseId,
        params.zoneId || null,
        params.deviceId || null,
        params.imageFrameId || null,
        params.imageSha256 || null,
        params.curatedDatasetFlag ? 1 : 0,
        params.retentionTier || 'routine_ephemeral',
        params.cropType,
        params.growthStageDetected || null,
        params.healthStatus,
        params.primaryCondition || null,
        params.confidenceScore ?? null,
        params.expertConfirmationRequired ? 1 : 0,
        JSON.stringify(params.differentialCauses || []),
        JSON.stringify(params.visualEvidence || {}),
        redactSecretsFromText(params.recommendationSummary),
        params.modelVersionId || null,
        nowIso
      ]
    );
    return { inspectionId: id, createdAt: nowIso };
  }

  public registerCuratedDatasetSample(params: {
    greenhouseId: string;
    sampleType: 'plant_image' | 'telemetry_window' | 'control_trajectory';
    sourceRecordId?: string | null;
    storageRelPath?: string | null;
    sha256: string;
    cropType: string;
    variety?: string | null;
    growthStage?: string | null;
    groundTruthLabel?: string | null;
    labelConfidence?: number | null;
    verifiedByUserId?: string | null;
    consentForTraining?: boolean;
    metadata?: Record<string, unknown>;
  }): { sampleId: string; createdAt: string } {
    const id = generateSecureId('cds', 8);
    const nowIso = new Date().toISOString();
    this.driver.run(
      `INSERT INTO curated_dataset_samples (
         id, greenhouse_id, sample_type, source_record_id, storage_rel_path, sha256,
         crop_type, variety, growth_stage, ground_truth_label, label_confidence,
         verified_by_user_id, consent_for_training, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.greenhouseId,
        params.sampleType,
        params.sourceRecordId || null,
        params.storageRelPath || null,
        params.sha256,
        params.cropType,
        params.variety || null,
        params.growthStage || null,
        params.groundTruthLabel || null,
        params.labelConfidence ?? null,
        params.verifiedByUserId || null,
        params.consentForTraining === false ? 0 : 1,
        JSON.stringify(params.metadata || {}),
        nowIso
      ]
    );
    return { sampleId: id, createdAt: nowIso };
  }

  public createHarvestCycle(params: {
    greenhouseId: string;
    zoneId?: string | null;
    cropProfileId?: string | null;
    cropType: string;
    variety?: string | null;
    cultivationMethod?: string;
    plantingDate: string;
    expectedHarvestDate?: string | null;
    currentGrowthStage?: string;
    plantCount?: number | null;
    notes?: string | null;
  }): HarvestCycleRecord {
    const id = generateSecureId('hcy', 6);
    const nowIso = new Date().toISOString();
    this.driver.run(
      `INSERT INTO harvest_cycles (
         id, greenhouse_id, zone_id, crop_profile_id, crop_type, variety,
         cultivation_method, planting_date, expected_harvest_date, current_growth_stage,
         plant_count, status, disease_incidents_count, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)`,
      [
        id,
        params.greenhouseId,
        params.zoneId || null,
        params.cropProfileId || null,
        params.cropType,
        params.variety || null,
        params.cultivationMethod || 'soil_bed',
        params.plantingDate,
        params.expectedHarvestDate || null,
        params.currentGrowthStage || 'seedling',
        params.plantCount ?? null,
        params.notes || null,
        nowIso,
        nowIso
      ]
    );

    const r = this.driver.queryOne<any>('SELECT * FROM harvest_cycles WHERE id = ?', [id])!;
    return this.mapHarvestCycle(r);
  }

  public completeHarvestCycle(params: {
    greenhouseId: string;
    harvestCycleId: string;
    actualHarvestDate: string;
    yieldKg: number;
    marketableYieldKg?: number | null;
    qualityGrade?: string | null;
    waterUsedLiters?: number | null;
    energyUsedKwh?: number | null;
    diseaseIncidentsCount?: number;
    notes?: string | null;
  }): HarvestCycleRecord | null {
    const nowIso = new Date().toISOString();
    const res = this.driver.run(
      `UPDATE harvest_cycles
       SET status = 'harvested', actual_harvest_date = ?, yield_kg = ?, marketable_yield_kg = ?,
           quality_grade = ?, water_used_liters = ?, energy_used_kwh = ?,
           disease_incidents_count = COALESCE(?, disease_incidents_count),
           notes = COALESCE(?, notes), updated_at = ?
       WHERE id = ? AND greenhouse_id = ?`,
      [
        params.actualHarvestDate,
        params.yieldKg,
        params.marketableYieldKg ?? null,
        params.qualityGrade || null,
        params.waterUsedLiters ?? null,
        params.energyUsedKwh ?? null,
        params.diseaseIncidentsCount ?? null,
        params.notes || null,
        nowIso,
        params.harvestCycleId,
        params.greenhouseId
      ]
    );
    if (res.changes === 0) return null;
    const r = this.driver.queryOne<any>('SELECT * FROM harvest_cycles WHERE id = ?', [params.harvestCycleId]);
    return r ? this.mapHarvestCycle(r) : null;
  }

  private mapHarvestCycle(r: any): HarvestCycleRecord {
    return {
      id: String(r.id),
      greenhouseId: String(r.greenhouse_id),
      zoneId: r.zone_id ? String(r.zone_id) : null,
      cropProfileId: r.crop_profile_id ? String(r.crop_profile_id) : null,
      cropType: String(r.crop_type),
      variety: r.variety ? String(r.variety) : null,
      cultivationMethod: String(r.cultivation_method),
      plantingDate: String(r.planting_date),
      expectedHarvestDate: r.expected_harvest_date ? String(r.expected_harvest_date) : null,
      actualHarvestDate: r.actual_harvest_date ? String(r.actual_harvest_date) : null,
      currentGrowthStage: String(r.current_growth_stage),
      plantCount: toNullableNum(r.plant_count),
      status: String(r.status) as HarvestCycleRecord['status'],
      yieldKg: toNullableNum(r.yield_kg),
      marketableYieldKg: toNullableNum(r.marketable_yield_kg),
      qualityGrade: r.quality_grade ? String(r.quality_grade) : null,
      waterUsedLiters: toNullableNum(r.water_used_liters),
      energyUsedKwh: toNullableNum(r.energy_used_kwh),
      diseaseIncidentsCount: Number(r.disease_incidents_count || 0),
      notes: r.notes ? String(r.notes) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  public recordCropGrowthMeasurement(params: {
    harvestCycleId: string;
    greenhouseId: string;
    zoneId?: string | null;
    daysAfterPlanting: number;
    growthStage: string;
    canopyHeightCm?: number | null;
    leafCountEstimate?: number | null;
    flowerCountEstimate?: number | null;
    fruitCountEstimate?: number | null;
    stressIndex?: number | null;
    gddAccumulated?: number | null;
    source?: 'manual' | 'vision_estimate' | 'sensor_derived';
    notes?: string | null;
  }): { recordId: string; recordedAt: string } {
    const id = generateSecureId('cgr', 8);
    const nowIso = new Date().toISOString();
    this.driver.run(
      `INSERT INTO crop_growth_records (
         id, harvest_cycle_id, greenhouse_id, zone_id, recorded_at, days_after_planting,
         growth_stage, canopy_height_cm, leaf_count_estimate, flower_count_estimate,
         fruit_count_estimate, stress_index, gdd_accumulated, source, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.harvestCycleId,
        params.greenhouseId,
        params.zoneId || null,
        nowIso,
        params.daysAfterPlanting,
        params.growthStage,
        params.canopyHeightCm ?? null,
        params.leafCountEstimate ?? null,
        params.flowerCountEstimate ?? null,
        params.fruitCountEstimate ?? null,
        params.stressIndex ?? null,
        params.gddAccumulated ?? null,
        params.source || 'manual',
        params.notes || null
      ]
    );
    return { recordId: id, recordedAt: nowIso };
  }

  public recordAgriculturalLearningLesson(params: {
    greenhouseId: string;
    harvestCycleId?: string | null;
    learningDomain:
      | 'microclimate_response'
      | 'irrigation_response'
      | 'crop_standard_feedback'
      | 'recommendation_efficacy';
    featureContext: Record<string, unknown>;
    actionTaken: Record<string, unknown>;
    verifiedOutcome: Record<string, unknown>;
    lessonSummary: string;
    confidenceDelta?: number;
  }): { learningId: string; createdAt: string } {
    const id = generateSecureId('lrn', 8);
    const nowIso = new Date().toISOString();
    this.driver.run(
      `INSERT INTO agricultural_learning_records (
         id, greenhouse_id, harvest_cycle_id, learning_domain, feature_context_json,
         action_taken_json, verified_outcome_json, lesson_summary, confidence_delta, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.greenhouseId,
        params.harvestCycleId || null,
        params.learningDomain,
        JSON.stringify(params.featureContext),
        JSON.stringify(params.actionTaken),
        JSON.stringify(params.verifiedOutcome),
        redactSecretsFromText(params.lessonSummary),
        params.confidenceDelta ?? 0,
        nowIso
      ]
    );
    return { learningId: id, createdAt: nowIso };
  }
}

// ============================================================================
// 6. DEEP LEARNING MODEL REGISTRY & RL SIMULATION REPOSITORY (FOUNDATION ONLY)
// ============================================================================

export class ModelAndSimulationRepository {
  private readonly driver: SqliteDriver;

  constructor(driver: SqliteDriver) {
    this.driver = driver;
  }

  public registerMlModelVersion(params: {
    modelFamily: string;
    modelName: string;
    versionTag: string;
    framework: string;
    artifactPath?: string | null;
    artifactSha256?: string | null;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
    calibration?: Record<string, unknown>;
    fallbackRuleId: string;
    deploymentStage?: MlModelVersionRecord['deploymentStage'];
  }): MlModelVersionRecord {
    const id = generateSecureId('mlm', 6);
    const nowIso = new Date().toISOString();
    const stage = params.deploymentStage || 'registered';

    this.driver.run(
      `INSERT INTO ml_model_versions (
         id, model_family, model_name, version_tag, framework, artifact_path,
         artifact_sha256, input_schema_json, output_schema_json, metrics_json,
         calibration_json, fallback_rule_id, deployment_stage, created_at, activated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.modelFamily,
        params.modelName,
        params.versionTag,
        params.framework,
        params.artifactPath || null,
        params.artifactSha256 || null,
        JSON.stringify(params.inputSchema || {}),
        JSON.stringify(params.outputSchema || {}),
        JSON.stringify(params.metrics || {}),
        JSON.stringify(params.calibration || {}),
        params.fallbackRuleId,
        stage,
        nowIso,
        stage === 'active' ? nowIso : null
      ]
    );

    const r = this.driver.queryOne<any>('SELECT * FROM ml_model_versions WHERE id = ?', [id])!;
    return {
      id: String(r.id),
      modelFamily: String(r.model_family),
      modelName: String(r.model_name),
      versionTag: String(r.version_tag),
      framework: String(r.framework),
      artifactPath: r.artifact_path ? String(r.artifact_path) : null,
      artifactSha256: r.artifact_sha256 ? String(r.artifact_sha256) : null,
      inputSchema: safeParseJson(r.input_schema_json, {}),
      outputSchema: safeParseJson(r.output_schema_json, {}),
      metrics: safeParseJson(r.metrics_json, {}),
      calibration: safeParseJson(r.calibration_json, {}),
      fallbackRuleId: String(r.fallback_rule_id),
      deploymentStage: String(r.deployment_stage) as MlModelVersionRecord['deploymentStage'],
      createdAt: String(r.created_at),
      activatedAt: r.activated_at ? String(r.activated_at) : null
    };
  }

  public recordMlTrainingRun(params: {
    modelVersionId?: string | null;
    modelFamily: string;
    datasetSnapshot: Record<string, unknown>;
    hyperparameters: Record<string, unknown>;
    trainMetrics?: Record<string, unknown>;
    validationMetrics?: Record<string, unknown>;
    testMetrics?: Record<string, unknown>;
    status: 'queued' | 'running' | 'completed' | 'failed';
    notes?: string | null;
  }): { trainingRunId: string; startedAt: string } {
    const id = generateSecureId('trn', 6);
    const nowIso = new Date().toISOString();
    this.driver.run(
      `INSERT INTO ml_training_runs (
         id, model_version_id, model_family, dataset_snapshot_json, hyperparameters_json,
         train_metrics_json, validation_metrics_json, test_metrics_json,
         status, started_at, completed_at, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.modelVersionId || null,
        params.modelFamily,
        JSON.stringify(params.datasetSnapshot),
        JSON.stringify(params.hyperparameters),
        JSON.stringify(params.trainMetrics || {}),
        JSON.stringify(params.validationMetrics || {}),
        JSON.stringify(params.testMetrics || {}),
        params.status,
        nowIso,
        params.status === 'completed' || params.status === 'failed' ? nowIso : null,
        params.notes || null
      ]
    );
    return { trainingRunId: id, startedAt: nowIso };
  }

  public registerRlPolicy(params: {
    policyName: string;
    versionTag: string;
    algorithm: string;
    stateSpec: Record<string, unknown>;
    actionSpec: Record<string, unknown>;
    rewardWeights: Record<string, unknown>;
    safetyBounds: Record<string, unknown>;
    artifactPath?: string | null;
    artifactSha256?: string | null;
    benchmarkVsBaseline?: Record<string, unknown>;
    rollbackPolicyId?: string | null;
  }): RlPolicyRecord {
    const id = generateSecureId('rlp', 6);
    const nowIso = new Date().toISOString();
    this.driver.run(
      `INSERT INTO rl_policies (
         id, policy_name, version_tag, algorithm, state_spec_json, action_spec_json,
         reward_weights_json, safety_bounds_json, artifact_path, artifact_sha256,
         benchmark_vs_baseline_json, approval_status, rollback_policy_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'simulated_only', ?, ?, ?)`,
      [
        id,
        params.policyName,
        params.versionTag,
        params.algorithm,
        JSON.stringify(params.stateSpec),
        JSON.stringify(params.actionSpec),
        JSON.stringify(params.rewardWeights),
        JSON.stringify(params.safetyBounds),
        params.artifactPath || null,
        params.artifactSha256 || null,
        JSON.stringify(params.benchmarkVsBaseline || {}),
        params.rollbackPolicyId || null,
        nowIso,
        nowIso
      ]
    );

    const r = this.driver.queryOne<any>('SELECT * FROM rl_policies WHERE id = ?', [id])!;
    return {
      id: String(r.id),
      policyName: String(r.policy_name),
      versionTag: String(r.version_tag),
      algorithm: String(r.algorithm),
      stateSpec: safeParseJson(r.state_spec_json, {}),
      actionSpec: safeParseJson(r.action_spec_json, {}),
      rewardWeights: safeParseJson(r.reward_weights_json, {}),
      safetyBounds: safeParseJson(r.safety_bounds_json, {}),
      artifactPath: r.artifact_path ? String(r.artifact_path) : null,
      artifactSha256: r.artifact_sha256 ? String(r.artifact_sha256) : null,
      benchmarkVsBaseline: safeParseJson(r.benchmark_vs_baseline_json, {}),
      approvalStatus: String(r.approval_status) as RlPolicyRecord['approvalStatus'],
      approvedByUserId: r.approved_by_user_id ? String(r.approved_by_user_id) : null,
      rollbackPolicyId: r.rollback_policy_id ? String(r.rollback_policy_id) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  public recordSimulationExperiment(params: {
    greenhouseId?: string | null;
    rlPolicyId?: string | null;
    scenarioName: string;
    weatherProfile: string;
    cropType: string;
    durationSimDays: number;
    seed: number;
    baselineMetrics: Record<string, unknown>;
    policyMetrics: Record<string, unknown>;
    safetyViolationsCount: number;
    waterSavedPct?: number | null;
    energySavedPct?: number | null;
    stressReductionPct?: number | null;
  }): { experimentId: string; passedSafetyGate: boolean; createdAt: string } {
    const id = generateSecureId('sim', 6);
    const nowIso = new Date().toISOString();
    // Policy can NEVER pass the safety gate if safetyViolationsCount > 0
    const passedSafetyGate = params.safetyViolationsCount === 0;

    this.driver.run(
      `INSERT INTO simulation_experiments (
         id, greenhouse_id, rl_policy_id, scenario_name, weather_profile, crop_type,
         duration_sim_days, seed, baseline_metrics_json, policy_metrics_json,
         safety_violations_count, water_saved_pct, energy_saved_pct, stress_reduction_pct,
         passed_safety_gate, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.greenhouseId || null,
        params.rlPolicyId || null,
        params.scenarioName,
        params.weatherProfile,
        params.cropType,
        params.durationSimDays,
        params.seed,
        JSON.stringify(params.baselineMetrics),
        JSON.stringify(params.policyMetrics),
        params.safetyViolationsCount,
        params.waterSavedPct ?? null,
        params.energySavedPct ?? null,
        params.stressReductionPct ?? null,
        passedSafetyGate ? 1 : 0,
        nowIso
      ]
    );
    return { experimentId: id, passedSafetyGate, createdAt: nowIso };
  }
}

export interface PlatformRepositories {
  zonesAndHardware: ZoneAndHardwareRepository;
  telemetryHistory: TelemetryHistoryRepository;
  cropKnowledge: CropKnowledgeRepository;
  authorizationAndCommands: AuthorizationAndCommandRepository;
  agriculturalLearning: AgriculturalLearningRepository;
  modelsAndSimulation: ModelAndSimulationRepository;
}

export function createPlatformRepositories(driver: SqliteDriver): PlatformRepositories {
  return {
    zonesAndHardware: new ZoneAndHardwareRepository(driver),
    telemetryHistory: new TelemetryHistoryRepository(driver),
    cropKnowledge: new CropKnowledgeRepository(driver),
    authorizationAndCommands: new AuthorizationAndCommandRepository(driver),
    agriculturalLearning: new AgriculturalLearningRepository(driver),
    modelsAndSimulation: new ModelAndSimulationRepository(driver)
  };
}
