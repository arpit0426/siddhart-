/**
 * Explicit order state machine.
 *
 * SELLER: placed -> accepted -> preparing -> packed -> ready_for_pickup
 * RIDER : ready_for_pickup -> out_for_delivery -> delivered
 *
 * Sellers can never mark an order delivered; riders can never pack or accept an
 * order. Every transition is validated server-side (`assertTransition`).
 */
export const ORDER_STATUSES = [
  'placed',
  'accepted',
  'preparing',
  'packed',
  'ready_for_pickup',
  'picked_up',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'rejected',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

type TransitionMap = Partial<Record<OrderStatus, OrderStatus[]>>;

export const SELLER_TRANSITIONS: TransitionMap = {
  placed: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['packed', 'cancelled'],
  packed: ['ready_for_pickup'],
  ready_for_pickup: [],
  out_for_delivery: [],
  delivered: [],
  picked_up: [],
  cancelled: [],
  rejected: [],
};

export const CUSTOMER_TRANSITIONS: TransitionMap = {
  placed: ['cancelled'],
  accepted: [],
  preparing: [],
  packed: [],
  ready_for_pickup: [],
  out_for_delivery: [],
  delivered: [],
  picked_up: [],
  cancelled: [],
  rejected: [],
};

export const RIDER_TRANSITIONS: TransitionMap = {
  ready_for_pickup: ['out_for_delivery'],
  out_for_delivery: ['delivered'],
};

export const STATUS_LABELS: Record<string, string> = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  packed: 'Packed',
  ready_for_pickup: 'Ready for Pickup',
  picked_up: 'Picked Up',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  rejected: 'Rejected by Store',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status;
}

export function canTransition(
  from: string,
  to: string,
  map: TransitionMap = SELLER_TRANSITIONS
): boolean {
  const allowed = map[from as OrderStatus];
  return Array.isArray(allowed) && allowed.includes(to as OrderStatus);
}

export function allowedTransitions(
  from: string,
  map: TransitionMap = SELLER_TRANSITIONS
): OrderStatus[] {
  return map[from as OrderStatus] ?? [];
}

export function assertSellerTransition(from: string, to: string): void {
  if (!canTransition(from, to, SELLER_TRANSITIONS)) {
    const allowed = allowedTransitions(from, SELLER_TRANSITIONS);
    throw new StateTransitionError(from, to, allowed);
  }
}

export class StateTransitionError extends Error {
  from: string;
  to: string;
  allowed: OrderStatus[];
  status = 400;

  constructor(from: string, to: string, allowed: OrderStatus[]) {
    const reason =
      allowed.length === 0
        ? `An order in "${statusLabel(from)}" cannot be changed by the store.`
        : `You cannot move an order from "${statusLabel(from)}" to "${statusLabel(to)}". Allowed next steps: ${allowed
            .map(statusLabel)
            .join(', ')}.`;
    super(reason);
    this.from = from;
    this.to = to;
    this.allowed = allowed;
  }
}

/** Statuses in which the store may still change the order. */
export function isSellerEditable(status: string): boolean {
  return allowedTransitions(status, SELLER_TRANSITIONS).length > 0;
}

export function isTerminal(status: string): boolean {
  return ['delivered', 'cancelled', 'rejected'].includes(status);
}

export function isActiveOrder(status: string): boolean {
  return !isTerminal(status);
}

/**
 * Whether the seller may reveal the pickup handoff code. The code becomes
 * visible only once the parcel is packed and awaiting rider collection.
 */
export function pickupCodeRevealed(status: string): boolean {
  return ['ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered'].includes(status);
}

/** Whether the customer may see their delivery code (any time after placing). */
export function deliveryCodeRevealed(status: string): boolean {
  return status !== 'cancelled' && status !== 'rejected';
}
