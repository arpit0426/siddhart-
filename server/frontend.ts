import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { config } from './config.js';
import { logger } from './logging.js';

/**
 * Attaches the SPA to the API server:
 *  - development: Vite in middleware mode (HMR, on-the-fly transforms)
 *  - production:  the built `dist/` bundle with an SPA fallback, so deep links
 *                 like /customer/orders/123 survive a refresh or direct visit.
 */
export const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

export async function attachFrontend(app: Express): Promise<void> {
  if (!config.isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    return;
  }

  if (!fs.existsSync(path.join(distPath, 'index.html'))) {
    logger.error('static.missing', { distPath, hint: 'Run `npm run build` before starting in production.' });
    return;
  }

  app.use(express.static(distPath));
  // Every non-API GET falls through to index.html. API and uploads paths are
  // excluded so unknown endpoints keep returning JSON 404s instead of HTML.
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
