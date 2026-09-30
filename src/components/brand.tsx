import React, { useId } from 'react';

/**
 * NearBuy brand assets.
 *
 * The logo is a circular blue mark (a location pin over a neighbourhood dot)
 * rendered as inline SVG so it stays crisp at every size and ships zero
 * additional requests. `NearBuyWordmark` pairs the mark with the name and is
 * used across the authentication gateway, auth pages and the app shell.
 */

export const NearBuyMark: React.FC<{ size?: number; className?: string; title?: string }> = ({
  size = 40,
  className = '',
  title = 'NearBuy logo',
}) => {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="55%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#1E40AF" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill={`url(#${gradientId})`} />
      <path
        d="M24 9.5c-6 0-10.9 4.8-10.9 10.8 0 7.6 10.9 18.2 10.9 18.2s10.9-10.6 10.9-18.2C34.9 14.3 30 9.5 24 9.5Z"
        fill="#FFFFFF"
      />
      <circle cx="24" cy="20.2" r="4.4" fill="#1D4ED8" />
      <circle cx="24" cy="20.2" r="1.8" fill="#93C5FD" />
    </svg>
  );
};

export const NearBuyWordmark: React.FC<{
  size?: number;
  tone?: 'dark' | 'light';
  className?: string;
  tagline?: boolean;
}> = ({ size = 36, tone = 'dark', className = '', tagline = false }) => (
  <span className={`inline-flex items-center gap-2.5 ${className}`}>
    <NearBuyMark size={size} />
    <span className="leading-none">
      <span
        className={`block font-extrabold tracking-tight ${
          tone === 'light' ? 'text-white' : 'text-slate-900'
        }`}
        style={{ fontSize: Math.round(size * 0.62) }}
      >
        <span className="text-blue-600">Near</span>
        {tone === 'light' ? <span className="text-white">Buy</span> : <span>Buy</span>}
      </span>
      {tagline && (
        <span
          className={`mt-1 block font-medium ${
            tone === 'light' ? 'text-blue-100' : 'text-slate-500'
          }`}
          style={{ fontSize: Math.max(10, Math.round(size * 0.28)) }}
        >
          What You Need, Already Nearby.
        </span>
      )}
    </span>
  </span>
);
