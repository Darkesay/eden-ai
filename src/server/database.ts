import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';
import {
  type DeviceProvisioningStatus,
  type EnrollmentTokenPurpose,
  type GreenhouseDeviceType,
  type GreenhouseMemberRole,
  type ValidatedControllerTelemetry,
  type WifiProvisioningMethod,
  type WifiProvisioningState,
  extractRawEnrollmentCode,
  generateSecureId,
  hashPasswordScrypt,
  sha256Hex,
  verifyPasswordScrypt
} from './telemetryContract.ts';

const require = createRequire(import.meta.url);

let cachedSqlEnginePromise: Promise<SqlJsStatic> | null = null;

async function getSqlEngine(): Promise<SqlJsStatic> {
  if (!cachedSqlEnginePromise) {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    const wasmBinary = fs.readFileSync(wasmPath);
    cachedSqlEnginePromise = initSqlJs({ wasmBinary });
  }
  return cachedSqlEnginePromise;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
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
  deviceType: GreenhouseDeviceType;
  label: string;
  credentialPrefix: string | null;
  hasCredentialIssued: boolean;
  provisioningStatus: DeviceProvisioningStatus;
  firmwareVersion: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnrollmentTokenSummary {
  id: string;
  tokenPrefix: string;
  purpose: EnrollmentTokenPurpose;
  greenhouseId: string | null;
  kitSerial: string | null;
  kitModel: string | null;
  roleGranted: GreenhouseMemberRole;
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

export interface PlatformDatabaseOptions {
  dbFilePath?: string;
  inMemoryOnly?: boolean;
  sessionTtlHours?: number;
}

const MIGRATION_V1_SQL = `
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
  temperature REAL NOT NULL,
  humidity REAL NOT NULL,
  soil_moisture REAL NOT NULL,
  sunlight REAL,
  grow_light REAL,
  water_level REAL,
  battery_voltage REAL,
  rain_detected INTEGER NOT NULL,
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
`;

export class PlatformDatabase {
  private readonly dbFilePath: string;
  private readonly inMemoryOnly: boolean;
  private readonly sessionTtlHours: number;
  private db: SqlJsDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(options: PlatformDatabaseOptions = {}) {
    this.inMemoryOnly = Boolean(options.inMemoryOnly);
    this.dbFilePath =
      options.dbFilePath ||
      process.env.DATABASE_PATH ||
      path.join(process.cwd(), 'data', 'edens_platform.sqlite');
    this.sessionTtlHours =
      options.sessionTtlHours ??
      Math.max(1, parseInt(process.env.SESSION_TTL_HOURS || '168', 10));
  }

  public isInitialized(): boolean {
    return Boolean(this.db);
  }

  public async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const SQL = await getSqlEngine();
        if (!this.inMemoryOnly && fs.existsSync(this.dbFilePath)) {
          try {
            const existingBytes = fs.readFileSync(this.dbFilePath);
            this.db = new SQL.Database(existingBytes);
          } catch (readErr: any) {
            console.error(
              `[EDENS AI DB Warning] Could not load SQLite file at ${this.dbFilePath} (${readErr?.message || readErr}); starting fresh in-memory database.`
            );
            this.db = new SQL.Database();
          }
        } else {
          this.db = new SQL.Database();
        }
        this.runMigrations();
      } catch (err: any) {
        this.initPromise = null;
        console.error('[EDENS AI DB Initialization Failure]:', err?.stack || err?.message || err);
        throw err;
      }
    })();

    return this.initPromise;
  }

  private ensureDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error('PlatformDatabase has not been initialized. Call await platformDb.init() first.');
    }
    return this.db;
  }

  private runMigrations(): void {
    const db = this.ensureDb();
    db.run(MIGRATION_V1_SQL);
    const existing = this.queryOne<{ version: string }>(
      'SELECT version FROM schema_migrations WHERE version = ?',
      ['v1_self_service_greenhouse_platform']
    );
    if (!existing) {
      db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        'v1_self_service_greenhouse_platform',
        new Date().toISOString()
      ]);
      this.persistToDisk();
    }
  }

  public persistToDisk(): void {
    if (this.inMemoryOnly || !this.db) return;
    try {
      const dir = path.dirname(this.dbFilePath);
      fs.mkdirSync(dir, { recursive: true });
      const data = this.db.export();
      const tmpPath = `${this.dbFilePath}.sqlite-tmp`;
      fs.writeFileSync(tmpPath, Buffer.from(data));
      fs.renameSync(tmpPath, this.dbFilePath);
    } catch (err: any) {
      console.error('SQLite persistence warning:', err?.message || err);
    }
  }

  private queryAll<T = Record<string, any>>(sql: string, params: any[] = []): T[] {
    const db = this.ensureDb();
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private queryOne<T = Record<string, any>>(sql: string, params: any[] = []): T | null {
    const rows = this.queryAll<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  private runStmt(sql: string, params: any[] = [], persist: boolean = true): void {
    const db = this.ensureDb();
    db.run(sql, params);
    if (persist) {
      this.persistToDisk();
    }
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
    this.runStmt(
      `INSERT INTO audit_events (id, greenhouse_id, actor_user_id, actor_device_id, event_type, summary, metadata_json, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateSecureId('aud', 8),
        params.greenhouseId || null,
        params.actorUserId || null,
        params.actorDeviceId || null,
        params.eventType,
        params.summary,
        JSON.stringify(params.metadata || {}),
        params.ipAddress || null,
        new Date().toISOString()
      ]
    );
  }

  public listAuditEventsForGreenhouse(greenhouseId: string, limit: number = 30): AuditEventRecord[] {
    const rows = this.queryAll<any>(
      `SELECT id, greenhouse_id, actor_user_id, actor_device_id, event_type, summary, metadata_json, created_at
       FROM audit_events
       WHERE greenhouse_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [greenhouseId, Math.max(1, Math.min(100, limit))]
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

  public registerUser(params: {
    email: string;
    password: string;
    displayName: string;
    userAgent?: string;
    ipAddress?: string;
  }):
    | { ok: true; user: AuthenticatedUser; sessionToken: string; expiresAt: string }
    | { ok: false; statusCode: number; errorCode: string; message: string } {
    const emailNorm = String(params.email || '').trim().toLowerCase();
    const displayName = String(params.displayName || '').trim() || emailNorm.split('@')[0] || 'Grower';
    const password = String(params.password || '');

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

    this.runStmt(
      `INSERT INTO users (id, email, display_name, password_hash, password_salt, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, emailNorm, displayName.slice(0, 80), hashHex, saltHex, nowIso],
      false
    );

    const session = this.createSessionInternal(userId, params.userAgent, params.ipAddress);
    this.recordAuditEvent({
      actorUserId: userId,
      eventType: 'USER_REGISTERED',
      summary: `Customer account registered (${emailNorm})`,
      ipAddress: params.ipAddress
    });

    return {
      ok: true,
      user: { id: userId, email: emailNorm, displayName: displayName.slice(0, 80), createdAt: nowIso },
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
      'SELECT id, email, display_name, password_hash, password_salt, created_at FROM users WHERE email = ?',
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

    const session = this.createSessionInternal(String(row.id), params.userAgent, params.ipAddress);
    this.persistToDisk();

    return {
      ok: true,
      user: {
        id: String(row.id),
        email: String(row.email),
        displayName: String(row.display_name),
        createdAt: String(row.created_at)
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
      `SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.display_name, u.created_at
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
    return {
      id: String(row.id),
      email: String(row.email),
      displayName: String(row.display_name),
      createdAt: String(row.created_at)
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

    this.runStmt(
      `INSERT INTO greenhouses (id, name, location_label, crop_type, owner_user_id, wifi_provisioning_method, wifi_provisioning_state, wifi_ssid_hint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ghId, name, locationLabel, cropType, params.ownerUserId, wifiMethod, 'unconfigured', null, nowIso, nowIso],
      false
    );

    this.runStmt(
      `INSERT INTO greenhouse_members (id, greenhouse_id, user_id, role, added_by_user_id, created_at)
       VALUES (?, ?, ?, 'owner', ?, ?)`,
      [generateSecureId('ghm', 6), ghId, params.ownerUserId, params.ownerUserId, nowIso],
      false
    );

    // Pre-allocate unique camera & controller IDs in pending_setup state (never claimed connected!)
    this.runStmt(
      `INSERT INTO devices (id, greenhouse_id, device_type, label, credential_hash, credential_prefix, provisioning_status, firmware_version, last_seen_at, last_ip, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'esp32_cam', 'ESP32-CAM Crop Camera', NULL, NULL, 'pending_setup', NULL, NULL, NULL, NULL, ?, ?)`,
      [generateSecureId('dev_cam', 6), ghId, nowIso, nowIso],
      false
    );
    this.runStmt(
      `INSERT INTO devices (id, greenhouse_id, device_type, label, credential_hash, credential_prefix, provisioning_status, firmware_version, last_seen_at, last_ip, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'esp32_controller', 'Main ESP32 Greenhouse Controller', NULL, NULL, 'pending_setup', NULL, NULL, NULL, NULL, ?, ?)`,
      [generateSecureId('dev_ctrl', 6), ghId, nowIso, nowIso],
      false
    );

    this.recordAuditEvent({
      greenhouseId: ghId,
      actorUserId: params.ownerUserId,
      eventType: 'GREENHOUSE_CREATED',
      summary: `Greenhouse "${name}" created with isolated camera & controller identity slots.`,
      ipAddress: params.ipAddress
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

    const nextName = params.name !== undefined ? String(params.name).trim().slice(0, 80) || current.name : current.name;
    const nextLocation =
      params.locationLabel !== undefined
        ? String(params.locationLabel).trim().slice(0, 100) || current.locationLabel
        : current.locationLabel;
    const nextCrop =
      params.cropType !== undefined ? String(params.cropType).trim().slice(0, 60) || current.cropType : current.cropType;
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
  } {
    const rawCode = generateSecureId('enr', 16);
    const tokenHash = sha256Hex(rawCode);
    const tokenId = generateSecureId('tok', 8);
    const ttlMinutes = Math.max(1, Math.min(1440, params.ttlMinutes ?? 30));
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const roleGranted: GreenhouseMemberRole = params.roleGranted || 'operator';

    this.runStmt(
      `INSERT INTO enrollment_tokens (id, token_hash, token_prefix, purpose, greenhouse_id, kit_serial, kit_model, role_granted, created_by_user_id, expires_at, used_at, used_by_user_id, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
      [
        tokenId,
        tokenHash,
        rawCode.slice(0, 10),
        params.purpose,
        params.greenhouseId || null,
        params.kitSerial || null,
        params.kitModel || 'EDENS-KIT-V1',
        roleGranted,
        params.createdByUserId || null,
        expiresAt,
        nowIso
      ]
    );

    this.recordAuditEvent({
      greenhouseId: params.greenhouseId || null,
      actorUserId: params.createdByUserId || null,
      eventType: 'QR_TOKEN_ISSUED',
      summary: `Short-lived ${params.purpose} QR token issued (expires in ${ttlMinutes}m).`,
      metadata: { tokenId, purpose: params.purpose, ttlMinutes, kitSerial: params.kitSerial || null },
      ipAddress: params.ipAddress
    });

    // Non-secret QR payload URI (contains ONLY revocable short-lived enrollment code, NEVER device or API keys)
    const qrParams = new URLSearchParams({
      v: '1',
      purpose: params.purpose,
      code: rawCode
    });
    if (params.kitSerial) qrParams.set('kit', params.kitSerial);
    const qrPayloadUri = `edens://enroll?${qrParams.toString()}`;
    const origin = (params.publicOrigin || 'https://edens-ai.onrender.com').replace(/\/$/, '');
    const webSetupUrl = `${origin}/greenhouses/setup?code=${encodeURIComponent(rawCode)}`;

    return {
      tokenId,
      rawCode,
      qrPayloadUri,
      webSetupUrl,
      expiresAt,
      purpose: params.purpose
    };
  }

  public inspectEnrollmentCode(rawInput: string):
    | {
        ok: true;
        tokenId: string;
        purpose: EnrollmentTokenPurpose;
        greenhouseId: string | null;
        greenhouseName: string | null;
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

    if (!targetGhId) {
      // Unbound physical kit QR code -> create a new greenhouse owned by this user
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
      [nowIso, params.userId, targetGhId, inspected.tokenId]
    );

    this.recordAuditEvent({
      greenhouseId: targetGhId,
      actorUserId: params.userId,
      eventType: 'QR_TOKEN_REDEEMED',
      summary:
        action === 'claimed_kit'
          ? `Greenhouse kit QR token redeemed (${inspected.kitSerial || inspected.tokenId}). Hardware still requires Wi-Fi & credential provisioning.`
          : `Authorized member joined greenhouse via one-time QR invitation.`,
      ipAddress: params.ipAddress
    });

    const gh = this.getGreenhouseForUser(targetGhId, params.userId)!;
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

    this.runStmt('UPDATE enrollment_tokens SET revoked_at = ? WHERE id = ?', [
      new Date().toISOString(),
      params.tokenId
    ]);
    this.recordAuditEvent({
      greenhouseId: params.greenhouseId,
      actorUserId: params.actorUserId,
      eventType: 'QR_TOKEN_REVOKED',
      summary: `Enrollment QR token ${params.tokenId} revoked.`,
      ipAddress: params.ipAddress
    });
    return true;
  }

  public listTokensForGreenhouse(greenhouseId: string): EnrollmentTokenSummary[] {
    const rows = this.queryAll<any>(
      `SELECT id, token_prefix, purpose, greenhouse_id, kit_serial, kit_model, role_granted, expires_at, used_at, revoked_at, created_at
       FROM enrollment_tokens
       WHERE greenhouse_id = ?
       ORDER BY created_at DESC
       LIMIT 15`,
      [greenhouseId]
    );
    return rows.map((r) => ({
      id: String(r.id),
      tokenPrefix: String(r.token_prefix),
      purpose: String(r.purpose) as EnrollmentTokenPurpose,
      greenhouseId: r.greenhouse_id ? String(r.greenhouse_id) : null,
      kitSerial: r.kit_serial ? String(r.kit_serial) : null,
      kitModel: r.kit_model ? String(r.kit_model) : null,
      roleGranted: String(r.role_granted) as GreenhouseMemberRole,
      expiresAt: String(r.expires_at),
      usedAt: r.used_at ? String(r.used_at) : null,
      revokedAt: r.revoked_at ? String(r.revoked_at) : null,
      createdAt: String(r.created_at)
    }));
  }

  // ------------------------------------------------------------------
  // PER-DEVICE CREDENTIALS, REVOCATION & HARDWARE CHECK-IN
  // ------------------------------------------------------------------

  public listDevicesForGreenhouse(greenhouseId: string): DeviceRecord[] {
    const rows = this.queryAll<any>(
      `SELECT * FROM devices WHERE greenhouse_id = ? ORDER BY device_type ASC`,
      [greenhouseId]
    );
    return rows.map((r) => this.mapDeviceRow(r));
  }

  private mapDeviceRow(r: any): DeviceRecord {
    return {
      id: String(r.id),
      greenhouseId: String(r.greenhouse_id),
      deviceType: String(r.device_type) as GreenhouseDeviceType,
      label: String(r.label),
      credentialPrefix: r.credential_prefix ? String(r.credential_prefix) : null,
      hasCredentialIssued: Boolean(r.credential_hash && !r.revoked_at),
      provisioningStatus: String(r.provisioning_status) as DeviceProvisioningStatus,
      firmwareVersion: r.firmware_version ? String(r.firmware_version) : null,
      lastSeenAt: r.last_seen_at ? String(r.last_seen_at) : null,
      revokedAt: r.revoked_at ? String(r.revoked_at) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
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

    this.runStmt(
      `UPDATE devices
       SET credential_hash = ?, credential_prefix = ?, provisioning_status = 'awaiting_first_checkin', revoked_at = NULL, updated_at = ?
       WHERE id = ?`,
      [keyHash, keyPrefix, nowIso, params.deviceId]
    );

    this.recordAuditEvent({
      greenhouseId: params.greenhouseId,
      actorUserId: params.actorUserId,
      actorDeviceId: params.deviceId,
      eventType: 'DEVICE_CREDENTIAL_ISSUED',
      summary: `Unique hardware credential issued/rotated for ${row.label} (${params.deviceId}). Status: awaiting first authenticated check-in.`,
      ipAddress: params.ipAddress
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
    firmwareVersion?: string;
    ipAddress?: string;
  }):
    | { ok: true; greenhouseId: string; deviceId: string; deviceKey: string }
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

    const devRow = this.queryOne<any>(
      'SELECT * FROM devices WHERE greenhouse_id = ? AND device_type = ?',
      [inspected.greenhouseId, params.deviceType]
    );
    if (!devRow) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'DEVICE_SLOT_MISSING',
        message: 'No matching device slot found for this greenhouse.'
      };
    }

    const rawKey = generateSecureId(params.deviceType === 'esp32_cam' ? 'edcam' : 'edctrl', 20);
    const nowIso = new Date().toISOString();

    this.runStmt(
      `UPDATE enrollment_tokens SET used_at = ? WHERE id = ?`,
      [nowIso, inspected.tokenId],
      false
    );
    this.runStmt(
      `UPDATE devices
       SET credential_hash = ?, credential_prefix = ?, provisioning_status = 'awaiting_first_checkin', firmware_version = COALESCE(?, firmware_version), revoked_at = NULL, updated_at = ?
       WHERE id = ?`,
      [sha256Hex(rawKey), rawKey.slice(0, 12), params.firmwareVersion || null, nowIso, String(devRow.id)]
    );

    this.recordAuditEvent({
      greenhouseId: inspected.greenhouseId,
      actorDeviceId: String(devRow.id),
      eventType: 'DEVICE_BOOTSTRAPPED',
      summary: `Hardware ${devRow.label} redeemed one-time bootstrap token.`,
      ipAddress: params.ipAddress
    });

    return {
      ok: true,
      greenhouseId: inspected.greenhouseId,
      deviceId: String(devRow.id),
      deviceKey: rawKey
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
    this.runStmt(
      `UPDATE devices
       SET provisioning_status = 'revoked', revoked_at = ?, updated_at = ?
       WHERE id = ?`,
      [nowIso, nowIso, params.deviceId]
    );

    this.recordAuditEvent({
      greenhouseId: params.greenhouseId,
      actorUserId: params.actorUserId,
      actorDeviceId: params.deviceId,
      eventType: 'DEVICE_REVOKED',
      summary: `Device credential revoked for ${row.label} (${params.deviceId}). Subsequent uploads with old credential will be rejected.`,
      ipAddress: params.ipAddress
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
  }): void {
    const prev = this.queryOne<any>('SELECT provisioning_status, label FROM devices WHERE id = ?', [
      params.deviceId
    ]);
    const nowIso = new Date().toISOString();

    this.runStmt(
      `UPDATE devices
       SET provisioning_status = 'connected',
           last_seen_at = ?,
           last_ip = COALESCE(?, last_ip),
           firmware_version = COALESCE(?, firmware_version),
           updated_at = ?
       WHERE id = ?`,
      [nowIso, params.ipAddress || null, params.firmwareVersion || null, nowIso, params.deviceId],
      false
    );

    this.runStmt(
      `UPDATE greenhouses
       SET wifi_provisioning_state = 'verified_online', updated_at = ?
       WHERE id = ?`,
      [nowIso, params.greenhouseId]
    );

    if (prev && String(prev.provisioning_status) !== 'connected') {
      this.recordAuditEvent({
        greenhouseId: params.greenhouseId,
        actorDeviceId: params.deviceId,
        eventType: 'DEVICE_FIRST_CHECKIN',
        summary: `${prev.label} (${params.deviceId}) completed its first authenticated cloud check-in.`,
        ipAddress: params.ipAddress
      });
    }
  }

  // ------------------------------------------------------------------
  // CONTROLLER TELEMETRY STORAGE & HONEST FRESHNESS CLASSIFICATION
  // ------------------------------------------------------------------

  public storeControllerTelemetry(params: {
    greenhouseId: string;
    deviceId: string;
    telemetry: ValidatedControllerTelemetry;
    ipAddress?: string;
  }): { readingId: string; recordedAt: string } {
    const readingId = generateSecureId('tel', 8);
    const nowMs = Date.now();

    this.runStmt(
      `INSERT INTO telemetry_readings (
         id, greenhouse_id, device_id, recorded_at, received_at_ms,
         temperature, humidity, soil_moisture, sunlight, grow_light,
         water_level, battery_voltage, rain_detected, rain_gauge_level,
         sensor_health_json, actuators_json, interlocks_json, device_health_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        readingId,
        params.greenhouseId,
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
        params.telemetry.rain ? 1 : 0,
        params.telemetry.rainGaugeLevel,
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
      ipAddress: params.ipAddress
    });

    // Keep latest 100 readings per greenhouse so SQLite file stays compact
    this.runStmt(
      `DELETE FROM telemetry_readings
       WHERE greenhouse_id = ? AND id NOT IN (
         SELECT id FROM telemetry_readings WHERE greenhouse_id = ? ORDER BY received_at_ms DESC LIMIT 100
       )`,
      [params.greenhouseId, params.greenhouseId]
    );

    return { readingId, recordedAt: params.telemetry.timestamp };
  }

  public getLatestTelemetryForGreenhouse(
    greenhouseId: string,
    nowMs: number = Date.now()
  ): {
    exists: boolean;
    dataSource: 'REAL_HARDWARE' | 'CACHED' | 'STALE' | 'DISCONNECTED';
    connectionState: 'CONNECTED' | 'STALE' | 'DISCONNECTED';
    isStale: boolean;
    ageSeconds: number | null;
    timestamp: string | null;
    deviceId: string | null;
    readings: {
      temperature: number;
      humidity: number;
      soilMoisture: number;
      sunlight: number | null;
      growLight: number | null;
      waterLevel: number | null;
      batteryVoltage: number | null;
      rain: boolean;
      rainGaugeLevel: number | null;
    } | null;
    sensorHealth: Record<string, string> | null;
    actuators: Record<string, boolean> | null;
    interlocks: Record<string, boolean> | null;
    deviceHealth: Record<string, unknown> | null;
  } {
    const row = this.queryOne<any>(
      `SELECT * FROM telemetry_readings WHERE greenhouse_id = ? ORDER BY received_at_ms DESC LIMIT 1`,
      [greenhouseId]
    );

    if (!row) {
      return {
        exists: false,
        dataSource: 'DISCONNECTED',
        connectionState: 'DISCONNECTED',
        isStale: true,
        ageSeconds: null,
        timestamp: null,
        deviceId: null,
        readings: null,
        sensorHealth: null,
        actuators: null,
        interlocks: null,
        deviceHealth: null
      };
    }

    const ageSeconds = Math.max(0, Math.round((nowMs - Number(row.received_at_ms)) / 1000));
    let dataSource: 'REAL_HARDWARE' | 'CACHED' | 'STALE' | 'DISCONNECTED' = 'DISCONNECTED';
    let connectionState: 'CONNECTED' | 'STALE' | 'DISCONNECTED' = 'DISCONNECTED';
    let isStale = true;

    if (ageSeconds <= 30) {
      dataSource = 'REAL_HARDWARE';
      connectionState = 'CONNECTED';
      isStale = false;
    } else if (ageSeconds <= 120) {
      dataSource = 'CACHED';
      connectionState = 'CONNECTED';
      isStale = false;
    } else if (ageSeconds <= 300) {
      dataSource = 'STALE';
      connectionState = 'STALE';
      isStale = true;
    } else {
      dataSource = 'DISCONNECTED';
      connectionState = 'DISCONNECTED';
      isStale = true;
    }

    const safeJson = (val: any) => {
      try {
        return JSON.parse(String(val || '{}'));
      } catch {
        return {};
      }
    };

    return {
      exists: true,
      dataSource,
      connectionState,
      isStale,
      ageSeconds,
      timestamp: String(row.recorded_at),
      deviceId: String(row.device_id),
      readings: {
        temperature: Number(row.temperature),
        humidity: Number(row.humidity),
        soilMoisture: Number(row.soil_moisture),
        sunlight: row.sunlight !== null && row.sunlight !== undefined ? Number(row.sunlight) : null,
        growLight: row.grow_light !== null && row.grow_light !== undefined ? Number(row.grow_light) : null,
        waterLevel: row.water_level !== null && row.water_level !== undefined ? Number(row.water_level) : null,
        batteryVoltage:
          row.battery_voltage !== null && row.battery_voltage !== undefined ? Number(row.battery_voltage) : null,
        rain: Number(row.rain_detected) === 1,
        rainGaugeLevel:
          row.rain_gauge_level !== null && row.rain_gauge_level !== undefined ? Number(row.rain_gauge_level) : null
      },
      sensorHealth: safeJson(row.sensor_health_json),
      actuators: safeJson(row.actuators_json),
      interlocks: safeJson(row.interlocks_json),
      deviceHealth: safeJson(row.device_health_json)
    };
  }
}
