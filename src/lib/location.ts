import { useEffect, useState } from 'react';

/**
 * The customer's chosen delivery area. It is only a browsing preference kept in
 * this browser (localStorage); the source of truth for actual delivery is the
 * address saved on the server at checkout.
 */
export interface BrowseLocation {
  label: string;
  lat: number | null;
  lng: number | null;
  source: 'address' | 'geolocation' | 'preset';
}

const KEY = 'nearbuy.location';
const EVENT = 'nearbuy:location-changed';

export function readLocation(): BrowseLocation | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.label !== 'string') return null;
    return {
      label: parsed.label,
      lat: typeof parsed.lat === 'number' ? parsed.lat : null,
      lng: typeof parsed.lng === 'number' ? parsed.lng : null,
      source: parsed.source ?? 'preset',
    };
  } catch {
    return null;
  }
}

export function saveLocation(location: BrowseLocation | null) {
  try {
    if (location) window.localStorage.setItem(KEY, JSON.stringify(location));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable (private mode) - the choice simply is not remembered */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useBrowseLocation(): BrowseLocation | null {
  const [location, setLocation] = useState<BrowseLocation | null>(() =>
    typeof window === 'undefined' ? null : readLocation()
  );
  useEffect(() => {
    const sync = () => setLocation(readLocation());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return location;
}

/** `lat`/`lng` query params when a location with coordinates is chosen. */
export function locationParams(location: BrowseLocation | null): Record<string, string> {
  return location && location.lat !== null && location.lng !== null
    ? { lat: String(location.lat), lng: String(location.lng) }
    : {};
}
