import { config } from './server/config.js';
import { buildApp, prepareDatabase } from './server/app.js';
import { attachFrontend } from './server/frontend.js';
import { logger } from './server/logging.js';
import { seedDemoData } from './server/seed.js';

async function startServer() {
  prepareDatabase();

  // Demo/staging data is only seeded when demo mode is explicitly enabled.
  if (config.demoMode) {
    try {
      seedDemoData();
    } catch (error: any) {
      logger.error('seed.failed', { message: error?.message });
    }
  } else {
    logger.info('seed.skipped', { reason: 'demo mode disabled' });
  }

  const app = buildApp();
  await attachFrontend(app);

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('server.started', {
      url: `http://0.0.0.0:${config.port}`,
      environment: config.nodeEnv,
      demoMode: config.demoMode,
    });
  });

  const shutdown = (signal: string) => {
    logger.info('server.shutdown', { signal });
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((error) => {
  logger.error('server.fatal', { message: error?.message, stack: error?.stack });
  process.exit(1);
});
