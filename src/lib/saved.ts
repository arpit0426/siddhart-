import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Saved-item ids for the signed-in customer, shared across every product card. */
let cache: Set<string> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function load() {
  if (!loading) {
    loading = api
      .get<{ items: { id: string }[] }>('/api/customer/saved', { silent: true })
      .then((result) => {
        cache = new Set(result.items.map((item) => item.id));
      })
      .catch(() => {
        cache = new Set();
      })
      .finally(() => {
        loading = null;
        emit();
      });
  }
  return loading;
}

export function resetSavedCache() {
  cache = null;
  emit();
}

export function useSaved() {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    if (cache === null) void load();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const toggle = useCallback(async (productId: string) => {
    const wasSaved = cache?.has(productId) ?? false;
    cache = new Set(cache ?? []);
    if (wasSaved) cache.delete(productId);
    else cache.add(productId);
    emit();
    try {
      if (wasSaved) await api.del(`/api/customer/saved/${productId}`);
      else await api.post('/api/customer/saved', { productId });
    } catch (error) {
      // Roll back: the server, not the UI, decides what is saved.
      cache = new Set(cache ?? []);
      if (wasSaved) cache.add(productId);
      else cache.delete(productId);
      emit();
      throw error;
    }
  }, []);

  return { isSaved: (id: string) => cache?.has(id) ?? false, toggle };
}
