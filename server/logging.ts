/**
 * Tiny structured logger (JSON lines) with secret redaction.
 *
 * Never log: passwords, password hashes, session tokens, handoff codes, or full
 * customer addresses.
 */
const SENSITIVE_KEYS = [
  'password',
  'password_hash',
  'password_salt',
  'token',
  'session',
  'authorization',
  'cookie',
  'pickup_code',
  'delivery_code',
  'pickupCode',
  'deliveryCode',
];

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
        out[key] = '[redacted]';
      } else {
        out[key] = redact(nested, depth + 1);
      }
    }
    return out;
  }
  return value;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (level === 'debug' && process.env.LOG_LEVEL !== 'debug') return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(redact(fields) as Record<string, unknown>),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => emit('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
};
