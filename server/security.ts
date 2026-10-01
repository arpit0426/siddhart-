import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { logger } from './logging.js';

/**
 * Cookie/session and CSRF hardening.
 *
 * Session tokens live in an HttpOnly cookie (never readable by JavaScript) and
 * a Bearer token is also returned for non-browser API clients/tests. Cookie-based
 * authentication is CSRF-protected two ways:
 *   1. SameSite=Lax cookies are not sent on cross-site POSTs.
 *   2. `originGuard` rejects unsafe requests whose Origin is not our own host,
 *      and requires the `X-NearBuy-Client: web` header (a custom header cannot
 *      be set by a cross-site form/img, and CORS preflight is not allowed).
 */

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  // NOTE: no X-Frame-Options/CSP frame-ancestors here on purpose - the platform
  // preview embeds the app in an iframe. Production may set it at the edge/CDN.
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}

function hostFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function originMatches(originHost: string, allowed: string): boolean {
  const pattern = allowed.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".e2b.app"
    return originHost === pattern.slice(2) || originHost.endsWith(suffix);
  }
  return originHost === pattern;
}

function allowedHosts(req: Request): string[] {
  const hosts = new Set<string>();
  const add = (value?: string | string[]) => {
    if (!value) return;
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      const host = item.split(',')[0].trim().toLowerCase();
      if (host) hosts.add(host);
    }
  };
  add(req.headers.host);
  add(req.headers['x-forwarded-host']);
  const appHost = hostFromUrl(config.appUrl);
  if (appHost) hosts.add(appHost);
  for (const origin of config.allowedOrigins) {
    const host = origin.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (host) hosts.add(host);
  }
  return [...hosts];
}

export function originGuard(req: Request, res: Response, next: NextFunction) {
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  // Bearer-token requests carry no ambient authority, so they are not CSRF-able.
  const usesBearer = String(req.headers.authorization || '').startsWith('Bearer ');

  if (safeMethod || usesBearer) {
    next();
    return;
  }

  const origin = req.headers.origin as string | undefined;
  if (origin) {
    const originHost = hostFromUrl(origin);
    const allowed = allowedHosts(req);
    const ok = originHost && allowed.some((host) => originMatches(originHost, host));
    if (!ok) {
      logger.warn('security.csrf_origin_rejected', { path: req.path, origin });
      res.status(403).json({ error: 'Request blocked: untrusted request origin.' });
      return;
    }
    next();
    return;
  }

  // Same-origin fetch from the SPA always sends this header; a cross-site form
  // post cannot, and a cross-site fetch would require a CORS preflight we deny.
  const clientHeader = String(req.headers['x-nearbuy-client'] || '').toLowerCase();
  if (clientHeader === 'web') {
    next();
    return;
  }

  logger.warn('security.csrf_header_missing', { path: req.path, method: req.method });
  res.status(403).json({
    error: 'Request blocked: missing client verification header. Reload the app and retry.',
  });
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date, remember = true) {
  const parts = [
    `${config.sessionCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(remember ? [`Expires=${expiresAt.toUTCString()}`, `Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}`] : []),
  ];
  if (config.cookieSecure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response) {
  const parts = [
    `${config.sessionCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (config.cookieSecure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === config.sessionCookieName) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}
