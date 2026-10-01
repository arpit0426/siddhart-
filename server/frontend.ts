import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Express, Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { logger } from './logging.js';
import { readSessionCookie } from './security.js';
import { getUserByToken } from './auth.js';

/**
 * Attaches the SPA to the API server:
 *  - development: Vite in middleware mode (HMR, on-the-fly transforms)
 *  - production:  the built `dist/` bundle with an SPA fallback, so deep links
 *                 like /customer/orders/123 survive a refresh or direct visit.
 *
 * Both paths are preceded by `pageRoutingGuard`, which enforces the
 * first-visit authentication rules at the HTTP layer (not only in the SPA):
 *   /                 → the auth gateway, or a 302 to the session's workspace
 *   /customer|seller|rider/…  → 302 to the right auth flow unless the session
 *                       cookie belongs to that role (the API independently
 *                       authorises every data request)
 *   /…/auth|signup|recover    → public, but signed-in users are sent to their
 *                       workspace instead of being asked to log in again
 */
export const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

type Role = 'customer' | 'seller' | 'rider';

const ROLE_HOME: Record<Role, string> = {
  customer: '/customer',
  seller: '/seller',
  rider: '/rider',
};

const AUTH_PAGE = /\/(auth|login|signup|recover)$/;
const WORKSPACE = /^\/(customer|seller|rider)(\/|$)/;
// Legacy customer surface routes (cart/checkout/orders/…) are customer-only too.
const CUSTOMER_PAGES = /^\/(cart|checkout|orders|requests|account)(\/|$)/;

function sessionRole(req: Request): Role | null {
  const token = readSessionCookie(req);
  if (!token) return null;
  try {
    const user = getUserByToken(token);
    return user ? (user.role as Role) : null;
  } catch {
    return null;
  }
}

function redirect(res: Response, location: string): void {
  res.redirect(302, location);
}

export function pageRoutingGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }

  const pathOnly = (req.path || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (pathOnly.startsWith('/api') || pathOnly.startsWith('/uploads') || pathOnly.includes('.')) {
    next();
    return;
  }

  const role = sessionRole(req);

  // Root: gateway for visitors, the signed-in user's workspace otherwise.
  if (pathOnly === '/') {
    if (role) {
      redirect(res, ROLE_HOME[role]);
      return;
    }
    next();
    return;
  }

  const workspaceMatch = WORKSPACE.exec(pathOnly);
  const customerPageMatch = workspaceMatch ? null : CUSTOMER_PAGES.exec(pathOnly);
  if (!workspaceMatch && !customerPageMatch) {
    next();
    return;
  }

  // Legacy customer pages (cart/checkout/orders/…) belong to the customer role.
  const segment = (workspaceMatch ? workspaceMatch[1] : 'customer') as Role;

  // Auth surfaces (login / signup / recover) are public, but an already
  // authenticated user is never forced through them again.
  if (AUTH_PAGE.test(pathOnly)) {
    if (role) {
      redirect(res, ROLE_HOME[role]);
      return;
    }
    next();
    return;
  }

  // Anything else under a role workspace is protected.
  if (!role) {
    redirect(res, `/${segment}/auth?next=${encodeURIComponent(req.originalUrl || pathOnly)}`);
    return;
  }
  if (role !== segment) {
    // Wrong workspace for this session: send them home. The API would reject
    // every request anyway — this just avoids showing an unusable page.
    redirect(res, ROLE_HOME[role]);
    return;
  }
  next();
}

export async function attachFrontend(app: Express): Promise<void> {
  app.get(/^(?!\/api|\/uploads).*/, pageRoutingGuard);

  // Default everywhere (including the hosted preview): serve the built bundle.
  // It has no HMR websocket, so the page loads with a clean console. Opt into the
  // Vite dev server for live editing with `npm run dev:hmr` (USE_VITE=true); it is
  // also the fallback when no bundle has been built yet.
  const builtBundle = fs.existsSync(path.join(distPath, 'index.html'));
  if (!config.isProduction && (process.env.USE_VITE === 'true' || !builtBundle)) {
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
  // Every remaining non-API GET falls through to index.html. API and uploads
  // paths are excluded so unknown endpoints keep returning JSON 404s instead
  // of HTML.
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
