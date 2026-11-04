/**
 * EDENS AI — Two-Tier Hardware & Crop Policy Safety Defaults + Tiered Retention Defaults
 *
 * Implements the Phase 1 Hardware Safety Decision:
 *   1. Tier 1 (Hardware Protection): Authoritative equipment protection ceilings enforced
 *      independently by ESP32 firmware and backend safety validators.
 *   2. Tier 2 (Initial Farmer/Crop Policy Defaults): Operational defaults configurable per
 *      greenhouse, zone, validated crop standard, and equipment specification, bounded by Tier 1.
 *
 * NOTE: These are initial engineering defaults, not universal crop standards.
 * Zero physical equipment commands are issued by this module.
 */

export type AuthorizationMode = 'mode_1_individual' | 'mode_2_limited' | 'mode_3_advanced';

export interface HardwareProtectionLimits {
  /** Absolute dry-run pump protection threshold (%). Default: 10% */
  waterLevelAbsoluteLockPct: number;
  /** Absolute maximum continuous pump runtime ceiling (seconds). Default: 120s */
  maxContinuousPumpSeconds: number;
  /** Absolute thermal runaway heater protection ceiling (°C). Default: 32°C */
  heaterAbsoluteLockTempC: number;
  /** Close / lock roof vents when precipitation is detected. Default: true */
  rainRoofCloseLock: boolean;
}

export interface FarmerCropPolicySafetyDefaults {
  /** Operational reservoir reserve lock for automated/routine irrigation (%). Default: 15% */
  waterLevelIrrigationLockPct: number;
  /** Maximum duration of an individual irrigation pulse (seconds). Default: 30s */
  maxIndividualIrrigationPulseSeconds: number;
  /** Operational canopy temperature ceiling above which heating is locked (°C). Default: 28°C */
  heaterOperatingLockTempC: number;
  /** Minimum cooldown between consecutive irrigation pulses (seconds). Default: 300s */
  minPumpCooldownSeconds: number;
  /** Maximum cumulative daily pump runtime per zone (seconds). Default: 900s */
  maxDailyCumulativePumpSeconds: number;
  /** Maximum sensor age allowed before automated decisions lock out (seconds). Default: 45s */
  staleSensorLockMaxAgeSeconds: number;
}

export interface TwoTierSafetyEnvelope {
  schemaVersion: 1;
  hardwareProtection: HardwareProtectionLimits;
  policyDefaults: FarmerCropPolicySafetyDefaults;
  notes: string;
}

export interface DataRetentionPolicyConfig {
  rawTelemetryDays: number;
  hourlyRollupDays: number;
  dailyRollupDays: number;
  aiObservationDays: number;
  auditLogDays: number;
  routineCameraMaxFiles: number;
  routineCameraMaxDays: number;
  curatedDatasetMaxFiles: number;
}

export const HARDWARE_PROTECTION_DEFAULTS: Readonly<HardwareProtectionLimits> = Object.freeze({
  waterLevelAbsoluteLockPct: 10,
  maxContinuousPumpSeconds: 120,
  heaterAbsoluteLockTempC: 32,
  rainRoofCloseLock: true
});

export const INITIAL_FARMER_CROP_POLICY_DEFAULTS: Readonly<FarmerCropPolicySafetyDefaults> = Object.freeze({
  waterLevelIrrigationLockPct: 15,
  maxIndividualIrrigationPulseSeconds: 30,
  heaterOperatingLockTempC: 28,
  minPumpCooldownSeconds: 300,
  maxDailyCumulativePumpSeconds: 900,
  staleSensorLockMaxAgeSeconds: 45
});

export function createDefaultTwoTierSafetyEnvelope(): TwoTierSafetyEnvelope {
  return {
    schemaVersion: 1,
    hardwareProtection: { ...HARDWARE_PROTECTION_DEFAULTS },
    policyDefaults: { ...INITIAL_FARMER_CROP_POLICY_DEFAULTS },
    notes:
      'Initial engineering defaults. Tier 1 hardwareProtection is enforced independently on ESP32 hardware; Tier 2 policyDefaults are configurable per validated crop and equipment rating within Tier 1 ceilings.'
  };
}

/**
 * Resolves a validated two-tier safety envelope, ensuring operational policy limits
 * never violate Tier 1 physical hardware protection boundaries unless explicitly
 * updated with verified hardware specifications.
 */
export function resolveEffectiveSafetyEnvelope(
  customPolicy?: Partial<FarmerCropPolicySafetyDefaults> | null,
  customHardwareSpecs?: Partial<HardwareProtectionLimits> | null
): TwoTierSafetyEnvelope {
  const hw: HardwareProtectionLimits = {
    waterLevelAbsoluteLockPct: Math.max(
      0,
      Math.min(50, customHardwareSpecs?.waterLevelAbsoluteLockPct ?? HARDWARE_PROTECTION_DEFAULTS.waterLevelAbsoluteLockPct)
    ),
    maxContinuousPumpSeconds: Math.max(
      5,
      Math.min(600, customHardwareSpecs?.maxContinuousPumpSeconds ?? HARDWARE_PROTECTION_DEFAULTS.maxContinuousPumpSeconds)
    ),
    heaterAbsoluteLockTempC: Math.max(
      15,
      Math.min(45, customHardwareSpecs?.heaterAbsoluteLockTempC ?? HARDWARE_PROTECTION_DEFAULTS.heaterAbsoluteLockTempC)
    ),
    rainRoofCloseLock: customHardwareSpecs?.rainRoofCloseLock ?? HARDWARE_PROTECTION_DEFAULTS.rainRoofCloseLock
  };

  const rawWaterPolicy =
    customPolicy?.waterLevelIrrigationLockPct ?? INITIAL_FARMER_CROP_POLICY_DEFAULTS.waterLevelIrrigationLockPct;
  const rawPulse =
    customPolicy?.maxIndividualIrrigationPulseSeconds ??
    INITIAL_FARMER_CROP_POLICY_DEFAULTS.maxIndividualIrrigationPulseSeconds;
  const rawHeaterTemp =
    customPolicy?.heaterOperatingLockTempC ?? INITIAL_FARMER_CROP_POLICY_DEFAULTS.heaterOperatingLockTempC;

  const policy: FarmerCropPolicySafetyDefaults = {
    // Operational water lock must be >= Tier 1 absolute dry-run lock
    waterLevelIrrigationLockPct: Math.max(hw.waterLevelAbsoluteLockPct, Math.min(90, rawWaterPolicy)),
    // Individual pulse must be <= Tier 1 max continuous pump operation
    maxIndividualIrrigationPulseSeconds: Math.max(1, Math.min(hw.maxContinuousPumpSeconds, rawPulse)),
    // Operational heater lock must be <= Tier 1 absolute thermal runaway lock
    heaterOperatingLockTempC: Math.max(10, Math.min(hw.heaterAbsoluteLockTempC, rawHeaterTemp)),
    minPumpCooldownSeconds: Math.max(
      10,
      Math.min(86_400, customPolicy?.minPumpCooldownSeconds ?? INITIAL_FARMER_CROP_POLICY_DEFAULTS.minPumpCooldownSeconds)
    ),
    maxDailyCumulativePumpSeconds: Math.max(
      10,
      Math.min(
        86_400,
        customPolicy?.maxDailyCumulativePumpSeconds ?? INITIAL_FARMER_CROP_POLICY_DEFAULTS.maxDailyCumulativePumpSeconds
      )
    ),
    staleSensorLockMaxAgeSeconds: Math.max(
      10,
      Math.min(
        300,
        customPolicy?.staleSensorLockMaxAgeSeconds ?? INITIAL_FARMER_CROP_POLICY_DEFAULTS.staleSensorLockMaxAgeSeconds
      )
    )
  };

  return {
    schemaVersion: 1,
    hardwareProtection: hw,
    policyDefaults: policy,
    notes:
      'Validated two-tier safety envelope: operational policy limits are bounded by Tier 1 hardware protection ceilings.'
  };
}

function parsePositiveEnvInt(envName: string, fallback: number, min: number, max: number): number {
  const raw = (process.env[envName] || '').trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function getDefaultDataRetentionConfig(): DataRetentionPolicyConfig {
  return {
    rawTelemetryDays: parsePositiveEnvInt('TELEMETRY_RAW_RETENTION_DAYS', 90, 1, 3650),
    hourlyRollupDays: parsePositiveEnvInt('TELEMETRY_HOURLY_RETENTION_DAYS', 365, 7, 3650),
    dailyRollupDays: parsePositiveEnvInt('TELEMETRY_DAILY_RETENTION_DAYS', 1825, 30, 7300),
    aiObservationDays: parsePositiveEnvInt('AI_OBSERVATION_RETENTION_DAYS', 365, 7, 3650),
    auditLogDays: parsePositiveEnvInt('AUDIT_LOG_RETENTION_DAYS', 1825, 365, 7300),
    routineCameraMaxFiles: parsePositiveEnvInt('CAMERA_ROUTINE_MAX_FILES', 48, 5, 1000),
    routineCameraMaxDays: parsePositiveEnvInt('CAMERA_ROUTINE_MAX_DAYS', 1, 1, 90),
    curatedDatasetMaxFiles: parsePositiveEnvInt('CAMERA_CURATED_MAX_FILES', 500, 10, 10000)
  };
}
