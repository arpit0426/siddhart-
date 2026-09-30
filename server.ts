import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authRouter } from './server/routes/auth.routes.js';
import { customerRouter } from './server/routes/customer.routes.js';
import { sellerRouter } from './server/routes/seller.routes.js';
import { riderRouter } from './server/routes/rider.routes.js';
import { seedDemoData } from './server/seed.js';
import { db } from './server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Parse JSON bodies with reasonable limits
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Health Check Endpoint
app.get('/health', (_req, res) => {
  try {
    const row = db.prepare('SELECT 1 as alive').get() as any;
    if (row && row.alive === 1) {
      res.json({
        status: 'ok',
        app: 'NearBuy',
        database: 'connected (node:sqlite WAL)',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      });
      return;
    }
  } catch (err: any) {
    res.status(503).json({ status: 'error', database: err.message });
    return;
  }
  res.status(503).json({ status: 'error', database: 'unhealthy' });
});

// Reset / Reseed Demo Data API
app.post('/api/reset-demo', (_req, res) => {
  try {
    seedDemoData();
    res.json({ message: 'NearBuy demo database successfully re-seeded with demo accounts and catalog' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to seed demo database: ' + err.message });
  }
});

// Mount modular API routers
app.use('/api/auth', authRouter);
app.use('/api/customer', customerRouter);
app.use('/api/seller', sellerRouter);
app.use('/api/rider', riderRouter);

// Fallback error handler for API
app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

async function startServer() {
  // Ensure demo data is seeded upon server start
  try {
    seedDemoData();
  } catch (err) {
    console.error('[NearBuy] Warning during demo seeding:', err);
  }

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    // Vite middleware in development
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve production static build
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NearBuy] Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[NearBuy] Fatal server startup error:', err);
  process.exit(1);
});
