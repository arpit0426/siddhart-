import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { migrations } from './migrations.js';
import { logger } from './logging.js';

const dbDir = path.dirname(config.databaseFile);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new DatabaseSync(config.databaseFile);

// Reliability/concurrency settings for a multi-request production workload.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
`);

let transactionDepth = 0;

/**
 * Runs `fn` inside an IMMEDIATE transaction (write lock taken up front, which
 * makes check-then-act sequences safe against concurrent requests).
 * Nested calls join the outer transaction.
 */
export function withTransaction<T>(fn: () => T): T {
  if (transactionDepth > 0) return fn();

  db.exec('BEGIN IMMEDIATE');
  transactionDepth = 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore rollback errors */
    }
    throw error;
  } finally {
    transactionDepth = 0;
  }
}

let migrated = false;

/** Applies every pending migration exactly once. Safe to call repeatedly. */
export function runMigrations(force = false): string[] {
  if (migrated && !force) return [];

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      description TEXT,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare(`SELECT id FROM schema_migrations`).all() as any[]).map((row) => row.id)
  );
  const newlyApplied: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    try {
      withTransaction(() => {
        migration.up(db);
        db.prepare(
          `INSERT INTO schema_migrations (id, description, applied_at) VALUES (?, ?, ?)`
        ).run(migration.id, migration.description, new Date().toISOString());
      });
      newlyApplied.push(migration.id);
      logger.info('migration.applied', { id: migration.id });
    } catch (error: any) {
      logger.error('migration.failed', { id: migration.id, message: error?.message });
      throw new Error(`Migration ${migration.id} failed: ${error?.message}`);
    }
  }

  migrated = true;
  return newlyApplied;
}

export function appliedMigrations(): { id: string; applied_at: string }[] {
  try {
    return db
      .prepare(`SELECT id, applied_at FROM schema_migrations ORDER BY id ASC`)
      .all() as any[];
  } catch {
    return [];
  }
}

export function databaseHealth(): { ok: boolean; error?: string } {
  try {
    const row = db.prepare('SELECT 1 AS alive').get() as any;
    return { ok: row?.alive === 1 };
  } catch (error: any) {
    return { ok: false, error: error?.message };
  }
}

/** Test/bootstrap helper: run migrations (and nothing else). */
export function initializeDatabase() {
  runMigrations();
}
