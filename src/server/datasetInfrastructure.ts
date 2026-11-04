import crypto from 'node:crypto';
import { SqliteDriver } from './sqliteDriver.ts';
import { generateSecureId, sha256Hex } from './telemetryContract.ts';

export const DATASET_CATEGORIES = [
  'plant_images',
  'disease_images',
  'pest_images',
  'nutrient_deficiency_images',
  'environmental_sensor_histories',
  'crop_growth_observations',
  'irrigation_outcomes',
  'weather_histories',
  'farmer_observations',
  'verified_treatment_outcomes'
] as const;

export type DatasetCategory = (typeof DATASET_CATEGORIES)[number];

export type LabelValidationStatus =
  | 'unverified_farmer_observation'
  | 'automated_provisional'
  | 'agronomist_verified'
  | 'rejected';

export type DatasetSplit = 'train' | 'validation' | 'test';

export interface DatasetRecord {
  id: string;
  greenhouseId: string;
  zoneId: string | null;
  category: DatasetCategory;
  cropCode: string;
  variety: string | null;
  growthStage: string | null;
  provenanceSource: string;
  sourceRecordId: string | null;
  payloadSha256: string;
  payload: Record<string, unknown>;
  storageRelPath: string | null;
  labelValue: string | null;
  labelStatus: LabelValidationStatus;
  verifiedByUserId: string | null;
  qualityScore: number;
  qualityFlags: string[];
  splitAssignment: DatasetSplit;
  consentForTraining: boolean;
  ownerUserId: string | null;
  retentionUntil: string | null;
  createdAt: string;
}

export interface DatasetVersionSnapshot {
  id: string;
  greenhouseId: string;
  datasetName: string;
  versionTag: string;
  categories: DatasetCategory[];
  totalRecords: number;
  trainCount: number;
  validationCount: number;
  testCount: number;
  manifestSha256: string;
  manifest: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
}

/**
 * Deterministic grouped hash split (70% train / 15% validation / 15% test)
 * so correlated samples from the same group key stay in the same split (anti-leakage).
 */
export function assignDeterministicSplit(groupKey: string): DatasetSplit {
  const digest = crypto.createHash('sha256').update(groupKey).digest();
  const bucket = digest.readUInt16BE(0) % 100;
  if (bucket < 70) return 'train';
  if (bucket < 85) return 'validation';
  return 'test';
}

function canonicalizePayloadForHash(payload: Record<string, unknown>): string {
  const sortedKeys = Object.keys(payload).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    ordered[k] = payload[k];
  }
  return JSON.stringify(ordered);
}

export class AgriculturalDatasetService {
  private readonly driver: SqliteDriver;

  constructor(driver: SqliteDriver) {
    this.driver = driver;
  }

  /**
   * Ingests a single agricultural dataset record with strict category validation,
   * SHA-256 duplicate rejection, quality scoring, consent tracking, and anti-ground-truth-pollution
   * enforcement (farmer observations are NEVER marked agronomist_verified automatically).
   */
  public ingestDatasetRecord(params: {
    greenhouseId: string;
    zoneId?: string | null;
    category: DatasetCategory;
    cropCode: string;
    variety?: string | null;
    growthStage?: string | null;
    provenanceSource:
      | 'real_hardware_sensor'
      | 'verified_camera_jpeg'
      | 'farmer_observation'
      | 'agronomist_verified_entry'
      | 'verified_outcome_loop';
    sourceRecordId?: string | null;
    payload: Record<string, unknown>;
    storageRelPath?: string | null;
    labelValue?: string | null;
    requestedLabelStatus?: LabelValidationStatus;
    verifiedByUserId?: string | null;
    consentForTraining?: boolean;
    ownerUserId?: string | null;
    retentionDays?: number;
    splitGroupKey?: string;
  }):
    | { ok: true; record: DatasetRecord }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    if (!DATASET_CATEGORIES.includes(params.category)) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_DATASET_CATEGORY',
        message: `Unsupported dataset category "${params.category}".`
      };
    }

    const srcStr = String(params.payload.source || params.provenanceSource).toLowerCase();
    if (srcStr === 'fabricated' || srcStr === 'synthetic_fake') {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'FABRICATED_DATASET_FORBIDDEN',
        message: 'Fabricated dataset records are strictly forbidden.'
      };
    }

    const canonicalJson = canonicalizePayloadForHash(params.payload);
    const payloadSha256 = sha256Hex(`${params.category}:${params.cropCode}:${canonicalJson}`);

    const duplicate = this.driver.queryOne<{ id: string }>(
      `SELECT id FROM agricultural_dataset_records
       WHERE greenhouse_id = ? AND category = ? AND payload_sha256 = ?`,
      [params.greenhouseId, params.category, payloadSha256]
    );
    if (duplicate) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'DUPLICATE_DATASET_RECORD',
        message: `Duplicate record rejected (matching SHA-256 ${payloadSha256.slice(0, 12)} already exists as ${duplicate.id}).`
      };
    }

    // Ground-truth safety rule: farmer_observations or unverified farmer inputs NEVER silently become ground truth
    let labelStatus: LabelValidationStatus = 'unverified_farmer_observation';
    let verifiedByUserId: string | null = null;
    if (
      params.category !== 'farmer_observations' &&
      params.provenanceSource !== 'farmer_observation' &&
      params.requestedLabelStatus === 'agronomist_verified' &&
      params.verifiedByUserId
    ) {
      labelStatus = 'agronomist_verified';
      verifiedByUserId = params.verifiedByUserId;
    } else if (
      params.provenanceSource === 'real_hardware_sensor' ||
      params.provenanceSource === 'verified_outcome_loop'
    ) {
      labelStatus = params.requestedLabelStatus === 'agronomist_verified' && params.verifiedByUserId
        ? 'agronomist_verified'
        : 'automated_provisional';
    }

    // Quality control scoring
    const qualityFlags: string[] = [];
    let qualityScore = 1.0;

    if (!params.labelValue && params.category.endsWith('_images')) {
      qualityFlags.push('missing_image_label');
      qualityScore -= 0.35;
    }
    if (labelStatus === 'unverified_farmer_observation') {
      qualityFlags.push('unverified_ground_truth');
      qualityScore -= 0.2;
    }
    if (!params.growthStage) {
      qualityFlags.push('missing_growth_stage');
      qualityScore -= 0.1;
    }
    qualityScore = Number(Math.max(0.1, Math.min(1.0, qualityScore)).toFixed(3));

    const id = generateSecureId('dsrec', 8);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const retentionDays = Math.max(1, Math.min(3650, params.retentionDays ?? 730));
    const retentionUntil = new Date(nowMs + retentionDays * 86_400_000).toISOString();
    const consentForTraining = params.consentForTraining !== false;

    const groupKey =
      params.splitGroupKey || `${params.greenhouseId}:${params.category}:${id}`;
    const splitAssignment = assignDeterministicSplit(groupKey);

    this.driver.run(
      `INSERT INTO agricultural_dataset_records (
         id, greenhouse_id, zone_id, category, crop_code, variety, growth_stage,
         provenance_source, source_record_id, payload_sha256, payload_json,
         storage_rel_path, label_value, label_status, verified_by_user_id,
         quality_score, quality_flags_json, split_assignment, consent_for_training,
         owner_user_id, retention_until, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.greenhouseId,
        params.zoneId || null,
        params.category,
        params.cropCode.trim().toLowerCase(),
        params.variety || null,
        params.growthStage || null,
        params.provenanceSource,
        params.sourceRecordId || null,
        payloadSha256,
        canonicalJson,
        params.storageRelPath || null,
        params.labelValue || null,
        labelStatus,
        verifiedByUserId,
        qualityScore,
        JSON.stringify(qualityFlags),
        splitAssignment,
        consentForTraining ? 1 : 0,
        params.ownerUserId || null,
        retentionUntil,
        nowIso
      ]
    );

    return {
      ok: true,
      record: this.getRecordById(params.greenhouseId, id)!
    };
  }

  /**
   * Explicit agronomist/owner label verification gate required before a record can serve
   * as supervised ground truth in Deep Learning classification pipelines.
   */
  public verifyRecordLabel(params: {
    greenhouseId: string;
    recordId: string;
    verifiedLabel: string;
    verifiedByUserId: string;
    approve: boolean;
  }): DatasetRecord | null {
    const existing = this.getRecordById(params.greenhouseId, params.recordId);
    if (!existing) return null;

    const nextStatus: LabelValidationStatus = params.approve ? 'agronomist_verified' : 'rejected';
    const updatedFlags = existing.qualityFlags.filter((f) => f !== 'unverified_ground_truth');
    const nextQuality = params.approve ? Math.min(1.0, Number((existing.qualityScore + 0.2).toFixed(3))) : 0.1;

    this.driver.run(
      `UPDATE agricultural_dataset_records
       SET label_value = ?, label_status = ?, verified_by_user_id = ?, quality_score = ?, quality_flags_json = ?
       WHERE id = ? AND greenhouse_id = ?`,
      [
        params.verifiedLabel.trim(),
        nextStatus,
        params.verifiedByUserId,
        nextQuality,
        JSON.stringify(updatedFlags),
        params.recordId,
        params.greenhouseId
      ]
    );

    return this.getRecordById(params.greenhouseId, params.recordId);
  }

  public updateTrainingConsent(params: {
    greenhouseId: string;
    recordId: string;
    consentForTraining: boolean;
  }): DatasetRecord | null {
    const existing = this.getRecordById(params.greenhouseId, params.recordId);
    if (!existing) return null;
    this.driver.run(
      'UPDATE agricultural_dataset_records SET consent_for_training = ? WHERE id = ? AND greenhouse_id = ?',
      [params.consentForTraining ? 1 : 0, params.recordId, params.greenhouseId]
    );
    return this.getRecordById(params.greenhouseId, params.recordId);
  }

  public getRecordById(greenhouseId: string, recordId: string): DatasetRecord | null {
    const r = this.driver.queryOne<any>(
      'SELECT * FROM agricultural_dataset_records WHERE id = ? AND greenhouse_id = ?',
      [recordId, greenhouseId]
    );
    return r ? this.mapRow(r) : null;
  }

  public listRecords(
    greenhouseId: string,
    filters?: {
      category?: DatasetCategory;
      split?: DatasetSplit;
      onlyVerifiedGroundTruth?: boolean;
      onlyConsented?: boolean;
    }
  ): DatasetRecord[] {
    const rows = this.driver.queryAll<any>(
      'SELECT * FROM agricultural_dataset_records WHERE greenhouse_id = ? ORDER BY created_at ASC',
      [greenhouseId]
    );
    return rows
      .map((r) => this.mapRow(r))
      .filter((rec) => {
        if (filters?.category && rec.category !== filters.category) return false;
        if (filters?.split && rec.splitAssignment !== filters.split) return false;
        if (filters?.onlyConsented && !rec.consentForTraining) return false;
        if (filters?.onlyVerifiedGroundTruth && rec.labelStatus !== 'agronomist_verified') {
          return false;
        }
        return true;
      });
  }

  /**
   * Creates an immutable, cryptographically hashed versioned dataset snapshot (`v1.0.0`, etc.)
   * containing ONLY consented records that meet the requested verification bar.
   */
  public createDatasetVersionSnapshot(params: {
    greenhouseId: string;
    datasetName: string;
    versionTag: string;
    categories?: DatasetCategory[];
    requireVerifiedLabels?: boolean;
    createdByUserId?: string | null;
  }):
    | { ok: true; version: DatasetVersionSnapshot }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    const eligible = this.listRecords(params.greenhouseId, {
      onlyConsented: true,
      onlyVerifiedGroundTruth: params.requireVerifiedLabels
    }).filter((r) =>
      params.categories && params.categories.length > 0 ? params.categories.includes(r.category) : true
    );

    if (eligible.length === 0) {
      return {
        ok: false,
        statusCode: 422,
        errorCode: 'EMPTY_ELIGIBLE_DATASET',
        message: 'No consented, eligible dataset records matched the snapshot criteria.'
      };
    }

    const existingVer = this.driver.queryOne<{ id: string }>(
      `SELECT id FROM agricultural_dataset_versions
       WHERE greenhouse_id = ? AND dataset_name = ? AND version_tag = ?`,
      [params.greenhouseId, params.datasetName.trim(), params.versionTag.trim()]
    );
    if (existingVer) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'DATASET_VERSION_EXISTS',
        message: `Dataset version ${params.datasetName}@${params.versionTag} already exists and is immutable.`
      };
    }

    const trainIds = eligible.filter((r) => r.splitAssignment === 'train').map((r) => r.id);
    const valIds = eligible.filter((r) => r.splitAssignment === 'validation').map((r) => r.id);
    const testIds = eligible.filter((r) => r.splitAssignment === 'test').map((r) => r.id);
    const distinctCategories = Array.from(new Set(eligible.map((r) => r.category)));

    const manifestObj = {
      datasetName: params.datasetName.trim(),
      versionTag: params.versionTag.trim(),
      requireVerifiedLabels: Boolean(params.requireVerifiedLabels),
      recordDigests: eligible.map((r) => ({
        id: r.id,
        category: r.category,
        split: r.splitAssignment,
        label: r.labelValue,
        labelStatus: r.labelStatus,
        sha256: r.payloadSha256
      })),
      splits: {
        train: trainIds,
        validation: valIds,
        test: testIds
      }
    };
    const manifestJson = JSON.stringify(manifestObj);
    const manifestSha256 = sha256Hex(manifestJson);
    const id = generateSecureId('dsver', 8);
    const nowIso = new Date().toISOString();

    this.driver.run(
      `INSERT INTO agricultural_dataset_versions (
         id, greenhouse_id, dataset_name, version_tag, categories_json,
         total_records, train_count, validation_count, test_count,
         manifest_sha256, manifest_json, created_by_user_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.greenhouseId,
        params.datasetName.trim(),
        params.versionTag.trim(),
        JSON.stringify(distinctCategories),
        eligible.length,
        trainIds.length,
        valIds.length,
        testIds.length,
        manifestSha256,
        manifestJson,
        params.createdByUserId || null,
        nowIso
      ]
    );

    return {
      ok: true,
      version: {
        id,
        greenhouseId: params.greenhouseId,
        datasetName: params.datasetName.trim(),
        versionTag: params.versionTag.trim(),
        categories: distinctCategories,
        totalRecords: eligible.length,
        trainCount: trainIds.length,
        validationCount: valIds.length,
        testCount: testIds.length,
        manifestSha256,
        manifest: manifestObj,
        createdByUserId: params.createdByUserId || null,
        createdAt: nowIso
      }
    };
  }

  public exportDatasetVersion(params: {
    greenhouseId: string;
    versionId: string;
    format: 'jsonl' | 'csv';
  }): { format: 'jsonl' | 'csv'; manifestSha256: string; content: string; recordCount: number } | null {
    const verRow = this.driver.queryOne<any>(
      'SELECT * FROM agricultural_dataset_versions WHERE id = ? AND greenhouse_id = ?',
      [params.versionId, params.greenhouseId]
    );
    if (!verRow) return null;

    const manifest = JSON.parse(String(verRow.manifest_json || '{}'));
    const digests: Array<{ id: string }> = Array.isArray(manifest.recordDigests) ? manifest.recordDigests : [];
    const records: DatasetRecord[] = [];
    for (const d of digests) {
      const rec = this.getRecordById(params.greenhouseId, d.id);
      if (rec && rec.consentForTraining) {
        records.push(rec);
      }
    }

    if (params.format === 'csv') {
      const header = 'id,category,crop_code,growth_stage,split,label_value,label_status,quality_score,payload_sha256,created_at';
      const lines = records.map((r) =>
        [
          r.id,
          r.category,
          r.cropCode,
          r.growthStage || '',
          r.splitAssignment,
          `"${(r.labelValue || '').replace(/"/g, '""')}"`,
          r.labelStatus,
          r.qualityScore,
          r.payloadSha256,
          r.createdAt
        ].join(',')
      );
      return {
        format: 'csv',
        manifestSha256: String(verRow.manifest_sha256),
        content: [header, ...lines].join('\n'),
        recordCount: records.length
      };
    }

    const jsonl = records
      .map((r) =>
        JSON.stringify({
          id: r.id,
          category: r.category,
          cropCode: r.cropCode,
          variety: r.variety,
          growthStage: r.growthStage,
          split: r.splitAssignment,
          label: r.labelValue,
          labelStatus: r.labelStatus,
          qualityScore: r.qualityScore,
          provenanceSource: r.provenanceSource,
          sha256: r.payloadSha256,
          payload: r.payload
        })
      )
      .join('\n');

    return {
      format: 'jsonl',
      manifestSha256: String(verRow.manifest_sha256),
      content: jsonl,
      recordCount: records.length
    };
  }

  public listVersions(greenhouseId: string): DatasetVersionSnapshot[] {
    const rows = this.driver.queryAll<any>(
      'SELECT * FROM agricultural_dataset_versions WHERE greenhouse_id = ? ORDER BY created_at DESC',
      [greenhouseId]
    );
    return rows.map((r) => ({
      id: String(r.id),
      greenhouseId: String(r.greenhouseId || r.greenhouse_id),
      datasetName: String(r.dataset_name),
      versionTag: String(r.version_tag),
      categories: JSON.parse(String(r.categories_json || '[]')),
      totalRecords: Number(r.total_records || 0),
      trainCount: Number(r.train_count || 0),
      validationCount: Number(r.validation_count || 0),
      testCount: Number(r.test_count || 0),
      manifestSha256: String(r.manifest_sha256),
      manifest: JSON.parse(String(r.manifest_json || '{}')),
      createdByUserId: r.created_by_user_id ? String(r.created_by_user_id) : null,
      createdAt: String(r.created_at)
    }));
  }

  private mapRow(r: any): DatasetRecord {
    return {
      id: String(r.id),
      greenhouseId: String(r.greenhouse_id),
      zoneId: r.zone_id ? String(r.zone_id) : null,
      category: String(r.category) as DatasetCategory,
      cropCode: String(r.crop_code),
      variety: r.variety ? String(r.variety) : null,
      growthStage: r.growth_stage ? String(r.growth_stage) : null,
      provenanceSource: String(r.provenance_source),
      sourceRecordId: r.source_record_id ? String(r.source_record_id) : null,
      payloadSha256: String(r.payload_sha256),
      payload: JSON.parse(String(r.payload_json || '{}')),
      storageRelPath: r.storage_rel_path ? String(r.storage_rel_path) : null,
      labelValue: r.label_value ? String(r.label_value) : null,
      labelStatus: String(r.label_status) as LabelValidationStatus,
      verifiedByUserId: r.verified_by_user_id ? String(r.verified_by_user_id) : null,
      qualityScore: Number(r.quality_score || 0),
      qualityFlags: JSON.parse(String(r.quality_flags_json || '[]')),
      splitAssignment: (String(r.split_assignment || 'train') as DatasetSplit),
      consentForTraining: Number(r.consent_for_training) === 1,
      ownerUserId: r.owner_user_id ? String(r.owner_user_id) : null,
      retentionUntil: r.retention_until ? String(r.retention_until) : null,
      createdAt: String(r.created_at)
    };
  }
}
