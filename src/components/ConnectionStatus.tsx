import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

export interface HealthReadyResponse {
  status: string;
  database: string;
  engine?: string;
  migrationsApplied?: number;
  latestMigration?: string;
  demoMode?: boolean;
  timestamp?: string;
}

export const ConnectionStatus: React.FC<{
  compact?: boolean;
  className?: string;
}> = ({ compact = false, className = '' }) => {
  const [health, setHealth] = useState<HealthReadyResponse | null>(null);
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const checkHealth = async () => {
    setChecking(true);
    try {
      const response = await fetch('/health/ready', {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data: HealthReadyResponse = await response.json();
      if (data.status === 'ready' && data.database === 'connected') {
        setHealth(data);
        setStatus('ready');
        setErrorMessage(null);
      } else {
        setHealth(data);
        setStatus('error');
        setErrorMessage(data.database !== 'connected' ? 'Database initializing' : 'Service initializing');
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || 'Cannot reach service');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void checkHealth();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkHealth();
    }, 20000);
    return () => window.clearInterval(interval);
  }, []);

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors shadow-2xs ${
          status === 'ready'
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
            : status === 'error'
              ? 'bg-rose-50 text-rose-800 border border-rose-200'
              : 'bg-amber-50 text-amber-800 border border-amber-200'
        } ${className}`}
        title={
          status === 'ready'
            ? `Service Ready (${health?.database === 'connected' ? 'Database Connected' : 'Database Ready'})`
            : errorMessage || 'Checking service'
        }
        role="status"
        aria-live="polite"
      >
        <span
          className={`h-2 w-2 rounded-full ${
            status === 'ready'
              ? 'bg-emerald-500 animate-pulse'
              : status === 'error'
                ? 'bg-rose-500'
                : 'bg-amber-500 animate-ping'
          }`}
          aria-hidden="true"
        />
        <span>{status === 'ready' ? 'Service Ready' : status === 'error' ? 'Service Offline' : 'Connecting…'}</span>
        {status === 'error' && (
          <button
            type="button"
            onClick={checkHealth}
            disabled={checking}
            className="ml-1 inline-flex items-center text-[10px] font-bold underline hover:opacity-80"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition-colors shadow-2xs ${
        status === 'ready'
          ? 'border-emerald-200 bg-emerald-50/90 text-emerald-900'
          : status === 'error'
            ? 'border-rose-200 bg-rose-50/90 text-rose-900'
            : 'border-amber-200 bg-amber-50/90 text-amber-900'
      } ${className}`}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-2.5 w-2.5">
        {status === 'ready' && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
            status === 'ready'
              ? 'bg-emerald-500'
              : status === 'error'
                ? 'bg-rose-500'
                : 'bg-amber-500'
          }`}
        />
      </span>
      <span className="font-semibold">
        {status === 'ready' ? 'Service Ready' : status === 'error' ? 'Service Unavailable' : 'Checking Service…'}
      </span>
      {status === 'ready' && health?.database && (
        <span className="hidden text-emerald-700/80 sm:inline">
          · DB Connected
        </span>
      )}
      {status === 'error' && (
        <button
          type="button"
          onClick={checkHealth}
          disabled={checking}
          className="ml-1 inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 font-bold text-rose-800 hover:bg-rose-200"
          title="Retry health check"
        >
          <RefreshCw className={`h-3 w-3 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
};
