import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';

interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Data fetching with loading/error/empty states and optional polling.
 * Polling pauses while the tab is hidden so background tabs stay cheap.
 */
export function useApiResource<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  options: { pollMs?: number; enabled?: boolean } = {}
): ResourceState<T> {
  const { pollMs, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loaderRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if ((err as any)?.name === 'AbortError') return;
        setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  useEffect(() => {
    if (!pollMs || !enabled) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loaderRef
        .current()
        .then((result) => {
          setData(result);
          setError(null);
        })
        .catch(() => {
          /* keep the last good data on background refresh failures */
        });
    }, pollMs);
    return () => window.clearInterval(interval);
  }, [pollMs, enabled]);

  useEffect(() => {
    const onFocus = () => {
      if (!enabled) return;
      loaderRef
        .current()
        .then((result) => setData(result))
        .catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled]);

  return { data, loading, error, reload, setData };
}

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);
  return debounced;
}
