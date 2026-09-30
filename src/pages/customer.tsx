import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BadgeIndianRupee,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  Plus,
  RotateCcw,
  Trash2,
  Truck,
  User as UserIcon,
} from 'lucide-react';
import { Link, navigate } from '../lib/router';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { useApiResource } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
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
  Skeleton,
  Spinner,
  SuccessNote,
} from '../components/ui';
import {
  formatDateTime,
  formatINR,
  ORDER_TIMELINE_STEPS,
  orderStatusMeta,
  RESERVATION_STATUS,
  STOCK_REQUEST_STATUS,
  statusMeta,
  timelineIndex,
} from '../lib/format';
import type {
  CheckoutQuote,
  CustomerAddress,
  Order,
  Reservation,
  StockRequest,
  User,
} from '../types';

/* -------------------------------------------------------------------------- */
/* Cart                                                                       */
/* -------------------------------------------------------------------------- */

export const CartPage: React.FC = () => {
  const { user } = useAuth();
  const { cart, loading, refresh, updateItem, clear } = useCart();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!user) {
    return (
      <EmptyState
        title="Sign in to view your cart"
        description="Your cart is stored against your customer account so it survives refreshes and sign-ins."
        action={<Button onClick={() => navigate('/customer/auth?next=%2Fcart')}>Sign in</Button>}
      />
    );
  }

  if (user.role !== 'customer') {
    return <InfoNote>You are signed in as a {user.role}. The cart is only available to customer accounts.</InfoNote>;
  }

  const setQuantity = async (productId: string, quantity: number) => {
    setBusyId(productId);
    try {
      await updateItem(productId, quantity);
    } catch (error) {
      toast.push({ title: 'Cart update failed', description: errorMessage(error), tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !cart) return <Spinner label="Loading your cart…" />;

  const items = cart?.items ?? [];
  const stores = cart?.stores ?? [];
  const subtotal = cart?.subtotal ?? 0;
  const deliveryFee = stores.reduce((sum, store) => sum + store.deliveryFee, 0);
  const issues = items.filter((item) => item.issue);
  const priceChanges = items.filter((item) => item.priceChanged);
  const closedStores = stores.filter((store) => store.storeClosed);

  const removeStore = async (storeId: string) => {
    try {
      await api.del(`/api/customer/cart/stores/${storeId}`);
      await refresh();
    } catch (error) {
      toast.push({ title: 'Could not remove items', description: errorMessage(error), tone: 'error' });
    }
  };

  if (items.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        description="Browse Dwarka stores and add what you need — your cart persists against your account."
        action={<Button onClick={() => navigate('/customer')}>Browse stores</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h1"
        title="Your cart"
        subtitle={`${items.length} item(s) across ${stores.length} store(s)`}
        action={
          <Button
            variant="ghost"
            onClick={async () => {
              await clear();
              toast.push({ title: 'Cart cleared' });
            }}
          >
            Clear cart
          </Button>
        }
      />

      {priceChanges.length > 0 && (
        <InfoNote>
          <span className="font-semibold">Prices changed since you added these items:</span>
          <ul className="mt-1 space-y-1">
            {priceChanges.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {item.name}: {formatINR(item.priceChanged!.from)} → <strong>{formatINR(item.priceChanged!.to)}</strong>
                </span>
                <Button size="sm" variant="secondary" onClick={() => setQuantity(item.product_id, item.quantity)}>
                  Accept new price
                </Button>
              </li>
            ))}
          </ul>
        </InfoNote>
      )}

      {closedStores.length > 0 && (
        <ErrorNote>
          {closedStores.map((store) => store.storeName).join(', ')} {closedStores.length === 1 ? 'is' : 'are'} closed right
          now. Remove {closedStores.length === 1 ? 'its items' : 'their items'} or come back when{' '}
          {closedStores.length === 1 ? 'it reopens' : 'they reopen'} to check out.
        </ErrorNote>
      )}

      {issues.length > 0 && (
        <ErrorNote>
          Some items need attention before checkout:
          <ul className="ml-4 mt-1 list-disc space-y-0.5">
            {issues.map((item) => (
              <li key={item.id}>
                {item.name}: {item.issue}
              </li>
            ))}
          </ul>
        </ErrorNote>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          {stores.map((store) => (
            <Card key={store.storeId} className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <Link to={`/stores/${store.storeId}`} className="text-sm font-bold text-slate-900 hover:text-blue-700">
                  {store.storeName}
                </Link>
                <div className="flex items-center gap-2">
                  {store.storeClosed && <Badge tone="danger">Closed</Badge>}
                  <Badge tone="info">Delivery {formatINR(store.deliveryFee)}</Badge>
                  <button
                    type="button"
                    onClick={() => removeStore(store.storeId)}
                    className="text-[11px] font-semibold text-slate-500 underline"
                    aria-label={`Remove all items from ${store.storeName}`}
                  >
                    Remove all
                  </button>
                </div>
              </div>
              <ul className="space-y-4">
                {store.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {item.image && <img src={item.image} alt="" className="h-12 w-12 rounded object-cover" />}
                      <div className="min-w-0">
                        <Link
                          to={`/products/${item.product_id}`}
                          className="block truncate text-sm font-semibold text-slate-900 hover:text-blue-700"
                        >
                          {item.name}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {formatINR(item.price)}{item.unit ? ` / ${item.unit}` : ''} ·{' '}
                          {item.availabilityState === 'low' ? `Only ${item.stock} left` : `${item.stock} in stock`}
                        </p>
                        {item.issue && <p className="text-[11px] font-medium text-red-600">{item.issue}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <QuantityStepper
                        value={item.quantity}
                        min={1}
                        max={Math.max(1, item.stock)}
                        onChange={(next) => setQuantity(item.product_id, next)}
                        label={`quantity for ${item.name}`}
                        disabled={busyId === item.product_id}
                      />
                      <span className="w-20 text-right text-sm font-bold tabular-nums text-slate-900">
                        {formatINR(item.lineTotal)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setQuantity(item.product_id, 0)}
                        aria-label={`Remove ${item.name} from cart`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>

        <Card className="h-fit p-5">
          <h2 className="text-sm font-bold text-slate-900">Order summary</h2>
          <dl className="mt-3 space-y-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{formatINR(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>
                Delivery ({stores.length} {stores.length === 1 ? 'store' : 'stores'})
              </dt>
              <dd className="font-semibold tabular-nums text-slate-900">{formatINR(deliveryFee)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-extrabold text-slate-900">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatINR(subtotal + deliveryFee)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] text-slate-500">
            Each store is fulfilled separately — checkout creates one order per store, each with its own delivery partner.
          </p>
          <Button
            className="mt-4 w-full"
            size="lg"
            onClick={() => navigate('/checkout')}
            disabled={issues.length > 0 || closedStores.length > 0 || priceChanges.length > 0}
          >
            Proceed to checkout
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Card>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Checkout                                                                   */
/* -------------------------------------------------------------------------- */

export const CheckoutPage: React.FC = () => {
  const { user, config } = useAuth();
  const { cart, refresh: refreshCart } = useCart();
  const toast = useToast();
  const [fulfilmentType, setFulfilmentType] = useState<'delivery' | 'pickup'>('delivery');
  const [addressId, setAddressId] = useState<string>('');
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [placing, setPlacing] = useState(false);
  const [placedOrders, setPlacedOrders] = useState<Order[] | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'test_mode'>('cod');
  const [addressModalOpen, setAddressModalOpen] = useState(false);

  // The idempotency key stays the same across retries of the same basket, so a
  // double-click or network retry can never create duplicate orders.
  const idempotencyKeyRef = useRef<string>(`chk_${crypto.randomUUID()}`);

  const addressesResource = useApiResource(
    () => api.get<{ addresses: CustomerAddress[] }>('/api/customer/addresses'),
    []
  );

  useEffect(() => {
    const addresses = addressesResource.data?.addresses ?? [];
    if (!addressId && addresses.length > 0) {
      setAddressId((addresses.find((address) => address.is_default === 1) ?? addresses[0]).id);
    }
  }, [addressesResource.data, addressId]);

  const items = cart?.items ?? [];

  const loadQuote = async () => {
    if (items.length === 0) return;
    setQuoteLoading(true);
    try {
      const result = await api.post<CheckoutQuote>('/api/customer/checkout/quote', {
        items: items.map((item) => ({ productId: item.product_id, quantity: item.quantity })),
        fulfilmentType,
      });
      setQuote(result);
      setIssues(result.issues ?? []);
    } catch (error) {
      setIssues([errorMessage(error)]);
    } finally {
      setQuoteLoading(false);
    }
  };

  useEffect(() => {
    void loadQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fulfilmentType, cart?.items.length, cart?.subtotal]);

  const placeOrder = async () => {
    if (issues.length > 0) return;
    if (fulfilmentType === 'delivery' && !addressId) {
      toast.push({ title: 'Select a delivery address', tone: 'error' });
      return;
    }
    setPlacing(true);
    try {
      const result = await api.post<{ orders: Order[]; message: string; idempotent?: boolean }>(
        '/api/customer/checkout',
        {
          items: items.map((item) => ({ productId: item.product_id, quantity: item.quantity })),
          fulfilmentType,
          addressId: fulfilmentType === 'delivery' ? addressId : undefined,
          paymentMethod,
          expectedTotal: quote?.quote.total,
          idempotencyKey: idempotencyKeyRef.current,
        }
      );
      setPlacedOrders(result.orders);
      idempotencyKeyRef.current = `chk_${crypto.randomUUID()}`;
      await refreshCart();
      toast.push({ title: result.message, tone: 'success' });
    } catch (error) {
      const priceChanged = error instanceof ApiRequestError && error.code === 'price_changed';
      if (priceChanged) {
        // The basket total moved since the quote; new idempotency key so the retry is a fresh, reviewed attempt.
        idempotencyKeyRef.current = `chk_${crypto.randomUUID()}`;
        void refreshCart();
      }
      toast.push({
        title: priceChanged ? 'Prices changed — please review' : 'Checkout failed',
        description: errorMessage(error),
        tone: 'error',
      });
      void loadQuote();
    } finally {
      setPlacing(false);
    }
  };

  if (!user || user.role !== 'customer') {
    return (
      <EmptyState
        title="Sign in to check out"
        action={<Button onClick={() => navigate('/customer/auth?next=%2Fcheckout')}>Customer sign in</Button>}
      />
    );
  }

  if (placedOrders) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Card className="p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
          <h1 className="mt-3 text-xl font-bold text-slate-900">Order placed successfully</h1>
          <p className="mt-1 text-sm text-slate-600">
            {placedOrders.length === 1
              ? 'Your order is now with the store.'
              : `${placedOrders.length} store orders were created — one per store.`}
          </p>
          <div className="mt-5 space-y-4 text-left">
            {placedOrders.map((order) => (
              <div key={order.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{order.orderNumber}</p>
                    <p className="text-xs text-slate-500">{order.store?.name}</p>
                  </div>
                  <Badge tone={orderStatusMeta(order.status).tone}>{orderStatusMeta(order.status).label}</Badge>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  {order.items.length} item(s) · {formatINR(order.total)} ·{' '}
                  {order.fulfillmentType === 'delivery' ? 'Home delivery' : 'Store pickup'}
                </p>
                {order.deliveryCode && (
                  <div className="mt-3">
                    <HandoffCode
                      code={order.deliveryCode}
                      label="Your delivery code"
                      hint="Share this with the delivery partner only when they hand over your order."
                    />
                  </div>
                )}
                <Link
                  to={`/orders/${order.id}`}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                >
                  Track this order
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => navigate('/orders')}>Go to my orders</Button>
            <Button variant="secondary" onClick={() => navigate('/customer')}>
              Keep shopping
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing to check out"
        description="Add items to your cart first."
        action={<Button onClick={() => navigate('/customer')}>Browse stores</Button>}
      />
    );
  }

  const totals = quote?.quote;

  return (
    <div className="space-y-6">
      <SectionHeader as="h1" title="Checkout" subtitle="Totals below are calculated by the server from live price and stock data." />

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-bold text-slate-900">Fulfilment method</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(
                [
                  { id: 'delivery', label: 'Home delivery', hint: 'Flat ₹30 per store', icon: <Truck className="h-4 w-4" aria-hidden="true" /> },
                  { id: 'pickup', label: 'Store pickup', hint: 'No delivery fee', icon: <MapPin className="h-4 w-4" aria-hidden="true" /> },
                ] as const
              ).map((option) => (
                <label
                  key={option.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${
                    fulfilmentType === option.id ? 'border-blue-500 bg-blue-50/60' : 'border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="fulfilment"
                    className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                    checked={fulfilmentType === option.id}
                    onChange={() => setFulfilmentType(option.id)}
                  />
                  <span>
                    <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                      {option.icon}
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </Card>

          {fulfilmentType === 'delivery' && (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">Delivery address</h2>
                <Button variant="secondary" size="sm" onClick={() => setAddressModalOpen(true)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add address
                </Button>
              </div>
              {addressesResource.loading && !addressesResource.data ? (
                <Skeleton className="mt-3 h-16" />
              ) : (addressesResource.data?.addresses ?? []).length === 0 ? (
                <div className="mt-3">
                  <ErrorNote>Add a delivery address to continue.</ErrorNote>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {(addressesResource.data?.addresses ?? []).map((address) => (
                    <label
                      key={address.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-xs ${
                        addressId === address.id ? 'border-blue-500 bg-blue-50/60' : 'border-slate-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name="address"
                        className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                        checked={addressId === address.id}
                        onChange={() => setAddressId(address.id)}
                      />
                      <span>
                        <span className="flex items-center gap-2 font-semibold text-slate-900">
                          {address.label}
                          {address.is_default === 1 && <Badge tone="info">Default</Badge>}
                        </span>
                        <span className="mt-0.5 block text-slate-600">
                          {address.recipient_name} · {address.phone}
                        </span>
                        <span className="block text-slate-500">
                          {address.address_line}, {address.city} {address.pincode}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Card className="p-5">
            <h2 className="text-sm font-bold text-slate-900">Payment</h2>
            <div className="mt-3 space-y-2 text-xs">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
                <input
                  type="radio"
                  name="payment"
                  className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                  checked={paymentMethod === 'cod'}
                  onChange={() => setPaymentMethod('cod')}
                />
                <span>
                  <span className="font-semibold text-slate-900">Cash on delivery</span>
                  <span className="mt-0.5 block text-slate-500">
                    Pay the delivery partner in cash when your order arrives.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
                <input
                  type="radio"
                  name="payment"
                  className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                  checked={paymentMethod === 'test_mode'}
                  onChange={() => setPaymentMethod('test_mode')}
                />
                <span>
                  <span className="font-semibold text-slate-900">Test mode — no real payment</span>
                  <span className="mt-0.5 block text-slate-500">
                    Records the order only. No card is charged and no payment gateway is involved.
                  </span>
                </span>
              </label>
            </div>
          </Card>

          {issues.length > 0 && (
            <ErrorNote>
              <span className="font-semibold">This order cannot be placed yet:</span>
              <ul className="ml-4 mt-1 list-disc space-y-0.5">
                {issues.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
            </ErrorNote>
          )}
        </div>

        <Card className="h-fit p-5">
          <h2 className="text-sm font-bold text-slate-900">Order summary</h2>
          {quoteLoading && !totals ? (
            <Skeleton className="mt-3 h-32" />
          ) : totals ? (
            <>
              <div className="mt-3 space-y-3">
                {totals.stores.map((store) => (
                  <div key={store.storeId} className="rounded-lg border border-slate-200 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{store.storeName}</span>
                      <span className="tabular-nums text-slate-600">{store.itemCount} item(s)</span>
                    </div>
                    <div className="mt-1.5 space-y-0.5 text-slate-600">
                      <div className="flex justify-between">
                        <span>Subtotal</span>
                        <span className="tabular-nums">{formatINR(store.subtotal)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Delivery</span>
                        <span className="tabular-nums">{formatINR(store.deliveryFee)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-slate-900">
                        <span>Store total</span>
                        <span className="tabular-nums">{formatINR(store.total)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <dl className="mt-4 space-y-2 border-t border-slate-200 pt-3 text-xs text-slate-600">
                <div className="flex justify-between">
                  <dt>Subtotal</dt>
                  <dd className="tabular-nums">{formatINR(totals.subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Delivery</dt>
                  <dd className="tabular-nums">{formatINR(totals.deliveryFee)}</dd>
                </div>
                <div className="flex justify-between text-base font-extrabold text-slate-900">
                  <dt>Grand total</dt>
                  <dd className="tabular-nums">{formatINR(totals.total)}</dd>
                </div>
              </dl>
              <InfoNote className="mt-3">
                {config?.demoMode
                  ? 'Demo/staging build: no real payment gateway is connected. Orders are recorded as cash on delivery or test mode.'
                  : 'No payment gateway is configured. Orders are recorded as cash on delivery.'}
              </InfoNote>
              <Button
                className="mt-4 w-full"
                size="lg"
                onClick={placeOrder}
                loading={placing}
                disabled={issues.length > 0 || (fulfilmentType === 'delivery' && !addressId)}
              >
                <BadgeIndianRupee className="h-4 w-4" aria-hidden="true" />
                Place order · {formatINR(totals.total)}
              </Button>
            </>
          ) : (
            <ErrorNote className="mt-3">Could not load the price breakdown. Please refresh and try again.</ErrorNote>
          )}
        </Card>
      </div>

      <AddressModal
        open={addressModalOpen}
        onClose={() => setAddressModalOpen(false)}
        onSaved={(id) => {
          setAddressId(id);
          addressesResource.reload();
        }}
      />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Addresses                                                                  */
/* -------------------------------------------------------------------------- */

const AddressModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  existing?: CustomerAddress | null;
}> = ({ open, onClose, onSaved, existing }) => {
  const toast = useToast();
  const [form, setForm] = useState({
    label: existing?.label ?? 'Home',
    recipientName: existing?.recipient_name ?? '',
    phone: existing?.phone ?? '',
    addressLine: existing?.address_line ?? '',
    city: existing?.city ?? 'Dwarka, New Delhi',
    pincode: existing?.pincode ?? '',
    isDefault: existing?.is_default === 1,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      label: existing?.label ?? 'Home',
      recipientName: existing?.recipient_name ?? '',
      phone: existing?.phone ?? '',
      addressLine: existing?.address_line ?? '',
      city: existing?.city ?? 'Dwarka, New Delhi',
      pincode: existing?.pincode ?? '',
      isDefault: existing?.is_default === 1,
    });
    setError(null);
  }, [open, existing]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (existing) {
        await api.put(`/api/customer/addresses/${existing.id}`, form);
        onSaved(existing.id);
      } else {
        const result = await api.post<{ id: string }>('/api/customer/addresses', form);
        onSaved(result.id);
      }
      toast.push({ title: existing ? 'Address updated' : 'Address saved', tone: 'success' });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'Edit address' : 'Add a delivery address'}
      description="Addresses are private to your account and only shared with the rider after you place an order."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Save address
          </Button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Label"
          value={form.label}
          onChange={(event) => setForm({ ...form, label: event.target.value })}
          placeholder="Home / Office"
        />
        <Field
          label="Recipient name"
          required
          value={form.recipientName}
          onChange={(event) => setForm({ ...form, recipientName: event.target.value })}
        />
        <Field
          label="Contact number"
          required
          value={form.phone}
          onChange={(event) => setForm({ ...form, phone: event.target.value })}
          placeholder="+91 98765 43210"
        />
        <Field
          label="Pincode"
          required
          value={form.pincode}
          onChange={(event) => setForm({ ...form, pincode: event.target.value })}
          placeholder="110075"
        />
      </div>
      <Field
        label="Flat / house, building, street"
        required
        value={form.addressLine}
        onChange={(event) => setForm({ ...form, addressLine: event.target.value })}
        placeholder="Flat 402, Shivani Apartments, Sector 10"
      />
      <Field
        label="City / locality"
        value={form.city}
        onChange={(event) => setForm({ ...form, city: event.target.value })}
      />
      <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        Use as my default delivery address
      </label>
    </Modal>
  );
};

export const AccountPage: React.FC = () => {
  const { user, logout, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<CustomerAddress | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const addressesResource = useApiResource(
    () => api.get<{ addresses: CustomerAddress[] }>('/api/customer/addresses'),
    [],
    { enabled: user?.role === 'customer' }
  );
  const ordersResource = useApiResource(
    () => api.get<{ orders: Order[] }>('/api/customer/orders'),
    [],
    { enabled: user?.role === 'customer' }
  );

  useEffect(() => {
    setName(user?.name ?? '');
    setPhone(user?.phone ?? '');
  }, [user]);

  if (!user) return null;

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.put('/api/customer/profile', { name, phone });
      await refresh();
      toast.push({ title: 'Profile updated', tone: 'success' });
    } catch (error) {
      toast.push({ title: 'Could not save profile', description: errorMessage(error), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const removeAddress = async (id: string) => {
    try {
      await api.del(`/api/customer/addresses/${id}`);
      addressesResource.reload();
      toast.push({ title: 'Address removed', tone: 'success' });
    } catch (error) {
      toast.push({ title: 'Could not remove address', description: errorMessage(error), tone: 'error' });
    }
  };

  const setDefault = async (address: CustomerAddress) => {
    try {
      await api.put(`/api/customer/addresses/${address.id}`, { isDefault: true });
      addressesResource.reload();
      toast.push({ title: `${address.label} is now your default address`, tone: 'success' });
    } catch (error) {
      toast.push({ title: 'Could not update address', description: errorMessage(error), tone: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader as="h1" title="Your account" subtitle="Profile, saved addresses and session." />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="rounded-full bg-emerald-50 p-2 text-emerald-700">
              <UserIcon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
          </div>
          <div className="space-y-3">
            <Field label="Full name" value={name} onChange={(event) => setName(event.target.value)} />
            <Field
              label="Phone"
              value={phone ?? ''}
              onChange={(event) => setPhone(event.target.value)}
              hint="Riders use this number if they need to reach you."
            />
            <Button onClick={saveProfile} loading={saving}>
              Save profile
            </Button>
          </div>
          <div className="mt-5 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={async () => { await logout(); navigate('/'); }}>
              Sign out of NearBuy
            </Button>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Saved addresses</h2>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add
              </Button>
            </div>
            {addressesResource.loading && !addressesResource.data ? (
              <Skeleton className="mt-3 h-20" />
            ) : (addressesResource.data?.addresses ?? []).length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No addresses saved yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {(addressesResource.data?.addresses ?? []).map((address) => (
                  <li key={address.id} className="rounded-xl border border-slate-200 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold text-slate-900">
                        {address.label}
                        {address.is_default === 1 && <Badge tone="info">Default</Badge>}
                      </span>
                      <span className="flex gap-1">
                        {address.is_default !== 1 && (
                          <Button variant="ghost" size="sm" onClick={() => setDefault(address)}>
                            Set default
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(address);
                            setModalOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAddress(address.id)}
                          aria-label={`Remove address ${address.label}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600">
                      {address.recipient_name} · {address.phone}
                    </p>
                    <p className="text-slate-500">
                      {address.address_line}, {address.city} {address.pincode}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-bold text-slate-900">Order history</h2>
            <p className="mt-1 text-xs text-slate-500">
              You have {ordersResource.data?.orders.length ?? 0} order(s) with NearBuy.
            </p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => navigate('/orders')}>
              Open order history
            </Button>
          </Card>
        </div>
      </div>

      <AddressModal
        open={modalOpen}
        existing={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => addressesResource.reload()}
      />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

export const OrdersPage: React.FC = () => {
  const resource = useApiResource(() => api.get<{ orders: Order[] }>('/api/customer/orders'), [], {
    pollMs: 20000,
  });

  if (resource.loading && !resource.data) return <Spinner label="Loading your orders…" />;
  if (resource.error) return <ErrorNote>{resource.error}</ErrorNote>;

  const orders = resource.data?.orders ?? [];
  if (orders.length === 0) {
    return (
      <EmptyState
        title="No orders yet"
        description="Once you place an order it appears here with its live status and delivery code."
        action={<Button onClick={() => navigate('/customer')}>Start shopping</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h1"
        title="Your orders"
        subtitle="Status updates automatically as the store and delivery partner progress."
      />
      <div className="space-y-4">
        {orders.map((order) => (
          <OrderSummaryCard key={order.id} order={order} />
        ))}
      </div>
    </div>
  );
};

export const OrderSummaryCard: React.FC<{ order: Order }> = ({ order }) => {
  const meta = orderStatusMeta(order.status);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/orders/${order.id}`} className="text-sm font-bold text-slate-900 hover:text-blue-700">
              {order.orderNumber}
            </Link>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {order.fulfillmentType === 'pickup' && <Badge tone="info">Store pickup</Badge>}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {order.store?.name} · {order.items.length} item(s) · placed {formatDateTime(order.createdAt)}
          </p>
          {meta.customerHint && order.status !== 'delivered' && (
            <p className="mt-1 text-[11px] text-slate-500">{meta.customerHint}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-base font-extrabold tabular-nums text-slate-900">{formatINR(order.total)}</p>
          <Link to={`/orders/${order.id}`} className="text-xs font-semibold text-blue-700 hover:underline">
            View details
          </Link>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
        {order.items.slice(0, 3).map((item) => (
          <span key={item.id} className="rounded bg-slate-100 px-2 py-1">
            {item.quantity} × {item.name}
          </span>
        ))}
        {order.items.length > 3 && <span className="px-1 py-1">+{order.items.length - 3} more</span>}
      </div>
    </Card>
  );
};

export const OrderDetailPage: React.FC<{ orderId: string }> = ({ orderId }) => {
  const toast = useToast();
  const { refresh: refreshCart } = useCart();
  const resource = useApiResource(() => api.get<{ order: Order }>(`/api/customer/orders/${orderId}`), [orderId], {
    pollMs: 15000,
  });
  const [cancelling, setCancelling] = useState(false);
  const [reordering, setReordering] = useState(false);

  if (resource.loading && !resource.data) return <Spinner label="Loading order…" />;
  if (resource.error) return <ErrorNote>{resource.error}</ErrorNote>;
  if (!resource.data) return null;

  const order = resource.data.order;
  const meta = orderStatusMeta(order.status);
  const currentStep = timelineIndex(order.status);

  const reorder = async () => {
    setReordering(true);
    try {
      const result = await api.post<{
        message: string;
        added: { name: string; priceChanged: boolean; reducedForStock: boolean }[];
        skipped: { name: string; reason: string }[];
      }>(`/api/customer/orders/${order.id}/reorder`);
      const notes = [
        ...result.skipped.map((entry) => `${entry.name}: ${entry.reason}`),
        ...result.added.filter((entry) => entry.priceChanged).map((entry) => `${entry.name}: price changed`),
        ...result.added.filter((entry) => entry.reducedForStock).map((entry) => `${entry.name}: quantity reduced to stock`),
      ];
      toast.push({
        title: result.message,
        description: notes.length ? notes.join(' · ') : undefined,
        tone: result.added.length ? 'success' : 'error',
      });
      await refreshCart();
      if (result.added.length) navigate('/cart');
    } catch (error) {
      toast.push({ title: 'Could not reorder', description: errorMessage(error), tone: 'error' });
    } finally {
      setReordering(false);
    }
  };

  const cancelOrder = async () => {
    setCancelling(true);
    try {
      await api.post(`/api/customer/orders/${order.id}/cancel`);
      toast.push({ title: 'Order cancelled', description: 'Stock has been returned to the store.', tone: 'success' });
      resource.reload();
    } catch (error) {
      toast.push({ title: 'Could not cancel order', description: errorMessage(error), tone: 'error' });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
        <Link to="/orders" className="hover:text-slate-800">
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
              Placed {formatDateTime(order.createdAt)} · {order.store?.name}
            </p>
          </div>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        {meta.customerHint && !['delivered', 'cancelled', 'rejected'].includes(order.status) && (
          <p className="mt-2 text-xs text-slate-600">{meta.customerHint}</p>
        )}

        <ol className="mt-5 grid gap-2 sm:grid-cols-7" aria-label="Order progress">
          {ORDER_TIMELINE_STEPS.map((step, index) => {
            const reached = currentStep >= index && currentStep !== -1;
            return (
              <li key={step.status} className="flex items-center gap-2 sm:flex-col sm:text-center">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    reached ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
                  }`}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className={`text-[11px] font-medium ${reached ? 'text-slate-900' : 'text-slate-400'}`}>
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
        {['cancelled', 'rejected'].includes(order.status) && (
          <ErrorNote className="mt-4">
            {order.cancelledReason || (order.status === 'rejected' ? 'The store rejected this order.' : 'This order was cancelled.')}
          </ErrorNote>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-bold text-slate-900">Items</h2>
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
                <dt>{order.fulfillmentType === 'delivery' ? 'Delivery fee' : 'Pickup'}</dt>
                <dd className="tabular-nums">{formatINR(order.deliveryFee)}</dd>
              </div>
              <div className="flex justify-between text-sm font-extrabold text-slate-900">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatINR(order.total)}</dd>
              </div>
              <p className="pt-1 text-[11px] text-slate-500">
                Payment: {order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Test mode — no real payment'}
              </p>
            </dl>
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

        <div className="space-y-4">
          {order.deliveryCodeState === 'available' && order.deliveryCode && (
            <HandoffCode
              code={order.deliveryCode}
              label="Your delivery code"
              hint={
                order.fulfillmentType === 'pickup'
                  ? 'Show this at the store counter when you collect your order.'
                  : 'Share this only when the rider hands over your order. Nobody else can see it.'
              }
              tone="info"
            />
          )}
          {order.deliveryCodeState === 'locked' && (
            <Card className="p-4 text-xs text-slate-600">
              <p className="font-bold text-slate-900">Delivery code</p>
              <p className="mt-1">
                Your code will appear here once your order is{' '}
                {order.fulfillmentType === 'pickup' ? 'ready for collection' : 'out for delivery'}. It is kept private
                until then.
              </p>
            </Card>
          )}
          {order.deliveryCodeState === 'used' && (
            <Card className="p-4 text-xs text-slate-600">
              <p className="font-bold text-slate-900">Delivery code</p>
              <p className="mt-1">Code verified — your order was handed over. It can no longer be used.</p>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="text-sm font-bold text-slate-900">
              {order.fulfillmentType === 'delivery' ? 'Delivery details' : 'Pickup details'}
            </h2>
            <dl className="mt-3 space-y-2 text-xs text-slate-600">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>
                  {order.store?.name}
                  <br />
                  {order.store?.address}, {order.store?.city}
                </span>
              </div>
              {order.fulfillmentType === 'delivery' && order.address?.address && (
                <div className="flex items-start gap-2">
                  <Truck className="mt-0.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>
                    Deliver to {order.address.name}
                    <br />
                    {order.address.address}, {order.address.city} {order.address.pincode}
                  </span>
                </div>
              )}
              {order.store?.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="mt-0.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>{order.store.phone}</span>
                </div>
              )}
            </dl>

            {order.rider ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <p className="font-semibold text-slate-900">Delivery partner: {order.rider.name}</p>
                <p className="text-slate-500">Status: {order.rider.status ? order.rider.status.replace(/_/g, ' ') : 'assigned'}</p>
              </div>
            ) : (
              order.fulfillmentType === 'delivery' &&
              !['cancelled', 'rejected'].includes(order.status) && (
                <p className="mt-4 text-[11px] text-slate-500">
                  A delivery partner will be assigned once the store marks this order ready.
                </p>
              )
            )}

            {order.status === 'placed' && (
              <Button variant="danger" className="mt-4 w-full" onClick={cancelOrder} loading={cancelling}>
                Cancel order
              </Button>
            )}
            {['delivered', 'cancelled', 'rejected'].includes(order.status) && (
              <Button variant="secondary" className="mt-4 w-full" onClick={reorder} loading={reordering}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Buy again
              </Button>
            )}
          </Card>

          {order.status === 'delivered' && (
            <SuccessNote>
              Delivered {order.deliveredAt ? formatDateTime(order.deliveredAt) : ''}. Thanks for shopping nearby!
            </SuccessNote>
          )}
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export const RequestsPage: React.FC = () => {
  const stockResource = useApiResource(() => api.get<{ requests: StockRequest[] }>('/api/customer/stock-requests'), [], {
    pollMs: 20000,
  });
  const reservationResource = useApiResource(
    () => api.get<{ reservations: Reservation[] }>('/api/customer/reservations'),
    [],
    { pollMs: 20000 }
  );
  const toast = useToast();

  const cancelReservation = async (id: string) => {
    try {
      await api.post(`/api/customer/reservations/${id}/cancel`);
      toast.push({ title: 'Reservation cancelled', description: 'Any held stock has been released.', tone: 'success' });
      reservationResource.reload();
    } catch (error) {
      toast.push({ title: 'Could not cancel', description: errorMessage(error), tone: 'error' });
    }
  };

  return (
    <div className="space-y-8">
      <SectionHeader
        as="h1"
        title="Requests & holds"
        subtitle="Stock checks ask the store a question. Reservations genuinely hold units in the store’s inventory."
      />

      <section aria-labelledby="reservations-heading" className="space-y-3">
        <h2 id="reservations-heading" className="text-sm font-bold text-slate-900">
          Reservations
        </h2>
        {reservationResource.loading && !reservationResource.data ? (
          <Skeleton className="h-24" />
        ) : (reservationResource.data?.reservations ?? []).length === 0 ? (
          <EmptyState
            title="No reservations requested"
            description="Open a product and choose “Request reservation” to hold stock."
          />
        ) : (
          <div className="space-y-3">
            {(reservationResource.data?.reservations ?? []).map((reservation) => {
              const meta = statusMeta(RESERVATION_STATUS, reservation.status);
              return (
                <Card key={reservation.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {reservation.product_image && (
                        <img src={reservation.product_image} alt="" className="h-12 w-12 rounded object-cover" />
                      )}
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{reservation.product_name}</p>
                        <p className="text-xs text-slate-500">
                          {reservation.requested_quantity} unit(s) · {reservation.store_name}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {reservation.holds_stock === 1 && reservation.expires_at && (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Held until{' '}
                          {new Date(reservation.expires_at).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                  {reservation.seller_response && (
                    <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      Store note: “{reservation.seller_response}”
                    </p>
                  )}
                  {meta.customerHint && <p className="mt-2 text-[11px] text-slate-500">{meta.customerHint}</p>}
                  {(reservation.status === 'pending' || reservation.status === 'confirmed') && (
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => cancelReservation(reservation.id)}>
                      Cancel reservation
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="stock-heading" className="space-y-3">
        <h2 id="stock-heading" className="text-sm font-bold text-slate-900">
          Stock check requests
        </h2>
        {stockResource.loading && !stockResource.data ? (
          <Skeleton className="h-24" />
        ) : (stockResource.data?.requests ?? []).length === 0 ? (
          <EmptyState title="No stock checks yet" description="Ask a store whether an item is available before you order." />
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
                        {request.requested_quantity} unit(s) · {request.store_name}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-500">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {formatDateTime(request.created_at)}
                      </p>
                    </div>
                  </div>
                  {request.seller_response && (
                    <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      Store note: “{request.seller_response}”
                    </p>
                  )}
                  {meta.customerHint && <p className="mt-2 text-[11px] text-slate-500">{meta.customerHint}</p>}
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export type { User };
