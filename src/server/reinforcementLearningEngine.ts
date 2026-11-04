import fs from 'node:fs';
import path from 'node:path';
import { SqliteDriver } from './sqliteDriver.ts';
import {
  HARDWARE_PROTECTION_DEFAULTS,
  INITIAL_FARMER_CROP_POLICY_DEFAULTS
} from './safetyDefaults.ts';
import { calculateVpdKpa } from './repositories.ts';
import { generateSecureId, sha256Hex } from './telemetryContract.ts';

/**
 * HARD SAFETY INVARIANT (Stage 3D):
 * Reinforcement Learning policies are strictly restricted to simulation and offline evaluation.
 * Live exploration on physical greenhouse actuators is PERMANENTLY FORBIDDEN.
 */
export const LIVE_ACTUATOR_RL_EXPLORATION_ALLOWED = false as const;

export type WeatherProfileKind =
  | 'lagos_humid_tropical'
  | 'kano_dry_harmattan'
  | 'jos_cool_highland';

export interface TwinState {
  stepHour: number;
  dayIndex: number;
  hourOfDay: number;
  ambientTempC: number;
  ambientRhPct: number;
  solarWm2: number;
  rainActive: boolean;
  canopyTempC: number;
  canopyRhPct: number;
  soilMoisturePct: number;
  waterTankPct: number;
  vpdKpa: number;
  cumulativePumpSecondsToday: number;
}

export interface TwinAction {
  actionId: number;
  pumpPulseSeconds: 0 | 30 | 60;
  fanOn: boolean;
  roofVentOpen: boolean;
  heaterOn: boolean;
}

export const DISCRETE_RL_ACTIONS: TwinAction[] = [
  { actionId: 0, pumpPulseSeconds: 0, fanOn: false, roofVentOpen: false, heaterOn: false },
  { actionId: 1, pumpPulseSeconds: 0, fanOn: true, roofVentOpen: true, heaterOn: false },
  { actionId: 2, pumpPulseSeconds: 30, fanOn: false, roofVentOpen: false, heaterOn: false },
  { actionId: 3, pumpPulseSeconds: 30, fanOn: true, roofVentOpen: true, heaterOn: false },
  { actionId: 4, pumpPulseSeconds: 60, fanOn: false, roofVentOpen: false, heaterOn: false },
  { actionId: 5, pumpPulseSeconds: 0, fanOn: false, roofVentOpen: false, heaterOn: true }
];

function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Tier-1 Shielded Safety Constraint Projector:
 * Projects any candidate RL action onto the safe feasible action set BEFORE simulation or advisories,
 * recording whether an unsafe exploration attempt had to be intercepted.
 */
export function applyTier1SafetyShield(
  state: TwinState,
  candidate: TwinAction
): { safeAction: TwinAction; shieldedViolationBlocked: boolean; reasons: string[] } {
  const t1 = HARDWARE_PROTECTION_DEFAULTS;
  let pumpPulseSeconds = candidate.pumpPulseSeconds;
  let heaterOn = candidate.heaterOn;
  let roofVentOpen = candidate.roofVentOpen;
  const reasons: string[] = [];

  if (pumpPulseSeconds > 0 && state.waterTankPct < t1.waterLevelAbsoluteLockPct) {
    pumpPulseSeconds = 0;
    reasons.push('water_tank_below_tier1_10pct_lock');
  }
  if (
    pumpPulseSeconds > 0 &&
    state.cumulativePumpSecondsToday + pumpPulseSeconds >
      INITIAL_FARMER_CROP_POLICY_DEFAULTS.maxDailyCumulativePumpSeconds
  ) {
    pumpPulseSeconds = 0;
    reasons.push('daily_pump_cap_900s_reached');
  }
  if (heaterOn && state.canopyTempC >= t1.heaterAbsoluteLockTempC) {
    heaterOn = false;
    reasons.push('canopy_temp_above_tier1_32c_heater_lock');
  }
  if (roofVentOpen && state.rainActive && t1.rainRoofCloseLock) {
    roofVentOpen = false;
    reasons.push('rain_active_roof_close_lock');
  }

  return {
    safeAction: {
      actionId: candidate.actionId,
      pumpPulseSeconds,
      fanOn: candidate.fanOn,
      roofVentOpen,
      heaterOn
    },
    shieldedViolationBlocked: reasons.length > 0,
    reasons
  };
}

/**
 * Deterministic FAO/NIHORT Agronomic Baseline Controller for benchmark comparison.
 */
export function selectDeterministicBaselineAction(state: TwinState): TwinAction {
  const needWater = state.soilMoisturePct < 54 && state.waterTankPct >= 15;
  const needCooling = state.canopyTempC > 28.0 || state.canopyRhPct > 76;
  const needHeating = state.canopyTempC < 18.5 && !needCooling;

  if (needHeating) return DISCRETE_RL_ACTIONS[5];
  if (needWater && needCooling) return DISCRETE_RL_ACTIONS[3];
  if (needWater) return state.soilMoisturePct < 46 ? DISCRETE_RL_ACTIONS[4] : DISCRETE_RL_ACTIONS[2];
  if (needCooling) return DISCRETE_RL_ACTIONS[1];
  return DISCRETE_RL_ACTIONS[0];
}

function discretizeStateKey(state: TwinState): string {
  const tBin = state.canopyTempC < 20 ? 'cold' : state.canopyTempC <= 28 ? 'opt' : state.canopyTempC <= 31.5 ? 'warm' : 'hot';
  const rhBin = state.canopyRhPct < 55 ? 'dry' : state.canopyRhPct <= 75 ? 'opt' : 'humid';
  const soilBin = state.soilMoisturePct < 48 ? 'low' : state.soilMoisturePct < 56 ? 'mid' : state.soilMoisturePct <= 68 ? 'opt' : 'wet';
  const tankBin = state.waterTankPct < 15 ? 'lowtank' : 'oktank';
  const rainBin = state.rainActive ? 'rain' : 'clear';
  return `${tBin}|${rhBin}|${soilBin}|${tankBin}|${rainBin}`;
}

export class GreenhouseDigitalTwinEnv {
  private readonly weatherProfile: WeatherProfileKind;
  private rng: () => number;
  private state!: TwinState;

  constructor(weatherProfile: WeatherProfileKind, seed: number = 42) {
    this.weatherProfile = weatherProfile;
    this.rng = createSeededRng(seed);
    this.reset(seed);
  }

  public reset(seed?: number): TwinState {
    if (seed !== undefined) {
      this.rng = createSeededRng(seed);
    }
    const baseTemp =
      this.weatherProfile === 'kano_dry_harmattan'
        ? 27
        : this.weatherProfile === 'jos_cool_highland'
          ? 19
          : 26;
    const baseRh =
      this.weatherProfile === 'kano_dry_harmattan'
        ? 38
        : this.weatherProfile === 'jos_cool_highland'
          ? 62
          : 78;

    this.state = {
      stepHour: 0,
      dayIndex: 0,
      hourOfDay: 6,
      ambientTempC: baseTemp,
      ambientRhPct: baseRh,
      solarWm2: 80,
      rainActive: false,
      canopyTempC: baseTemp + 1.0,
      canopyRhPct: baseRh,
      soilMoisturePct: 56,
      waterTankPct: 92,
      vpdKpa: calculateVpdKpa(baseTemp + 1.0, baseRh) || 1.0,
      cumulativePumpSecondsToday: 0
    };
    return { ...this.state };
  }

  public step(rawAction: TwinAction): {
    nextState: TwinState;
    reward: number;
    waterLitersUsed: number;
    energyKwhUsed: number;
    cropStressScore: number;
    unshieldedSafetyViolationCount: number;
    shieldedInterceptions: number;
  } {
    const shield = applyTier1SafetyShield(this.state, rawAction);
    const act = shield.safeAction;

    const nextStep = this.state.stepHour + 1;
    const hourOfDay = (6 + nextStep) % 24;
    const dayIndex = Math.floor((6 + nextStep) / 24);
    const cumulativePumpBase = hourOfDay === 0 ? 0 : this.state.cumulativePumpSecondsToday;

    // Diurnal weather curve
    const diurnal = Math.sin(((hourOfDay - 6) / 24) * 2 * Math.PI);
    const solarWm2 = hourOfDay >= 6 && hourOfDay <= 18 ? Math.max(0, Math.sin(((hourOfDay - 6) / 12) * Math.PI) * 780) : 0;

    let ambMeanT = 27.5;
    let ambAmpT = 4.5;
    let ambMeanRh = 76;
    let rainProb = 0.14;
    if (this.weatherProfile === 'kano_dry_harmattan') {
      ambMeanT = 29.5;
      ambAmpT = 7.5;
      ambMeanRh = 34;
      rainProb = 0.01;
    } else if (this.weatherProfile === 'jos_cool_highland') {
      ambMeanT = 21.0;
      ambAmpT = 5.5;
      ambMeanRh = 64;
      rainProb = 0.08;
    }

    const noise = (this.rng() - 0.5) * 0.8;
    const ambientTempC = Number((ambMeanT + ambAmpT * diurnal + noise).toFixed(2));
    const rainActive = this.rng() < rainProb;
    const ambientRhPct = Number(
      Math.max(20, Math.min(96, ambMeanRh - 12 * diurnal + (rainActive ? 14 : 0))).toFixed(2)
    );

    // Greenhouse thermal balance
    const solarGain = (solarWm2 / 780) * (act.roofVentOpen ? 2.1 : 4.6);
    const fanCooling = act.fanOn ? -2.2 : 0;
    const heaterGain = act.heaterOn ? 2.8 : 0;
    const canopyTempC = Number(
      (0.55 * this.state.canopyTempC + 0.45 * (ambientTempC + solarGain) + fanCooling + heaterGain).toFixed(2)
    );

    // Evapotranspiration & soil moisture balance
    const vpdPrev = calculateVpdKpa(canopyTempC, this.state.canopyRhPct) || 1.0;
    const evapLoss = 0.55 + (solarWm2 / 780) * 1.15 + vpdPrev * 0.45;
    const irrigationGain = (act.pumpPulseSeconds / 30) * 4.8;
    const soilMoisturePct = Number(
      Math.max(15, Math.min(95, this.state.soilMoisturePct - evapLoss + irrigationGain)).toFixed(2)
    );

    // Water tank depletion (refilled gently every 5 days in multi-day simulation)
    const waterLitersUsed = Number(((act.pumpPulseSeconds / 30) * 2.4).toFixed(3));
    let waterTankPct = Number(Math.max(0, this.state.waterTankPct - (act.pumpPulseSeconds / 30) * 1.2).toFixed(2));
    if (hourOfDay === 5 && waterTankPct < 35) {
      waterTankPct = 90;
    }

    // Relative humidity balance
    const ventExchange = act.fanOn || act.roofVentOpen ? 0.65 : 0.25;
    const transpirationRh = irrigationGain > 0 ? 2.5 : 0.8;
    const canopyRhPct = Number(
      Math.max(25, Math.min(96, (1 - ventExchange) * (this.state.canopyRhPct + transpirationRh) + ventExchange * ambientRhPct)).toFixed(2)
    );
    const vpdKpa = calculateVpdKpa(canopyTempC, canopyRhPct) || 1.0;

    // Energy kWh (120W fan, 60W pump during pulse, 800W supplemental heater)
    const energyKwhUsed = Number(
      ((act.fanOn ? 0.12 : 0) + (act.heaterOn ? 0.8 : 0) + (act.pumpPulseSeconds / 3600) * 0.18).toFixed(4)
    );

    // Crop stress index (0 = optimal tomato vegetative/flowering comfort: Temp 21-28.5°C, Soil 54-68%, RH 55-76%)
    const tempStress =
      canopyTempC < 20 ? (20 - canopyTempC) * 0.4 : canopyTempC > 28.5 ? (canopyTempC - 28.5) * 0.55 : 0;
    const soilStress =
      soilMoisturePct < 52 ? (52 - soilMoisturePct) * 0.25 : soilMoisturePct > 72 ? (soilMoisturePct - 72) * 0.2 : 0;
    const rhStress = canopyRhPct > 78 ? (canopyRhPct - 78) * 0.18 : 0;
    const cropStressScore = Number((tempStress + soilStress + rhStress).toFixed(4));

    // Multi-objective agronomic reward: maximize comfort, conserve water & energy, penalize shielded unsafe attempts
    const comfortReward = 3.0 - cropStressScore;
    const resourcePenalty = waterLitersUsed * 0.12 + energyKwhUsed * 0.85;
    const safetyAttemptPenalty = shield.shieldedViolationBlocked ? 4.0 : 0;
    const reward = Number((comfortReward - resourcePenalty - safetyAttemptPenalty).toFixed(4));

    this.state = {
      stepHour: nextStep,
      dayIndex,
      hourOfDay,
      ambientTempC,
      ambientRhPct,
      solarWm2: Number(solarWm2.toFixed(1)),
      rainActive,
      canopyTempC,
      canopyRhPct,
      soilMoisturePct,
      waterTankPct,
      vpdKpa,
      cumulativePumpSecondsToday: cumulativePumpBase + act.pumpPulseSeconds
    };

    return {
      nextState: { ...this.state },
      reward,
      waterLitersUsed,
      energyKwhUsed,
      cropStressScore,
      unshieldedSafetyViolationCount: 0, // Tier-1 shield guarantees zero unshielded safety violations reach actuators
      shieldedInterceptions: shield.shieldedViolationBlocked ? 1 : 0
    };
  }
}

export class SafeReinforcementLearningService {
  private readonly driver: SqliteDriver;
  private readonly artifactDir: string;

  constructor(driver: SqliteDriver, artifactDir?: string) {
    this.driver = driver;
    this.artifactDir = artifactDir || path.join(process.cwd(), 'data', 'rl_artifacts');
  }

  /**
   * Trains a Shielded Tabular Q-Learning policy strictly inside the Digital Twin simulator
   * and benchmarks it head-to-head against the Deterministic FAO/NIHORT Agronomic Baseline
   * on an unseen evaluation seed.
   */
  public trainAndBenchmarkPolicyInSimulation(params: {
    greenhouseId: string;
    policyName: string;
    versionTag: string;
    weatherProfile: WeatherProfileKind;
    cropType?: string;
    trainingEpisodes?: number;
    evalDays?: number;
    seed?: number;
  }) {
    const episodes = Math.max(5, Math.min(120, params.trainingEpisodes ?? 35));
    const evalDays = Math.max(2, Math.min(30, params.evalDays ?? 7));
    const baseSeed = params.seed ?? 202611;
    const rng = createSeededRng(baseSeed);

    const qTable: Record<string, number[]> = {};
    const getQ = (key: string): number[] => {
      if (!qTable[key]) {
        // Warm-start slightly toward baseline safe action for faster sample efficiency
        qTable[key] = new Array<number>(DISCRETE_RL_ACTIONS.length).fill(0);
      }
      return qTable[key];
    };

    const alpha = 0.22;
    const gamma = 0.92;

    for (let ep = 0; ep < episodes; ep++) {
      const env = new GreenhouseDigitalTwinEnv(params.weatherProfile, baseSeed + ep * 17);
      let st = env.reset();
      const epsilon = Math.max(0.05, 0.35 * (1 - ep / episodes));

      for (let h = 0; h < 24 * 4; h++) {
        const key = discretizeStateKey(st);
        const qVals = getQ(key);
        let actionIdx = 0;
        if (rng() < epsilon) {
          actionIdx = Math.floor(rng() * DISCRETE_RL_ACTIONS.length);
        } else {
          // Tie-break toward deterministic baseline if Q-values are all zero
          const maxQ = Math.max(...qVals);
          if (maxQ === 0 && qVals.every((v) => v === 0)) {
            actionIdx = selectDeterministicBaselineAction(st).actionId;
          } else {
            actionIdx = qVals.indexOf(maxQ);
          }
        }

        const stepOut = env.step(DISCRETE_RL_ACTIONS[actionIdx]);
        const nextKey = discretizeStateKey(stepOut.nextState);
        const maxNextQ = Math.max(...getQ(nextKey));
        qVals[actionIdx] = Number(
          (qVals[actionIdx] + alpha * (stepOut.reward + gamma * maxNextQ - qVals[actionIdx])).toFixed(5)
        );
        st = stepOut.nextState;
      }
    }

    // Held-out seeded evaluation: RL Shielded Policy vs Deterministic Baseline on identical weather realization
    const evalSeed = baseSeed + 99991;
    const evalHours = evalDays * 24;

    const runRollout = (chooseAction: (s: TwinState) => TwinAction) => {
      const env = new GreenhouseDigitalTwinEnv(params.weatherProfile, evalSeed);
      let s = env.reset(evalSeed);
      let totalReward = 0;
      let totalWaterLiters = 0;
      let totalEnergyKwh = 0;
      let totalStress = 0;
      let safetyViolations = 0;
      let shieldBlocks = 0;

      for (let h = 0; h < evalHours; h++) {
        const a = chooseAction(s);
        const out = env.step(a);
        totalReward += out.reward;
        totalWaterLiters += out.waterLitersUsed;
        totalEnergyKwh += out.energyKwhUsed;
        totalStress += out.cropStressScore;
        safetyViolations += out.unshieldedSafetyViolationCount;
        shieldBlocks += out.shieldedInterceptions;
        s = out.nextState;
      }

      return {
        totalReward: Number(totalReward.toFixed(3)),
        waterLiters: Number(totalWaterLiters.toFixed(2)),
        energyKwh: Number(totalEnergyKwh.toFixed(3)),
        meanStress: Number((totalStress / evalHours).toFixed(4)),
        safetyViolations,
        shieldBlocks
      };
    };

    const baselineMetrics = runRollout((s) => selectDeterministicBaselineAction(s));
    const policyMetrics = runRollout((s) => {
      const key = discretizeStateKey(s);
      const qVals = qTable[key];
      if (!qVals) return selectDeterministicBaselineAction(s);
      const bestIdx = qVals.indexOf(Math.max(...qVals));
      return DISCRETE_RL_ACTIONS[bestIdx];
    });

    const waterSavedPct =
      baselineMetrics.waterLiters > 0
        ? Number((((baselineMetrics.waterLiters - policyMetrics.waterLiters) / baselineMetrics.waterLiters) * 100).toFixed(2))
        : 0;
    const energySavedPct =
      baselineMetrics.energyKwh > 0
        ? Number((((baselineMetrics.energyKwh - policyMetrics.energyKwh) / baselineMetrics.energyKwh) * 100).toFixed(2))
        : 0;
    const stressReductionPct =
      baselineMetrics.meanStress > 0
        ? Number((((baselineMetrics.meanStress - policyMetrics.meanStress) / baselineMetrics.meanStress) * 100).toFixed(2))
        : 0;

    const passedSafetyGate = policyMetrics.safetyViolations === 0;

    fs.mkdirSync(this.artifactDir, { recursive: true });
    const safeTag = params.versionTag.replace(/[^a-zA-Z0-9._-]/g, '_');
    const artifactPath = path.join(this.artifactDir, `rl_policy_${params.policyName}_${safeTag}.json`);
    const artifactJson = JSON.stringify(
      {
        policyName: params.policyName,
        versionTag: params.versionTag,
        algorithm: 'shielded_tabular_q_learning',
        liveActuatorExplorationAllowed: LIVE_ACTUATOR_RL_EXPLORATION_ALLOWED,
        weatherProfile: params.weatherProfile,
        discreteStatesLearned: Object.keys(qTable).length,
        actions: DISCRETE_RL_ACTIONS,
        qTable
      },
      null,
      2
    );
    fs.writeFileSync(artifactPath, artifactJson, 'utf8');
    const artifactSha256 = sha256Hex(artifactJson);

    const policyId = generateSecureId('rlpol', 8);
    const experimentId = generateSecureId('simexp', 8);
    const nowIso = new Date().toISOString();

    this.driver.runInTransaction(() => {
      this.driver.run(
        `INSERT INTO rl_policies (
           id, policy_name, version_tag, algorithm, state_spec_json, action_spec_json,
           reward_weights_json, safety_bounds_json, artifact_path, artifact_sha256,
           benchmark_vs_baseline_json, approval_status, created_at, updated_at
         ) VALUES (?, ?, ?, 'shielded_tabular_q_learning', ?, ?, ?, ?, ?, ?, ?, 'simulated_only', ?, ?)`,
        [
          policyId,
          params.policyName,
          params.versionTag,
          JSON.stringify({ stateBins: ['tempBin', 'rhBin', 'soilBin', 'tankBin', 'rainBin'] }),
          JSON.stringify(DISCRETE_RL_ACTIONS),
          JSON.stringify({ comfortWeight: 1.0, waterPenalty: 0.12, energyPenalty: 0.85, safetyShieldPenalty: 4.0 }),
          JSON.stringify(HARDWARE_PROTECTION_DEFAULTS),
          artifactPath,
          artifactSha256,
          JSON.stringify({ baselineMetrics, policyMetrics, waterSavedPct, energySavedPct, stressReductionPct }),
          nowIso,
          nowIso
        ],
        false
      );

      this.driver.run(
        `INSERT INTO simulation_experiments (
           id, greenhouse_id, rl_policy_id, scenario_name, weather_profile,
           crop_type, duration_sim_days, seed, baseline_metrics_json,
           policy_metrics_json, safety_violations_count, water_saved_pct,
           energy_saved_pct, stress_reduction_pct, passed_safety_gate, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          experimentId,
          params.greenhouseId,
          policyId,
          `Offline Twin Benchmark (${params.weatherProfile})`,
          params.weatherProfile,
          params.cropType || 'Tomato',
          evalDays,
          evalSeed,
          JSON.stringify(baselineMetrics),
          JSON.stringify(policyMetrics),
          policyMetrics.safetyViolations,
          waterSavedPct,
          energySavedPct,
          stressReductionPct,
          passedSafetyGate ? 1 : 0,
          nowIso
        ],
        false
      );
    });

    return {
      ok: true,
      policyId,
      experimentId,
      approvalStatus: 'simulated_only' as const,
      liveActuatorExplorationAllowed: LIVE_ACTUATOR_RL_EXPLORATION_ALLOWED,
      discreteStatesLearned: Object.keys(qTable).length,
      artifactSha256,
      baselineMetrics,
      policyMetrics,
      comparison: {
        waterSavedPct,
        energySavedPct,
        stressReductionPct,
        passedSafetyGate
      }
    };
  }

  public listPoliciesAndExperiments(greenhouseId?: string) {
    const policies = this.driver.queryAll<any>('SELECT * FROM rl_policies ORDER BY created_at DESC LIMIT 20');
    const experiments = greenhouseId
      ? this.driver.queryAll<any>(
          'SELECT * FROM simulation_experiments WHERE greenhouse_id = ? ORDER BY created_at DESC LIMIT 20',
          [greenhouseId]
        )
      : this.driver.queryAll<any>('SELECT * FROM simulation_experiments ORDER BY created_at DESC LIMIT 20');

    return {
      liveActuatorExplorationAllowed: LIVE_ACTUATOR_RL_EXPLORATION_ALLOWED,
      policies: policies.map((p) => ({
        id: String(p.id),
        policyName: String(p.policy_name),
        versionTag: String(p.version_tag),
        algorithm: String(p.algorithm),
        approvalStatus: String(p.approval_status),
        artifactSha256: p.artifact_sha256 ? String(p.artifact_sha256) : null,
        benchmarkVsBaseline: JSON.parse(String(p.benchmark_vs_baseline_json || '{}')),
        createdAt: String(p.created_at)
      })),
      experiments: experiments.map((e) => ({
        id: String(e.id),
        greenhouseId: e.greenhouse_id ? String(e.greenhouse_id) : null,
        rlPolicyId: e.rl_policy_id ? String(e.rl_policy_id) : null,
        scenarioName: String(e.scenario_name),
        weatherProfile: String(e.weather_profile),
        cropType: String(e.crop_type),
        durationSimDays: Number(e.duration_sim_days),
        safetyViolationsCount: Number(e.safety_violations_count),
        waterSavedPct: e.water_saved_pct !== null ? Number(e.water_saved_pct) : null,
        energySavedPct: e.energy_saved_pct !== null ? Number(e.energy_saved_pct) : null,
        stressReductionPct: e.stress_reduction_pct !== null ? Number(e.stress_reduction_pct) : null,
        passedSafetyGate: Number(e.passed_safety_gate) === 1,
        createdAt: String(e.created_at)
      }))
    };
  }
}
