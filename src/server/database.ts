import path from 'node:path';
import {
  LATEST_SCHEMA_VERSION,
  applyPlatformMigrations
} from './migrations.ts';
import {
  type PlatformRepositories,
  calculateVpdKpa,
  createPlatformRepositories
} from './repositories.ts';
import {
  createDefaultTwoTierSafetyEnvelope,
  getDefaultDataRetentionConfig
} from './safetyDefaults.ts';
import { SqliteDriver, type SqliteDriverEngineKind } from './sqliteDriver.ts';
import {
  DEVICE_STATE_THRESHOLDS,
  type DeviceProvisioningStatus,
  type EnrollmentTokenPurpose,
  type ExplicitDeviceConnectionState,
  type GreenhouseDeviceType,
  type GreenhouseMemberRole,
  type ValidatedControllerTelemetry,
  type WifiProvisioningMethod,
  type WifiProvisioningState,
  computeExplicitDeviceState,
  extractRawEnrollmentCode,
  generateSecureId,
  hashPasswordScrypt,
  redactSecretsFromText,
  sha256Hex,
  verifyPasswordScrypt
} from './telemetryContract.ts';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  isGuest?: boolean;
}

export interface GreenhouseRecord {
  id: string;
  name: string;
  locationLabel: string;
  cropType: string;
  ownerUserId: string;
  role: GreenhouseMemberRole;
  wifiProvisioningMethod: WifiProvisioningMethod;
  wifiProvisioningState: WifiProvisioningState;
  wifiSsidHint: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceRecord {
  id: string;
  greenhouseId: string;
  zoneId?: string | null;
  deviceType: GreenhouseDeviceType;
  label: string;
  credentialPrefix: string | null;
  keyPrefix?: string | null;
  hasCredentialIssued: boolean;
  provisioningStatus: DeviceProvisioningStatus;
  explicitState: ExplicitDeviceConnectionState;
  ageSeconds: number | null;
  onlineMaxAgeSeconds: number;
  staleMaxAgeSeconds: number;
  firmwareVersion: string | null;
  targetFirmwareVersion?: string | null;
  otaStatus?: string;
  serialNumber?: string | null;
  hardwareIdentityUid?: string | null;
  macAddress?: string | null;
  credentialRotatedAt?: string | null;
  replacedByDeviceId?: string | null;
  capabilities?: Record<string, unknown>;
  lastSeenAt: string | null;
  lastTelemetryAt: string | null;
  lastUploadAt: string | null;
  lastErrorCategory: 'AUTH' | 'CONNECTION' | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnrollmentTokenSummary {
  id: string;
  tokenPrefix: string;
  purpose: EnrollmentTokenPurpose;
  greenhouseId: string | null;
  targetDeviceId?: string | null;
  targetZoneId?: string | null;
  kitSerial: string | null;
  kitModel: string | null;
  roleGranted: GreenhouseMemberRole;
  status: 'active' | 'used' | 'revoked' | 'expired';
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface AuditEventRecord {
  id: string;
  greenhouseId: string | null;
  actorUserId: string | null;
  actorDeviceId: string | null;
  eventType: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ObservationRecord {
  id: string;
  greenhouseId: string;
  actorUserId: string | null;
  category: 'vision_diagnosis' | 'agronomy_chat' | 'agent_advisory' | 'harvest_prediction';
  dataSource: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PlatformDatabaseOptions {
  dbFilePath?: string;
  inMemoryOnly?: boolean;
  sessionTtlHours?: number;
  preferredEngine?: 'auto' | 'native' | 'sqljs';
  skipAutoBackup?: boolean;
}

export class PlatformDatabase {
  private dbFilePath: string;
  private readonly inMemoryOnly: boolean;
  private readonly sessionTtlHours: number;
  private readonly preferredEngine: 'auto' | 'native' | 'sqljs';
  private readonly skipAutoBackup: boolean;

  private driver: SqliteDriver | null = null;
  private repos: PlatformRepositories | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(options: PlatformDatabaseOptions = {}) {
    this.inMemoryOnly = Boolean(options.inMemoryOnly);
    this.preferredEngine = options.preferredEngine || 'auto';
    this.skipAutoBackup = Boolean(options.skipAutoBackup);

    const defaultDbPath = path.join(process.cwd(), 'data', 'edens_platform.sqlite');
    const rawEnvDbPath = (process.env.DATABASE_PATH || '').trim();
    const isValidEnvDbPath =
      rawEnvDbPath.length > 0 &&
      !/^(secret value|replace_with|undefined|null)$/i.test(rawEnvDbPath) &&
      !rawEnvDbPath.startsWith('REPLACE_WITH');
    this.dbFilePath = options.dbFilePath || (isValidEnvDbPath ? rawEnvDbPath : defaultDbPath);

    const parsedTtl = parseInt(process.env.SESSION_TTL_HOURS || '168', 10);
    this.sessionTtlHours =
      options.sessionTtlHours ?? (Number.isFinite(parsedTtl) && parsedTtl >= 1 ? parsedTtl : 168);
  }

  public isInitialized(): boolean {
    return Boolean(this.driver && this.driver.isOpen());
  }

  public get repositories(): PlatformRepositories {
    if (!this.repos) {
      throw new Error('PlatformDatabase has not been initialized. Call await platformDb.init() first.');
    }
    return this.repos;
  }

  public getDriver(): SqliteDriver {
    return this.ensureDriver();
  }

  public getDatabaseDiagnostics(): {
    initialized: boolean;
    engineKind: SqliteDriverEngineKind | null;
    journalMode: string | null;
    foreignKeys: boolean;
    schemaVersion: string;
    dbFilePath: string;
  } {
    const fkRow = this.driver ? this.driver.queryOne<{ foreign_keys: number }>('PRAGMA foreign_keys') : null;
    let activeVersion = LATEST_SCHEMA_VERSION;
    if (this.driver && this.driver.isOpen()) {
      try {
        const verRow = this.driver.queryOne<{ version: string }>(
          'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
        );
        if (verRow?.version) {
          activeVersion = String(verRow.version);
        }
      } catch {
        activeVersion = LATEST_SCHEMA_VERSION;
      }
    }
    return {
      initialized: this.isInitialized(),
      engineKind: this.driver ? this.driver.getEngineKind() : null,
      journalMode: this.driver ? this.driver.getJournalMode() : null,
      foreignKeys: fkRow ? Number(fkRow.foreign_keys) === 1 : false,
      schemaVersion: activeVersion,
      dbFilePath: this.dbFilePath
    };
  }

  public async init(): Promise<void> {
    if (this.driver && this.driver.isOpen()) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const nextDriver = new SqliteDriver({
          dbFilePath: this.dbFilePath,
          inMemoryOnly: this.inMemoryOnly,
          preferredEngine: this.preferredEngine
        });
        await nextDriver.open();
        this.dbFilePath = nextDriver.getDbFilePath();

        await applyPlatformMigrations(nextDriver, {
          inMemoryOnly: this.inMemoryOnly,
          skipAutoBackup: this.skipAutoBackup
        });

        this.driver = nextDriver;
        this.repos = createPlatformRepositories(nextDriver);
      } catch (err: any) {
        this.initPromise = null;
        console.error('[EDENS AI DB Initialization Failure]:', err?.stack || err?.message || err);
        throw err;
      }
    })();

    return this.initPromise;
  }

  public close(): void {
    if (this.driver) {
      this.driver.close();
      this.driver = null;
      this.repos = null;
      this.initPromise = null;
    }
  }

  private ensureDriver(): SqliteDriver {
    if (!this.driver || !this.driver.isOpen()) {
      throw new Error('PlatformDatabase has not been initialized. Call await platformDb.init() first.');
    }
    return this.driver;
  }

  public persistToDisk(): void {
    if (!this.driver || this.inMemoryOnly) return;
    this.driver.persistSnapshotIfNeeded();
  }

  private queryAll<T = Record<string, any>>(sql: string, params: any[] = []): T[] {
    return this.ensureDriver().queryAll<T>(sql, params);
  }

  private queryOne<T = Record<string, any>>(sql: string, params: any[] = []): T | null {
    return this.ensureDriver().queryOne<T>(sql, params);
  }

  private runStmt(sql: string, params: any[] = [], persist: boolean = true): void {
    this.ensureDriver().run(sql, params, persist);
  }

  public recordAuditEvent(params: {
    greenhouseId?: string | null;
    actorUserId?: string | null;
    actorDeviceId?: string | null;
    eventType: string;
    summary: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
  }): void {
    const sanitizedSummary = redactSecretsFromText(params.summary);
    const sanitizedMetaStr = redactSecretsFromText(JSON.stringify(params.metadata || {}));
    this.runStmt(
      `INSERT INTO audit_events (id, greenhouse_id, actor_user_id, actor_device_id, event_type, summary, metadata_json, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateSecureId('aud', 8),
        params.greenhouseId || null,
        params.actorUserId || null,
        params.actorDeviceId || null,
        params.eventType,
        sanitizedSummary,
        sanitizedMetaStr,
        params.ipAddress || null,
        new Date().toISOString()
      ]
    );
  }

  public recordAiObservation(params: {
    greenhouseId: string;
    actorUserId?: string | null;
    category: 'vision_diagnosis' | 'agronomy_chat' | 'agent_advisory' | 'harvest_prediction';
    dataSource: string;
    summary: string;
    payload: Record<string, unknown>;
  }): ObservationRecord {
    const id = generateSecureId('obs', 8);
    const createdAt = new Date().toISOString();
    const safeSummary = redactSecretsFromText(params.summary).slice(0, 320);
    const safePayloadJson = redactSecretsFromText(JSON.stringify(params.payload || {}));

    this.ensureDriver().runInTransaction(() => {
      this.runStmt(
        `INSERT INTO ai_observations (id, greenhouse_id, actor_user_id, category, data_source, summary, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          params.greenhouseId,
          params.actorUserId || null,
          params.category,
          params.dataSource,
          safeSummary,
          safePayloadJson,
          createdAt
        ],
        false
      );

      // Apply configurable retention via telemetryHistory repository (default 365 days instead of 50 rows)
      this.repositories.telemetryHistory.applyRetentionSweepIfDue(params.greenhouseId);
    });

    return {
      id,
      greenhouseId: params.greenhouseId,
      actorUserId: params.actorUserId || null,
      category: params.category,
      dataSource: params.dataSource,
      summary: safeSummary,
      payload: params.payload,
      createdAt
    };
  }

  public listAiObservationsForGreenhouse(greenhouseId: string, limit: number = 20): ObservationRecord[] {
    const rows = this.queryAll<any>(
      `SELECT id, greenhouse_id, actor_user_id, category, data_source, summary, payload_json, created_at
       FROM ai_observations
       WHERE greenhouse_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [greenhouseId, Math.max(1, Math.min(500, limit))]
    );
    return rows.map((r) => ({
      id: String(r.id),
      greenhouseId: String(r.greenhouse_id),
      actorUserId: r.actor_user_id ? String(r.actor_user_id) : null,
      category: String(r.category) as ObservationRecord['category'],
      dataSource: String(r.data_source),
      summary: String(r.summary),
      payload: (() => {
        try {
          return JSON.parse(String(r.payload_json || '{}'));
        } catch {
          return {};
        }
      })(),
      createdAt: String(r.created_at)
    }));
  }

  public listAuditEventsForGreenhouse(greenhouseId: string, limit: number = 30): AuditEventRecord[] {
    const rows = this.queryAll<any>(
      `SELECT id, greenhouse_id, actor_user_id, actor_device_id, event_type, summary, metadata_json, created_at
       FROM audit_events
       WHERE greenhouse_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [greenhouseId, Math.max(1, Math.min(500, limit))]
    );
    return rows.map((r) => ({
      id: String(r.id),
      greenhouseId: r.greenhouse_id ? String(r.greenhouse_id) : null,
      actorUserId: r.actor_user_id ? String(r.actor_user_id) : null,
      actorDeviceId: r.actor_device_id ? String(r.actor_device_id) : null,
      eventType: String(r.event_type),
      summary: String(r.summary),
      metadata: (() => {
        try {
          return JSON.parse(String(r.metadata_json || '{}'));
        } catch {
          return {};
        }
      })(),
      createdAt: String(r.created_at)
    }));
  }

  // ------------------------------------------------------------------
  // USER REGISTRATION, LOGIN & SESSION MANAGEMENT
  // ------------------------------------------------------------------

  public hasAnyUsers(): boolean {
    const row = this.queryOne<{ id: string }>('SELECT id FROM users WHERE is_guest = 0 LIMIT 1');
    if (row?.id) return true;
    const fallbackAny = this.queryOne<{ id: string }>('SELECT id FROM users LIMIT 1');
    return Boolean(fallbackAny?.id);
  }

  public registerUser(params: {
    email: string;
    password: string;
    displayName: string;
    isGuest?: boolean;
    userAgent?: string;
    ipAddress?: string;
  }):
    | { ok: true; user: AuthenticatedUser; sessionToken: string; expiresAt: string }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    const emailNorm = String(params.email || '').trim().toLowerCase();
    const displayName = String(params.displayName || '').trim() || emailNorm.split('@')[0] || 'Grower';
    const password = String(params.password || '');
    const isGuest = Boolean(params.isGuest || emailNorm.endsWith('@preview.edens-ai.local'));

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      return { ok: false, statusCode: 400, errorCode: 'INVALID_EMAIL', message: 'Enter a valid email address.' };
    }
    if (password.length < 8) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'WEAK_PASSWORD',
        message: 'Password must be at least 8 characters long.'
      };
    }

    const existing = this.queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [emailNorm]);
    if (existing) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'EMAIL_ALREADY_REGISTERED',
        message: 'An account with this email already exists. Sign in instead.'
      };
    }

    const nowIso = new Date().toISOString();
    const userId = generateSecureId('usr', 8);
    const { hashHex, saltHex } = hashPasswordScrypt(password);

    const session = this.ensureDriver().runInTransaction(() => {
      this.runStmt(
        `INSERT INTO users (id, email, display_name, password_hash, password_salt, is_guest, account_status, preferences_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', '{}', ?)`,
        [userId, emailNorm, displayName.slice(0, 80), hashHex, saltHex, isGuest ? 1 : 0, nowIso],
        false
      );

      const createdSession = this.createSessionInternal(userId, params.userAgent, params.ipAddress);
      this.recordAuditEvent({
        actorUserId: userId,
        eventType: isGuest ? 'GUEST_SESSION_CREATED' : 'USER_REGISTERED',
        summary: isGuest
          ? `Read-only/simulation guest workspace session created (${emailNorm})`
          : `Customer account registered (${emailNorm})`,
        ipAddress: params.ipAddress
      });
      return createdSession;
    });

    return {
      ok: true,
      user: {
        id: userId,
        email: emailNorm,
        displayName: displayName.slice(0, 80),
        createdAt: nowIso,
        isGuest
      },
      sessionToken: session.rawToken,
      expiresAt: session.expiresAt
    };
  }

  public authenticateUser(params: {
    email: string;
    password: string;
    userAgent?: string;
    ipAddress?: string;
  }):
    | { ok: true; user: AuthenticatedUser; sessionToken: string; expiresAt: string }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    const emailNorm = String(params.email || '').trim().toLowerCase();
    const password = String(params.password || '');

    const row = this.queryOne<any>(
      'SELECT id, email, display_name, password_hash, password_salt, is_guest, created_at FROM users WHERE email = ?',
      [emailNorm]
    );
    if (!row || !verifyPasswordScrypt(password, String(row.password_hash), String(row.password_salt))) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.'
      };
    }

    const session = this.ensureDriver().runInTransaction(() =>
      this.createSessionInternal(String(row.id), params.userAgent, params.ipAddress)
    );

    const isGuest =
      Number(row.is_guest) === 1 || String(row.email).endsWith('@preview.edens-ai.local');

    return {
      ok: true,
      user: {
        id: String(row.id),
        email: String(row.email),
        displayName: String(row.display_name),
        createdAt: String(row.created_at),
        isGuest
      },
      sessionToken: session.rawToken,
      expiresAt: session.expiresAt
    };
  }

  private createSessionInternal(
    userId: string,
    userAgent?: string,
    ipAddress?: string
  ): { rawToken: string; expiresAt: string } {
    const rawToken = generateSecureId('edsess', 24);
    const tokenHash = sha256Hex(rawToken);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.sessionTtlHours * 3600 * 1000).toISOString();

    this.runStmt(
      `INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at, last_seen_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [generateSecureId('ses', 8), tokenHash, userId, expiresAt, nowIso, nowIso, userAgent || null, ipAddress || null],
      false
    );

    return { rawToken, expiresAt };
  }

  public getUserBySessionToken(rawToken: string | undefined | null): AuthenticatedUser | null {
    const trimmed = String(rawToken || '').trim();
    if (!trimmed) return null;
    const tokenHash = sha256Hex(trimmed);
    const row = this.queryOne<any>(
      `SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.display_name, u.is_guest, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
      [tokenHash]
    );
    if (!row) return null;
    if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
      this.runStmt('DELETE FROM sessions WHERE id = ?', [String(row.session_id)]);
      return null;
    }
    const isGuest =
      Number(row.is_guest) === 1 || String(row.email).endsWith('@preview.edens-ai.local');
    return {
      id: String(row.id),
      email: String(row.email),
      displayName: String(row.display_name),
      createdAt: String(row.created_at),
      isGuest
    };
  }

  public getUserById(userId: string): AuthenticatedUser | null {
    const row = this.queryOne<any>(
      'SELECT id, email, display_name, is_guest, created_at FROM users WHERE id = ?',
      [userId]
    );
    if (!row) return null;
    const isGuest =
      Number(row.is_guest) === 1 || String(row.email).endsWith('@preview.edens-ai.local');
    return {
      id: String(row.id),
      email: String(row.email),
      displayName: String(row.display_name),
      createdAt: String(row.created_at),
      isGuest
    };
  }

  public revokeSession(rawToken: string | undefined | null): void {
    const trimmed = String(rawToken || '').trim();
    if (!trimmed) return;
    this.runStmt('DELETE FROM sessions WHERE token_hash = ?', [sha256Hex(trimmed)]);
  }

  // ------------------------------------------------------------------
  // GREENHOUSE IDENTITY, OWNERSHIP & RBAC
  // ------------------------------------------------------------------

  public createGreenhouse(params: {
    ownerUserId: string;
    name: string;
    locationLabel?: string;
    cropType?: string;
    wifiProvisioningMethod?: WifiProvisioningMethod;
    ipAddress?: string;
  }): GreenhouseRecord {
    const name = String(params.name || '').trim().slice(0, 80) || 'My EDENS Greenhouse';
    const locationLabel = String(params.locationLabel || '').trim().slice(0, 100) || 'Unspecified Site';
    const cropType = String(params.cropType || '').trim().slice(0, 60) || 'Tomato';
    const wifiMethod: WifiProvisioningMethod =
      params.wifiProvisioningMethod === 'softap_portal_pending'
        ? 'softap_portal_pending'
        : 'guided_secrets_header';
    const nowIso = new Date().toISOString();
    const ghId = generateSecureId('gh', 6);
    const primaryZoneId = generateSecureId('zone', 6);
    const defaultSafetyJson = JSON.stringify(createDefaultTwoTierSafetyEnvelope());
    const defaultRetention = getDefaultDataRetentionConfig();

    this.ensureDriver().runInTransaction(() => {
      this.runStmt(
        `INSERT INTO greenhouses (
           id, name, location_label, crop_type, owner_user_id,
           wifi_provisioning_method, wifi_provisioning_state, wifi_ssid_hint,
           timezone, cultivation_method, authorization_mode, emergency_stop_active,
           safety_defaults_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'unconfigured', NULL, 'Africa/Lagos', 'soil_bed', 'mode_1_individual', 0, ?, ?, ?)`,
        [ghId, name, locationLabel, cropType, params.ownerUserId, wifiMethod, defaultSafetyJson, nowIso, nowIso],
        false
      );

      this.runStmt(
        `INSERT INTO greenhouse_members (id, greenhouse_id, user_id, role, added_by_user_id, created_at)
         VALUES (?, ?, ?, 'owner', ?, ?)`,
        [generateSecureId('ghm', 6), ghId, params.ownerUserId, params.ownerUserId, nowIso],
        false
      );

      // Default Primary Zone
      this.runStmt(
        `INSERT INTO greenhouse_zones (
           id, greenhouse_id, name, zone_type, active_crop_type, growth_stage,
           cultivation_method, safety_overrides_json, is_primary, created_at, updated_at
         ) VALUES (?, ?, 'Main Canopy Bay', 'canopy_bay', ?, 'vegetative', 'soil_bed', '{}', 1, ?, ?)`,
        [primaryZoneId, ghId, cropType, nowIso, nowIso],
        false
      );

      // Default Tiered Data Retention Policy
      this.runStmt(
        `INSERT INTO data_retention_policies (
           greenhouse_id, raw_telemetry_days, hourly_rollup_days, daily_rollup_days,
           ai_observation_days, audit_log_days, routine_camera_max_files,
           routine_camera_max_days, curated_dataset_max_files, updated_by_user_id, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ghId,
          defaultRetention.rawTelemetryDays,
          defaultRetention.hourlyRollupDays,
          defaultRetention.dailyRollupDays,
          defaultRetention.aiObservationDays,
          defaultRetention.auditLogDays,
          defaultRetention.routineCameraMaxFiles,
          defaultRetention.routineCameraMaxDays,
          defaultRetention.curatedDatasetMaxFiles,
          params.ownerUserId,
          nowIso
        ],
        false
      );

      // Pre-allocate unique primary camera & controller IDs in pending_setup state (never claimed connected!)
      this.runStmt(
        `INSERT INTO devices (
           id, greenhouse_id, zone_id, device_type, label, credential_hash, credential_prefix,
           provisioning_status, firmware_version, last_seen_at, last_ip, revoked_at, created_at, updated_at
         ) VALUES (?, ?, ?, 'esp32_cam', 'ESP32-CAM Crop Camera', NULL, NULL, 'pending_setup', NULL, NULL, NULL, NULL, ?, ?)`,
        [generateSecureId('dev_cam', 6), ghId, primaryZoneId, nowIso, nowIso],
        false
      );
      this.runStmt(
        `INSERT INTO devices (
           id, greenhouse_id, zone_id, device_type, label, credential_hash, credential_prefix,
           provisioning_status, firmware_version, last_seen_at, last_ip, revoked_at, created_at, updated_at
         ) VALUES (?, ?, ?, 'esp32_controller', 'Main ESP32 Greenhouse Controller', NULL, NULL, 'pending_setup', NULL, NULL, NULL, NULL, ?, ?)`,
        [generateSecureId('dev_ctrl', 6), ghId, primaryZoneId, nowIso, nowIso],
        false
      );

      this.recordAuditEvent({
        greenhouseId: ghId,
        actorUserId: params.ownerUserId,
        eventType: 'GREENHOUSE_CREATED',
        summary: `Greenhouse "${name}" created with isolated camera & controller identity slots, primary canopy zone, and two-tier safety defaults.`,
        ipAddress: params.ipAddress
      });
    });

    return {
      id: ghId,
      name,
      locationLabel,
      cropType,
      ownerUserId: params.ownerUserId,
      role: 'owner',
      wifiProvisioningMethod: wifiMethod,
      wifiProvisioningState: 'unconfigured',
      wifiSsidHint: null,
      createdAt: nowIso,
      updatedAt: nowIso
    };
  }

  public getMemberRole(greenhouseId: string, userId: string): GreenhouseMemberRole | null {
    const row = this.queryOne<{ role: GreenhouseMemberRole }>(
      'SELECT role FROM greenhouse_members WHERE greenhouse_id = ? AND user_id = ?',
      [greenhouseId, userId]
    );
    return row ? row.role : null;
  }

  public listGreenhousesForUser(userId: string): GreenhouseRecord[] {
    const rows = this.queryAll<any>(
      `SELECT g.*, m.role
       FROM greenhouses g
       JOIN greenhouse_members m ON m.greenhouse_id = g.id
       WHERE m.user_id = ?
       ORDER BY g.created_at DESC`,
      [userId]
    );
    return rows.map((r) => this.mapGreenhouseRow(r));
  }

  public getGreenhouseForUser(greenhouseId: string, userId: string): GreenhouseRecord | null {
    const row = this.queryOne<any>(
      `SELECT g.*, m.role
       FROM greenhouses g
       JOIN greenhouse_members m ON m.greenhouse_id = g.id
       WHERE g.id = ? AND m.user_id = ?`,
      [greenhouseId, userId]
    );
    return row ? this.mapGreenhouseRow(row) : null;
  }

  private mapGreenhouseRow(r: any): GreenhouseRecord {
    return {
      id: String(r.id),
      name: String(r.name),
      locationLabel: String(r.location_label),
      cropType: String(r.crop_type),
      ownerUserId: String(r.owner_user_id),
      role: (r.role || 'viewer') as GreenhouseMemberRole,
      wifiProvisioningMethod: (r.wifi_provisioning_method || 'guided_secrets_header') as WifiProvisioningMethod,
      wifiProvisioningState: (r.wifi_provisioning_state || 'unconfigured') as WifiProvisioningState,
      wifiSsidHint: r.wifi_ssid_hint ? String(r.wifi_ssid_hint) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  public updateGreenhouseSetup(params: {
    greenhouseId: string;
    actorUserId: string;
    name?: string;
    locationLabel?: string;
    cropType?: string;
    wifiProvisioningMethod?: WifiProvisioningMethod;
    wifiSsidHint?: string | null;
  }): GreenhouseRecord | null {
    const current = this.getGreenhouseForUser(params.greenhouseId, params.actorUserId);
    if (!current || (current.role !== 'owner' && current.role !== 'operator')) {
      return null;
    }

    const nextName =
      params.name !== undefined ? String(params.name).trim().slice(0, 80) || current.name : current.name;
    const nextLocation =
      params.locationLabel !== undefined
        ? String(params.locationLabel).trim().slice(0, 100) || current.locationLabel
        : current.locationLabel;
    const nextCrop =
      params.cropType !== undefined
        ? String(params.cropType).trim().slice(0, 60) || current.cropType
        : current.cropType;
    const nextMethod: WifiProvisioningMethod =
      params.wifiProvisioningMethod ?? current.wifiProvisioningMethod;
    const nextSsidHint =
      params.wifiSsidHint !== undefined
        ? params.wifiSsidHint
          ? String(params.wifiSsidHint).trim().slice(0, 48)
          : null
        : current.wifiSsidHint;

    // Never allow client calls to forge 'verified_online' — only real hardware check-ins set verified_online
    let nextWifiState: WifiProvisioningState = current.wifiProvisioningState;
    if (nextWifiState !== 'verified_online') {
      if (nextMethod === 'softap_portal_pending') {
        nextWifiState = 'pending_firmware_ap';
      } else if (nextSsidHint) {
        nextWifiState = 'credentials_staged';
      }
    }

    const nowIso = new Date().toISOString();
    this.runStmt(
      `UPDATE greenhouses
       SET name = ?, location_label = ?, crop_type = ?, wifi_provisioning_method = ?, wifi_provisioning_state = ?, wifi_ssid_hint = ?, updated_at = ?
       WHERE id = ?`,
      [nextName, nextLocation, nextCrop, nextMethod, nextWifiState, nextSsidHint, nowIso, params.greenhouseId]
    );

    return this.getGreenhouseForUser(params.greenhouseId, params.actorUserId);
  }

  // ------------------------------------------------------------------
  // SHORT-LIVED, REVOCABLE, ONE-TIME QR ENROLLMENT TOKENS
  // ------------------------------------------------------------------

  public issueEnrollmentToken(params: {
    purpose: EnrollmentTokenPurpose;
    greenhouseId?: string | null;
    targetDeviceId?: string | null;
    targetZoneId?: string | null;
    kitSerial?: string | null;
    kitModel?: string | null;
    roleGranted?: GreenhouseMemberRole;
    createdByUserId?: string | null;
    ttlMinutes?: number;
    publicOrigin?: string;
    ipAddress?: string;
  }): {
    tokenId: string;
    rawCode: string;
    qrPayloadUri: string;
    webSetupUrl: string;
    expiresAt: string;
    purpose: EnrollmentTokenPurpose;
    targetDeviceId: string | null;
    targetZoneId: string | null;
  } {
    const rawCode = generateSecureId('enr', 16);
    const tokenHash = sha256Hex(rawCode);
    const tokenId = generateSecureId('tok', 8);
    const ttlMinutes = Math.max(1, Math.min(1440, params.ttlMinutes ?? 30));
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const roleGranted: GreenhouseMemberRole = params.roleGranted || 'operator';
    const targetDeviceId = params.targetDeviceId ? String(params.targetDeviceId).trim() : null;
    const targetZoneId = params.targetZoneId ? String(params.targetZoneId).trim() : null;

    this.ensureDriver().runInTransaction(() => {
      this.runStmt(
        `INSERT INTO enrollment_tokens (
           id, token_hash, token_prefix, purpose, greenhouse_id, target_device_id, target_zone_id,
           kit_serial, kit_model, role_granted, created_by_user_id, expires_at,
           used_at, used_by_user_id, revoked_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
        [
          tokenId,
          tokenHash,
          rawCode.slice(0, 10),
          params.purpose,
          params.greenhouseId || null,
          targetDeviceId,
          targetZoneId,
          params.kitSerial || null,
          params.kitModel || 'EDENS-KIT-V1',
          roleGranted,
          params.createdByUserId || null,
          expiresAt,
          nowIso
        ],
        false
      );

      this.recordAuditEvent({
        greenhouseId: params.greenhouseId || null,
        actorUserId: params.createdByUserId || null,
        actorDeviceId: targetDeviceId,
        eventType: 'QR_TOKEN_ISSUED',
        summary: `Short-lived ${params.purpose} QR token issued${targetDeviceId ? ` for device ${targetDeviceId}` : ''} (expires in ${ttlMinutes}m).`,
        metadata: {
          tokenId,
          purpose: params.purpose,
          ttlMinutes,
          targetDeviceId,
          targetZoneId,
          kitSerial: params.kitSerial || null
        },
        ipAddress: params.ipAddress
      });
    });

    // Non-secret QR payload URI (contains ONLY revocable short-lived enrollment code, NEVER device or API keys)
    const qrParams = new URLSearchParams({
      v: '1',
      purpose: params.purpose,
      code: rawCode
    });
    if (params.kitSerial) qrParams.set('kit', params.kitSerial);
    if (targetDeviceId) qrParams.set('dev', targetDeviceId);
    if (targetZoneId) qrParams.set('zone', targetZoneId);
    const qrPayloadUri = `edens://enroll?${qrParams.toString()}`;
    const origin = (params.publicOrigin || 'https://edens-ai.onrender.com').replace(/\/$/, '');
    const webSetupUrl = `${origin}/greenhouses/setup?code=${encodeURIComponent(rawCode)}`;

    return {
      tokenId,
      rawCode,
      qrPayloadUri,
      webSetupUrl,
      expiresAt,
      purpose: params.purpose,
      targetDeviceId,
      targetZoneId
    };
  }

  public inspectEnrollmentCode(rawInput: string):
    | {
        ok: true;
        tokenId: string;
        purpose: EnrollmentTokenPurpose;
        greenhouseId: string | null;
        greenhouseName: string | null;
        targetDeviceId: string | null;
        targetZoneId: string | null;
        kitSerial: string | null;
        kitModel: string | null;
        roleGranted: GreenhouseMemberRole;
        expiresAt: string;
      }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    const rawCode = extractRawEnrollmentCode(rawInput);
    if (!rawCode) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_QR_FORMAT',
        message: 'QR code does not contain a valid EDENS enrollment code.'
      };
    }

    const row = this.queryOne<any>(
      `SELECT t.*, g.name AS greenhouse_name
       FROM enrollment_tokens t
       LEFT JOIN greenhouses g ON g.id = t.greenhouse_id
       WHERE t.token_hash = ?`,
      [sha256Hex(rawCode)]
    );

    if (!row) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'QR_TOKEN_NOT_FOUND',
        message: 'Enrollment QR code was not recognized.'
      };
    }
    if (row.revoked_at) {
      return {
        ok: false,
        statusCode: 410,
        errorCode: 'QR_TOKEN_REVOKED',
        message: 'This QR enrollment token has been revoked.'
      };
    }
    if (row.used_at) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'QR_TOKEN_ALREADY_USED',
        message: 'This one-time QR enrollment token has already been used.'
      };
    }
    if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
      return {
        ok: false,
        statusCode: 410,
        errorCode: 'QR_TOKEN_EXPIRED',
        message: 'This QR enrollment token has expired. Generate a fresh QR code.'
      };
    }

    return {
      ok: true,
      tokenId: String(row.id),
      purpose: String(row.purpose) as EnrollmentTokenPurpose,
      greenhouseId: row.greenhouse_id ? String(row.greenhouse_id) : null,
      greenhouseName: row.greenhouse_name ? String(row.greenhouse_name) : null,
      targetDeviceId: row.target_device_id ? String(row.target_device_id) : null,
      targetZoneId: row.target_zone_id ? String(row.target_zone_id) : null,
      kitSerial: row.kit_serial ? String(row.kit_serial) : null,
      kitModel: row.kit_model ? String(row.kit_model) : null,
      roleGranted: String(row.role_granted || 'operator') as GreenhouseMemberRole,
      expiresAt: String(row.expires_at)
    };
  }

  public redeemEnrollmentCodeForUser(params: {
    rawInput: string;
    userId: string;
    greenhouseName?: string;
    locationLabel?: string;
    cropType?: string;
    ipAddress?: string;
  }):
    | { ok: true; greenhouse: GreenhouseRecord; action: 'claimed_kit' | 'joined_greenhouse' }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    const inspected = this.inspectEnrollmentCode(params.rawInput);
    if ('errorCode' in inspected) {
      return inspected;
    }

    if (inspected.purpose === 'device_bootstrap') {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'WRONG_TOKEN_PURPOSE',
        message: 'This token is reserved for hardware controller/camera bootstrap, not user enrollment.'
      };
    }

    const nowIso = new Date().toISOString();
    let targetGhId = inspected.greenhouseId;
    let action: 'claimed_kit' | 'joined_greenhouse' = 'joined_greenhouse';

    this.ensureDriver().runInTransaction(() => {
      if (!targetGhId) {
        const created = this.createGreenhouse({
          ownerUserId: params.userId,
          name:
            params.greenhouseName?.trim() ||
            (inspected.kitSerial ? `EDENS Kit (${inspected.kitSerial})` : 'EDENS Smart Greenhouse'),
          locationLabel: params.locationLabel || 'Primary Greenhouse Bay',
          cropType: params.cropType || 'Tomato',
          ipAddress: params.ipAddress
        });
        targetGhId = created.id;
        action = 'claimed_kit';
      } else {
        const existingRole = this.getMemberRole(targetGhId, params.userId);
        if (!existingRole) {
          this.runStmt(
            `INSERT INTO greenhouse_members (id, greenhouse_id, user_id, role, added_by_user_id, created_at)
             VALUES (?, ?, ?, ?, NULL, ?)`,
            [generateSecureId('ghm', 6), targetGhId, params.userId, inspected.roleGranted, nowIso],
            false
          );
        }
        action = inspected.purpose === 'kit_qr_claim' ? 'claimed_kit' : 'joined_greenhouse';
      }

      this.runStmt(
        `UPDATE enrollment_tokens
         SET used_at = ?, used_by_user_id = ?, greenhouse_id = ?
         WHERE id = ?`,
        [nowIso, params.userId, targetGhId, inspected.tokenId],
        false
      );

      this.recordAuditEvent({
        greenhouseId: targetGhId,
        actorUserId: params.userId,
        eventType: 'QR_TOKEN_REDEEMED',
        summary:
          action === 'claimed_kit'
            ? `Greenhouse kit QR token redeemed (${inspected.kitSerial || inspected.tokenId}). Hardware still requires Wi-Fi & credential provisioning.`
            : 'Authorized member joined greenhouse via one-time QR invitation.',
        ipAddress: params.ipAddress
      });
    });

    const gh = this.getGreenhouseForUser(targetGhId!, params.userId)!;
    return { ok: true, greenhouse: gh, action };
  }

  public revokeEnrollmentToken(params: {
    tokenId: string;
    greenhouseId: string;
    actorUserId: string;
    ipAddress?: string;
  }): boolean {
    const role = this.getMemberRole(params.greenhouseId, params.actorUserId);
    if (role !== 'owner' && role !== 'operator') return false;

    const row = this.queryOne<{ id: string }>(
      'SELECT id FROM enrollment_tokens WHERE id = ? AND greenhouse_id = ?',
      [params.tokenId, params.greenhouseId]
    );
    if (!row) return false;

    this.ensureDriver().runInTransaction(() => {
      this.runStmt(
        'UPDATE enrollment_tokens SET revoked_at = ? WHERE id = ?',
        [new Date().toISOString(), params.tokenId],
        false
      );
      this.recordAuditEvent({
        greenhouseId: params.greenhouseId,
        actorUserId: params.actorUserId,
        eventType: 'QR_TOKEN_REVOKED',
        summary: `Enrollment QR token ${params.tokenId} revoked.`,
        ipAddress: params.ipAddress
      });
    });
    return true;
  }

  public listTokensForGreenhouse(greenhouseId: string): EnrollmentTokenSummary[] {
    const nowMs = Date.now();
    const rows = this.queryAll<any>(
      `SELECT id, token_prefix, purpose, greenhouse_id, target_device_id, target_zone_id,
              kit_serial, kit_model, role_granted, expires_at, used_at, revoked_at, created_at
       FROM enrollment_tokens
       WHERE greenhouse_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [greenhouseId]
    );
    return rows.map((r) => {
      const revokedAt = r.revoked_at ? String(r.revoked_at) : null;
      const usedAt = r.used_at ? String(r.used_at) : null;
      const expiresAt = String(r.expires_at);
      let status: EnrollmentTokenSummary['status'] = 'active';
      if (revokedAt) status = 'revoked';
      else if (usedAt) status = 'used';
      else if (new Date(expiresAt).getTime() <= nowMs) status = 'expired';

      return {
        id: String(r.id),
        tokenPrefix: String(r.token_prefix),
        purpose: String(r.purpose) as EnrollmentTokenPurpose,
        greenhouseId: r.greenhouse_id ? String(r.greenhouse_id) : null,
        targetDeviceId: r.target_device_id ? String(r.target_device_id) : null,
        targetZoneId: r.target_zone_id ? String(r.target_zone_id) : null,
        kitSerial: r.kit_serial ? String(r.kit_serial) : null,
        kitModel: r.kit_model ? String(r.kit_model) : null,
        roleGranted: String(r.role_granted) as GreenhouseMemberRole,
        status,
        expiresAt,
        usedAt,
        revokedAt,
        createdAt: String(r.created_at)
      };
    });
  }

  // ------------------------------------------------------------------
  // PER-DEVICE CREDENTIALS, MULTI-DEVICE SUPPORT, REVOCATION & CHECK-IN
  // ------------------------------------------------------------------

  public listDevicesForGreenhouse(greenhouseId: string, nowMs: number = Date.now()): DeviceRecord[] {
    const rows = this.queryAll<any>(
      'SELECT * FROM devices WHERE greenhouse_id = ? ORDER BY device_type ASC, created_at ASC',
      [greenhouseId]
    );
    return rows.map((r) => this.mapDeviceRow(r, nowMs));
  }

  private mapDeviceRow(r: any, nowMs: number = Date.now()): DeviceRecord {
    const deviceType = String(r.device_type) as GreenhouseDeviceType;
    const hasCredentialIssued = Boolean(r.credential_hash && !r.revoked_at);
    const revokedAt = r.revoked_at ? String(r.revoked_at) : null;
    const lastSeenAt = r.last_seen_at ? String(r.last_seen_at) : null;
    const lastTelemetryAt = r.last_telemetry_at ? String(r.last_telemetry_at) : null;
    const lastUploadAt = r.last_upload_at ? String(r.last_upload_at) : null;
    const lastErrorCategory =
      r.last_error_category === 'AUTH' || r.last_error_category === 'CONNECTION'
        ? r.last_error_category
        : null;
    const lastErrorCode = r.last_error_code ? String(r.last_error_code) : null;
    const lastErrorMessage = r.last_error_message ? String(r.last_error_message) : null;
    const lastErrorAt = r.last_error_at ? String(r.last_error_at) : null;

    const computed = computeExplicitDeviceState({
      deviceType,
      hasCredentialIssued,
      revokedAt,
      lastSeenAt,
      lastDataTimestamp: deviceType === 'esp32_cam' ? lastUploadAt : lastTelemetryAt,
      lastErrorCategory,
      lastErrorAt,
      nowMs
    });

    let capabilities: Record<string, unknown> = {};
    if (r.capabilities_json) {
      try {
        capabilities = JSON.parse(String(r.capabilities_json));
      } catch {
        capabilities = {};
      }
    }

    const credPrefix = r.credential_prefix ? String(r.credential_prefix) : null;
    return {
      id: String(r.id),
      greenhouseId: String(r.greenhouse_id),
      zoneId: r.zone_id ? String(r.zone_id) : null,
      deviceType,
      label: String(r.label),
      credentialPrefix: credPrefix,
      keyPrefix: credPrefix,
      hasCredentialIssued,
      provisioningStatus: String(r.provisioning_status) as DeviceProvisioningStatus,
      explicitState: computed.explicitState,
      ageSeconds: computed.ageSeconds,
      onlineMaxAgeSeconds: computed.onlineMaxAgeSeconds,
      staleMaxAgeSeconds: computed.staleMaxAgeSeconds,
      firmwareVersion: r.firmware_version ? String(r.firmware_version) : null,
      targetFirmwareVersion: r.target_firmware_version ? String(r.target_firmware_version) : null,
      otaStatus: r.ota_status ? String(r.ota_status) : 'idle',
      serialNumber: r.serial_number ? String(r.serial_number) : null,
      hardwareIdentityUid: r.hardware_identity_uid ? String(r.hardware_identity_uid) : null,
      macAddress: r.mac_address ? String(r.mac_address) : null,
      credentialRotatedAt: r.credential_rotated_at ? String(r.credential_rotated_at) : null,
      replacedByDeviceId: r.replaced_by_device_id ? String(r.replaced_by_device_id) : null,
      capabilities,
      lastSeenAt,
      lastTelemetryAt,
      lastUploadAt,
      lastErrorCategory,
      lastErrorCode,
      lastErrorMessage,
      lastErrorAt,
      revokedAt,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  /**
   * Supports both legacy single-slot updates AND 1-to-N multi-device registration
   * (`createAdditionalSlot: true` or targeting a specific `deviceId` / `zoneId`).
   */
  public registerOrUpdateDevice(params: {
    greenhouseId: string;
    actorUserId: string;
    deviceType: GreenhouseDeviceType;
    deviceId?: string;
    zoneId?: string | null;
    label?: string;
    serialNumber?: string | null;
    capabilities?: Record<string, unknown>;
    createAdditionalSlot?: boolean;
    ipAddress?: string;
  }):
    | { ok: true; device: DeviceRecord; created: boolean }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    const role = this.getMemberRole(params.greenhouseId, params.actorUserId);
    if (role !== 'owner' && role !== 'operator') {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'FORBIDDEN',
        message: 'Only greenhouse owners or operators can register or update devices.'
      };
    }

    if (params.zoneId) {
      const zoneExists = this.repositories.zonesAndHardware.getZoneById(
        params.greenhouseId,
        params.zoneId
      );
      if (!zoneExists) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'INVALID_ZONE_ID',
          message: 'Specified zoneId does not belong to this greenhouse.'
        };
      }
    }

    const defaultLabel =
      params.deviceType === 'esp32_cam' ? 'ESP32-CAM Crop Camera' : 'Main ESP32 Greenhouse Controller';
    const nextLabel = String(params.label || '').trim().slice(0, 80) || defaultLabel;
    const nowIso = new Date().toISOString();

    let existing: any = null;
    if (!params.createAdditionalSlot) {
      if (params.deviceId) {
        existing = this.queryOne<any>(
          'SELECT * FROM devices WHERE id = ? AND greenhouse_id = ?',
          [params.deviceId, params.greenhouseId]
        );
      } else {
        existing = this.queryOne<any>(
          'SELECT * FROM devices WHERE greenhouse_id = ? AND device_type = ? AND replaced_by_device_id IS NULL ORDER BY created_at ASC LIMIT 1',
          [params.greenhouseId, params.deviceType]
        );
      }
    }

    if (existing) {
      this.ensureDriver().runInTransaction(() => {
        this.runStmt(
          `UPDATE devices
           SET label = ?,
               zone_id = COALESCE(?, zone_id),
               serial_number = COALESCE(?, serial_number),
               capabilities_json = COALESCE(?, capabilities_json),
               updated_at = ?
           WHERE id = ?`,
          [
            nextLabel,
            params.zoneId ?? null,
            params.serialNumber ?? null,
            params.capabilities ? JSON.stringify(params.capabilities) : null,
            nowIso,
            String(existing.id)
          ],
          false
        );
        if (params.capabilities) {
          this.repositories.zonesAndHardware.syncReportedCapabilities(
            params.greenhouseId,
            String(existing.id),
            params.capabilities
          );
        }
        this.recordAuditEvent({
          greenhouseId: params.greenhouseId,
          actorUserId: params.actorUserId,
          actorDeviceId: String(existing.id),
          eventType: 'DEVICE_UPDATED',
          summary: `Updated ${params.deviceType} registration label to "${nextLabel}".`,
          ipAddress: params.ipAddress
        });
      });
      const updated = this.queryOne<any>('SELECT * FROM devices WHERE id = ?', [String(existing.id)])!;
      return { ok: true, device: this.mapDeviceRow(updated), created: false };
    }

    const devId = generateSecureId(params.deviceType === 'esp32_cam' ? 'dev_cam' : 'dev_ctrl', 6);
    const resolvedZoneId =
      params.zoneId ||
      this.queryOne<{ id: string }>(
        'SELECT id FROM greenhouse_zones WHERE greenhouse_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 1',
        [params.greenhouseId]
      )?.id ||
      null;

    this.ensureDriver().runInTransaction(() => {
      this.runStmt(
        `INSERT INTO devices (
           id, greenhouse_id, zone_id, device_type, label, serial_number, capabilities_json,
           credential_hash, credential_prefix, provisioning_status, firmware_version,
           last_seen_at, last_ip, revoked_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending_setup', NULL, NULL, NULL, NULL, ?, ?)`,
        [
          devId,
          params.greenhouseId,
          resolvedZoneId,
          params.deviceType,
          nextLabel,
          params.serialNumber || null,
          JSON.stringify(params.capabilities || {}),
          nowIso,
          nowIso
        ],
        false
      );
      if (params.capabilities) {
        this.repositories.zonesAndHardware.syncReportedCapabilities(
          params.greenhouseId,
          devId,
          params.capabilities
        );
      }
      this.recordAuditEvent({
        greenhouseId: params.greenhouseId,
        actorUserId: params.actorUserId,
        actorDeviceId: devId,
        eventType: 'DEVICE_REGISTERED',
        summary: `Registered ${nextLabel} (${devId}) in pending_setup (CONFIGURATION_REQUIRED) state.`,
        ipAddress: params.ipAddress
      });
    });

    const inserted = this.queryOne<any>('SELECT * FROM devices WHERE id = ?', [devId])!;
    return { ok: true, device: this.mapDeviceRow(inserted), created: true };
  }

  public recordDeviceError(params: {
    greenhouseId?: string | null;
    deviceId?: string | null;
    expectedType?: GreenhouseDeviceType;
    category: 'AUTH' | 'CONNECTION';
    errorCode: string;
    message: string;
    ipAddress?: string | null;
  }): void {
    let targetRow: any = null;
    if (params.deviceId) {
      targetRow = params.greenhouseId
        ? this.queryOne<any>('SELECT * FROM devices WHERE id = ? AND greenhouse_id = ?', [
            params.deviceId,
            params.greenhouseId
          ])
        : this.queryOne<any>('SELECT * FROM devices WHERE id = ?', [params.deviceId]);
    }
    if (!targetRow && params.greenhouseId && params.expectedType) {
      targetRow = this.queryOne<any>(
        'SELECT * FROM devices WHERE greenhouse_id = ? AND device_type = ? ORDER BY created_at ASC LIMIT 1',
        [params.greenhouseId, params.expectedType]
      );
    }
    if (!targetRow) return;

    const nowIso = new Date().toISOString();
    const safeMsg = redactSecretsFromText(params.message).slice(0, 240);
    const safeCode = String(params.errorCode || 'HARDWARE_ERROR').slice(0, 64);

    this.ensureDriver().runInTransaction(() => {
      this.runStmt(
        `UPDATE devices
         SET last_error_category = ?,
             last_error_code = ?,
             last_error_message = ?,
             last_error_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [params.category, safeCode, safeMsg, nowIso, nowIso, String(targetRow.id)],
        false
      );

      this.recordAuditEvent({
        greenhouseId: String(targetRow.greenhouse_id),
        actorDeviceId: String(targetRow.id),
        eventType: params.category === 'AUTH' ? 'DEVICE_AUTH_ERROR' : 'DEVICE_CONNECTION_ERROR',
        summary: `${targetRow.label}: [${safeCode}] ${safeMsg}`,
        ipAddress: params.ipAddress || null
      });
    });
  }

  public issueDeviceCredential(params: {
    greenhouseId: string;
    deviceId: string;
    actorUserId: string;
    ipAddress?: string;
  }):
    | { ok: true; device: DeviceRecord; oneTimeDeviceKey: string }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    const role = this.getMemberRole(params.greenhouseId, params.actorUserId);
    if (role !== 'owner' && role !== 'operator') {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'FORBIDDEN',
        message: 'Only greenhouse owners or operators can issue or rotate hardware credentials.'
      };
    }

    const row = this.queryOne<any>('SELECT * FROM devices WHERE id = ? AND greenhouse_id = ?', [
      params.deviceId,
      params.greenhouseId
    ]);
    if (!row) {
      return { ok: false, statusCode: 404, errorCode: 'DEVICE_NOT_FOUND', message: 'Device not found in greenhouse.' };
    }

    const devType = String(row.device_type) as GreenhouseDeviceType;
    const rawKey = generateSecureId(devType === 'esp32_cam' ? 'edcam' : 'edctrl', 20);
    const keyHash = sha256Hex(rawKey);
    const keyPrefix = rawKey.slice(0, 12);
    const nowIso = new Date().toISOString();
    const isRotation = Boolean(row.credential_hash);

    this.ensureDriver().runInTransaction(() => {
      this.runStmt(
        `UPDATE devices
         SET credential_hash = ?,
             credential_prefix = ?,
             provisioning_status = 'awaiting_first_checkin',
             credential_rotated_at = ?,
             revoked_at = NULL,
             last_error_category = NULL,
             last_error_code = NULL,
             last_error_message = NULL,
             last_error_at = NULL,
             updated_at = ?
         WHERE id = ?`,
        [keyHash, keyPrefix, isRotation ? nowIso : null, nowIso, params.deviceId],
        false
      );

      this.recordAuditEvent({
        greenhouseId: params.greenhouseId,
        actorUserId: params.actorUserId,
        actorDeviceId: params.deviceId,
        eventType: 'DEVICE_CREDENTIAL_ISSUED',
        summary: `Unique hardware credential ${isRotation ? 'rotated' : 'issued'} for ${row.label} (${params.deviceId}). Status: awaiting first authenticated check-in.`,
        ipAddress: params.ipAddress
      });
    });

    const updated = this.queryOne<any>('SELECT * FROM devices WHERE id = ?', [params.deviceId])!;
    return {
      ok: true,
      device: this.mapDeviceRow(updated),
      oneTimeDeviceKey: rawKey
    };
  }

  public bootstrapDeviceWithToken(params: {
    rawBootstrapCode: string;
    deviceType: GreenhouseDeviceType;
    targetDeviceId?: string | null;
    zoneId?: string | null;
    label?: string | null;
    firmwareVersion?: string | null;
    serialNumber?: string | null;
    macAddress?: string | null;
    hardwareIdentityUid?: string | null;
    capabilities?: Record<string, unknown> | unknown[];
    ipAddress?: string;
  }):
    | {
        ok: true;
        greenhouseId: string;
        zoneId: string | null;
        deviceId: string;
        deviceKey: string;
        label: string;
        createdSlot: boolean;
      }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    const inspected = this.inspectEnrollmentCode(params.rawBootstrapCode);
    if ('errorCode' in inspected) {
      return inspected;
    }
    if (inspected.purpose !== 'device_bootstrap' || !inspected.greenhouseId) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_BOOTSTRAP_TOKEN',
        message: 'Token is not a valid device_bootstrap token.'
      };
    }

    const greenhouseId = inspected.greenhouseId;
    const requestedZoneId = inspected.targetZoneId || params.zoneId || null;

    if (requestedZoneId) {
      const validZone = this.repositories.zonesAndHardware.getZoneById(greenhouseId, requestedZoneId);
      if (!validZone) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'INVALID_ZONE_ID',
          message: 'Target zone does not exist in this greenhouse.'
        };
      }
    }

    let devRow: any = null;
    let createdSlot = false;

    // 1. Server-bound targetDeviceId takes highest authority (prevents slot-spoofing)
    if (inspected.targetDeviceId) {
      devRow = this.queryOne<any>(
        'SELECT * FROM devices WHERE id = ? AND greenhouse_id = ?',
        [inspected.targetDeviceId, greenhouseId]
      );
      if (!devRow) {
        return {
          ok: false,
          statusCode: 404,
          errorCode: 'TARGET_DEVICE_NOT_FOUND',
          message: 'The device slot bound to this bootstrap token no longer exists.'
        };
      }
      if (String(devRow.device_type) !== params.deviceType) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'WRONG_DEVICE_TYPE_FOR_TOKEN',
          message: `Bootstrap token is bound to a ${devRow.device_type} slot, not ${params.deviceType}.`
        };
      }
      if (devRow.replaced_by_device_id) {
        return {
          ok: false,
          statusCode: 409,
          errorCode: 'DEVICE_ALREADY_REPLACED',
          message: 'This retired device slot was replaced by a newer hardware unit.'
        };
      }
    } else if (params.targetDeviceId) {
      // 2. Caller-specified targetDeviceId (when token is greenhouse-scoped)
      devRow = this.queryOne<any>(
        'SELECT * FROM devices WHERE id = ? AND greenhouse_id = ?',
        [params.targetDeviceId, greenhouseId]
      );
      if (!devRow) {
        return {
          ok: false,
          statusCode: 404,
          errorCode: 'TARGET_DEVICE_NOT_FOUND',
          message: 'Requested targetDeviceId was not found in this greenhouse.'
        };
      }
      if (String(devRow.device_type) !== params.deviceType) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'WRONG_DEVICE_TYPE_FOR_TOKEN',
          message: `Target device ${params.targetDeviceId} is ${devRow.device_type}, not ${params.deviceType}.`
        };
      }
    } else if (params.hardwareIdentityUid) {
      // 3. Re-bootstrap of the exact same physical ESP32 EFuse hardware identity UID
      devRow = this.queryOne<any>(
        `SELECT * FROM devices
         WHERE greenhouse_id = ? AND device_type = ? AND hardware_identity_uid = ? AND replaced_by_device_id IS NULL
         ORDER BY created_at ASC LIMIT 1`,
        [greenhouseId, params.deviceType, String(params.hardwareIdentityUid).trim()]
      );
    }

    // 4. Prefer an unprovisioned (`credential_hash IS NULL`) active slot in the target zone or greenhouse
    if (!devRow) {
      if (requestedZoneId) {
        devRow = this.queryOne<any>(
          `SELECT * FROM devices
           WHERE greenhouse_id = ? AND device_type = ? AND zone_id = ?
             AND credential_hash IS NULL AND revoked_at IS NULL AND replaced_by_device_id IS NULL
           ORDER BY created_at ASC LIMIT 1`,
          [greenhouseId, params.deviceType, requestedZoneId]
        );
      }
      if (!devRow) {
        devRow = this.queryOne<any>(
          `SELECT * FROM devices
           WHERE greenhouse_id = ? AND device_type = ?
             AND credential_hash IS NULL AND revoked_at IS NULL AND replaced_by_device_id IS NULL
           ORDER BY created_at ASC LIMIT 1`,
          [greenhouseId, params.deviceType]
        );
      }
    }

    const rawKey = generateSecureId(params.deviceType === 'esp32_cam' ? 'edcam' : 'edctrl', 20);
    const nowIso = new Date().toISOString();
    const cleanSerial =
      params.serialNumber || inspected.kitSerial
        ? String(params.serialNumber || inspected.kitSerial).trim().slice(0, 64)
        : null;
    const cleanMac = params.macAddress ? String(params.macAddress).trim().toUpperCase().slice(0, 32) : null;
    const cleanHwUid = params.hardwareIdentityUid
      ? String(params.hardwareIdentityUid).trim().slice(0, 64)
      : null;
    const cleanFw = params.firmwareVersion ? String(params.firmwareVersion).trim().slice(0, 48) : null;
    const capabilitiesObj =
      params.capabilities && typeof params.capabilities === 'object' && !Array.isArray(params.capabilities)
        ? (params.capabilities as Record<string, unknown>)
        : Array.isArray(params.capabilities)
          ? { items: params.capabilities }
          : null;

    let finalDeviceId = '';
    let finalZoneId: string | null = null;
    let finalLabel = '';

    this.ensureDriver().runInTransaction(() => {
      this.runStmt(
        'UPDATE enrollment_tokens SET used_at = ? WHERE id = ?',
        [nowIso, inspected.tokenId],
        false
      );

      // 5. If all existing slots of this type already have credentials issued, dynamically create a 1-to-N slot
      if (!devRow) {
        createdSlot = true;
        finalDeviceId = generateSecureId(params.deviceType === 'esp32_cam' ? 'dev_cam' : 'dev_ctrl', 6);
        finalZoneId =
          requestedZoneId ||
          this.queryOne<{ id: string }>(
            'SELECT id FROM greenhouse_zones WHERE greenhouse_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 1',
            [greenhouseId]
          )?.id ||
          null;
        const countExisting =
          Number(
            this.queryOne<{ c: number }>(
              'SELECT COUNT(*) AS c FROM devices WHERE greenhouse_id = ? AND device_type = ?',
              [greenhouseId, params.deviceType]
            )?.c || 0
          ) + 1;
        const baseLabel =
          params.deviceType === 'esp32_cam'
            ? `ESP32-CAM Crop Camera #${countExisting}`
            : `ESP32 Greenhouse Controller #${countExisting}`;
        finalLabel = String(params.label || '').trim().slice(0, 80) || baseLabel;

        this.runStmt(
          `INSERT INTO devices (
             id, greenhouse_id, zone_id, device_type, label, serial_number, hardware_identity_uid,
             mac_address, capabilities_json, credential_hash, credential_prefix,
             provisioning_status, firmware_version, last_seen_at, last_ip, revoked_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_first_checkin', ?, NULL, ?, NULL, ?, ?)`,
          [
            finalDeviceId,
            greenhouseId,
            finalZoneId,
            params.deviceType,
            finalLabel,
            cleanSerial,
            cleanHwUid,
            cleanMac,
            JSON.stringify(capabilitiesObj || {}),
            sha256Hex(rawKey),
            rawKey.slice(0, 12),
            cleanFw,
            params.ipAddress || null,
            nowIso,
            nowIso
          ],
          false
        );
      } else {
        finalDeviceId = String(devRow.id);
        finalZoneId = requestedZoneId || (devRow.zone_id ? String(devRow.zone_id) : null);
        finalLabel = String(params.label || '').trim().slice(0, 80) || String(devRow.label);
        const isRotation = Boolean(devRow.credential_hash);

        this.runStmt(
          `UPDATE devices
           SET label = ?,
               zone_id = COALESCE(?, zone_id),
               credential_hash = ?,
               credential_prefix = ?,
               provisioning_status = 'awaiting_first_checkin',
               credential_rotated_at = CASE WHEN ? = 1 THEN ? ELSE credential_rotated_at END,
               firmware_version = COALESCE(?, firmware_version),
               serial_number = COALESCE(?, serial_number),
               hardware_identity_uid = COALESCE(?, hardware_identity_uid),
               mac_address = COALESCE(?, mac_address),
               capabilities_json = COALESCE(?, capabilities_json),
               last_ip = COALESCE(?, last_ip),
               revoked_at = NULL,
               last_error_category = NULL,
               last_error_code = NULL,
               last_error_message = NULL,
               last_error_at = NULL,
               updated_at = ?
           WHERE id = ?`,
          [
            finalLabel,
            finalZoneId,
            sha256Hex(rawKey),
            rawKey.slice(0, 12),
            isRotation ? 1 : 0,
            nowIso,
            cleanFw,
            cleanSerial,
            cleanHwUid,
            cleanMac,
            capabilitiesObj ? JSON.stringify(capabilitiesObj) : null,
            params.ipAddress || null,
            nowIso,
            finalDeviceId
          ],
          false
        );
      }

      if (params.capabilities) {
        this.repositories.zonesAndHardware.syncReportedCapabilities(
          greenhouseId,
          finalDeviceId,
          params.capabilities
        );
      }

      if (cleanFw) {
        this.repositories.zonesAndHardware.recordFirmwareVersionReport({
          deviceId: finalDeviceId,
          greenhouseId,
          previousVersion: devRow?.firmware_version ? String(devRow.firmware_version) : null,
          reportedVersion: cleanFw,
          updateStatus: 'bootstrapped'
        });
      }

      this.runStmt(
        `UPDATE greenhouses
         SET wifi_provisioning_state = CASE
               WHEN wifi_provisioning_state = 'verified_online' THEN 'verified_online'
               ELSE 'credentials_staged'
             END,
             updated_at = ?
         WHERE id = ?`,
        [nowIso, greenhouseId],
        false
      );

      this.recordAuditEvent({
        greenhouseId,
        actorDeviceId: finalDeviceId,
        eventType: 'DEVICE_BOOTSTRAPPED',
        summary: `Hardware ${finalLabel} (${finalDeviceId}) redeemed one-time bootstrap token via Plug-and-Play onboarding.`,
        metadata: {
          deviceId: finalDeviceId,
          zoneId: finalZoneId,
          deviceType: params.deviceType,
          createdSlot,
          firmwareVersion: cleanFw,
          hardwareIdentityUid: cleanHwUid,
          macAddress: cleanMac
        },
        ipAddress: params.ipAddress
      });
    });

    return {
      ok: true,
      greenhouseId,
      zoneId: finalZoneId,
      deviceId: finalDeviceId,
      deviceKey: rawKey,
      label: finalLabel,
      createdSlot
    };
  }

  /**
   * Atomically replaces a faulty or retired hardware unit:
   * - Revokes the failed device's credential immediately (`401 DEVICE_REVOKED` on any stray uploads)
   * - Links `replaced_by_device_id` on the retired row while preserving 100% of historical telemetry & audit logs
   * - Creates the replacement device slot in the exact same `zone_id` (inheriting capabilities & OTA targets)
   * - Optionally issues a one-time `device_bootstrap` token bound to the new device for Plug-and-Play pairing
   */
  public replaceDevice(params: {
    greenhouseId: string;
    oldDeviceId: string;
    actorUserId: string;
    newLabel?: string;
    newSerialNumber?: string | null;
    reason?: string;
    issueBootstrapToken?: boolean;
    ttlMinutes?: number;
    publicOrigin?: string;
    ipAddress?: string;
  }):
    | {
        ok: true;
        replacedDevice: DeviceRecord;
        replacementDevice: DeviceRecord;
        preservedTelemetryCount: number;
        bootstrap: {
          tokenId: string;
          rawCode: string;
          qrPayloadUri: string;
          expiresAt: string;
        } | null;
      }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    const role = this.getMemberRole(params.greenhouseId, params.actorUserId);
    if (role !== 'owner' && role !== 'operator') {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'FORBIDDEN',
        message: 'Only greenhouse owners or operators can replace greenhouse hardware.'
      };
    }

    const oldRow = this.queryOne<any>(
      'SELECT * FROM devices WHERE id = ? AND greenhouse_id = ?',
      [params.oldDeviceId, params.greenhouseId]
    );
    if (!oldRow) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'DEVICE_NOT_FOUND',
        message: 'Device to replace was not found in this greenhouse.'
      };
    }

    if (oldRow.replaced_by_device_id) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'DEVICE_ALREADY_REPLACED',
        message: `Device ${params.oldDeviceId} has already been replaced by ${oldRow.replaced_by_device_id}.`
      };
    }

    const devType = String(oldRow.device_type) as GreenhouseDeviceType;
    const newDeviceId = generateSecureId(devType === 'esp32_cam' ? 'dev_cam' : 'dev_ctrl', 6);
    const nextLabel =
      String(params.newLabel || '').trim().slice(0, 80) || `${oldRow.label} (Replacement)`;
    const reason = String(params.reason || 'Hardware maintenance / faulty board replacement')
      .trim()
      .slice(0, 200);
    const nowIso = new Date().toISOString();

    const preservedTelemetryCount = Number(
      this.queryOne<{ c: number }>(
        'SELECT COUNT(*) AS c FROM telemetry_readings WHERE greenhouse_id = ? AND device_id = ?',
        [params.greenhouseId, params.oldDeviceId]
      )?.c || 0
    );

    const oldCapabilities = this.repositories.zonesAndHardware.listDeviceCapabilities(
      params.greenhouseId,
      params.oldDeviceId
    );

    this.ensureDriver().runInTransaction(() => {
      // 1. Insert clean replacement slot in the exact same zone
      this.runStmt(
        `INSERT INTO devices (
           id, greenhouse_id, zone_id, device_type, label, serial_number, capabilities_json,
           target_firmware_version, ota_status,
           credential_hash, credential_prefix, provisioning_status, firmware_version,
           last_seen_at, last_ip, revoked_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, NULL, 'pending_setup', NULL, NULL, NULL, NULL, ?, ?)`,
        [
          newDeviceId,
          params.greenhouseId,
          oldRow.zone_id || null,
          devType,
          nextLabel,
          params.newSerialNumber ? String(params.newSerialNumber).trim().slice(0, 64) : null,
          String(oldRow.capabilities_json || '{}'),
          oldRow.target_firmware_version || null,
          nowIso,
          nowIso
        ],
        false
      );

      // Copy structured capability manifest to the replacement slot
      for (const cap of oldCapabilities) {
        this.repositories.zonesAndHardware.upsertDeviceCapability({
          deviceId: newDeviceId,
          greenhouseId: params.greenhouseId,
          capabilityKind: cap.capabilityKind,
          channelKey: cap.channelKey,
          displayLabel: cap.displayLabel,
          unit: cap.unit,
          minSafeValue: cap.minSafeValue,
          maxSafeValue: cap.maxSafeValue,
          maxDurationSeconds: cap.maxDurationSeconds,
          cooldownSeconds: cap.cooldownSeconds,
          calibration: cap.calibration,
          isEnabled: cap.isEnabled
        });
      }

      // 2. Revoke failed unit & link replaced_by_device_id without deleting historical records
      this.runStmt(
        `UPDATE devices
         SET provisioning_status = 'revoked',
             revoked_at = COALESCE(revoked_at, ?),
             replaced_by_device_id = ?,
             updated_at = ?
         WHERE id = ?`,
        [nowIso, newDeviceId, nowIso, params.oldDeviceId],
        false
      );

      this.recordAuditEvent({
        greenhouseId: params.greenhouseId,
        actorUserId: params.actorUserId,
        actorDeviceId: newDeviceId,
        eventType: 'DEVICE_REPLACED',
        summary: `Replaced ${oldRow.label} (${params.oldDeviceId}) with ${nextLabel} (${newDeviceId}). Old credential revoked; ${preservedTelemetryCount} historical telemetry records preserved.`,
        metadata: {
          oldDeviceId: params.oldDeviceId,
          newDeviceId,
          zoneId: oldRow.zone_id || null,
          reason,
          preservedTelemetryCount
        },
        ipAddress: params.ipAddress
      });
    });

    let bootstrap: {
      tokenId: string;
      rawCode: string;
      qrPayloadUri: string;
      expiresAt: string;
    } | null = null;

    if (params.issueBootstrapToken !== false) {
      const tok = this.issueEnrollmentToken({
        purpose: 'device_bootstrap',
        greenhouseId: params.greenhouseId,
        targetDeviceId: newDeviceId,
        targetZoneId: oldRow.zone_id ? String(oldRow.zone_id) : null,
        kitSerial: params.newSerialNumber || null,
        createdByUserId: params.actorUserId,
        ttlMinutes: params.ttlMinutes ?? 45,
        publicOrigin: params.publicOrigin,
        ipAddress: params.ipAddress
      });
      bootstrap = {
        tokenId: tok.tokenId,
        rawCode: tok.rawCode,
        qrPayloadUri: tok.qrPayloadUri,
        expiresAt: tok.expiresAt
      };
    }

    const updatedOld = this.queryOne<any>('SELECT * FROM devices WHERE id = ?', [params.oldDeviceId])!;
    const createdNew = this.queryOne<any>('SELECT * FROM devices WHERE id = ?', [newDeviceId])!;

    return {
      ok: true,
      replacedDevice: this.mapDeviceRow(updatedOld),
      replacementDevice: this.mapDeviceRow(createdNew),
      preservedTelemetryCount,
      bootstrap
    };
  }

  public revokeDevice(params: {
    greenhouseId: string;
    deviceId: string;
    actorUserId: string;
    ipAddress?: string;
  }):
    | { ok: true; device: DeviceRecord }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    const role = this.getMemberRole(params.greenhouseId, params.actorUserId);
    if (role !== 'owner' && role !== 'operator') {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'FORBIDDEN',
        message: 'Only greenhouse owners or operators can revoke device credentials.'
      };
    }

    const row = this.queryOne<any>('SELECT * FROM devices WHERE id = ? AND greenhouse_id = ?', [
      params.deviceId,
      params.greenhouseId
    ]);
    if (!row) {
      return { ok: false, statusCode: 404, errorCode: 'DEVICE_NOT_FOUND', message: 'Device not found.' };
    }

    const nowIso = new Date().toISOString();
    this.ensureDriver().runInTransaction(() => {
      this.runStmt(
        `UPDATE devices
         SET provisioning_status = 'revoked', revoked_at = ?, updated_at = ?
         WHERE id = ?`,
        [nowIso, nowIso, params.deviceId],
        false
      );

      this.recordAuditEvent({
        greenhouseId: params.greenhouseId,
        actorUserId: params.actorUserId,
        actorDeviceId: params.deviceId,
        eventType: 'DEVICE_REVOKED',
        summary: `Device credential revoked for ${row.label} (${params.deviceId}). Subsequent uploads with old credential will be rejected.`,
        ipAddress: params.ipAddress
      });
    });

    const updated = this.queryOne<any>('SELECT * FROM devices WHERE id = ?', [params.deviceId])!;
    return { ok: true, device: this.mapDeviceRow(updated) };
  }

  public authenticateDeviceKey(params: {
    rawKey: string;
    expectedType: GreenhouseDeviceType;
    claimedGreenhouseId?: string;
    claimedDeviceId?: string;
  }):
    | { ok: true; device: DeviceRecord }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    const trimmed = String(params.rawKey || '').trim();
    if (!trimmed) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: 'MISSING_DEVICE_CREDENTIAL',
        message: 'Missing per-device authentication key.'
      };
    }

    const row = this.queryOne<any>('SELECT * FROM devices WHERE credential_hash = ?', [sha256Hex(trimmed)]);
    if (!row) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: 'UNAUTHORIZED_DEVICE',
        message: 'Invalid device authentication key.'
      };
    }

    if (row.revoked_at || String(row.provisioning_status) === 'revoked') {
      return {
        ok: false,
        statusCode: 401,
        errorCode: 'DEVICE_REVOKED',
        message: 'This device credential has been revoked. Issue a new credential in Greenhouse Setup.'
      };
    }

    if (String(row.device_type) !== params.expectedType) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'WRONG_DEVICE_TYPE',
        message: `Credential belongs to ${row.device_type}, expected ${params.expectedType}.`
      };
    }

    if (params.claimedGreenhouseId && params.claimedGreenhouseId !== String(row.greenhouse_id)) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'GREENHOUSE_MISMATCH',
        message: 'X-Greenhouse-Id header does not match the greenhouse bound to this device credential.'
      };
    }

    if (params.claimedDeviceId && params.claimedDeviceId !== String(row.id)) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'DEVICE_ID_MISMATCH',
        message: 'X-Device-Id header does not match this device credential.'
      };
    }

    return { ok: true, device: this.mapDeviceRow(row) };
  }

  public recordDeviceCheckIn(params: {
    deviceId: string;
    greenhouseId: string;
    firmwareVersion?: string;
    ipAddress?: string;
    checkInKind?: 'camera_upload' | 'telemetry_upload';
    dataTimestamp?: string;
  }): void {
    const prev = this.queryOne<any>(
      'SELECT provisioning_status, label, device_type, firmware_version FROM devices WHERE id = ?',
      [params.deviceId]
    );
    const nowIso = new Date().toISOString();
    const resolvedKind =
      params.checkInKind ||
      (prev && String(prev.device_type) === 'esp32_cam' ? 'camera_upload' : 'telemetry_upload');
    const dataIso = params.dataTimestamp || nowIso;

    this.ensureDriver().runInTransaction(() => {
      this.runStmt(
        `UPDATE devices
         SET provisioning_status = 'connected',
             last_seen_at = ?,
             last_upload_at = CASE WHEN ? = 'camera_upload' THEN ? ELSE last_upload_at END,
             last_telemetry_at = CASE WHEN ? = 'telemetry_upload' THEN ? ELSE last_telemetry_at END,
             last_error_category = NULL,
             last_error_code = NULL,
             last_error_message = NULL,
             last_error_at = NULL,
             last_ip = COALESCE(?, last_ip),
             firmware_version = COALESCE(?, firmware_version),
             updated_at = ?
         WHERE id = ?`,
        [
          nowIso,
          resolvedKind,
          dataIso,
          resolvedKind,
          dataIso,
          params.ipAddress || null,
          params.firmwareVersion || null,
          nowIso,
          params.deviceId
        ],
        false
      );

      this.runStmt(
        `UPDATE greenhouses
         SET wifi_provisioning_state = 'verified_online', updated_at = ?
         WHERE id = ?`,
        [nowIso, params.greenhouseId],
        false
      );

      // Track firmware version transitions automatically
      const prevFw = prev?.firmware_version ? String(prev.firmware_version) : null;
      if (params.firmwareVersion && params.firmwareVersion !== prevFw) {
        this.repositories.zonesAndHardware.recordFirmwareVersionReport({
          deviceId: params.deviceId,
          greenhouseId: params.greenhouseId,
          previousVersion: prevFw,
          reportedVersion: params.firmwareVersion,
          updateStatus: prevFw ? 'upgraded_or_changed' : 'initial_report'
        });
      }

      if (prev && String(prev.provisioning_status) !== 'connected') {
        this.recordAuditEvent({
          greenhouseId: params.greenhouseId,
          actorDeviceId: params.deviceId,
          eventType: 'DEVICE_FIRST_CHECKIN',
          summary: `${prev.label} (${params.deviceId}) completed its first authenticated cloud check-in.`,
          ipAddress: params.ipAddress
        });
      }
    });
  }

  // ------------------------------------------------------------------
  // CONTROLLER TELEMETRY STORAGE, ROLLUPS & TIERED RETENTION
  // ------------------------------------------------------------------

  public storeControllerTelemetry(params: {
    greenhouseId: string;
    deviceId: string;
    zoneId?: string | null;
    telemetry: ValidatedControllerTelemetry;
    ipAddress?: string;
    receivedAtMsOverride?: number;
  }): { readingId: string; recordedAt: string } {
    const readingId = generateSecureId('tel', 8);
    const nowMs = params.receivedAtMsOverride ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const vpdKpa = calculateVpdKpa(params.telemetry.temperature, params.telemetry.humidity);

    this.ensureDriver().runInTransaction(() => {
      const devZoneRow =
        params.zoneId !== undefined
          ? { zone_id: params.zoneId }
          : this.queryOne<{ zone_id: string | null }>('SELECT zone_id FROM devices WHERE id = ?', [
              params.deviceId
            ]);
      const resolvedZoneId = devZoneRow?.zone_id ? String(devZoneRow.zone_id) : null;

      this.runStmt(
        `INSERT INTO telemetry_readings (
           id, greenhouse_id, zone_id, device_id, recorded_at, received_at_ms,
           temperature, humidity, soil_moisture, sunlight, grow_light,
           water_level, battery_voltage, rain_detected, rain_gauge_level,
           vpd_kpa, quality_flag,
           sensor_health_json, actuators_json, interlocks_json, device_health_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALID', ?, ?, ?, ?)`,
        [
          readingId,
          params.greenhouseId,
          resolvedZoneId,
          params.deviceId,
          params.telemetry.timestamp,
          nowMs,
          params.telemetry.temperature,
          params.telemetry.humidity,
          params.telemetry.soilMoisture,
          params.telemetry.sunlight,
          params.telemetry.growLight,
          params.telemetry.waterLevel,
          params.telemetry.batteryVoltage,
          params.telemetry.rain === null ? null : params.telemetry.rain ? 1 : 0,
          params.telemetry.rainGaugeLevel,
          vpdKpa,
          JSON.stringify(params.telemetry.sensorHealth),
          JSON.stringify(params.telemetry.actuators),
          JSON.stringify(params.telemetry.interlocks),
          JSON.stringify(params.telemetry.deviceHealth)
        ],
        false
      );

      this.recordDeviceCheckIn({
        deviceId: params.deviceId,
        greenhouseId: params.greenhouseId,
        firmwareVersion: params.telemetry.deviceHealth.firmwareVersion,
        ipAddress: params.ipAddress,
        checkInKind: 'telemetry_upload',
        dataTimestamp: nowIso
      });

      // Incrementally maintain Hourly & Daily rollups (O(1) indexed upsert)
      this.repositories.telemetryHistory.upsertRollupsForSample({
        greenhouseId: params.greenhouseId,
        zoneId: resolvedZoneId,
        deviceId: params.deviceId,
        receivedAtMs: nowMs,
        telemetry: params.telemetry,
        vpdKpa
      });

      // Throttled configurable retention (90 days raw default instead of destructive 100-row cap)
      this.repositories.telemetryHistory.applyRetentionSweepIfDue(params.greenhouseId, nowMs);
    });

    return { readingId, recordedAt: params.telemetry.timestamp };
  }

  /**
   * Test helper to deterministically age stored telemetry & device heartbeat timestamps.
   */
  public setLatestTelemetryReceivedAtForTesting(greenhouseId: string, receivedAtMs: number): void {
    const iso = new Date(receivedAtMs).toISOString();
    const latest = this.queryOne<{ id: string; device_id: string }>(
      'SELECT id, device_id FROM telemetry_readings WHERE greenhouse_id = ? ORDER BY received_at_ms DESC LIMIT 1',
      [greenhouseId]
    );
    if (latest) {
      this.ensureDriver().runInTransaction(() => {
        this.runStmt(
          'UPDATE telemetry_readings SET received_at_ms = ?, recorded_at = ? WHERE id = ?',
          [receivedAtMs, iso, String(latest.id)],
          false
        );
        this.runStmt(
          'UPDATE devices SET last_seen_at = ?, last_telemetry_at = ? WHERE id = ?',
          [iso, iso, String(latest.device_id)],
          false
        );
      });
    }
  }

  public getLatestTelemetryForGreenhouse(
    greenhouseId: string,
    nowMs: number = Date.now(),
    filter?: { zoneId?: string; deviceId?: string }
  ): {
    exists: boolean;
    dataSource: 'REAL_HARDWARE' | 'CACHED' | 'STALE' | 'DISCONNECTED';
    connectionState: 'CONNECTED' | 'STALE' | 'DISCONNECTED';
    explicitState: ExplicitDeviceConnectionState;
    isStale: boolean;
    ageSeconds: number | null;
    timestamp: string | null;
    receivedAt?: string | null;
    zoneId?: string | null;
    deviceId: string | null;
    readings: {
      temperature: number | null;
      humidity: number | null;
      soilMoisture: number | null;
      sunlight: number | null;
      growLight: number | null;
      waterLevel: number | null;
      batteryVoltage: number | null;
      rain: boolean | null;
      rainGaugeLevel: number | null;
      vpdKpa?: number | null;
    } | null;
    sensorHealth: Record<string, string> | null;
    actuators: Record<string, boolean> | null;
    interlocks: Record<string, boolean> | null;
    deviceHealth: Record<string, unknown> | null;
    thresholds: typeof DEVICE_STATE_THRESHOLDS.esp32_controller;
  } {
    const ctrlDev = filter?.deviceId
      ? this.queryOne<any>(
          "SELECT * FROM devices WHERE greenhouse_id = ? AND id = ? AND device_type = 'esp32_controller'",
          [greenhouseId, filter.deviceId]
        )
      : filter?.zoneId
        ? this.queryOne<any>(
            "SELECT * FROM devices WHERE greenhouse_id = ? AND zone_id = ? AND device_type = 'esp32_controller' AND replaced_by_device_id IS NULL ORDER BY created_at ASC LIMIT 1",
            [greenhouseId, filter.zoneId]
          )
        : this.queryOne<any>(
            "SELECT * FROM devices WHERE greenhouse_id = ? AND device_type = 'esp32_controller' AND replaced_by_device_id IS NULL ORDER BY last_telemetry_at DESC, created_at ASC LIMIT 1",
            [greenhouseId]
          );

    const row = filter?.deviceId
      ? this.queryOne<any>(
          'SELECT * FROM telemetry_readings WHERE greenhouse_id = ? AND device_id = ? ORDER BY received_at_ms DESC LIMIT 1',
          [greenhouseId, filter.deviceId]
        )
      : filter?.zoneId
        ? this.queryOne<any>(
            'SELECT * FROM telemetry_readings WHERE greenhouse_id = ? AND zone_id = ? ORDER BY received_at_ms DESC LIMIT 1',
            [greenhouseId, filter.zoneId]
          )
        : this.queryOne<any>(
            'SELECT * FROM telemetry_readings WHERE greenhouse_id = ? ORDER BY received_at_ms DESC LIMIT 1',
            [greenhouseId]
          );

    const thresholds = DEVICE_STATE_THRESHOLDS.esp32_controller;

    if (!row) {
      const devState = ctrlDev
        ? this.mapDeviceRow(ctrlDev, nowMs).explicitState
        : 'CONFIGURATION_REQUIRED';
      return {
        exists: false,
        dataSource: 'DISCONNECTED',
        connectionState: 'DISCONNECTED',
        explicitState: devState,
        isStale: true,
        ageSeconds: null,
        timestamp: null,
        receivedAt: null,
        zoneId: filter?.zoneId || (ctrlDev?.zone_id ? String(ctrlDev.zone_id) : null),
        deviceId: ctrlDev ? String(ctrlDev.id) : null,
        readings: null,
        sensorHealth: null,
        actuators: null,
        interlocks: null,
        deviceHealth: null,
        thresholds
      };
    }

    const rowDev =
      this.queryOne<any>('SELECT * FROM devices WHERE id = ? AND greenhouse_id = ?', [
        String(row.device_id),
        greenhouseId
      ]) || ctrlDev;

    const ageSeconds = Math.max(0, Math.round((nowMs - Number(row.received_at_ms)) / 1000));
    let dataSource: 'REAL_HARDWARE' | 'CACHED' | 'STALE' | 'DISCONNECTED' = 'DISCONNECTED';
    let connectionState: 'CONNECTED' | 'STALE' | 'DISCONNECTED' = 'DISCONNECTED';
    let explicitState: ExplicitDeviceConnectionState = 'OFFLINE';
    let isStale = true;

    if (ageSeconds <= thresholds.onlineMaxAgeSeconds) {
      dataSource = 'REAL_HARDWARE';
      connectionState = 'CONNECTED';
      explicitState = 'ONLINE';
      isStale = false;
    } else if (ageSeconds <= thresholds.staleMaxAgeSeconds) {
      dataSource = 'STALE';
      connectionState = 'STALE';
      explicitState = 'STALE';
      isStale = true;
    } else {
      dataSource = 'DISCONNECTED';
      connectionState = 'DISCONNECTED';
      explicitState = 'OFFLINE';
      isStale = true;
    }

    // Surface recent auth/connection error if newer than last successful telemetry on the active controller
    const errCandidate = ctrlDev || rowDev;
    if (errCandidate) {
      const mapped = this.mapDeviceRow(errCandidate, nowMs);
      if (
        mapped.explicitState === 'AUTHENTICATION_ERROR' ||
        mapped.explicitState === 'CONNECTION_ERROR' ||
        mapped.explicitState === 'CONFIGURATION_REQUIRED'
      ) {
        explicitState = mapped.explicitState;
      }
    }

    const safeJson = (val: any) => {
      try {
        return JSON.parse(String(val || '{}'));
      } catch {
        return {};
      }
    };

    const toNullableNum = (val: unknown): number | null =>
      val === null || val === undefined ? null : Number(val);

    const receivedIso = new Date(Number(row.received_at_ms)).toISOString();

    return {
      exists: true,
      dataSource,
      connectionState,
      explicitState,
      isStale,
      ageSeconds,
      timestamp: String(row.recorded_at),
      receivedAt: receivedIso,
      zoneId: row.zone_id ? String(row.zone_id) : null,
      deviceId: String(row.device_id),
      readings: {
        temperature: toNullableNum(row.temperature),
        humidity: toNullableNum(row.humidity),
        soilMoisture: toNullableNum(row.soil_moisture),
        sunlight: toNullableNum(row.sunlight),
        growLight: toNullableNum(row.grow_light),
        waterLevel: toNullableNum(row.water_level),
        batteryVoltage: toNullableNum(row.battery_voltage),
        rain:
          row.rain_detected === null || row.rain_detected === undefined
            ? null
            : Number(row.rain_detected) === 1,
        rainGaugeLevel: toNullableNum(row.rain_gauge_level),
        vpdKpa: toNullableNum(row.vpd_kpa)
      },
      sensorHealth: safeJson(row.sensor_health_json),
      actuators: safeJson(row.actuators_json),
      interlocks: safeJson(row.interlocks_json),
      deviceHealth: safeJson(row.device_health_json),
      thresholds
    };
  }
}
