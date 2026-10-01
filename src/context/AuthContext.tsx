import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiRequestError, SESSION_EXPIRED_EVENT, setSessionToken } from '../lib/api';
import { resetSavedCache } from '../lib/saved';
import type { AppConfig, Role, User } from '../types';

/**
 * Authentication state.
 *
 * The session lives in an HttpOnly cookie set by the API - no tokens are kept in
 * localStorage and no role is trusted from the client: every protected request is
 * authorised by the server against the session's role.
 */
interface AuthContextValue {
  user: User | null;
  config: AppConfig | null;
  loading: boolean;
  login: (input: { email: string; password: string; role?: Role; remember?: boolean }) => Promise<User>;
  register: (input: {
    role: Role;
    name: string;
    email: string;
    phone?: string;
    password: string;
    termsAccepted?: boolean;
    address?: string;
    vehicleType?: string;
    vehicleNumber?: string;
    store?: {
      name: string;
      category: string;
      address: string;
      city: string;
      state: string;
      pincode: string;
      opensAt: string;
      closesAt: string;
      operatingDays: string;
    };
  }) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ authenticated: boolean; user: User | null }>('/api/auth/session', {
        silent: true,
      });
      setUser(data.authenticated ? data.user : null);
    } catch {
      // Network hiccup: keep whatever state we have rather than logging the user out.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [sessionResult, configResult] = await Promise.allSettled([
        api.get<{ authenticated: boolean; user: User | null }>('/api/auth/session', { silent: true }),
        api.get<AppConfig>('/api/auth/config'),
      ]);
      if (cancelled) return;
      if (sessionResult.status === 'fulfilled') {
        setUser(sessionResult.value.authenticated ? sessionResult.value.user : null);
      }
      if (configResult.status === 'fulfilled') setConfig(configResult.value);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setSessionToken(null);
      setUser(null);
      // A different account may sign in next: drop the previous customer's cache.
      resetSavedCache();
      // The role auth screens surface "Your session has expired. Please sign in again."
      try {
        window.sessionStorage.setItem('nearbuy:session-expired', 'expired');
      } catch {
        /* storage unavailable */
      }
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(
    async ({ email, password, role, remember }: { email: string; password: string; role?: Role; remember?: boolean }) => {
      const data = await api.post<{ user: User }>('/api/auth/login', {
        email,
        password,
        expectedRole: role,
        remember,
      });
      // Fresh workspace: never carry another session's saved-items cache across login.
      resetSavedCache();
      setUser(data.user);
      return data.user;
    },
    []
  );

  const register = useCallback(
    async (input: {
      role: Role;
      name: string;
      email: string;
      phone?: string;
      password: string;
      termsAccepted?: boolean;
      address?: string;
      vehicleType?: string;
      vehicleNumber?: string;
      store?: {
        name: string;
        category: string;
        address: string;
        city: string;
        state: string;
        pincode: string;
        opensAt: string;
        closesAt: string;
        operatingDays: string;
      };
    }) => {
      const data = await api.post<{ user: User }>('/api/auth/register', input);
      // Fresh workspace: never carry another session's saved-items cache across signup.
      resetSavedCache();
      setUser(data.user);
      return data.user;
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch (error) {
      // An already-expired server session is logged out; other failures must
      // remain visible rather than pretending the server revoked the session.
      if (!(error instanceof ApiRequestError) || error.status !== 401) throw error;
    }
    setSessionToken(null);
    resetSavedCache();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, config, loading, login, register, logout, refresh }),
    [user, config, loading, login, register, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function roleHome(role: Role): string {
  switch (role) {
    case 'seller':
      return '/seller/dashboard';
    case 'rider':
      return '/rider';
    default:
      return '/customer';
  }
}
