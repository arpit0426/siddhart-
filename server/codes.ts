import crypto from 'node:crypto';

export type HandoffCodeType = 'pickup' | 'delivery';

const PREFIXES: Record<HandoffCodeType, string> = {
  pickup: 'PK',
  delivery: 'DL',
};

/**
 * Generates a 4-digit handoff code using a CSPRNG (never Math.random).
 * Format: PK-1234 / DL-5678.
 */
export function generateHandoffCode(type: HandoffCodeType): string {
  const value = crypto.randomInt(1000, 10000);
  return `${PREFIXES[type]}-${value}`;
}

/** Uppercase alphanumeric only: "pk 1234" -> "PK1234". */
export function normalizeCode(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Constant-time comparison. Accepts the code with or without its prefix
 * (riders may type just the 4 digits), but nothing else.
 */
export function codesMatch(entered: unknown, expected: unknown): boolean {
  const a = normalizeCode(entered);
  const b = normalizeCode(expected);
  if (!a || !b) return false;
  const candidates = [b, b.replace(/^(PK|DL)/, '')];
  return candidates.some((candidate) => candidate.length > 0 && safeEqual(a, candidate));
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function maskCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = normalizeCode(code);
  return normalized.length <= 2 ? '••••' : `${normalized.slice(0, 2)}-••••`;
}

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function orderNumber(): string {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const suffix = crypto.randomInt(1000, 10000);
  return `NB-${stamp}-${suffix}`;
}
