import React, { useState } from 'react';
import {
  BadgeIndianRupee,
  Bike,
  CheckCircle2,
  Clock,
  KeyRound,
  MapPin,
  Navigation,
  Package,
  Phone,
  ShieldCheck,
  Store as StoreIcon,
} from 'lucide-react';
import { Link, navigate } from '../lib/router';
import { api, errorMessage } from '../lib/api';
import { useApiResource } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
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
  Spinner,
  StatCard,
  SuccessNote,
} from '../components/ui';
import { formatDateTime, formatINR, orderStatusMeta, relativeTime } from '../lib/format';
import type { DeliveryJob } from '../types';

interface RiderDashboardResponse {
  rider: {
    id: string;
    name: string;
    phone: string | null;
    vehicleType: string | null;
    vehicleNumber: string | null;
    onboardingCompleted: boolean;
  };
  availableCount: number;
  availableJobs: DeliveryJob[];
  activeJob: DeliveryJob | null;
  earnings: { completedJobs: number; total: number; today: number };
}

const OnboardingNotice: React.FC = () => (
  <InfoNote>
    <span className="font-semibold">Complete your rider profile first.</span> Add a contact number, vehicle type and
    vehicle number so stores know who is collecting their orders.{' '}
    <Link to="/rider/profile" className="font-semibold underline">
      Open profile
    </Link>
  </InfoNote>
);

export const RiderDashboardPage: React.FC = () => {
  const resource = useApiResource(() => api.get<RiderDashboardResponse>('/api/rider/dashboard'), [], {
    pollMs: 15000,
  });

  if (resource.loading && !resource.data) return <Spinner label="Loading your dashboard…" />;
  if (resource.error) return <ErrorNote>{resource.error}</ErrorNote>;
  if (!resource.data) return null;

  const { rider, availableCount, availableJobs, activeJob, earnings } = resource.data;

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h1"
        title={`Namaste, ${rider.name.split(' ')[0]}`}
        subtitle={
          rider.vehicleNumber
            ? `${rider.vehicleType ?? 'Vehicle'} · ${rider.vehicleNumber}`
            : 'Add your vehicle details to start claiming deliveries'
        }
        action={
          <Button variant="secondary" onClick={() => navigate('/rider/jobs')}>
            View available jobs
          </Button>
        }
      />

      {!rider.onboardingCompleted && <OnboardingNotice />}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Today's earnings"
          value={formatINR(earnings.today)}
          icon={<BadgeIndianRupee className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
        />
        <StatCard label="Total earnings" value={formatINR(earnings.total)} hint={`${earnings.completedJobs} completed deliveries`} />
        <StatCard label="Available now" value={availableCount} hint="Orders waiting for a rider" />
      </div>

      <section aria-labelledby="active-delivery" className="space-y-3">
        <h2 id="active-delivery" className="text-sm font-bold text-slate-900">
          Active delivery
        </h2>
        {activeJob ? (
          <ActiveJobCard job={activeJob} onChanged={resource.reload} />
        ) : (
          <Card className="p-5 text-center">
            <p className="text-sm font-semibold text-slate-800">No active delivery</p>
            <p className="mt-1 text-xs text-slate-500">
              Claim an available job to start earning ₹40 per completed delivery.
            </p>
            <Button className="mt-3" onClick={() => navigate('/rider/jobs')}>
              Browse available jobs
            </Button>
          </Card>
        )}
      </section>

      <section aria-labelledby="available-preview" className="space-y-3">
        <h2 id="available-preview" className="text-sm font-bold text-slate-900">
          Ready for pickup near you
        </h2>
        {availableJobs.length === 0 ? (
          <EmptyState
            icon={<Package className="h-8 w-8" aria-hidden="true" />}
            title="No jobs ready for pickup right now"
            description="You will see jobs here as soon as a store marks an order ready for pickup."
          />
        ) : (
          <div className="space-y-3">
            {availableJobs.map((job) => (
              <JobCard key={job.jobId} job={job} onChanged={resource.reload} claimable />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

const JobCard: React.FC<{ job: DeliveryJob; onChanged: () => void; claimable?: boolean; upcoming?: boolean }> = ({
  job,
  onChanged,
  claimable,
  upcoming,
}) => {
  const toast = useToast();
  const { user } = useAuth();
  const [claiming, setClaiming] = useState(false);

  const claim = async () => {
    if (!user?.onboardingCompleted) {
      toast.push({
        title: 'Complete your rider profile',
        description: 'Add your contact number and vehicle details before claiming deliveries.',
        tone: 'error',
      });
      navigate('/rider/profile');
      return;
    }
    setClaiming(true);
    try {
      await api.post(`/api/rider/jobs/${job.jobId}/claim`);
      toast.push({ title: 'Delivery claimed', description: 'Collect the pickup code from the store.', tone: 'success' });
      onChanged();
      navigate(`/rider/jobs/${job.jobId}`);
    } catch (error) {
      toast.push({ title: 'Could not claim delivery', description: errorMessage(error), tone: 'error' });
      onChanged();
    } finally {
      setClaiming(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-900">{job.orderNumber}</span>
            <Badge tone={upcoming ? 'warning' : 'success'}>
              {upcoming ? 'Waiting for store' : 'Ready for pickup'}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {job.itemCount} item(s) · order value {formatINR(job.orderTotal)} · {relativeTime(job.createdAt)}
          </p>
        </div>
        <span className="text-sm font-extrabold tabular-nums text-emerald-700">{formatINR(job.earnings)}</span>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
        <div className="flex items-start gap-2">
          <StoreIcon className="mt-0.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span>
            <span className="font-semibold text-slate-800">Pickup:</span> {job.store.name}
            <br />
            {job.store.address}, {job.store.city}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span>
            <span className="font-semibold text-slate-800">Drop:</span>{' '}
            {job.drop ? `${job.drop.address}, ${job.drop.city} ${job.drop.pincode}` : `${job.dropCity ?? 'Dwarka'} ${job.dropPincode ?? ''}`}
          </span>
        </div>
      </div>

      {claimable && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          <Button size="sm" onClick={claim} loading={claiming}>
            <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
            Claim job
          </Button>
          <Link
            to={`/rider/jobs/${job.jobId}`}
            className="inline-flex items-center rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
          >
            View details
          </Link>
        </div>
      )}
    </Card>
  );
};

const ActiveJobCard: React.FC<{ job: DeliveryJob; onChanged: () => void }> = ({ job, onChanged }) => {
  const toast = useToast();
  const [pickupCode, setPickupCode] = useState('');
  const [deliveryCode, setDeliveryCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const submit = async (type: 'pickup' | 'delivery') => {
    const code = type === 'pickup' ? pickupCode : deliveryCode;
    if (!code.trim()) {
      toast.push({ title: 'Enter the code', tone: 'error' });
      return;
    }
    setBusy(type);
    try {
      const result = await api.post<{ message: string }>(`/api/rider/jobs/${job.jobId}/verify-${type}`, {
        [type === 'pickup' ? 'pickupCode' : 'deliveryCode']: code,
      });
      toast.push({ title: 'Verified', description: result.message, tone: 'success' });
      setPickupCode('');
      setDeliveryCode('');
      onChanged();
    } catch (error) {
      toast.push({ title: 'Verification failed', description: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const release = async () => {
    setBusy('release');
    try {
      await api.post(`/api/rider/jobs/${job.jobId}/release`);
      toast.push({ title: 'Job released', description: 'It is available to other riders again.', tone: 'success' });
      onChanged();
    } catch (error) {
      toast.push({ title: 'Could not release job', description: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const orderMeta = orderStatusMeta(job.orderStatus);
  const awaitingPickupReady = job.jobStatus === 'claimed' && job.orderStatus !== 'ready_for_pickup';
  const needsPickup = job.jobStatus === 'claimed' && job.orderStatus === 'ready_for_pickup';
  const needsDelivery = job.jobStatus === 'out_for_delivery' || job.jobStatus === 'pickup_verified';

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-900">{job.orderNumber}</span>
            <Badge tone={orderMeta.tone}>{orderMeta.label}</Badge>
            <Badge tone="info">{job.itemCount} item(s)</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {awaitingPickupReady
              ? orderMeta.riderHint ?? 'Waiting for the store to mark this order ready for pickup.'
              : needsPickup
                ? 'Collect the order and ask the store for their 4-digit pickup code.'
                : 'Deliver the order and ask the customer for their delivery code.'}
          </p>
        </div>
        <span className="text-base font-extrabold tabular-nums text-emerald-700">{formatINR(job.earnings)}</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-slate-900">
            <StoreIcon className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            Pickup · {job.store.name}
          </p>
          <p className="mt-1 text-slate-600">
            {job.store.address}, {job.store.city}
          </p>
          {job.store.phone && (
            <p className="mt-1 inline-flex items-center gap-1 text-slate-500">
              <Phone className="h-3 w-3" aria-hidden="true" />
              {job.store.phone}
            </p>
          )}
          {job.store.openingHours && <p className="mt-1 text-slate-500">{job.store.openingHours}</p>}
        </div>
        <div className="rounded-xl border border-slate-200 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-slate-900">
            <MapPin className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            Delivering to {job.drop?.name ?? 'customer'}
          </p>
          <p className="mt-1 text-slate-600">
            {job.drop ? `${job.drop.address}, ${job.drop.city} ${job.drop.pincode}` : `${job.dropCity ?? ''} ${job.dropPincode ?? ''}`}
          </p>
          {job.customerPhone && (
            <p className="mt-1 inline-flex items-center gap-1 text-slate-500">
              <Phone className="h-3 w-3" aria-hidden="true" />
              {job.customerPhone}
            </p>
          )}
        </div>
      </div>

      {awaitingPickupReady && (
        <InfoNote className="mt-4">
          This order is not marked ready for pickup yet. You will be able to verify the pickup code once the store
          finishes packing — the server rejects premature pickups.
        </InfoNote>
      )}

      {needsPickup && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <label htmlFor={`pickup-${job.jobId}`} className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            Store pickup code
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id={`pickup-${job.jobId}`}
              value={pickupCode}
              onChange={(event) => setPickupCode(event.target.value)}
              placeholder="PK-1234"
              autoComplete="off"
              className="w-40 rounded-lg border border-amber-300 px-3 py-2 font-mono text-sm uppercase tracking-widest text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
            />
            <Button onClick={() => submit('pickup')} loading={busy === 'pickup'}>
              Verify pickup
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-amber-900">
            Ask the store staff for the code shown on their order screen. Five wrong attempts temporarily locks this step.
          </p>
        </div>
      )}

      {needsDelivery && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <label htmlFor={`delivery-${job.jobId}`} className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Customer delivery code
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id={`delivery-${job.jobId}`}
              value={deliveryCode}
              onChange={(event) => setDeliveryCode(event.target.value)}
              placeholder="DL-1234"
              autoComplete="off"
              className="w-40 rounded-lg border border-emerald-300 px-3 py-2 font-mono text-sm uppercase tracking-widest text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
            <Button onClick={() => submit('delivery')} loading={busy === 'delivery'}>
              Complete delivery
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-emerald-900">
            Only the customer can see this code — ask them for it when you hand over the order.
          </p>
        </div>
      )}

      {job.jobStatus === 'claimed' && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <Button variant="ghost" size="sm" loading={busy === 'release'} onClick={release}>
            Release this job back to the pool
          </Button>
        </div>
      )}
    </Card>
  );
};

export const RiderJobsPage: React.FC = () => {
  const { user } = useAuth();
  const resource = useApiResource(
    () => api.get<{ jobs: DeliveryJob[]; upcoming: DeliveryJob[] }>('/api/rider/jobs/available'),
    [],
    { pollMs: 15000 }
  );

  if (resource.loading && !resource.data) return <Spinner label="Loading delivery jobs…" />;
  if (resource.error) return <ErrorNote>{resource.error}</ErrorNote>;

  const jobs = resource.data?.jobs ?? [];
  const upcoming = resource.data?.upcoming ?? [];

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h1"
        title="Available delivery jobs"
        subtitle="Jobs appear here when a store marks an order ready for pickup. Claiming is atomic — only one rider can win."
      />

      {!user?.onboardingCompleted && <OnboardingNotice />}

      {jobs.length === 0 ? (
        <EmptyState
          icon={<Package className="h-8 w-8" aria-hidden="true" />}
          title="Nothing ready for pickup right now"
          description="Stores in Dwarka mark orders ready throughout the day — this list refreshes automatically."
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <JobCard key={job.jobId} job={job} onChanged={resource.reload} claimable />
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming" className="space-y-3">
          <h2 id="upcoming" className="text-sm font-bold text-slate-900">
            Being prepared by the store
          </h2>
          <div className="space-y-3">
            {upcoming.map((job) => (
              <JobCard key={job.jobId} job={job} onChanged={resource.reload} upcoming />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export const RiderJobDetailPage: React.FC<{ jobId: string }> = ({ jobId }) => {
  const resource = useApiResource(() => api.get<{ job: DeliveryJob }>(`/api/rider/jobs/${jobId}`), [jobId], {
    pollMs: 15000,
  });

  if (resource.loading && !resource.data) return <Spinner label="Loading job…" />;
  if (resource.error) return <ErrorNote>{resource.error}</ErrorNote>;
  if (!resource.data) return null;

  const job = resource.data.job;
  const isMine = job.jobStatus !== 'available';

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
        <Link to="/rider/jobs" className="hover:text-slate-800">
          Jobs
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-medium text-slate-700">{job.orderNumber}</span>
      </nav>

      {isMine ? (
        <ActiveJobCard job={job} onChanged={resource.reload} />
      ) : (
        <JobCard job={job} onChanged={resource.reload} claimable />
      )}

      {job.order?.timeline && job.order.timeline.length > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-900">Order timeline</h2>
          <ol className="mt-3 space-y-3">
            {job.order.timeline.map((event, index) => (
              <li key={index} className="flex gap-3 text-xs">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-slate-900">{event.note || event.event_type.replace(/_/g, ' ')}</p>
                  <p className="text-slate-500">{formatDateTime(event.created_at)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
};

export const RiderHistoryPage: React.FC = () => {
  const historyResource = useApiResource(() => api.get<{ jobs: DeliveryJob[] }>('/api/rider/history'), []);
  const earningsResource = useApiResource(
    () =>
      api.get<{
        summary: { totalJobs: number; completedJobs: number; totalEarnings: number };
        daily: { day: string; jobs: number; earnings: number }[];
      }>('/api/rider/earnings'),
    []
  );

  if (historyResource.loading && !historyResource.data) return <Spinner label="Loading delivery history…" />;
  if (historyResource.error) return <ErrorNote>{historyResource.error}</ErrorNote>;

  const jobs = historyResource.data?.jobs ?? [];
  const summary = earningsResource.data?.summary;

  return (
    <div className="space-y-6">
      <SectionHeader as="h1" title="Delivery history & earnings" subtitle="Every completed delivery and its payout." />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Completed deliveries" value={summary?.completedJobs ?? 0} />
        <StatCard label="Total jobs assigned" value={summary?.totalJobs ?? 0} />
        <StatCard label="Lifetime earnings" value={formatINR(summary?.totalEarnings ?? 0)} />
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          icon={<Bike className="h-8 w-8" aria-hidden="true" />}
          title="No deliveries yet"
          description="Claim your first job from the available list to start building history."
          action={<Button onClick={() => navigate('/rider/jobs')}>Browse jobs</Button>}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-xs">
            <caption className="sr-only">Delivery history</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">Order</th>
                <th scope="col" className="px-4 py-2">Store</th>
                <th scope="col" className="px-4 py-2">Status</th>
                <th scope="col" className="px-4 py-2">Delivered</th>
                <th scope="col" className="px-4 py-2 text-right">Earnings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <tr key={job.jobId}>
                  <td className="px-4 py-3">
                    <Link to={`/rider/jobs/${job.jobId}`} className="font-semibold text-slate-900 hover:text-blue-700">
                      {job.orderNumber}
                    </Link>
                    <span className="block text-[11px] text-slate-500">{job.itemCount} item(s)</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{job.store.name}</td>
                  <td className="px-4 py-3">
                    <Badge tone={job.jobStatus === 'completed' ? 'success' : job.jobStatus === 'cancelled' ? 'danger' : 'info'}>
                      {job.jobStatus === 'completed' ? 'Completed' : job.jobStatus.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {job.deliveredAt ? formatDateTime(job.deliveredAt) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                    {job.jobStatus === 'completed' ? formatINR(job.earnings) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {(earningsResource.data?.daily ?? []).length > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-900">Daily earnings</h2>
          <ul className="mt-3 space-y-2">
            {(earningsResource.data?.daily ?? []).map((row) => (
              <li key={row.day} className="flex items-center justify-between text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3 w-3 text-slate-400" aria-hidden="true" />
                  {row.day}
                </span>
                <span className="tabular-nums">
                  {row.jobs} delivery(ies) · {formatINR(row.earnings)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};

export const RiderProfilePage: React.FC = () => {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    name: user?.name ?? '',
    phone: user?.phone ?? '',
    vehicleType: user?.vehicleType ?? 'Bike',
    vehicleNumber: user?.vehicleNumber ?? '',
    licenseNumber: user?.licenseNumber ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const complete = Boolean(form.phone && form.vehicleType && form.vehicleNumber);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.put<{ message: string }>('/api/rider/profile', form);
      setMessage(result.message);
      await refresh();
      toast.push({ title: 'Profile saved', description: result.message, tone: 'success' });
    } catch (error) {
      toast.push({ title: 'Could not save profile', description: errorMessage(error), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SectionHeader
        as="h1"
        title="Rider profile"
        subtitle="Stores and customers only see what is needed to complete a delivery."
      />

      {user?.onboardingCompleted ? (
        <SuccessNote>
          Your rider profile is complete — you can claim deliveries. Contact details are shared with a store only after
          you claim their job.
        </SuccessNote>
      ) : (
        <InfoNote>
          Complete your profile to start claiming deliveries: contact number, vehicle type and vehicle number are
          required.
        </InfoNote>
      )}

      <Card className="p-6">
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <Field
              label="Contact number"
              required
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="+91 98111 22334"
            />
            <SelectField
              label="Vehicle type"
              value={form.vehicleType}
              onChange={(event) => setForm({ ...form, vehicleType: event.target.value })}
              options={[
                { value: 'Bike', label: 'Bike' },
                { value: 'Scooter', label: 'Scooter' },
                { value: 'Bicycle', label: 'Bicycle' },
                { value: 'Electric scooter', label: 'Electric scooter' },
                { value: 'On foot', label: 'On foot' },
              ]}
            />
            <Field
              label="Vehicle number"
              required
              value={form.vehicleNumber}
              onChange={(event) => setForm({ ...form, vehicleNumber: event.target.value })}
              placeholder="DL 3C AB 1234"
            />
          </div>
          <Field
            label="Driving licence number (optional)"
            value={form.licenseNumber}
            onChange={(event) => setForm({ ...form, licenseNumber: event.target.value })}
            placeholder="DL-0420110012345"
          />

          {message && <SuccessNote>{message}</SuccessNote>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-[11px] text-slate-500">
              {complete ? 'All required details are present.' : 'Contact number, vehicle type and vehicle number are required.'}
            </p>
            <Button type="submit" loading={saving}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Save profile
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
