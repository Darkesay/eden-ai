# EDENS AI — Phase 1 Database Migration, Backup & Rollback Procedures

## 1. Architecture Summary

EDENS AI uses a dual-engine SQLite persistence layer (`src/server/sqliteDriver.ts`) with versioned migrations (`src/server/migrations.ts`):

- **Primary Production Engine (`native_wal`):** Node.js built-in `node:sqlite` (`DatabaseSync`, unflagged in Node.js `>=22.13.0`, verified on local `v22.23.3` and Render `22.18.0`) configured with:
  - `PRAGMA journal_mode = WAL` (Write-Ahead Logging for concurrent reader/writer access and atomic row-level commits without rewriting the entire database file on every telemetry upload)
  - `PRAGMA synchronous = NORMAL`
  - `PRAGMA foreign_keys = ON`
  - `PRAGMA busy_timeout = 5000`
  - `PRAGMA wal_autocheckpoint = 1000`
  - Clean shutdown checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`) on `SIGTERM` / `SIGINT`
- **Resilient Fallback Engine (`sqljs_snapshot`):** `sql.js` WebAssembly engine with atomic `.sqlite-tmp` rename writes, selectable via `DATABASE_DRIVER=sqljs` or automatically used if native SQLite bindings are unavailable.

## 2. Schema Version History

| Version | Description |
| :--- | :--- |
| `v1_self_service_greenhouse_platform` | Core accounts, sessions, greenhouses, memberships, devices, enrollment tokens, telemetry readings, audit events, and AI observations |
| `v2_hardware_states_and_nullable_sensors` | Explicit hardware connection timestamps, device error columns, and nullable individual sensor metrics |
| `v3_phase1_intelligence_foundation` | Non-destructive column upgrades + 25 normalized tables for zones, 1-to-N device capabilities & firmware history, hourly & daily telemetry rollups, configurable retention policies, crop knowledge & evidence references, versioned crop standards, farmer authorization policies, command queue, equipment acknowledgements, outcome verifications, plant inspections, curated dataset manifest, harvest cycles, crop growth records, agricultural learning records, ML model versions & training runs, RL policies, simulation experiments, and append-only `audit_events` immutability triggers |

---

## 3. Pre-Migration Checklist & Safe Upgrade Procedure

### Step 1 — Inspect Current Database Status
```bash
npm run db:migrate -- status
```

### Step 2 — Create and Verify a Pre-Migration Backup
```bash
npm run db:migrate -- backup ./data/edens_platform.sqlite pre-upgrade
```
Verify the generated backup file (`SHA-256`, `PRAGMA integrity_check`, and exact per-table row counts):
```bash
npm run db:migrate -- verify-backup ./data/backups/<backup-filename>.sqlite
```

### Step 3 — Dry-Run Migration & Rollback on an Isolated Copy
Before touching the live database file, run the automated copy test. This exports a clean snapshot to a temporary directory, applies `v3`, verifies 100% row preservation + `PRAGMA integrity_check` + `PRAGMA foreign_key_check`, tests programmatic rollback to `v2`, and cleans up:
```bash
npm run db:migrate -- test-copy ./data/edens_platform.sqlite
```

### Step 4 — Apply Live Migration
> Note: `applyPlatformMigrations` also creates an automatic verified backup (`*.auto-pre-v3.backup-*.sqlite` + `.manifest.json`) in `<dbDir>/backups/` before applying `v3` on any existing `v1`/`v2` database.
```bash
npm run db:migrate -- migrate ./data/edens_platform.sqlite
```

---

## 4. Rollback Procedures

EDENS AI supports two verified rollback strategies depending on operational requirements:

### Option A — Programmatic Down-Migration (`v3` -> `v2` Schema Rollback, Preserving Post-Migration Core Rows)
Use Option A when you want to remove Phase 1 `v3` extension tables and triggers while keeping any new `users`, `sessions`, `greenhouses`, `devices`, `telemetry_readings`, or `audit_events` created after the `v3` upgrade:

1. Stop the Node.js server process (`SIGTERM` flushes the WAL automatically).
2. Execute the programmatic `v3` rollback (which automatically creates a `pre-rollback-v3` backup first):
   ```bash
   npm run db:migrate -- rollback-v3 ./data/edens_platform.sqlite
   ```
3. Verify `schema_migrations` now lists `v1` and `v2` with `integrityOk: true`:
   ```bash
   npm run db:migrate -- status ./data/edens_platform.sqlite
   ```

### Option B — Full Point-in-Time Atomic Restore from Verified Backup
Use Option B when you want to restore the exact byte-for-byte pre-migration database state:

1. Stop the Node.js server process so no open file handles hold `-wal` or `-shm` locks.
2. Run the atomic restore command (verifies backup `PRAGMA integrity_check` first, copies to `.restore-tmp`, removes stale `-wal` and `-shm` sidecar files, atomically renames over target DB, and re-verifies row counts & SHA-256):
   ```bash
   npm run db:migrate -- restore ./data/backups/<backup-filename>.sqlite ./data/edens_platform.sqlite
   ```
3. Confirm restored state:
   ```bash
   npm run db:migrate -- status ./data/edens_platform.sqlite
   ```

---

## 5. Render Persistent Disk (`/var/data`) Production Notes

1. **Mount Point:** Attach a Render Persistent Disk mounted at `/var/data` (configured in `render.yaml`) and set:
   - `DATABASE_PATH=/var/data/edens_platform.sqlite`
   - `CAMERA_STORAGE_PATH=/var/data/camera_uploads`
2. **Local POSIX Filesystem Requirement for WAL:** SQLite WAL mode (`-wal` and `-shm` shared-memory index) requires a local POSIX block filesystem (such as Render Persistent Disk ext4/xfs or local SSD). Never mount `DATABASE_PATH` over network NFS/SMB shares; if a non-POSIX filesystem is ever required, set `DATABASE_DRIVER=sqljs` to use snapshot mode.
3. **Single-Instance Writer Rule:** Because SQLite is an embedded single-node database engine, Render Web Services mounting `/var/data` must run with `numInstances: 1` (standard for Render Persistent Disks).
