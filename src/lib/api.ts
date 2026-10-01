/**
 * API client.
 *
 * - same-origin relative URLs only (no localhost/absolute hosts anywhere)
 * - session via HttpOnly cookie (credentials included so a Partitioned preview
 *   cookie is still sent) plus a tab-scoped Bearer fallback
 * - sends the X-NearBuy-Client header the API requires for state-changing calls
 *   (CSRF defence-in-depth alongside the cookie policy and the Origin check)
 *
 * The Bearer token is only a fallback for embedded previews that refuse
 * third-party cookies. It lives in sessionStorage (this tab only), never
 * localStorage, and is cleared on logout or a 401.
 */

const SESSION_TOKEN_KEY = 'nearbuy:session-token';
let memoryToken: string | null = null;

export function setSessionToken(token: string | null) {
  memoryToken = token && token.trim() ? token.trim() : null;
  try {
    if (memoryToken) window.sessionStorage.setItem(SESSION_TOKEN_KEY, memoryToken);
    else window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    /* private mode / unavailable storage */
  }
}

export function getSessionToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = window.sessionStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}
export class ApiRequestError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const SESSION_EXPIRED_EVENT = 'nearbuy:session-expired';

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  /** Suppress the global session-expired event (used by session probes). */
  silent?: boolean;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-NearBuy-Client': 'web',
    Accept: 'application/json',
  };
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    response = await fetch(path, {
      method,
      // 'include' keeps Partitioned cookies attached inside the preview iframe.
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiRequestError(0, 'Network error. Please check your connection and try again.');
  }

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload: any = isJson ? await response.json().catch(() => ({})) : {};

  if (!response.ok) {
    // A wrong password is a 401 too — that is not an expired session.
    const authAttempt = path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register');
    if (response.status === 401 && !options.silent && !authAttempt) {
      setSessionToken(null);
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    throw new ApiRequestError(
      response.status,
      payload?.error || `Request failed (${response.status}).`,
      payload?.code
    );
  }

  if (
    (path === '/api/auth/login' || path === '/api/auth/register') &&
    typeof payload?.token === 'string' &&
    payload.token
  ) {
    setSessionToken(payload.token);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
  del: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};

/** Serializable error message for inline UI display. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}
