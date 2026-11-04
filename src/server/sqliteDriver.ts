import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';

const require = createRequire(import.meta.url);

export type SqliteDriverEngineKind = 'native_wal' | 'sqljs_snapshot';

export interface SqliteDriverOptions {
  dbFilePath: string;
  inMemoryOnly?: boolean;
  preferredEngine?: 'auto' | 'native' | 'sqljs';
  readOnly?: boolean;
}

export interface SqliteRunResult {
  changes: number;
}

interface NativeDatabaseSyncLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    all: (...params: any[]) => Record<string, any>[];
    get: (...params: any[]) => Record<string, any> | undefined;
    run: (...params: any[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
  };
  close: () => void;
}

let cachedSqlJsPromise: Promise<SqlJsStatic> | null = null;
let cachedNativeSqliteCtor: (new (location: string, options?: { open?: boolean; readOnly?: boolean }) => NativeDatabaseSyncLike) | null | undefined =
  undefined;

function loadNativeDatabaseSyncCtor():
  | (new (location: string, options?: { open?: boolean; readOnly?: boolean }) => NativeDatabaseSyncLike)
  | null {
  if (cachedNativeSqliteCtor !== undefined) {
    return cachedNativeSqliteCtor;
  }
  try {
    const mod = require('node:sqlite') as {
      DatabaseSync?: new (location: string, options?: { open?: boolean; readOnly?: boolean }) => NativeDatabaseSyncLike;
    };
    cachedNativeSqliteCtor = typeof mod?.DatabaseSync === 'function' ? mod.DatabaseSync : null;
  } catch {
    cachedNativeSqliteCtor = null;
  }
  return cachedNativeSqliteCtor;
}

async function loadSqlJsStatic(): Promise<SqlJsStatic> {
  if (!cachedSqlJsPromise) {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    const wasmBinary = fs.readFileSync(wasmPath);
    cachedSqlJsPromise = initSqlJs({ wasmBinary });
  }
  return cachedSqlJsPromise;
}

/**
 * Production Persistent SQLite Driver for EDENS AI.
 *
 * Primary Engine (`native_wal`):
 * - Uses Node.js >=22 built-in `node:sqlite` (`DatabaseSync`) directly against the persistent disk file
 *   with `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, and `busy_timeout = 5000`.
 * - Eliminates O(N) full-file memory serialization on every telemetry write and requires zero `node-gyp` native addons.
 *
 * Resilient Fallback (`sqljs_snapshot`):
 * - Falls back automatically to WebAssembly `sql.js` with atomic `.sqlite-tmp` rename snapshots if `DATABASE_DRIVER=sqljs`
 *   or if running in an environment without `node:sqlite`.
 */
export class SqliteDriver {
  private dbFilePath: string;
  private readonly inMemoryOnly: boolean;
  private readonly preferredEngine: 'auto' | 'native' | 'sqljs';
  private readonly readOnly: boolean;

  private engineKind: SqliteDriverEngineKind = 'native_wal';
  private journalMode: string = 'memory';
  private nativeDb: NativeDatabaseSyncLike | null = null;
  private sqlJsDb: SqlJsDatabase | null = null;
  private transactionDepth = 0;
  private closed = false;

  constructor(options: SqliteDriverOptions) {
    this.dbFilePath = options.dbFilePath;
    this.inMemoryOnly = Boolean(options.inMemoryOnly);
    this.readOnly = Boolean(options.readOnly);
    const envPref = String(process.env.DATABASE_DRIVER || '').trim().toLowerCase();
    this.preferredEngine =
      options.preferredEngine ||
      (envPref === 'sqljs' ? 'sqljs' : envPref === 'native' ? 'native' : 'auto');
  }

  public getDbFilePath(): string {
    return this.dbFilePath;
  }

  public getEngineKind(): SqliteDriverEngineKind {
    return this.engineKind;
  }

  public getJournalMode(): string {
    return this.journalMode;
  }

  public isOpen(): boolean {
    return !this.closed && Boolean(this.nativeDb || this.sqlJsDb);
  }

  public getDiagnostics(): {
    dbFilePath: string;
    inMemoryOnly: boolean;
    readOnly: boolean;
    engineKind: SqliteDriverEngineKind;
    journalMode: string;
    isOpen: boolean;
  } {
    return {
      dbFilePath: this.dbFilePath,
      inMemoryOnly: this.inMemoryOnly,
      readOnly: this.readOnly,
      engineKind: this.engineKind,
      journalMode: this.journalMode,
      isOpen: this.isOpen()
    };
  }

  public async open(): Promise<void> {
    if (this.isOpen()) return;
    this.closed = false;

    const NativeCtor = this.preferredEngine === 'sqljs' ? null : loadNativeDatabaseSyncCtor();
    if (NativeCtor) {
      try {
        this.openWithNativeWal(NativeCtor);
        return;
      } catch (nativeErr: any) {
        if (this.preferredEngine === 'native') {
          throw nativeErr;
        }
        console.warn(
          `[EDENS AI DB] Native node:sqlite open fallback triggered (${nativeErr?.message || nativeErr}); falling back to sql.js.`
        );
      }
    }

    await this.openWithSqlJs();
  }

  private openWithNativeWal(
    NativeCtor: new (location: string, options?: { open?: boolean; readOnly?: boolean }) => NativeDatabaseSyncLike
  ): void {
    let targetLocation = ':memory:';
    if (!this.inMemoryOnly) {
      try {
        if (!this.readOnly) {
          fs.mkdirSync(path.dirname(this.dbFilePath), { recursive: true });
        }
        targetLocation = this.dbFilePath;
      } catch (mkdirErr: any) {
        const fallbackPath = path.join(process.cwd(), 'data', 'edens_platform.sqlite');
        if (!this.readOnly && this.dbFilePath !== fallbackPath) {
          fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
          this.dbFilePath = fallbackPath;
          targetLocation = fallbackPath;
        } else {
          throw mkdirErr;
        }
      }
    }

    const db = this.readOnly ? new NativeCtor(targetLocation, { readOnly: true }) : new NativeCtor(targetLocation);
    this.nativeDb = db;
    this.engineKind = 'native_wal';

    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA foreign_keys = ON;');

    if (!this.readOnly) {
      db.exec('PRAGMA temp_store = MEMORY;');
      if (!this.inMemoryOnly) {
        const jmRow = db.prepare('PRAGMA journal_mode = WAL').get();
        this.journalMode = String(jmRow?.journal_mode || 'wal').toLowerCase();
        db.exec('PRAGMA synchronous = NORMAL;');
        db.exec('PRAGMA wal_autocheckpoint = 1000;');
      } else {
        this.journalMode = 'memory';
      }
    } else {
      const jmRow = db.prepare('PRAGMA journal_mode').get();
      this.journalMode = String(jmRow?.journal_mode || 'delete').toLowerCase();
    }
  }

  private async openWithSqlJs(): Promise<void> {
    const SQL = await loadSqlJsStatic();
    if (!this.inMemoryOnly && fs.existsSync(this.dbFilePath)) {
      const existingBytes = fs.readFileSync(this.dbFilePath);
      this.sqlJsDb = new SQL.Database(existingBytes);
    } else {
      this.sqlJsDb = new SQL.Database();
    }
    this.engineKind = 'sqljs_snapshot';
    this.journalMode = this.inMemoryOnly ? 'memory' : 'snapshot';
    this.sqlJsDb.run('PRAGMA foreign_keys = ON;');
  }

  private normalizeParams(params: any[]): any[] {
    return params.map((p) => {
      if (p === undefined) return null;
      if (typeof p === 'boolean') return p ? 1 : 0;
      return p;
    });
  }

  public exec(sql: string, persistIfSnapshot: boolean = true): void {
    if (this.nativeDb) {
      this.nativeDb.exec(sql);
      return;
    }
    if (this.sqlJsDb) {
      this.sqlJsDb.run(sql);
      if (persistIfSnapshot && this.transactionDepth === 0) {
        this.persistSnapshotIfNeeded();
      }
      return;
    }
    throw new Error('SqliteDriver is not open.');
  }

  public run(sql: string, params: any[] = [], persistIfSnapshot: boolean = true): SqliteRunResult {
    const normParams = this.normalizeParams(params);
    if (this.nativeDb) {
      const stmt = this.nativeDb.prepare(sql);
      const res = stmt.run(...normParams);
      return { changes: Number(res.changes || 0) };
    }
    if (this.sqlJsDb) {
      this.sqlJsDb.run(sql, normParams);
      const changes = this.sqlJsDb.getRowsModified();
      if (persistIfSnapshot && this.transactionDepth === 0) {
        this.persistSnapshotIfNeeded();
      }
      return { changes };
    }
    throw new Error('SqliteDriver is not open.');
  }

  public queryAll<T = Record<string, any>>(sql: string, params: any[] = []): T[] {
    const normParams = this.normalizeParams(params);
    if (this.nativeDb) {
      const stmt = this.nativeDb.prepare(sql);
      const rows = stmt.all(...normParams);
      // Convert null-prototype objects from node:sqlite to standard objects for deep-equal & JSON safety
      return rows.map((r) => ({ ...r }) as T);
    }
    if (this.sqlJsDb) {
      const stmt = this.sqlJsDb.prepare(sql);
      try {
        stmt.bind(normParams);
        const rows: T[] = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject() as T);
        }
        return rows;
      } finally {
        stmt.free();
      }
    }
    throw new Error('SqliteDriver is not open.');
  }

  public queryOne<T = Record<string, any>>(sql: string, params: any[] = []): T | null {
    const normParams = this.normalizeParams(params);
    if (this.nativeDb) {
      const stmt = this.nativeDb.prepare(sql);
      const row = stmt.get(...normParams);
      return row ? ({ ...row } as T) : null;
    }
    const rows = this.queryAll<T>(sql, normParams);
    return rows.length > 0 ? rows[0] : null;
  }

  public runInTransaction<T>(fn: () => T): T {
    const isOuter = this.transactionDepth === 0;
    const savepointName = `sp_edens_${this.transactionDepth}`;

    if (isOuter) {
      this.exec('BEGIN IMMEDIATE TRANSACTION;', false);
    } else {
      this.exec(`SAVEPOINT ${savepointName};`, false);
    }
    this.transactionDepth += 1;

    try {
      const result = fn();
      this.transactionDepth -= 1;
      if (isOuter) {
        this.exec('COMMIT;', false);
        this.persistSnapshotIfNeeded();
      } else {
        this.exec(`RELEASE SAVEPOINT ${savepointName};`, false);
      }
      return result;
    } catch (err) {
      this.transactionDepth = Math.max(0, this.transactionDepth - 1);
      try {
        if (isOuter) {
          this.exec('ROLLBACK;', false);
        } else {
          this.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`, false);
          this.exec(`RELEASE SAVEPOINT ${savepointName};`, false);
        }
      } catch {
        // Ignore secondary rollback error
      }
      throw err;
    }
  }

  public checkpointWal(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'PASSIVE'): void {
    if (this.nativeDb && !this.inMemoryOnly && !this.readOnly) {
      try {
        this.nativeDb.exec(`PRAGMA wal_checkpoint(${mode});`);
      } catch {
        // Ignore if database is not in WAL mode
      }
    }
  }

  public persistSnapshotIfNeeded(): void {
    if (this.inMemoryOnly || this.readOnly) return;

    if (this.nativeDb) {
      // Native WAL writes pages directly to disk on commit; optional passive checkpoint keeps WAL bounded
      return;
    }

    if (!this.sqlJsDb) return;

    const writeSnapshot = (targetPath: string) => {
      const dir = path.dirname(targetPath);
      fs.mkdirSync(dir, { recursive: true });
      const data = this.sqlJsDb!.export();
      const tmpPath = `${targetPath}.sqlite-tmp`;
      fs.writeFileSync(tmpPath, Buffer.from(data));
      fs.renameSync(tmpPath, targetPath);
    };

    try {
      writeSnapshot(this.dbFilePath);
    } catch (err: any) {
      const fallbackPath = path.join(process.cwd(), 'data', 'edens_platform.sqlite');
      if (this.dbFilePath !== fallbackPath) {
        try {
          writeSnapshot(fallbackPath);
          this.dbFilePath = fallbackPath;
          return;
        } catch {}
      }
      console.error('SQLite snapshot persistence warning:', err?.message || err);
    }
  }

  public integrityCheck(): { ok: boolean; details: string[] } {
    const rows = this.queryAll<{ integrity_check: string }>('PRAGMA integrity_check');
    const details = rows.map((r) => String(r.integrity_check));
    const ok = details.length === 1 && details[0].toLowerCase() === 'ok';
    return { ok, details };
  }

  public foreignKeyCheck(): { ok: boolean; violations: Record<string, any>[] } {
    const violations = this.queryAll<Record<string, any>>('PRAGMA foreign_key_check');
    return { ok: violations.length === 0, violations };
  }

  /**
   * Produces a clean, single-file atomic snapshot copy of the open database
   * (using `VACUUM INTO` on native SQLite so WAL frames are consolidated cleanly).
   */
  public exportCleanCopyTo(destFilePath: string): void {
    fs.mkdirSync(path.dirname(destFilePath), { recursive: true });
    if (fs.existsSync(destFilePath)) {
      fs.rmSync(destFilePath, { force: true });
    }
    if (this.nativeDb) {
      const escaped = destFilePath.replace(/'/g, "''");
      this.nativeDb.exec(`VACUUM INTO '${escaped}';`);
      return;
    }
    if (this.sqlJsDb) {
      const bytes = this.sqlJsDb.export();
      fs.writeFileSync(destFilePath, Buffer.from(bytes));
      return;
    }
    throw new Error('Cannot export closed database.');
  }

  public close(): void {
    if (this.closed) return;
    try {
      if (this.nativeDb) {
        if (!this.inMemoryOnly && !this.readOnly) {
          try {
            this.nativeDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
          } catch {}
        }
        this.nativeDb.close();
        this.nativeDb = null;
      }
      if (this.sqlJsDb) {
        this.persistSnapshotIfNeeded();
        this.sqlJsDb.close();
        this.sqlJsDb = null;
      }
    } finally {
      this.closed = true;
    }
  }
}
