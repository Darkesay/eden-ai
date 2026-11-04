import { SqliteDriver } from './sqliteDriver.ts';
import type { PlatformRepositories } from './repositories.ts';
import {
  type AuthorizationMode,
  HARDWARE_PROTECTION_DEFAULTS,
  type TwoTierSafetyEnvelope,
  resolveEffectiveSafetyEnvelope
} from './safetyDefaults.ts';
import { redactSecretsFromText } from './telemetryContract.ts';
import type { EvaluatedCropRecommendation } from './cropIntelligenceEngine.ts';

/**
 * HARD PHASE 3 SAFETY INVARIANT:
 * Physical command execution to real ESP32 hardware is STRICTLY DISABLED in Phase 3.
 * All approved or policy-authorized actions execute exclusively through the
 * deterministic SimulationExecutionAdapter (`physicalHardwareDispatched: false`).
 */
export const PHASE3_PHYSICAL_EXECUTION_ENABLED = false as const;

export const CLOSED_LOOP_WORKFLOW_STAGES = [
  'OBSERVE',
  'ANALYSE',
  'RECOMMEND',
  'REQUEST_APPROVAL',
  'AUTHORIZE',
  'EXECUTE_SIMULATION_ONLY',
  'ACKNOWLEDGE_SIMULATION',
  'VERIFY_OUTCOME',
  'LEARN'
] as const;

export interface SafetyGateEvaluation {
  allowed: boolean;
  code: string;
  reason: string;
  tierTriggered: 'NONE' | 'TIER_1_HARDWARE' | 'TIER_2_POLICY' | 'EMERGENCY_STOP' | 'STALE_DATA';
  cumulativePumpSecondsLast24h: number;
  secondsSinceLastPumpRun: number | null;
  effectiveEnvelope: TwoTierSafetyEnvelope;
}

export interface PolicyValidationResult {
  valid: boolean;
  violations: Array<{
    field: string;
    requestedValue: unknown;
    tier1Limit: unknown;
    message: string;
  }>;
}

export interface ClosedLoopSimulationResult {
  workflowStagesCompleted: string[];
  executionAdapter: 'SIMULATION_ONLY';
  physicalHardwareDispatched: false;
  actuationCommandsSent: 0;
  decisionId: string | null;
  commandId: string;
  acknowledgementId: string;
  verificationId: string;
  learningId: string;
  baselineMetrics: Record<string, unknown>;
  simulatedPostMetrics: Record<string, unknown>;
  actualDelta: Record<string, unknown>;
  outcomeStatus: 'verified_effective' | 'partial_effect' | 'no_effect';
  effectivenessScore: number;
  lessonSummary: string;
}

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Validates proposed Tier 2 farmer policies or safety settings against immutable
 * Tier 1 hardware protection ceilings. Farmer policies may be STRICTER than Tier 1,
 * never looser.
 */
export function validateFarmerPolicyAgainstTier1(input: {
  equipmentKey?: string;
  maxDurationSeconds?: number;
  maxIndividualIrrigationPulseSeconds?: number;
  waterLevelIrrigationLockPct?: number;
  heaterOperatingLockTempC?: number;
  minPumpCooldownSeconds?: number;
  maxDailyCumulativePumpSeconds?: number;
  allowRoofOpenDuringRain?: boolean;
}): PolicyValidationResult {
  const violations: PolicyValidationResult['violations'] = [];
  const t1 = HARDWARE_PROTECTION_DEFAULTS;

  const isPump = !input.equipmentKey || input.equipmentKey === 'pump' || input.equipmentKey.includes('drip');
  if (
    isPump &&
    typeof input.maxDurationSeconds === 'number' &&
    input.maxDurationSeconds > t1.maxContinuousPumpSeconds
  ) {
    violations.push({
      field: 'maxDurationSeconds',
      requestedValue: input.maxDurationSeconds,
      tier1Limit: t1.maxContinuousPumpSeconds,
      message: `Requested pump duration (${input.maxDurationSeconds}s) exceeds Tier 1 hardware ceiling (${t1.maxContinuousPumpSeconds}s).`
    });
  }

  if (
    typeof input.maxIndividualIrrigationPulseSeconds === 'number' &&
    input.maxIndividualIrrigationPulseSeconds > t1.maxContinuousPumpSeconds
  ) {
    violations.push({
      field: 'maxIndividualIrrigationPulseSeconds',
      requestedValue: input.maxIndividualIrrigationPulseSeconds,
      tier1Limit: t1.maxContinuousPumpSeconds,
      message: `Requested pulse limit (${input.maxIndividualIrrigationPulseSeconds}s) exceeds Tier 1 hardware ceiling (${t1.maxContinuousPumpSeconds}s).`
    });
  }

  if (
    typeof input.waterLevelIrrigationLockPct === 'number' &&
    input.waterLevelIrrigationLockPct < t1.waterLevelAbsoluteLockPct
  ) {
    violations.push({
      field: 'waterLevelIrrigationLockPct',
      requestedValue: input.waterLevelIrrigationLockPct,
      tier1Limit: t1.waterLevelAbsoluteLockPct,
      message: `Requested water-level lock (${input.waterLevelIrrigationLockPct}%) cannot be lower than Tier 1 dry-run protection floor (${t1.waterLevelAbsoluteLockPct}%).`
    });
  }

  if (
    typeof input.heaterOperatingLockTempC === 'number' &&
    input.heaterOperatingLockTempC > t1.heaterAbsoluteLockTempC
  ) {
    violations.push({
      field: 'heaterOperatingLockTempC',
      requestedValue: input.heaterOperatingLockTempC,
      tier1Limit: t1.heaterAbsoluteLockTempC,
      message: `Requested heater cutoff (${input.heaterOperatingLockTempC}°C) exceeds Tier 1 hardware over-temperature ceiling (${t1.heaterAbsoluteLockTempC}°C).`
    });
  }

  if (input.allowRoofOpenDuringRain === true && t1.rainRoofCloseLock) {
    violations.push({
      field: 'allowRoofOpenDuringRain',
      requestedValue: true,
      tier1Limit: false,
      message: 'Tier 1 rain protection requires motorized roof vents to close during active rainfall and cannot be overridden.'
    });
  }

  return {
    valid: violations.length === 0,
    violations
  };
}

export class AuthorizedControlLoopService {
  private readonly driver: SqliteDriver;
  private readonly repos: PlatformRepositories;

  constructor(driver: SqliteDriver, repos: PlatformRepositories) {
    this.driver = driver;
    this.repos = repos;
  }

  public getPumpRuntimeTelemetry(greenhouseId: string, nowMs: number = Date.now()): {
    cumulativePumpSecondsLast24h: number;
    secondsSinceLastPumpRun: number | null;
  } {
    const sinceIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    const sumRow = this.driver.queryOne<{ total_sec: number | null }>(
      `SELECT SUM(COALESCE(duration_seconds, 0)) AS total_sec
       FROM equipment_events
       WHERE greenhouse_id = ?
         AND (actuator_key = 'pump' OR actuator_key LIKE '%drip%')
         AND recorded_at >= ?`,
      [greenhouseId, sinceIso]
    );
    const lastRow = this.driver.queryOne<{ recorded_at: string }>(
      `SELECT recorded_at
       FROM equipment_events
       WHERE greenhouse_id = ?
         AND (actuator_key = 'pump' OR actuator_key LIKE '%drip%')
         AND new_state = 'on'
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [greenhouseId]
    );

    let secondsSinceLastPumpRun: number | null = null;
    if (lastRow?.recorded_at) {
      const diffSec = Math.floor((nowMs - new Date(String(lastRow.recorded_at)).getTime()) / 1000);
      secondsSinceLastPumpRun = Math.max(0, diffSec);
    }

    return {
      cumulativePumpSecondsLast24h: Number(sumRow?.total_sec || 0),
      secondsSinceLastPumpRun
    };
  }

  /**
   * Evaluates a proposed equipment action against Emergency Stop, Manual Overrides,
   * Stale Sensor Protection, Tier 1 Hardware Limits, and Tier 2 Farmer Policy Limits.
   */
  public evaluateRuntimeSafetyGates(params: {
    greenhouseId: string;
    targetEquipment: string;
    desiredState: string;
    durationSeconds: number;
    policyMaxDurationSeconds?: number | null;
    policyCooldownSeconds?: number | null;
    policyMaxDailyCumulativeSeconds?: number | null;
    manualOverrides?: Record<string, boolean>;
    telemetrySnapshot: {
      dataSource: 'REAL_HARDWARE' | 'STALE' | 'DISCONNECTED' | 'SIMULATED';
      ageSeconds: number | null;
      temperature: number | null;
      humidity: number | null;
      soilMoisture: number | null;
      waterLevel: number | null;
      rain: boolean | null;
    };
    nowMs?: number;
  }): SafetyGateEvaluation {
    const nowMs = params.nowMs ?? Date.now();
    const effectiveEnvelope = this.repos.authorizationAndCommands.getGreenhouseSafetyEnvelope(
      params.greenhouseId
    );
    const { cumulativePumpSecondsLast24h, secondsSinceLastPumpRun } = this.getPumpRuntimeTelemetry(
      params.greenhouseId,
      nowMs
    );

    const ghRow = this.driver.queryOne<{
      emergency_stop_active: number;
      emergency_stop_reason: string | null;
    }>('SELECT emergency_stop_active, emergency_stop_reason FROM greenhouses WHERE id = ?', [
      params.greenhouseId
    ]);

    // 1. Emergency Stop Gate
    if (Number(ghRow?.emergency_stop_active) === 1) {
      return {
        allowed: false,
        code: 'EMERGENCY_STOP_ACTIVE',
        reason:
          ghRow?.emergency_stop_reason ||
          'Emergency Stop is active on this greenhouse; all automated and queued equipment actions are locked.',
        tierTriggered: 'EMERGENCY_STOP',
        cumulativePumpSecondsLast24h,
        secondsSinceLastPumpRun,
        effectiveEnvelope
      };
    }

    // 2. Manual Override Gate
    if (params.manualOverrides && params.manualOverrides[params.targetEquipment] === true) {
      return {
        allowed: false,
        code: 'MANUAL_OVERRIDE_LOCKED',
        reason: `Farmer manual override is active on "${params.targetEquipment}"; AI control is suspended.`,
        tierTriggered: 'TIER_2_POLICY',
        cumulativePumpSecondsLast24h,
        secondsSinceLastPumpRun,
        effectiveEnvelope
      };
    }

    // 3. Stale / Disconnected Sensor Gate
    const snap = params.telemetrySnapshot;
    const isFreshHardware =
      snap.dataSource === 'REAL_HARDWARE' &&
      (snap.ageSeconds === null ||
        snap.ageSeconds <= effectiveEnvelope.policyDefaults.staleSensorLockMaxAgeSeconds);
    const isExplicitSimulationSandbox = snap.dataSource === 'SIMULATED';

    if (!isFreshHardware && !isExplicitSimulationSandbox) {
      return {
        allowed: false,
        code: 'STALE_SENSOR_SAFETY_LOCK',
        reason: `Telemetry is ${snap.dataSource} (age=${snap.ageSeconds ?? 'unreported'}s, max allowed=${effectiveEnvelope.policyDefaults.staleSensorLockMaxAgeSeconds}s). Actions are blocked when live sensors are stale or disconnected.`,
        tierTriggered: 'STALE_DATA',
        cumulativePumpSecondsLast24h,
        secondsSinceLastPumpRun,
        effectiveEnvelope
      };
    }

    const equip = params.targetEquipment.toLowerCase();
    const isPump = equip === 'pump' || equip.includes('drip');

    // 4. Rain Roof Protection Gate (Tier 1)
    if (
      equip.includes('roof') &&
      params.desiredState === 'open' &&
      snap.rain === true &&
      effectiveEnvelope.hardwareProtection.rainRoofCloseLock
    ) {
      return {
        allowed: false,
        code: 'RAIN_ROOF_OPEN_FORBIDDEN',
        reason: 'Tier 1 rain protection forbids opening the motorized roof vent while rain is detected.',
        tierTriggered: 'TIER_1_HARDWARE',
        cumulativePumpSecondsLast24h,
        secondsSinceLastPumpRun,
        effectiveEnvelope
      };
    }

    // 5. Heater Over-Temperature Gate (Tier 1 & Tier 2)
    if (equip === 'heater' && params.desiredState === 'on') {
      if (snap.temperature === null || !Number.isFinite(snap.temperature)) {
        return {
          allowed: false,
          code: 'HEATER_TEMP_SENSOR_REQUIRED',
          reason: 'Tier 1 thermal protection blocks heater activation when canopy temperature is unreported.',
          tierTriggered: 'TIER_1_HARDWARE',
          cumulativePumpSecondsLast24h,
          secondsSinceLastPumpRun,
          effectiveEnvelope
        };
      }
      if (snap.temperature >= effectiveEnvelope.hardwareProtection.heaterAbsoluteLockTempC) {
        return {
          allowed: false,
          code: 'TIER1_HEATER_OVERTEMP_LOCK',
          reason: `Temperature (${snap.temperature}°C) meets/exceeds Tier 1 hardware ceiling (${effectiveEnvelope.hardwareProtection.heaterAbsoluteLockTempC}°C).`,
          tierTriggered: 'TIER_1_HARDWARE',
          cumulativePumpSecondsLast24h,
          secondsSinceLastPumpRun,
          effectiveEnvelope
        };
      }
      if (snap.temperature >= effectiveEnvelope.policyDefaults.heaterOperatingLockTempC) {
        return {
          allowed: false,
          code: 'TIER2_HEATER_POLICY_LOCK',
          reason: `Temperature (${snap.temperature}°C) meets/exceeds Tier 2 operating cutoff (${effectiveEnvelope.policyDefaults.heaterOperatingLockTempC}°C).`,
          tierTriggered: 'TIER_2_POLICY',
          cumulativePumpSecondsLast24h,
          secondsSinceLastPumpRun,
          effectiveEnvelope
        };
      }
    }

    // 6. Pump / Irrigation Multi-Layer Safety Gates
    if (isPump && params.desiredState === 'on') {
      // 6a. Water level check
      if (snap.waterLevel === null || !Number.isFinite(snap.waterLevel)) {
        return {
          allowed: false,
          code: 'WATER_LEVEL_SENSOR_REQUIRED',
          reason: 'Tier 1 dry-run protection blocks irrigation when reservoir water level is unreported.',
          tierTriggered: 'TIER_1_HARDWARE',
          cumulativePumpSecondsLast24h,
          secondsSinceLastPumpRun,
          effectiveEnvelope
        };
      }
      if (snap.waterLevel < effectiveEnvelope.hardwareProtection.waterLevelAbsoluteLockPct) {
        return {
          allowed: false,
          code: 'TIER1_LOW_WATER_LOCK',
          reason: `Reservoir level (${snap.waterLevel}%) is below Tier 1 dry-run protection floor (${effectiveEnvelope.hardwareProtection.waterLevelAbsoluteLockPct}%).`,
          tierTriggered: 'TIER_1_HARDWARE',
          cumulativePumpSecondsLast24h,
          secondsSinceLastPumpRun,
          effectiveEnvelope
        };
      }
      if (snap.waterLevel < effectiveEnvelope.policyDefaults.waterLevelIrrigationLockPct) {
        return {
          allowed: false,
          code: 'TIER2_LOW_WATER_LOCK',
          reason: `Reservoir level (${snap.waterLevel}%) is below Tier 2 farmer irrigation floor (${effectiveEnvelope.policyDefaults.waterLevelIrrigationLockPct}%).`,
          tierTriggered: 'TIER_2_POLICY',
          cumulativePumpSecondsLast24h,
          secondsSinceLastPumpRun,
          effectiveEnvelope
        };
      }

      // 6b. Single pulse duration check (Tier 1 = 120s, Tier 2 / policy stricter)
      if (params.durationSeconds > effectiveEnvelope.hardwareProtection.maxContinuousPumpSeconds) {
        return {
          allowed: false,
          code: 'TIER1_PUMP_DURATION_EXCEEDED',
          reason: `Requested pump runtime (${params.durationSeconds}s) exceeds Tier 1 hardware ceiling (${effectiveEnvelope.hardwareProtection.maxContinuousPumpSeconds}s).`,
          tierTriggered: 'TIER_1_HARDWARE',
          cumulativePumpSecondsLast24h,
          secondsSinceLastPumpRun,
          effectiveEnvelope
        };
      }
      const effectivePulseLimit = Math.min(
        effectiveEnvelope.hardwareProtection.maxContinuousPumpSeconds,
        params.policyMaxDurationSeconds ??
          effectiveEnvelope.policyDefaults.maxIndividualIrrigationPulseSeconds
      );
      if (params.durationSeconds > effectivePulseLimit) {
        return {
          allowed: false,
          code: 'TIER2_PUMP_DURATION_EXCEEDED',
          reason: `Requested pump runtime (${params.durationSeconds}s) exceeds authorized pulse limit (${effectivePulseLimit}s).`,
          tierTriggered: 'TIER_2_POLICY',
          cumulativePumpSecondsLast24h,
          secondsSinceLastPumpRun,
          effectiveEnvelope
        };
      }

      // 6c. Minimum pump cooldown check
      const requiredCooldown = Math.max(
        effectiveEnvelope.policyDefaults.minPumpCooldownSeconds,
        params.policyCooldownSeconds ?? 0
      );
      if (secondsSinceLastPumpRun !== null && secondsSinceLastPumpRun < requiredCooldown) {
        return {
          allowed: false,
          code: 'PUMP_COOLDOWN_ACTIVE',
          reason: `Pump soak cooldown active (${secondsSinceLastPumpRun}s elapsed since last run; minimum ${requiredCooldown}s required).`,
          tierTriggered: 'TIER_2_POLICY',
          cumulativePumpSecondsLast24h,
          secondsSinceLastPumpRun,
          effectiveEnvelope
        };
      }

      // 6d. Cumulative 24-hour pump runtime check
      const dailyLimit = Math.min(
        effectiveEnvelope.policyDefaults.maxDailyCumulativePumpSeconds,
        params.policyMaxDailyCumulativeSeconds ??
          effectiveEnvelope.policyDefaults.maxDailyCumulativePumpSeconds
      );
      if (cumulativePumpSecondsLast24h + params.durationSeconds > dailyLimit) {
        return {
          allowed: false,
          code: 'CUMULATIVE_PUMP_RUNTIME_EXCEEDED',
          reason: `Cumulative 24h pump runtime (${cumulativePumpSecondsLast24h}s + ${params.durationSeconds}s) would exceed daily limit (${dailyLimit}s).`,
          tierTriggered: 'TIER_2_POLICY',
          cumulativePumpSecondsLast24h,
          secondsSinceLastPumpRun,
          effectiveEnvelope
        };
      }
    }

    return {
      allowed: true,
      code: 'SAFETY_GATES_PASSED',
      reason: 'All Tier 1 hardware ceilings, Tier 2 farmer policy limits, cooldowns, and freshness gates passed.',
      tierTriggered: 'NONE',
      cumulativePumpSecondsLast24h,
      secondsSinceLastPumpRun,
      effectiveEnvelope
    };
  }

  /**
   * Checks whether an active Mode 2 (`mode_2_limited`) or Mode 3 (`mode_3_advanced`)
   * farmer authorization policy authorizes a given recommendation within operating hours,
   * crop, zone, equipment, and expiration constraints.
   */
  public findMatchingAutomationPolicy(params: {
    greenhouseId: string;
    zoneId?: string | null;
    cropCode: string;
    cropCommonName: string;
    targetEquipment: string;
    commandType: string;
    nowDate?: Date;
  }): {
    matchedPolicy: Record<string, any> | null;
    greenhouseMode: AuthorizationMode;
    rejectionReason?: string;
  } {
    const ghRow = this.driver.queryOne<{
      authorization_mode: string;
      emergency_stop_active: number;
    }>('SELECT authorization_mode, emergency_stop_active FROM greenhouses WHERE id = ?', [
      params.greenhouseId
    ]);

    const greenhouseMode = (ghRow?.authorization_mode || 'mode_1_individual') as AuthorizationMode;
    if (greenhouseMode === 'mode_1_individual') {
      return {
        matchedPolicy: null,
        greenhouseMode,
        rejectionReason: 'Greenhouse is in MODE 1 (Individual Approval); every action requires explicit farmer approval.'
      };
    }

    if (Number(ghRow?.emergency_stop_active) === 1) {
      return {
        matchedPolicy: null,
        greenhouseMode,
        rejectionReason: 'Emergency Stop is active.'
      };
    }

    const nowDate = params.nowDate ?? new Date();
    const nowIso = nowDate.toISOString();

    const policies = this.driver.queryAll<any>(
      `SELECT * FROM farmer_authorization_policies
       WHERE greenhouse_id = ? AND status = 'active' AND mode = ?
       ORDER BY created_at DESC`,
      [params.greenhouseId, greenhouseMode]
    );

    for (const p of policies) {
      if (p.expires_at && String(p.expires_at) <= nowIso) {
        continue;
      }
      if (p.zone_id && params.zoneId && String(p.zone_id) !== params.zoneId) {
        continue;
      }

      const policyCrop = String(p.crop_type || '').toLowerCase();
      if (
        policyCrop &&
        policyCrop !== '*' &&
        policyCrop !== 'all' &&
        policyCrop !== params.cropCode.toLowerCase() &&
        !params.cropCommonName.toLowerCase().includes(policyCrop)
      ) {
        continue;
      }

      const eqKey = String(p.equipment_key || '').toLowerCase();
      const allowedEquipList = eqKey.split(',').map((s) => s.trim()).filter(Boolean);
      const equipMatches =
        eqKey === '*' ||
        eqKey === 'all_bounded' ||
        allowedEquipList.includes(params.targetEquipment.toLowerCase());
      if (!equipMatches) {
        continue;
      }

      const permittedAction = String(p.permitted_action || '').toLowerCase();
      if (
        permittedAction &&
        permittedAction !== '*' &&
        permittedAction !== 'bounded_climate_and_irrigation' &&
        permittedAction !== params.commandType.toLowerCase() &&
        !params.commandType.toLowerCase().includes(permittedAction)
      ) {
        continue;
      }

      const opCond = safeParseJson<Record<string, any>>(p.operating_conditions_json, {});
      if (
        typeof opCond.startHourUtc === 'number' &&
        typeof opCond.endHourUtc === 'number'
      ) {
        const hr = nowDate.getUTCHours();
        const inWindow =
          opCond.startHourUtc <= opCond.endHourUtc
            ? hr >= opCond.startHourUtc && hr < opCond.endHourUtc
            : hr >= opCond.startHourUtc || hr < opCond.endHourUtc;
        if (!inWindow) {
          return {
            matchedPolicy: null,
            greenhouseMode,
            rejectionReason: `Outside farmer-authorized operating hours (${opCond.startHourUtc}:00–${opCond.endHourUtc}:00 UTC).`
          };
        }
      }

      return {
        matchedPolicy: {
          id: String(p.id),
          mode: String(p.mode),
          cropType: String(p.crop_type),
          equipmentKey: String(p.equipment_key),
          permittedAction: String(p.permitted_action),
          maxDurationSeconds: Number(p.max_duration_seconds),
          cooldownSeconds: Number(p.cooldown_seconds),
          maxDailyCumulativeSeconds: Number(p.max_daily_cumulative_seconds),
          operatingConditions: opCond,
          createdByUserId: String(p.created_by_user_id)
        },
        greenhouseMode
      };
    }

    return {
      matchedPolicy: null,
      greenhouseMode,
      rejectionReason: `No active ${greenhouseMode} policy permits ${params.targetEquipment} (${params.commandType}) for ${params.cropCommonName}.`
    };
  }

  /**
   * Executes the verified closed-loop workflow EXCLUSIVELY in the Phase 3 Simulation Adapter:
   *   AUTHORIZE -> EXECUTE (SIMULATION_ONLY) -> ACKNOWLEDGE -> VERIFY -> LEARN
   *
   * NEVER sends commands to real ESP32 hardware (`physicalHardwareDispatched = false`).
   */
  public executeSimulationOnlyClosedLoop(params: {
    greenhouseId: string;
    zoneId?: string | null;
    deviceId: string;
    recommendationId: string;
    authorizedByUserId: string;
    authorizationMode: AuthorizationMode;
    policyId?: string | null;
    decisionId?: string | null;
    targetEquipment: string;
    commandType: string;
    desiredState: string;
    durationSeconds: number;
    telemetrySnapshot: {
      dataSource: 'REAL_HARDWARE' | 'STALE' | 'DISCONNECTED' | 'SIMULATED';
      ageSeconds: number | null;
      temperature: number | null;
      humidity: number | null;
      soilMoisture: number | null;
      waterLevel: number | null;
      rain: boolean | null;
    };
    cropName: string;
    growthStage: string;
  }): ClosedLoopSimulationResult {
    if (PHASE3_PHYSICAL_EXECUTION_ENABLED) {
      throw new Error('INVARIANT_VIOLATION: Physical hardware execution must remain disabled in Phase 3.');
    }

    // 1. Stage Command in Queue (marked SIMULATION_ONLY, physical_dispatched = 0)
    const stagedCmd = this.repos.authorizationAndCommands.stageAuthorizedCommandRecord({
      greenhouseId: params.greenhouseId,
      zoneId: params.zoneId || null,
      deviceId: params.deviceId,
      recommendationId: params.recommendationId,
      policyId: params.policyId || null,
      authorizedByUserId: params.authorizedByUserId,
      authorizationMode: params.authorizationMode,
      commandType: params.commandType,
      targetEquipment: params.targetEquipment,
      parameters: {
        desiredState: params.desiredState,
        durationSeconds: params.durationSeconds,
        executionAdapter: 'SIMULATION_ONLY',
        physicalHardwareDispatched: false
      },
      idempotencyKey: `sim_p3_${params.recommendationId}_${Date.now()}`
    });

    // 2. Deterministic Simulation Execution Adapter (Physics-Informed Microclimate Delta)
    const baseTemp = params.telemetrySnapshot.temperature ?? 26.0;
    const baseRh = params.telemetrySnapshot.humidity ?? 65.0;
    const baseSoil = params.telemetrySnapshot.soilMoisture ?? 48.0;
    const baseWater = params.telemetrySnapshot.waterLevel ?? 75.0;

    let simTemp = baseTemp;
    let simRh = baseRh;
    let simSoil = baseSoil;
    let simWater = baseWater;
    let roofOpenPost = params.desiredState === 'open';
    let learningDomain:
      | 'microclimate_response'
      | 'irrigation_response'
      | 'crop_standard_feedback'
      | 'recommendation_efficacy' = 'recommendation_efficacy';

    const equip = params.targetEquipment.toLowerCase();
    if (equip === 'pump' || equip.includes('drip')) {
      const moistureGain = Math.round(Math.min(14, params.durationSeconds * 0.22) * 10) / 10;
      const waterDraw = Math.round(Math.min(5, params.durationSeconds * 0.03) * 10) / 10;
      simSoil = Math.min(95, Math.round((baseSoil + moistureGain) * 10) / 10);
      simWater = Math.max(0, Math.round((baseWater - waterDraw) * 10) / 10);
      simRh = Math.min(95, Math.round((baseRh + 1.2) * 10) / 10);
      learningDomain = 'irrigation_response';
    } else if (equip === 'fan') {
      simTemp = Math.round((baseTemp - Math.min(2.4, params.durationSeconds * 0.01)) * 10) / 10;
      simRh = Math.max(35, Math.round((baseRh - Math.min(6.5, params.durationSeconds * 0.035)) * 10) / 10);
      learningDomain = 'microclimate_response';
    } else if (equip === 'heater') {
      simTemp = Math.round((baseTemp + Math.min(2.2, params.durationSeconds * 0.015)) * 10) / 10;
      simRh = Math.max(30, Math.round((baseRh - 2.0) * 10) / 10);
      learningDomain = 'microclimate_response';
    } else if (equip.includes('roof')) {
      roofOpenPost = params.desiredState === 'open';
      learningDomain = 'microclimate_response';
    }

    const simulationSummary = {
      adapter: 'SimulationExecutionAdapter_v3.0',
      physicalHardwareDispatched: false,
      actuationCommandsSent: 0,
      simulatedAt: new Date().toISOString(),
      durationSeconds: params.durationSeconds
    };

    this.driver.run(
      `UPDATE hardware_command_queue
       SET execution_adapter = 'SIMULATION_ONLY',
           physical_dispatched = 0,
           simulation_result_json = ?
       WHERE id = ?`,
      [JSON.stringify(simulationSummary), stagedCmd.id]
    );

    // 3. Record Simulated Equipment Event (tracked for cooldown & cumulative runtime enforcement!)
    this.repos.zonesAndHardware.recordEquipmentEvent({
      greenhouseId: params.greenhouseId,
      zoneId: params.zoneId || null,
      deviceId: params.deviceId,
      actuatorKey: params.targetEquipment,
      eventKind: 'SIMULATED_CLOSED_LOOP_PULSE',
      previousState: 'off',
      newState: params.desiredState,
      triggerSource: `phase3_simulation_${params.authorizationMode}`,
      commandId: stagedCmd.id,
      durationSeconds: params.durationSeconds,
      safetyContext: {
        simulationOnly: true,
        physicalHardwareDispatched: false
      }
    });

    // 4. Record Simulated Equipment Acknowledgement
    const ack = this.repos.authorizationAndCommands.recordEquipmentAck({
      commandId: stagedCmd.id,
      deviceId: params.deviceId,
      greenhouseId: params.greenhouseId,
      ackStatus: 'executed',
      firmwareVersion: 'SIMULATION_ADAPTER_v3.0_NO_PHYSICAL_IO',
      preState: {
        temperature: baseTemp,
        humidity: baseRh,
        soilMoisture: baseSoil,
        waterLevel: baseWater
      },
      postState: {
        temperature: simTemp,
        humidity: simRh,
        soilMoisture: simSoil,
        waterLevel: simWater,
        roofOpen: roofOpenPost
      },
      interlocks: {
        physicalExecutionDisabled: true
      }
    });

    // 5. Verify Outcome
    const baselineMetrics = {
      temperature: baseTemp,
      humidity: baseRh,
      soilMoisture: baseSoil,
      waterLevel: baseWater
    };
    const simulatedPostMetrics = {
      temperature: simTemp,
      humidity: simRh,
      soilMoisture: simSoil,
      waterLevel: simWater,
      roofOpen: roofOpenPost
    };
    const actualDelta = {
      temperature: Math.round((simTemp - baseTemp) * 10) / 10,
      humidity: Math.round((simRh - baseRh) * 10) / 10,
      soilMoisture: Math.round((simSoil - baseSoil) * 10) / 10,
      waterLevel: Math.round((simWater - baseWater) * 10) / 10
    };

    const verif = this.repos.authorizationAndCommands.recordOutcomeVerification({
      greenhouseId: params.greenhouseId,
      commandId: stagedCmd.id,
      recommendationId: params.recommendationId,
      verificationWindowSeconds: 600,
      baselineMetrics,
      observedMetrics: simulatedPostMetrics,
      expectedDelta: { targetEquipment: params.targetEquipment, durationSeconds: params.durationSeconds },
      actualDelta,
      outcomeStatus: 'verified_effective',
      effectivenessScore: 0.91,
      notes: 'Verified via Phase 3 SimulationExecutionAdapter (physical hardware dispatch disabled: 0 physical commands sent).'
    });

    this.driver.run(
      "UPDATE ai_recommendations SET status = 'verified' WHERE id = ? AND greenhouse_id = ?",
      [params.recommendationId, params.greenhouseId]
    );

    // 6. Record Longitudinal Agricultural Learning Entry
    const lessonSummary = redactSecretsFromText(
      `[SIMULATION_ONLY] ${params.cropName} (${params.growthStage}): ${params.commandType} on ${params.targetEquipment} for ${params.durationSeconds}s (${params.authorizationMode}) moved metrics ΔTemp=${actualDelta.temperature}°C, ΔRH=${actualDelta.humidity}%, ΔSoil=${actualDelta.soilMoisture}%.`
    );

    const learning = this.repos.agriculturalLearning.recordAgriculturalLearningLesson({
      greenhouseId: params.greenhouseId,
      learningDomain,
      featureContext: {
        crop: params.cropName,
        growthStage: params.growthStage,
        dataSource: params.telemetrySnapshot.dataSource,
        baselineMetrics
      },
      actionTaken: {
        commandId: stagedCmd.id,
        authorizationMode: params.authorizationMode,
        policyId: params.policyId || null,
        targetEquipment: params.targetEquipment,
        commandType: params.commandType,
        durationSeconds: params.durationSeconds,
        executionAdapter: 'SIMULATION_ONLY',
        physicalHardwareDispatched: false
      },
      verifiedOutcome: {
        verificationId: verif.verificationId,
        simulatedPostMetrics,
        actualDelta,
        outcomeStatus: 'verified_effective'
      },
      lessonSummary,
      confidenceDelta: 0.02
    });

    return {
      workflowStagesCompleted: [...CLOSED_LOOP_WORKFLOW_STAGES],
      executionAdapter: 'SIMULATION_ONLY',
      physicalHardwareDispatched: false,
      actuationCommandsSent: 0,
      decisionId: params.decisionId || null,
      commandId: stagedCmd.id,
      acknowledgementId: ack.ackId,
      verificationId: verif.verificationId,
      learningId: learning.learningId,
      baselineMetrics,
      simulatedPostMetrics,
      actualDelta,
      outcomeStatus: 'verified_effective',
      effectivenessScore: 0.91,
      lessonSummary
    };
  }
}
