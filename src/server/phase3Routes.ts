import express from 'express';
import type { AuthenticatedUser, PlatformDatabase } from './database.ts';
import {
  AuthorizedControlLoopService,
  CLOSED_LOOP_WORKFLOW_STAGES,
  PHASE3_PHYSICAL_EXECUTION_ENABLED,
  validateFarmerPolicyAgainstTier1
} from './authorizedControlLoop.ts';
import {
  CANONICAL_GROWTH_STAGES,
  type CanonicalGrowthStage,
  CropIntelligenceEngine
} from './cropIntelligenceEngine.ts';
import {
  type AuthorizationMode,
  resolveEffectiveSafetyEnvelope
} from './safetyDefaults.ts';

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const VALID_AUTH_MODES = new Set<AuthorizationMode>([
  'mode_1_individual',
  'mode_2_limited',
  'mode_3_advanced'
]);

export function registerPhase3IntelligenceAndControlRoutes(
  app: express.Express,
  deps: {
    platformDb: PlatformDatabase;
    ensureAuth: (req: express.Request, res: express.Response) => AuthenticatedUser | null;
    ensureNotGuestForHardwareProvisioning: (
      user: AuthenticatedUser,
      res: express.Response,
      greenhouseId: string | null,
      req: express.Request,
      attemptedAction: string
    ) => boolean;
    extractClientIp: (req: express.Request) => string;
  }
): void {
  const {
    platformDb,
    ensureAuth,
    ensureNotGuestForHardwareProvisioning,
    extractClientIp
  } = deps;

  const getEngines = () => {
    const driver = platformDb.getDriver();
    const repos = platformDb.repositories;
    return {
      driver,
      repos,
      cropEngine: new CropIntelligenceEngine(driver, repos),
      controlLoop: new AuthorizedControlLoopService(driver, repos)
    };
  };

  const ensureOperatorAccess = (
    req: express.Request,
    res: express.Response,
    greenhouseId: string,
    attemptedAction: string
  ): AuthenticatedUser | null => {
    const user = ensureAuth(req, res);
    if (!user) return null;
    if (!ensureNotGuestForHardwareProvisioning(user, res, greenhouseId, req, attemptedAction)) {
      return null;
    }
    const role = platformDb.getMemberRole(greenhouseId, user.id);
    if (role !== 'owner' && role !== 'operator') {
      res.status(403).json({
        error: 'FORBIDDEN_GREENHOUSE',
        message: 'Only authorized greenhouse owners or operators may perform this control or policy action.'
      });
      return null;
    }
    return user;
  };

  // ------------------------------------------------------------------
  // 1. CROP INTELLIGENCE CATALOG ENDPOINTS
  // ------------------------------------------------------------------

  app.get('/api/crops/intelligence', async (req, res) => {
    await platformDb.init();
    const user = ensureAuth(req, res);
    if (!user) return;

    const { cropEngine } = getEngines();
    const crops = cropEngine.listAllCropProfiles();

    return res.json({
      success: true,
      growthStages: CANONICAL_GROWTH_STAGES,
      totalProfiles: crops.length,
      crops
    });
  });

  app.get('/api/crops/intelligence/:cropCode', async (req, res) => {
    await platformDb.init();
    const user = ensureAuth(req, res);
    if (!user) return;

    const { cropEngine } = getEngines();
    const variety = typeof req.query.variety === 'string' ? req.query.variety : null;
    const profile = cropEngine.resolveProfileForCrop(req.params.cropCode, variety);

    return res.json({
      success: true,
      growthStages: CANONICAL_GROWTH_STAGES,
      profile
    });
  });

  // ------------------------------------------------------------------
  // 2. GREENHOUSE PHASE 3 INTELLIGENCE & AUTHORIZED CONTROL OVERVIEW
  // ------------------------------------------------------------------

  app.get('/api/greenhouses/:greenhouseId/intelligence-overview', async (req, res) => {
    await platformDb.init();
    const user = ensureAuth(req, res);
    if (!user) return;

    const ghId = req.params.greenhouseId;
    const gh = platformDb.getGreenhouseForUser(ghId, user.id);
    if (!gh) {
      return res.status(403).json({
        error: 'FORBIDDEN_GREENHOUSE',
        message: 'You do not have permission to view this greenhouse.'
      });
    }

    const { driver, repos, cropEngine, controlLoop } = getEngines();
    cropEngine.ensureCatalogSeeded();

    const ghMeta = driver.queryOne<any>(
      `SELECT authorization_mode, emergency_stop_active, emergency_stop_reason, emergency_stop_at,
              active_crop_variety, active_growth_stage, crop_type
       FROM greenhouses WHERE id = ?`,
      [ghId]
    );

    const zones = repos.zonesAndHardware.listZonesForGreenhouse(ghId);
    const requestedZoneId =
      typeof req.query.zoneId === 'string' && req.query.zoneId.trim() && req.query.zoneId !== 'all'
        ? req.query.zoneId.trim()
        : null;
    const activeZoneRow = requestedZoneId
      ? driver.queryOne<any>('SELECT * FROM greenhouse_zones WHERE id = ? AND greenhouse_id = ?', [
          requestedZoneId,
          ghId
        ])
      : driver.queryOne<any>(
          'SELECT * FROM greenhouse_zones WHERE greenhouse_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 1',
          [ghId]
        );

    const activeCropName = String(activeZoneRow?.active_crop_type || ghMeta?.crop_type || gh.cropType || 'Tomato');
    const activeVariety =
      (activeZoneRow?.active_crop_variety ? String(activeZoneRow.active_crop_variety) : null) ||
      (ghMeta?.active_crop_variety ? String(ghMeta.active_crop_variety) : null);
    const activeGrowthStage = String(
      activeZoneRow?.growth_stage || ghMeta?.active_growth_stage || 'vegetative'
    );

    const latestTel = platformDb.getLatestTelemetryForGreenhouse(
      ghId,
      Date.now(),
      requestedZoneId ? { zoneId: requestedZoneId } : undefined
    );

    const evalOut = cropEngine.evaluateConditionsAndRecommend({
      greenhouseId: ghId,
      zoneId: activeZoneRow ? String(activeZoneRow.id) : null,
      cropNameOrCode: activeCropName,
      variety: activeVariety,
      growthStage: activeGrowthStage,
      telemetrySnapshot: {
        dataSource: latestTel.dataSource === 'CACHED' ? 'STALE' : latestTel.dataSource,
        ageSeconds: latestTel.ageSeconds,
        temperature: latestTel.readings?.temperature ?? null,
        humidity: latestTel.readings?.humidity ?? null,
        soilMoisture: latestTel.readings?.soilMoisture ?? null,
        waterLevel: latestTel.readings?.waterLevel ?? null,
        sunlight: latestTel.readings?.sunlight ?? null,
        rain: latestTel.readings?.rain ?? null,
        actuators: latestTel.actuators ?? null
      },
      persistRecommendations: false
    });

    const safetyEnvelope = repos.authorizationAndCommands.getGreenhouseSafetyEnvelope(ghId);
    const pumpRuntime = controlLoop.getPumpRuntimeTelemetry(ghId);

    const policyRows = driver.queryAll<any>(
      'SELECT * FROM farmer_authorization_policies WHERE greenhouse_id = ? ORDER BY created_at DESC LIMIT 30',
      [ghId]
    );
    const policies = policyRows.map((p) => ({
      id: String(p.id),
      greenhouseId: String(p.greenhouse_id),
      zoneId: p.zone_id ? String(p.zone_id) : null,
      mode: String(p.mode),
      cropType: String(p.crop_type),
      equipmentKey: String(p.equipment_key),
      permittedAction: String(p.permitted_action),
      thresholds: safeParseJson(p.thresholds_json, {}),
      maxDurationSeconds: Number(p.max_duration_seconds),
      cooldownSeconds: Number(p.cooldown_seconds),
      maxDailyCumulativeSeconds: Number(p.max_daily_cumulative_seconds),
      operatingConditions: safeParseJson(p.operating_conditions_json, {}),
      expiresAt: p.expires_at ? String(p.expires_at) : null,
      status: String(p.status),
      createdAt: String(p.created_at),
      revokedAt: p.revoked_at ? String(p.revoked_at) : null
    }));

    const recRows = driver.queryAll<any>(
      'SELECT * FROM ai_recommendations WHERE greenhouse_id = ? ORDER BY created_at DESC LIMIT 25',
      [ghId]
    );
    const recommendations = recRows.map((r) => ({
      id: String(r.id),
      greenhouseId: String(r.greenhouse_id),
      zoneId: r.zone_id ? String(r.zone_id) : null,
      agentName: String(r.agent_name),
      category: String(r.category),
      observationSummary: String(r.observation_summary),
      evidence: safeParseJson(r.evidence_json, {}),
      confidenceScore: Number(r.confidence_score),
      riskLevel: String(r.risk_level),
      proposedAction: safeParseJson(r.proposed_action_json, {}),
      expectedOutcome: safeParseJson(r.expected_outcome_json, {}),
      explanation: safeParseJson(r.explanation_json, {}),
      dataSource: String(r.data_source || 'DISCONNECTED'),
      cropCode: r.crop_code ? String(r.crop_code) : evalOut.profile.cropCode,
      cropVariety: r.crop_variety ? String(r.crop_variety) : evalOut.profile.variety,
      growthStage: r.growth_stage ? String(r.growth_stage) : activeGrowthStage,
      executionMode: String(r.execution_mode || 'SIMULATION_ONLY'),
      status: String(r.status),
      createdAt: String(r.created_at)
    }));

    const decisionRows = driver.queryAll<any>(
      'SELECT * FROM farmer_decisions WHERE greenhouse_id = ? ORDER BY created_at DESC LIMIT 25',
      [ghId]
    );
    const decisions = decisionRows.map((d) => ({
      id: String(d.id),
      recommendationId: d.recommendation_id ? String(d.recommendation_id) : null,
      policyId: d.policy_id ? String(d.policy_id) : null,
      actorUserId: String(d.actor_user_id),
      decision: String(d.decision),
      modifiedParameters: safeParseJson(d.modified_parameters_json, {}),
      rationale: d.rationale ? String(d.rationale) : null,
      createdAt: String(d.created_at)
    }));

    const verifRows = driver.queryAll<any>(
      'SELECT * FROM outcome_verifications WHERE greenhouse_id = ? ORDER BY created_at DESC LIMIT 20',
      [ghId]
    );
    const verifications = verifRows.map((v) => ({
      id: String(v.id),
      commandId: v.command_id ? String(v.command_id) : null,
      recommendationId: v.recommendation_id ? String(v.recommendation_id) : null,
      verificationWindowSeconds: Number(v.verification_window_seconds),
      baselineMetrics: safeParseJson(v.baseline_metrics_json, {}),
      observedMetrics: safeParseJson(v.observed_metrics_json, {}),
      actualDelta: safeParseJson(v.actual_delta_json, {}),
      outcomeStatus: String(v.outcome_status),
      effectivenessScore: v.effectiveness_score !== null ? Number(v.effectiveness_score) : null,
      notes: v.notes ? String(v.notes) : null,
      verifiedAt: v.verified_at ? String(v.verified_at) : null,
      createdAt: String(v.created_at)
    }));

    const learningRows = driver.queryAll<any>(
      'SELECT * FROM agricultural_learning_records WHERE greenhouse_id = ? ORDER BY created_at DESC LIMIT 15',
      [ghId]
    );
    const learningRecords = learningRows.map((l) => ({
      id: String(l.id),
      learningDomain: String(l.learning_domain),
      lessonSummary: String(l.lesson_summary),
      confidenceDelta: Number(l.confidence_delta || 0),
      actionTaken: safeParseJson(l.action_taken_json, {}),
      verifiedOutcome: safeParseJson(l.verified_outcome_json, {}),
      createdAt: String(l.created_at)
    }));

    return res.json({
      success: true,
      physicalExecutionEnabled: PHASE3_PHYSICAL_EXECUTION_ENABLED,
      executionAdapter: 'SIMULATION_ONLY',
      workflowStages: CLOSED_LOOP_WORKFLOW_STAGES,
      growthStages: CANONICAL_GROWTH_STAGES,
      greenhouseControlState: {
        authorizationMode: String(ghMeta?.authorization_mode || 'mode_1_individual'),
        emergencyStopActive: Number(ghMeta?.emergency_stop_active) === 1,
        emergencyStopReason: ghMeta?.emergency_stop_reason ? String(ghMeta.emergency_stop_reason) : null,
        emergencyStopAt: ghMeta?.emergency_stop_at ? String(ghMeta.emergency_stop_at) : null,
        activeCropType: activeCropName,
        activeCropVariety: evalOut.profile.variety,
        activeGrowthStage: evalOut.stageStandard.stageName,
        plantingDate: activeZoneRow?.planting_date ? String(activeZoneRow.planting_date) : null
      },
      zones,
      cropProfile: evalOut.profile,
      activeStageStandard: evalOut.stageStandard,
      activeStandardVersion: evalOut.activeStandardVersion,
      pendingProposedVersions: evalOut.pendingProposedVersions,
      telemetryEvaluation: {
        dataSource: evalOut.dataSource,
        ageSeconds: latestTel.ageSeconds,
        computedVpdKpa: evalOut.computedVpdKpa,
        conditionChecks: evalOut.conditionChecks,
        livePreviewRecommendations: evalOut.recommendations
      },
      safetyStatus: {
        effectiveEnvelope: safetyEnvelope,
        cumulativePumpSecondsLast24h: pumpRuntime.cumulativePumpSecondsLast24h,
        secondsSinceLastPumpRun: pumpRuntime.secondsSinceLastPumpRun
      },
      policies,
      recommendations,
      decisions,
      verifications,
      learningRecords
    });
  });

  // ------------------------------------------------------------------
  // 3. UPDATE ACTIVE CROP, VARIETY & GROWTH STAGE
  // ------------------------------------------------------------------

  app.patch('/api/greenhouses/:greenhouseId/crop-stage', async (req, res) => {
    await platformDb.init();
    const ghId = req.params.greenhouseId;
    const user = ensureOperatorAccess(req, res, ghId, 'update_crop_growth_stage');
    if (!user) return;

    const { driver, cropEngine } = getEngines();
    const requestedCrop = String(req.body?.cropCode || req.body?.cropType || '').trim();
    const requestedVariety = req.body?.variety ? String(req.body.variety).trim() : null;
    const rawStage = String(req.body?.growthStage || 'vegetative').trim().toLowerCase();

    if (!CANONICAL_GROWTH_STAGES.includes(rawStage as CanonicalGrowthStage)) {
      return res.status(400).json({
        error: 'INVALID_GROWTH_STAGE',
        message: `Growth stage must be one of: ${CANONICAL_GROWTH_STAGES.join(', ')}.`
      });
    }

    const profile = cropEngine.resolveProfileForCrop(requestedCrop || 'tomato', requestedVariety);
    const plantingDate = req.body?.plantingDate ? String(req.body.plantingDate).slice(0, 10) : null;
    const zoneId = req.body?.zoneId && req.body.zoneId !== 'all' ? String(req.body.zoneId) : null;
    const nowIso = new Date().toISOString();

    driver.runInTransaction(() => {
      driver.run(
        `UPDATE greenhouses
         SET crop_type = ?, active_crop_variety = ?, active_growth_stage = ?, updated_at = ?
         WHERE id = ?`,
        [profile.commonName, profile.variety, rawStage, nowIso, ghId],
        false
      );

      if (zoneId) {
        driver.run(
          `UPDATE greenhouse_zones
           SET active_crop_type = ?, active_crop_variety = ?, crop_profile_id = ?,
               growth_stage = ?, planting_date = COALESCE(?, planting_date), updated_at = ?
           WHERE id = ? AND greenhouse_id = ?`,
          [profile.commonName, profile.variety, profile.id, rawStage, plantingDate, nowIso, zoneId, ghId],
          false
        );
      } else {
        driver.run(
          `UPDATE greenhouse_zones
           SET active_crop_type = ?, active_crop_variety = ?, crop_profile_id = ?,
               growth_stage = ?, planting_date = COALESCE(?, planting_date), updated_at = ?
           WHERE greenhouse_id = ? AND is_primary = 1`,
          [profile.commonName, profile.variety, profile.id, rawStage, plantingDate, nowIso, ghId],
          false
        );
      }
    });

    platformDb.recordAuditEvent({
      greenhouseId: ghId,
      actorUserId: user.id,
      eventType: 'CROP_GROWTH_STAGE_UPDATED',
      summary: `Set active crop to ${profile.commonName} (${profile.variety}) at ${rawStage} stage.`,
      metadata: {
        cropCode: profile.cropCode,
        variety: profile.variety,
        growthStage: rawStage,
        zoneId
      },
      ipAddress: extractClientIp(req)
    });

    const stageStd = profile.stages.find((s) => s.stageName === rawStage) || profile.stages[0];
    return res.json({
      success: true,
      profile,
      activeStageStandard: stageStd
    });
  });

  // ------------------------------------------------------------------
  // 4. EVALUATE CONDITIONS & GENERATE 8-POINT RECOMMENDATIONS
  // ------------------------------------------------------------------

  app.post('/api/greenhouses/:greenhouseId/recommendations/evaluate', async (req, res) => {
    await platformDb.init();
    const user = ensureAuth(req, res);
    if (!user) return;

    const ghId = req.params.greenhouseId;
    const gh = platformDb.getGreenhouseForUser(ghId, user.id);
    if (!gh) {
      return res.status(403).json({
        error: 'FORBIDDEN_GREENHOUSE',
        message: 'You do not have permission to evaluate this greenhouse.'
      });
    }

    const { driver, cropEngine, controlLoop } = getEngines();
    const ghMeta = driver.queryOne<any>(
      'SELECT crop_type, active_crop_variety, active_growth_stage, authorization_mode FROM greenhouses WHERE id = ?',
      [ghId]
    );
    const zoneId = req.body?.zoneId && req.body.zoneId !== 'all' ? String(req.body.zoneId) : null;
    const zoneRow = zoneId
      ? driver.queryOne<any>('SELECT * FROM greenhouse_zones WHERE id = ? AND greenhouse_id = ?', [zoneId, ghId])
      : driver.queryOne<any>(
          'SELECT * FROM greenhouse_zones WHERE greenhouse_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 1',
          [ghId]
        );

    const cropName = String(
      req.body?.cropType || zoneRow?.active_crop_type || ghMeta?.crop_type || gh.cropType || 'Tomato'
    );
    const variety =
      req.body?.variety ||
      zoneRow?.active_crop_variety ||
      ghMeta?.active_crop_variety ||
      null;
    const growthStage = String(
      req.body?.growthStage || zoneRow?.growth_stage || ghMeta?.active_growth_stage || 'vegetative'
    );

    // Honest data provenance: NEVER disguise simulated sandbox inputs as REAL_HARDWARE!
    const useSimulationSandbox = req.body?.useSimulationSandbox === true && req.body?.simulationTelemetry;
    const latestTel = platformDb.getLatestTelemetryForGreenhouse(ghId, Date.now(), zoneId ? { zoneId } : undefined);

    const telemetrySnapshot = useSimulationSandbox
      ? {
          dataSource: 'SIMULATED' as const,
          ageSeconds: 0,
          temperature:
            typeof req.body.simulationTelemetry.temperature === 'number'
              ? req.body.simulationTelemetry.temperature
              : null,
          humidity:
            typeof req.body.simulationTelemetry.humidity === 'number'
              ? req.body.simulationTelemetry.humidity
              : null,
          soilMoisture:
            typeof req.body.simulationTelemetry.soilMoisture === 'number'
              ? req.body.simulationTelemetry.soilMoisture
              : null,
          waterLevel:
            typeof req.body.simulationTelemetry.waterLevel === 'number'
              ? req.body.simulationTelemetry.waterLevel
              : null,
          sunlight:
            typeof req.body.simulationTelemetry.sunlight === 'number'
              ? req.body.simulationTelemetry.sunlight
              : null,
          rain:
            typeof req.body.simulationTelemetry.rain === 'boolean'
              ? req.body.simulationTelemetry.rain
              : null,
          actuators: req.body.simulationTelemetry.actuators || null
        }
      : {
          dataSource: latestTel.dataSource === 'CACHED' ? 'STALE' : latestTel.dataSource,
          ageSeconds: latestTel.ageSeconds,
          temperature: latestTel.readings?.temperature ?? null,
          humidity: latestTel.readings?.humidity ?? null,
          soilMoisture: latestTel.readings?.soilMoisture ?? null,
          waterLevel: latestTel.readings?.waterLevel ?? null,
          sunlight: latestTel.readings?.sunlight ?? null,
          rain: latestTel.readings?.rain ?? null,
          actuators: latestTel.actuators ?? null
        };

    const canPersist = !user.isGuest && (gh.role === 'owner' || gh.role === 'operator');
    const evaluation = cropEngine.evaluateConditionsAndRecommend({
      greenhouseId: ghId,
      zoneId: zoneRow ? String(zoneRow.id) : null,
      cropNameOrCode: cropName,
      variety,
      growthStage,
      telemetrySnapshot,
      persistRecommendations: canPersist
    });

    // Check Mode 2 / Mode 3 bounded policy auto-execution (SIMULATION_ONLY!) for verified farmers
    const autoExecutedSimulations: any[] = [];
    if (canPersist && evaluation.recommendations.length > 0) {
      const devices = platformDb.listDevicesForGreenhouse(ghId);
      const ctrlDev =
        devices.find((d) => d.deviceType === 'esp32_controller' && !d.replacedByDeviceId) || devices[0];

      if (ctrlDev) {
        for (const rec of evaluation.recommendations) {
          if (!rec.id) continue;
          const policyMatch = controlLoop.findMatchingAutomationPolicy({
            greenhouseId: ghId,
            zoneId: zoneRow ? String(zoneRow.id) : null,
            cropCode: evaluation.profile.cropCode,
            cropCommonName: evaluation.profile.commonName,
            targetEquipment: rec.proposedAction.targetEquipment,
            commandType: rec.proposedAction.commandType,
            nowDate: req.body?.evaluationTimestampIso ? new Date(req.body.evaluationTimestampIso) : new Date()
          });

          if (policyMatch.matchedPolicy) {
            const boundedDuration = Math.min(
              rec.proposedAction.durationSeconds,
              policyMatch.matchedPolicy.maxDurationSeconds
            );
            const safetyGate = controlLoop.evaluateRuntimeSafetyGates({
              greenhouseId: ghId,
              targetEquipment: rec.proposedAction.targetEquipment,
              desiredState: rec.proposedAction.desiredState,
              durationSeconds: boundedDuration,
              policyMaxDurationSeconds: policyMatch.matchedPolicy.maxDurationSeconds,
              policyCooldownSeconds: policyMatch.matchedPolicy.cooldownSeconds,
              policyMaxDailyCumulativeSeconds: policyMatch.matchedPolicy.maxDailyCumulativeSeconds,
              manualOverrides: req.body?.manualOverrides,
              telemetrySnapshot
            });

            if (safetyGate.allowed) {
              const simLoop = controlLoop.executeSimulationOnlyClosedLoop({
                greenhouseId: ghId,
                zoneId: zoneRow ? String(zoneRow.id) : null,
                deviceId: ctrlDev.id,
                recommendationId: rec.id,
                authorizedByUserId: policyMatch.matchedPolicy.createdByUserId || user.id,
                authorizationMode: policyMatch.greenhouseMode,
                policyId: policyMatch.matchedPolicy.id,
                targetEquipment: rec.proposedAction.targetEquipment,
                commandType: rec.proposedAction.commandType,
                desiredState: rec.proposedAction.desiredState,
                durationSeconds: boundedDuration,
                telemetrySnapshot,
                cropName: evaluation.profile.commonName,
                growthStage: evaluation.stageStandard.stageName
              });
              autoExecutedSimulations.push({
                recommendationId: rec.id,
                policyId: policyMatch.matchedPolicy.id,
                authorizationMode: policyMatch.greenhouseMode,
                simulation: simLoop
              });
            }
          }
        }
      }
    }

    return res.json({
      success: true,
      physicalExecutionEnabled: PHASE3_PHYSICAL_EXECUTION_ENABLED,
      actuationCommandsSent: 0,
      dataSource: evaluation.dataSource,
      computedVpdKpa: evaluation.computedVpdKpa,
      profile: evaluation.profile,
      stageStandard: evaluation.stageStandard,
      conditionChecks: evaluation.conditionChecks,
      recommendations: evaluation.recommendations,
      autoExecutedSimulations
    });
  });

  // ------------------------------------------------------------------
  // 5. FARMER RECOMMENDATION DECISION (APPROVE / REJECT / MODIFY)
  // ------------------------------------------------------------------

  app.post('/api/greenhouses/:greenhouseId/recommendations/:recommendationId/decision', async (req, res) => {
    await platformDb.init();
    const ghId = req.params.greenhouseId;
    const recId = req.params.recommendationId;
    const user = ensureOperatorAccess(req, res, ghId, 'recommendation_decision');
    if (!user) return;

    const { driver, repos, controlLoop } = getEngines();
    const recRow = driver.queryOne<any>(
      'SELECT * FROM ai_recommendations WHERE id = ? AND greenhouse_id = ?',
      [recId, ghId]
    );
    if (!recRow) {
      return res.status(404).json({
        error: 'RECOMMENDATION_NOT_FOUND',
        message: 'Recommendation not found for this greenhouse.'
      });
    }

    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (!['approve', 'reject', 'modify'].includes(decision)) {
      return res.status(400).json({
        error: 'INVALID_DECISION',
        message: 'Decision must be one of: approve, reject, modify.'
      });
    }

    const rationale = req.body?.rationale ? String(req.body.rationale).trim().slice(0, 400) : undefined;

    if (decision === 'reject') {
      const dec = repos.authorizationAndCommands.recordFarmerDecision({
        greenhouseId: ghId,
        actorUserId: user.id,
        recommendationId: recId,
        decision: 'reject',
        rationale: rationale || 'Rejected by farmer'
      });

      platformDb.recordAuditEvent({
        greenhouseId: ghId,
        actorUserId: user.id,
        eventType: 'RECOMMENDATION_REJECTED',
        summary: `Farmer rejected AI recommendation ${recId} (${recRow.category}).`,
        metadata: { recommendationId: recId, rationale },
        ipAddress: extractClientIp(req)
      });

      return res.json({
        success: true,
        decision: 'reject',
        decisionId: dec.decisionId,
        physicalHardwareDispatched: false,
        actuationCommandsSent: 0
      });
    }

    // Approve or Modify -> Validate parameters against Tier 1 + Runtime Two-Tier Safety Gates
    const proposedAction = safeParseJson<Record<string, any>>(recRow.proposed_action_json, {});
    const targetEquipment = String(proposedAction.targetEquipment || 'pump');
    const commandType = String(proposedAction.commandType || recRow.category || 'BOUNDED_ACTION');
    const desiredState = String(proposedAction.desiredState || 'on');

    const requestedDuration =
      decision === 'modify' && typeof req.body?.modifiedDurationSeconds === 'number'
        ? Number(req.body.modifiedDurationSeconds)
        : Number(proposedAction.durationSeconds || 20);

    const tier1Check = validateFarmerPolicyAgainstTier1({
      equipmentKey: targetEquipment,
      maxDurationSeconds: requestedDuration
    });
    if (!tier1Check.valid) {
      return res.status(422).json({
        error: 'TIER1_SAFETY_OVERRIDE_REJECTED',
        message: tier1Check.violations[0].message,
        violations: tier1Check.violations,
        physicalHardwareDispatched: false
      });
    }

    const latestTel = platformDb.getLatestTelemetryForGreenhouse(ghId);
    const recEvidence = safeParseJson<Record<string, any>>(recRow.evidence_json, {});
    const recDataSource = String(recRow.data_source || 'DISCONNECTED') as
      | 'REAL_HARDWARE'
      | 'STALE'
      | 'DISCONNECTED'
      | 'SIMULATED';

    const telemetrySnapshot =
      recDataSource === 'SIMULATED' && !latestTel.exists
        ? {
            dataSource: 'SIMULATED' as const,
            ageSeconds: 0,
            temperature: typeof recEvidence.temperatureC === 'number' ? recEvidence.temperatureC : 26,
            humidity: typeof recEvidence.humidityPct === 'number' ? recEvidence.humidityPct : 65,
            soilMoisture: typeof recEvidence.soilMoisturePct === 'number' ? recEvidence.soilMoisturePct : 44,
            waterLevel: typeof recEvidence.waterLevelPct === 'number' ? recEvidence.waterLevelPct : 75,
            rain: typeof recEvidence.rainDetected === 'boolean' ? recEvidence.rainDetected : false
          }
        : {
            dataSource: latestTel.dataSource === 'CACHED' ? 'STALE' : latestTel.dataSource,
            ageSeconds: latestTel.ageSeconds,
            temperature: latestTel.readings?.temperature ?? null,
            humidity: latestTel.readings?.humidity ?? null,
            soilMoisture: latestTel.readings?.soilMoisture ?? null,
            waterLevel: latestTel.readings?.waterLevel ?? null,
            rain: latestTel.readings?.rain ?? null
          };

    const safetyGate = controlLoop.evaluateRuntimeSafetyGates({
      greenhouseId: ghId,
      targetEquipment,
      desiredState,
      durationSeconds: requestedDuration,
      manualOverrides: req.body?.manualOverrides,
      telemetrySnapshot
    });

    if (!safetyGate.allowed) {
      platformDb.recordAuditEvent({
        greenhouseId: ghId,
        actorUserId: user.id,
        eventType: 'SAFETY_INTERLOCK_BLOCKED_ACTION',
        summary: `Two-Tier Safety blocked ${targetEquipment} action (${safetyGate.code}): ${safetyGate.reason}`,
        metadata: {
          recommendationId: recId,
          code: safetyGate.code,
          tierTriggered: safetyGate.tierTriggered
        },
        ipAddress: extractClientIp(req)
      });

      return res.status(409).json({
        error: 'SAFETY_INTERLOCK_BLOCKED',
        code: safetyGate.code,
        message: safetyGate.reason,
        safetyGate,
        physicalHardwareDispatched: false,
        actuationCommandsSent: 0
      });
    }

    const decRecord = repos.authorizationAndCommands.recordFarmerDecision({
      greenhouseId: ghId,
      actorUserId: user.id,
      recommendationId: recId,
      decision: decision as 'approve' | 'modify',
      modifiedParameters: decision === 'modify' ? { durationSeconds: requestedDuration } : {},
      rationale: rationale || `Farmer ${decision}d recommendation for simulation-only verification`
    });

    const devices = platformDb.listDevicesForGreenhouse(ghId);
    const ctrlDev =
      devices.find((d) => d.deviceType === 'esp32_controller' && !d.replacedByDeviceId) || devices[0];

    const ghRow = driver.queryOne<{ authorization_mode: string; crop_type: string }>(
      'SELECT authorization_mode, crop_type FROM greenhouses WHERE id = ?',
      [ghId]
    );

    const simulation = controlLoop.executeSimulationOnlyClosedLoop({
      greenhouseId: ghId,
      zoneId: recRow.zone_id ? String(recRow.zone_id) : null,
      deviceId: ctrlDev.id,
      recommendationId: recId,
      authorizedByUserId: user.id,
      authorizationMode: (ghRow?.authorization_mode as AuthorizationMode) || 'mode_1_individual',
      decisionId: decRecord.decisionId,
      targetEquipment,
      commandType,
      desiredState,
      durationSeconds: requestedDuration,
      telemetrySnapshot,
      cropName: String(ghRow?.crop_type || 'Tomato'),
      growthStage: String(recRow.growth_stage || 'vegetative')
    });

    platformDb.recordAuditEvent({
      greenhouseId: ghId,
      actorUserId: user.id,
      eventType: 'CLOSED_LOOP_SIMULATION_EXECUTED',
      summary: `Farmer ${decision}d recommendation ${recId}; verified in SimulationExecutionAdapter (0 physical commands sent).`,
      metadata: {
        recommendationId: recId,
        decisionId: decRecord.decisionId,
        commandId: simulation.commandId,
        verificationId: simulation.verificationId,
        physicalHardwareDispatched: false
      },
      ipAddress: extractClientIp(req)
    });

    return res.json({
      success: true,
      decision,
      decisionId: decRecord.decisionId,
      safetyGate,
      simulation,
      physicalHardwareDispatched: false,
      actuationCommandsSent: 0
    });
  });

  // ------------------------------------------------------------------
  // 6. VERSIONED CROP STANDARD PROPOSALS & FARMER APPROVAL GUARD
  // ------------------------------------------------------------------

  app.post('/api/greenhouses/:greenhouseId/crop-standards/propose', async (req, res) => {
    await platformDb.init();
    const ghId = req.params.greenhouseId;
    const user = ensureOperatorAccess(req, res, ghId, 'propose_crop_standard_change');
    if (!user) return;

    const thresholds = req.body?.thresholds;
    if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) {
      return res.status(400).json({
        error: 'INVALID_THRESHOLDS',
        message: 'Provide a thresholds object (e.g. tempMinC, tempMaxC, soilMoistureMinPct).'
      });
    }

    // Proposed changes ALWAYS enter status='proposed' and NEVER silently overwrite active standards!
    const created = platformDb.repositories.cropKnowledge.createCropStandardVersion({
      greenhouseId: ghId,
      zoneId: req.body?.zoneId || null,
      cropProfileId: req.body?.cropProfileId || null,
      thresholds,
      evidence: req.body?.evidence || { note: 'Proposed crop threshold refinement awaiting farmer review' },
      references: Array.isArray(req.body?.references) ? req.body.references : [],
      proposedBy: req.body?.proposedBy ? String(req.body.proposedBy).slice(0, 80) : `farmer:${user.email}`,
      activateImmediatelyWithApprover: null
    });

    platformDb.recordAuditEvent({
      greenhouseId: ghId,
      actorUserId: user.id,
      eventType: 'CROP_STANDARD_PROPOSED',
      summary: `Proposed crop standard v${created.versionNumber} (awaiting explicit farmer approval).`,
      metadata: { versionId: created.id, versionNumber: created.versionNumber },
      ipAddress: extractClientIp(req)
    });

    return res.status(201).json({
      success: true,
      standardVersion: created
    });
  });

  app.post('/api/greenhouses/:greenhouseId/crop-standards/:versionId/review', async (req, res) => {
    await platformDb.init();
    const ghId = req.params.greenhouseId;
    const versionId = req.params.versionId;
    const user = ensureOperatorAccess(req, res, ghId, 'review_crop_standard_change');
    if (!user) return;

    const { driver, repos } = getEngines();
    const target = driver.queryOne<any>(
      'SELECT * FROM crop_standard_versions WHERE id = ? AND greenhouse_id = ?',
      [versionId, ghId]
    );
    if (!target) {
      return res.status(404).json({
        error: 'STANDARD_VERSION_NOT_FOUND',
        message: 'Crop standard version not found.'
      });
    }

    const action = String(req.body?.action || '').trim().toLowerCase();
    if (!['approve', 'reject', 'rollback'].includes(action)) {
      return res.status(400).json({
        error: 'INVALID_REVIEW_ACTION',
        message: 'Action must be one of: approve, reject, rollback.'
      });
    }

    const nowIso = new Date().toISOString();

    if (action === 'reject') {
      driver.run(
        "UPDATE crop_standard_versions SET status = 'rejected' WHERE id = ? AND greenhouse_id = ?",
        [versionId, ghId]
      );
      platformDb.recordAuditEvent({
        greenhouseId: ghId,
        actorUserId: user.id,
        eventType: 'CROP_STANDARD_REJECTED',
        summary: `Rejected proposed crop standard v${target.version_number}. Active standards unchanged.`,
        metadata: { versionId },
        ipAddress: extractClientIp(req)
      });
      return res.json({ success: true, status: 'rejected', versionId });
    }

    if (action === 'approve') {
      driver.runInTransaction(() => {
        driver.run(
          "UPDATE crop_standard_versions SET status = 'superseded' WHERE greenhouse_id = ? AND status = 'active'",
          [ghId],
          false
        );
        driver.run(
          `UPDATE crop_standard_versions
           SET status = 'active', approved_by_user_id = ?, activated_at = ?
           WHERE id = ? AND greenhouse_id = ?`,
          [user.id, nowIso, versionId, ghId],
          false
        );
      });
      platformDb.recordAuditEvent({
        greenhouseId: ghId,
        actorUserId: user.id,
        eventType: 'CROP_STANDARD_APPROVED',
        summary: `Farmer approved crop standard v${target.version_number} as active.`,
        metadata: { versionId },
        ipAddress: extractClientIp(req)
      });
      return res.json({ success: true, status: 'active', versionId });
    }

    // rollback -> clone target version's thresholds into a fresh active version
    const rolledBack = repos.cropKnowledge.createCropStandardVersion({
      greenhouseId: ghId,
      zoneId: target.zone_id ? String(target.zone_id) : null,
      cropProfileId: target.crop_profile_id ? String(target.crop_profile_id) : null,
      thresholds: safeParseJson(target.thresholds_json, {}),
      evidence: { rollbackToVersionNumber: Number(target.version_number) },
      references: safeParseJson(target.references_json, []),
      proposedBy: `rollback:${user.email}`,
      activateImmediatelyWithApprover: user.id,
      rollbackOfVersionId: versionId
    });

    platformDb.recordAuditEvent({
      greenhouseId: ghId,
      actorUserId: user.id,
      eventType: 'CROP_STANDARD_ROLLED_BACK',
      summary: `Rolled back active crop thresholds to v${target.version_number} (new v${rolledBack.versionNumber}).`,
      metadata: { targetVersionId: versionId, newVersionId: rolledBack.id },
      ipAddress: extractClientIp(req)
    });

    return res.json({
      success: true,
      status: 'active',
      standardVersion: rolledBack
    });
  });

  // ------------------------------------------------------------------
  // 7. 3-MODE AUTHORIZATION & TWO-TIER SAFETY POLICY MANAGEMENT
  // ------------------------------------------------------------------

  app.patch('/api/greenhouses/:greenhouseId/authorization-mode', async (req, res) => {
    await platformDb.init();
    const ghId = req.params.greenhouseId;
    const user = ensureOperatorAccess(req, res, ghId, 'update_authorization_mode');
    if (!user) return;

    const { driver, repos } = getEngines();
    const rawMode = String(req.body?.authorizationMode || 'mode_1_individual').trim() as AuthorizationMode;
    if (!VALID_AUTH_MODES.has(rawMode)) {
      return res.status(400).json({
        error: 'INVALID_AUTHORIZATION_MODE',
        message: 'Mode must be mode_1_individual, mode_2_limited, or mode_3_advanced.'
      });
    }

    const policyOverrides = req.body?.policyDefaults;
    if (policyOverrides && typeof policyOverrides === 'object') {
      const validation = validateFarmerPolicyAgainstTier1({
        maxIndividualIrrigationPulseSeconds: policyOverrides.maxIndividualIrrigationPulseSeconds,
        waterLevelIrrigationLockPct: policyOverrides.waterLevelIrrigationLockPct,
        heaterOperatingLockTempC: policyOverrides.heaterOperatingLockTempC,
        minPumpCooldownSeconds: policyOverrides.minPumpCooldownSeconds,
        maxDailyCumulativePumpSeconds: policyOverrides.maxDailyCumulativePumpSeconds,
        allowRoofOpenDuringRain: policyOverrides.allowRoofOpenDuringRain
      });
      if (!validation.valid) {
        return res.status(422).json({
          error: 'TIER1_SAFETY_OVERRIDE_REJECTED',
          message: validation.violations[0].message,
          violations: validation.violations
        });
      }
    }

    const currentEnvelope = repos.authorizationAndCommands.getGreenhouseSafetyEnvelope(ghId);
    const nextEnvelope = resolveEffectiveSafetyEnvelope(
      policyOverrides ? { ...currentEnvelope.policyDefaults, ...policyOverrides } : currentEnvelope.policyDefaults,
      currentEnvelope.hardwareProtection
    );

    const nowIso = new Date().toISOString();
    driver.run(
      `UPDATE greenhouses
       SET authorization_mode = ?, safety_defaults_json = ?, updated_at = ?
       WHERE id = ?`,
      [rawMode, JSON.stringify(nextEnvelope), nowIso, ghId]
    );

    platformDb.recordAuditEvent({
      greenhouseId: ghId,
      actorUserId: user.id,
      eventType: 'AUTHORIZATION_MODE_UPDATED',
      summary: `Set farmer authorization mode to ${rawMode}.`,
      metadata: { authorizationMode: rawMode, policyDefaults: nextEnvelope.policyDefaults },
      ipAddress: extractClientIp(req)
    });

    return res.json({
      success: true,
      authorizationMode: rawMode,
      effectiveSafetyEnvelope: nextEnvelope
    });
  });

  app.post('/api/greenhouses/:greenhouseId/authorization-policies', async (req, res) => {
    await platformDb.init();
    const ghId = req.params.greenhouseId;
    const user = ensureOperatorAccess(req, res, ghId, 'create_authorization_policy');
    if (!user) return;

    const rawMode = String(req.body?.mode || 'mode_2_limited').trim() as AuthorizationMode;
    if (!VALID_AUTH_MODES.has(rawMode)) {
      return res.status(400).json({
        error: 'INVALID_AUTHORIZATION_MODE',
        message: 'Policy mode must be mode_1_individual, mode_2_limited, or mode_3_advanced.'
      });
    }

    const equipmentKey = String(req.body?.equipmentKey || 'pump').trim().slice(0, 80);
    const maxDurationSeconds =
      typeof req.body?.maxDurationSeconds === 'number' ? Number(req.body.maxDurationSeconds) : undefined;

    const tier1Validation = validateFarmerPolicyAgainstTier1({
      equipmentKey,
      maxDurationSeconds,
      waterLevelIrrigationLockPct: req.body?.thresholds?.waterLevelMinPct,
      heaterOperatingLockTempC: req.body?.thresholds?.heaterMaxTempC,
      allowRoofOpenDuringRain: req.body?.operatingConditions?.allowRoofOpenDuringRain
    });

    if (!tier1Validation.valid) {
      return res.status(422).json({
        error: 'TIER1_SAFETY_OVERRIDE_REJECTED',
        message: tier1Validation.violations[0].message,
        violations: tier1Validation.violations
      });
    }

    const expiresInHours =
      typeof req.body?.expiresInHours === 'number' && req.body.expiresInHours > 0
        ? Math.min(8760, req.body.expiresInHours)
        : 168; // Default 7-day policy review window
    const expiresAt = new Date(Date.now() + expiresInHours * 3_600_000).toISOString();

    const policy = platformDb.repositories.authorizationAndCommands.createAuthorizationPolicy({
      greenhouseId: ghId,
      zoneId: req.body?.zoneId && req.body.zoneId !== 'all' ? String(req.body.zoneId) : null,
      mode: rawMode,
      cropType: String(req.body?.cropType || '*').trim().slice(0, 60),
      equipmentKey,
      permittedAction: String(req.body?.permittedAction || '*').trim().slice(0, 80),
      thresholds: req.body?.thresholds && typeof req.body.thresholds === 'object' ? req.body.thresholds : {},
      maxDurationSeconds,
      cooldownSeconds:
        typeof req.body?.cooldownSeconds === 'number' ? Number(req.body.cooldownSeconds) : undefined,
      maxDailyCumulativeSeconds:
        typeof req.body?.maxDailyCumulativeSeconds === 'number'
          ? Number(req.body.maxDailyCumulativeSeconds)
          : undefined,
      operatingConditions:
        req.body?.operatingConditions && typeof req.body.operatingConditions === 'object'
          ? req.body.operatingConditions
          : {},
      expiresAt,
      createdByUserId: user.id
    });

    platformDb.recordAuditEvent({
      greenhouseId: ghId,
      actorUserId: user.id,
      eventType: 'AUTHORIZATION_POLICY_CREATED',
      summary: `Created ${rawMode} policy (${policy.id}) for equipment "${equipmentKey}" (max ${policy.maxDurationSeconds}s).`,
      metadata: { policyId: policy.id, mode: rawMode, equipmentKey },
      ipAddress: extractClientIp(req)
    });

    return res.status(201).json({
      success: true,
      policy
    });
  });

  app.post('/api/greenhouses/:greenhouseId/authorization-policies/:policyId/revoke', async (req, res) => {
    await platformDb.init();
    const ghId = req.params.greenhouseId;
    const policyId = req.params.policyId;
    const user = ensureOperatorAccess(req, res, ghId, 'revoke_authorization_policy');
    if (!user) return;

    const { driver, repos } = getEngines();
    const nowIso = new Date().toISOString();
    const result = driver.run(
      `UPDATE farmer_authorization_policies
       SET status = 'revoked', revoked_by_user_id = ?, revoked_at = ?, updated_at = ?
       WHERE id = ? AND greenhouse_id = ?`,
      [user.id, nowIso, nowIso, policyId, ghId]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'POLICY_NOT_FOUND', message: 'Authorization policy not found.' });
    }

    repos.authorizationAndCommands.recordFarmerDecision({
      greenhouseId: ghId,
      actorUserId: user.id,
      policyId,
      decision: 'revoke',
      rationale: req.body?.rationale ? String(req.body.rationale) : 'Farmer revoked automation permission'
    });

    platformDb.recordAuditEvent({
      greenhouseId: ghId,
      actorUserId: user.id,
      eventType: 'AUTHORIZATION_POLICY_REVOKED',
      summary: `Revoked automation policy ${policyId}.`,
      metadata: { policyId },
      ipAddress: extractClientIp(req)
    });

    return res.json({ success: true, policyId, status: 'revoked' });
  });

  // ------------------------------------------------------------------
  // 8. EMERGENCY STOP (ENGAGE & EXPLICIT FARMER RESET)
  // ------------------------------------------------------------------

  app.post('/api/greenhouses/:greenhouseId/emergency-stop', async (req, res) => {
    await platformDb.init();
    const ghId = req.params.greenhouseId;
    const user = ensureOperatorAccess(req, res, ghId, 'toggle_emergency_stop');
    if (!user) return;

    const { driver, repos } = getEngines();
    const activate = req.body?.active !== false;
    const reason = String(req.body?.reason || 'Farmer activated Emergency Stop').trim().slice(0, 240);
    const nowIso = new Date().toISOString();

    if (activate) {
      const dec = repos.authorizationAndCommands.recordFarmerDecision({
        greenhouseId: ghId,
        actorUserId: user.id,
        decision: 'emergency_stop',
        rationale: reason
      });
      driver.run(
        'UPDATE greenhouses SET emergency_stop_by_user_id = ? WHERE id = ?',
        [user.id, ghId]
      );

      platformDb.recordAuditEvent({
        greenhouseId: ghId,
        actorUserId: user.id,
        eventType: 'EMERGENCY_STOP_ACTIVATED',
        summary: `EMERGENCY STOP ACTIVATED: ${reason}`,
        metadata: { decisionId: dec.decisionId, reason },
        ipAddress: extractClientIp(req)
      });

      return res.json({
        success: true,
        emergencyStopActive: true,
        reason,
        activatedAt: nowIso
      });
    }

    if (req.body?.confirmReset !== true) {
      return res.status(400).json({
        error: 'CONFIRM_RESET_REQUIRED',
        message: 'Clearing Emergency Stop requires confirmReset: true after verifying greenhouse safety.'
      });
    }

    driver.run(
      `UPDATE greenhouses
       SET emergency_stop_active = 0, emergency_stop_reason = NULL, emergency_stop_at = NULL,
           emergency_stop_by_user_id = NULL, updated_at = ?
       WHERE id = ?`,
      [nowIso, ghId]
    );

    platformDb.recordAuditEvent({
      greenhouseId: ghId,
      actorUserId: user.id,
      eventType: 'EMERGENCY_STOP_CLEARED',
      summary: 'Farmer verified greenhouse safety and cleared Emergency Stop.',
      metadata: {},
      ipAddress: extractClientIp(req)
    });

    return res.json({
      success: true,
      emergencyStopActive: false,
      clearedAt: nowIso
    });
  });
}
