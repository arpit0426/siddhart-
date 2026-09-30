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
import { formatDateTime, formatINR, orderStatusMeta, statusMeta, RESERVATION_STATUS, STOCK_REQUEST_STATUS } from '../lib/format';
import type { Order, Product, Reservation, StockRequest, Store } from '../types';

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
  lowStock: { id: string; name: string; stock_quantity: number; reserved_quantity: number }[];
}

export const SellerDashboardPage: React.FC = () => {
  const resource = useApiResource(() => api.get<SellerDashboard>('/api/seller/dashboard'), [], { pollMs: 20000 });

  if (resource.loading && !resource.data) return <Spinner label="Loading your store dashboard…" />;
  if (resource.error) return <ErrorNote>{resource.error}</ErrorNote>;
  if (!resource.data) return null;

  const { store, metrics, actionRequired, recentOrders, lowStock } = resource.data;

  if (!store) {
    return (
      <EmptyState
        icon={<StoreIcon className="h-8 w-8" aria-hidden="true" />}
        title="Set up your store"
        description="Create your store profile first — customers can only discover you once it is published."
        action={<Button onClick={() => navigate('/seller/store')}>Create store profile</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h1"
        title={store.name}
        subtitle={`${store.city} · ${store.status === 'open' ? 'Open for orders' : 'Not accepting orders'}`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/seller/orders')}>
              Open order queue
            </Button>
            <Button onClick={() => navigate('/seller/products/new')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add product
            </Button>
          </div>
        }
      />

      <section aria-labelledby="action-required" className="space-y-3">
        <h2 id="action-required" className="text-sm font-bold text-slate-900">
          Action required
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="New orders"
            value={actionRequired?.newOrders ?? 0}
            hint="Waiting for you to accept"
            icon={<Package className="h-4 w-4 text-amber-600" aria-hidden="true" />}
          />
          <StatCard
            label="Stock checks"
            value={actionRequired?.pendingStockRequests ?? 0}
            hint="Customer questions to answer"
          />
          <StatCard
            label="Reservations"
            value={actionRequired?.pendingReservations ?? 0}
            hint="Confirm to hold stock"
          />
          <StatCard
            label="Ready for pickup"
            value={actionRequired?.readyForPickup ?? 0}
            hint="Waiting for a rider"
            icon={<Truck className="h-4 w-4 text-indigo-600" aria-hidden="true" />}
          />
        </div>
      </section>

      <section aria-labelledby="operations" className="space-y-3">
        <h2 id="operations" className="text-sm font-bold text-slate-900">
          Current operations
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="In progress" value={actionRequired?.inProgress ?? 0} hint="Accepted / preparing" />
          <StatCard label="Packed, awaiting pickup" value={actionRequired?.packedAwaitingPickup ?? 0} hint="Mark ready when a rider can collect" />
          <StatCard label="Units held for reservations" value={metrics?.heldUnits ?? 0} hint="Reserved in your inventory" />
          <StatCard
            label="Low stock items"
            value={lowStock.length}
            hint="At or below your threshold"
            icon={<AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />}
          />
        </div>
      </section>

      <section aria-labelledby="business" className="space-y-3">
        <h2 id="business" className="text-sm font-bold text-slate-900">
          Business (all-time, from real orders)
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Orders" value={metrics?.totalOrders ?? 0} hint={`${metrics?.delivered ?? 0} delivered`} />
          <StatCard label="Item revenue" value={formatINR(metrics?.subtotalRevenue ?? 0)} hint="Excludes delivery fees" />
          <StatCard label="Order value (incl. delivery)" value={formatINR(metrics?.revenue ?? 0)} />
          <StatCard label="Today" value={formatINR(metrics?.todayRevenue ?? 0)} hint={`${metrics?.todayOrders ?? 0} order(s)`} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Latest orders</h2>
            <Link to="/seller/orders" className="text-xs font-semibold text-blue-700 hover:underline">
              View all
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No orders yet. New orders appear here instantly.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {recentOrders.map((order) => {
                const meta = orderStatusMeta(order.status);
                return (
                  <li key={order.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                    <div>
                      <Link to={`/seller/orders/${order.id}`} className="font-semibold text-slate-900 hover:text-blue-700">
                        {order.orderNumber}
                      </Link>
                      <p className="text-slate-500">
                        {order.customer?.name} · {order.items.length} item(s) · {formatDateTime(order.createdAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <p className="mt-1 font-semibold tabular-nums text-slate-900">{formatINR(order.total)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-900">Low stock</h2>
          {lowStock.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">All products are comfortably in stock.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {lowStock.map((item) => (
                <li key={item.id} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                  <span className="font-medium text-amber-900">{item.name}</span>
                  <span className="tabular-nums text-amber-900">
                    {item.stock_quantity} on shelf{item.reserved_quantity > 0 ? ` · ${item.reserved_quantity} held` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => navigate('/seller/inventory')}>
            Manage inventory
          </Button>
        </Card>
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

export const SellerOrdersPage: React.FC = () => {
  const params = useQueryParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const resource = useApiResource(
    () => api.get<{ orders: Order[] }>(`/api/seller/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    [status],
    { pollMs: 15000 }
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h1"
        title="Orders"
        subtitle="Accept, prepare, pack and hand over. Every transition is validated by the server."
        action={
          <SelectField
            label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={[
              { value: '', label: 'All orders' },
              { value: 'placed', label: 'New (placed)' },
              { value: 'accepted', label: 'Accepted' },
              { value: 'preparing', label: 'Preparing' },
              { value: 'packed', label: 'Packed' },
              { value: 'ready_for_pickup', label: 'Ready for pickup' },
              { value: 'out_for_delivery', label: 'Out for delivery' },
              { value: 'delivered', label: 'Delivered' },
              { value: 'cancelled', label: 'Cancelled / rejected' },
            ]}
          />
        }
      />

      {resource.loading && !resource.data ? (
        <Skeleton className="h-40" />
      ) : resource.error ? (
        <ErrorNote>{resource.error}</ErrorNote>
      ) : (resource.data?.orders ?? []).length === 0 ? (
        <EmptyState
          icon={<Package className="h-8 w-8" aria-hidden="true" />}
          title="No orders in this view"
          description="Orders placed by customers appear here in real time."
        />
      ) : (
        <div className="space-y-3">
          {(resource.data?.orders ?? []).map((order) => (
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

  if (resource.loading && !resource.data) return <Spinner label="Loading order…" />;
  if (resource.error) return <ErrorNote>{resource.error}</ErrorNote>;
  if (!resource.data) return null;

  const order = resource.data.order;
  const meta = orderStatusMeta(order.status);
  const actions = SELLER_ACTIONS[order.status] ?? [];

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
          {order.pickupCode ? (
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

          <TextAreaField
            label="Description"
            rows={3}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Homogenised toned milk, rich in calcium."
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

  const summary = resource.data?.summary;

  const adjust = async (mode: 'set' | 'delta') => {
    if (!editing) return;
    setSaving(true);
    try {
      const result = await api.post<{ message: string }>(`/api/seller/products/${editing.id}/stock`, {
        mode,
        value,
      });
      toast.push({ title: 'Stock updated', description: result.message, tone: 'success' });
      setEditing(null);
      resource.reload();
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
        description="Choose the new shelf quantity, or apply a change relative to the current stock."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="secondary" loading={saving} onClick={() => adjust('delta')}>
              Apply change
            </Button>
            <Button loading={saving} onClick={() => adjust('set')}>
              Set exact stock
            </Button>
          </>
        }
      >
        <p className="text-xs text-slate-600">
          Currently {editing?.stock_quantity} on shelf, {editing?.reserved_quantity ?? 0} held for reservations.
        </p>
        <div className="flex items-center gap-3">
          <QuantityStepper value={value} min={0} max={100000} onChange={setValue} label="stock quantity" />
          <Field
            label="Value"
            type="number"
            value={String(value)}
            onChange={(event) => setValue(Number(event.target.value))}
            className="w-28"
          />
        </div>
        <InfoNote>
          Stock can never be set below the quantity already held for confirmed reservations, and cannot go negative.
        </InfoNote>
      </Modal>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Requests (stock checks + reservations)                                     */
/* -------------------------------------------------------------------------- */

export const SellerRequestsPage: React.FC = () => {
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
        title="Customer requests"
        subtitle="Answer stock checks and reserve stock for customers who asked first."
      />

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
        latitude: form.latitude ? Number(form.latitude) : undefined,
        longitude: form.longitude ? Number(form.longitude) : undefined,
        image: form.image || undefined,
      });
      toast.push({ title: 'Store saved', tone: 'success' });
      storeResource.reload();
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
            <SelectField
              label="Operating status"
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
              options={[
                { value: 'open', label: 'Open — accepting orders' },
                { value: 'closed', label: 'Closed — visible but not accepting' },
                { value: 'inactive', label: 'Hidden from discovery' },
              ]}
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
