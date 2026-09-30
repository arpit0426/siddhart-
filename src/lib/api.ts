/**
 * API client.
 *
 * - same-origin relative URLs only (no localhost/absolute hosts anywhere)
 * - session via HttpOnly cookie (credentials: same-origin)
 * - sends the X-NearBuy-Client header the API requires for state-changing calls
 *   (CSRF defence-in-depth alongside SameSite=Lax and the Origin check)
 */
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
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-NearBuy-Client': 'web',
        Accept: 'application/json',
      },
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
    if (response.status === 401 && !options.silent) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    throw new ApiRequestError(
      response.status,
      payload?.error || `Request failed (${response.status}).`,
      payload?.code
    );
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
