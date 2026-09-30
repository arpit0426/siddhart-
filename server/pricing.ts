import { config } from './config.js';

/**
 * Money is stored as REAL rupees (2 decimal places) and always computed on the
 * server. The client can never dictate prices, fees or totals.
 */
export function toRupees(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function formatInr(value: number): string {
  return `₹${toRupees(value).toFixed(2).replace(/\.00$/, '')}`;
}

/**
 * Flat neighbourhood delivery fee per store order, waived for pickup.
 * Stores may opt out of delivery entirely (validated separately at checkout).
 */
export function deliveryFeeFor(opts: {
  fulfilmentType: 'delivery' | 'pickup';
  subtotal: number;
  supportsDelivery?: boolean;
}): number {
  if (opts.fulfilmentType !== 'delivery') return 0;
  if (opts.supportsDelivery === false) return 0;
  if (config.freeDeliveryThreshold > 0 && opts.subtotal >= config.freeDeliveryThreshold) {
    return 0;
  }
  return toRupees(config.deliveryFeePerStore);
}

export interface LineTotal {
  subtotal: number;
  lineTotals: number[];
}

export function computeSubtotal(lines: { unitPrice: number; quantity: number }[]): LineTotal {
  const lineTotals = lines.map((line) => toRupees(line.unitPrice * line.quantity));
  return {
    subtotal: toRupees(lineTotals.reduce((sum, value) => sum + value, 0)),
    lineTotals,
  };
}

export function orderTotal(subtotal: number, deliveryFee: number): number {
  return toRupees(subtotal + deliveryFee);
}
