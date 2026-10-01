import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  Boxes,
  ClipboardList,
  Headphones,
  Home,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MoreHorizontal,
  Package,
  PackageSearch,
  Receipt,
  Settings,
  ShieldCheck,
  Store as StoreIcon,
  UserCircle,
  Wallet,
  X,
} from 'lucide-react';
import { Link, navigate, useRoutePath } from '../../lib/router';
import { api, errorMessage } from '../../lib/api';
import { resetSavedCache } from '../../lib/saved';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { NearBuyWordmark } from '../brand';
import { Button, Modal } from '../ui';
import type { Store } from '../../types';

/**
 * Seller workspace shell.
 *
 * Desktop (1024px+): fixed left sidebar + sticky header.
 * Tablet / mobile (<1024px): compact top bar, bottom navigation
 * (Home | Orders | Products | More) and a slide-up "More" sheet — the desktop
 * sidebar is never forced onto a narrow screen.
 *
 * All data (store status, unread count) comes from the seller API; the shell
 * keeps no business state of its own.
 */

interface SellerNavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
  /** Extra path prefixes that should also highlight this item. */
  match?: string[];
}

interface SellerNavGroup {
  title: string;
  items: SellerNavItem[];
}

const icon = (node: React.ReactElement<{ className?: string }>) =>
  React.cloneElement(node, { className: 'h-[18px] w-[18px] shrink-0', 'aria-hidden': 'true' } as any);

export const SELLER_NAV_GROUPS: SellerNavGroup[] = [
  {
    title: 'Store',
    items: [
      { label: 'Dashboard', to: '/seller/dashboard', icon: icon(<LayoutDashboard />) },
      { label: 'Orders', to: '/seller/orders', icon: icon(<ClipboardList />) },
      { label: 'Products', to: '/seller/products', icon: icon(<Package />) },
      { label: 'Inventory', to: '/seller/inventory', icon: icon(<Boxes />) },
      { label: 'Reservations', to: '/seller/reservations', icon: icon(<Receipt />) },
      { label: 'Stock Requests', to: '/seller/stock-requests', icon: icon(<PackageSearch />), match: ['/seller/requests'] },
    ],
  },
  {
    title: 'Business',
    items: [
      { label: 'Store', to: '/seller/store', icon: icon(<StoreIcon />) },
      { label: 'Analytics', to: '/seller/analytics', icon: icon(<BarChart3 />), match: ['/seller/performance'] },
      { label: 'Earnings', to: '/seller/earnings', icon: icon(<Wallet />) },
    ],
  },
  {
    title: 'Communication',
    items: [
      { label: 'Notifications', to: '/seller/notifications', icon: icon(<Bell />) },
      { label: 'Support', to: '/seller/support', icon: icon(<Headphones />) },
    ],
  },
  {
    title: 'Settings',
    items: [
      { label: 'Business Profile', to: '/seller/business', icon: icon(<Receipt />) },
      { label: 'Account', to: '/seller/profile', icon: icon(<UserCircle />) },
      { label: 'Security', to: '/seller/settings/security', icon: icon(<ShieldCheck />), match: ['/seller/security'] },
      { label: 'Settings', to: '/seller/settings', icon: icon(<Settings />) },
    ],
  },
];

const BOTTOM_TABS: { label: string; to: string; icon: React.ReactNode; match: string[] }[] = [
  { label: 'Home', to: '/seller/dashboard', icon: icon(<Home />), match: ['/seller/dashboard'] },
  { label: 'Orders', to: '/seller/orders', icon: icon(<ClipboardList />), match: ['/seller/orders'] },
  { label: 'Products', to: '/seller/products', icon: icon(<Package />), match: ['/seller/products'] },
];

function pathOnly(path: string): string {
  return path.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
}

function isOn(path: string, to: string, extra: string[] = []): boolean {
  const current = pathOnly(path);
  return [to, ...extra].some((target) => current === target || current.startsWith(`${target}/`));
}

/** Longest-match wins so /seller/settings/security does not also light up /seller/settings. */
function activeTo(path: string): string | null {
  let best: { to: string; length: number } | null = null;
  for (const group of SELLER_NAV_GROUPS) {
    for (const item of group.items) {
      for (const target of [item.to, ...(item.match ?? [])]) {
        if (isOn(path, target) && (!best || target.length > best.length)) best = { to: item.to, length: target.length };
      }
    }
  }
  return best?.to ?? null;
}

export type StoreState = 'open' | 'closed' | 'unavailable' | 'hidden' | 'none';

export function storeState(store: Store | null | undefined): StoreState {
  if (!store) return 'none';
  if (store.status === 'inactive') return 'hidden';
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

/* -------------------------------------------------------------------------- */

function useSellerChrome() {
  const { user } = useAuth();
  const path = useRoutePath();
  const [store, setStore] = useState<Store | null>(null);
  const [storeLoaded, setStoreLoaded] = useState(false);
  const [unread, setUnread] = useState(0);

  const loadStore = useCallback(async () => {
    try {
      const data = await api.get<{ store: Store | null }>('/api/seller/store', { silent: true });
      setStore(data.store);
    } catch {
      /* the header degrades gracefully; page content shows its own errors */
    } finally {
      setStoreLoaded(true);
    }
  }, []);

  const loadUnread = useCallback(async () => {
    try {
      const data = await api.get<{ unreadCount: number }>('/api/seller/notifications/unread-count', { silent: true });
      setUnread(Number(data.unreadCount) || 0);
    } catch {
      /* keep the last known count */
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadStore();
    loadUnread();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadStore();
        loadUnread();
      }
    }, 30000);
    window.addEventListener('nearbuy:notifications-changed', loadUnread);
    window.addEventListener('nearbuy:store-changed', loadStore);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('nearbuy:notifications-changed', loadUnread);
      window.removeEventListener('nearbuy:store-changed', loadStore);
    };
  }, [user, loadStore, loadUnread]);

  // Fresh counts after every page change (e.g. after answering a request).
  useEffect(() => {
    if (user) loadUnread();
  }, [user, path, loadUnread]);

  return { store, storeLoaded, unread, reloadStore: loadStore };
}

/* -------------------------------------------------------------------------- */

const NavLink: React.FC<{ item: SellerNavItem; active: boolean; onNavigate?: () => void }> = ({
  item,
  active,
  onNavigate,
}) => (
  <Link
    to={item.to}
    onClick={onNavigate}
    aria-current={active ? 'page' : undefined}
    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1769E0] ${
      active ? 'bg-[#EAF3FF] text-[#0B3B91]' : 'text-[#667085] hover:bg-slate-100 hover:text-[#172033]'
    }`}
  >
    <span className={active ? 'text-[#1769E0]' : 'text-slate-400'}>{item.icon}</span>
    {item.label}
  </Link>
);

export const SellerShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const toast = useToast();
  const path = useRoutePath();
  const { store, storeLoaded, unread, reloadStore } = useSellerChrome();
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const state = storeState(store);
  const active = useMemo(() => activeTo(path), [path]);
  const tabActive = BOTTOM_TABS.find((tab) => tab.match.some((m) => isOn(path, m)))?.to ?? null;

  useEffect(() => {
    setMoreOpen(false);
  }, [path]);

  useEffect(() => {
    const previous = document.title;
    document.title = 'NearBuy Seller';
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMoreOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const setStatus = async (status: 'open' | 'closed') => {
    setBusy(true);
    try {
      const result = await api.put<{ message: string }>('/api/seller/store/status', {
        status,
        closureType: status === 'closed' ? 'closed' : undefined,
      });
      toast.push({ title: status === 'open' ? 'Store is open' : 'Store is closed', description: result.message, tone: 'success' });
      await reloadStore();
      window.dispatchEvent(new CustomEvent('nearbuy:store-changed'));
    } catch (error) {
      toast.push({ title: 'Could not update store status', description: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(false);
      setConfirmClose(false);
    }
  };

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      resetSavedCache();
      await logout();
    } finally {
      navigate('/', { replace: true });
    }
  };

  const canToggle = state === 'open' || state === 'closed' || state === 'unavailable';
  const toggleButton = canToggle ? (
    state === 'open' ? (
      <Button variant="secondary" size="sm" loading={busy} onClick={() => setConfirmClose(true)}>
        Close Store
      </Button>
    ) : (
      <Button size="sm" loading={busy} onClick={() => setStatus('open')}>
        Open Store
      </Button>
    )
  ) : null;

  const bellLabel = `Notifications, ${unread} unread`;
  const bell = (
    <Link
      to="/seller/notifications"
      aria-label={bellLabel}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-[#0B3B91] hover:bg-slate-50"
    >
      <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
      {unread > 0 && (
        <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white tabular-nums">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );

  const avatar = (
    <Link
      to="/seller/profile"
      aria-label="Your profile"
      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#1769E0] text-sm font-bold text-white"
    >
      {initials(user?.name)}
    </Link>
  );

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center border-b border-slate-200 px-5">
        <Link to="/seller/dashboard" aria-label="NearBuy Seller home" className="flex items-center gap-2">
          <NearBuyWordmark size={30} />
          <span className="rounded-md bg-[#EAF3FF] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0B3B91]">
            Seller
          </span>
        </Link>
      </div>
      <nav aria-label="Seller workspace" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {SELLER_NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{group.title}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.to} item={item} active={active === item.to} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-slate-200 p-3">
        <div className="flex items-center gap-3 rounded-xl p-2">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1769E0] text-sm font-bold text-white">
            {initials(user?.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#172033]">{user?.name}</p>
            <p className="flex items-center gap-1.5 text-xs text-[#667085]">
              <span className={`h-2 w-2 rounded-full ${state === 'open' ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
              Seller · {state === 'open' ? 'Online' : 'Offline'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {signingOut ? 'Signing out…' : 'Logout'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F7F9FC] text-[#172033]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-slate-900 focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-slate-200 bg-white lg:block" aria-label="Seller sidebar">
        {sidebar}
      </aside>

      <div className="lg:pl-64">
        {/* Header (every seller page) */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            {/* Mobile / tablet: logo. Desktop: store context. */}
            <Link to="/seller/dashboard" aria-label="NearBuy Seller home" className="flex items-center gap-2 lg:hidden">
              <NearBuyWordmark size={28} />
            </Link>
            <div className="hidden min-w-0 items-center gap-3 lg:flex">
              {storeLoaded && store ? (
                <>
                  <p className="truncate text-sm font-semibold text-[#172033]">{store.name}</p>
                  <StoreStatusPill state={state} />
                </>
              ) : storeLoaded ? (
                <Link to="/seller/store" className="text-sm font-semibold text-[#1769E0] hover:underline">
                  Create your store
                </Link>
              ) : (
                <span className="h-5 w-40 animate-pulse rounded bg-slate-100" aria-hidden="true" />
              )}
              {toggleButton}
            </div>
            <div className="flex items-center gap-2">
              {storeLoaded && store && <StoreStatusPill state={state} className="lg:hidden" />}
              {bell}
              {avatar}
            </div>
          </div>
          {/* Mobile quick action row */}
          {storeLoaded && store && canToggle && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2 sm:px-6 lg:hidden">
              <p className="min-w-0 truncate text-xs font-semibold text-[#172033]">{store.name}</p>
              {toggleButton}
            </div>
          )}
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          {children}
        </main>
      </div>

      {/* Mobile / tablet bottom navigation */}
      <nav
        aria-label="Seller quick navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-4">
          {BOTTOM_TABS.map((tab) => {
            const on = tabActive === tab.to && !moreOpen;
            return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  aria-current={on ? 'page' : undefined}
                  className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${on ? 'text-[#1769E0]' : 'text-[#667085]'}`}
                >
                  {tab.icon}
                  {tab.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={`flex w-full flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${
                moreOpen || (!tabActive && active) ? 'text-[#1769E0]' : 'text-[#667085]'
              }`}
            >
              <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
              More
            </button>
          </li>
        </ul>
      </nav>

      {/* Slide-up "More" sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More seller pages">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#1769E0] text-sm font-bold text-white">
                  {initials(user?.name)}
                </span>
                <div>
                  <p className="text-sm font-semibold">{user?.name}</p>
                  <p className="text-xs text-[#667085]">Seller{store ? ` · ${store.name}` : ''}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            {SELLER_NAV_GROUPS.map((group) => {
              const items = group.items.filter((item) => !BOTTOM_TABS.some((tab) => tab.to === item.to));
              if (items.length === 0) return null;
              return (
                <div key={group.title} className="mt-3">
                  <p className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{group.title}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {items.map((item) => (
                      <NavLink key={item.to} item={item} active={active === item.to} onNavigate={() => setMoreOpen(false)} />
                    ))}
                  </div>
                </div>
              );
            })}
            <Link
              to="/seller/support"
              className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[#667085] hover:bg-slate-100"
            >
              <LifeBuoy className="h-[18px] w-[18px]" aria-hidden="true" /> Help &amp; support
            </Link>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {signingOut ? 'Signing out…' : 'Logout'}
            </button>
          </div>
        </div>
      )}

      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Close your store?"
        description="Customers can still browse, but they won't be able to check out. Orders already placed stay active."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClose(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => setStatus('closed')}>
              Close Store
            </Button>
          </>
        }
      >
        <p className="text-sm text-[#667085]">You can reopen at any time from the header.</p>
      </Modal>
    </div>
  );
};
