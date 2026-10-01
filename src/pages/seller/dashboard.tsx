import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, IndianRupee, Package, PackageCheck, Plus, ShoppingBag, Sparkles, Store as StoreIcon, Truck } from 'lucide-react';
import { Button } from '../../components/ui';
import { hoursLabel, MetricCard, PageHeader, PageSkeleton, Panel, PanelHeading, ProductImage, ResourceError, SalesChart, SellerEmpty } from '../../components/seller/ui';
import { useAuth } from '../../context/AuthContext';
import { useSeller, useSellerResource } from '../../context/SellerContext';
import { Link, navigate } from '../../lib/router';
import { api } from '../../lib/api';
import { formatINR, formatTime, relativeTime } from '../../lib/format';
import type { OrderStatus } from '../../types';
import type { SellerAnalytics } from '../../types/seller';

const LANES: { status: OrderStatus; title: string; empty: string }[] = [
  { status: 'placed', title: 'New', empty: 'No new orders' }, { status: 'accepted', title: 'Accepted', empty: 'Nothing waiting' },
  { status: 'preparing', title: 'Preparing', empty: 'All caught up' }, { status: 'packed', title: 'Packed', empty: 'No packed orders' },
  { status: 'ready_for_pickup', title: 'Ready for pickup', empty: 'No pickups waiting' },
];

export function SellerDashboardPage() {
  const resource = useSeller(); const { user } = useAuth();
  const [days, setDays] = useState('7');
  const sales = useSellerResource(() => api.get<SellerAnalytics>(`/api/seller/analytics?days=${days}`), [days], { enabled: days !== '7' });
  if (resource.loading && !resource.data) return <PageSkeleton />;
  if (!resource.data) return <ResourceError error={resource.error} onRetry={resource.reload} />;
  const { store, metrics, actionRequired: attention, lowStock, setup } = resource.data;
  const hour = Number(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const isOpen = Boolean(store?.status === 'open' && store.is_published !== 0 && !store.temporarily_unavailable);
  const daily = days === '7' ? resource.data.daily ?? [] : sales.data?.daily ?? [];
  const periodSales = daily.reduce((sum, d) => sum + d.revenue, 0);
  const pending = (attention?.newOrders ?? 0) + (attention?.pendingStockRequests ?? 0) + (attention?.pendingReservations ?? 0) + (metrics?.lowStockCount ?? 0);
  const attentionCards = [
    { title: 'New Orders', count: attention?.newOrders ?? 0, unit: 'orders waiting', path: '/seller/orders?status=new', icon: ShoppingBag, color: 'blue', action: 'View orders' },
    { title: 'Stock Requests', count: attention?.pendingStockRequests ?? 0, unit: 'requests to answer', path: '/seller/stock-requests', icon: PackageCheck, color: 'purple', action: 'Respond' },
    { title: 'Reservations', count: attention?.pendingReservations ?? 0, unit: 'pending requests', path: '/seller/reservations', icon: CalendarDays, color: 'green', action: 'Review' },
    { title: 'Low Stock', count: metrics?.lowStockCount ?? 0, unit: 'products to review', path: '/seller/inventory?stock=low', icon: AlertTriangle, color: 'amber', action: 'Manage inventory' },
  ];
  return <div>
    <PageHeader title={`${greeting}, ${user?.name.split(' ')[0]} 👋`} subtitle={store ? <><b>{store.name}</b><span>·</span><span className={isOpen ? 'text-emerald-700' : ''}>{isOpen ? 'Open' : store.is_published === 0 ? 'Unpublished' : 'Closed'}</span><span>·</span>{hoursLabel(store.opens_at)} – {hoursLabel(store.closes_at)}</> : 'A fresh start for your neighbourhood business.'} action={<><span className="seller-date-chip"><CalendarDays size={14} />{new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}<span>· Today</span></span><Button onClick={() => navigate('/seller/products/new')}><Plus size={15} />Add product</Button></>} />
    <ResourceError error={resource.error} onRetry={resource.reload} />
    {!store ? <Panel><SellerEmpty title="Your neighbourhood is waiting for you" description="Set up your store, add your first products and preview everything before you go live." icon={<StoreIcon size={28} />} action={<Button onClick={() => navigate('/seller/store')}>Create your store<ArrowRight size={15} /></Button>} /></Panel> : <>
      <div className="seller-kpi-grid">
        <MetricCard label="Today's Orders" value={metrics?.todayOrders ?? 0} icon={<ShoppingBag />} hint={<><span className="text-blue-600">●</span>Placed today, in store local time</>} />
        <MetricCard label="Today's Sales" value={formatINR(metrics?.todayRevenue)} icon={<IndianRupee />} color="green" hint="Item value · excluding delivery fees" />
        <MetricCard label="Pending Orders" value={metrics?.pendingOrders ?? 0} icon={<Clock3 />} color="purple" hint="From new order to ready for pickup" />
        <MetricCard label="Low Stock" value={metrics?.lowStockCount ?? 0} icon={<Package />} color="amber" hint="At or below your stock thresholds" />
      </div>
      <section className="seller-attention" aria-labelledby="attention-title"><div className="seller-attention-heading"><span><AlertTriangle size={14} /></span><h2 id="attention-title">Needs your attention</h2><p>{pending ? `${pending} things to keep moving` : "You're all caught up"}</p></div><div className="seller-attention-grid">{attentionCards.map((item) => <Link key={item.title} to={item.path} className="seller-attention-card" aria-label={`${item.title}: ${item.count} ${item.unit}. ${item.action}`}><span className={`seller-icon-tile ${item.color}`}><item.icon /></span><div><strong>{item.title}</strong><p>{item.count} {item.unit}</p></div><ChevronRight /></Link>)}</div></section>
      <Panel className="seller-board"><PanelHeading title="Live order board" subtitle="Every order, from your counter to their doorstep." icon={<ShoppingBag />} action={<Link to="/seller/orders">View all orders<ArrowRight size={13} /></Link>} /><div className="seller-order-board">{LANES.map((lane) => {
        const orders = (resource.data!.liveOrders ?? []).filter((o) => o.status === lane.status);
        const count = resource.data?.orderCounts?.[lane.status] ?? 0;
        return <section key={lane.status} className={`seller-order-lane ${lane.status}`} aria-label={`${lane.title}, ${count} orders`}><h3 className="seller-order-lane-heading"><i />{lane.title}<b>{count}</b></h3>{orders.length ? orders.map((order) => <Link key={order.id} to={`/seller/orders/${order.id}`} className="seller-board-order" aria-label={`Open order ${order.orderNumber}`}><div><strong>#{order.orderNumber.slice(-9)}</strong><span>{formatTime(order.createdAt)}</span></div><h3>{order.customer.name}</h3><p>{order.itemCount} items · {relativeTime(order.createdAt)}</p><div className="seller-board-order-bottom"><strong>{formatINR(order.total)}</strong><span>{order.fulfillmentType === 'delivery' ? <Truck /> : <StoreIcon />}{order.fulfillmentType === 'delivery' ? 'Delivery' : 'Pickup'}</span></div></Link>) : <div className="seller-lane-empty"><PackageCheck /><p>{lane.empty}</p></div>}{count > orders.length && <Link to={`/seller/orders?status=${lane.status}`} className="seller-text-link">{count - orders.length} more<ArrowRight size={10} /></Link>}</section>;
      })}</div></Panel>
      <div className="seller-dashboard-lower"><Panel><PanelHeading title="Sales overview" subtitle="A little progress, every day." action={<select aria-label="Sales chart period" className="seller-date-select" value={days} onChange={(e) => setDays(e.target.value)}><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option></select>} /><div className="seller-sales-summary"><strong>{formatINR(periodSales)}</strong><span>{daily.reduce((n, d) => n + d.orders, 0)} orders in this period</span></div><ResourceError error={sales.error} onRetry={sales.reload} /><SalesChart daily={daily} compact /><div className="seller-chart-footer"><span><i />Item sales</span><span>Cancelled orders excluded</span><Link className="seller-text-link" to="/seller/analytics">View analytics<ArrowRight size={11} /></Link></div></Panel>
        <Panel><PanelHeading title="Inventory health" subtitle="A well-stocked store is a happy neighbourhood." action={<Link to="/seller/inventory">Manage<ArrowRight size={12} /></Link>} /><div className="seller-stock-summary"><b>{metrics?.totalProducts ?? 0}</b>products<span>·</span><b>{metrics?.healthy ?? 0}</b>healthy</div><div className="seller-stock-strip" aria-label={`${metrics?.healthy ?? 0} healthy, ${Math.max(0, (metrics?.lowStockCount ?? 0) - (metrics?.outOfStock ?? 0))} low, ${metrics?.outOfStock ?? 0} out of stock`}><span style={{ flex: metrics?.healthy ?? 0 }} /><span className="low" style={{ flex: Math.max(0, (metrics?.lowStockCount ?? 0) - (metrics?.outOfStock ?? 0)) }} /><span className="out" style={{ flex: metrics?.outOfStock ?? 0 }} /></div>{lowStock.length ? <div className="seller-stock-list">{lowStock.map((p) => <div key={p.id}><ProductImage src={p.image} name={p.name} /><span><strong>{p.name}</strong><small>{p.sellable} available · threshold {p.low_stock_threshold}</small></span><button onClick={() => navigate(`/seller/inventory?query=${encodeURIComponent(p.name)}`)}>Restock</button></div>)}</div> : <div className="seller-stock-safe"><CheckCircle2 /><strong>Your shelves are in good shape</strong><p>No products need restocking right now.</p></div>}</Panel>
      </div>
      <div className="seller-dashboard-bottom"><Panel className="seller-setup"><div className="seller-setup-top"><h2>Your store, ready for the neighbourhood</h2><span>{setup?.percent ?? 0}% complete</span></div><p>{setup?.percent === 100 ? 'Looking good! Keep your store information up to date.' : 'A few small steps to make a great first impression.'}</p><div className="seller-progress" role="progressbar" aria-label="Store setup" aria-valuenow={setup?.percent ?? 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${setup?.percent ?? 0}%` }} /></div><div className="seller-setup-checks">{(setup?.checks ?? []).map((c) => <span className={c.done ? 'done' : ''} key={c.label}>{c.done ? <CheckCircle2 /> : <span>○</span>}{c.label}</span>)}</div><Link to={setup?.percent === 100 ? '/seller/store/preview' : '/seller/store'} className="seller-text-link">{setup?.percent === 100 ? 'Preview your store' : 'Finish setup'}<ArrowRight size={11} /></Link></Panel>
        <div className="seller-local-banner"><span><StoreIcon size={27} strokeWidth={1.5} /></span><div><h3>Your local store. A little more connected.</h3><p>{store.is_published === 0 ? 'Preview your store, then open your doors online.' : 'See what your neighbours see when they visit.'}</p><Link to="/seller/store/preview" className="seller-text-link">Preview store<ArrowRight size={11} /></Link></div></div>
      </div>
    </>}
  </div>;
}
