/** Shared formatting + status vocabulary (INR, Indian date/time, statuses). */

export function formatINR(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '₹0';
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const [whole, decimals] = rounded.toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimals === '00' ? `₹${grouped}` : `₹${grouped}.${decimals}`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(value?: string | null): string {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'progress';

export interface StatusMeta {
  label: string;
  tone: Tone;
  /** Customer-facing explanation of what is happening right now. */
  customerHint?: string;
  sellerHint?: string;
  riderHint?: string;
}

export const ORDER_STATUS: Record<string, StatusMeta> = {
  placed: {
    label: 'Placed',
    tone: 'warning',
    customerHint: 'Waiting for the store to accept your order.',
    sellerHint: 'New order - accept it to start fulfilment.',
    riderHint: 'Waiting for the store to accept.',
  },
  accepted: {
    label: 'Accepted',
    tone: 'info',
    customerHint: 'The store accepted your order and will start picking items.',
    sellerHint: 'Start preparing the items.',
    riderHint: 'Store is preparing - pickup starts soon.',
  },
  preparing: {
    label: 'Preparing',
    tone: 'info',
    customerHint: 'The store is packing your items.',
    sellerHint: 'Pack the items, then mark the order as Packed.',
    riderHint: 'Waiting for the store to finish packing.',
  },
  packed: {
    label: 'Packed',
    tone: 'progress',
    customerHint: 'Your order is packed and will be marked ready for pickup.',
    sellerHint: 'Mark ready for pickup once a rider can collect it.',
    riderHint: 'Packed - almost ready for pickup.',
  },
  ready_for_pickup: {
    label: 'Ready for Pickup',
    tone: 'progress',
    customerHint: 'Waiting for a delivery partner to collect your order.',
    sellerHint: 'Share the pickup code with the rider when they arrive.',
    riderHint: 'Claim this job and collect the pickup code from the store.',
  },
  picked_up: {
    label: 'Picked Up',
    tone: 'progress',
    customerHint: 'Your order has been collected.',
    sellerHint: 'Order collected by rider.',
    riderHint: 'Collected from store.',
  },
  out_for_delivery: {
    label: 'Out for Delivery',
    tone: 'progress',
    customerHint: 'Your order is on the way. Keep the delivery code handy.',
    sellerHint: 'Order collected by the rider and on the way.',
    riderHint: 'Head to the customer and verify their delivery code.',
  },
  delivered: {
    label: 'Delivered',
    tone: 'success',
    customerHint: 'Delivered successfully. Thank you for shopping nearby!',
    sellerHint: 'Delivered to the customer.',
    riderHint: 'Completed. Earnings added to your account.',
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'danger',
    customerHint: 'This order was cancelled and stock was returned to the store.',
    sellerHint: 'Order cancelled.',
    riderHint: 'Job cancelled.',
  },
  rejected: {
    label: 'Rejected by Store',
    tone: 'danger',
    customerHint: 'The store could not fulfil this order.',
    sellerHint: 'You rejected this order.',
    riderHint: 'Job cancelled.',
  },
};

export function orderStatusMeta(status: string): StatusMeta {
  return ORDER_STATUS[status] ?? { label: status, tone: 'neutral' };
}

export const JOB_STATUS: Record<string, StatusMeta> = {
  available: { label: 'Available', tone: 'info' },
  claimed: { label: 'Assigned to you', tone: 'progress', riderHint: 'Collect the order and verify the pickup code.' },
  pickup_verified: { label: 'Pickup Verified', tone: 'progress' },
  out_for_delivery: { label: 'Out for Delivery', tone: 'progress' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

export function jobStatusMeta(status: string): StatusMeta {
  return JOB_STATUS[status] ?? { label: status, tone: 'neutral' };
}

export const RESERVATION_STATUS: Record<string, StatusMeta> = {
  pending: { label: 'Pending', tone: 'warning', customerHint: 'Waiting for the store to respond.' },
  confirmed: { label: 'Confirmed · Stock held', tone: 'success', customerHint: 'The store is holding these units for you until the expiry time.' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  fulfilled: { label: 'Fulfilled', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral', customerHint: 'The hold expired and the units went back on sale.' },
};

export const STOCK_REQUEST_STATUS: Record<string, StatusMeta> = {
  pending: { label: 'Pending', tone: 'warning', customerHint: 'The store has not responded yet.' },
  confirmed: { label: 'Confirmed available', tone: 'success', customerHint: 'The store confirmed stock. This is not a hold - order soon to be safe.' },
  unavailable: { label: 'Unavailable', tone: 'danger' },
};

export function statusMeta(map: Record<string, StatusMeta>, status: string): StatusMeta {
  return map[status] ?? { label: status, tone: 'neutral' };
}

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  info: 'bg-sky-50 text-sky-800 border-sky-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
  progress: 'bg-indigo-50 text-indigo-800 border-indigo-200',
};

export const ORDER_TIMELINE_STEPS = [
  { status: 'placed', label: 'Placed' },
  { status: 'accepted', label: 'Accepted' },
  { status: 'preparing', label: 'Preparing' },
  { status: 'packed', label: 'Packed' },
  { status: 'ready_for_pickup', label: 'Ready for pickup' },
  { status: 'out_for_delivery', label: 'Out for delivery' },
  { status: 'delivered', label: 'Delivered' },
];

export function timelineIndex(status: string): number {
  if (status === 'picked_up') return ORDER_TIMELINE_STEPS.findIndex((step) => step.status === 'out_for_delivery');
  return ORDER_TIMELINE_STEPS.findIndex((step) => step.status === status);
}

export function isTerminalStatus(status: string): boolean {
  return ['delivered', 'cancelled', 'rejected'].includes(status);
}
