import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  MapPin,
  Package,
  PackageCheck,
  Plus,
  Store as StoreIcon,
  Truck,
} from 'lucide-react';
import { Link, navigate, useQueryParams } from '../lib/router';
import { api, errorMessage } from '../lib/api';
import { useApiResource } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  HandoffCode,
  InfoNote,
  Modal,
  QuantityStepper,
  SectionHeader,
  SelectField,
  Skeleton,
  Spinner,
  StatCard,
  SuccessNote,
  TextAreaField,
} from '../components/ui';
import { formatDateTime, formatINR, formatTime, orderStatusMeta, statusMeta, RESERVATION_STATUS, STOCK_REQUEST_STATUS } from '../lib/format';
import type { Order, Product, Reservation, StockRequest, Store } from '../types';

interface InventoryEvent {
  id: string;
  product_id: string;
  product_name: string;
  type: string;
  delta: number;
  resulting_stock: number;
  note: string | null;
  created_at: string;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

interface SellerDashboard {
  store: Store | null;
  metrics: {
    totalOrders: number;
    revenue: number;
    subtotalRevenue: number;
    delivered: number;
    todayRevenue: number;
    todayOrders: number;
    heldUnits: number;
    lowStockCount?: number;
    liveProducts?: number;
  } | null;
  actionRequired: {
    newOrders: number;
    pendingStockRequests: number;
    pendingReservations: number;
    packedAwaitingPickup: number;
    readyForPickup: number;
    inProgress: number;
  } | null;
  recentOrders: Order[];
  liveOrders?: Order[];
  lowStock: { id: string; name: string; stock_quantity: number; reserved_quantity: number }[];
}

function notifyStoreChanged() {
  window.dispatchEvent(new CustomEvent('nearbuy:store-changed'));
}

export function shortName(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Customer';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function clock12(value: string | null | undefined): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  if (!match) return value ?? '';
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${match[2]} ${suffix}`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const BOARD_COLUMNS: { status: string; title: string; hint: string }[] = [
  { status: 'placed', title: 'New', hint: 'Awaiting acceptance' },
  { status: 'accepted', title: 'Accepted', hint: 'Accepted by you' },
  { status: 'preparing', title: 'Preparing', hint: 'Being prepared' },
  { status: 'packed', title: 'Packed', hint: 'Packed, not yet ready' },
  { status: 'ready_for_pickup', title: 'Ready for Pickup', hint: 'Waiting for rider' },
];

const AttentionCard: React.FC<{
  title: string;
  count: number;
  noun: string;
  cta: string;
  to: string;
  tone: 'amber' | 'blue' | 'violet' | 'orange';
}> = ({ title, count, noun, cta, to, tone }) => {
  const accent = {
    amber: 'border-l-amber-500',
    blue: 'border-l-[#1769E0]',
    violet: 'border-l-violet-500',
    orange: 'border-l-orange-500',
  }[tone];
  return (
    <Card className={`flex flex-col justify-between border-l-4 p-4 ${count > 0 ? accent : 'border-l-slate-200'}`}>
      <div>
        <p className="text-sm font-semibold text-[#172033]">{title}</p>
        <p className={`mt-1 text-sm ${count > 0 ? 'font-semibold text-[#172033]' : 'text-[#667085]'}`}>
          {count > 0 ? `${count} ${noun}` : 'All clear'}
        </p>
      </div>
      <Link
        to={to}
        className={`mt-3 inline-flex w-fit items-center rounded-lg px-3 py-1.5 text-xs font-semibold ${
          count > 0 ? 'bg-[#1769E0] text-white hover:bg-[#0B3B91]' : 'border border-slate-200 text-[#172033] hover:bg-slate-50'
        }`}
      >
        {cta}
      </Link>
    </Card>
  );
};

const BoardOrderCard: React.FC<{ order: Order }> = ({ order }) => {
  const meta = orderStatusMeta(order.status);
  const count = order.items.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-[#172033]">{order.orderNumber}</span>
        <span className="text-[#667085]">{formatTime(order.createdAt)}</span>
      </div>
      <p className="mt-1 text-[#667085]">
        {shortName(order.customer?.name)} · {count} item{count === 1 ? '' : 's'}
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="font-semibold tabular-nums text-[#172033]">{formatINR(order.total)}</span>
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#667085]">
          {order.fulfillmentType === 'pickup' ? 'Pickup' : 'Delivery'}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <Link to={`/seller/orders/${order.id}`} className="font-semibold text-[#1769E0] hover:underline">
          Open Order
        </Link>
      </div>
    </li>
  );
};

export const SellerDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const resource = useApiResource(() => api.get<SellerDashboard>('/api/seller/dashboard'), [], { pollMs: 20000 });

  if (resource.loading && !resource.data) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading your store dashboard">
        <Skeleton className="h-16" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (resource.error && !resource.data) {
    return (
      <div className="space-y-3">
        <ErrorNote>We couldn&apos;t load your dashboard. {resource.error}</ErrorNote>
        <Button variant="secondary" onClick={resource.reload}>
          Try Again
        </Button>
      </div>
    );
  }
  if (!resource.data) return null;

  const { store, metrics, actionRequired, lowStock } = resource.data;
  const liveOrders = resource.data.liveOrders ?? [];

  if (!store) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#172033] lg:text-[32px]">
          {greeting()}, {user?.name.split(' ')[0]} 👋
        </h1>
        <EmptyState
          icon={<StoreIcon className="h-8 w-8" aria-hidden="true" />}
          title="Set up your store"
          description="Create your store profile first — customers can only discover you once it is published."
          action={<Button onClick={() => navigate('/seller/store')}>Create store profile</Button>}
        />
      </div>
    );
  }

  const isOpen = store.status === 'open';
  const statusLabel = store.status === 'inactive' ? 'Unpublished' : isOpen ? 'Open' : store.closure_type === 'temporarily_unavailable' ? 'Temporarily unavailable' : 'Closed';
  const hours = store.opens_at && store.closes_at ? `${clock12(store.opens_at)} – ${clock12(store.closes_at)}` : store.opening_hours ?? '';

  const pending = (actionRequired?.newOrders ?? 0) + (actionRequired?.inProgress ?? 0) + (actionRequired?.packedAwaitingPickup ?? 0);
  const lowStockCount = metrics?.lowStockCount ?? lowStock.length;

  const checklist = [
    { label: 'Profile', done: Boolean(user?.name && user?.email) },
    { label: 'Store details', done: Boolean(store.name && store.address && store.category) },
    { label: 'Location', done: store.latitude != null && store.longitude != null },
    { label: 'Hours', done: Boolean(store.opens_at && store.closes_at) },
    { label: 'First product', done: (metrics?.liveProducts ?? 0) > 0 },
    { label: 'Store image', done: Boolean(store.image) },
  ];
  const doneCount = checklist.filter((item) => item.done).length;
  const percent = Math.round((doneCount / checklist.length) * 100);

  return (
    <div className="space-y-6">
      {resource.error && (
        <ErrorNote>
          We couldn&apos;t refresh your dashboard just now. Showing the last loaded data.{' '}
          <button type="button" className="font-semibold underline" onClick={resource.reload}>
            Try Again
          </button>
        </ErrorNote>
      )}

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-[#172033] lg:text-[32px] lg:leading-10">
          {greeting()}, {user?.name.split(' ')[0]} 👋
        </h1>
        <p className="mt-1 text-base font-semibold text-[#172033]">{store.name}</p>
        <p className="text-sm text-[#667085]">
          <span aria-hidden="true">{isOpen ? '🟢 ' : '🔴 '}</span>
          {statusLabel}
          {hours ? ` • ${hours}` : ''}
        </p>
      </header>

      <section aria-label="Today at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today's Orders" value={metrics?.todayOrders ?? 0} hint="Placed today" />
        <StatCard label="Today's Sales" value={formatINR(metrics?.todayRevenue ?? 0)} hint="Item value, excl. cancelled" />
        <StatCard
          label="Pending Orders"
          value={pending}
          hint="Not yet ready for pickup"
          icon={<Clock className="h-4 w-4 text-amber-600" aria-hidden="true" />}
        />
        <StatCard
          label="Low Stock"
          value={lowStockCount}
          hint="Products at or below threshold"
          icon={<AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />}
        />
      </section>

      <section aria-labelledby="needs-attention" className="space-y-3">
        <h2 id="needs-attention" className="text-lg font-bold text-[#172033] lg:text-[22px]">
          Needs Your Attention
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AttentionCard
            title="New Orders"
            count={actionRequired?.newOrders ?? 0}
            noun={`order${(actionRequired?.newOrders ?? 0) === 1 ? '' : 's'} waiting`}
            cta="View Orders"
            to="/seller/orders?status=placed"
            tone="amber"
          />
          <AttentionCard
            title="Stock Requests"
            count={actionRequired?.pendingStockRequests ?? 0}
            noun={`request${(actionRequired?.pendingStockRequests ?? 0) === 1 ? '' : 's'}`}
            cta="Respond"
            to="/seller/stock-requests"
            tone="blue"
          />
          <AttentionCard
            title="Reservations"
            count={actionRequired?.pendingReservations ?? 0}
            noun="pending"
            cta="Review"
            to="/seller/reservations"
            tone="violet"
          />
          <AttentionCard
            title="Low Stock"
            count={lowStockCount}
            noun={`product${lowStockCount === 1 ? '' : 's'}`}
            cta="Manage Inventory"
            to="/seller/inventory"
            tone="orange"
          />
        </div>
      </section>

      <section aria-labelledby="live-orders" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="live-orders" className="text-lg font-bold text-[#172033] lg:text-[22px]">
            Live Orders
          </h2>
          <Link to="/seller/orders" className="text-sm font-semibold text-[#1769E0] hover:underline">
            All orders
          </Link>
        </div>
        {liveOrders.length === 0 ? (
          <EmptyState
            icon={<Package className="h-8 w-8" aria-hidden="true" />}
            title="No orders yet"
            description="New customer orders will appear here."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {BOARD_COLUMNS.map((column) => {
              const orders = liveOrders.filter((order) => order.status === column.status);
              return (
                <div key={column.status} className="rounded-2xl border border-slate-200 bg-[#F1F5FA] p-2.5">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <h3 className="text-sm font-bold text-[#172033]" title={column.hint}>
                      {column.title}
                    </h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-[#667085]">
                      {orders.length}
                    </span>
                  </div>
                  {orders.length === 0 ? (
                    <p className="px-1 py-3 text-xs text-[#667085]">Nothing here</p>
                  ) : (
                    <ul className="space-y-2">
                      {orders.slice(0, 4).map((order) => (
                        <BoardOrderCard key={order.id} order={order} />
                      ))}
                    </ul>
                  )}
                  {orders.length > 4 && (
                    <Link
                      to={`/seller/orders?status=${column.status}`}
                      className="mt-2 block px-1 text-xs font-semibold text-[#1769E0] hover:underline"
                    >
                      +{orders.length - 4} more
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-base font-bold text-[#172033]">Low Stock Alerts</h2>
          {lowStock.length === 0 ? (
            <p className="mt-3 text-sm text-[#667085]">All products are comfortably in stock.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {lowStock.slice(0, 5).map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
                >
                  <span className="text-amber-950">
                    {item.name} has only {item.stock_quantity} unit{item.stock_quantity === 1 ? '' : 's'} remaining.
                  </span>
                  <Link to="/seller/inventory" className="shrink-0 text-xs font-semibold text-[#1769E0] hover:underline">
                    Update Stock
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {percent < 100 && (
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#172033]">Store Setup</h2>
              <span className="text-sm font-semibold text-[#1769E0]">{percent}% complete</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Store setup progress"
            >
              <div className="h-full rounded-full bg-[#1769E0]" style={{ width: `${percent}%` }} />
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-1.5 text-sm">
              {checklist.map((item) => (
                <li key={item.label} className={item.done ? 'text-emerald-700' : 'text-[#667085]'}>
                  <span aria-hidden="true">{item.done ? '✓' : '○'}</span> {item.label}
                  <span className="sr-only">{item.done ? ' (done)' : ' (to do)'}</span>
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => navigate(checklist.find((c) => !c.done)?.label === 'First product' ? '/seller/products/new' : '/seller/store')}
            >
              Finish Setup
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

const SELLER_ACTIONS: Record<string, { next: string; label: string }[]> = {
  placed: [
    { next: 'accepted', label: 'Accept order' },
    { next: 'rejected', label: 'Reject' },
  ],
  accepted: [{ next: 'preparing', label: 'Start preparing' }],
  preparing: [{ next: 'packed', label: 'Mark packed' }],
  packed: [{ next: 'ready_for_pickup', label: 'Ready for pickup' }],
};

const ORDER_TABS: { id: string; label: string; statuses: string }[] = [
  { id: 'all', label: 'All', statuses: '' },
  { id: 'new', label: 'New', statuses: 'placed' },
  { id: 'preparing', label: 'Preparing', statuses: 'accepted,preparing,packed' },
  { id: 'ready', label: 'Ready', statuses: 'ready_for_pickup' },
  { id: 'completed', label: 'Completed', statuses: 'picked_up,out_for_delivery,delivered' },
  { id: 'cancelled', label: 'Cancelled', statuses: 'cancelled,rejected' },
];

const STATUS_PARAM_TO_TAB: Record<string, string> = {
  placed: 'new',
  accepted: 'preparing',
  preparing: 'preparing',
  packed: 'preparing',
  ready_for_pickup: 'ready',
  out_for_delivery: 'completed',
  delivered: 'completed',
  cancelled: 'cancelled',
  rejected: 'cancelled',
};

export const SellerOrdersPage: React.FC = () => {
  const params = useQueryParams();
  const initial = params.get('tab') ?? STATUS_PARAM_TO_TAB[params.get('status') ?? ''] ?? 'all';
  const [tab, setTab] = useState(ORDER_TABS.some((t) => t.id === initial) ? initial : 'all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [fulfilment, setFulfilment] = useState('');

  // Debounce the order-ID search so we don't hit the API on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const statuses = ORDER_TABS.find((t) => t.id === tab)?.statuses ?? '';
  const resource = useApiResource(
    () => {
      const qs = new URLSearchParams();
      if (statuses) qs.set('status', statuses);
      if (query) qs.set('q', query.replace(/^#/, ''));
      const text = qs.toString();
      return api.get<{ orders: Order[] }>(`/api/seller/orders${text ? `?${text}` : ''}`);
    },
    [statuses, query],
    { pollMs: 15000 }
  );

  const orders = (resource.data?.orders ?? []).filter((order) => !fulfilment || order.fulfillmentType === fulfilment);

  return (
    <div className="space-y-5">
      <SectionHeader
        as="h1"
        title="Orders"
        subtitle="Accept, prepare, pack and hand over. Every transition is validated by the server."
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" aria-label="Order status" className="flex max-w-full gap-1.5 overflow-x-auto pb-1">
          {ORDER_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${
                tab === t.id ? 'border-[#1769E0] bg-[#EAF3FF] text-[#0B3B91]' : 'border-slate-200 bg-white text-[#667085] hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Field
            label="Search order ID"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="#NB-10482"
            className="sm:w-48"
          />
          <SelectField
            label="Fulfilment"
            value={fulfilment}
            onChange={(event) => setFulfilment(event.target.value)}
            options={[
              { value: '', label: 'All types' },
              { value: 'delivery', label: 'Delivery' },
              { value: 'pickup', label: 'Pickup' },
            ]}
          />
        </div>
      </div>

      {resource.loading && !resource.data ? (
        <div className="space-y-3" role="status" aria-label="Loading orders">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : resource.error && !resource.data ? (
        <div className="space-y-3">
          <ErrorNote>We couldn&apos;t load your orders. {resource.error}</ErrorNote>
          <Button variant="secondary" onClick={resource.reload}>
            Try Again
          </Button>
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<Package className="h-8 w-8" aria-hidden="true" />}
          title={query || fulfilment || tab !== 'all' ? 'No matching orders' : 'No orders yet'}
          description={query || fulfilment || tab !== 'all' ? 'Try another tab or clear the filters.' : 'New customer orders will appear here.'}
        />
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <SellerOrderRow key={order.id} order={order} onChanged={resource.reload} />
          ))}
        </div>
      )}
    </div>
  );
};

const SellerOrderRow: React.FC<{ order: Order; onChanged: () => void }> = ({ order, onChanged }) => {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonModal, setReasonModal] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const meta = orderStatusMeta(order.status);
  const actions = SELLER_ACTIONS[order.status] ?? [];

  const changeStatus = async (next: string, note?: string) => {
    setBusy(next);
    try {
      await api.post(`/api/seller/orders/${order.id}/status`, { status: next, reason: note });
      toast.push({ title: `Order marked ${orderStatusMeta(next).label}`, tone: 'success' });
      onChanged();
    } catch (error) {
      toast.push({ title: 'Could not update order', description: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/seller/orders/${order.id}`} className="text-sm font-bold text-slate-900 hover:text-blue-700">
              {order.orderNumber}
            </Link>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {order.fulfillmentType === 'pickup' && <Badge tone="info">Pickup</Badge>}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {order.customer?.name} · {order.items.length} item(s) · {formatDateTime(order.createdAt)}
          </p>
          {meta.sellerHint && <p className="mt-1 text-[11px] text-slate-500">{meta.sellerHint}</p>}
        </div>
        <div className="text-right">
          <p className="text-base font-extrabold tabular-nums text-slate-900">{formatINR(order.total)}</p>
          <Link to={`/seller/orders/${order.id}`} className="text-xs font-semibold text-blue-700 hover:underline">
            Details
          </Link>
        </div>
      </div>

      {order.pickupCode && (
        <div className="mt-3">
          <HandoffCode
            code={order.pickupCode}
            label="Pickup code — give to the rider"
            hint="Only share this with the delivery partner collecting this order."
            tone="warning"
          />
        </div>
      )}

      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {actions.map((action) => (
            <Button
              key={action.next}
              variant={action.next === 'rejected' ? 'danger' : 'primary'}
              size="sm"
              loading={busy === action.next}
              onClick={() =>
                action.next === 'rejected' ? setReasonModal(action.next) : changeStatus(action.next)
              }
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}

      <Modal
        open={reasonModal !== null}
        onClose={() => setReasonModal(null)}
        title="Reject this order"
        description="The customer sees this reason and any deducted stock is returned."
        footer={
          <>
            <Button variant="ghost" onClick={() => setReasonModal(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!reason.trim()) {
                  toast.push({ title: 'Please add a short reason', tone: 'error' });
                  return;
                }
                await changeStatus('rejected', reason.trim());
                setReason('');
                setReasonModal(null);
              }}
            >
              Reject order
            </Button>
          </>
        }
      >
        <TextAreaField
          label="Reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Item out of stock at the store"
        />
      </Modal>
    </Card>
  );
};

export const SellerOrderDetailPage: React.FC<{ orderId: string }> = ({ orderId }) => {
  const toast = useToast();
  const resource = useApiResource(() => api.get<{ order: Order }>(`/api/seller/orders/${orderId}`), [orderId], {
    pollMs: 15000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [pickupCodeInput, setPickupCodeInput] = useState('');
  const [pickupError, setPickupError] = useState<string | null>(null);

  if (resource.loading && !resource.data) return <Spinner label="Loading order…" />;
  if (resource.error) return <ErrorNote>{resource.error}</ErrorNote>;
  if (!resource.data) return null;

  const order = resource.data.order;
  const meta = orderStatusMeta(order.status);
  const actions = SELLER_ACTIONS[order.status] ?? [];

  const completePickup = async (event: React.FormEvent) => {
    event.preventDefault();
    setPickupError(null);
    setBusy('complete');
    try {
      await api.post(`/api/seller/orders/${order.id}/complete-pickup`, { code: pickupCodeInput });
      toast.push({ title: 'Pickup completed', description: 'The order is marked delivered.', tone: 'success' });
      setPickupCodeInput('');
      resource.reload();
    } catch (error) {
      setPickupError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (next: string) => {
    setBusy(next);
    try {
      await api.post(`/api/seller/orders/${order.id}/status`, { status: next });
      toast.push({ title: `Order marked ${orderStatusMeta(next).label}`, tone: 'success' });
      resource.reload();
    } catch (error) {
      toast.push({ title: 'Could not update order', description: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
        <Link to="/seller/orders" className="hover:text-slate-800">
          Orders
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-medium text-slate-700">{order.orderNumber}</span>
      </nav>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">{order.orderNumber}</h1>
            <p className="mt-1 text-xs text-slate-500">
              {order.customer?.name} · {order.customer?.phone} · placed {formatDateTime(order.createdAt)}
            </p>
          </div>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        {meta.sellerHint && <p className="mt-2 text-xs text-slate-600">{meta.sellerHint}</p>}

        {actions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.next}
                variant={action.next === 'rejected' ? 'danger' : 'primary'}
                loading={busy === action.next}
                onClick={() => changeStatus(action.next)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
        {order.fulfillmentType === 'pickup' && order.status === 'ready_for_pickup' && (
          <form onSubmit={completePickup} className="mt-4 space-y-2 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
            <p className="text-xs font-semibold text-slate-800">Customer collecting in store</p>
            <p className="text-[11px] text-slate-600">
              Ask the customer for the code on their order page, then enter it here to hand over the order.
            </p>
            {pickupError && <ErrorNote>{pickupError}</ErrorNote>}
            <div className="flex flex-wrap items-end gap-2">
              <Field
                label="Customer's code"
                value={pickupCodeInput}
                onChange={(event) => setPickupCodeInput(event.target.value)}
                autoComplete="off"
                inputMode="numeric"
                className="w-40"
              />
              <Button type="submit" loading={busy === 'complete'} disabled={pickupCodeInput.trim().length < 4}>
                Complete pickup
              </Button>
            </div>
          </form>
        )}
        {order.status === 'placed' && (
          <InfoNote className="mt-3">
            You can only move this order forward one step at a time — the server rejects invalid transitions such as
            jumping straight to delivered.
          </InfoNote>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-900">Items to pack</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                <div className="flex items-center gap-3">
                  {item.image && <img src={item.image} alt="" className="h-10 w-10 rounded object-cover" />}
                  <div>
                    <p className="font-semibold text-slate-900">{item.name}</p>
                    <p className="text-slate-500">
                      {item.quantity} × {formatINR(item.unitPrice)}
                    </p>
                  </div>
                </div>
                <span className="font-bold tabular-nums text-slate-900">{formatINR(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{formatINR(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Delivery fee collected</dt>
              <dd className="tabular-nums">{formatINR(order.deliveryFee)}</dd>
            </div>
            <div className="flex justify-between text-sm font-extrabold text-slate-900">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatINR(order.total)}</dd>
            </div>
          </dl>
        </Card>

        <div className="space-y-4">
          {order.fulfillmentType === 'pickup' ? (
            <InfoNote>
              This is a store-pickup order. No rider is involved — the customer shows you their code at the counter.
            </InfoNote>
          ) : order.pickupCode ? (
            <HandoffCode
              code={order.pickupCode}
              label="Pickup code"
              hint="Give this code to the rider. The order leaves your store only after it is verified."
              tone="warning"
            />
          ) : (
            <InfoNote>
              The pickup code appears here once this order is packed and ready for rider collection.
            </InfoNote>
          )}

          <Card className="p-5">
            <h2 className="text-sm font-bold text-slate-900">Fulfilment</h2>
            <dl className="mt-3 space-y-2 text-xs text-slate-600">
              <div className="flex items-start gap-2">
                <Truck className="mt-0.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>
                  {order.fulfillmentType === 'delivery' ? 'Home delivery' : 'Customer will pick up'}
                  {order.rider ? ` · Rider: ${order.rider.name} (${order.rider.phone})` : ''}
                </span>
              </div>
              {order.fulfillmentType === 'delivery' && order.address?.address && (
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>
                    {order.address.name}
                    <br />
                    {order.address.address}, {order.address.city} {order.address.pincode}
                  </span>
                </div>
              )}
            </dl>
            <p className="mt-3 text-[11px] text-slate-500">
              The customer’s delivery code is never shared with sellers — the rider verifies it at the doorstep.
            </p>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-bold text-slate-900">Timeline</h2>
            <ol className="mt-3 space-y-3">
              {order.timeline.map((event, index) => (
                <li key={index} className="flex gap-3 text-xs">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-slate-900">{event.note || event.event_type.replace(/_/g, ' ')}</p>
                    <p className="text-slate-500">
                      {formatDateTime(event.created_at)} · {event.actor_role}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Products & inventory                                                       */
/* -------------------------------------------------------------------------- */

export const SellerProductsPage: React.FC = () => {
  const resource = useApiResource(() => api.get<{ products: Product[] }>('/api/seller/products'), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const togglePublished = async (product: Product) => {
    setBusyId(product.id);
    try {
      await api.put(`/api/seller/products/${product.id}`, { isPublished: product.is_published !== 1 });
      toast.push({ title: product.is_published === 1 ? 'Product unpublished' : 'Product published', tone: 'success' });
      resource.reload();
    } catch (error) {
      toast.push({ title: 'Could not update product', description: errorMessage(error), tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h1"
        title="Products"
        subtitle="Publish items, keep prices and stock current — customers see changes immediately."
        action={
          <Button onClick={() => navigate('/seller/products/new')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add product
          </Button>
        }
      />

      {resource.loading && !resource.data ? (
        <Skeleton className="h-40" />
      ) : resource.error ? (
        <ErrorNote>{resource.error}</ErrorNote>
      ) : (resource.data?.products ?? []).length === 0 ? (
        <EmptyState
          icon={<Package className="h-8 w-8" aria-hidden="true" />}
          title="No products yet"
          description="Add your first product so customers can find and order it."
          action={<Button onClick={() => navigate('/seller/products/new')}>Add product</Button>}
        />
      ) : (
        <div className="grid gap-3">
          {(resource.data?.products ?? []).map((product) => (
            <Card key={product.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                {product.image ? (
                  <img src={product.image} alt="" className="h-14 w-14 rounded object-cover" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded bg-slate-100 text-slate-300">
                    <Package className="h-5 w-5" aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/seller/products/${product.id}`} className="text-sm font-bold text-slate-900 hover:text-blue-700">
                      {product.name}
                    </Link>
                    <Badge tone={product.is_published === 1 ? 'success' : 'neutral'}>
                      {product.is_published === 1 ? 'Published' : 'Unpublished'}
                    </Badge>
                    {(product.sellable ?? product.stock) <= 0 && <Badge tone="danger">Out of stock</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {product.category} · {formatINR(product.price)} · {product.sellable ?? product.stock} sellable
                    {product.reserved_quantity ? ` (${product.reserved_quantity} held)` : ''}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => navigate(`/seller/products/${product.id}`)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busyId === product.id}
                  onClick={() => togglePublished(product)}
                >
                  {product.is_published === 1 ? 'Unpublish' : 'Publish'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export const ProductEditorPage: React.FC<{ productId?: string }> = ({ productId }) => {
  const isEdit = Boolean(productId);
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: 'Grocery',
    price: '',
    stock: '0',
    image: '',
    isPublished: true,
    brand: '',
    unit: '',
    mrp: '',
    sku: '',
    productInfo: '',
    availability: 'available',
    lowStockThreshold: '5',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productResource = useApiResource(
    () => api.get<{ products: Product[] }>('/api/seller/products'),
    [],
    { enabled: isEdit }
  );

  useEffect(() => {
    if (!isEdit || !productResource.data) return;
    const product = productResource.data.products.find((item) => item.id === productId);
    if (!product) return;
    setForm({
      name: product.name,
      description: product.description ?? '',
      category: product.category,
      price: String(product.price),
      stock: String(product.stock_quantity ?? product.stock),
      image: product.image ?? '',
      isPublished: product.is_published === 1,
      brand: product.brand ?? '',
      unit: product.unit ?? '',
      mrp: product.mrp != null ? String(product.mrp) : '',
      sku: product.sku ?? '',
      productInfo: product.product_info ?? '',
      availability: product.availability ?? 'available',
      lowStockThreshold: String(product.low_stock_threshold ?? 5),
    });
  }, [isEdit, productId, productResource.data]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const payload = {
      name: form.name,
      description: form.description,
      category: form.category,
      price: Number(form.price),
      stock: Number(form.stock),
      image: form.image || undefined,
      isPublished: form.isPublished,
      brand: form.brand,
      unit: form.unit,
      mrp: form.mrp === '' ? null : Number(form.mrp),
      sku: form.sku,
      productInfo: form.productInfo,
      availability: form.availability,
      lowStockThreshold: Number(form.lowStockThreshold || 0),
    };
    try {
      if (isEdit) {
        await api.put(`/api/seller/products/${productId}`, payload);
        toast.push({ title: 'Product updated', tone: 'success' });
      } else {
        await api.post('/api/seller/products', payload);
        toast.push({ title: 'Product published to your store', tone: 'success' });
      }
      navigate('/seller/products');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await api.post<{ url: string }>('/api/seller/uploads', { dataUrl: reader.result });
        setForm((current) => ({ ...current, image: result.url }));
        toast.push({ title: 'Image uploaded', tone: 'success' });
      } catch (caught) {
        toast.push({ title: 'Upload failed', description: errorMessage(caught), tone: 'error' });
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <SectionHeader
        as="h1"
        title={isEdit ? 'Edit product' : 'Add a product'}
        subtitle="Prices are in ₹ and stock is what customers can buy right now."
        action={
          <Button variant="secondary" onClick={() => navigate('/seller/products')}>
            Back to products
          </Button>
        }
      />

      <Card className="p-6">
        <form onSubmit={save} className="space-y-4">
          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Product name"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Amul Taaza Milk 1L"
            />
            <SelectField
              label="Category"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
              options={[
                'Grocery',
                'Fruits & Vegetables',
                'Dairy',
                'Bakery',
                'Snacks',
                'Beverages',
                'Personal Care',
                'Household',
                'Stationery',
                'Pharmacy',
                'Staples & Grains',
                'Oils & Ghee',
                'Frozen Foods',
              ].map((value) => ({ value, label: value }))}
            />
            <Field
              label="Price (₹)"
              required
              type="number"
              min={0.5}
              step="0.5"
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
              placeholder="68"
            />
            <Field
              label="Stock quantity"
              required
              type="number"
              min={0}
              value={form.stock}
              onChange={(event) => setForm({ ...form, stock: event.target.value })}
              hint="Cannot be set below units already held for confirmed reservations."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="MRP (₹, optional)"
              type="number"
              min={0.5}
              step="0.5"
              value={form.mrp}
              onChange={(event) => setForm({ ...form, mrp: event.target.value })}
              hint="Must not be lower than the selling price."
            />
            <Field
              label="Low-stock alert at (units)"
              type="number"
              min={0}
              value={form.lowStockThreshold}
              onChange={(event) => setForm({ ...form, lowStockThreshold: event.target.value })}
            />
            <Field
              label="Brand (optional)"
              value={form.brand}
              onChange={(event) => setForm({ ...form, brand: event.target.value })}
              placeholder="Amul"
            />
            <Field
              label="Unit / pack size (optional)"
              value={form.unit}
              onChange={(event) => setForm({ ...form, unit: event.target.value })}
              placeholder="1 L"
            />
            <Field
              label="SKU (optional)"
              value={form.sku}
              onChange={(event) => setForm({ ...form, sku: event.target.value })}
            />
            <SelectField
              label="Availability"
              value={form.availability}
              onChange={(event) => setForm({ ...form, availability: event.target.value })}
              options={[
                { value: 'available', label: 'Available to order' },
                { value: 'unavailable', label: 'Marked unavailable' },
              ]}
            />
          </div>

          <TextAreaField
            label="Description"
            rows={3}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Homogenised toned milk, rich in calcium."
          />
          <TextAreaField
            label="Product information (optional)"
            rows={2}
            value={form.productInfo}
            onChange={(event) => setForm({ ...form, productInfo: event.target.value })}
            placeholder="Storage, ingredients, shelf life…"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Image URL (optional)"
              value={form.image}
              onChange={(event) => setForm({ ...form, image: event.target.value })}
              placeholder="/images/amul-taaza-milk-1l.jpg"
              hint="Paste a URL or upload a file below."
            />
            <div className="text-xs">
              <label htmlFor="product-image" className="mb-1 block font-semibold text-slate-700">
                Upload image (PNG/JPEG/WEBP, max 4 MB)
              </label>
              <input
                id="product-image"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
          </div>

          {form.image && (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
              <img src={form.image} alt="" className="h-16 w-16 rounded object-cover" />
              <span className="text-xs text-slate-500">Current image</span>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(event) => setForm({ ...form, isPublished: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Publish this product to customers
          </label>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="ghost" type="button" onClick={() => navigate('/seller/products')}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {isEdit ? 'Save changes' : 'Publish product'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export const SellerInventoryPage: React.FC = () => {
  const resource = useApiResource(
    () =>
      api.get<{
        inventory: Product[];
        summary: { products: number; units: number; reserved: number; lowStock: number };
      }>('/api/seller/inventory'),
    []
  );
  const toast = useToast();
  const [editing, setEditing] = useState<Product | null>(null);
  const [value, setValue] = useState(0);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');
  const [eventPage, setEventPage] = useState(1);
  const eventsResource = useApiResource(
    () =>
      api.get<{ events: InventoryEvent[]; total: number; hasMore: boolean }>(
        `/api/seller/inventory/events?pageSize=${eventPage * 15}`
      ),
    [eventPage]
  );

  const summary = resource.data?.summary;

  const [mode, setMode] = useState<'set' | 'delta'>('set');
  const nextStock = mode === 'set' ? value : (editing?.stock_quantity ?? 0) + value;

  const adjust = async () => {
    if (!editing) return;
    if (nextStock < 0) return;
    setSaving(true);
    try {
      const result = await api.post<{ message: string }>(`/api/seller/products/${editing.id}/stock`, {
        mode,
        value,
        reason: reason || undefined,
      });
      toast.push({ title: 'Stock updated', description: result.message, tone: 'success' });
      setEditing(null);
      setReason('');
      resource.reload();
      eventsResource.reload();
    } catch (error) {
      toast.push({ title: 'Could not update stock', description: errorMessage(error), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (resource.loading && !resource.data) return <Spinner label="Loading inventory…" />;

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h1"
        title="Inventory"
        subtitle="Sellable stock excludes units already held for confirmed customer reservations."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Products" value={summary?.products ?? 0} />
        <StatCard label="Units on shelf" value={summary?.units ?? 0} />
        <StatCard label="Units held" value={summary?.reserved ?? 0} hint="Confirmed reservations" />
        <StatCard label="Low stock" value={summary?.lowStock ?? 0} />
      </div>

      {(resource.data?.inventory ?? []).length === 0 ? (
        <EmptyState title="No products to track yet" description="Add products to manage inventory." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <caption className="sr-only">Inventory by product</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">Product</th>
                <th scope="col" className="px-4 py-2">Price</th>
                <th scope="col" className="px-4 py-2">On shelf</th>
                <th scope="col" className="px-4 py-2">Held</th>
                <th scope="col" className="px-4 py-2">Sellable</th>
                <th scope="col" className="px-4 py-2 text-right">Update</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(resource.data?.inventory ?? []).map((product) => (
                <tr key={product.id}>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-slate-900">{product.name}</span>
                    <span className="block text-[11px] text-slate-500">{product.category}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{formatINR(product.price)}</td>
                  <td className="px-4 py-3 tabular-nums">{product.stock_quantity}</td>
                  <td className="px-4 py-3 tabular-nums">{product.reserved_quantity ?? 0}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-semibold tabular-nums ${
                        (product.sellable ?? 0) <= 0 ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    >
                      {product.sellable ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditing(product);
                        setMode('set');
                        setValue(product.stock_quantity ?? 0);
                      }}
                    >
                      Adjust
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Stock for ${editing?.name ?? ''}`}
        description="Set the exact shelf count, or add / remove units. Every change is logged."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={nextStock < 0} onClick={adjust}>
              Save stock
            </Button>
          </>
        }
      >
        <p className="text-xs text-slate-600">
          Currently {editing?.stock_quantity} on shelf, {editing?.reserved_quantity ?? 0} held for reservations.
        </p>
        <div className="flex gap-2" role="group" aria-label="Adjustment type">
          {(['set', 'delta'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => {
                setMode(option);
                setValue(option === 'set' ? (editing?.stock_quantity ?? 0) : 0);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                mode === option ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'
              }`}
            >
              {option === 'set' ? 'Set exact count' : 'Add / remove units'}
            </button>
          ))}
        </div>
        <Field
          label={mode === 'set' ? 'New shelf quantity' : 'Change by (use − to remove)'}
          type="number"
          min={mode === 'set' ? 0 : undefined}
          value={String(value)}
          onChange={(event) => setValue(Number(event.target.value))}
          className="w-40"
        />
        <Field
          label="Reason (optional)"
          value={reason}
          maxLength={160}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Stock count, damaged, restock…"
        />
        <p className={`text-xs font-semibold ${nextStock < 0 ? 'text-red-600' : 'text-slate-700'}`}>
          {nextStock < 0 ? 'Stock cannot go below zero.' : `New shelf quantity: ${nextStock}`}
        </p>
        <InfoNote>
          Stock can never be set below the quantity already held for confirmed reservations, and cannot go negative.
        </InfoNote>
      </Modal>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-900">Stock activity</h2>
        <p className="mt-0.5 text-xs text-slate-500">Sales, cancellations, restocks and manual changes, newest first.</p>
        {eventsResource.loading && !eventsResource.data ? (
          <Spinner label="Loading stock activity…" />
        ) : (eventsResource.data?.events ?? []).length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">No stock activity recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {(eventsResource.data?.events ?? []).map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{event.product_name}</p>
                  <p className="text-slate-500">
                    {event.type.replace(/_/g, ' ')}
                    {event.note ? ` · ${event.note}` : ''} · {formatDateTime(event.created_at)}
                  </p>
                </div>
                <div className="text-right tabular-nums">
                  <p className={`font-bold ${event.delta < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {event.delta > 0 ? '+' : ''}
                    {event.delta}
                  </p>
                  <p className="text-[11px] text-slate-500">now {event.resulting_stock}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {eventsResource.data?.hasMore && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setEventPage((page) => page + 1)}>
            Show more
          </Button>
        )}
      </Card>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Requests (stock checks + reservations)                                     */
/* -------------------------------------------------------------------------- */

export const SellerRequestsPage: React.FC<{ view?: 'all' | 'stock' | 'reservations' }> = ({ view = 'all' }) => {
  const stockResource = useApiResource(() => api.get<{ requests: StockRequest[] }>('/api/seller/stock-requests'), [], {
    pollMs: 20000,
  });
  const reservationResource = useApiResource(
    () => api.get<{ reservations: Reservation[] }>('/api/seller/reservations'),
    [],
    { pollMs: 20000 }
  );
  const toast = useToast();
  const [respondModal, setRespondModal] = useState<{ type: 'stock' | 'reservation'; id: string; name: string; action: string } | null>(null);
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);

  const submitResponse = async () => {
    if (!respondModal) return;
    setBusy(true);
    try {
      if (respondModal.type === 'stock') {
        await api.put(`/api/seller/stock-requests/${respondModal.id}`, {
          status: respondModal.action,
          sellerResponse: response || undefined,
        });
      } else {
        await api.put(`/api/seller/reservations/${respondModal.id}`, {
          action: respondModal.action,
          sellerResponse: response || undefined,
        });
      }
      toast.push({
        title: 'Response sent',
        description:
          respondModal.action === 'confirm'
            ? 'Stock is now held for this customer until the hold expires.'
            : 'The customer will see your response.',
        tone: 'success',
      });
      setRespondModal(null);
      setResponse('');
      stockResource.reload();
      reservationResource.reload();
    } catch (error) {
      toast.push({ title: 'Could not send response', description: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <SectionHeader
        as="h1"
        title={view === 'stock' ? 'Stock requests' : view === 'reservations' ? 'Reservations' : 'Customer requests'}
        subtitle={
          view === 'stock'
            ? 'Customers asking whether an item is available. Confirming availability does not hold stock.'
            : view === 'reservations'
              ? 'Confirming a reservation holds stock for the customer until it expires or is fulfilled.'
              : 'Answer stock checks and reserve stock for customers who asked first.'
        }
      />

      {view !== 'stock' && (
      <section aria-labelledby="seller-reservations" className="space-y-3">
        <h2 id="seller-reservations" className="text-sm font-bold text-slate-900">
          Reservations
        </h2>
        {reservationResource.loading && !reservationResource.data ? (
          <Skeleton className="h-24" />
        ) : (reservationResource.data?.reservations ?? []).length === 0 ? (
          <EmptyState title="No reservation requests" description="Customers can request a hold from any product page." />
        ) : (
          <div className="space-y-3">
            {(reservationResource.data?.reservations ?? []).map((reservation) => {
              const meta = statusMeta(RESERVATION_STATUS, reservation.status);
              return (
                <Card key={reservation.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{reservation.product_name}</p>
                      <p className="text-xs text-slate-500">
                        {reservation.customer_name} · {reservation.customer_phone} · {reservation.requested_quantity} unit(s)
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Requested {formatDateTime(reservation.requested_at)} ·{' '}
                        {reservation.stock_quantity} on shelf · {reservation.sellable} sellable
                      </p>
                      {reservation.note && (
                        <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                          Customer note: “{reservation.note}”
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {reservation.holds_stock === 1 && reservation.expires_at && (
                        <p className="mt-1 text-[11px] text-slate-500">Held until {formatDateTime(reservation.expires_at)}</p>
                      )}
                    </div>
                  </div>
                  {['pending', 'confirmed'].includes(reservation.status) && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      <Button
                        size="sm"
                        onClick={() =>
                          setRespondModal({
                            type: 'reservation',
                            id: reservation.id,
                            name: reservation.product_name,
                            action: 'confirm',
                          })
                        }
                      >
                        Confirm &amp; hold stock
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setRespondModal({
                            type: 'reservation',
                            id: reservation.id,
                            name: reservation.product_name,
                            action: 'fulfil',
                          })
                        }
                      >
                        Mark fulfilled
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() =>
                          setRespondModal({
                            type: 'reservation',
                            id: reservation.id,
                            name: reservation.product_name,
                            action: 'reject',
                          })
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      )}

      {view !== 'reservations' && (
      <section aria-labelledby="seller-stock-requests" className="space-y-3">
        <h2 id="seller-stock-requests" className="text-sm font-bold text-slate-900">
          Stock checks
        </h2>
        {stockResource.loading && !stockResource.data ? (
          <Skeleton className="h-24" />
        ) : (stockResource.data?.requests ?? []).length === 0 ? (
          <EmptyState title="No stock checks" description="Customers can ask whether an item is available before ordering." />
        ) : (
          <div className="space-y-3">
            {(stockResource.data?.requests ?? []).map((request) => {
              const meta = statusMeta(STOCK_REQUEST_STATUS, request.status);
              return (
                <Card key={request.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{request.product_name}</p>
                      <p className="text-xs text-slate-500">
                        {request.customer_name} · {request.requested_quantity} unit(s) · {formatDateTime(request.created_at)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {request.stock_quantity} on shelf · {request.sellable} sellable
                      </p>
                      {request.note && (
                        <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                          Customer note: “{request.note}”
                        </p>
                      )}
                    </div>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  {request.status === 'pending' && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      <Button
                        size="sm"
                        onClick={() =>
                          setRespondModal({ type: 'stock', id: request.id, name: request.product_name, action: 'confirmed' })
                        }
                      >
                        Confirm available
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() =>
                          setRespondModal({ type: 'stock', id: request.id, name: request.product_name, action: 'unavailable' })
                        }
                      >
                        Mark unavailable
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>
      )}

      <Modal
        open={respondModal !== null}
        onClose={() => setRespondModal(null)}
        title={`Respond about ${respondModal?.name ?? ''}`}
        description={
          respondModal?.type === 'reservation'
            ? 'Confirming a reservation genuinely holds stock in your inventory until it expires or is fulfilled.'
            : 'A confirmed stock check tells the customer the item is available. It does not hold stock.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setRespondModal(null)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={submitResponse}>
              Send response
            </Button>
          </>
        }
      >
        <TextAreaField
          label="Note to the customer (optional)"
          rows={3}
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          placeholder="e.g. Available behind the counter, ask for Rahul"
        />
      </Modal>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Store settings & performance                                               */
/* -------------------------------------------------------------------------- */

const StoreStatusCard: React.FC<{ store: Store; onChanged: () => void }> = ({ store, onChanged }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(store.status_message ?? '');
  const [closureType, setClosureType] = useState(store.closure_type ?? 'closed');
  const isOpen = store.status === 'open';

  const update = async (status: 'open' | 'closed') => {
    setBusy(true);
    try {
      const result = await api.put<{ message: string }>('/api/seller/store/status', {
        status,
        closureType: status === 'closed' ? closureType : undefined,
        message: status === 'closed' ? message : undefined,
      });
      toast.push({ title: status === 'open' ? 'Store is open' : 'Store is closed', description: result.message, tone: 'success' });
      onChanged();
    } catch (error) {
      toast.push({ title: 'Could not update store status', description: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Store status</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            {isOpen
              ? 'Open — customers can place new orders.'
              : 'Closed — customers can browse but cannot check out. Orders already placed stay active.'}
          </p>
        </div>
        <Badge tone={isOpen ? 'success' : 'warning'}>{isOpen ? 'Open' : 'Closed'}</Badge>
      </div>
      {!isOpen && store.status_message && <p className="mt-2 text-xs text-slate-500">Shown to customers: “{store.status_message}”</p>}
      {isOpen ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <SelectField
            label="Close as"
            value={closureType}
            onChange={(event) => setClosureType(event.target.value)}
            options={[
              { value: 'closed', label: 'Closed for now' },
              { value: 'temporarily_unavailable', label: 'Temporarily unavailable' },
            ]}
          />
          <Field
            label="Message for customers (optional)"
            value={message}
            maxLength={160}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Back at 5 pm"
          />
          <Button variant="secondary" loading={busy} onClick={() => update('closed')}>
            Close store
          </Button>
        </div>
      ) : (
        <Button className="mt-4" loading={busy} onClick={() => update('open')}>
          Open store
        </Button>
      )}
    </Card>
  );
};

const StoreFulfilmentCard: React.FC<{ store: Store; onChanged: () => void }> = ({ store, onChanged }) => {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    supportsDelivery: store.supports_delivery !== 0,
    supportsPickup: store.supports_pickup !== 0,
    supportsReservations: store.supports_reservations !== 0,
    fulfilmentMinMinutes: store.fulfilment_min_minutes != null ? String(store.fulfilment_min_minutes) : '',
    fulfilmentMaxMinutes: store.fulfilment_max_minutes != null ? String(store.fulfilment_max_minutes) : '',
    supportPhone: store.support_phone ?? '',
    businessEmail: store.business_email ?? '',
    legalName: store.legal_name ?? '',
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.put('/api/seller/store/settings', {
        ...form,
        fulfilmentMinMinutes: form.fulfilmentMinMinutes === '' ? null : Number(form.fulfilmentMinMinutes),
        fulfilmentMaxMinutes: form.fulfilmentMaxMinutes === '' ? null : Number(form.fulfilmentMaxMinutes),
      });
      toast.push({ title: 'Fulfilment settings saved', tone: 'success' });
      onChanged();
    } catch (error) {
      toast.push({ title: 'Could not save settings', description: errorMessage(error), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const check = (key: 'supportsDelivery' | 'supportsPickup' | 'supportsReservations', label: string) => (
    <label className="flex items-center gap-2 text-xs text-slate-700">
      <input
        type="checkbox"
        checked={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.checked })}
        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
      />
      {label}
    </label>
  );

  return (
    <Card className="p-5">
      <h2 className="text-sm font-bold text-slate-900">Fulfilment &amp; business details</h2>
      <form onSubmit={save} className="mt-3 space-y-4">
        <div className="space-y-2">
          {check('supportsDelivery', 'Offer home delivery')}
          {check('supportsPickup', 'Offer store pickup')}
          {check('supportsReservations', 'Accept reservation requests')}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Minimum prep time (minutes)"
            type="number"
            min={5}
            max={480}
            value={form.fulfilmentMinMinutes}
            onChange={(event) => setForm({ ...form, fulfilmentMinMinutes: event.target.value })}
          />
          <Field
            label="Maximum prep time (minutes)"
            type="number"
            min={5}
            max={480}
            value={form.fulfilmentMaxMinutes}
            onChange={(event) => setForm({ ...form, fulfilmentMaxMinutes: event.target.value })}
          />
          <Field
            label="Legal / business name"
            value={form.legalName}
            onChange={(event) => setForm({ ...form, legalName: event.target.value })}
          />
          <Field
            label="Business email"
            type="email"
            value={form.businessEmail}
            onChange={(event) => setForm({ ...form, businessEmail: event.target.value })}
          />
          <Field
            label="Support phone"
            value={form.supportPhone}
            onChange={(event) => setForm({ ...form, supportPhone: event.target.value })}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="secondary" loading={saving}>
            Save fulfilment settings
          </Button>
        </div>
      </form>
    </Card>
  );
};

export const SellerStorePage: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: 'Grocery',
    address: '',
    city: 'Dwarka, New Delhi',
    state: 'Delhi',
    pincode: '',
    contactPhone: user?.phone ?? '',
    opensAt: '07:00',
    closesAt: '22:00',
    operatingDays: 'Mon-Sun',
    latitude: '',
    longitude: '',
    image: '',
    status: 'open',
    supportsDelivery: true,
    supportsPickup: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storeResource = useApiResource(() => api.get<{ store: Store | null }>('/api/seller/store'), []);

  useEffect(() => {
    const store = storeResource.data?.store;
    if (!store) return;
    setForm({
      name: store.name,
      description: store.description ?? '',
      category: store.category,
      address: store.address,
      city: store.city,
      state: store.state,
      pincode: store.pincode,
      contactPhone: store.contact_phone ?? user?.phone ?? '',
      opensAt: store.opens_at ?? '07:00',
      closesAt: store.closes_at ?? '22:00',
      operatingDays: store.operating_days ?? 'Mon-Sun',
      latitude: store.latitude != null ? String(store.latitude) : '',
      longitude: store.longitude != null ? String(store.longitude) : '',
      image: store.image ?? '',
      status: store.status,
      supportsDelivery: store.supports_delivery !== 0,
      supportsPickup: store.supports_pickup !== 0,
    });
  }, [storeResource.data, user]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post('/api/seller/store', {
        ...form,
        status: undefined,
        latitude: form.latitude ? Number(form.latitude) : undefined,
        longitude: form.longitude ? Number(form.longitude) : undefined,
        image: form.image || undefined,
      });
      toast.push({ title: 'Store saved', tone: 'success' });
      storeResource.reload();
      notifyStoreChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (publish: boolean) => {
    try {
      await api.post(publish ? '/api/seller/store/publish' : '/api/seller/store/unpublish');
      toast.push({ title: publish ? 'Store published' : 'Store hidden from discovery', tone: 'success' });
      storeResource.reload();
      notifyStoreChanged();
    } catch (error) {
      toast.push({ title: 'Could not update store', description: errorMessage(error), tone: 'error' });
    }
  };

  if (storeResource.loading && !storeResource.data) return <Spinner label="Loading store profile…" />;

  const store = storeResource.data?.store;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <SectionHeader
        as="h1"
        title={store ? 'Store settings' : 'Create your store'}
        subtitle="Published stores become discoverable to customers immediately."
        action={
          store && (
            <Button variant={store.status === 'inactive' ? 'primary' : 'secondary'} onClick={() => togglePublish(store.status === 'inactive')}>
              {store.status === 'inactive' ? 'Publish store' : 'Hide from discovery'}
            </Button>
          )
        }
      />

      {store && store.status === 'inactive' && (
        <InfoNote>Your store is currently hidden. Customers cannot find or order from it.</InfoNote>
      )}

      {store && store.status !== 'inactive' && <StoreStatusCard store={store} onChanged={() => { storeResource.reload(); notifyStoreChanged(); }} />}
      {store && <StoreFulfilmentCard store={store} onChanged={() => storeResource.reload()} />}

      <Card className="p-6">
        <form onSubmit={save} className="space-y-4">
          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Store name"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Dwarka Fresh Mart"
            />
            <SelectField
              label="Store category"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
              options={[
                'Grocery',
                'Fruits & Vegetables',
                'Dairy',
                'Bakery',
                'Snacks',
                'Beverages',
                'Pharmacy',
                'Personal Care',
                'Household',
                'Stationery',
              ].map((value) => ({ value, label: value }))}
            />
          </div>

          <TextAreaField
            label="Description"
            rows={3}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Trusted neighbourhood supermarket for fresh dairy, staples and daily essentials."
          />

          <Field
            label="Address"
            required
            value={form.address}
            onChange={(event) => setForm({ ...form, address: event.target.value })}
            placeholder="Shop 14-16, Vardhman City Mall, Sector 12"
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="City / locality"
              value={form.city}
              onChange={(event) => setForm({ ...form, city: event.target.value })}
            />
            <Field label="State" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} />
            <Field
              label="Pincode"
              required
              value={form.pincode}
              onChange={(event) => setForm({ ...form, pincode: event.target.value })}
              placeholder="110078"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Opens at"
              value={form.opensAt}
              onChange={(event) => setForm({ ...form, opensAt: event.target.value })}
              placeholder="07:00"
            />
            <Field
              label="Closes at"
              value={form.closesAt}
              onChange={(event) => setForm({ ...form, closesAt: event.target.value })}
              placeholder="22:00"
            />
            <Field
              label="Operating days"
              value={form.operatingDays}
              onChange={(event) => setForm({ ...form, operatingDays: event.target.value })}
              placeholder="Mon-Sun"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Latitude (optional)"
              value={form.latitude}
              onChange={(event) => setForm({ ...form, latitude: event.target.value })}
              placeholder="28.5921"
            />
            <Field
              label="Longitude (optional)"
              value={form.longitude}
              onChange={(event) => setForm({ ...form, longitude: event.target.value })}
              placeholder="77.0460"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Store contact number"
              value={form.contactPhone}
              onChange={(event) => setForm({ ...form, contactPhone: event.target.value })}
              placeholder="+91 98112 34567"
            />
            <Field
              label="Store image URL"
              value={form.image}
              onChange={(event) => setForm({ ...form, image: event.target.value })}
              placeholder="/images/store-dwarka-fresh-mart.jpg"
            />
          </div>

          <fieldset className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-700">Fulfilment options you support</legend>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={form.supportsDelivery}
                onChange={(event) => setForm({ ...form, supportsDelivery: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Home delivery (₹30 flat per order)
            </label>
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={form.supportsPickup}
                onChange={(event) => setForm({ ...form, supportsPickup: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Customer pickup at store
            </label>
          </fieldset>

          <div className="flex justify-end border-t border-slate-100 pt-4">
            <Button type="submit" loading={saving}>
              {store ? 'Save store settings' : 'Create store'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export const SellerPerformancePage: React.FC = () => {
  const resource = useApiResource(
    () =>
      api.get<{
        totals: { orders: number; delivered: number; cancelled: number; subtotal: number } | null;
        topProducts: { name: string; units: number; revenue: number }[];
        daily: { day: string; orders: number; revenue: number }[];
      }>('/api/seller/analytics'),
    []
  );

  const totals = useMemo(() => resource.data?.totals ?? null, [resource.data]);

  if (resource.loading && !resource.data) return <Spinner label="Loading performance…" />;
  if (resource.error) return <ErrorNote>{resource.error}</ErrorNote>;

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h1"
        title="Performance"
        subtitle="All figures come straight from your persisted orders — no estimated or placeholder analytics."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Orders" value={totals?.orders ?? 0} />
        <StatCard label="Delivered" value={totals?.delivered ?? 0} icon={<PackageCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />} />
        <StatCard label="Cancelled/rejected" value={totals?.cancelled ?? 0} />
        <StatCard label="Item revenue" value={formatINR(totals?.subtotal ?? 0)} icon={<BarChart3 className="h-4 w-4 text-slate-400" aria-hidden="true" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-900">Top products</h2>
          {(resource.data?.topProducts ?? []).length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No sales recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {(resource.data?.topProducts ?? []).map((product) => (
                <li key={product.name} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-800">{product.name}</span>
                  <span className="tabular-nums text-slate-600">
                    {product.units} units · {formatINR(product.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-900">Last 14 days</h2>
          {(resource.data?.daily ?? []).length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No orders in this period.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {(resource.data?.daily ?? []).map((row) => (
                <li key={row.day} className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 text-slate-600">
                    <Clock className="h-3 w-3 text-slate-400" aria-hidden="true" />
                    {row.day}
                  </span>
                  <span className="tabular-nums text-slate-600">
                    {row.orders} order(s) · {formatINR(row.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <SuccessNote>
        Tip: answering stock checks quickly and keeping inventory accurate are the two biggest drivers of repeat orders.
      </SuccessNote>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Earnings                                                                   */
/* -------------------------------------------------------------------------- */

interface SellerEarnings {
  summary: {
    today: number;
    week: number;
    month: number;
    gross: number;
    platformFeePercent: number;
    platformFee: number;
    net: number;
    paidOut: number;
    pendingPayout: number;
  } | null;
  settlements: {
    id: string;
    period_start: string;
    period_end: string;
    amount: number;
    status: string;
    reference: string | null;
    created_at: string;
    paid_at: string | null;
  }[];
  recent: { id: string; order_number: string; subtotal: number; fee: number; net: number; delivered_at: string }[];
}

export const SellerEarningsPage: React.FC = () => {
  const resource = useApiResource(() => api.get<SellerEarnings>('/api/seller/earnings'), [], { pollMs: 60000 });
  if (resource.loading && !resource.data) return <Spinner label="Loading earnings…" />;
  if (resource.error) return <ErrorNote>{resource.error}</ErrorNote>;
  const data = resource.data;
  const summary = data?.summary;

  if (!summary) {
    return (
      <EmptyState
        title="No earnings yet"
        description="Earnings are calculated from delivered orders once your store is live."
        action={<Button onClick={() => navigate('/seller/store')}>Set up your store</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h1"
        title="Earnings"
        subtitle="Calculated from delivered orders only. Customer delivery fees go to the rider and are not included."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Today" value={formatINR(summary.today)} />
        <StatCard label="This week" value={formatINR(summary.week)} />
        <StatCard label="This month" value={formatINR(summary.month)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Gross sales" value={formatINR(summary.gross)} hint="All delivered orders" />
        <StatCard
          label={`Platform fee (${summary.platformFeePercent}%)`}
          value={formatINR(summary.platformFee)}
        />
        <StatCard label="Net earnings" value={formatINR(summary.net)} />
        <StatCard
          label="Pending payout"
          value={formatINR(summary.pendingPayout)}
          hint={`Paid out so far: ${formatINR(summary.paidOut)}`}
        />
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-900">Recent delivered orders</h2>
        {data!.recent.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">Nothing delivered yet — your first completed order will appear here.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-xs">
              <caption className="sr-only">Recent delivered orders and earnings</caption>
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="py-2 pr-3">Order</th>
                  <th scope="col" className="py-2 pr-3">Delivered</th>
                  <th scope="col" className="py-2 pr-3 text-right">Sales</th>
                  <th scope="col" className="py-2 pr-3 text-right">Fee</th>
                  <th scope="col" className="py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data!.recent.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-3 font-semibold text-slate-900">
                      <Link to={`/seller/orders/${row.id}`} className="hover:text-blue-700">
                        {row.order_number}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{formatDateTime(row.delivered_at)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatINR(row.subtotal)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatINR(row.fee)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{formatINR(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-900">Settlements</h2>
        {data!.settlements.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">No settlements have been issued for your store yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {data!.settlements.map((settlement) => (
              <li key={settlement.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <div>
                  <p className="font-semibold text-slate-900">
                    {settlement.period_start} – {settlement.period_end}
                  </p>
                  <p className="text-slate-500">{settlement.reference ?? 'Reference pending'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold tabular-nums">{formatINR(settlement.amount)}</span>
                  <Badge tone={settlement.status === 'paid' ? 'success' : 'warning'}>{settlement.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};
