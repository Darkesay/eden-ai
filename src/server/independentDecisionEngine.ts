import { GoogleGenAI } from '@google/genai';
import type { PlatformDatabase } from './database.ts';
import { CropIntelligenceEngine } from './cropIntelligenceEngine.ts';
import { AgriculturalKnowledgeBaseService, type DiagnosticKnowledgeCard } from './agriculturalKnowledgeBase.ts';
import { DeepLearningPipelineService } from './deepLearningPipeline.ts';
import {
  AuthorizedControlLoopService,
  PHASE3_PHYSICAL_EXECUTION_ENABLED
} from './authorizedControlLoop.ts';
import { calculateVpdKpa } from './repositories.ts';
import { isPlaceholderOrEmptySecret, redactSecretsFromText } from './telemetryContract.ts';

export interface ExplainableTenPointRecommendation {
  id: string;
  category: string;
  observation: string;
  evidence: {
    dataSource: 'REAL_HARDWARE' | 'STALE' | 'DISCONNECTED' | 'SIMULATED';
    observedMetrics: Record<string, number | boolean | string | null>;
    historicalContext: string;
    plantVisionSummary: string | null;
    sensorAnomaliesDetected: Array<{ channel: string; value: number; zScore: number; reason: string }>;
  };
  cropAndGrowthStageContext: {
    cropCode: string;
    commonName: string;
    variety: string;
    growthStage: string;
    daysAfterPlanting: number | null;
    stageTargetSummary: string;
  };
  recommendedAction: {
    summary: string;
    targetEquipment: string | null;
    proposedParameters: Record<string, unknown>;
    physicalExecutionAllowedNow: false;
  };
  reasoning: string;
  confidence: {
    score: number;
    meaningful: boolean;
    label: string;
    basis: string;
  };
  risk: {
    level: 'low' | 'medium' | 'high' | 'critical';
    inactionRisk: string;
    actionSideEffectRisk: string;
  };
  expectedOutcome: {
    targetMetric: string;
    expectedDeltaRange: string;
    verificationWindowSeconds: number;
  };
  missingInformation: string[];
  sourceReferences: string[];
  authorizationStatus: {
    activeFarmerMode: 'MODE_1' | 'MODE_2' | 'MODE_3';
    modeInternalCode: string;
    gateDecision:
      | 'REQUIRES_INDIVIDUAL_FARMER_APPROVAL'
      | 'ELIGIBLE_FOR_BOUNDED_POLICY_SIMULATION'
      | 'BLOCKED_BY_SAFETY_INTERLOCK'
      | 'ADVISORY_ONLY_NO_ACTUATOR';
    safetyGateReason: string;
    physicalHardwareDispatched: false;
  };
}

export interface ExternalReasoningProvider {
  readonly providerId: string;
  isAvailable(): boolean;
  enrichNarrative(context: {
    cropName: string;
    growthStage: string;
    dataSource: string;
    recommendationsCount: number;
    headlineSummaries: string[];
  }): Promise<{ enrichedSummary: string | null; modelUsed: string | null; fallbackReason: string | null }>;
}

export class LocalDeterministicProvider implements ExternalReasoningProvider {
  public readonly providerId = 'edens_local_deterministic_v1';

  public isAvailable(): boolean {
    return true;
  }

  public async enrichNarrative(context: {
    cropName: string;
    growthStage: string;
    dataSource: string;
    recommendationsCount: number;
    headlineSummaries: string[];
  }): Promise<{ enrichedSummary: string | null; modelUsed: string | null; fallbackReason: string | null }> {
    const summary =
      context.recommendationsCount === 0
        ? `${context.cropName} (${context.growthStage} stage) readings from ${context.dataSource} are within published FAO/NIHORT target bounds.`
        : `Generated ${context.recommendationsCount} independent agronomic recommendation(s) for ${context.cropName} (${context.growthStage}) using verified local rules and telemetry (${context.dataSource}): ${context.headlineSummaries.join(' | ')}`;
    return {
      enrichedSummary: summary,
      modelUsed: 'edens-deterministic-agronomy-engine-1.0',
      fallbackReason: null
    };
  }
}

export class OptionalGeminiReasoningProvider implements ExternalReasoningProvider {
  public readonly providerId = 'optional_google_gemini';

  public isAvailable(): boolean {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    return Boolean(key) && !isPlaceholderOrEmptySecret(key);
  }

  public async enrichNarrative(context: {
    cropName: string;
    growthStage: string;
    dataSource: string;
    recommendationsCount: number;
    headlineSummaries: string[];
  }): Promise<{ enrichedSummary: string | null; modelUsed: string | null; fallbackReason: string | null }> {
    if (!this.isAvailable()) {
      return {
        enrichedSummary: null,
        modelUsed: null,
        fallbackReason: 'GEMINI_API_KEY not configured; operating 100% on EDENS AI independent engine.'
      };
    }

    try {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Summarize these verified greenhouse agronomy findings in 2 concise sentences for a farmer growing ${context.cropName} (${context.growthStage} stage, data source: ${context.dataSource}). Do not invent measurements:\n${context.headlineSummaries.join('\n')}`,
        config: {
          abortSignal: AbortSignal.timeout(8000)
        }
      });
      return {
        enrichedSummary: response.text?.trim() || null,
        modelUsed: 'gemini-3.8-flash',
        fallbackReason: null
      };
    } catch (err: any) {
      return {
        enrichedSummary: null,
        modelUsed: null,
        fallbackReason: redactSecretsFromText(err?.message || 'External LLM unavailable')
      };
    }
  }
}

function mapInternalModeToCanonicalLabel(internalMode: string): 'MODE_1' | 'MODE_2' | 'MODE_3' {
  if (internalMode === 'mode_3_advanced') return 'MODE_3';
  if (internalMode === 'mode_2_limited') return 'MODE_2';
  return 'MODE_1';
}

export class IndependentAgriculturalDecisionEngine {
  private readonly platformDb: PlatformDatabase;
  private readonly providers: Map<string, ExternalReasoningProvider> = new Map();

  constructor(platformDb: PlatformDatabase) {
    this.platformDb = platformDb;
    this.registerProvider(new LocalDeterministicProvider());
    this.registerProvider(new OptionalGeminiReasoningProvider());
  }

  public registerProvider(provider: ExternalReasoningProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  public listRegisteredProviders(): Array<{ providerId: string; available: boolean }> {
    return Array.from(this.providers.values()).map((p) => ({
      providerId: p.providerId,
      available: p.isAvailable()
    }));
  }

  public async evaluateGreenhouse(params: {
    greenhouseId: string;
    zoneId?: string | null;
    cropOverride?: string;
    varietyOverride?: string;
    growthStageOverride?: string;
    weatherContext?: {
      forecastSummary?: string;
      externalTempC?: number;
      externalRhPct?: number;
      rainExpectedNext3h?: boolean;
    } | null;
    simulatedSandboxReadings?: {
      temperature?: number | null;
      humidity?: number | null;
      soilMoisture?: number | null;
      waterLevel?: number | null;
      sunlight?: number | null;
      rain?: boolean | null;
    } | null;
    preferredExternalProviderId?: string | null;
  }): Promise<{
    independentEngineVersion: string;
    operatedWithoutExternalLlm: boolean;
    physicalActuationEnabled: false;
    greenhouseId: string;
    zoneId: string | null;
    dataSource: 'REAL_HARDWARE' | 'STALE' | 'DISCONNECTED' | 'SIMULATED';
    cropContext: {
      cropCode: string;
      commonName: string;
      variety: string;
      growthStage: string;
      daysAfterPlanting: number | null;
      validationStatus: string;
    };
    farmerAuthorization: {
      canonicalMode: 'MODE_1' | 'MODE_2' | 'MODE_3';
      internalMode: string;
      emergencyStopActive: boolean;
      activePoliciesCount: number;
    };
    matchedDiagnosticRisks: DiagnosticKnowledgeCard[];
    sensorAnomalies: Array<{ channel: string; value: number; zScore: number; reason: string }>;
    recommendations: ExplainableTenPointRecommendation[];
    narrativeSummary: {
      text: string;
      providerUsed: string;
      externalModelUsed: string | null;
      fallbackReason: string | null;
    };
  }> {
    const driver = this.platformDb.getDriver();
    const repos = this.platformDb.repositories;
    const cropEngine = new CropIntelligenceEngine(driver, repos);
    const kbService = new AgriculturalKnowledgeBaseService(driver, repos);
    const dlService = new DeepLearningPipelineService(driver);
    const controlLoop = new AuthorizedControlLoopService(driver, repos);

    cropEngine.ensureCatalogSeeded();
    kbService.ensureSeeded();

    const ghRow = driver.queryOne<{
      crop_type: string;
      emergency_stop_active: number;
      authorization_mode: string | null;
    }>(
      'SELECT crop_type, emergency_stop_active, authorization_mode FROM greenhouses WHERE id = ?',
      [params.greenhouseId]
    );
    const activeBatch = driver.queryOne<{
      crop_name: string;
      variety: string | null;
      current_stage: string;
      planting_date: string;
    }>(
      `SELECT crop_type AS crop_name, variety, current_growth_stage AS current_stage, planting_date
       FROM harvest_cycles
       WHERE greenhouse_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [params.greenhouseId]
    );

    const cropNameOrCode =
      params.cropOverride?.trim() || activeBatch?.crop_name || ghRow?.crop_type || 'Tomato';
    const variety = params.varietyOverride?.trim() || activeBatch?.variety || undefined;
    const growthStage = params.growthStageOverride?.trim() || activeBatch?.current_stage || 'vegetative';

    let daysAfterPlanting: number | null = null;
    if (activeBatch?.planting_date) {
      const plantedMs = Date.parse(activeBatch.planting_date);
      if (Number.isFinite(plantedMs)) {
        daysAfterPlanting = Math.max(0, Math.floor((Date.now() - plantedMs) / 86_400_000));
      }
    }

    // Resolve telemetry strictly without mixing simulated & real hardware data
    let dataSource: 'REAL_HARDWARE' | 'STALE' | 'DISCONNECTED' | 'SIMULATED' = 'DISCONNECTED';
    let ageSeconds: number | null = null;
    let temperature: number | null = null;
    let humidity: number | null = null;
    let soilMoisture: number | null = null;
    let waterLevel: number | null = null;
    let sunlight: number | null = null;
    let rain: boolean | null = null;

    if (params.simulatedSandboxReadings) {
      dataSource = 'SIMULATED';
      ageSeconds = 0;
      temperature = params.simulatedSandboxReadings.temperature ?? null;
      humidity = params.simulatedSandboxReadings.humidity ?? null;
      soilMoisture = params.simulatedSandboxReadings.soilMoisture ?? null;
      waterLevel = params.simulatedSandboxReadings.waterLevel ?? null;
      sunlight = params.simulatedSandboxReadings.sunlight ?? null;
      rain = params.simulatedSandboxReadings.rain ?? null;
    } else {
      const latestHw = this.platformDb.getLatestTelemetryForGreenhouse(
        params.greenhouseId,
        Date.now(),
        params.zoneId ? { zoneId: params.zoneId } : undefined
      );
      dataSource =
        latestHw.dataSource === 'CACHED' ? 'STALE' : latestHw.dataSource;
      ageSeconds = latestHw.ageSeconds ?? null;
      if (latestHw.exists && latestHw.readings) {
        temperature = latestHw.readings.temperature ?? null;
        humidity = latestHw.readings.humidity ?? null;
        soilMoisture = latestHw.readings.soilMoisture ?? null;
        waterLevel = latestHw.readings.waterLevel ?? null;
        sunlight = latestHw.readings.sunlight ?? null;
        rain = latestHw.readings.rain ?? null;
      }
    }

    const vpdKpa = calculateVpdKpa(temperature, humidity);

    // Inspect latest plant vision observation in SQLite
    const latestInspection = driver.queryOne<{
      health_status: string;
      summary: string;
      confidence_score: number | null;
      created_at: string;
    }>(
      `SELECT health_status, recommendation_summary AS summary, confidence_score, created_at
       FROM plant_inspections
       WHERE greenhouse_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [params.greenhouseId]
    );

    // Inspect recent hourly telemetry rollups
    const rollups = repos.telemetryHistory.queryHourlyRollups({
      greenhouseId: params.greenhouseId,
      limit: 6
    });
    const historicalContext =
      rollups.length > 0
        ? `${rollups.length} recent hourly rollup(s) available (latest bucket avg temp=${rollups[0].tempAvg ?? 'n/a'}°C, avg soil=${rollups[0].soilAvg ?? 'n/a'}%).`
        : 'No hourly telemetry rollups accumulated yet for this greenhouse.';

    // Detect statistical sensor anomalies via calibrated Stage 3C detector
    const sensorAnomalies = dlService.detectLiveSensorAnomalies(params.greenhouseId, {
      temperature,
      humidity,
      soilMoisture,
      waterLevel
    });

    // Determine missing information honestly
    const missingInformation: string[] = [];
    if (temperature === null) missingInformation.push('Canopy air temperature reading unavailable');
    if (humidity === null) missingInformation.push('Relative humidity reading unavailable (required for VPD)');
    if (soilMoisture === null) missingInformation.push('Root-zone soil moisture reading unavailable');
    if (waterLevel === null) missingInformation.push('Reservoir water-level reading unavailable');
    missingInformation.push('Root-zone pH and Electrical Conductivity (EC) probes not yet reported');
    if (!latestInspection) {
      missingInformation.push('Recent verified plant leaf inspection snapshot unavailable');
    }
    if (!params.weatherContext) {
      missingInformation.push('External local weather station forecast not supplied');
    }

    // Core deterministic crop evaluation
    const evaluated = cropEngine.evaluateConditionsAndRecommend({
      greenhouseId: params.greenhouseId,
      zoneId: params.zoneId || null,
      cropNameOrCode,
      variety,
      growthStage,
      telemetrySnapshot: {
        dataSource,
        ageSeconds,
        temperature,
        humidity,
        soilMoisture,
        waterLevel,
        sunlight,
        rain
      },
      persistRecommendations: false
    });

    // Match offline diagnostic pest/disease/stress cards
    const matchedDiagnosticRisks = kbService.matchEnvironmentalRiskCards({
      cropCode: evaluated.profile.cropCode,
      growthStage: evaluated.stageStandard.stageName,
      temperatureC: temperature,
      humidityPct: humidity,
      soilMoisturePct: soilMoisture,
      vpdKpa
    });

    // Farmer Authorization & Safety state
    const internalMode = String(ghRow?.authorization_mode || 'mode_1_individual');
    const canonicalMode = mapInternalModeToCanonicalLabel(internalMode);
    const emergencyStopActive = Number(ghRow?.emergency_stop_active || 0) === 1;
    const activePolicies = driver.queryAll<{ id: string; equipment_key: string }>(
      `SELECT id, equipment_key FROM farmer_authorization_policies
       WHERE greenhouse_id = ? AND status = 'active'`,
      [params.greenhouseId]
    );

    const stageTargetSummary = `Temp ${evaluated.stageStandard.tempMinC}–${evaluated.stageStandard.tempMaxC}°C (opt ${evaluated.stageStandard.tempOptimalC}°C), RH ${evaluated.stageStandard.humidityMinPct}–${evaluated.stageStandard.humidityMaxPct}%, Soil ${evaluated.stageStandard.soilMoistureMinPct}–${evaluated.stageStandard.soilMoistureMaxPct}%, VPD ${evaluated.stageStandard.vpdMinKpa}–${evaluated.stageStandard.vpdMaxKpa} kPa`;

    const recommendations: ExplainableTenPointRecommendation[] = evaluated.recommendations.map(
      (rec, idx): ExplainableTenPointRecommendation => {
        const equip =
          rec.proposedAction.actuatableInSimulation &&
          rec.proposedAction.targetEquipment !== 'manual_fertigation'
            ? rec.proposedAction.targetEquipment
            : null;
        let gateDecision: ExplainableTenPointRecommendation['authorizationStatus']['gateDecision'] =
          'ADVISORY_ONLY_NO_ACTUATOR';
        let safetyGateReason = 'Agronomic inspection/advisory action; no physical relay actuation requested.';

        if (equip) {
          const gateEval = controlLoop.evaluateRuntimeSafetyGates({
            greenhouseId: params.greenhouseId,
            targetEquipment: equip,
            desiredState: rec.proposedAction.desiredState,
            durationSeconds: rec.proposedAction.durationSeconds,
            telemetrySnapshot: {
              dataSource,
              ageSeconds,
              temperature,
              humidity,
              soilMoisture,
              waterLevel,
              rain
            }
          });

          if (!gateEval.allowed) {
            gateDecision = 'BLOCKED_BY_SAFETY_INTERLOCK';
            safetyGateReason = `${gateEval.code}: ${gateEval.reason}`;
          } else if (canonicalMode === 'MODE_1') {
            gateDecision = 'REQUIRES_INDIVIDUAL_FARMER_APPROVAL';
            safetyGateReason =
              'MODE_1 active: farmer must explicitly approve each recommended action (simulation-only execution in current safety boundary).';
          } else {
            const hasMatchingPolicy = activePolicies.some(
              (p) => p.equipment_key.toLowerCase() === equip.toLowerCase()
            );
            gateDecision = hasMatchingPolicy
              ? 'ELIGIBLE_FOR_BOUNDED_POLICY_SIMULATION'
              : 'REQUIRES_INDIVIDUAL_FARMER_APPROVAL';
            safetyGateReason = hasMatchingPolicy
              ? `${canonicalMode} active with matching farmer policy for "${equip}" within Tier-1 & Tier-2 bounds (physical relay dispatch remains disabled).`
              : `${canonicalMode} active, but no active farmer policy covers "${equip}"; individual approval required.`;
          }
        }

        return {
          id: `ind_rec_${idx + 1}_${rec.category.toLowerCase()}`,
          category: rec.category,
          observation: rec.explanation.whatIsHappening,
          evidence: {
            dataSource,
            observedMetrics: {
              temperatureC: temperature,
              humidityPct: humidity,
              soilMoisturePct: soilMoisture,
              waterLevelPct: waterLevel,
              vpdKpa,
              rainActive: rain
            },
            historicalContext,
            plantVisionSummary: latestInspection
              ? `${latestInspection.health_status}: ${latestInspection.summary} (${latestInspection.created_at})`
              : null,
            sensorAnomaliesDetected: sensorAnomalies
          },
          cropAndGrowthStageContext: {
            cropCode: evaluated.profile.cropCode,
            commonName: evaluated.profile.commonName,
            variety: evaluated.profile.variety,
            growthStage: evaluated.stageStandard.stageName,
            daysAfterPlanting,
            stageTargetSummary
          },
          recommendedAction: {
            summary: rec.explanation.recommendedAction,
            targetEquipment: equip,
            proposedParameters: { ...rec.proposedAction },
            physicalExecutionAllowedNow: PHASE3_PHYSICAL_EXECUTION_ENABLED
          },
          reasoning: rec.explanation.whyRecommended,
          confidence: {
            score: rec.confidenceScore,
            meaningful: dataSource === 'REAL_HARDWARE' || dataSource === 'SIMULATED',
            label: rec.explanation.systemConfidence.label,
            basis: rec.explanation.systemConfidence.calibrationBasis
          },
          risk: {
            level: rec.riskLevel,
            inactionRisk: rec.explanation.consequenceOfInaction,
            actionSideEffectRisk: rec.explanation.possibleRisks
          },
          expectedOutcome: {
            targetMetric: rec.explanation.verificationPlan.targetMetric,
            expectedDeltaRange: rec.explanation.verificationPlan.expectedDeltaRange,
            verificationWindowSeconds: rec.explanation.verificationPlan.verificationWindowSeconds
          },
          missingInformation,
          sourceReferences: evaluated.stageStandard.citationRefs,
          authorizationStatus: {
            activeFarmerMode: canonicalMode,
            modeInternalCode: internalMode,
            gateDecision,
            safetyGateReason,
            physicalHardwareDispatched: PHASE3_PHYSICAL_EXECUTION_ENABLED
          }
        };
      }
    );

    // Append diagnostic disease/pest/nutrient risk advisories when matched offline
    for (const card of matchedDiagnosticRisks) {
      recommendations.push({
        id: `ind_diag_${card.code}`,
        category: `DIAGNOSTIC_${card.category.toUpperCase()}`,
        observation: `Environmental risk window active for ${card.title}${card.causalAgent ? ` (${card.causalAgent})` : ''}.`,
        evidence: {
          dataSource,
          observedMetrics: {
            temperatureC: temperature,
            humidityPct: humidity,
            soilMoisturePct: soilMoisture,
            vpdKpa
          },
          historicalContext,
          plantVisionSummary: latestInspection ? latestInspection.summary : null,
          sensorAnomaliesDetected: sensorAnomalies
        },
        cropAndGrowthStageContext: {
          cropCode: evaluated.profile.cropCode,
          commonName: evaluated.profile.commonName,
          variety: evaluated.profile.variety,
          growthStage: evaluated.stageStandard.stageName,
          daysAfterPlanting,
          stageTargetSummary
        },
        recommendedAction: {
          summary: `${card.preventionOptions[0] || 'Inspect crop canopy immediately.'} Treatment guidance: ${card.treatmentOptions[0] || 'Follow extension IPM protocol.'}`,
          targetEquipment: null,
          proposedParameters: { inspectionSymptoms: card.symptoms },
          physicalExecutionAllowedNow: PHASE3_PHYSICAL_EXECUTION_ENABLED
        },
        reasoning: card.environmentalTriggers.triggerSummary,
        confidence: {
          score: dataSource === 'REAL_HARDWARE' ? 0.86 : 0.68,
          meaningful: dataSource !== 'DISCONNECTED',
          label: card.confidenceLevel === 'verified_reference' ? 'High (Published Reference)' : 'Moderate',
          basis: `Deterministic environmental trigger match against ${card.sourceOrganization}`
        },
        risk: {
          level: card.category === 'disease' || card.category === 'pest' ? 'high' : 'medium',
          inactionRisk: card.harvestImpact,
          actionSideEffectRisk: 'Observe published pre-harvest intervals (PHI) before applying any crop-protection product.'
        },
        expectedOutcome: {
          targetMetric: 'canopy_disease_and_stress_incidence',
          expectedDeltaRange: 'Prevent lesion establishment and protect marketable yield',
          verificationWindowSeconds: 86_400
        },
        missingInformation,
        sourceReferences: [`${card.sourceOrganization} (${card.publicationDate}): ${card.sourceCitation}`],
        authorizationStatus: {
          activeFarmerMode: canonicalMode,
          modeInternalCode: internalMode,
          gateDecision: 'ADVISORY_ONLY_NO_ACTUATOR',
          safetyGateReason: 'Agronomic scouting and IPM advisory; farmer executes manual field inspection.',
          physicalHardwareDispatched: PHASE3_PHYSICAL_EXECUTION_ENABLED
        }
      });
    }

    const localProvider = this.providers.get('edens_local_deterministic_v1')!;
    const headlineSummaries = recommendations.slice(0, 4).map((r) => r.observation);
    const localNarrative = await localProvider.enrichNarrative({
      cropName: evaluated.profile.commonName,
      growthStage: evaluated.stageStandard.stageName,
      dataSource,
      recommendationsCount: recommendations.length,
      headlineSummaries
    });

    let narrativeText = localNarrative.enrichedSummary || '';
    let providerUsed = localProvider.providerId;
    let externalModelUsed: string | null = null;
    let fallbackReason: string | null = null;
    let operatedWithoutExternalLlm = true;

    if (
      params.preferredExternalProviderId &&
      params.preferredExternalProviderId !== 'edens_local_deterministic_v1'
    ) {
      const ext = this.providers.get(params.preferredExternalProviderId);
      if (ext && ext.isAvailable()) {
        const enriched = await ext.enrichNarrative({
          cropName: evaluated.profile.commonName,
          growthStage: evaluated.stageStandard.stageName,
          dataSource,
          recommendationsCount: recommendations.length,
          headlineSummaries
        });
        if (enriched.enrichedSummary) {
          narrativeText = enriched.enrichedSummary;
          providerUsed = ext.providerId;
          externalModelUsed = enriched.modelUsed;
          operatedWithoutExternalLlm = false;
        } else {
          fallbackReason = enriched.fallbackReason;
        }
      } else {
        fallbackReason = `Requested external provider "${params.preferredExternalProviderId}" unavailable; served by independent local engine.`;
      }
    }

    return {
      independentEngineVersion: 'edens-independent-intelligence-3.0',
      operatedWithoutExternalLlm,
      physicalActuationEnabled: PHASE3_PHYSICAL_EXECUTION_ENABLED,
      greenhouseId: params.greenhouseId,
      zoneId: params.zoneId || null,
      dataSource,
      cropContext: {
        cropCode: evaluated.profile.cropCode,
        commonName: evaluated.profile.commonName,
        variety: evaluated.profile.variety,
        growthStage: evaluated.stageStandard.stageName,
        daysAfterPlanting,
        validationStatus: evaluated.profile.validationStatus
      },
      farmerAuthorization: {
        canonicalMode,
        internalMode,
        emergencyStopActive,
        activePoliciesCount: activePolicies.length
      },
      matchedDiagnosticRisks,
      sensorAnomalies,
      recommendations,
      narrativeSummary: {
        text: narrativeText,
        providerUsed,
        externalModelUsed,
        fallbackReason
      }
    };
  }
}
