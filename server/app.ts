import express from 'express';
import path from 'node:path';
import { config, warnAboutConfiguration } from './config.js';
import { db, databaseHealth, appliedMigrations, runMigrations } from './db.js';
import { logger } from './logging.js';
import { originGuard, securityHeaders } from './security.js';
import { apiNotFound, errorHandler } from './http.js';
import { rateLimit } from './rateLimit.js';
import { purgeExpiredSessions } from './auth.js';
import { authRouter } from './routes/auth.routes.js';
import { customerRouter } from './routes/customer.routes.js';
import { customerPortalRouter } from './routes/customer.portal.routes.js';
import { sellerRouter } from './routes/seller.routes.js';
import { riderRouter } from './routes/rider.routes.js';

export function buildApp() {
  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(originGuard);

  // Liveness: process is up.
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      app: config.appName,
      version: config.version,
      environment: config.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness: dependencies (database + migrations) are usable.
  app.get('/health/ready', (_req, res) => {
    const dbHealth = databaseHealth();
    const migrations = appliedMigrations();
    const latest = migrations[migrations.length - 1]?.id ?? null;
    if (!dbHealth.ok) {
      res.status(503).json({ status: 'error', database: 'unavailable', detail: dbHealth.error });
      return;
    }
    res.json({
      status: 'ready',
      database: 'connected',
      engine: 'node:sqlite (WAL)',
      migrationsApplied: migrations.length,
      latestMigration: latest,
      demoMode: config.demoMode,
      timestamp: new Date().toISOString(),
    });
  });

  // Static uploads (product/store images uploaded by sellers).
  app.use(
    '/uploads',
    express.static(config.uploadsDir, {
      maxAge: '7d',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    })
  );

  const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 600, keyPrefix: 'api' });
  app.use('/api', apiLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api/customer', customerRouter);
  app.use('/api/customer', customerPortalRouter);
  app.use('/api/seller', sellerRouter);
  app.use('/api/rider', riderRouter);
  app.use('/api/*', apiNotFound);
  app.use(errorHandler);

  return app;
}

/** Runs migrations, purges stale sessions and logs configuration warnings. */
export function prepareDatabase() {
  runMigrations();
  purgeExpiredSessions();
  warnAboutConfiguration((message) => logger.warn('config.warning', { message }));
  const tables = db
    .prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'`)
    .get() as any;
  logger.info('db.ready', { databaseFile: path.basename(config.databaseFile), tables: tables.count });
}
