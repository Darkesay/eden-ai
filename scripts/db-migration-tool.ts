/**
 * EDENS AI — Phase 1 Database Migration, Backup Verification & Rollback CLI
 *
 * Commands:
 *   npx tsx scripts/db-migration-tool.ts status [dbPath]
 *   npx tsx scripts/db-migration-tool.ts backup [dbPath] [label]
 *   npx tsx scripts/db-migration-tool.ts verify-backup <backupPath>
 *   npx tsx scripts/db-migration-tool.ts test-copy [dbPath]
 *   npx tsx scripts/db-migration-tool.ts migrate [dbPath]
 *   npx tsx scripts/db-migration-tool.ts rollback-v3 [dbPath]
 *   npx tsx scripts/db-migration-tool.ts restore <backupPath> [targetDbPath]
 */

import fs from 'node:fs';
import path from 'node:path';
import { SqliteDriver } from '../src/server/sqliteDriver.ts';
import {
  applyPlatformMigrations,
  createVerifiedDatabaseBackup,
  getTableRowCounts,
  restoreDatabaseFromVerifiedBackup,
  rollbackMigrationV3,
  rollbackMigrationV4,
  testMigrationAndRollbackOnCopy,
  verifyDatabaseBackup
} from '../src/server/migrations.ts';

function resolveDefaultDbPath(customArg?: string): string {
  if (customArg && customArg.trim()) {
    return path.resolve(customArg.trim());
  }
  return path.resolve(process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'edens_platform.sqlite'));
}

async function runCli(): Promise<void> {
  const [, , command = 'status', arg1, arg2] = process.argv;

  switch (command) {
    case 'status': {
      const dbPath = resolveDefaultDbPath(arg1);
      if (!fs.existsSync(dbPath)) {
        console.log(JSON.stringify({ exists: false, dbPath }, null, 2));
        return;
      }
      const driver = new SqliteDriver({ dbFilePath: dbPath });
      await driver.open();
      try {
        const integrity = driver.integrityCheck();
        const fk = driver.foreignKeyCheck();
        const hasMigrations = Boolean(
          driver.queryOne<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
          )
        );
        const appliedMigrations = hasMigrations
          ? driver.queryAll<{ version: string; applied_at: string }>(
              'SELECT version, applied_at FROM schema_migrations ORDER BY applied_at ASC'
            )
          : [];
        const rowCounts = getTableRowCounts(driver);
        console.log(
          JSON.stringify(
            {
              exists: true,
              diagnostics: driver.getDiagnostics(),
              integrityOk: integrity.ok,
              foreignKeysOk: fk.ok,
              appliedMigrations,
              tableCount: Object.keys(rowCounts).length,
              rowCounts
            },
            null,
            2
          )
        );
      } finally {
        driver.close();
      }
      return;
    }

    case 'backup': {
      const dbPath = resolveDefaultDbPath(arg1);
      const label = arg2 || 'manual';
      const manifest = await createVerifiedDatabaseBackup(dbPath, { label });
      console.log(JSON.stringify({ ok: Boolean(manifest), manifest }, null, 2));
      return;
    }

    case 'verify-backup': {
      if (!arg1) {
        throw new Error('Usage: npx tsx scripts/db-migration-tool.ts verify-backup <backupPath>');
      }
      const backupPath = path.resolve(arg1);
      const verified = await verifyDatabaseBackup(backupPath);
      console.log(JSON.stringify(verified, null, 2));
      return;
    }

    case 'test-copy': {
      const dbPath = resolveDefaultDbPath(arg1);
      const result = await testMigrationAndRollbackOnCopy(dbPath);
      console.log(JSON.stringify(result, null, 2));
      if (!result.passed) {
        process.exit(1);
      }
      return;
    }

    case 'migrate': {
      const dbPath = resolveDefaultDbPath(arg1);
      const driver = new SqliteDriver({ dbFilePath: dbPath });
      await driver.open();
      try {
        const preCounts = fs.existsSync(dbPath) ? getTableRowCounts(driver) : {};
        const { appliedNow, backupManifest } = await applyPlatformMigrations(driver);
        const postCounts = getTableRowCounts(driver);
        const integrity = driver.integrityCheck();
        const fk = driver.foreignKeyCheck();
        console.log(
          JSON.stringify(
            {
              ok: integrity.ok && fk.ok,
              dbPath,
              diagnostics: driver.getDiagnostics(),
              appliedNow,
              autoBackupPath: backupManifest?.backupPath || null,
              preRowCounts: preCounts,
              postRowCounts: postCounts,
              integrityOk: integrity.ok,
              foreignKeysOk: fk.ok
            },
            null,
            2
          )
        );
        if (!integrity.ok || !fk.ok) {
          process.exit(1);
        }
      } finally {
        driver.close();
      }
      return;
    }

    case 'rollback-v3': {
      const dbPath = resolveDefaultDbPath(arg1);
      if (!fs.existsSync(dbPath)) {
        throw new Error(`Database file does not exist: ${dbPath}`);
      }
      const preRollbackBackup = await createVerifiedDatabaseBackup(dbPath, { label: 'pre-rollback-v3' });
      const driver = new SqliteDriver({ dbFilePath: dbPath });
      await driver.open();
      try {
        const res = rollbackMigrationV3(driver);
        const integrity = driver.integrityCheck();
        const postCounts = getTableRowCounts(driver);
        console.log(
          JSON.stringify(
            {
              ok: integrity.ok,
              rolledBack: res.rolledBack,
              preRollbackBackupPath: preRollbackBackup?.backupPath || null,
              integrityOk: integrity.ok,
              rowCounts: postCounts
            },
            null,
            2
          )
        );
      } finally {
        driver.close();
      }
      return;
    }

    case 'rollback-v4': {
      const dbPath = resolveDefaultDbPath(arg1);
      if (!fs.existsSync(dbPath)) {
        throw new Error(`Database file does not exist: ${dbPath}`);
      }
      const preRollbackBackup = await createVerifiedDatabaseBackup(dbPath, { label: 'pre-rollback-v4' });
      const driver = new SqliteDriver({ dbFilePath: dbPath });
      await driver.open();
      try {
        const res = rollbackMigrationV4(driver);
        const integrity = driver.integrityCheck();
        const postCounts = getTableRowCounts(driver);
        console.log(
          JSON.stringify(
            {
              ok: integrity.ok,
              rolledBack: res.rolledBack,
              preRollbackBackupPath: preRollbackBackup?.backupPath || null,
              integrityOk: integrity.ok,
              rowCounts: postCounts
            },
            null,
            2
          )
        );
      } finally {
        driver.close();
      }
      return;
    }

    case 'restore': {
      if (!arg1) {
        throw new Error('Usage: npx tsx scripts/db-migration-tool.ts restore <backupPath> [targetDbPath]');
      }
      const backupPath = path.resolve(arg1);
      const targetPath = resolveDefaultDbPath(arg2);
      const restored = await restoreDatabaseFromVerifiedBackup(backupPath, targetPath);
      console.log(
        JSON.stringify(
          {
            ok: true,
            backupPath,
            targetPath,
            ...restored
          },
          null,
          2
        )
      );
      return;
    }

    default:
      throw new Error(
        `Unknown command "${command}". Expected one of: status, backup, verify-backup, test-copy, migrate, rollback-v4, rollback-v3, restore.`
      );
  }
}

runCli().catch((err) => {
  console.error('[EDENS AI DB Migration Tool Error]:', err?.stack || err);
  process.exit(1);
});
