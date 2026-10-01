import React, { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, BarChart3, Bell, BriefcaseBusiness, CalendarClock, ChevronDown, ChevronRight, CircleHelp, ClipboardList, ExternalLink, Home, LayoutDashboard, LogOut, MoreHorizontal, Package, PackageCheck, Search, Settings, ShieldCheck, ShoppingBag, Store, Users, Wallet, X } from 'lucide-react';
import { NearBuyWordmark } from '../brand';
import { Button, ErrorNote, Modal } from '../ui';
import { Avatar, SearchInput, StoreStatus } from '../seller/ui';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { refreshSeller, SellerProvider, useSeller, useSellerResource } from '../../context/SellerContext';
import { api, errorMessage } from '../../lib/api';
import { Link, navigate, useRoutePath } from '../../lib/router';
import { useDebouncedValue } from '../../lib/hooks';

const GROUPS = [
  { title: 'OVERVIEW', items: [{ label: 'Dashboard', path: '/seller/dashboard', icon: LayoutDashboard }] },
  { title: 'STORE OPERATIONS', items: [
    { label: 'Orders', path: '/seller/orders', icon: ShoppingBag, counter: 'orders' },
    { label: 'Products', path: '/seller/products', icon: Package },
    { label: 'Inventory', path: '/seller/inventory', icon: ClipboardList },
    { label: 'Stock Requests', path: '/seller/stock-requests', icon: PackageCheck, counter: 'requests' },
    { label: 'Reservations', path: '/seller/reservations', icon: CalendarClock },
  ] },
  { title: 'BUSINESS', items: [
    { label: 'My Store', path: '/seller/store', icon: Store },
    { label: 'Analytics', path: '/seller/analytics', icon: BarChart3 },
    { label: 'Earnings', path: '/seller/earnings', icon: Wallet },
  ] },
  { title: 'COMMUNICATION', items: [
    { label: 'Notifications', path: '/seller/notifications', icon: Bell },
    { label: 'Help & Support', path: '/seller/support', icon: CircleHelp },
  ] },
  { title: 'SETTINGS', items: [
    { label: 'Business Profile', path: '/seller/business', icon: BriefcaseBusiness },
    { label: 'Account', path: '/seller/profile', icon: Users },
    { label: 'Security', path: '/seller/settings/security', icon: ShieldCheck },
    { label: 'Settings', path: '/seller/settings', icon: Settings },
  ] },
];
const NAV = GROUPS.flatMap((g) => g.items);

function GlobalSearch() {
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false);
  const debounced = useDebouncedValue(query); const ref = useRef<HTMLDivElement>(null);
  const results = useSellerResource(() => api.get<Record<string, { id: string; name: string; detail: string }[]>>(`/api/seller/search?query=${encodeURIComponent(debounced)}`), [debounced], { enabled: debounced.length >= 2 });
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, []);
  const paths: Record<string, (id: string) => string> = { orders: (id) => `/seller/orders/${id}`, products: (id) => `/seller/products/${id}`, requests: () => '/seller/stock-requests', reservations: () => '/seller/reservations' };
  const total = Object.values(results.data ?? {}).reduce((n, rows) => n + rows.length, 0);
  return <div className="seller-global-search" ref={ref}><Search size={18} aria-hidden="true" /><input aria-label="Search orders, products and customers" type="search" placeholder="Search orders, products, customers…" value={query} onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} />
    {open && debounced.length >= 2 && <div className="seller-search-results" aria-live="polite">{results.loading ? <p className="p-4 text-sm text-slate-500">Searching your store…</p> : results.error ? <p className="p-4 text-sm text-red-700">{results.error}</p> : !total ? <p className="p-4 text-sm text-slate-500">No matching records in your store.</p> : Object.entries(results.data ?? {}).map(([group, rows]) => rows.length > 0 && <div key={group}><h3>{group === 'requests' ? 'Stock requests' : group}</h3>{rows.map((r) => <Link key={r.id} to={paths[group](r.id)} onClick={() => { setOpen(false); setQuery(''); }}><span>{r.name}<small>{r.detail.replace(/_/g, ' ')}</small></span><ArrowRight size={15} /></Link>)}</div>)}</div>}
  </div>;
}

function Workspace({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth(); const resource = useSeller(); const toast = useToast();
  const route = useRoutePath(); const path = route.split('?')[0];
  const [moreOpen, setMoreOpen] = useState(false); const [accountOpen, setAccountOpen] = useState(false);
  const [statusModal, setStatusModal] = useState(false); const [saving, setSaving] = useState(false); const [statusError, setStatusError] = useState<string | null>(null);
  const store = resource.data?.store;
  const isOpen = Boolean(store?.status === 'open' && store.is_published !== 0 && !store.temporarily_unavailable);
  const isActive = (to: string) => to === path || (to === '/seller/dashboard' && path === '/seller') || (to !== '/seller/settings' && path.startsWith(`${to}/`));
  const current = NAV.find((item) => isActive(item.path))?.label ?? (path.includes('preview') ? 'Store Preview' : 'Workspace');
  const accountRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMoreOpen(false); setAccountOpen(false); document.title = `${current} · NearBuy Seller`; }, [route, current]);
  useEffect(() => {
    const onClick = (e: PointerEvent) => { if (!accountRef.current?.contains(e.target as Node)) setAccountOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAccountOpen(false); };
    document.addEventListener('pointerdown', onClick); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onClick); document.removeEventListener('keydown', onKey); };
  }, []);
  const signOut = async () => { try { await logout(); navigate('/seller/auth'); } catch (error) { toast.push({ title: 'Could not sign out', description: errorMessage(error), tone: 'error' }); } };
  const changeStatus = async (status: 'open' | 'closed' | 'temporary') => {
    setSaving(true); setStatusError(null);
    try { const result = await api.post<{ message: string }>('/api/seller/store/status', { status }); refreshSeller(); setStatusModal(false); toast.push({ title: result.message, tone: 'success' }); }
    catch (error) { setStatusError(errorMessage(error)); } finally { setSaving(false); }
  };
  const navigation = (mobile = false) => <nav aria-label={mobile ? 'All seller pages' : 'Seller workspace'} className="seller-navigation">{GROUPS.map((group) => <div key={group.title} className="seller-nav-group"><p>{group.title}</p>{group.items.map((item) => {
    const n = 'counter' in item ? item.counter === 'orders' ? resource.data?.actionRequired?.newOrders : resource.data?.actionRequired?.pendingStockRequests : 0;
    return <Link key={item.path} to={item.path} className={`seller-nav-item ${isActive(item.path) ? 'active' : ''}`} aria-current={isActive(item.path) ? 'page' : undefined}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{Boolean(n) && <b>{n}</b>}{isActive(item.path) && <ChevronRight size={14} className="seller-nav-chevron" />}</Link>;
  })}</div>)}</nav>;

  return <div className="seller-workspace"><a href="#seller-main" className="seller-skip-link">Skip to content</a>
    <aside className="seller-sidebar"><Link to="/seller/dashboard" className="seller-brand" aria-label="NearBuy Seller dashboard"><NearBuyWordmark size={35} /><span>SELLER</span></Link>
      <div className="seller-store-selector"><span className="seller-store-selector-icon"><Store size={19} /></span><div><strong>{store?.name ?? 'Your local store'}</strong><span>Seller workspace</span></div><ChevronDown size={15} /></div>
      {navigation()}
      <div className="seller-sidebar-bottom"><Link to="/seller/profile" className="seller-sidebar-profile"><Avatar name={user!.name} src={user!.profileImage} /><span><strong>{user!.name}</strong><small><i className={isOpen ? 'online' : ''} />{isOpen ? 'Online' : 'Offline'} · Seller</small></span></Link><button aria-label="Logout" onClick={signOut}><LogOut size={17} /></button></div>
    </aside>
    <div className="seller-content"><header className="seller-topbar"><div className="seller-mobile-brand"><Link to="/seller/dashboard"><NearBuyWordmark size={28} /></Link></div><GlobalSearch />
      <div className="seller-topbar-actions">{store && <button className="seller-status-control" onClick={() => { setStatusModal(true); setStatusError(null); }} aria-label={isOpen ? 'Close store' : 'Open store'}><StoreStatus store={store} /><span className={`seller-switch ${isOpen ? 'on' : ''}`} aria-hidden="true"><i /></span></button>}
        <Link to="/seller/notifications" className="seller-notification-button" aria-label={`Notifications${resource.data?.unreadNotifications ? `, ${resource.data.unreadNotifications} unread` : ''}`}><Bell size={20} />{Boolean(resource.data?.unreadNotifications) && <i />}</Link>
        <div className="seller-topbar-profile" ref={accountRef}><button onClick={() => setAccountOpen((v) => !v)} aria-label="Profile menu" aria-expanded={accountOpen}><Avatar name={user!.name} src={user!.profileImage} small /><span>{user!.name.split(' ')[0]}<ChevronDown size={14} /></span></button>{accountOpen && <div className="seller-account-menu"><strong>{user!.name}</strong><small>{user!.email}</small><Link to="/seller/profile">My profile</Link><Link to="/seller/settings/security">Security settings</Link><button onClick={signOut}><LogOut size={15} />Logout</button></div>}</div>
      </div>
    </header>
      <main id="seller-main" className="seller-main"><div className="seller-breadcrumb"><span>Seller workspace</span><ChevronRight size={12} /><span>{current}</span><span className="seller-live-label"><i />Live store data</span></div>{children}</main>
      <footer className="seller-footer"><span>Built for your neighbourhood. <b>Powered by NearBuy.</b></span><Link to="/seller/support">Need a hand? <CircleHelp size={13} /></Link></footer>
    </div>
    <nav className="seller-bottom-nav" aria-label="Mobile seller navigation">{[{ label: 'Home', path: '/seller/dashboard', icon: Home }, { label: 'Orders', path: '/seller/orders', icon: ShoppingBag }, { label: 'Products', path: '/seller/products', icon: Package }].map((item) => <Link key={item.path} to={item.path} aria-current={isActive(item.path) ? 'page' : undefined} className={isActive(item.path) ? 'active' : ''}><item.icon size={21} /><span>{item.label}</span></Link>)}<button onClick={() => setMoreOpen(true)} aria-expanded={moreOpen} className={!['/seller', '/seller/dashboard', '/seller/orders', '/seller/products'].some((p) => path === p || (p !== '/seller' && path.startsWith(`${p}/`))) ? 'active' : ''}><MoreHorizontal size={21} /><span>More</span></button></nav>
    <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Your seller workspace"><div className="seller-mobile-menu">{navigation(true)}<Button variant="secondary" onClick={signOut}><LogOut size={15} />Logout</Button></div></Modal>
    <Modal open={statusModal} onClose={() => !saving && setStatusModal(false)} title="Store availability" description="Control whether your neighbourhood can place new orders. Existing orders and reservations remain accessible." footer={<Button variant="ghost" disabled={saving} onClick={() => setStatusModal(false)}>Cancel</Button>}>
      {statusError && <ErrorNote>{statusError}</ErrorNote>}<div className="seller-availability-options"><Button variant={isOpen ? 'primary' : 'secondary'} loading={saving} onClick={() => changeStatus('open')}><Store size={17} />Open for orders</Button><Button variant="secondary" loading={saving} onClick={() => changeStatus('closed')}>Close store</Button><Button variant="secondary" loading={saving} onClick={() => changeStatus('temporary')}>Temporarily unavailable</Button></div>{store?.is_published === 0 && <p className="text-sm text-slate-500">Publish your store from <Link to="/seller/store" className="text-blue-700 underline" onClick={() => setStatusModal(false)}>My Store</Link> before opening.</p>}
    </Modal>
  </div>;
}
export function SellerShell({ children }: { children: React.ReactNode }) { return <SellerProvider><Workspace>{children}</Workspace></SellerProvider>; }
