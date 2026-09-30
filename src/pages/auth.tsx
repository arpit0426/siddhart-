import React, { useState } from 'react';
import { Bike, Lock, Mail, Phone, ShieldCheck, Store as StoreIcon, User as UserIcon } from 'lucide-react';
import { Link, navigate, useQueryParams } from '../lib/router';
import { errorMessage } from '../lib/api';
import { roleHome, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, ErrorNote, Field, InfoNote, SectionHeader } from '../components/ui';
import type { Role } from '../types';

const ROLE_COPY: Record<
  Role,
  { title: string; subtitle: string; icon: React.ReactNode; accent: string; bullet: string }
> = {
  customer: {
    title: 'Customer sign in',
    subtitle: 'Shop from neighbourhood stores in Dwarka and track every order.',
    icon: <UserIcon className="h-5 w-5" aria-hidden="true" />,
    accent: 'text-emerald-700 bg-emerald-50',
    bullet: 'Cart across multiple stores, verified delivery codes and order history.',
  },
  seller: {
    title: 'Seller sign in',
    subtitle: 'Manage your store, catalogue, stock and incoming orders.',
    icon: <StoreIcon className="h-5 w-5" aria-hidden="true" />,
    accent: 'text-amber-700 bg-amber-50',
    bullet: 'Publish products, hold reservations, hand orders to riders with a pickup code.',
  },
  rider: {
    title: 'Delivery partner sign in',
    subtitle: 'Claim deliveries, verify handoff codes and track your earnings.',
    icon: <Bike className="h-5 w-5" aria-hidden="true" />,
    accent: 'text-sky-700 bg-sky-50',
    bullet: 'Atomic job claiming, pickup verification and delivery code confirmation.',
  },
};

function safeNext(raw: string | null, role: Role): string {
  if (!raw) return roleHome(role);
  // Only allow same-app relative paths (never absolute URLs).
  if (!raw.startsWith('/') || raw.startsWith('//')) return roleHome(role);
  return raw;
}

export const RoleLoginPage: React.FC<{ role: Role }> = ({ role }) => {
  const params = useQueryParams();
  const { login, config, user } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const copy = ROLE_COPY[role];
  const next = safeNext(params.get('next'), role);

  if (user && user.role !== role) {
    return (
      <div className="mx-auto max-w-lg">
        <ErrorNote>
          You are already signed in as a {user.role} ({user.email}). Sign out first, or continue to your{' '}
          <Link to={roleHome(user.role)} className="font-semibold underline">
            {user.role} workspace
          </Link>
          .
        </ErrorNote>
      </div>
    );
  }

  const demoAccount = config?.demoAccounts.find((account) => account.role === role);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const signedIn = await login({ email, password, role });
      toast.push({ title: `Welcome back, ${signedIn.name.split(' ')[0]}`, tone: 'success' });
      navigate(safeNext(next, signedIn.role), { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-[1fr_1.1fr]">
      <Card className="p-6">
        <span className={`inline-flex rounded-lg p-2 ${copy.accent}`}>{copy.icon}</span>
        <h1 className="mt-3 text-lg font-bold text-slate-900">{copy.title}</h1>
        <p className="mt-1 text-xs text-slate-600">{copy.subtitle}</p>
        <ul className="mt-4 space-y-2 text-xs text-slate-600">
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            {copy.bullet}
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            Sessions use HttpOnly cookies — no tokens are stored in the browser.
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            Wrong-portal sign-ins are rejected by the server, not just the UI.
          </li>
        </ul>
        <p className="mt-5 text-xs text-slate-500">
          New to NearBuy?{' '}
          <Link to={`/${role}/signup`} className="font-semibold text-emerald-700 hover:underline">
            Create a {role} account
          </Link>
        </p>
      </Card>

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorNote>{error}</ErrorNote>}

          <Field
            label="Email address"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
          />

          <Button type="submit" size="lg" className="w-full" loading={loading}>
            <Lock className="h-4 w-4" aria-hidden="true" />
            Sign in as {role}
          </Button>

          {config?.demoMode && demoAccount && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Demo/staging account
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {demoAccount.name} · {demoAccount.email}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setEmail(demoAccount.email);
                  setPassword(demoAccount.password);
                  setError(null);
                }}
              >
                Fill demo credentials
              </Button>
              <p className="mt-2 text-[11px] text-slate-500">
                This only fills the form — the password is verified by the server like any other account.
              </p>
            </div>
          )}
        </form>
      </Card>
    </div>
  );
};

export const RoleSignupPage: React.FC<{ role: Role }> = ({ role }) => {
  const params = useQueryParams();
  const { register } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const copy = ROLE_COPY[role];
  const next = safeNext(params.get('next'), role);

  const passwordIssues = [
    form.password.length > 0 && form.password.length < 8 ? 'At least 8 characters' : null,
    form.password.length > 0 && !/[A-Z]/.test(form.password) ? 'One uppercase letter' : null,
    form.password.length > 0 && !/[a-z]/.test(form.password) ? 'One lowercase letter' : null,
    form.password.length > 0 && !/[0-9]/.test(form.password) ? 'One number' : null,
  ].filter(Boolean) as string[];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (passwordIssues.length > 0) {
      setError('Please choose a stronger password.');
      return;
    }

    setLoading(true);
    try {
      const created = await register({
        role,
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        password: form.password,
      });
      toast.push({
        title: `Welcome to NearBuy, ${created.name.split(' ')[0]}`,
        description:
          role === 'seller'
            ? 'Next step: set up your store profile so customers can find you.'
            : role === 'rider'
              ? 'Next step: complete your rider profile to start claiming deliveries.'
              : 'Start exploring stores near you.',
        tone: 'success',
      });
      navigate(safeNext(next, role), { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SectionHeader
        as="h1"
        title={`Create your ${role} account`}
        subtitle={copy.subtitle}
        action={
          <Link to={`/${role}/login`} className="text-xs font-semibold text-emerald-700 hover:underline">
            Already have an account? Sign in
          </Link>
        }
      />

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Full name"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder={role === 'seller' ? 'Rahul Verma' : role === 'rider' ? 'Arjun Kumar' : 'Aarav Sharma'}
            />
            <Field
              label="Email address"
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="you@example.com"
            />
            <Field
              label="Phone number"
              type="tel"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="+91 98765 43210"
            />
            <Field
              label="Password"
              type="password"
              required
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              hint="Minimum 8 characters with an uppercase letter, a lowercase letter and a number."
            />
          </div>

          {passwordIssues.length > 0 && (
            <InfoNote>
              Password still needs: {passwordIssues.join(', ')}.
            </InfoNote>
          )}

          <Field
            label="Confirm password"
            type="password"
            required
            autoComplete="new-password"
            value={form.confirm}
            onChange={(event) => setForm({ ...form, confirm: event.target.value })}
          />

          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Create {role} account
          </Button>

          <p className="text-center text-[11px] text-slate-500">
            By creating an account you agree to NearBuy’s neighbourhood-commerce terms. Passwords are stored only as
            salted scrypt hashes.
          </p>
        </form>
      </Card>
    </div>
  );
};
