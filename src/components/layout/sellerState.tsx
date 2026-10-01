import React from 'react';
import type { Store } from '../../types';

/** Compatibility helpers for the seller account module already shipped on main. */
export type StoreState = 'open' | 'closed' | 'unavailable' | 'hidden' | 'none';

export function storeState(store: Store | null | undefined): StoreState {
  if (!store) return 'none';
  if (store.status === 'inactive' || store.is_published === 0) return 'hidden';
  if (store.temporarily_unavailable) return 'unavailable';
  if (store.status === 'open') return 'open';
  return store.closure_type === 'temporarily_unavailable' ? 'unavailable' : 'closed';
}

const STATE_LABEL: Record<StoreState, string> = {
  open: 'Open',
  closed: 'Closed',
  unavailable: 'Temporarily unavailable',
  hidden: 'Unpublished',
  none: 'No store yet',
};

const STATE_STYLE: Record<StoreState, string> = {
  open: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  closed: 'border-red-200 bg-red-50 text-red-800',
  unavailable: 'border-amber-200 bg-amber-50 text-amber-900',
  hidden: 'border-slate-200 bg-slate-100 text-slate-700',
  none: 'border-slate-200 bg-slate-100 text-slate-700',
};

const STATE_DOT: Record<StoreState, string> = {
  open: 'bg-emerald-500',
  closed: 'bg-red-500',
  unavailable: 'bg-amber-500',
  hidden: 'bg-slate-400',
  none: 'bg-slate-400',
};

export const StoreStatusPill: React.FC<{ state: StoreState; className?: string }> = ({ state, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${STATE_STYLE[state]} ${className}`}
  >
    <span className={`h-2 w-2 rounded-full ${STATE_DOT[state]}`} aria-hidden="true" />
    {STATE_LABEL[state]}
  </span>
);

export function initials(name: string | undefined): string {
  return (
    (name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'S'
  );
}
