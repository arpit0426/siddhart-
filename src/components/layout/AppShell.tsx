import { resetSavedCache } from '../../lib/saved';
import React, { useEffect, useState } from 'react';
import {
  Bell,
  Bike,
  ChevronDown,
  LogOut,
  MapPin,
  Menu,
  Package,
  ShoppingBag,
  Store,
  User as UserIcon,
  X,
} from 'lucide-react';
import { Link, navigate, useRoutePath } from '../../lib/router';
import { roleHome, useAuth } from '../../context/AuthContext';
import { NearBuyWordmark } from '../brand';
import { Button } from '../ui';
import { LocationPicker } from '../LocationPicker';
import { api } from '../../lib/api';
import type { Role } from '../../types';

interface NavItem {
  label: string;
  to: string;
}

const CUSTOMER_NAV: NavItem[] = [
  { label: 'Discover', to: '/customer' },
  { label: 'Orders', to: '/orders' },
  { label: 'Saved', to: '/customer/saved' },
  { label: 'Requests', to: '/requests' },
  { label: 'Account', to: '/account' },
];

const SELLER_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/seller/dashboard' },
  { label: 'Orders', to: '/seller/orders' },
  { label: 'Products', to: '/seller/products' },
  { label: 'Requests', to: '/seller/requests' },
  { label: 'Inventory', to: '/seller/inventory' },
  { label: 'Earnings', to: '/seller/earnings' },
  { label: 'Performance', to: '/seller/performance' },
  { label: 'Store', to: '/seller/store' },
];

const RIDER_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/rider' },
  { label: 'Jobs', to: '/rider/jobs' },
  { label: 'Active', to: '/rider/active' },
  { label: 'History', to: '/rider/history' },
  { label: 'Earnings', to: '/rider/earnings' },
  { label: 'Profile', to: '/rider/profile' },
];

function navFor(role: Role): NavItem[] {
  if (role === 'seller') return SELLER_NAV;
  if (role === 'rider') return RIDER_NAV;
  return CUSTOMER_NAV;
}

const ROLE_LABEL: Record<Role, string> = {
  customer: 'Customer',
  seller: 'Seller',
  rider: 'Delivery partner',
};

const ROLE_ICON: Record<Role, React.ReactNode> = {
  customer: <UserIcon className="h-4 w-4" aria-hidden="true" />,
  seller: <Store className="h-4 w-4" aria-hidden="true" />,
  rider: <Bike className="h-4 w-4" aria-hidden="true" />,
};

export const AppShell: React.FC<{ children: React.ReactNode; cartCount?: number }> = ({
  children,
  cartCount = 0,
}) => {
  const { user, logout } = useAuth();
  const path = useRoutePath();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [authMenuOpen, setAuthMenuOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
    setAuthMenuOpen(false);
  }, [path]);

  const nav = user ? navFor(user.role) : [];
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    let active = true;
    const load = () =>
      api
        .get<{ unreadCount: number }>(`/api/${user.role}/notifications/unread-count`, { silent: true })
        .then((r) => active && setUnread(r.unreadCount))
        .catch(() => undefined);
    load();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && load(), 30000);
    window.addEventListener('nearbuy:notifications-changed', load);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('nearbuy:notifications-changed', load);
    };
  }, [user, path]);
  const isActive = (to: string) =>
    to === path || (to !== '/' && to !== '/seller' && to !== '/rider' && path.startsWith(`${to}/`)) ||
    (to === '/seller' && path === '/seller') ||
    (to === '/rider' && path === '/rider');

  return (
    <div className="flex min-h-screen flex-col bg-[#F8FAFC] text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-slate-900 focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-5">
            <Link
              to={user ? roleHome(user.role) : '/'}
              aria-label="NearBuy home"
              className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <NearBuyWordmark size={32} />
            </Link>
            {user?.role === 'customer' ? (
              <LocationPicker />
            ) : (
              <span className="hidden items-center gap-1 text-xs font-medium text-slate-500 lg:flex">
                <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                Dwarka, New Delhi
              </span>
            )}
          </div>

          {user && (
            <nav aria-label="Workspace" className="hidden items-center gap-1 md:flex">
              {nav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={isActive(item.to) ? 'page' : undefined}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive(item.to)
                      ? 'bg-blue-50 text-blue-800'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-2">
            {(!user || user.role === 'customer') && (
              <Link
                to="/cart"
                aria-label={`Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
                className="relative inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <ShoppingBag className="h-4 w-4 text-blue-700" aria-hidden="true" />
                <span className="hidden sm:inline">Cart</span>
                {cartCount > 0 && (
                  <span className="min-w-[20px] rounded-full bg-blue-600 px-1.5 py-0.5 text-center text-[11px] font-bold text-white tabular-nums">
                    {cartCount}
                  </span>
                )}
              </Link>
            )}

            {user && (
              <Link
                to={`/${user.role}/notifications`}
                aria-label={`Notifications, ${unread} unread`}
                className="relative inline-flex items-center rounded-lg border border-slate-200 bg-white p-2.5 text-slate-700 hover:bg-slate-50"
              >
                <Bell className="h-4 w-4 text-blue-700" aria-hidden="true" />
                {unread > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white tabular-nums">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
            )}

            {user ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAccountOpen((open) => !open)}
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <span className="text-blue-700">{ROLE_ICON[user.role]}</span>
                  <span className="hidden max-w-[10rem] truncate sm:inline">{user.name}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                </button>
                {accountOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
                  >
                    <div className="border-b border-slate-100 px-4 py-3">
                      <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                      <p className="text-xs text-slate-500">{ROLE_LABEL[user.role]} · {user.email}</p>
                    </div>
                    <Link
                      to={user.role === 'customer' ? '/account' : user.role === 'seller' ? '/seller/store' : '/rider/profile'}
                      role="menuitem"
                      className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Profile &amp; settings
                    </Link>
                    <Link
                      to={`/${user.role}/security`}
                      role="menuitem"
                      className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Security
                    </Link>
                    <Link
                      to={`/${user.role}/support`}
                      role="menuitem"
                      className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Help &amp; support
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        resetSavedCache();
                        await logout();
                        navigate('/');
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative">
                <Button
                  onClick={() => setAuthMenuOpen((open) => !open)}
                  aria-expanded={authMenuOpen}
                  aria-haspopup="menu"
                >
                  Sign in
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                {authMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
                  >
                    <p className="border-b border-slate-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Choose your portal
                    </p>
                    {(['customer', 'seller', 'rider'] as Role[]).map((role) => (
                      <Link
                        key={role}
                        to={`/${role}/auth`}
                        role="menuitem"
                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        <span className="text-blue-700">{ROLE_ICON[role]}</span>
                        {ROLE_LABEL[role]} sign in
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {user && (
              <button
                type="button"
                onClick={() => setMobileOpen((open) => !open)}
                aria-expanded={mobileOpen}
                aria-controls="mobile-nav"
                aria-label="Toggle navigation menu"
                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 md:hidden"
              >
                {mobileOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
              </button>
            )}
          </div>
        </div>

        {user && mobileOpen && (
          <nav id="mobile-nav" aria-label="Workspace" className="border-t border-slate-200 bg-white px-4 py-3 md:hidden">
            <ul className="grid grid-cols-2 gap-2">
              {nav.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={isActive(item.to) ? 'page' : undefined}
                    className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                      isActive(item.to) ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {children}
      </main>

      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 text-xs text-slate-500 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">NearBuy</span>
            <span>— What You Need, Already Nearby.</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <Package className="h-3.5 w-3.5" aria-hidden="true" />
              Verified handoff codes
            </span>
            <span>Dwarka, New Delhi</span>
            <Link to="/customer" className="hover:text-slate-800">
              Discover stores
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
