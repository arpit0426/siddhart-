import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, MapPin } from 'lucide-react';
import { api } from '../lib/api';
import { saveLocation, useBrowseLocation } from '../lib/location';
import { Button } from './ui';

interface Area {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}
interface SavedAddress {
  id: string;
  label: string;
  address_line: string;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Delivery-area picker for the customer header: a saved address, the device
 * location (with permission) or one of the service areas. Purely a browsing
 * preference - it decides distance sorting, never where an order is delivered.
 */
export const LocationPicker: React.FC = () => {
  const location = useBrowseLocation();
  const [open, setOpen] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    api.get<{ areas: Area[] }>('/api/customer/areas').then((r) => setAreas(r.areas)).catch(() => undefined);
    api
      .get<{ addresses: SavedAddress[] }>('/api/customer/addresses')
      .then((r) => setAddresses(r.addresses))
      .catch(() => undefined);
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const useDevice = () => {
    setMessage(null);
    if (!navigator.geolocation) {
      setMessage('Location is not available on this device. Choose an area instead.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        saveLocation({
          label: 'Current location',
          lat: Number(position.coords.latitude.toFixed(4)),
          lng: Number(position.coords.longitude.toFixed(4)),
          source: 'geolocation',
        });
        setOpen(false);
      },
      () => setMessage('Location permission was denied. Choose an area or saved address instead.'),
      { timeout: 8000, maximumAge: 300000 }
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex max-w-[11rem] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        <MapPin className="h-3.5 w-3.5 shrink-0 text-blue-700" aria-hidden="true" />
        <span className="truncate">{location?.label ?? 'Choose area'}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Choose delivery area"
          className="absolute left-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
        >
          <Button variant="secondary" size="sm" className="w-full" onClick={useDevice}>
            <Crosshair className="h-3.5 w-3.5" aria-hidden="true" /> Use my current location
          </Button>
          {message && <p className="mt-2 text-[11px] text-amber-700">{message}</p>}

          {addresses.length > 0 && (
            <>
              <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">Saved addresses</p>
              <ul className="mt-1">
                {addresses.map((address) => (
                  <li key={address.id}>
                    <button
                      type="button"
                      onClick={() => {
                        saveLocation({
                          label: address.label || 'Saved address',
                          lat: address.latitude ?? null,
                          lng: address.longitude ?? null,
                          source: 'address',
                        });
                        setOpen(false);
                      }}
                      className="w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-slate-50"
                    >
                      <span className="font-semibold text-slate-800">{address.label}</span>
                      <span className="block truncate text-slate-500">{address.address_line}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">Service areas</p>
          <ul className="mt-1 max-h-48 overflow-y-auto">
            {areas.map((area) => (
              <li key={area.id}>
                <button
                  type="button"
                  onClick={() => {
                    saveLocation({ label: area.name, lat: area.latitude, lng: area.longitude, source: 'preset' });
                    setOpen(false);
                  }}
                  className="w-full rounded-lg px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                >
                  {area.name}
                </button>
              </li>
            ))}
          </ul>
          {location && (
            <button
              type="button"
              onClick={() => {
                saveLocation(null);
                setOpen(false);
              }}
              className="mt-2 text-[11px] font-semibold text-slate-500 underline"
            >
              Clear location
            </button>
          )}
        </div>
      )}
    </div>
  );
};
