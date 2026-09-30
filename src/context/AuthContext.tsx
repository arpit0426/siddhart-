import React, { createContext, useContext, useState, useEffect } from 'react';
import type { User, Role } from '../types/index.ts';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  activeRoleView: Role;
  setActiveRoleView: (role: Role) => void;
  login: (email: string, password: string, expectedRole?: Role) => Promise<{ success: boolean; error?: string }>;
  register: (role: Role, name: string, email: string, phone: string, password: string) => Promise<{ success: boolean; error?: string }>;
  demoLogin: (role: Role) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  getAuthHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('nearbuy_token'));
  const [loading, setLoading] = useState<boolean>(true);
  const [activeRoleView, setActiveRoleView] = useState<Role>('customer');

  const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  const refreshUser = async () => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        if (data.user?.role) {
          setActiveRoleView(data.user.role);
        }
      } else {
        // Token expired or invalid
        localStorage.removeItem('nearbuy_token');
        setToken(null);
        setUser(null);
      }
    } catch {
      // Network or offline fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, [token]);

  const login = async (email: string, password: string, expectedRole?: Role) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, expectedRole })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Login failed' };
      }
      localStorage.setItem('nearbuy_token', data.token);
      setToken(data.token);
      setUser(data.user);
      setActiveRoleView(data.user.role);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  };

  const register = async (role: Role, name: string, email: string, phone: string, password: string) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, name, email, phone, password })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Registration failed' };
      }
      localStorage.setItem('nearbuy_token', data.token);
      setToken(data.token);
      setUser(data.user);
      setActiveRoleView(data.user.role);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  };

  const demoLogin = async (role: Role) => {
    try {
      const res = await fetch('/api/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Demo login failed' };
      }
      localStorage.setItem('nearbuy_token', data.token);
      setToken(data.token);
      setUser(data.user);
      setActiveRoleView(data.user.role);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  };

  const logout = async () => {
    try {
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
    } catch {
      // Ignore
    } finally {
      localStorage.removeItem('nearbuy_token');
      setToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        activeRoleView,
        setActiveRoleView,
        login,
        register,
        demoLogin,
        logout,
        refreshUser,
        getAuthHeaders
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
