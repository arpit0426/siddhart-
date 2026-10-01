import { ApiError } from './http.js';

/** Server-side input validation helpers. Never trust the client. */

export function requireString(
  value: unknown,
  field: string,
  { min = 1, max = 500 }: { min?: number; max?: number } = {}
): string {
  if (typeof value !== 'string') {
    throw ApiError.badRequest(`${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw ApiError.badRequest(`${field} must be at least ${min} character(s).`);
  }
  if (trimmed.length > max) {
    throw ApiError.badRequest(`${field} must be at most ${max} characters.`);
  }
  return trimmed;
}

export function optionalString(
  value: unknown,
  field: string,
  { max = 1000 }: { max?: number } = {}
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, field, { min: 1, max });
}

export function requireNumber(
  value: unknown,
  field: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {}
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw ApiError.badRequest(`${field} must be a valid number.`);
  }
  if (parsed < min || parsed > max) {
    throw ApiError.badRequest(`${field} must be between ${min} and ${max}.`);
  }
  return parsed;
}

export function requireQuantity(value: unknown, field = 'quantity'): number {
  const parsed = requireNumber(value, field, { min: 1, max: 999 });
  if (!Number.isInteger(parsed)) {
    throw ApiError.badRequest(`${field} must be a whole number.`);
  }
  return parsed;
}

export function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw ApiError.badRequest(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function requireEmail(value: unknown): string {
  const email = requireString(value, 'Email address', { min: 5, max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw ApiError.badRequest('Please provide a valid email address.');
  }
  return email;
}

export function optionalPhone(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const phone = String(value).trim();
  if (!/^[+]?[0-9\s-]{8,16}$/.test(phone)) {
    throw ApiError.badRequest('Please provide a valid phone number.');
  }
  return phone;
}

export function requirePincode(value: unknown): string {
  const pincode = requireString(value, 'Pincode', { min: 4, max: 10 });
  if (!/^[0-9]{4,10}$/.test(pincode)) {
    throw ApiError.badRequest('Pincode must be 4-10 digits.');
  }
  return pincode;
}

export function optionalCoordinate(
  value: unknown,
  field: string,
  { min, max }: { min: number; max: number }
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireNumber(value, field, { min, max });
}

export function requireIpOrDomain(value: unknown, field: string): string {
  return requireString(value, field, { min: 1, max: 300 });
}

/** Basic HTML/script stripping for free-text fields rendered back to users. */
export function sanitizeText(value: string): string {
  return value
    .replace(/<\/?[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function optionalIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const key = requireString(value, 'Idempotency key', { min: 8, max: 120 });
  if (!/^[A-Za-z0-9_.:-]+$/.test(key)) {
    throw ApiError.badRequest('Idempotency key contains unsupported characters.');
  }
  return key;
}

export function requirePositiveInt(
  value: unknown,
  field: string,
  { min = 0, max = 100000 }: { min?: number; max?: number } = {}
): number {
  const parsed = requireNumber(value, field, { min, max });
  if (!Number.isInteger(parsed)) {
    throw ApiError.badRequest(`${field} must be a whole number.`);
  }
  return parsed;
}

export function requirePlatformId(value: unknown, field = 'Identifier'): string {
  const id = requireString(value, field, { min: 3, max: 64 });
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw ApiError.badRequest(`${field} is not a valid identifier.`);
  }
  return id;
}

export function requirePhone(value: unknown, field = 'Phone number'): string {
  const phone = requireString(value, field, { min: 8, max: 16 });
  if (!/^[+]?[0-9\s-]{8,16}$/.test(phone)) {
    throw ApiError.badRequest(`${field} must be a valid phone number.`);
  }
  return phone;
}

export function requireNonEmptyArray(value: unknown, field: string): any[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw ApiError.badRequest(`${field} is required.`);
  }
  if (value.length > 100) {
    throw ApiError.badRequest(`${field} cannot contain more than 100 entries.`);
  }
  return value;
}

/** Only URLs produced by our own upload endpoint (or bundled /images assets) are accepted. */
export function requireUploadUrl(value: unknown, field = 'Image'): string {
  const url = requireString(value, field, { min: 5, max: 200 });
  if (!/^\/(uploads|images)\/[A-Za-z0-9._-]+$/.test(url)) {
    throw new ApiError(400, `${field} must be uploaded through NearBuy.`, 'invalid_image');
  }
  return url;
}
