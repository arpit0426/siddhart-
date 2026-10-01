import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { logger } from './logging.js';

/**
 * Cookie/session and CSRF hardening.
 *
 * Session tokens live in an HttpOnly cookie (never readable by JavaScript) and
 * a Bearer token is also returned for non-browser API clients/tests. Cookie-based
 * authentication is CSRF-protected two ways:
 *   1. On plain HTTP (local dev) cookies are SameSite=Lax, so they are not sent
 *      on cross-site POSTs. On HTTPS — including the embedded preview — cookies
 *      are SameSite=None; Secure; Partitioned so the session still sticks inside
 *      a cross-site iframe (CHIPS) without becoming a classic third-party cookie.
 *   2. `originGuard` rejects unsafe requests whose Origin is not our own host,
 *      and requires the `X-NearBuy-Client: web` header (a custom header cannot
 *      be set by a cross-site form/img, and CORS preflight is not allowed).
 *      Browser `Sec-Fetch-Site: same-origin` is trusted: a cross-site page cannot
 *      spoof it, and preview proxies sometimes rewrite Host away from Origin.
 */

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  // NOTE: no X-Frame-Options/CSP frame-ancestors / CORP same-origin here on
  // purpose — the platform preview embeds the app in a cross-origin iframe.
  // Production may set framing policy at the edge/CDN.
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
  // Sandbox / hosted previews are served from https://{port}-{id}.e2b.app and
  // embedded cross-site. Outside production that host is a legitimate origin
  // even when the proxy rewrites Host to an internal address.
  if (!config.isProduction) hosts.add('*.e2b.app');
  return [...hosts];
}

function headerFirst(value: string | string[] | undefined): string {
  if (!value) return '';
  const raw = Array.isArray(value) ? value[0] : value;
  return raw.split(',')[0].trim().toLowerCase();
}

/** True when the browser (or the TLS-terminating proxy in front of it) is HTTPS. */
export function requestIsHttps(req?: Request): boolean {
  if (config.cookieSecure) return true;
  if (!req) return false;
  if (req.secure) return true;
  if (headerFirst(req.headers['x-forwarded-proto']) === 'https') return true;
  const origin = String(req.headers.origin || '');
  if (origin.startsWith('https://')) return true;
  const referer = String(req.headers.referer || '');
  if (referer.startsWith('https://')) return true;
  const host = `${headerFirst(req.headers['x-forwarded-host'])} ${headerFirst(req.headers.host)}`;
  if (/\.e2b\.app\b/i.test(host)) return true;
  return false;
}

export function originGuard(req: Request, res: Response, next: NextFunction) {
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  // Bearer-token requests carry no ambient authority, so they are not CSRF-able.
  const usesBearer = String(req.headers.authorization || '').startsWith('Bearer ');

  if (safeMethod || usesBearer) {
    next();
    return;
  }

  // Browsers set Sec-Fetch-Site and cross-site documents cannot spoof it.
  // Trusting same-origin/same-site lets sign-in succeed when a preview proxy
  // rewrites Host but the page and the API are still the same origin.
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'same-origin' || fetchSite === 'same-site') {
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

function cookieAttributeList(secure: boolean): string[] {
  // HTTPS responses (production and the embedded preview) must use
  // SameSite=None; Secure; Partitioned. Lax cookies are third-party inside a
  // cross-site iframe and the browser drops them, so login appears to fail.
  if (secure) return ['HttpOnly', 'Secure', 'SameSite=None', 'Partitioned'];
  return ['HttpOnly', 'SameSite=Lax'];
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date, req?: Request, remember = true) {
  const parts = [
    `${config.sessionCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    ...cookieAttributeList(requestIsHttps(req)),
    ...(remember ? [`Expires=${expiresAt.toUTCString()}`, `Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}`] : []),
  ];
  res.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response, _req?: Request) {
  // Clear both variants. A Lax cookie set on http://localhost and a Partitioned
  // cookie set through the HTTPS preview are different cookies to the browser.
  for (const secure of [false, true]) {
    const parts = [
      `${config.sessionCookieName}=`,
      'Path=/',
      ...cookieAttributeList(secure),
      'Max-Age=0',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ];
    res.append('Set-Cookie', parts.join('; '));
  }
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
