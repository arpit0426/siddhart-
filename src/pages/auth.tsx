import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bike,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  MapPin,
  ShieldCheck,
  ShoppingBag,
  Store as StoreIcon,
  User as UserIcon,
} from 'lucide-react';
import { Link, navigate, useQueryParams } from '../lib/router';
import { api, errorMessage } from '../lib/api';
import { roleHome, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Button,
  ErrorNote,
  Field,
  InfoNote,
  SelectField,
  SuccessNote,
} from '../components/ui';
import { NearBuyMark, NearBuyWordmark } from '../components/brand';
import type { Role } from '../types';

/* -------------------------------------------------------------------------- */
/* Shared role metadata                                                        */
/* -------------------------------------------------------------------------- */

interface RoleMeta {
  name: string;
  tagline: string;
  description: string;
  chipLabel: string;
  icon: React.ReactNode;
  chip: string;
  soft: string;
  ring: string;
  loginTitle: string;
  loginSubtitle: string;
  signupCta: string;
  demoName: string;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  customer: {
    name: 'Customer',
    tagline: 'Shop Nearby',
    description: 'Shop from nearby stores',
    chipLabel: 'For shoppers',
    icon: <UserIcon className="h-5 w-5" aria-hidden="true" />,
    chip: 'bg-blue-600',
    soft: 'bg-blue-50 text-blue-700',
    ring: 'group-hover:border-blue-300 group-hover:shadow-blue-900/10',
    loginTitle: 'Customer login',
    loginSubtitle: 'Sign in to shop from stores around the corner and track every order.',
    signupCta: 'Create Customer Account',
    demoName: 'Aarav Sharma',
  },
  seller: {
    name: 'Seller',
    tagline: 'Sell Nearby',
    description: 'Manage your local store',
    chipLabel: 'For local stores',
    icon: <StoreIcon className="h-5 w-5" aria-hidden="true" />,
    chip: 'bg-violet-600',
    soft: 'bg-violet-50 text-violet-700',
    ring: 'group-hover:border-violet-300 group-hover:shadow-violet-900/10',
    loginTitle: 'Seller login',
    loginSubtitle: 'Sign in to manage your store, catalogue, stock and incoming orders.',
    signupCta: 'Create Seller Account',
    demoName: 'Rahul Verma',
  },
  rider: {
    name: 'Rider',
    tagline: 'Deliver Nearby',
    description: 'Deliver orders nearby',
    chipLabel: 'For delivery partners',
    icon: <Bike className="h-5 w-5" aria-hidden="true" />,
    chip: 'bg-amber-500',
    soft: 'bg-amber-50 text-amber-700',
    ring: 'group-hover:border-amber-300 group-hover:shadow-amber-900/10',
    loginTitle: 'Rider login',
    loginSubtitle: 'Sign in to claim nearby deliveries, verify handoffs and track earnings.',
    signupCta: 'Create Rider Account',
    demoName: 'Arjun Kumar',
  },
};

/** Only same-app relative paths are honoured as post-login redirect targets. */
function safeNext(raw: string | null, role: Role): string {
  if (!raw) return roleHome(role);
  if (!raw.startsWith('/') || raw.startsWith('//')) return roleHome(role);
  return raw;
}

const SESSION_NOTICE_KEY = 'nearbuy:session-expired';

function consumeSessionNotice(): string | null {
  try {
    const notice = window.sessionStorage.getItem(SESSION_NOTICE_KEY);
    if (notice) window.sessionStorage.removeItem(SESSION_NOTICE_KEY);
    return notice;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Auth layout: shared backdrop, brand header and footer                       */
/* -------------------------------------------------------------------------- */

const AuthBackdrop: React.FC = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
    <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-200/40 blur-3xl" />
    <div className="absolute -right-20 top-1/3 h-80 w-80 rounded-full bg-indigo-200/40 blur-3xl" />
    <div className="absolute -bottom-24 left-1/4 h-64 w-64 rounded-full bg-sky-200/30 blur-3xl" />
  </div>
);

export const AuthLayout: React.FC<{ children: React.ReactNode; wide?: boolean }> = ({
  children,
  wide = false,
}) => (
  <div className="relative flex min-h-screen flex-col bg-gradient-to-b from-blue-50 via-white to-blue-100/70">
    <AuthBackdrop />
    <header className="relative z-10">
      <div className={`mx-auto flex w-full items-center justify-between gap-3 px-4 py-5 sm:px-6 ${wide ? 'max-w-6xl' : 'max-w-5xl'}`}>
        <Link to="/" className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
          <NearBuyWordmark size={36} tagline />
        </Link>
        <Link
          to="/discover"
          className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-700 sm:inline-flex"
        >
          <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
          Browse stores first
        </Link>
      </div>
    </header>
    <main id="main" className="relative z-10 flex-1 px-4 pb-10 sm:px-6">
      {children}
    </main>
    <footer className="relative z-10 px-4 pb-6 sm:px-6">
      <div className={`mx-auto flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-slate-500 ${wide ? 'max-w-6xl' : 'max-w-5xl'}`}>
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
          Scrypt-hashed passwords
        </span>
        <span className="inline-flex items-center gap-1">
          <Lock className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
          HttpOnly session cookies
        </span>
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
          Live in Dwarka, New Delhi
        </span>
      </div>
    </footer>
  </div>
);

/* -------------------------------------------------------------------------- */
/* Password field with visibility toggle                                       */
/* -------------------------------------------------------------------------- */

const PasswordField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}> = ({ label, value, onChange, autoComplete, required, placeholder, hint }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Field
        label={label}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        hint={hint}
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute right-2 top-[30px] rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Authentication gateway — the first screen for every visitor                 */
/* -------------------------------------------------------------------------- */

export const AuthGatewayPage: React.FC = () => {
  const { user, loading, config } = useAuth();

  // Already signed in? Never force another login — go straight to the workspace.
  useEffect(() => {
    if (!loading && user) navigate(roleHome(user.role), { replace: true });
  }, [loading, user]);

  if (loading) {
    return (
      <AuthLayout wide>
        <div className="flex flex-col items-center justify-center gap-3 py-24" role="status">
          <NearBuyMark size={52} className="animate-pulse" />
          <p className="text-sm font-medium text-slate-500">Loading NearBuy…</p>
        </div>
      </AuthLayout>
    );
  }

  if (user) {
    return (
      <AuthLayout wide>
        <div className="flex flex-col items-center justify-center gap-3 py-24" role="status">
          <NearBuyMark size={52} className="animate-pulse" />
          <p className="text-sm font-medium text-slate-500">
            Taking you to your {user.role} workspace…
          </p>
        </div>
      </AuthLayout>
    );
  }

  const roles: Role[] = ['customer', 'seller', 'rider'];

  return (
    <AuthLayout wide>
      <div className="mx-auto grid w-full max-w-6xl gap-8 py-6 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
        {/* Brand panel */}
        <section className="relative hidden overflow-hidden rounded-3xl bg-gradient-to-br from-blue-700 via-blue-800 to-indigo-950 p-8 text-white shadow-2xl shadow-blue-900/30 lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-sky-400/20 blur-2xl" aria-hidden="true" />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-100">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              Neighbourhood commerce · Dwarka, New Delhi
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight">
              What You Need,
              <br />
              Already Nearby.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-blue-100">
              One secure gateway for everyone on NearBuy. Customers shop from local
              stores, sellers run their shops, riders deliver — every role gets its
              own protected workspace.
            </p>
          </div>
          <ul className="relative mt-10 space-y-4">
            {[
              {
                icon: <ShoppingBag className="h-4 w-4" aria-hidden="true" />,
                title: 'Shop Nearby',
                body: 'Order groceries, staples and more from stores minutes away.',
              },
              {
                icon: <StoreIcon className="h-4 w-4" aria-hidden="true" />,
                title: 'Sell Nearby',
                body: 'Publish your store, manage stock and serve your neighbourhood.',
              },
              {
                icon: <Bike className="h-4 w-4" aria-hidden="true" />,
                title: 'Deliver Nearby',
                body: 'Claim nearby deliveries with verified pickup and drop codes.',
              },
            ].map((item) => (
              <li key={item.title} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex rounded-xl bg-white/15 p-2 text-white">{item.icon}</span>
                <span>
                  <span className="block text-sm font-bold">{item.title}</span>
                  <span className="block text-xs text-blue-100">{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="relative mt-10 inline-flex items-center gap-2 text-[11px] text-blue-200">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Sessions are HttpOnly cookies · passwords are scrypt-hashed · every role is authorised server-side.
          </p>
        </section>

        {/* Role selector */}
        <section aria-labelledby="gateway-heading" className="flex flex-col">
          <div className="lg:hidden">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              What You Need, <span className="text-blue-700">Already Nearby.</span>
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              One secure gateway for customers, sellers and riders.
            </p>
          </div>
          <h2 id="gateway-heading" className="mt-6 text-xl font-bold tracking-tight text-slate-900 lg:mt-0">
            Choose your role to continue
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Login, Sign Up or Recover — each role has its own workspace.
          </p>

          <div className="mt-5 space-y-4">
            {roles.map((role) => {
              const meta = ROLE_META[role];
              return (
                <div
                  key={role}
                  className={`group rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg sm:p-5 ${meta.ring}`}
                >
                  <div className="flex items-start gap-3.5">
                    <span className={`inline-flex shrink-0 rounded-xl p-2.5 text-white ${meta.chip}`}>
                      {meta.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">{meta.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.soft}`}>
                          {meta.tagline}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600">{meta.description}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Link
                      to={`/${role}/auth`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                    >
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                      Login
                    </Link>
                    <Link
                      to={`/${role}/signup`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:border-blue-400 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      Sign Up
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                  <div className="mt-2.5 text-center">
                    <Link
                      to={`/${role}/recover`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition-colors hover:text-blue-700"
                    >
                      <KeyRound className="h-3 w-3" aria-hidden="true" />
                      Recover Account
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {config?.demoMode && (
            <p className="mt-5 inline-flex items-start gap-2 self-start rounded-xl border border-blue-200 bg-blue-50/80 px-3 py-2 text-[11px] text-blue-900">
              <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Development/staging demo:</strong> each login screen
                offers a one-click demo account, seeded into the real database.
              </span>
            </p>
          )}
        </section>
      </div>
    </AuthLayout>
  );
};

/* -------------------------------------------------------------------------- */
/* Role login (/customer/auth, /seller/auth, /rider/auth)                      */
/* -------------------------------------------------------------------------- */

export const RoleAuthPage: React.FC<{ role: Role }> = ({ role }) => {
  const params = useQueryParams();
  const { login, config, user } = useAuth();
  const toast = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(() => consumeSessionNotice());
  const meta = ROLE_META[role];
  const next = safeNext(params.get('next'), role);

  useEffect(() => {
    document.title = `${meta.loginTitle} · NearBuy`;
  }, [meta.loginTitle]);

  const demoAccount = config?.demoAccounts.find((account) => account.role === role);

  const signIn = async (email: string, pass: string) => {
    setError(null);
    setLoading(true);
    try {
      const signedIn = await login({ email, password: pass, role });
      toast.push({ title: `Welcome back, ${signedIn.name.split(' ')[0]}`, tone: 'success' });
      navigate(safeNext(next, signedIn.role), { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  if (user && user.role !== role) {
    return (
      <AuthLayout>
        <div className="mx-auto mt-10 max-w-md">
          <ErrorNote>
            You are already signed in as a {user.role} ({user.email}). Sign out first, or continue to your{' '}
            <Link to={roleHome(user.role)} className="font-semibold underline">
              {user.role} workspace
            </Link>
            .
          </ErrorNote>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mx-auto w-full max-w-md">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-blue-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          All roles
        </Link>

        <div className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-xl shadow-blue-900/5 sm:p-8">
          <div className="flex items-center gap-3">
            <span className={`inline-flex rounded-xl p-2.5 text-white ${meta.chip}`}>{meta.icon}</span>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-slate-900">{meta.loginTitle}</h1>
              <p className="text-xs text-slate-500">{meta.chipLabel} · {meta.tagline}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-600">{meta.loginSubtitle}</p>

          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              signIn(identifier, password);
            }}
          >
            {error && <ErrorNote>{error}</ErrorNote>}
            {notice === 'expired' && (
              <InfoNote>Your session has expired. Please sign in again.</InfoNote>
            )}

            <Field
              label={role === 'customer' ? 'Email or phone' : 'Email'}
              type="text"
              name="identifier"
              required
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={role === 'customer' ? 'you@example.com or +91 98765 43210' : 'you@example.com'}
            />
            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              required
              placeholder="••••••••"
            />

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              <Lock className="h-4 w-4" aria-hidden="true" />
              {loading ? 'Signing in…' : 'Login'}
            </Button>
          </form>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
            <Link to={`/${role}/recover`} className="font-semibold text-blue-700 hover:underline">
              Forgot Password?
            </Link>
            <Link to={`/${role}/signup`} className="font-semibold text-blue-700 hover:underline">
              {meta.signupCta}
            </Link>
          </div>

          {config?.demoMode && demoAccount && (
            <div className="mt-6 rounded-xl border border-dashed border-blue-300 bg-blue-50/60 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">
                Demo {meta.name} · development/staging only
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-800">{demoAccount.name}</p>
              <p className="text-xs text-slate-600">{demoAccount.email}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3 w-full"
                disabled={loading}
                onClick={() => {
                  setIdentifier(demoAccount.email);
                  setPassword(demoAccount.password);
                  // Still the real backend authentication — no client-side bypass.
                  signIn(demoAccount.email, demoAccount.password);
                }}
              >
                <BadgeCheck className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                Use Demo Account
              </Button>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                Signs in through the same server authentication as any other account.
              </p>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          New to NearBuy?{' '}
          <Link to={`/${role}/signup`} className="font-semibold text-blue-700 hover:underline">
            {meta.signupCta}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
};

/** Legacy /:role/login links land on the new /:role/auth experience. */
export const RoleAuthRedirect: React.FC<{ role: Role }> = ({ role }) => {
  const params = useQueryParams();
  useEffect(() => {
    const query = params.toString();
    navigate(`/${role}/auth${query ? `?${query}` : ''}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);
  return (
    <AuthLayout>
      <div className="mx-auto mt-16 max-w-md text-center text-sm text-slate-500">Redirecting to sign in…</div>
    </AuthLayout>
  );
};

/* -------------------------------------------------------------------------- */
/* Sign up (/customer/signup, /seller/signup, /rider/signup)                   */
/* -------------------------------------------------------------------------- */

const STORE_CATEGORIES = [
  'Grocery',
  'Fruits & Vegetables',
  'Dairy & Bakery',
  'Pharmacy & Health',
  'Staples & Grains',
  'Snacks & Beverages',
  'Household & Care',
  'Other',
];

const VEHICLE_TYPES = ['Bike', 'Scooter', 'Electric Scooter', 'Bicycle', 'Car'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function serializeDays(selected: string[]): string {
  if (selected.length === 0) return 'Mon-Sun';
  if (selected.length === 7) return 'Mon-Sun';
  return DAYS.filter((day) => selected.includes(day)).join(',') || 'Mon-Sun';
}

export const RoleSignupPage: React.FC<{ role: Role }> = ({ role }) => {
  const params = useQueryParams();
  const { register } = useAuth();
  const toast = useToast();
  const meta = ROLE_META[role];
  const next = safeNext(params.get('next'), role);

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
    address: '',
    vehicleType: 'Bike',
    vehicleNumber: '',
    terms: false,
  });
  const [store, setStore] = useState({
    name: '',
    category: 'Grocery',
    address: '',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '',
    opensAt: '07:00',
    closesAt: '22:00',
  });
  const [days, setDays] = useState<string[]>([...DAYS]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const passwordChecks = useMemo(
    () => [
      { ok: form.password.length >= 8, label: 'At least 8 characters' },
      { ok: /[A-Z]/.test(form.password), label: 'One uppercase letter' },
      { ok: /[a-z]/.test(form.password), label: 'One lowercase letter' },
      { ok: /[0-9]/.test(form.password), label: 'One number' },
    ],
    [form.password]
  );
  const passwordReady = passwordChecks.every((check) => check.ok);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!form.name.trim() || !form.email.trim() || !form.password) {
      setError('Please fill in all required fields.');
      return;
    }
    if (!passwordReady) {
      setError('Please choose a stronger password.');
      return;
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    if ((role === 'customer' || role === 'rider') && !form.terms) {
      setError('Please accept the NearBuy terms to continue.');
      return;
    }
    if (role === 'seller') {
      if (!store.name.trim() || !store.address.trim() || !store.city.trim() || !store.state.trim() || !store.pincode.trim()) {
        setError('Please complete your store details.');
        return;
      }
    }

    setLoading(true);
    try {
      const created = await register({
        role,
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        password: form.password,
        termsAccepted: role === 'customer' || role === 'rider' ? form.terms : undefined,
        ...(role === 'rider'
          ? {
              address: form.address || undefined,
              vehicleType: form.vehicleType || undefined,
              vehicleNumber: form.vehicleNumber || undefined,
            }
          : {}),
        ...(role === 'seller'
          ? {
              store: {
                name: store.name,
                category: store.category,
                address: store.address,
                city: store.city,
                state: store.state,
                pincode: store.pincode,
                opensAt: store.opensAt,
                closesAt: store.closesAt,
                operatingDays: serializeDays(days),
              },
            }
          : {}),
      });

      // Spec copy for successful signup.
      toast.push({ title: 'Your account has been created successfully.', description: `Welcome to NearBuy, ${created.name.split(' ')[0]}.`, tone: 'success' });
      navigate(safeNext(next, role), { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout wide>
      <div className={`mx-auto w-full ${role === 'seller' ? 'max-w-2xl' : 'max-w-md'}`}>
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-blue-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          All roles
        </Link>

        <div className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-xl shadow-blue-900/5 sm:p-8">
          <div className="flex items-center gap-3">
            <span className={`inline-flex rounded-xl p-2.5 text-white ${meta.chip}`}>{meta.icon}</span>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
                Create your {role} account
              </h1>
              <p className="text-xs text-slate-500">{meta.tagline} · {meta.description}</p>
            </div>
          </div>

          <form className="mt-6 space-y-4" onSubmit={submit}>
            {error && <ErrorNote>{error}</ErrorNote>}

            <h2 className="border-b border-slate-100 pb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
              Your account
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Full name"
                required
                autoComplete="name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder={role === 'seller' ? 'Rahul Verma' : role === 'rider' ? 'Arjun Kumar' : 'Aarav Sharma'}
              />
              <Field
                label="Email"
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="you@example.com"
              />
              <Field
                label="Phone"
                type="tel"
                required
                autoComplete="tel"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="+91 98765 43210"
              />
              <PasswordField
                label="Password"
                value={form.password}
                onChange={(password) => setForm({ ...form, password })}
                autoComplete="new-password"
                required
                placeholder="••••••••"
              />
            </div>

            {form.password.length > 0 && !passwordReady && (
              <ul className="grid gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 sm:grid-cols-2">
                {passwordChecks.map((check) => (
                  <li key={check.label} className="flex items-center gap-1.5">
                    <CheckCircle2
                      className={`h-3 w-3 ${check.ok ? 'text-emerald-600' : 'text-slate-300'}`}
                      aria-hidden="true"
                    />
                    {check.label}
                  </li>
                ))}
              </ul>
            )}

            <PasswordField
              label="Confirm password"
              value={form.confirm}
              onChange={(confirm) => setForm({ ...form, confirm })}
              autoComplete="new-password"
              required
              placeholder="••••••••"
            />

            {role === 'rider' && (
              <>
                <h2 className="border-b border-slate-100 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Your location &amp; vehicle
                </h2>
                <Field
                  label="Address / location"
                  required
                  value={form.address}
                  onChange={(event) => setForm({ ...form, address: event.target.value })}
                  placeholder="House 12, Sector 10, Dwarka, New Delhi"
                  hint="Helps match you with deliveries close to you."
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Vehicle type"
                    options={VEHICLE_TYPES.map((type) => ({ value: type, label: type }))}
                    value={form.vehicleType}
                    onChange={(event) => setForm({ ...form, vehicleType: event.target.value })}
                  />
                  <Field
                    label="Vehicle number (optional)"
                    value={form.vehicleNumber}
                    onChange={(event) => setForm({ ...form, vehicleNumber: event.target.value })}
                    placeholder="DL 3C AB 1234"
                  />
                </div>
              </>
            )}

            {role === 'seller' && (
              <>
                <h2 className="border-b border-slate-100 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Your store
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Store name"
                    required
                    value={store.name}
                    onChange={(event) => setStore({ ...store, name: event.target.value })}
                    placeholder="Dwarka Fresh Mart"
                  />
                  <SelectField
                    label="Store category"
                    options={STORE_CATEGORIES.map((category) => ({ value: category, label: category }))}
                    value={store.category}
                    onChange={(event) => setStore({ ...store, category: event.target.value })}
                  />
                </div>
                <Field
                  label="Address"
                  required
                  value={store.address}
                  onChange={(event) => setStore({ ...store, address: event.target.value })}
                  placeholder="Shop 14, Sector 12 Market"
                />
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field
                    label="City"
                    required
                    value={store.city}
                    onChange={(event) => setStore({ ...store, city: event.target.value })}
                  />
                  <Field
                    label="State"
                    required
                    value={store.state}
                    onChange={(event) => setStore({ ...store, state: event.target.value })}
                  />
                  <Field
                    label="Pincode"
                    required
                    inputMode="numeric"
                    value={store.pincode}
                    onChange={(event) => setStore({ ...store, pincode: event.target.value })}
                    placeholder="110078"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Opening hours"
                    type="time"
                    value={store.opensAt}
                    onChange={(event) => setStore({ ...store, opensAt: event.target.value })}
                  />
                  <Field
                    label="Closing hours"
                    type="time"
                    value={store.closesAt}
                    onChange={(event) => setStore({ ...store, closesAt: event.target.value })}
                  />
                </div>
                <fieldset>
                  <legend className="mb-1.5 text-xs font-semibold text-slate-700">Operating days</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS.map((day) => {
                      const active = days.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setDays((current) =>
                              current.includes(day)
                                ? current.filter((entry) => entry !== day)
                                : [...current, day]
                            )
                          }
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            active
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-slate-300 bg-white text-slate-600 hover:border-blue-400'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </>
            )}

            {(role === 'customer' || role === 'rider') && (
              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={form.terms}
                  onChange={(event) => setForm({ ...form, terms: event.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>
                  I accept the NearBuy neighbourhood-commerce terms and confirm my details are
                  accurate. <span className="text-red-600" aria-hidden="true">*</span>
                </span>
              </label>
            )}

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              {loading ? 'Creating your account…' : meta.signupCta}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-slate-500">
            Already have an account?{' '}
            <Link to={`/${role}/auth`} className="font-semibold text-blue-700 hover:underline">
              Login
            </Link>
          </p>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
            Passwords are stored only as salted scrypt hashes — never in plaintext.
          </p>
        </div>
      </div>
    </AuthLayout>
  );
};

/* -------------------------------------------------------------------------- */
/* Account recovery (/customer/recover, /seller/recover, /rider/recover)       */
/* -------------------------------------------------------------------------- */

export const RoleRecoverPage: React.FC<{ role: Role }> = ({ role }) => {
  const params = useQueryParams();
  const meta = ROLE_META[role];
  const toast = useToast();
  const token = params.get('token');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);
  const [demoResetPath, setDemoResetPath] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    document.title = `Recover your account · NearBuy`;
  }, []);

  const requestRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await api.post<{ message: string; demoResetPath?: string }>(
        '/api/auth/recover',
        { identifier, role }
      );
      setRequested(true);
      setDemoResetPath(response.demoResetPath ?? null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/api/auth/reset', { token, password });
      setResetDone(true);
      toast.push({ title: 'Your password has been updated successfully.', tone: 'success' });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mx-auto w-full max-w-md">
        <Link
          to={`/${role}/auth`}
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-blue-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to {meta.name.toLowerCase()} login
        </Link>

        <div className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-xl shadow-blue-900/5 sm:p-8">
          <div className="flex items-center gap-3">
            <span className={`inline-flex rounded-xl p-2.5 text-white ${meta.chip}`}>
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Recover Account</h1>
              <p className="text-xs text-slate-500">{meta.name} account recovery</p>
            </div>
          </div>

          {resetDone ? (
            <div className="mt-6 space-y-4">
              <SuccessNote>Your password has been updated successfully.</SuccessNote>
              <p className="text-xs text-slate-600">
                All previous sessions were signed out for safety. Continue to login with your new password.
              </p>
              <Link
                to={`/${role}/auth`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
              >
                <Lock className="h-4 w-4" aria-hidden="true" />
                Continue to login
              </Link>
            </div>
          ) : token ? (
            <form className="mt-6 space-y-4" onSubmit={submitReset}>
              {error && <ErrorNote>{error}</ErrorNote>}
              <p className="text-sm text-slate-600">
                Choose a new password for your {meta.name.toLowerCase()} account. Reset links expire
                quickly and can only be used once.
              </p>
              <PasswordField
                label="New password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                required
                placeholder="••••••••"
                hint="At least 8 characters with an uppercase letter, a lowercase letter and a number."
              />
              <PasswordField
                label="Confirm new password"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                required
                placeholder="••••••••"
              />
              <Button type="submit" size="lg" className="w-full" loading={loading}>
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                {loading ? 'Updating password…' : 'Reset password'}
              </Button>
            </form>
          ) : requested ? (
            <div className="mt-6 space-y-4">
              <SuccessNote>
                If an account matches the information provided, recovery instructions will be sent.
              </SuccessNote>
              {demoResetPath && (
                <InfoNote>
                  <span className="font-semibold">Demo environment:</span> email delivery is not
                  configured here, so your secure reset link is shown below.{' '}
                  <Link to={demoResetPath} className="font-bold underline">
                    Open the password reset page
                  </Link>
                  .
                </InfoNote>
              )}
              <Link
                to={`/${role}/auth`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back to login
              </Link>
            </div>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={requestRecovery}>
              {error && <ErrorNote>{error}</ErrorNote>}
              <p className="text-sm text-slate-600">
                Enter the email or phone number on your {meta.name.toLowerCase()} account and we will
                start a secure password reset.
              </p>
              <Field
                label="Email or phone"
                type="text"
                required
                autoComplete="username"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="you@example.com or +91 98765 43210"
              />
              <Button type="submit" size="lg" className="w-full" loading={loading}>
                <Clock className="h-4 w-4" aria-hidden="true" />
                {loading ? 'Sending…' : 'Request recovery'}
              </Button>
              <p className="text-[11px] leading-relaxed text-slate-400">
                For your privacy we return the same confirmation whether or not the account exists.
                Reset links expire after 30 minutes and work only once.
              </p>
            </form>
          )}
        </div>
      </div>
    </AuthLayout>
  );
};
