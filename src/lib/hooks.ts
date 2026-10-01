import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/** Late responses never overwrite newer filters/actions. Polling is suspended
 * in hidden tabs, and failed background refreshes retain the last server state. */
export function useApiResource<T>(loader: () => Promise<T>, deps: unknown[], options: { pollMs?: number; enabled?: boolean; refreshEvent?: string } = {}): ResourceState<T> {
  const { pollMs, enabled = true, refreshEvent } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader); loaderRef.current = loader;
  const requestId = useRef(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let alive = true;
    let inFlight = false;
    const load = async (background = false) => {
      if (background && inFlight) return;
      const id = ++requestId.current;
      inFlight = true;
      if (!background) setLoading(true);
      try {
        const result = await loaderRef.current();
        if (alive && id === requestId.current) { setData(result); setError(null); }
      } catch (err) {
        if (alive && id === requestId.current && (err as any)?.name !== 'AbortError' && !background) setError(errorMessage(err));
      } finally {
        if (alive && id === requestId.current) { inFlight = false; setLoading(false); }
      }
    };
    load();
    const refresh = () => load();
    const onFocus = () => { if (document.visibilityState !== 'hidden') load(true); };
    const interval = pollMs ? window.setInterval(onFocus, pollMs) : undefined;
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    if (refreshEvent) window.addEventListener(refreshEvent, refresh);
    return () => {
      alive = false; requestId.current += 1;
      if (interval) window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      if (refreshEvent) window.removeEventListener(refreshEvent, refresh);
    };
  }, [...deps, nonce, enabled, pollMs, refreshEvent]);
  return { data, loading, error, reload, setData };
}

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setDebounced(value), delayMs); return () => window.clearTimeout(t); }, [value, delayMs]);
  return debounced;
}
