import express from 'express';
import type { AuthenticatedUser, PlatformDatabase } from './database.ts';
import { extractSessionToken } from './greenhouseRoutes.ts';
import {
  AgriculturalKnowledgeBaseService,
  type DiagnosticCategory
} from './agriculturalKnowledgeBase.ts';
import {
  AgriculturalDatasetService,
  DATASET_CATEGORIES,
  type DatasetCategory,
  type DatasetSplit,
  type LabelValidationStatus
} from './datasetInfrastructure.ts';
import { DeepLearningPipelineService } from './deepLearningPipeline.ts';
import {
  SafeReinforcementLearningService,
  type WeatherProfileKind
} from './reinforcementLearningEngine.ts';
import { IndependentAgriculturalDecisionEngine } from './independentDecisionEngine.ts';

export function registerStage3IntelligenceRoutes(
  app: express.Express,
  deps: {
    platformDb: PlatformDatabase;
  }
): void {
  const { platformDb } = deps;
  const decisionEngine = new IndependentAgriculturalDecisionEngine(platformDb);

  const requireAuth = (req: express.Request, res: express.Response): AuthenticatedUser | null => {
    const token = extractSessionToken(req);
    const user = token ? platformDb.getUserBySessionToken(token) : null;
    if (!user) {
      res.status(401).json({
        error: 'UNAUTHENTICATED',
        message: 'Sign in is required to access EDENS AI agricultural intelligence services.'
      });
      return null;
    }
    return user;
  };

  const requireGreenhouseReadAccess = (
    req: express.Request,
    res: express.Response,
    greenhouseId: string
  ): AuthenticatedUser | null => {
    const user = requireAuth(req, res);
    if (!user) return null;
    if (!platformDb.getGreenhouseForUser(greenhouseId, user.id)) {
      res.status(403).json({
        error: 'FORBIDDEN_GREENHOUSE',
        message: 'You do not have permission to access datasets or models for this greenhouse.'
      });
      return null;
    }
    return user;
  };

  const requireGreenhouseOperatorAccess = (
    req: express.Request,
    res: express.Response,
    greenhouseId: string
  ): AuthenticatedUser | null => {
    const user = requireAuth(req, res);
    if (!user) return null;
    if (user.isGuest) {
      res.status(403).json({
        error: 'GUEST_MUTATION_FORBIDDEN',
        message: 'Guest accounts cannot modify datasets, verify ground-truth labels, or persist trained model versions.'
      });
      return null;
    }
    const role = platformDb.getMemberRole(greenhouseId, user.id);
    if (role !== 'owner' && role !== 'operator') {
      res.status(403).json({
        error: 'FORBIDDEN_GREENHOUSE',
        message: 'Only greenhouse owners or operators may modify datasets or execute training runs.'
      });
      return null;
    }
    return user;
  };

  // ------------------------------------------------------------------
  // STAGE 3A: INDEPENDENT AGRICULTURAL KNOWLEDGE BASE
  // ------------------------------------------------------------------

  app.get('/api/intelligence/knowledge-base', async (req, res) => {
    await platformDb.init();
    const user = requireAuth(req, res);
    if (!user) return;

    const kb = new AgriculturalKnowledgeBaseService(platformDb.getDriver(), platformDb.repositories);
    return res.status(200).json({
      success: true,
      ...kb.getKnowledgeBaseSummary(),
      registeredReasoningProviders: decisionEngine.listRegisteredProviders()
    });
  });

  app.get('/api/intelligence/diagnostics', async (req, res) => {
    await platformDb.init();
    const user = requireAuth(req, res);
    if (!user) return;

    const kb = new AgriculturalKnowledgeBaseService(platformDb.getDriver(), platformDb.repositories);
    const cards = kb.queryDiagnosticCards({
      cropCode: req.query.cropCode ? String(req.query.cropCode) : undefined,
      category: req.query.category ? (String(req.query.category) as DiagnosticCategory) : undefined,
      growthStage: req.query.growthStage ? String(req.query.growthStage) : undefined,
      searchText: req.query.q ? String(req.query.q) : undefined
    });

    return res.status(200).json({
      success: true,
      count: cards.length,
      diagnosticCards: cards
    });
  });

  // ------------------------------------------------------------------
  // STAGE 3B: VERSIONED AGRICULTURAL DATASET INFRASTRUCTURE
  // ------------------------------------------------------------------

  app.get('/api/greenhouses/:greenhouseId/datasets/records', async (req, res) => {
    await platformDb.init();
    const ghId = String(req.params.greenhouseId || '').trim();
    const user = requireGreenhouseReadAccess(req, res, ghId);
    if (!user) return;

    const ds = new AgriculturalDatasetService(platformDb.getDriver());
    const requestedStatus = req.query.labelStatus
      ? (String(req.query.labelStatus) as LabelValidationStatus)
      : undefined;
    const rawRecords = ds.listRecords(ghId, {
      category: req.query.category ? (String(req.query.category) as DatasetCategory) : undefined,
      split: req.query.split ? (String(req.query.split) as DatasetSplit) : undefined,
      onlyVerifiedGroundTruth: requestedStatus === 'agronomist_verified',
      onlyConsented: req.query.onlyConsented === 'true'
    });
    const records = requestedStatus
      ? rawRecords.filter((rec) => rec.labelStatus === requestedStatus)
      : rawRecords;

    return res.status(200).json({
      success: true,
      supportedCategories: DATASET_CATEGORIES,
      count: records.length,
      records
    });
  });

  app.post('/api/greenhouses/:greenhouseId/datasets/records', async (req, res) => {
    await platformDb.init();
    const ghId = String(req.params.greenhouseId || '').trim();
    const user = requireGreenhouseOperatorAccess(req, res, ghId);
    if (!user) return;

    const ds = new AgriculturalDatasetService(platformDb.getDriver());
    const body = req.body || {};
    const result = ds.ingestDatasetRecord({
      greenhouseId: ghId,
      zoneId: body.zoneId ? String(body.zoneId) : null,
      category: String(body.category || '') as DatasetCategory,
      cropCode: String(body.cropCode || 'tomato'),
      variety: body.variety ? String(body.variety) : null,
      growthStage: body.growthStage ? String(body.growthStage) : null,
      provenanceSource: body.provenanceSource || 'farmer_observation',
      sourceRecordId: body.sourceRecordId ? String(body.sourceRecordId) : null,
      payload: typeof body.payload === 'object' && body.payload !== null ? body.payload : {},
      storageRelPath: body.storageRelPath ? String(body.storageRelPath) : null,
      labelValue: body.labelValue ? String(body.labelValue) : null,
      requestedLabelStatus: body.requestedLabelStatus,
      verifiedByUserId: body.requestedLabelStatus === 'agronomist_verified' ? user.id : null,
      consentForTraining: body.consentForTraining !== false,
      ownerUserId: user.id,
      retentionDays: typeof body.retentionDays === 'number' ? body.retentionDays : 730,
      splitGroupKey: body.splitGroupKey ? String(body.splitGroupKey) : undefined
    });

    if ('errorCode' in result) {
      return res.status(result.statusCode).json({
        error: result.errorCode,
        message: result.message
      });
    }

    return res.status(201).json({
      success: true,
      record: result.record
    });
  });

  app.post('/api/greenhouses/:greenhouseId/datasets/records/:recordId/verify', async (req, res) => {
    await platformDb.init();
    const ghId = String(req.params.greenhouseId || '').trim();
    const recordId = String(req.params.recordId || '').trim();
    const user = requireGreenhouseOperatorAccess(req, res, ghId);
    if (!user) return;

    const ds = new AgriculturalDatasetService(platformDb.getDriver());
    const approve = req.body?.status !== 'rejected';
    const record = ds.verifyRecordLabel({
      greenhouseId: ghId,
      recordId,
      verifiedLabel: String(req.body?.labelValue || '').trim(),
      approve,
      verifiedByUserId: user.id
    });

    if (!record) {
      return res.status(404).json({
        error: 'DATASET_RECORD_NOT_FOUND',
        message: 'Dataset record not found in this greenhouse.'
      });
    }

    return res.status(200).json({
      success: true,
      record
    });
  });

  app.patch('/api/greenhouses/:greenhouseId/datasets/records/:recordId/consent', async (req, res) => {
    await platformDb.init();
    const ghId = String(req.params.greenhouseId || '').trim();
    const recordId = String(req.params.recordId || '').trim();
    const user = requireGreenhouseOperatorAccess(req, res, ghId);
    if (!user) return;

    const ds = new AgriculturalDatasetService(platformDb.getDriver());
    const updated = ds.updateTrainingConsent({
      greenhouseId: ghId,
      recordId,
      consentForTraining: Boolean(req.body?.consentForTraining)
    });

    if (!updated) {
      return res.status(404).json({
        error: 'DATASET_RECORD_NOT_FOUND',
        message: 'Dataset record not found in this greenhouse.'
      });
    }

    return res.status(200).json({
      success: true,
      recordId,
      consentForTraining: updated.consentForTraining
    });
  });

  app.get('/api/greenhouses/:greenhouseId/datasets/versions', async (req, res) => {
    await platformDb.init();
    const ghId = String(req.params.greenhouseId || '').trim();
    const user = requireGreenhouseReadAccess(req, res, ghId);
    if (!user) return;

    const ds = new AgriculturalDatasetService(platformDb.getDriver());
    const versions = ds.listVersions(ghId);
    return res.status(200).json({
      success: true,
      count: versions.length,
      versions
    });
  });

  app.post('/api/greenhouses/:greenhouseId/datasets/versions', async (req, res) => {
    await platformDb.init();
    const ghId = String(req.params.greenhouseId || '').trim();
    const user = requireGreenhouseOperatorAccess(req, res, ghId);
    if (!user) return;

    const ds = new AgriculturalDatasetService(platformDb.getDriver());
    const result = ds.createDatasetVersionSnapshot({
      greenhouseId: ghId,
      datasetName: String(req.body?.datasetName || 'edens_agronomy_dataset'),
      versionTag: String(req.body?.versionTag || `v1.0.${Date.now()}`),
      categories: Array.isArray(req.body?.categories) ? req.body.categories : undefined,
      requireVerifiedLabels: req.body?.requireVerifiedLabels !== false,
      createdByUserId: user.id
    });

    if ('errorCode' in result) {
      return res.status(result.statusCode).json({
        error: result.errorCode,
        message: result.message
      });
    }

    return res.status(201).json({
      success: true,
      snapshot: result.version,
      version: result.version
    });
  });

  app.get('/api/greenhouses/:greenhouseId/datasets/versions/:versionId/export', async (req, res) => {
    await platformDb.init();
    const ghId = String(req.params.greenhouseId || '').trim();
    const versionId = String(req.params.versionId || '').trim();
    const user = requireGreenhouseReadAccess(req, res, ghId);
    if (!user) return;

    const format = req.query.format === 'csv' ? 'csv' : 'jsonl';
    const ds = new AgriculturalDatasetService(platformDb.getDriver());
    const result = ds.exportDatasetVersion({
      greenhouseId: ghId,
      versionId,
      format
    });

    if (!result) {
      return res.status(404).json({
        error: 'DATASET_VERSION_NOT_FOUND',
        message: 'Requested dataset snapshot version was not found in this greenhouse.'
      });
    }

    const contentType =
      format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Export-Filename', `dataset_${versionId}.${format}`);
    res.setHeader('X-Export-Record-Count', String(result.recordCount));
    return res.status(200).send(result.content);
  });

  // ------------------------------------------------------------------
  // STAGE 3C: DEEP LEARNING TRAINING, EVALUATION & ONNX PIPELINE
  // ------------------------------------------------------------------

  app.get('/api/intelligence/ml/catalog', async (req, res) => {
    await platformDb.init();
    const user = requireAuth(req, res);
    if (!user) return;

    const dl = new DeepLearningPipelineService(platformDb.getDriver());
    return res.status(200).json({
      success: true,
      ...dl.getArchitectureCatalog()
    });
  });

  app.post('/api/greenhouses/:greenhouseId/ml/train-forecaster', async (req, res) => {
    await platformDb.init();
    const ghId = String(req.params.greenhouseId || '').trim();
    const user = requireGreenhouseOperatorAccess(req, res, ghId);
    if (!user) return;

    const dl = new DeepLearningPipelineService(platformDb.getDriver());
    const result = dl.trainAndEvaluateEnvironmentalForecaster({
      greenhouseId: ghId,
      versionTag: String(req.body?.versionTag || `v1.0.${Date.now()}`),
      epochs: typeof req.body?.epochs === 'number' ? req.body.epochs : 80,
      learningRate: typeof req.body?.learningRate === 'number' ? req.body.learningRate : 0.03,
      seed: typeof req.body?.seed === 'number' ? req.body.seed : 202604
    });

    if ('errorCode' in result) {
      return res.status(result.statusCode).json({
        error: result.errorCode,
        message: result.message
      });
    }

    return res.status(201).json({
      success: true,
      ...result
    });
  });

  app.post('/api/greenhouses/:greenhouseId/ml/fit-anomaly-detector', async (req, res) => {
    await platformDb.init();
    const ghId = String(req.params.greenhouseId || '').trim();
    const user = requireGreenhouseOperatorAccess(req, res, ghId);
    if (!user) return;

    const dl = new DeepLearningPipelineService(platformDb.getDriver());
    const result = dl.fitAndEvaluateSensorAnomalyDetector({
      greenhouseId: ghId,
      versionTag: String(req.body?.versionTag || `v1.0.${Date.now()}`)
    });

    if ('errorCode' in result) {
      return res.status(result.statusCode).json({
        error: result.errorCode,
        message: result.message
      });
    }

    return res.status(201).json({
      success: true,
      ...result
    });
  });

  // ------------------------------------------------------------------
  // STAGE 3D: SAFE REINFORCEMENT LEARNING & DIGITAL TWIN SIMULATION
  // ------------------------------------------------------------------

  app.get('/api/intelligence/rl/overview', async (req, res) => {
    await platformDb.init();
    const user = requireAuth(req, res);
    if (!user) return;

    const ghId = req.query.greenhouseId ? String(req.query.greenhouseId).trim() : undefined;
    if (ghId && !platformDb.getGreenhouseForUser(ghId, user.id)) {
      return res.status(403).json({
        error: 'FORBIDDEN_GREENHOUSE',
        message: 'You do not have permission to view RL simulation experiments for this greenhouse.'
      });
    }

    const rl = new SafeReinforcementLearningService(platformDb.getDriver());
    return res.status(200).json({
      success: true,
      ...rl.listPoliciesAndExperiments(ghId)
    });
  });

  app.post('/api/greenhouses/:greenhouseId/rl/train-simulation', async (req, res) => {
    await platformDb.init();
    const ghId = String(req.params.greenhouseId || '').trim();
    const user = requireGreenhouseOperatorAccess(req, res, ghId);
    if (!user) return;

    const validProfiles = new Set<WeatherProfileKind>([
      'lagos_humid_tropical',
      'kano_dry_harmattan',
      'jos_cool_highland'
    ]);
    const requestedProfile = String(req.body?.weatherProfile || 'lagos_humid_tropical') as WeatherProfileKind;
    const weatherProfile: WeatherProfileKind = validProfiles.has(requestedProfile)
      ? requestedProfile
      : 'lagos_humid_tropical';

    const rl = new SafeReinforcementLearningService(platformDb.getDriver());
    const evalDays =
      typeof req.body?.evalDays === 'number'
        ? req.body.evalDays
        : typeof req.body?.simDaysPerEpisode === 'number'
          ? req.body.simDaysPerEpisode
          : 7;
    const result = rl.trainAndBenchmarkPolicyInSimulation({
      greenhouseId: ghId,
      policyName: String(req.body?.policyName || 'greenhouse_climate_irrigation_q_v1'),
      versionTag: String(req.body?.versionTag || `v1.0.${Date.now()}`),
      weatherProfile,
      cropType: req.body?.cropType ? String(req.body.cropType) : 'Tomato',
      trainingEpisodes: typeof req.body?.trainingEpisodes === 'number' ? req.body.trainingEpisodes : 60,
      evalDays,
      seed: typeof req.body?.seed === 'number' ? req.body.seed : 2026
    });

    return res.status(201).json({
      success: true,
      ...result
    });
  });

  // ------------------------------------------------------------------
  // STAGE 3E & 3F: INDEPENDENT AGRICULTURAL DECISION ENGINE
  // ------------------------------------------------------------------

  app.post('/api/greenhouses/:greenhouseId/intelligence/evaluate-independent', async (req, res) => {
    await platformDb.init();
    const ghId = String(req.params.greenhouseId || '').trim();
    const user = requireGreenhouseReadAccess(req, res, ghId);
    if (!user) return;

    const body = req.body || {};
    const evaluation = await decisionEngine.evaluateGreenhouse({
      greenhouseId: ghId,
      zoneId: body.zoneId ? String(body.zoneId) : null,
      cropOverride: body.crop ? String(body.crop) : undefined,
      varietyOverride: body.variety ? String(body.variety) : undefined,
      growthStageOverride: body.growthStage ? String(body.growthStage) : undefined,
      weatherContext:
        typeof body.weatherContext === 'object' && body.weatherContext !== null
          ? body.weatherContext
          : null,
      simulatedSandboxReadings:
        typeof body.simulatedSandboxReadings === 'object' && body.simulatedSandboxReadings !== null
          ? body.simulatedSandboxReadings
          : null,
      preferredExternalProviderId: body.preferredExternalProviderId
        ? String(body.preferredExternalProviderId)
        : null
    });

    return res.status(200).json({
      success: true,
      ...evaluation
    });
  });
}
