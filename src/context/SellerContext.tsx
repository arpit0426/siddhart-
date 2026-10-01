import React, { createContext, useContext } from 'react';
import { api } from '../lib/api';
import { useApiResource, type ResourceState } from '../lib/hooks';
import type { SellerDashboard } from '../types/seller';

const REFRESH_EVENT = 'nearbuy:seller-refresh';
export function refreshSeller() { window.dispatchEvent(new Event(REFRESH_EVENT)); }
export function useSellerResource<T>(loader: () => Promise<T>, deps: unknown[] = [], options: { pollMs?: number; enabled?: boolean } = {}) {
  return useApiResource(loader, deps, { ...options, refreshEvent: REFRESH_EVENT });
}
const SellerContext = createContext<ResourceState<SellerDashboard> | null>(null);
export function SellerProvider({ children }: { children: React.ReactNode }) {
  const resource = useSellerResource(() => api.get<SellerDashboard>('/api/seller/dashboard'), [], { pollMs: 25000 });
  return <SellerContext.Provider value={resource}>{children}</SellerContext.Provider>;
}
export function useSeller() {
  const context = useContext(SellerContext);
  if (!context) throw new Error('Seller workspace context required.');
  return context;
}
