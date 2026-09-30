import React, { useState } from 'react';
import { Bell, CheckCheck, LifeBuoy, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { Link, navigate } from '../lib/router';
import { api, errorMessage } from '../lib/api';
import { useApiResource } from '../lib/hooks';
import { formatDateTime, relativeTime } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Role } from '../types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  InfoNote,
  SectionHeader,
  SelectField,
  Skeleton,
  TextAreaField,
} from '../components/ui';

/**
 * Account features shared by all three portals. Each portal talks to its own
 * role-scoped API (`/api/<role>/...`); the server checks role + ownership.
 */

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  order: 'Orders',
  job: 'Jobs',
  delivery: 'Delivery',
  stock: 'Stock',
  reservation: 'Reservations',
  earnings: 'Earnings',
  account: 'Account',
  support: 'Support',
};

export const NotificationsPage: React.FC<{ role: Role }> = ({ role }) => {
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const resource = useApiResource(
    () =>
      api.get<{ notifications: NotificationItem[]; unreadCount: number }>(
        `/api/${role}/notifications?pageSize=50${filter === 'unread' ? '&filter=unread' : ''}`
      ),
    [role, filter],
    { pollMs: 20000 }
  );

  const open = async (item: NotificationItem) => {
    try {
      if (!item.read) await api.post(`/api/${role}/notifications/${item.id}/read`);
    } catch {
      /* navigation still proceeds */
    }
    if (item.link) navigate(item.link);
    else resource.reload();
  };

  const markAll = async () => {
    try {
      await api.post(`/api/${role}/notifications/read-all`);
      resource.reload();
      window.dispatchEvent(new CustomEvent('nearbuy:notifications-changed'));
    } catch (error) {
      toast.push({ title: errorMessage(error), tone: 'error' });
    }
  };

  const items = resource.data?.notifications ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <SectionHeader
        as="h1"
        title="Notifications"
        subtitle={`${resource.data?.unreadCount ?? 0} unread`}
        action={
          <Button variant="secondary" size="sm" onClick={markAll} disabled={!resource.data?.unreadCount}>
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> Mark all read
          </Button>
        }
      />
      <div className="mb-3 flex gap-2" role="tablist" aria-label="Filter notifications">
        {(['all', 'unread'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              filter === value ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            {value === 'all' ? 'All' : 'Unread'}
          </button>
        ))}
      </div>
      {resource.error && <ErrorNote>{resource.error}</ErrorNote>}
      {resource.loading && !resource.data && <Skeleton className="h-40" />}
      {resource.data && items.length === 0 && (
        <EmptyState
          title={filter === 'unread' ? 'You are all caught up' : 'No notifications yet'}
          description="Order, stock and account updates will show up here."
          icon={<Bell className="h-8 w-8" aria-hidden="true" />}
        />
      )}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => open(item)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                item.read ? 'border-slate-200 bg-white' : 'border-blue-200 bg-blue-50/60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className={`text-sm ${item.read ? 'font-medium' : 'font-bold'} text-slate-900`}>{item.title}</p>
                <Badge tone={item.read ? 'neutral' : 'info'}>{TYPE_LABELS[item.type] ?? item.type}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-slate-600">{item.body}</p>
              <p className="mt-1 text-[11px] text-slate-400">{relativeTime(item.createdAt)}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Support                                                                    */
/* -------------------------------------------------------------------------- */

interface Ticket {
  id: string;
  category: string;
  subject: string;
  message: string;
  status: string;
  created_at: string;
  order_number?: string | null;
}

export const SupportPage: React.FC<{ role: Role }> = ({ role }) => {
  const toast = useToast();
  const categories = useApiResource(() => api.get<{ categories: string[] }>(`/api/${role}/support/categories`), [role]);
  const tickets = useApiResource(() => api.get<{ tickets: Ticket[] }>(`/api/${role}/support/tickets`), [role]);
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ message: string }>(`/api/${role}/support/tickets`, {
        category: category || categories.data?.categories[0],
        subject,
        message,
      });
      toast.push({ title: result.message, tone: 'success' });
      setSubject('');
      setMessage('');
      tickets.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <SectionHeader as="h1" title="Help & support" subtitle="Tell us what went wrong. Requests are stored against your account." />
      <Card className="p-4 sm:p-5">
        <form onSubmit={submit} className="space-y-3" noValidate>
          <SelectField
            label="Topic"
            value={category || categories.data?.categories[0] || ''}
            onChange={(event) => setCategory(event.target.value)}
            options={(categories.data?.categories ?? []).map((c) => ({ value: c, label: c }))}
          />
          <Field label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} required />
          <TextAreaField
            label="Message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            maxLength={2000}
            hint="Include the order number if this is about an order."
            required
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" loading={busy} disabled={subject.trim().length < 3 || message.trim().length < 10}>
            <LifeBuoy className="h-4 w-4" aria-hidden="true" /> Send to support
          </Button>
        </form>
      </Card>
      <div>
        <h2 className="mb-2 text-sm font-bold text-slate-900">Your requests</h2>
        {tickets.data && tickets.data.tickets.length === 0 && (
          <p className="text-xs text-slate-500">You have not contacted support yet.</p>
        )}
        <ul className="space-y-2">
          {(tickets.data?.tickets ?? []).map((ticket) => (
            <li key={ticket.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{ticket.subject}</p>
                <Badge tone={ticket.status === 'open' ? 'warning' : 'success'}>{ticket.status}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {ticket.category} · {formatDateTime(ticket.created_at)}
                {ticket.order_number ? ` · #${ticket.order_number}` : ''}
              </p>
              <p className="mt-1 text-xs text-slate-700">{ticket.message}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Settings & security                                                        */
/* -------------------------------------------------------------------------- */

const PREFERENCE_LABELS: Record<string, string> = {
  orderNotifications: 'Order updates',
  stockNotifications: 'Stock request updates',
  reservationNotifications: 'Reservation updates',
  emailNotifications: 'Email notifications',
  shareUsageData: 'Share anonymous usage data',
  lowStockNotifications: 'Low-stock alerts',
  requestNotifications: 'Stock request & reservation alerts',
  jobNotifications: 'New delivery job alerts',
  earningsNotifications: 'Earnings updates',
};

interface SessionRow {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export const SecuritySettingsPage: React.FC<{ role: Role }> = ({ role }) => {
  const toast = useToast();
  const { logout } = useAuth();
  const settings = useApiResource(
    () => api.get<{ preferences: Record<string, boolean> }>(`/api/${role}/settings`),
    [role]
  );
  const sessions = useApiResource(() => api.get<{ sessions: SessionRow[] }>(`/api/${role}/security/sessions`), [role]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = async (key: string, value: boolean) => {
    try {
      await api.put(`/api/${role}/settings`, { preferences: { [key]: value } });
      settings.reload();
    } catch (err) {
      toast.push({ title: errorMessage(err), tone: 'error' });
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ message: string }>(`/api/${role}/security/password`, {
        currentPassword,
        newPassword,
      });
      toast.push({ title: result.message, tone: 'success' });
      setCurrentPassword('');
      setNewPassword('');
      sessions.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.post(`/api/${role}/security/sessions/${id}/revoke`);
      sessions.reload();
    } catch (err) {
      toast.push({ title: errorMessage(err), tone: 'error' });
    }
  };

  const logoutEverywhere = async () => {
    try {
      await api.post(`/api/${role}/security/logout-all`);
      await logout().catch(() => undefined);
      navigate('/');
    } catch (err) {
      toast.push({ title: errorMessage(err), tone: 'error' });
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <SectionHeader as="h1" title="Settings & security" />

      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-bold text-slate-900">Notification preferences</h2>
        <div className="mt-3 divide-y divide-slate-100">
          {Object.entries(settings.data?.preferences ?? {}).map(([key, value]) => (
            <label key={key} className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-2">
              <span className="text-sm text-slate-700">{PREFERENCE_LABELS[key] ?? key}</span>
              <input
                type="checkbox"
                checked={value}
                onChange={(event) => toggle(key, event.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-blue-600"
              />
            </label>
          ))}
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <ShieldCheck className="h-4 w-4 text-blue-700" aria-hidden="true" /> Change password
        </h2>
        <form onSubmit={changePassword} className="mt-3 space-y-3" noValidate>
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters with a letter and a number."
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" loading={busy} disabled={!currentPassword || newPassword.length < 8}>
            Update password
          </Button>
          <InfoNote>Changing your password signs out every other device.</InfoNote>
        </form>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Smartphone className="h-4 w-4 text-blue-700" aria-hidden="true" /> Active sessions
        </h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {(sessions.data?.sessions ?? []).map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-800">
                  {session.userAgent?.slice(0, 60) || 'Unknown device'}{' '}
                  {session.current && <Badge tone="success">This device</Badge>}
                </p>
                <p className="text-[11px] text-slate-500">Last active {relativeTime(session.lastSeenAt)}</p>
              </div>
              {!session.current && (
                <Button variant="secondary" size="sm" onClick={() => revoke(session.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Button variant="danger" size="sm" className="mt-3" onClick={logoutEverywhere}>
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out of all devices
        </Button>
      </Card>

      <p className="text-center text-xs text-slate-500">
        Need help? <Link to={`/${role}/support`} className="font-semibold text-blue-700">Contact support</Link>
      </p>
    </div>
  );
};
