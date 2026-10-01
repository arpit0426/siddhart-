import React, { useId } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Package, RefreshCw, Search, ShoppingBag } from 'lucide-react';
import { Button, ErrorNote, Skeleton } from '../ui';
import { formatINR } from '../../lib/format';
import type { DailySales, Pagination } from '../../types/seller';

export function PageHeader({ title, subtitle, eyebrow, action }: { title: string; subtitle?: React.ReactNode; eyebrow?: string; action?: React.ReactNode }) {
  return <div className="seller-page-heading"><div>{eyebrow && <p className="seller-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{subtitle && <p className="seller-page-subtitle">{subtitle}</p>}</div>{action && <div className="seller-page-actions">{action}</div>}</div>;
}
export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <section className={`seller-panel ${className}`}>{children}</section>; }
export function PanelHeading({ title, subtitle, action, icon }: { title: string; subtitle?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return <div className="seller-panel-heading"><div><h2>{icon}{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}
export function MetricCard({ label, value, hint, icon, color = 'blue' }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon: React.ReactNode; color?: string }) {
  return <div className="seller-metric"><div className="seller-metric-top"><p>{label}</p><span className={`seller-icon-tile ${color}`}>{icon}</span></div><strong>{value}</strong>{hint && <div className="seller-metric-hint">{hint}</div>}</div>;
}
export function SearchInput({ value, onChange, placeholder = 'Search…', label = 'Search', className = '' }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string; className?: string }) {
  return <div className={`seller-search-input ${className}`}><Search size={17} aria-hidden="true" /><input type="search" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div>;
}
export function Tabs({ tabs, value, onChange, label = 'View' }: { tabs: { value: string; label: string; count?: number }[]; value: string; onChange: (v: string) => void; label?: string }) {
  return <div className="seller-tabs" role="group" aria-label={label}>{tabs.map((t) => <button key={t.value} type="button" aria-pressed={value === t.value} className={value === t.value ? 'active' : ''} onClick={() => onChange(t.value)}>{t.label}{t.count !== undefined && <span>{t.count}</span>}</button>)}</div>;
}
export function Pager({ pagination, onPage, loading }: { pagination?: Pagination; onPage: (page: number) => void; loading?: boolean }) {
  if (!pagination || !pagination.total) return null;
  const { page, pageSize, total, pages } = pagination;
  return <div className="seller-pagination"><p>Showing <b>{Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)}</b> of <b>{total}</b></p><div><Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></Button><span>Page {page} of {pages}</span><Button size="sm" variant="secondary" disabled={page >= pages || loading} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={15} /></Button></div></div>;
}
export function SellerEmpty({ title, description, action, icon = <ShoppingBag size={26} /> }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return <div className="seller-empty"><div className="seller-empty-icon">{icon}</div><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}
export function ResourceError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return null;
  return <div className="seller-error"><ErrorNote>{error}</ErrorNote><Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw size={14} />Try again</Button></div>;
}
export function PageSkeleton() { return <div className="space-y-5" role="status" aria-label="Loading workspace"><Skeleton className="h-14 w-2/3" /><div className="seller-kpi-grid">{[1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-36" />)}</div><Skeleton className="h-64" /><span className="sr-only">Loading…</span></div>; }
export function ProductImage({ src, name, className = '' }: { src?: string | null; name: string; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  return <div className={`seller-product-image ${className}`}>{src && !failed ? <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} /> : <Package size={25} aria-label="No product image" />}</div>;
}
export function Avatar({ name, src, small = false }: { name: string; src?: string | null; small?: boolean }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]).join('');
  return <span className={`seller-avatar ${small ? 'small' : ''}`}>{src ? <img src={src} alt={name} /> : initials}</span>;
}
export function hoursLabel(time?: string | null) {
  if (!time) return '—';
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
export function StoreStatus({ store }: { store: { status: string; temporarily_unavailable?: number; is_published?: number } }) {
  const open = store.status === 'open' && store.is_published !== 0 && !store.temporarily_unavailable;
  return <span className={`seller-store-status ${open ? 'open' : 'closed'}`}><i />{open ? 'Store open' : store.temporarily_unavailable ? 'Temporarily closed' : store.is_published === 0 || store.status === 'inactive' ? 'Unpublished' : 'Store closed'}</span>;
}

export function SalesChart({ daily, mode = 'revenue', compact = false }: { daily: DailySales[]; mode?: 'revenue' | 'orders'; compact?: boolean }) {
  const id = useId().replace(/:/g, '');
  const width = 700, height = compact ? 180 : 225, left = 51, right = 14, top = 17, bottom = 31;
  const max = Math.max(1, ...daily.map((d) => Number(d[mode])));
  const ceiling = mode === 'orders' ? Math.max(4, Math.ceil(max / 4) * 4) : Math.max(100, Math.ceil(max / 100) * 100);
  const scaleX = (n: number) => left + n / Math.max(1, daily.length - 1) * (width - left - right);
  const scaleY = (n: number) => height - bottom - n / ceiling * (height - top - bottom);
  const points = daily.map((d, i) => `${scaleX(i)},${scaleY(d[mode])}`).join(' ');
  const label = (n: number) => mode === 'orders' ? String(n) : n >= 1000 ? `₹${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : `₹${n}`;
  return <div className="seller-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${mode === 'revenue' ? 'Sales in rupees' : 'Orders'} by day, from persisted orders`}><defs><linearGradient id={`sales-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1769E0" stopOpacity=".14" /><stop offset="100%" stopColor="#1769E0" stopOpacity=".01" /></linearGradient></defs>{[0, 1, 2, 3, 4].map((n) => <g key={n}><line x1={left} x2={width - right} y1={scaleY(ceiling * n / 4)} y2={scaleY(ceiling * n / 4)} stroke="#edf0f5" strokeDasharray={n === 0 ? undefined : '3 4'} /><text x={left - 11} y={scaleY(ceiling * n / 4) + 4} textAnchor="end" fill="#8c96a7" fontSize="10">{label(ceiling * n / 4)}</text></g>)}{daily.length > 0 && <><polygon points={`${left},${height - bottom} ${points} ${scaleX(daily.length - 1)},${height - bottom}`} fill={`url(#sales-${id})`} /><polyline points={points} fill="none" stroke="#1769E0" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />{daily.map((d, i) => <circle key={d.day} cx={scaleX(i)} cy={scaleY(d[mode])} r={daily.length > 20 ? 0 : 3} fill="#fff" stroke="#1769E0" strokeWidth="1.8"><title>{d.day}: {mode === 'revenue' ? formatINR(d.revenue) : d.orders}</title></circle>)}</>}{daily.filter((_, i) => daily.length <= 7 || i % Math.ceil(daily.length / 6) === 0 || i === daily.length - 1).map((d) => <text key={d.day} x={scaleX(daily.indexOf(d))} y={height - 8} textAnchor="middle" fill="#8791a1" fontSize="10">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</text>)}</svg><details className="seller-chart-data"><summary>View chart data</summary><table><thead><tr><th>Date</th><th>Orders</th><th>Sales</th></tr></thead><tbody>{daily.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.orders}</td><td>{formatINR(d.revenue)}</td></tr>)}</tbody></table></details></div>;
}
