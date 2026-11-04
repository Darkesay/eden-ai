import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDefaultTwoTierSafetyEnvelope,
  getDefaultDataRetentionConfig
} from './safetyDefaults.ts';
import { SqliteDriver } from './sqliteDriver.ts';
import { generateSecureId, sha256Hex } from './telemetryContract.ts';

export const SCHEMA_VERSION_V1 = 'v1_self_service_greenhouse_platform';
export const SCHEMA_VERSION_V2 = 'v2_hardware_states_and_nullable_sensors';
export const SCHEMA_VERSION_V3 = 'v3_phase1_intelligence_foundation';
export const SCHEMA_VERSION_V4 = 'v4_phase3_crop_intelligence_and_authorized_control';
export const SCHEMA_VERSION_V5 = 'v5_universal_iot_and_independent_intelligence';
export const LATEST_SCHEMA_VERSION = SCHEMA_VERSION_V5;

export interface DatabaseBackupManifest {
  sourcePath: string;
  backupPath: string;
  createdAt: string;
  sizeBytes: number;
  sha256: string;
  integrityCheck: string;
  appliedMigrations: string[];
  rowCounts: Record<string, number>;
}

export interface MigrationCopyTestResult {
  passed: boolean;
  sourcePath: string;
  preMigrationRowCounts: Record<string, number>;
  postMigrationRowCounts: Record<string, number>;
  postRollbackRowCounts: Record<string, number>;
  integrityOk: boolean;
  foreignKeysOk: boolean;
  appliedVersions: string[];
  durationMs: number;
}

export const MIGRATION_V1_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT
);

CREATE TABLE IF NOT EXISTS greenhouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_label TEXT NOT NULL,
  crop_type TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  wifi_provisioning_method TEXT NOT NULL,
  wifi_provisioning_state TEXT NOT NULL,
  wifi_ssid_hint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS greenhouse_members (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  added_by_user_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(greenhouse_id, user_id)
);

CREATE TABLE IF NOT EXISTS enrollment_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  purpose TEXT NOT NULL,
  greenhouse_id TEXT,
  kit_serial TEXT,
  kit_model TEXT,
  role_granted TEXT NOT NULL,
  created_by_user_id TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by_user_id TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  device_type TEXT NOT NULL,
  label TEXT NOT NULL,
  credential_hash TEXT UNIQUE,
  credential_prefix TEXT,
  provisioning_status TEXT NOT NULL,
  firmware_version TEXT,
  last_seen_at TEXT,
  last_telemetry_at TEXT,
  last_upload_at TEXT,
  last_error_category TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  last_error_at TEXT,
  last_ip TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry_readings (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  temperature REAL,
  humidity REAL,
  soil_moisture REAL,
  sunlight REAL,
  grow_light REAL,
  water_level REAL,
  battery_voltage REAL,
  rain_detected INTEGER,
  rain_gauge_level REAL,
  sensor_health_json TEXT NOT NULL,
  actuators_json TEXT NOT NULL,
  interlocks_json TEXT NOT NULL,
  device_health_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT,
  actor_user_id TEXT,
  actor_device_id TEXT,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  ip_address TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_observations (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  actor_user_id TEXT,
  category TEXT NOT NULL,
  data_source TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export const MIGRATION_V3_TABLES_SQL = `
-- 1. Multi-Zone Greenhouse Topology
CREATE TABLE IF NOT EXISTS greenhouse_zones (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  name TEXT NOT NULL,
  zone_type TEXT NOT NULL DEFAULT 'canopy_bay',
  crop_profile_id TEXT,
  active_crop_type TEXT,
  active_variety TEXT,
  growth_stage TEXT NOT NULL DEFAULT 'vegetative',
  planting_date TEXT,
  cultivation_method TEXT NOT NULL DEFAULT 'soil_bed',
  area_sqm REAL,
  safety_overrides_json TEXT NOT NULL DEFAULT '{}',
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_zones_greenhouse ON greenhouse_zones(greenhouse_id);

-- 2. Plug-and-Play Hardware Capability Manifests
CREATE TABLE IF NOT EXISTS device_capabilities (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  greenhouse_id TEXT NOT NULL,
  capability_kind TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  display_label TEXT NOT NULL,
  unit TEXT,
  min_safe_value REAL,
  max_safe_value REAL,
  max_duration_seconds INTEGER,
  cooldown_seconds INTEGER,
  calibration_json TEXT NOT NULL DEFAULT '{}',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(device_id, capability_kind, channel_key),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dev_caps_greenhouse ON device_capabilities(greenhouse_id, capability_kind);

-- 3. Device Firmware Version & OTA Readiness History
CREATE TABLE IF NOT EXISTS device_firmware_history (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  greenhouse_id TEXT NOT NULL,
  previous_version TEXT,
  reported_version TEXT NOT NULL,
  target_version TEXT,
  release_channel TEXT NOT NULL DEFAULT 'stable',
  sha256_digest TEXT,
  update_status TEXT NOT NULL DEFAULT 'reported',
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fw_hist_device ON device_firmware_history(device_id, recorded_at DESC);

-- 4. Physical & Simulated Equipment State-Change Events
CREATE TABLE IF NOT EXISTS equipment_events (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  device_id TEXT,
  actuator_key TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  previous_state TEXT,
  new_state TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  command_id TEXT,
  duration_seconds INTEGER,
  safety_context_json TEXT NOT NULL DEFAULT '{}',
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_equip_events_gh_time ON equipment_events(greenhouse_id, recorded_at DESC);

-- 5. Hourly Telemetry Rollups (Tier 2 Historical Analytics & Forecasting)
CREATE TABLE IF NOT EXISTS telemetry_rollups_hourly (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  device_id TEXT NOT NULL,
  bucket_start_iso TEXT NOT NULL,
  bucket_start_ms INTEGER NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  temp_min REAL,
  temp_max REAL,
  temp_avg REAL,
  humidity_min REAL,
  humidity_max REAL,
  humidity_avg REAL,
  soil_min REAL,
  soil_max REAL,
  soil_avg REAL,
  water_min REAL,
  water_avg REAL,
  sunlight_avg REAL,
  battery_min REAL,
  battery_avg REAL,
  vpd_avg REAL,
  rain_samples INTEGER NOT NULL DEFAULT 0,
  pump_active_samples INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(greenhouse_id, device_id, bucket_start_ms),
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rollup_hourly_gh_time ON telemetry_rollups_hourly(greenhouse_id, bucket_start_ms DESC);

-- 6. Daily Telemetry Rollups (Tier 3 Multi-Season Crop Learning)
CREATE TABLE IF NOT EXISTS telemetry_rollups_daily (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  device_id TEXT NOT NULL,
  day_date TEXT NOT NULL,
  bucket_start_ms INTEGER NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  temp_min REAL,
  temp_max REAL,
  temp_avg REAL,
  humidity_min REAL,
  humidity_max REAL,
  humidity_avg REAL,
  soil_min REAL,
  soil_max REAL,
  soil_avg REAL,
  water_min REAL,
  water_avg REAL,
  sunlight_avg REAL,
  gdd_base10 REAL NOT NULL DEFAULT 0,
  rain_samples INTEGER NOT NULL DEFAULT 0,
  pump_active_samples INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(greenhouse_id, device_id, day_date),
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rollup_daily_gh_day ON telemetry_rollups_daily(greenhouse_id, bucket_start_ms DESC);

-- 7. Configurable Per-Greenhouse Tiered Data Retention Policies
CREATE TABLE IF NOT EXISTS data_retention_policies (
  greenhouse_id TEXT PRIMARY KEY,
  raw_telemetry_days INTEGER NOT NULL DEFAULT 90,
  hourly_rollup_days INTEGER NOT NULL DEFAULT 365,
  daily_rollup_days INTEGER NOT NULL DEFAULT 1825,
  ai_observation_days INTEGER NOT NULL DEFAULT 365,
  audit_log_days INTEGER NOT NULL DEFAULT 1825,
  routine_camera_max_files INTEGER NOT NULL DEFAULT 48,
  routine_camera_max_days INTEGER NOT NULL DEFAULT 1,
  curated_dataset_max_files INTEGER NOT NULL DEFAULT 500,
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);

-- 8. Central Evidence-Backed Crop Knowledge Profiles
CREATE TABLE IF NOT EXISTS crop_knowledge_profiles (
  id TEXT PRIMARY KEY,
  crop_code TEXT NOT NULL,
  common_name TEXT NOT NULL,
  local_names_json TEXT NOT NULL DEFAULT '[]',
  scientific_name TEXT NOT NULL,
  variety TEXT NOT NULL DEFAULT 'Standard',
  cultivation_method TEXT NOT NULL DEFAULT 'soil_bed',
  standard_days_to_harvest INTEGER NOT NULL,
  summary TEXT NOT NULL,
  risk_profile_json TEXT NOT NULL DEFAULT '{}',
  evidence_references_json TEXT NOT NULL DEFAULT '[]',
  confidence_level TEXT NOT NULL DEFAULT 'extension_verified',
  validation_status TEXT NOT NULL DEFAULT 'verified',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(crop_code, variety, cultivation_method)
);
CREATE INDEX IF NOT EXISTS idx_crop_profiles_code ON crop_knowledge_profiles(crop_code);

-- 9. Growth-Stage-Specific Environmental & Fertigation Standards
CREATE TABLE IF NOT EXISTS crop_growth_stage_standards (
  id TEXT PRIMARY KEY,
  crop_profile_id TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  day_start INTEGER NOT NULL,
  day_end INTEGER NOT NULL,
  temp_min_c REAL NOT NULL,
  temp_max_c REAL NOT NULL,
  temp_optimal_c REAL,
  humidity_min_pct REAL NOT NULL,
  humidity_max_pct REAL NOT NULL,
  soil_moisture_min_pct REAL NOT NULL,
  soil_moisture_max_pct REAL NOT NULL,
  vpd_min_kpa REAL,
  vpd_max_kpa REAL,
  light_dli_min REAL,
  light_dli_max REAL,
  ph_min REAL,
  ph_max REAL,
  ec_min_ms REAL,
  ec_max_ms REAL,
  irrigation_notes TEXT,
  citation_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(crop_profile_id, stage_name),
  FOREIGN KEY (crop_profile_id) REFERENCES crop_knowledge_profiles(id) ON DELETE CASCADE
);

-- 10. Versioned Per-Greenhouse Crop Standards & Rollback History
CREATE TABLE IF NOT EXISTS crop_standard_versions (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  crop_profile_id TEXT,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  thresholds_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  references_json TEXT NOT NULL DEFAULT '[]',
  proposed_by TEXT NOT NULL,
  approved_by_user_id TEXT,
  rollback_of_version_id TEXT,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_crop_std_versions_gh ON crop_standard_versions(greenhouse_id, version_number DESC);

-- 11. Three-Mode Farmer Authorization Policies
CREATE TABLE IF NOT EXISTS farmer_authorization_policies (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  mode TEXT NOT NULL,
  crop_type TEXT NOT NULL,
  equipment_key TEXT NOT NULL,
  permitted_action TEXT NOT NULL,
  thresholds_json TEXT NOT NULL DEFAULT '{}',
  max_duration_seconds INTEGER NOT NULL,
  cooldown_seconds INTEGER NOT NULL DEFAULT 300,
  max_daily_cumulative_seconds INTEGER NOT NULL DEFAULT 900,
  operating_conditions_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT,
  review_required_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_user_id TEXT NOT NULL,
  revoked_by_user_id TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auth_policies_gh_status ON farmer_authorization_policies(greenhouse_id, status);

-- 12. Structured Explainable AI Recommendations
CREATE TABLE IF NOT EXISTS ai_recommendations (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  agent_name TEXT NOT NULL,
  category TEXT NOT NULL,
  observation_summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  confidence_score REAL NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'low',
  proposed_action_json TEXT NOT NULL DEFAULT '{}',
  expected_outcome_json TEXT NOT NULL DEFAULT '{}',
  fallback_plan TEXT,
  model_version_id TEXT,
  requires_farmer_approval INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_rec_gh_status ON ai_recommendations(greenhouse_id, status, created_at DESC);

-- 13. Farmer Approval / Rejection / Modification / Emergency-Stop Decisions
CREATE TABLE IF NOT EXISTS farmer_decisions (
  id TEXT PRIMARY KEY,
  recommendation_id TEXT,
  policy_id TEXT,
  greenhouse_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  modified_parameters_json TEXT NOT NULL DEFAULT '{}',
  rationale TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_farmer_decisions_gh ON farmer_decisions(greenhouse_id, created_at DESC);

-- 14. Bounded Cloud-to-Edge Hardware Command Queue
CREATE TABLE IF NOT EXISTS hardware_command_queue (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  device_id TEXT NOT NULL,
  recommendation_id TEXT,
  policy_id TEXT,
  authorized_by_user_id TEXT,
  authorization_mode TEXT NOT NULL,
  command_type TEXT NOT NULL,
  target_equipment TEXT NOT NULL,
  parameters_json TEXT NOT NULL DEFAULT '{}',
  safety_tier_snapshot_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  sequence_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  expires_at TEXT NOT NULL,
  dispatched_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cmd_queue_device_status ON hardware_command_queue(device_id, status, sequence_no ASC);
CREATE INDEX IF NOT EXISTS idx_cmd_queue_gh_time ON hardware_command_queue(greenhouse_id, created_at DESC);

-- 15. Physical Controller Command Execution Acknowledgements
CREATE TABLE IF NOT EXISTS equipment_acknowledgements (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  greenhouse_id TEXT NOT NULL,
  ack_status TEXT NOT NULL,
  firmware_version TEXT,
  pre_state_json TEXT NOT NULL DEFAULT '{}',
  post_state_json TEXT NOT NULL DEFAULT '{}',
  interlocks_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  received_at TEXT NOT NULL,
  FOREIGN KEY (command_id) REFERENCES hardware_command_queue(id) ON DELETE CASCADE,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_equip_acks_cmd ON equipment_acknowledgements(command_id);

-- 16. Closed-Loop Post-Action Sensor Outcome Verification
CREATE TABLE IF NOT EXISTS outcome_verifications (
  id TEXT PRIMARY KEY,
  command_id TEXT,
  recommendation_id TEXT,
  greenhouse_id TEXT NOT NULL,
  verification_window_seconds INTEGER NOT NULL,
  baseline_metrics_json TEXT NOT NULL DEFAULT '{}',
  observed_metrics_json TEXT NOT NULL DEFAULT '{}',
  expected_delta_json TEXT NOT NULL DEFAULT '{}',
  actual_delta_json TEXT NOT NULL DEFAULT '{}',
  outcome_status TEXT NOT NULL DEFAULT 'pending',
  effectiveness_score REAL,
  notes TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_outcome_verif_gh ON outcome_verifications(greenhouse_id, created_at DESC);

-- 17. Structured Plant Vision Inspections
CREATE TABLE IF NOT EXISTS plant_inspections (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  device_id TEXT,
  image_frame_id TEXT,
  image_sha256 TEXT,
  curated_dataset_flag INTEGER NOT NULL DEFAULT 0,
  retention_tier TEXT NOT NULL DEFAULT 'routine_ephemeral',
  crop_type TEXT NOT NULL,
  growth_stage_detected TEXT,
  health_status TEXT NOT NULL,
  primary_condition TEXT,
  confidence_score REAL,
  expert_confirmation_required INTEGER NOT NULL DEFAULT 0,
  differential_causes_json TEXT NOT NULL DEFAULT '[]',
  visual_evidence_json TEXT NOT NULL DEFAULT '{}',
  recommendation_summary TEXT NOT NULL,
  model_version_id TEXT,
  verified_by_user_id TEXT,
  verified_label TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_plant_inspections_gh ON plant_inspections(greenhouse_id, created_at DESC);

-- 18. Curated Agricultural Training Dataset Manifest
CREATE TABLE IF NOT EXISTS curated_dataset_samples (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  sample_type TEXT NOT NULL,
  source_record_id TEXT,
  storage_rel_path TEXT,
  sha256 TEXT NOT NULL,
  crop_type TEXT NOT NULL,
  variety TEXT,
  growth_stage TEXT,
  ground_truth_label TEXT,
  label_confidence REAL,
  verified_by_user_id TEXT,
  consent_for_training INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_curated_samples_gh ON curated_dataset_samples(greenhouse_id, sample_type, created_at DESC);

-- 19. Crop Cycles & Harvest Outcomes
CREATE TABLE IF NOT EXISTS harvest_cycles (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  crop_profile_id TEXT,
  crop_type TEXT NOT NULL,
  variety TEXT,
  cultivation_method TEXT NOT NULL DEFAULT 'soil_bed',
  planting_date TEXT NOT NULL,
  expected_harvest_date TEXT,
  actual_harvest_date TEXT,
  current_growth_stage TEXT NOT NULL DEFAULT 'seedling',
  plant_count INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  yield_kg REAL,
  marketable_yield_kg REAL,
  quality_grade TEXT,
  water_used_liters REAL,
  energy_used_kwh REAL,
  disease_incidents_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_harvest_cycles_gh ON harvest_cycles(greenhouse_id, status, planting_date DESC);

-- 20. Longitudinal Crop Growth Measurements
CREATE TABLE IF NOT EXISTS crop_growth_records (
  id TEXT PRIMARY KEY,
  harvest_cycle_id TEXT NOT NULL,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  recorded_at TEXT NOT NULL,
  days_after_planting INTEGER NOT NULL,
  growth_stage TEXT NOT NULL,
  canopy_height_cm REAL,
  leaf_count_estimate INTEGER,
  flower_count_estimate INTEGER,
  fruit_count_estimate INTEGER,
  stress_index REAL,
  gdd_accumulated REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  FOREIGN KEY (harvest_cycle_id) REFERENCES harvest_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_crop_growth_cycle ON crop_growth_records(harvest_cycle_id, recorded_at DESC);

-- 21. Verified Farm-Specific Learning Memory
CREATE TABLE IF NOT EXISTS agricultural_learning_records (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  harvest_cycle_id TEXT,
  learning_domain TEXT NOT NULL,
  feature_context_json TEXT NOT NULL DEFAULT '{}',
  action_taken_json TEXT NOT NULL DEFAULT '{}',
  verified_outcome_json TEXT NOT NULL DEFAULT '{}',
  lesson_summary TEXT NOT NULL,
  confidence_delta REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ag_learning_gh ON agricultural_learning_records(greenhouse_id, learning_domain, created_at DESC);

-- 22. Deep Learning Model Version Registry (Foundation Only)
CREATE TABLE IF NOT EXISTS ml_model_versions (
  id TEXT PRIMARY KEY,
  model_family TEXT NOT NULL,
  model_name TEXT NOT NULL,
  version_tag TEXT NOT NULL,
  framework TEXT NOT NULL,
  artifact_path TEXT,
  artifact_sha256 TEXT,
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  output_schema_json TEXT NOT NULL DEFAULT '{}',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  calibration_json TEXT NOT NULL DEFAULT '{}',
  fallback_rule_id TEXT NOT NULL,
  deployment_stage TEXT NOT NULL DEFAULT 'registered',
  created_at TEXT NOT NULL,
  activated_at TEXT,
  UNIQUE(model_family, model_name, version_tag)
);

-- 23. Deep Learning Training Runs & Evaluation Logs (Foundation Only)
CREATE TABLE IF NOT EXISTS ml_training_runs (
  id TEXT PRIMARY KEY,
  model_version_id TEXT,
  model_family TEXT NOT NULL,
  dataset_snapshot_json TEXT NOT NULL DEFAULT '{}',
  hyperparameters_json TEXT NOT NULL DEFAULT '{}',
  train_metrics_json TEXT NOT NULL DEFAULT '{}',
  validation_metrics_json TEXT NOT NULL DEFAULT '{}',
  test_metrics_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  notes TEXT,
  FOREIGN KEY (model_version_id) REFERENCES ml_model_versions(id) ON DELETE SET NULL
);

-- 24. Reinforcement Learning Policy Registry (Foundation Only)
CREATE TABLE IF NOT EXISTS rl_policies (
  id TEXT PRIMARY KEY,
  policy_name TEXT NOT NULL,
  version_tag TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  state_spec_json TEXT NOT NULL DEFAULT '{}',
  action_spec_json TEXT NOT NULL DEFAULT '{}',
  reward_weights_json TEXT NOT NULL DEFAULT '{}',
  safety_bounds_json TEXT NOT NULL DEFAULT '{}',
  artifact_path TEXT,
  artifact_sha256 TEXT,
  benchmark_vs_baseline_json TEXT NOT NULL DEFAULT '{}',
  approval_status TEXT NOT NULL DEFAULT 'simulated_only',
  approved_by_user_id TEXT,
  rollback_policy_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(policy_name, version_tag)
);

-- 25. Digital Twin Simulation Experiments (Foundation Only)
CREATE TABLE IF NOT EXISTS simulation_experiments (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT,
  rl_policy_id TEXT,
  scenario_name TEXT NOT NULL,
  weather_profile TEXT NOT NULL,
  crop_type TEXT NOT NULL,
  duration_sim_days INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  baseline_metrics_json TEXT NOT NULL DEFAULT '{}',
  policy_metrics_json TEXT NOT NULL DEFAULT '{}',
  safety_violations_count INTEGER NOT NULL DEFAULT 0,
  water_saved_pct REAL,
  energy_saved_pct REAL,
  stress_reduction_pct REAL,
  passed_safety_gate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (rl_policy_id) REFERENCES rl_policies(id) ON DELETE SET NULL
);

-- High-Performance Indexes on Existing Core Tables
CREATE INDEX IF NOT EXISTS idx_telemetry_gh_time ON telemetry_readings(greenhouse_id, received_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON telemetry_readings(device_id, received_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_gh_time ON audit_events(greenhouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_obs_gh_time ON ai_observations(greenhouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_devices_gh_type ON devices(greenhouse_id, device_type);

-- Append-Only Immutability Triggers on audit_events
CREATE TRIGGER IF NOT EXISTS trg_audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'APPEND_ONLY_VIOLATION: audit_events records are immutable and cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'APPEND_ONLY_VIOLATION: audit_events records are immutable and cannot be deleted');
END;
`;

export const V3_ADDED_TABLES = [
  'simulation_experiments',
  'rl_policies',
  'ml_training_runs',
  'ml_model_versions',
  'agricultural_learning_records',
  'crop_growth_records',
  'harvest_cycles',
  'curated_dataset_samples',
  'plant_inspections',
  'outcome_verifications',
  'equipment_acknowledgements',
  'hardware_command_queue',
  'farmer_decisions',
  'ai_recommendations',
  'farmer_authorization_policies',
  'crop_standard_versions',
  'crop_growth_stage_standards',
  'crop_knowledge_profiles',
  'data_retention_policies',
  'telemetry_rollups_daily',
  'telemetry_rollups_hourly',
  'equipment_events',
  'device_firmware_history',
  'device_capabilities',
  'greenhouse_zones'
] as const;

export const MIGRATION_V5_TABLES_SQL = `
-- 1. Normalized IoT Sensor Registry (Universal Device Adapter)
CREATE TABLE IF NOT EXISTS iot_sensor_registry (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  sensor_id TEXT NOT NULL,
  sensor_type TEXT NOT NULL,
  display_label TEXT NOT NULL,
  unit TEXT NOT NULL,
  protocol_topic_or_path TEXT,
  last_value REAL,
  last_quality TEXT NOT NULL DEFAULT 'unknown',
  last_source TEXT NOT NULL DEFAULT 'unknown',
  last_timestamp TEXT,
  discovery_origin TEXT NOT NULL DEFAULT 'reported',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE(device_id, sensor_id),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_iot_sensors_gh ON iot_sensor_registry(greenhouse_id, device_id);

-- 2. Normalized IoT Camera Registry
CREATE TABLE IF NOT EXISTS iot_camera_registry (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  camera_id TEXT NOT NULL,
  stream_url TEXT,
  photo_url TEXT,
  status_url TEXT,
  transport_mode TEXT NOT NULL DEFAULT 'cloud_upload',
  last_frame_id TEXT,
  last_frame_sha256 TEXT,
  last_capture_at TEXT,
  connection_state TEXT NOT NULL DEFAULT 'disconnected',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE(device_id, camera_id),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_iot_cameras_gh ON iot_camera_registry(greenhouse_id);

-- 3. IoT Device Connection & Reconnection Transition History
CREATE TABLE IF NOT EXISTS iot_device_connection_history (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  greenhouse_id TEXT NOT NULL,
  protocol TEXT NOT NULL,
  previous_state TEXT,
  new_state TEXT NOT NULL,
  reason TEXT,
  remote_addr TEXT,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_iot_conn_hist_dev ON iot_device_connection_history(device_id, recorded_at DESC);

-- 4. External / Embedded IoT Platform Integration Configuration
CREATE TABLE IF NOT EXISTS iot_integration_configs (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  platform_kind TEXT NOT NULL,
  endpoint_url TEXT,
  protocol_mode TEXT NOT NULL DEFAULT 'mqtt_ws',
  auth_mode TEXT NOT NULL DEFAULT 'device_key_sha256',
  credential_prefix TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'ready',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(greenhouse_id, platform_kind),
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);

-- 5. Authoritative Agricultural Disease, Pest, Nutrient & Stress Knowledge Cards
CREATE TABLE IF NOT EXISTS agricultural_diagnostic_knowledge (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  crop_codes_json TEXT NOT NULL DEFAULT '[]',
  growth_stages_json TEXT NOT NULL DEFAULT '[]',
  causal_agent TEXT,
  symptoms_json TEXT NOT NULL DEFAULT '[]',
  environmental_triggers_json TEXT NOT NULL DEFAULT '{}',
  differential_diagnosis_json TEXT NOT NULL DEFAULT '[]',
  prevention_options_json TEXT NOT NULL DEFAULT '[]',
  treatment_options_json TEXT NOT NULL DEFAULT '[]',
  harvest_impact TEXT,
  geographic_applicability_json TEXT NOT NULL DEFAULT '[]',
  source_organization TEXT NOT NULL,
  source_citation TEXT NOT NULL,
  publication_date TEXT NOT NULL,
  confidence_level TEXT NOT NULL DEFAULT 'verified_reference',
  validation_status TEXT NOT NULL DEFAULT 'verified',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ag_diag_category ON agricultural_diagnostic_knowledge(category);

-- 6. Multi-Modal 10-Category Agricultural Dataset Records (Provenance, Dedup, Splits, Consent)
CREATE TABLE IF NOT EXISTS agricultural_dataset_records (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  zone_id TEXT,
  category TEXT NOT NULL,
  crop_code TEXT NOT NULL,
  variety TEXT,
  growth_stage TEXT,
  provenance_source TEXT NOT NULL,
  source_record_id TEXT,
  payload_sha256 TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  storage_rel_path TEXT,
  label_value TEXT,
  label_status TEXT NOT NULL DEFAULT 'unverified_observation',
  verified_by_user_id TEXT,
  quality_score REAL NOT NULL DEFAULT 1.0,
  quality_flags_json TEXT NOT NULL DEFAULT '[]',
  split_assignment TEXT NOT NULL DEFAULT 'unassigned',
  consent_for_training INTEGER NOT NULL DEFAULT 1,
  owner_user_id TEXT,
  retention_until TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(greenhouse_id, category, payload_sha256),
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ag_ds_rec_gh_cat ON agricultural_dataset_records(greenhouse_id, category, split_assignment);

-- 7. Immutable Versioned Agricultural Dataset Snapshots
CREATE TABLE IF NOT EXISTS agricultural_dataset_versions (
  id TEXT PRIMARY KEY,
  greenhouse_id TEXT NOT NULL,
  dataset_name TEXT NOT NULL,
  version_tag TEXT NOT NULL,
  categories_json TEXT NOT NULL DEFAULT '[]',
  total_records INTEGER NOT NULL DEFAULT 0,
  train_count INTEGER NOT NULL DEFAULT 0,
  validation_count INTEGER NOT NULL DEFAULT 0,
  test_count INTEGER NOT NULL DEFAULT 0,
  manifest_sha256 TEXT NOT NULL,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(greenhouse_id, dataset_name, version_tag),
  FOREIGN KEY (greenhouse_id) REFERENCES greenhouses(id) ON DELETE CASCADE
);
`;

export const V5_ADDED_TABLES = [
  'agricultural_dataset_versions',
  'agricultural_dataset_records',
  'agricultural_diagnostic_knowledge',
  'iot_integration_configs',
  'iot_device_connection_history',
  'iot_camera_registry',
  'iot_sensor_registry'
] as const;

export function getTableRowCounts(driver: SqliteDriver): Record<string, number> {
  const tables = driver.queryAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
  );
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const safeIdent = String(t.name).replace(/"/g, '""');
    const row = driver.queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM "${safeIdent}"`);
    counts[String(t.name)] = Number(row?.c || 0);
  }
  return counts;
}

function addColumnIfMissing(driver: SqliteDriver, tableName: string, columnName: string, definitionSql: string): void {
  const safeIdent = tableName.replace(/"/g, '""');
  const existingCols = new Set(
    driver.queryAll<{ name: string }>(`PRAGMA table_info("${safeIdent}")`).map((c) => String(c.name))
  );
  if (!existingCols.has(columnName)) {
    driver.exec(`ALTER TABLE "${safeIdent}" ADD COLUMN ${columnName} ${definitionSql};`, false);
  }
}

/**
 * Creates a cryptographically verified single-file SQLite backup + `.manifest.json`
 * sidecar before applying schema migrations.
 */
export async function createVerifiedDatabaseBackup(
  dbFilePath: string,
  options: { backupDir?: string; label?: string } = {}
): Promise<DatabaseBackupManifest | null> {
  if (!fs.existsSync(dbFilePath)) {
    return null;
  }

  const backupDir = options.backupDir || path.join(path.dirname(dbFilePath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = path.basename(dbFilePath, path.extname(dbFilePath));
  const label = options.label ? `.${options.label}` : '';
  const backupPath = path.join(backupDir, `${baseName}${label}.backup-${ts}.sqlite`);

  // Open source cleanly to consolidate any pending WAL frames into the backup via exportCleanCopyTo
  const srcDriver = new SqliteDriver({ dbFilePath });
  await srcDriver.open();
  let srcCounts: Record<string, number> = {};
  let appliedMigrations: string[] = [];
  try {
    srcCounts = getTableRowCounts(srcDriver);
    if ('schema_migrations' in srcCounts) {
      appliedMigrations = srcDriver
        .queryAll<{ version: string }>('SELECT version FROM schema_migrations ORDER BY applied_at ASC')
        .map((r) => String(r.version));
    }
    srcDriver.exportCleanCopyTo(backupPath);
  } finally {
    srcDriver.close();
  }

  const verified = await verifyDatabaseBackup(backupPath, srcCounts);
  const manifest: DatabaseBackupManifest = {
    sourcePath: dbFilePath,
    backupPath,
    createdAt: new Date().toISOString(),
    sizeBytes: verified.sizeBytes,
    sha256: verified.sha256,
    integrityCheck: verified.integrityCheck,
    appliedMigrations,
    rowCounts: verified.rowCounts
  };

  fs.writeFileSync(`${backupPath}.manifest.json`, JSON.stringify(manifest, null, 2));
  return manifest;
}

/**
 * Verifies a backup SQLite file's SHA-256 digest, `PRAGMA integrity_check`, and exact row counts.
 */
export async function verifyDatabaseBackup(
  backupPath: string,
  expectedRowCounts?: Record<string, number>
): Promise<{
  ok: boolean;
  sizeBytes: number;
  sha256: string;
  integrityCheck: string;
  rowCounts: Record<string, number>;
}> {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file does not exist: ${backupPath}`);
  }
  const bytes = fs.readFileSync(backupPath);
  if (bytes.length === 0) {
    throw new Error(`Backup file is empty: ${backupPath}`);
  }
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

  const verifyDriver = new SqliteDriver({ dbFilePath: backupPath, readOnly: true });
  await verifyDriver.open();
  try {
    const integrity = verifyDriver.integrityCheck();
    if (!integrity.ok) {
      throw new Error(`Backup integrity_check failed: ${integrity.details.join(', ')}`);
    }
    const rowCounts = getTableRowCounts(verifyDriver);
    if (expectedRowCounts) {
      for (const [table, expectedCount] of Object.entries(expectedRowCounts)) {
        if (rowCounts[table] !== expectedCount) {
          throw new Error(
            `Backup row count mismatch on table "${table}": expected ${expectedCount}, found ${rowCounts[table]}`
          );
        }
      }
    }
    return {
      ok: true,
      sizeBytes: bytes.length,
      sha256,
      integrityCheck: integrity.details[0] || 'ok',
      rowCounts
    };
  } finally {
    verifyDriver.close();
  }
}

/**
 * Restores a database atomically from a verified backup, clearing stale `-wal` and `-shm` sidecars.
 */
export async function restoreDatabaseFromVerifiedBackup(
  backupPath: string,
  targetDbFilePath: string
): Promise<{ restoredSha256: string; rowCounts: Record<string, number> }> {
  const verified = await verifyDatabaseBackup(backupPath);
  fs.mkdirSync(path.dirname(targetDbFilePath), { recursive: true });

  const tmpRestorePath = `${targetDbFilePath}.restore-tmp`;
  fs.copyFileSync(backupPath, tmpRestorePath);

  // Remove any active WAL/SHM files before atomic swap so SQLite opens the exact restored state
  fs.rmSync(`${targetDbFilePath}-wal`, { force: true });
  fs.rmSync(`${targetDbFilePath}-shm`, { force: true });
  fs.renameSync(tmpRestorePath, targetDbFilePath);

  const postCheck = await verifyDatabaseBackup(targetDbFilePath, verified.rowCounts);
  return {
    restoredSha256: postCheck.sha256,
    rowCounts: postCheck.rowCounts
  };
}

/**
 * Applies all pending schema migrations (`v1` -> `v2` -> `v3`) atomically.
 * Automatically backs up existing persistent databases before applying new migrations.
 */
export async function applyPlatformMigrations(
  driver: SqliteDriver,
  options: {
    inMemoryOnly?: boolean;
    skipAutoBackup?: boolean;
  } = {}
): Promise<{ appliedNow: string[]; backupManifest: DatabaseBackupManifest | null }> {
  const appliedNow: string[] = [];
  let backupManifest: DatabaseBackupManifest | null = null;

  // Check whether an on-disk database exists and needs migration before mutating it
  const dbPath = driver.getDbFilePath();
  const hasExistingSchemaTable = Boolean(
    driver.queryOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    )
  );
  const existingVersions = new Set<string>(
    hasExistingSchemaTable
      ? driver.queryAll<{ version: string }>('SELECT version FROM schema_migrations').map((r) => String(r.version))
      : []
  );

  const needsMigrationOnExistingDb =
    !options.inMemoryOnly &&
    !options.skipAutoBackup &&
    hasExistingSchemaTable &&
    !existingVersions.has(LATEST_SCHEMA_VERSION) &&
    fs.existsSync(dbPath);

  if (needsMigrationOnExistingDb) {
    // Export a verified backup directly from the open driver before running pending DDL
    const backupDir = path.join(path.dirname(dbPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = path.basename(dbPath, path.extname(dbPath));
    const preTag = existingVersions.has(SCHEMA_VERSION_V4)
      ? 'auto-pre-v5'
      : existingVersions.has(SCHEMA_VERSION_V3)
        ? 'auto-pre-v4'
        : 'auto-pre-v3';
    const backupPath = path.join(backupDir, `${baseName}.${preTag}.backup-${ts}.sqlite`);
    const preCounts = getTableRowCounts(driver);
    driver.exportCleanCopyTo(backupPath);
    const verified = await verifyDatabaseBackup(backupPath, preCounts);
    backupManifest = {
      sourcePath: dbPath,
      backupPath,
      createdAt: new Date().toISOString(),
      sizeBytes: verified.sizeBytes,
      sha256: verified.sha256,
      integrityCheck: verified.integrityCheck,
      appliedMigrations: Array.from(existingVersions),
      rowCounts: verified.rowCounts
    };
    fs.writeFileSync(`${backupPath}.manifest.json`, JSON.stringify(backupManifest, null, 2));
  }

  // Ensure base v1 tables exist
  driver.runInTransaction(() => {
    driver.exec(MIGRATION_V1_SQL, false);

    addColumnIfMissing(driver, 'schema_migrations', 'description', 'TEXT');
    addColumnIfMissing(driver, 'schema_migrations', 'checksum', 'TEXT');
    addColumnIfMissing(driver, 'schema_migrations', 'execution_ms', 'INTEGER');

    if (!existingVersions.has(SCHEMA_VERSION_V1)) {
      driver.run(
        `INSERT INTO schema_migrations (version, applied_at, description, checksum, execution_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          SCHEMA_VERSION_V1,
          new Date().toISOString(),
          'Self-service greenhouse platform core tables',
          sha256Hex(MIGRATION_V1_SQL).slice(0, 16),
          0
        ],
        false
      );
      existingVersions.add(SCHEMA_VERSION_V1);
      appliedNow.push(SCHEMA_VERSION_V1);
    }

    if (!existingVersions.has(SCHEMA_VERSION_V2)) {
      const startV2 = Date.now();
      addColumnIfMissing(driver, 'devices', 'last_telemetry_at', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'last_upload_at', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'last_error_category', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'last_error_code', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'last_error_message', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'last_error_at', 'TEXT');

      const telCols = driver.queryAll<{ name: string; notnull: number }>('PRAGMA table_info("telemetry_readings")');
      const needsNullableUpgrade = telCols.some(
        (c) =>
          ['temperature', 'humidity', 'soil_moisture', 'rain_detected'].includes(String(c.name)) &&
          Number(c.notnull) === 1
      );
      if (needsNullableUpgrade) {
        driver.exec(
          `
          ALTER TABLE telemetry_readings RENAME TO telemetry_readings_legacy;
          CREATE TABLE telemetry_readings (
            id TEXT PRIMARY KEY,
            greenhouse_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            received_at_ms INTEGER NOT NULL,
            temperature REAL,
            humidity REAL,
            soil_moisture REAL,
            sunlight REAL,
            grow_light REAL,
            water_level REAL,
            battery_voltage REAL,
            rain_detected INTEGER,
            rain_gauge_level REAL,
            sensor_health_json TEXT NOT NULL,
            actuators_json TEXT NOT NULL,
            interlocks_json TEXT NOT NULL,
            device_health_json TEXT NOT NULL
          );
          INSERT INTO telemetry_readings SELECT * FROM telemetry_readings_legacy;
          DROP TABLE telemetry_readings_legacy;
          `,
          false
        );
      }

      driver.run(
        `INSERT INTO schema_migrations (version, applied_at, description, checksum, execution_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          SCHEMA_VERSION_V2,
          new Date().toISOString(),
          'Explicit hardware states and nullable sensor readings',
          'v2_nullable_sensors',
          Date.now() - startV2
        ],
        false
      );
      existingVersions.add(SCHEMA_VERSION_V2);
      appliedNow.push(SCHEMA_VERSION_V2);
    }

    if (!existingVersions.has(SCHEMA_VERSION_V3)) {
      const startV3 = Date.now();
      const defaultSafetyStr = JSON.stringify(createDefaultTwoTierSafetyEnvelope());
      const defaultRetention = getDefaultDataRetentionConfig();

      // Non-destructive column additions on existing v1/v2 tables
      addColumnIfMissing(driver, 'users', 'is_guest', 'INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing(driver, 'users', 'account_status', "TEXT NOT NULL DEFAULT 'active'");
      addColumnIfMissing(driver, 'users', 'preferences_json', "TEXT NOT NULL DEFAULT '{}'");

      addColumnIfMissing(driver, 'greenhouses', 'timezone', "TEXT NOT NULL DEFAULT 'Africa/Lagos'");
      addColumnIfMissing(driver, 'greenhouses', 'area_sqm', 'REAL');
      addColumnIfMissing(driver, 'greenhouses', 'cultivation_method', "TEXT NOT NULL DEFAULT 'soil_bed'");
      addColumnIfMissing(
        driver,
        'greenhouses',
        'authorization_mode',
        "TEXT NOT NULL DEFAULT 'mode_1_individual'"
      );
      addColumnIfMissing(driver, 'greenhouses', 'emergency_stop_active', 'INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing(driver, 'greenhouses', 'emergency_stop_reason', 'TEXT');
      addColumnIfMissing(driver, 'greenhouses', 'emergency_stop_at', 'TEXT');
      addColumnIfMissing(driver, 'greenhouses', 'safety_defaults_json', "TEXT NOT NULL DEFAULT '{}'");

      addColumnIfMissing(driver, 'devices', 'zone_id', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'serial_number', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'hardware_identity_uid', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'mac_address', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'capabilities_json', "TEXT NOT NULL DEFAULT '{}'");
      addColumnIfMissing(driver, 'devices', 'target_firmware_version', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'ota_status', "TEXT NOT NULL DEFAULT 'idle'");
      addColumnIfMissing(driver, 'devices', 'replaced_by_device_id', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'credential_rotated_at', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'health_metrics_json', "TEXT NOT NULL DEFAULT '{}'");

      addColumnIfMissing(driver, 'telemetry_readings', 'zone_id', 'TEXT');
      addColumnIfMissing(driver, 'telemetry_readings', 'vpd_kpa', 'REAL');
      addColumnIfMissing(driver, 'telemetry_readings', 'par_umol', 'REAL');
      addColumnIfMissing(driver, 'telemetry_readings', 'co2_ppm', 'REAL');
      addColumnIfMissing(driver, 'telemetry_readings', 'ph', 'REAL');
      addColumnIfMissing(driver, 'telemetry_readings', 'ec_ms_cm', 'REAL');
      addColumnIfMissing(driver, 'telemetry_readings', 'quality_flag', "TEXT NOT NULL DEFAULT 'VALID'");
      addColumnIfMissing(driver, 'telemetry_readings', 'anomaly_score', 'REAL');

      // Create all 25 future-proof foundation tables, indexes, and append-only audit triggers
      driver.exec(MIGRATION_V3_TABLES_SQL, false);

      // Backfill guest account flags on any existing preview guest users
      driver.run(
        "UPDATE users SET is_guest = 1 WHERE email LIKE 'guest-%@preview.edens-ai.local'",
        [],
        false
      );

      // Backfill default safety envelope, primary zone, and retention policy for any existing greenhouses
      const existingGhs = driver.queryAll<{
        id: string;
        crop_type: string;
        safety_defaults_json: string;
        created_at: string;
      }>('SELECT id, crop_type, safety_defaults_json, created_at FROM greenhouses');

      const nowIso = new Date().toISOString();
      for (const gh of existingGhs) {
        if (!gh.safety_defaults_json || gh.safety_defaults_json === '{}') {
          driver.run(
            'UPDATE greenhouses SET safety_defaults_json = ? WHERE id = ?',
            [defaultSafetyStr, gh.id],
            false
          );
        }

        const hasZone = driver.queryOne<{ id: string }>(
          'SELECT id FROM greenhouse_zones WHERE greenhouse_id = ? LIMIT 1',
          [gh.id]
        );
        if (!hasZone) {
          const zoneId = generateSecureId('zone', 6);
          driver.run(
            `INSERT INTO greenhouse_zones (
               id, greenhouse_id, name, zone_type, active_crop_type, growth_stage,
               cultivation_method, safety_overrides_json, is_primary, created_at, updated_at
             ) VALUES (?, ?, 'Main Canopy Bay', 'canopy_bay', ?, 'vegetative', 'soil_bed', '{}', 1, ?, ?)`,
            [zoneId, gh.id, gh.crop_type || 'Tomato', gh.created_at || nowIso, nowIso],
            false
          );
          driver.run(
            'UPDATE devices SET zone_id = ? WHERE greenhouse_id = ? AND zone_id IS NULL',
            [zoneId, gh.id],
            false
          );
        }

        driver.run(
          `INSERT OR IGNORE INTO data_retention_policies (
             greenhouse_id, raw_telemetry_days, hourly_rollup_days, daily_rollup_days,
             ai_observation_days, audit_log_days, routine_camera_max_files,
             routine_camera_max_days, curated_dataset_max_files, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            gh.id,
            defaultRetention.rawTelemetryDays,
            defaultRetention.hourlyRollupDays,
            defaultRetention.dailyRollupDays,
            defaultRetention.aiObservationDays,
            defaultRetention.auditLogDays,
            defaultRetention.routineCameraMaxFiles,
            defaultRetention.routineCameraMaxDays,
            defaultRetention.curatedDatasetMaxFiles,
            nowIso
          ],
          false
        );
      }

      driver.run(
        `INSERT INTO schema_migrations (version, applied_at, description, checksum, execution_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          SCHEMA_VERSION_V3,
          nowIso,
          'Phase 1 Intelligence & Autonomous Greenhouse Data Foundation (25 tables, tiered rollups, two-tier safety, append-only audit)',
          sha256Hex(MIGRATION_V3_TABLES_SQL).slice(0, 16),
          Date.now() - startV3
        ],
        false
      );
      existingVersions.add(SCHEMA_VERSION_V3);
      appliedNow.push(SCHEMA_VERSION_V3);
    }

    // Phase 2 non-destructive column guarantees on enrollment_tokens for targeted 1-to-N device bootstrap
    addColumnIfMissing(driver, 'enrollment_tokens', 'target_device_id', 'TEXT');
    addColumnIfMissing(driver, 'enrollment_tokens', 'target_zone_id', 'TEXT');

    if (!existingVersions.has(SCHEMA_VERSION_V4)) {
      const startV4 = Date.now();
      const nowIsoV4 = new Date().toISOString();

      // Phase 3A: Rich 6-stage crop intelligence metadata & verified/provisional provenance
      addColumnIfMissing(driver, 'crop_growth_stage_standards', 'light_hours_min', 'REAL');
      addColumnIfMissing(driver, 'crop_growth_stage_standards', 'light_hours_max', 'REAL');
      addColumnIfMissing(driver, 'crop_growth_stage_standards', 'humidity_optimal_pct', 'REAL');
      addColumnIfMissing(driver, 'crop_growth_stage_standards', 'soil_moisture_optimal_pct', 'REAL');
      addColumnIfMissing(
        driver,
        'crop_growth_stage_standards',
        'nutrient_requirements_json',
        "TEXT NOT NULL DEFAULT '{}'"
      );
      addColumnIfMissing(
        driver,
        'crop_growth_stage_standards',
        'stress_indicators_json',
        "TEXT NOT NULL DEFAULT '[]'"
      );
      addColumnIfMissing(driver, 'crop_growth_stage_standards', 'expected_duration_days', 'INTEGER');
      addColumnIfMissing(driver, 'crop_growth_stage_standards', 'source_organization', 'TEXT');
      addColumnIfMissing(driver, 'crop_growth_stage_standards', 'publication_date', 'TEXT');
      addColumnIfMissing(
        driver,
        'crop_growth_stage_standards',
        'validation_status',
        "TEXT NOT NULL DEFAULT 'verified'"
      );
      addColumnIfMissing(
        driver,
        'crop_growth_stage_standards',
        'confidence_level',
        "TEXT NOT NULL DEFAULT 'verified_reference'"
      );

      // Phase 3B: 8-point structured explanations & honest data-source provenance on recommendations
      addColumnIfMissing(driver, 'ai_recommendations', 'crop_code', 'TEXT');
      addColumnIfMissing(driver, 'ai_recommendations', 'crop_variety', 'TEXT');
      addColumnIfMissing(driver, 'ai_recommendations', 'growth_stage', 'TEXT');
      addColumnIfMissing(
        driver,
        'ai_recommendations',
        'data_source',
        "TEXT NOT NULL DEFAULT 'DISCONNECTED'"
      );
      addColumnIfMissing(
        driver,
        'ai_recommendations',
        'explanation_json',
        "TEXT NOT NULL DEFAULT '{}'"
      );
      addColumnIfMissing(
        driver,
        'ai_recommendations',
        'safety_check_json',
        "TEXT NOT NULL DEFAULT '{}'"
      );
      addColumnIfMissing(
        driver,
        'ai_recommendations',
        'execution_mode',
        "TEXT NOT NULL DEFAULT 'SIMULATION_ONLY'"
      );

      // Phase 3C-3E: Simulation-only closed-loop execution adapter lock & zone/greenhouse stage tracking
      addColumnIfMissing(
        driver,
        'hardware_command_queue',
        'execution_adapter',
        "TEXT NOT NULL DEFAULT 'SIMULATION_ONLY'"
      );
      addColumnIfMissing(
        driver,
        'hardware_command_queue',
        'physical_dispatched',
        'INTEGER NOT NULL DEFAULT 0'
      );
      addColumnIfMissing(
        driver,
        'hardware_command_queue',
        'simulation_result_json',
        "TEXT NOT NULL DEFAULT '{}'"
      );

      addColumnIfMissing(driver, 'greenhouses', 'emergency_stop_by_user_id', 'TEXT');
      addColumnIfMissing(driver, 'greenhouses', 'active_crop_variety', 'TEXT');
      addColumnIfMissing(
        driver,
        'greenhouses',
        'active_growth_stage',
        "TEXT NOT NULL DEFAULT 'vegetative'"
      );

      addColumnIfMissing(driver, 'greenhouse_zones', 'active_crop_variety', 'TEXT');
      addColumnIfMissing(driver, 'greenhouse_zones', 'crop_profile_id', 'TEXT');
      addColumnIfMissing(driver, 'greenhouse_zones', 'planting_date', 'TEXT');

      driver.run(
        `INSERT INTO schema_migrations (version, applied_at, description, checksum, execution_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          SCHEMA_VERSION_V4,
          nowIsoV4,
          'Phase 3 Crop Intelligence, 6-stage standards, 8-point recommendations, 3-mode farmer authorization & simulation-only closed loop',
          'v4_phase3_crop_control',
          Date.now() - startV4
        ],
        false
      );
      existingVersions.add(SCHEMA_VERSION_V4);
      appliedNow.push(SCHEMA_VERSION_V4);
    }

    if (!existingVersions.has(SCHEMA_VERSION_V5)) {
      const startV5 = Date.now();
      const nowIsoV5 = new Date().toISOString();

      addColumnIfMissing(driver, 'devices', 'manufacturer', "TEXT DEFAULT 'Espressif'");
      addColumnIfMissing(driver, 'devices', 'hardware_model', 'TEXT');
      addColumnIfMissing(driver, 'devices', 'protocol', "TEXT NOT NULL DEFAULT 'http_rest'");

      driver.exec(MIGRATION_V5_TABLES_SQL, false);

      driver.run(
        `INSERT INTO schema_migrations (version, applied_at, description, checksum, execution_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          SCHEMA_VERSION_V5,
          nowIsoV5,
          'Universal IoT Adapter registries (MQTT/WS/HTTP/ESPHome/ThingsBoard) + Independent Agricultural Knowledge & Versioned Datasets',
          sha256Hex(MIGRATION_V5_TABLES_SQL).slice(0, 16),
          Date.now() - startV5
        ],
        false
      );
      existingVersions.add(SCHEMA_VERSION_V5);
      appliedNow.push(SCHEMA_VERSION_V5);
    }
  });

  return { appliedNow, backupManifest };
}

/**
 * Programmatic Down-Migration for `v5_universal_iot_and_independent_intelligence`.
 */
export function rollbackMigrationV5(driver: SqliteDriver): { rolledBack: boolean } {
  const hasV5 = driver.queryOne<{ version: string }>(
    'SELECT version FROM schema_migrations WHERE version = ?',
    [SCHEMA_VERSION_V5]
  );
  if (!hasV5) {
    return { rolledBack: false };
  }

  driver.runInTransaction(() => {
    for (const table of V5_ADDED_TABLES) {
      driver.exec(`DROP TABLE IF EXISTS "${table}";`, false);
    }
    driver.run('DELETE FROM schema_migrations WHERE version = ?', [SCHEMA_VERSION_V5], false);
  });

  return { rolledBack: true };
}

/**
 * Programmatic Down-Migration for `v4_phase3_crop_intelligence_and_authorized_control`.
 * Safely rolls schema version marker back to `v3_phase1_intelligence_foundation` while
 * preserving 100% of existing `v1`–`v3` records and tables.
 */
export function rollbackMigrationV4(driver: SqliteDriver): { rolledBack: boolean } {
  const hasV4 = driver.queryOne<{ version: string }>(
    'SELECT version FROM schema_migrations WHERE version = ?',
    [SCHEMA_VERSION_V4]
  );
  if (!hasV4) {
    return { rolledBack: false };
  }

  driver.runInTransaction(() => {
    for (const table of V5_ADDED_TABLES) {
      driver.exec(`DROP TABLE IF EXISTS "${table}";`, false);
    }
    driver.run(
      'DELETE FROM schema_migrations WHERE version IN (?, ?)',
      [SCHEMA_VERSION_V5, SCHEMA_VERSION_V4],
      false
    );
  });

  return { rolledBack: true };
}

/**
 * Programmatic Down-Migration for `v3_phase1_intelligence_foundation`.
 * Safely drops Phase 1 v3+ extension tables and triggers
 * while preserving 100% of existing `v1`/`v2` core records (`users`, `sessions`,
 * `greenhouses`, `devices`, `enrollment_tokens`, `telemetry_readings`, `audit_events`,
 * `ai_observations`).
 */
export function rollbackMigrationV3(driver: SqliteDriver): { rolledBack: boolean } {
  const hasV3 = driver.queryOne<{ version: string }>(
    'SELECT version FROM schema_migrations WHERE version = ?',
    [SCHEMA_VERSION_V3]
  );
  if (!hasV3) {
    return { rolledBack: false };
  }

  driver.runInTransaction(() => {
    driver.exec('DROP TRIGGER IF EXISTS trg_audit_events_no_update;', false);
    driver.exec('DROP TRIGGER IF EXISTS trg_audit_events_no_delete;', false);
    for (const table of V5_ADDED_TABLES) {
      driver.exec(`DROP TABLE IF EXISTS "${table}";`, false);
    }
    for (const table of V3_ADDED_TABLES) {
      driver.exec(`DROP TABLE IF EXISTS "${table}";`, false);
    }
    driver.run(
      'DELETE FROM schema_migrations WHERE version IN (?, ?, ?)',
      [SCHEMA_VERSION_V5, SCHEMA_VERSION_V4, SCHEMA_VERSION_V3],
      false
    );
  });

  return { rolledBack: true };
}

/**
 * Copies a live database file to an isolated temporary location, runs pending migrations,
 * verifies 100% preservation of all existing rows, tests `PRAGMA integrity_check` &
 * `PRAGMA foreign_key_check`, tests programmatic rollback to v2, and cleans up temporary files.
 */
export async function testMigrationAndRollbackOnCopy(sourceDbFilePath: string): Promise<MigrationCopyTestResult> {
  const startMs = Date.now();
  if (!fs.existsSync(sourceDbFilePath)) {
    throw new Error(`Source database file not found: ${sourceDbFilePath}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edens-mig-copy-test-'));
  const copyDbPath = path.join(tmpDir, 'copy_under_test.sqlite');

  try {
    // Export a clean copy of the source DB
    const srcReader = new SqliteDriver({ dbFilePath: sourceDbFilePath });
    await srcReader.open();
    const preMigrationRowCounts = getTableRowCounts(srcReader);
    srcReader.exportCleanCopyTo(copyDbPath);
    srcReader.close();

    const copyDriver = new SqliteDriver({ dbFilePath: copyDbPath });
    await copyDriver.open();
    try {
      await applyPlatformMigrations(copyDriver, { skipAutoBackup: true });

      const integrity = copyDriver.integrityCheck();
      const fk = copyDriver.foreignKeyCheck();
      const postMigrationRowCounts = getTableRowCounts(copyDriver);

      // Verify every pre-existing table retained >= its exact pre-migration rows
      for (const [table, preCount] of Object.entries(preMigrationRowCounts)) {
        if (table === 'schema_migrations') continue;
        if ((postMigrationRowCounts[table] ?? -1) < preCount) {
          throw new Error(
            `Data preservation failure on copy for table "${table}": pre=${preCount}, post=${postMigrationRowCounts[table]}`
          );
        }
      }

      const appliedVersions = copyDriver
        .queryAll<{ version: string }>('SELECT version FROM schema_migrations ORDER BY applied_at ASC')
        .map((r) => String(r.version));

      // Test rollback on the copy as well
      const rb = rollbackMigrationV3(copyDriver);
      if (!rb.rolledBack) {
        throw new Error('Expected rollbackMigrationV3 to succeed on migrated copy.');
      }
      const postRollbackRowCounts = getTableRowCounts(copyDriver);
      for (const [table, preCount] of Object.entries(preMigrationRowCounts)) {
        if (
          table === 'schema_migrations' ||
          (V3_ADDED_TABLES as readonly string[]).includes(table) ||
          (V5_ADDED_TABLES as readonly string[]).includes(table)
        ) {
          continue;
        }
        if (postRollbackRowCounts[table] !== preCount) {
          throw new Error(
            `Rollback row preservation failure on table "${table}": pre=${preCount}, postRollback=${postRollbackRowCounts[table]}`
          );
        }
      }

      const integrityAfterRollback = copyDriver.integrityCheck();

      return {
        passed: integrity.ok && fk.ok && integrityAfterRollback.ok,
        sourcePath: sourceDbFilePath,
        preMigrationRowCounts,
        postMigrationRowCounts,
        postRollbackRowCounts,
        integrityOk: integrity.ok && integrityAfterRollback.ok,
        foreignKeysOk: fk.ok,
        appliedVersions,
        durationMs: Date.now() - startMs
      };
    } finally {
      copyDriver.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
