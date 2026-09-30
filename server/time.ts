/**
 * NearBuy operates in India, so "today / this week / this month" are calendar
 * periods in IST (UTC+05:30), evaluated in SQL against the stored UTC ISO timestamps.
 */
export const IST_MODIFIER = `'+330 minutes'`;

/** SQL expression for the IST calendar date of an ISO timestamp column. */
export function istDate(column: string): string {
  return `date(${column}, ${IST_MODIFIER})`;
}

export const IST_TODAY = `date('now', ${IST_MODIFIER})`;
/** Monday-based start of the current IST week. */
export const IST_WEEK_START = `date('now', ${IST_MODIFIER}, '-6 days', 'weekday 1')`;
export const IST_MONTH_START = `date('now', ${IST_MODIFIER}, 'start of month')`;

export type Period = 'all' | 'today' | 'week' | 'month';

export function periodClause(column: string, period: unknown): string {
  switch (period) {
    case 'today':
      return `AND ${istDate(column)} = ${IST_TODAY}`;
    case 'week':
      return `AND ${istDate(column)} >= ${IST_WEEK_START}`;
    case 'month':
      return `AND ${istDate(column)} >= ${IST_MONTH_START}`;
    default:
      return '';
  }
}
