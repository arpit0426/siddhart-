import React, { useEffect, useState } from 'react';
import {
  Bell,
  Building2,
  ChevronRight,
  Eye,
  LogOut,
  ShieldCheck,
  Store as StoreIcon,
  UserCircle,
} from 'lucide-react';
import { Link, navigate } from '../lib/router';
import { api, errorMessage } from '../lib/api';
import { useApiResource } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, ErrorNote, Field, InfoNote, SectionHeader, Skeleton, Spinner } from '../components/ui';
import { initials, storeState, StoreStatusPill } from '../components/layout/SellerShell';
import { formatDate } from '../lib/format';
import { resetSavedCache } from '../lib/saved';
import type { Store } from '../types';

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

export const SellerProfilePage: React.FC = () => {
  const { user, refresh, logout } = useAuth();
  const toast = useToast();
  const store = useApiResource(() => api.get<{ store: Store | null }>('/api/seller/store'), []);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setName(user?.name ?? '');
      setPhone(user?.phone ?? '');
    }
  }, [user, editing]);

  if (!user) return <Spinner label="Loading profile…" />;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.put('/api/seller/profile', { name, phone: phone || undefined });
      await refresh();
      toast.push({ title: 'Profile updated', tone: 'success' });
      setEditing(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    resetSavedCache();
    await logout();
    navigate('/', { replace: true });
  };

  const rows: [string, React.ReactNode][] = [
    ['Full name', user.name],
    ['Email', user.email],
    ['Phone', user.phone || 'Not added'],
    ['Role', <Badge key="role" tone="info">Seller</Badge>],
    ['Store', store.data?.store?.name ?? (store.loading ? 'Loading…' : 'No store yet')],
    ['Joined', user.createdAt ? formatDate(user.createdAt) : '—'],
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <SectionHeader as="h1" title="Profile" subtitle="Your seller account details." />
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#1769E0] text-xl font-bold text-white">
            {initials(user.name)}
          </span>
          <div>
            <p className="text-lg font-bold text-[#172033]">{user.name}</p>
            <p className="text-sm text-[#667085]">{user.email}</p>
          </div>
        </div>

        {editing ? (
          <form onSubmit={save} className="mt-5 space-y-4">
            {error && <ErrorNote>{error}</ErrorNote>}
            <Field label="Full name" required value={name} onChange={(e) => setName(e.target.value)} />
            <Field label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98112 34567" />
            <p className="text-xs text-[#667085]">Your email is your sign-in identity and can&apos;t be changed here.</p>
            <div className="flex gap-2">
              <Button type="submit" loading={saving}>
                Save changes
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <dl className="mt-5 divide-y divide-slate-100 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-[#667085]">{label}</dt>
                <dd className="text-right font-medium text-[#172033]">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {!editing && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <Button onClick={() => setEditing(true)}>Edit Profile</Button>
            <Button variant="secondary" onClick={() => navigate('/seller/settings/security')}>
              Change Password
            </Button>
            <Button variant="danger" onClick={signOut} className="sm:ml-auto">
              <LogOut className="h-4 w-4" aria-hidden="true" /> Logout
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Business profile                                                           */
/* -------------------------------------------------------------------------- */

export const SellerBusinessPage: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const resource = useApiResource(() => api.get<{ store: Store | null }>('/api/seller/store'), []);
  const [form, setForm] = useState({ legalName: '', businessEmail: '', supportPhone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const store = resource.data?.store ?? null;

  useEffect(() => {
    if (!store) return;
    setForm({
      legalName: store.legal_name ?? '',
      businessEmail: store.business_email ?? '',
      supportPhone: store.support_phone ?? '',
    });
  }, [store]);

  if (resource.loading && !resource.data) return <Skeleton className="h-64" />;
  if (resource.error && !resource.data) {
    return (
      <div className="space-y-3">
        <ErrorNote>We couldn&apos;t load your business profile. {resource.error}</ErrorNote>
        <Button variant="secondary" onClick={resource.reload}>
          Try Again
        </Button>
      </div>
    );
  }

  if (!store) {
    return (
      <InfoNote>
        Create your store first, then add your business details.{' '}
        <Link to="/seller/store" className="font-semibold underline">
          Create store
        </Link>
      </InfoNote>
    );
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.put('/api/seller/store/settings', form);
      toast.push({ title: 'Business profile saved', tone: 'success' });
      resource.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <SectionHeader
        as="h1"
        title="Business Profile"
        subtitle="Used for settlements and support. Sensitive verification details are never shown to customers."
      />
      <Card className="p-5 sm:p-6">
        <form onSubmit={save} className="space-y-4">
          {error && <ErrorNote>{error}</ErrorNote>}
          <Field
            label="Legal / business name"
            value={form.legalName}
            onChange={(e) => setForm({ ...form, legalName: e.target.value })}
            placeholder="Dwarka Fresh Mart Pvt. Ltd."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner name" value={user?.name ?? ''} readOnly hint="Change this in Account → Profile." />
            <Field label="Owner phone" value={user?.phone ?? ''} readOnly />
            <Field label="Owner email" value={user?.email ?? ''} readOnly />
            <Field label="Business category" value={store.category} readOnly hint="Edit in Store settings." />
          </div>
          <Field label="Address" value={`${store.address}, ${store.city}, ${store.state} ${store.pincode}`} readOnly />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Business email"
              type="email"
              value={form.businessEmail}
              onChange={(e) => setForm({ ...form, businessEmail: e.target.value })}
              placeholder="accounts@yourstore.in"
            />
            <Field
              label="Support contact"
              value={form.supportPhone}
              onChange={(e) => setForm({ ...form, supportPhone: e.target.value })}
              placeholder="+91 98112 34567"
            />
          </div>
          <div className="flex justify-end border-t border-slate-100 pt-4">
            <Button type="submit" loading={saving}>
              Save business profile
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Settings hub                                                               */
/* -------------------------------------------------------------------------- */

export const SellerSettingsPage: React.FC = () => {
  const resource = useApiResource(() => api.get<{ store: Store | null }>('/api/seller/store'), []);
  const store = resource.data?.store ?? null;

  const sections: { title: string; description: string; to: string; icon: React.ReactNode }[] = [
    { title: 'Store', description: 'Identity, location, hours, delivery & pickup, availability.', to: '/seller/store', icon: <StoreIcon className="h-5 w-5" aria-hidden="true" /> },
    { title: 'Account', description: 'Your name, phone and role.', to: '/seller/profile', icon: <UserCircle className="h-5 w-5" aria-hidden="true" /> },
    { title: 'Business', description: 'Legal name, business email and support contact.', to: '/seller/business', icon: <Building2 className="h-5 w-5" aria-hidden="true" /> },
    { title: 'Notifications', description: 'Orders, stock requests, reservations and low-stock alerts.', to: '/seller/notifications', icon: <Bell className="h-5 w-5" aria-hidden="true" /> },
    { title: 'Security', description: 'Password, active sessions and sign-out everywhere.', to: '/seller/settings/security', icon: <ShieldCheck className="h-5 w-5" aria-hidden="true" /> },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <SectionHeader as="h1" title="Settings" subtitle="Manage your store, account and security." />
      {store && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-semibold text-[#172033]">{store.name}</p>
            <p className="text-xs text-[#667085]">
              {store.supports_delivery !== 0 ? 'Delivery' : ''}
              {store.supports_delivery !== 0 && store.supports_pickup !== 0 ? ' + ' : ''}
              {store.supports_pickup !== 0 ? 'Pickup' : ''} · {store.city}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StoreStatusPill state={storeState(store)} />
            <Link to="/seller/store" className="inline-flex items-center gap-1 text-xs font-semibold text-[#1769E0] hover:underline">
              <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Preview &amp; manage
            </Link>
          </div>
        </Card>
      )}
      <ul className="space-y-2">
        {sections.map((section) => (
          <li key={section.to}>
            <Link
              to={section.to}
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:bg-slate-50"
            >
              <span className="rounded-xl bg-[#EAF3FF] p-2.5 text-[#1769E0]">{section.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[#172033]">{section.title}</span>
                <span className="block text-xs text-[#667085]">{section.description}</span>
              </span>
              <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};
