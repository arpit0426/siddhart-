import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';

/**
 * Test harness: boots the real Express app against a throwaway SQLite database
 * (fresh DATABASE_FILE per process) and provides an HTTP client that behaves like
 * the browser (cookie session + X-NearBuy-Client header).
 */

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export interface ApiClient {
  request: <T = any>(
    method: string,
    path: string,
    body?: unknown,
    options?: { token?: string; headers?: Record<string, string> }
  ) => Promise<ApiResponse<T>>;
  get: <T = any>(path: string, options?: { token?: string }) => Promise<ApiResponse<T>>;
  post: <T = any>(path: string, body?: unknown, options?: { token?: string }) => Promise<ApiResponse<T>>;
  put: <T = any>(path: string, body?: unknown, options?: { token?: string }) => Promise<ApiResponse<T>>;
  del: <T = any>(path: string, options?: { token?: string }) => Promise<ApiResponse<T>>;
  setSession: (value: string | null) => void;
  sessionValue: () => string | null;
  login: (email: string, password: string, role?: string) => Promise<ApiResponse>;
  loginAsDemo: (role: 'customer' | 'seller' | 'rider') => Promise<ApiResponse>;
}

export interface TestServer {
  baseUrl: string;
  databaseFile: string;
  client: () => ApiClient;
  close: (options?: { keepDatabase?: boolean }) => Promise<void>;
  db: () => any;
}

export interface LaunchOptions {
  /** Reuse an existing database file (used to simulate a server restart). */
  databaseFile?: string;
  /** Set false to skip demo seeding (only meaningful with an existing file). */
  seed?: boolean;
}

export async function launchServer(label: string, options: LaunchOptions = {}): Promise<TestServer> {
  const databaseFile =
    options.databaseFile ??
    path.join(os.tmpdir(), `nearbuy-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

  // Must be set before the app modules read their configuration.
  process.env.DATABASE_FILE = databaseFile;
  process.env.NODE_ENV = 'test';
  process.env.DEMO_MODE = 'true';
  process.env.COOKIE_SECURE = 'false';
  process.env.LOG_LEVEL = 'error';

  const [{ buildApp, prepareDatabase }, { seedDemoData }, dbModule] = await Promise.all([
    import('../app.js'),
    import('../seed.js'),
    import('../db.js'),
  ]);

  prepareDatabase();
  if (options.seed !== false) seedDemoData();

  const app = buildApp();
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server failed to bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    databaseFile,
    db: () => dbModule.db,
    client: () => createClient(baseUrl),
    close: async (options?: { keepDatabase?: boolean }) => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (options?.keepDatabase) return;
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          fs.unlinkSync(databaseFile + suffix);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export function createClient(baseUrl: string): ApiClient {
  let session: string | null = null;

  async function request<T = any>(
    method: string,
    requestPath: string,
    body?: unknown,
    options: { token?: string; headers?: Record<string, string> } = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-NearBuy-Client': 'web',
      ...(options.headers ?? {}),
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (session) headers.Cookie = `nb_session=${encodeURIComponent(session)}`;

    const response = await fetch(`${baseUrl}${requestPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const setCookies = typeof (response.headers as any).getSetCookie === 'function'
      ? (response.headers as any).getSetCookie()
      : [];
    for (const cookie of setCookies as string[]) {
      const match = /^nb_session=([^;]*)/.exec(cookie);
      if (match) {
        session = match[1] === '' ? null : decodeURIComponent(match[1]);
      }
    }

    const text = await response.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      /* non-JSON body */
    }

    return { status: response.status, body: parsed as T, headers: response.headers };
  }

  return {
    request,
    get: (p, o) => request('GET', p, undefined, o),
    post: (p, b, o) => request('POST', p, b, o),
    put: (p, b, o) => request('PUT', p, b, o),
    del: (p, o) => request('DELETE', p, undefined, o),
    setSession: (value) => {
      session = value;
    },
    sessionValue: () => session,
    async login(email, password, role) {
      return request('POST', '/api/auth/login', { email, password, expectedRole: role });
    },
    async loginAsDemo(role) {
      const emails = {
        customer: 'customer.demo@nearbuy.app',
        seller: 'seller.demo@nearbuy.app',
        rider: 'rider.demo@nearbuy.app',
      } as const;
      return request('POST', '/api/auth/login', {
        email: emails[role],
        password: 'NearBuy@2026',
        expectedRole: role,
      });
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Tiny assertion harness (deterministic summary + exit code)                  */
/* -------------------------------------------------------------------------- */

export function createSuite(name: string) {
  let passed = 0;
  const failures: string[] = [];
  const skipped: string[] = [];

  return {
    async test(title: string, fn: () => Promise<void> | void) {
      try {
        await fn();
        passed += 1;
        console.log(`  ✓ ${title}`);
      } catch (error: any) {
        failures.push(`${title}: ${error?.message || error}`);
        console.error(`  ✗ ${title}`);
        console.error(`      ${(error?.message || String(error)).split('\n').join('\n      ')}`);
      }
    },
    skip(title: string, reason: string) {
      skipped.push(`${title} (${reason})`);
      console.log(`  ⊘ ${title} — skipped: ${reason}`);
    },
    summary() {
      console.log(`\n${name}: ${passed} passed, ${failures.length} failed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
      if (failures.length > 0) {
        console.error('\nFailures:');
        failures.forEach((failure) => console.error(`  - ${failure}`));
        process.exitCode = 1;
      }
      return failures.length === 0;
    },
  };
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 100000)}@example.com`;
}
