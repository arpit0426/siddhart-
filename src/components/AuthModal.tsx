import React, { useState } from 'react';
import { X, Lock, Mail, User, Phone, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { Role } from '../types/index.ts';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { login, register, demoLogin } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [role, setRole] = useState<Role>('customer');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        const res = await register(role, name, email, phone, password);
        if (!res.success) {
          setError(res.error || 'Registration failed');
        } else {
          onClose();
        }
      } else {
        const res = await login(email, password);
        if (!res.success) {
          setError(res.error || 'Invalid credentials');
        } else {
          onClose();
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (demoRole: Role) => {
    const creds: Record<Role, { email: string; pass: string }> = {
      customer: { email: 'customer.demo@nearbuy.app', pass: 'NearBuy@2026' },
      seller: { email: 'seller.demo@nearbuy.app', pass: 'NearBuy@2026' },
      rider: { email: 'rider.demo@nearbuy.app', pass: 'NearBuy@2026' }
    };
    setEmail(creds[demoRole].email);
    setPassword(creds[demoRole].pass);
    setRole(demoRole);
    setIsRegister(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-emerald-100 text-emerald-800">
              <Shield className="w-4 h-4" />
            </span>
            <h3 className="text-base font-bold text-slate-900">
              {isRegister ? 'Create NearBuy Account' : 'Sign In to NearBuy'}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Demo Credentials Autofill */}
        <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs">
          <span className="font-bold text-slate-700 block mb-1.5">Quick Demo Autofill:</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleQuickFill('customer')}
              className="px-2 py-1 rounded bg-white border border-slate-200 hover:bg-slate-100 text-emerald-800 font-semibold text-[11px]"
            >
              Customer (Aarav)
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill('seller')}
              className="px-2 py-1 rounded bg-white border border-slate-200 hover:bg-slate-100 text-amber-800 font-semibold text-[11px]"
            >
              Seller (Rahul)
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill('rider')}
              className="px-2 py-1 rounded bg-white border border-slate-200 hover:bg-slate-100 text-blue-800 font-semibold text-[11px]"
            >
              Rider (Arjun)
            </button>
          </div>
        </div>

        {error && (
          <div className="p-2.5 mb-4 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {/* Role selector if registering */}
          {isRegister && (
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Account Role</label>
              <div className="grid grid-cols-3 gap-2">
                {(['customer', 'seller', 'rider'] as Role[]).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`py-1.5 px-2 rounded-lg font-bold capitalize transition-colors ${
                      role === r ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isRegister && (
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Full Name</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Aarav Sharma"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-emerald-600"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="email"
                required
                placeholder="e.g. customer.demo@nearbuy.app"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-emerald-600 font-mono text-xs"
              />
            </div>
          </div>

          {isRegister && (
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Phone Number</label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-emerald-600"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                placeholder="NearBuy@2026"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-emerald-600 font-mono text-xs"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 mt-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-xs"
          >
            {loading ? 'Processing...' : (isRegister ? 'Register Account' : 'Sign In')}
          </button>
        </form>

        <div className="mt-4 pt-3 border-t border-slate-100 text-center text-xs text-slate-500">
          {isRegister ? (
            <button onClick={() => setIsRegister(false)} className="hover:text-emerald-700 font-medium">
              Already have an account? Sign in
            </button>
          ) : (
            <button onClick={() => setIsRegister(true)} className="hover:text-emerald-700 font-medium">
              Don't have an account? Register here
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
