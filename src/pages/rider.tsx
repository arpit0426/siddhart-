import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BadgeIndianRupee,
  Bike,
  CheckCircle2,
  Clock,
  KeyRound,
  MapPin,
  Navigation,
  Package,
  Phone,
  Power,
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
  Modal,
  SectionHeader,
  SelectField,
  Skeleton,
  Spinner,
  StatCard,
  SuccessNote,
  TextAreaField,
} from '../components/ui';
import { formatDateTime, formatDate, formatINR, jobStatusMeta, orderStatusMeta, relativeTime } from '../lib/format';
import type { DeliveryJob } from '../types';

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

interface DashboardResponse {
  rider: {
    id: string;
    name: string;
    phone: string | null;
    vehicleType: string | null;
    vehicleNumber: string | null;
    onboardingCompleted: boolean;
    availability: 'online' | 'offline';
    accountStatus: string;
    serviceArea: string | null;
  };
  availableCount: number;
  availableJobs: DeliveryJob[];
  activeJob: DeliveryJob | null;
  kpis: { todaysDeliveries: number; todaysEarnings: number; pendingJobs: number; completedToday: number };
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

const AvailabilityToggle: React.FC<{
  availability: 'online' | 'offline';
  disabledReason?: string | null;
  onChanged: () => void;
}> = ({ availability, disabledReason, onChanged }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const online = availability === 'online';

  const toggle = async () => {
    setBusy(true);
    try {
      const result = await api.put<{ message: string }>('/api/rider/availability', {
        availability: online ? 'offline' : 'online',
      });
      toast.push({ title: result.message, tone: 'success' });
      onChanged();
    } catch (error) {
      toast.push({ title: "Couldn't change status", description: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={`p-4 ${online ? 'border-emerald-200 bg-emerald-50/60' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-300'}`}
              aria-hidden="true"
            />
            You are {online ? 'online' : 'offline'}
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            {online ? 'Eligible delivery jobs are shown below.' : 'Go online to see and claim delivery jobs.'}
          </p>
        </div>
        <Button
          variant={online ? 'secondary' : 'primary'}
          onClick={toggle}
          loading={busy}
          disabled={Boolean(disabledReason)}
          aria-pressed={online}
          className="min-h-[44px]"
        >
          <Power className="h-4 w-4" aria-hidden="true" />
          {online ? 'Go offline' : 'Go online'}
        </Button>
      </div>
      {disabledReason && <p className="mt-2 text-[11px] text-amber-700">{disabledReason}</p>}
    </Card>
  );
};

const JobCard: React.FC<{ job: DeliveryJob; action?: React.ReactNode }> = ({ job, action }) => (
  <Card className="p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <StoreIcon className="h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
          <span className="truncate">{job.store.name}</span>
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          #{job.orderNumber} · {job.itemCount} item{job.itemCount === 1 ? '' : 's'}
        </p>
      </div>
      <div className="text-right">
        <p className="text-base font-extrabold tabular-nums text-emerald-700">{formatINR(job.earnings)}</p>
        <p className="text-[10px] uppercase tracking-wide text-slate-400">Your pay</p>
      </div>
    </div>
    <dl className="mt-3 space-y-1.5 text-xs text-slate-600">
      <div className="flex items-start gap-1.5">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        <span>
          <span className="font-semibold text-slate-700">Pickup:</span> {job.pickupArea}
        </span>
      </div>
      <div className="flex items-start gap-1.5">
        <Navigation className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        <span>
          <span className="font-semibold text-slate-700">Drop:</span> {job.deliveryArea}
          {job.distanceKm != null && ` · ${job.distanceKm} km`}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        <span>Ready {relativeTime(job.createdAt)}</span>
      </div>
    </dl>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Link
        to={`/rider/jobs/${job.jobId}`}
        className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
      >
        View details
      </Link>
      {action}
    </div>
  </Card>
);

function useClaim(onClaimed: () => void) {
  const toast = useToast();
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const claim = async (job: DeliveryJob) => {
    setClaimingId(job.jobId);
    try {
      await api.post(`/api/rider/jobs/${job.jobId}/claim`);
      toast.push({ title: 'Job claimed', description: `Head to ${job.store.name} for pickup.`, tone: 'success' });
      onClaimed();
      navigate('/rider/active');
    } catch (error) {
      toast.push({ title: "Couldn't claim this job", description: errorMessage(error), tone: 'error' });
      onClaimed();
    } finally {
      setClaimingId(null);
    }
  };
  return { claim, claimingId };
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export const RiderDashboardPage: React.FC = () => {
  const resource = useApiResource(() => api.get<DashboardResponse>('/api/rider/dashboard'), [], { pollMs: 15000 });
  const { claim, claimingId } = useClaim(resource.reload);

  if (resource.loading && !resource.data) return <Spinner label="Loading your dashboard…" />;
  if (resource.error && !resource.data) return <ErrorNote>{resource.error}</ErrorNote>;
  if (!resource.data) return null;

  const { rider, kpis, activeJob, availableJobs, availableCount } = resource.data;
  const disabledReason = !rider.onboardingCompleted
    ? 'Complete your profile (contact number and vehicle) to go online.'
    : rider.accountStatus !== 'active'
      ? `Your account is ${rider.accountStatus}. Contact support.`
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader as="h1" title={`Hi ${rider.name.split(' ')[0]}`} subtitle="Your deliveries today" />
      {!rider.onboardingCompleted && <OnboardingNotice />}

      <AvailabilityToggle
        availability={rider.availability}
        disabledReason={rider.availability === 'offline' ? disabledReason : null}
        onChanged={resource.reload}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Today's deliveries" value={kpis.todaysDeliveries} />
        <StatCard label="Today's earnings" value={formatINR(kpis.todaysEarnings)} />
        <StatCard label="Pending jobs" value={kpis.pendingJobs} />
        <StatCard label="Completed today" value={kpis.completedToday} />
      </div>

      {activeJob && (
        <section aria-label="Active delivery">
          <SectionHeader title="Active delivery" />
          <Card className="border-blue-200 bg-blue-50/50 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-900">
                #{activeJob.orderNumber} · {activeJob.store.name}
              </p>
              <Badge tone={jobStatusMeta(activeJob.jobStatus).tone}>{jobStatusMeta(activeJob.jobStatus).label}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Step {activeJob.step?.current} of {activeJob.step?.total} · {activeJob.step?.label}
            </p>
            <Button className="mt-3 w-full min-h-[44px]" onClick={() => navigate('/rider/active')}>
              Continue delivery
            </Button>
          </Card>
        </section>
      )}

      {rider.availability === 'online' && !activeJob && (
        <section aria-label="Available jobs">
          <SectionHeader
            title="Available jobs"
            subtitle={availableCount ? `${availableCount} ready for pickup` : undefined}
            action={
              <Link to="/rider/jobs" className="text-xs font-semibold text-blue-700 hover:underline">
                See all
              </Link>
            }
          />
          {availableJobs.length === 0 ? (
            <EmptyState
              icon={<Package className="h-8 w-8" aria-hidden="true" />}
              title="Nothing ready for pickup right now"
              description="New jobs appear the moment a store marks an order ready. This page refreshes automatically."
            />
          ) : (
            <div className="space-y-3">
              {availableJobs.map((job) => (
                <JobCard
                  key={job.jobId}
                  job={job}
                  action={
                    <Button
                      size="sm"
                      className="min-h-[40px]"
                      loading={claimingId === job.jobId}
                      onClick={() => claim(job)}
                    >
                      Claim job
                    </Button>
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Jobs list                                                                  */
/* -------------------------------------------------------------------------- */

export const RiderJobsPage: React.FC = () => {
  const { user } = useAuth();
  const resource = useApiResource(
    () => api.get<{ jobs: DeliveryJob[]; offline?: boolean }>('/api/rider/jobs'),
    [],
    { pollMs: 10000 }
  );
  const { claim, claimingId } = useClaim(resource.reload);
  const dashboard = useApiResource(() => api.get<DashboardResponse>('/api/rider/dashboard'), []);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <SectionHeader as="h1" title="Available delivery jobs" subtitle="Orders that stores have marked ready for pickup." />
      {user && !user.onboardingCompleted && <OnboardingNotice />}
      {dashboard.data && (
        <AvailabilityToggle
          availability={dashboard.data.rider.availability}
          disabledReason={!dashboard.data.rider.onboardingCompleted ? 'Complete your profile to go online.' : null}
          onChanged={() => {
            dashboard.reload();
            resource.reload();
          }}
        />
      )}
      {resource.error && <ErrorNote>{resource.error}</ErrorNote>}
      {resource.loading && !resource.data && <Skeleton className="h-40" />}
      {resource.data?.offline && (
        <EmptyState
          icon={<Power className="h-8 w-8" aria-hidden="true" />}
          title="You are offline"
          description="Go online to see delivery jobs near you."
        />
      )}
      {resource.data && !resource.data.offline && resource.data.jobs.length === 0 && (
        <EmptyState
          icon={<Package className="h-8 w-8" aria-hidden="true" />}
          title="Nothing ready for pickup right now"
          description="New jobs appear the moment a store marks an order ready."
        />
      )}
      <div className="space-y-3">
        {(resource.data?.jobs ?? []).map((job) => (
          <JobCard
            key={job.jobId}
            job={job}
            action={
              <Button size="sm" className="min-h-[40px]" loading={claimingId === job.jobId} onClick={() => claim(job)}>
                Claim job
              </Button>
            }
          />
        ))}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Job detail                                                                 */
/* -------------------------------------------------------------------------- */

export const RiderJobDetailPage: React.FC<{ jobId: string }> = ({ jobId }) => {
  const resource = useApiResource(() => api.get<{ job: DeliveryJob }>(`/api/rider/jobs/${jobId}`), [jobId], {
    pollMs: 10000,
  });
  const { claim, claimingId } = useClaim(resource.reload);

  if (resource.loading && !resource.data) return <Spinner label="Loading job…" />;
  if (resource.error) {
    return (
      <div className="mx-auto max-w-lg space-y-3">
        <ErrorNote>{resource.error}</ErrorNote>
        <Button variant="secondary" onClick={() => navigate('/rider/jobs')}>
          Back to jobs
        </Button>
      </div>
    );
  }
  const job = resource.data?.job;
  if (!job) return null;

  const active = ['claimed', 'pickup_verified', 'out_for_delivery'].includes(job.jobStatus) && job.owned;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <nav className="text-xs text-slate-500" aria-label="Breadcrumb">
        <Link to="/rider/jobs" className="hover:text-slate-800">
          Jobs
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-medium text-slate-700">#{job.orderNumber}</span>
      </nav>
      <JobCard
        job={job}
        action={
          job.jobStatus === 'available' ? (
            <Button size="sm" className="min-h-[40px]" loading={claimingId === job.jobId} onClick={() => claim(job)}>
              Claim job
            </Button>
          ) : active ? (
            <Button size="sm" className="min-h-[40px]" onClick={() => navigate('/rider/active')}>
              Open active delivery
            </Button>
          ) : (
            <Badge tone={jobStatusMeta(job.jobStatus).tone}>{jobStatusMeta(job.jobStatus).label}</Badge>
          )
        }
      />
      {!job.owned && (
        <InfoNote>
          The customer&apos;s exact address and contact number are shared only after you claim this job.
        </InfoNote>
      )}
      {job.owned && job.events && <EventList events={job.events} />}
    </div>
  );
};

const EVENT_LABELS: Record<string, string> = {
  ORDER_PLACED: 'Order placed',
  ORDER_ACCEPTED: 'Accepted by store',
  READY_FOR_PICKUP: 'Ready for pickup',
  RIDER_ASSIGNED: 'Job claimed',
  RIDER_RELEASED: 'Job released',
  PICKUP_VERIFICATION_STARTED: 'Arrived at store',
  PICKUP_VERIFIED: 'Pickup code verified',
  ORDER_PICKED_UP: 'Order picked up',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERY_VERIFICATION_STARTED: 'Reached customer',
  DELIVERY_VERIFIED: 'Delivery code verified',
  ORDER_DELIVERED: 'Delivered',
};

const EventList: React.FC<{ events: NonNullable<DeliveryJob['events']> }> = ({ events }) => (
  <Card className="p-4">
    <h2 className="text-sm font-bold text-slate-900">Handoff timeline</h2>
    <ol className="mt-3 space-y-2 border-l border-slate-200 pl-4">
      {events.map((event, index) => (
        <li key={`${event.event_type}-${index}`} className="relative text-xs">
          <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-blue-600" aria-hidden="true" />
          <p className="font-semibold text-slate-800">
            {EVENT_LABELS[event.event_type] ?? event.event_type.replace(/_/g, ' ').toLowerCase()}
          </p>
          <p className="text-slate-400">{formatDateTime(event.created_at)}</p>
        </li>
      ))}
    </ol>
  </Card>
);

/* -------------------------------------------------------------------------- */
/* Active delivery workflow                                                   */
/* -------------------------------------------------------------------------- */

const ISSUE_OPTIONS = [
  { value: 'store_unavailable', label: 'Store is closed / unavailable' },
  { value: 'customer_unavailable', label: 'Customer not reachable' },
  { value: 'wrong_pickup_code', label: 'Pickup code not working' },
  { value: 'wrong_delivery_code', label: 'Delivery code not working' },
  { value: 'navigation_problem', label: 'Cannot find the address' },
  { value: 'safety_issue', label: 'Safety concern' },
  { value: 'unable_to_complete', label: 'Unable to complete' },
  { value: 'other', label: 'Something else' },
];

const STEP_NAMES = ['Pickup', 'Verified', 'Delivery', 'Done'];

export const RiderActivePage: React.FC = () => {
  const toast = useToast();
  const resource = useApiResource(() => api.get<{ job: DeliveryJob | null }>('/api/rider/jobs/active'), [], {
    pollMs: 10000,
  });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueType, setIssueType] = useState(ISSUE_OPTIONS[0].value);
  const [issueNote, setIssueNote] = useState('');
  const [completed, setCompleted] = useState<{ message: string; orderNumber: string } | null>(null);

  const job = resource.data?.job ?? null;

  useEffect(() => {
    setCode('');
    setError(null);
  }, [job?.jobStatus, job?.arrivedAt]);

  const run = async (key: string, fn: () => Promise<{ message?: string } | void>, success?: string) => {
    setBusy(key);
    setError(null);
    try {
      const result = await fn();
      if (success || (result && result.message)) {
        toast.push({ title: success ?? (result as any).message, tone: 'success' });
      }
      resource.reload();
      return result;
    } catch (err) {
      setError(errorMessage(err));
      resource.reload();
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  if (completed) {
    return (
      <div className="mx-auto max-w-lg space-y-4 text-center">
        <Card className="p-8">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-bold text-slate-900">Delivery completed</h1>
          <p className="mt-1 text-sm text-slate-600">{completed.message}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => navigate('/rider/jobs')}>Find next job</Button>
            <Button variant="secondary" onClick={() => navigate('/rider/earnings')}>
              View earnings
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (resource.loading && !resource.data) return <Spinner label="Loading your active delivery…" />;
  if (resource.error && !resource.data) return <ErrorNote>{resource.error}</ErrorNote>;

  if (!job) {
    return (
      <div className="mx-auto max-w-lg">
        <EmptyState
          icon={<Bike className="h-8 w-8" aria-hidden="true" />}
          title="No active delivery"
          description="Claim a job from the available list to start a delivery."
          action={<Button onClick={() => navigate('/rider/jobs')}>Browse jobs</Button>}
        />
      </div>
    );
  }

  const stepIndex = (job.step?.current ?? 1) - 1;
  const claimed = job.jobStatus === 'claimed';
  const verifiedPickup = job.jobStatus === 'pickup_verified';
  const outForDelivery = job.jobStatus === 'out_for_delivery';

  const mapLink = (lat?: number, lng?: number) =>
    lat != null && lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-900">Active delivery · #{job.orderNumber}</h1>
          <Badge tone={jobStatusMeta(job.jobStatus).tone}>{jobStatusMeta(job.jobStatus).label}</Badge>
        </div>
        <ol className="mt-3 grid grid-cols-4 gap-1" aria-label="Delivery progress">
          {STEP_NAMES.map((name, index) => (
            <li key={name} aria-current={index === stepIndex ? 'step' : undefined}>
              <div className={`h-1.5 rounded-full ${index <= stepIndex ? 'bg-blue-600' : 'bg-slate-200'}`} />
              <span className={`mt-1 block text-center text-[10px] font-semibold ${index === stepIndex ? 'text-blue-700' : 'text-slate-400'}`}>
                {name}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Card className="p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <StoreIcon className="h-4 w-4 text-blue-700" aria-hidden="true" /> Pickup · {job.store.name}
        </p>
        <p className="mt-1 text-xs text-slate-600">
          {job.store.address}, {job.store.city}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {job.store.phone && (
            <a
              href={`tel:${job.store.phone}`}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700"
            >
              <Phone className="h-3.5 w-3.5" aria-hidden="true" /> Call store
            </a>
          )}
          {mapLink(job.store.location?.lat, job.store.location?.lng) && (
            <a
              href={mapLink(job.store.location?.lat, job.store.location?.lng)!}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700"
            >
              <Navigation className="h-3.5 w-3.5" aria-hidden="true" /> Navigate
            </a>
          )}
        </div>
      </Card>

      {claimed && (
        <Card className="p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <KeyRound className="h-4 w-4 text-blue-700" aria-hidden="true" /> Verify pickup
          </h2>
          {!job.pickupStartedAt ? (
            <>
              <p className="mt-1 text-xs text-slate-600">Tap when you arrive at the store.</p>
              <Button
                className="mt-3 w-full min-h-[44px]"
                loading={busy === 'start-pickup'}
                onClick={() => run('start-pickup', () => api.post(`/api/rider/jobs/${job.jobId}/start-pickup`))}
              >
                I&apos;ve arrived at the store
              </Button>
            </>
          ) : (
            <form
              className="mt-3 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                run('pickup', () => api.post(`/api/rider/jobs/${job.jobId}/pickup`, { pickupCode: code }));
              }}
            >
              <Field
                label="Pickup code from the seller"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="PK-0000"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={10}
                className="text-center font-mono text-lg tracking-widest"
                hint="The seller shows this code once the order is packed. You submit it - you never see it in the app."
              />
              <Button type="submit" className="w-full min-h-[44px]" loading={busy === 'pickup'} disabled={code.length < 4}>
                Verify pickup
              </Button>
            </form>
          )}
          <button
            type="button"
            onClick={() =>
              run('release', async () => {
                if (!window.confirm('Hand this job back to other riders?')) return;
                await api.post(`/api/rider/jobs/${job.jobId}/release`);
                navigate('/rider/jobs');
              })
            }
            className="mt-3 text-xs font-semibold text-slate-500 underline"
          >
            Release this job
          </button>
        </Card>
      )}

      {verifiedPickup && (
        <Card className="p-4">
          <h2 className="text-sm font-bold text-slate-900">Pickup verified</h2>
          <p className="mt-1 text-xs text-slate-600">You have the order. Start the delivery when you leave the store.</p>
          <Button
            className="mt-3 w-full min-h-[44px]"
            loading={busy === 'start-delivery'}
            onClick={() => run('start-delivery', () => api.post(`/api/rider/jobs/${job.jobId}/start-delivery`))}
          >
            Start delivery
          </Button>
        </Card>
      )}

      {(verifiedPickup || outForDelivery) && job.drop && (
        <Card className="p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <MapPin className="h-4 w-4 text-blue-700" aria-hidden="true" /> Drop · {job.drop.name}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {job.drop.address}
            {job.drop.area ? `, ${job.drop.area}` : ''}, {job.drop.city} {job.drop.pincode}
          </p>
          {job.drop.instructions && (
            <p className="mt-1 text-xs text-slate-500">Note: {job.drop.instructions}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {job.customerPhone && (
              <a
                href={`tel:${job.customerPhone}`}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700"
              >
                <Phone className="h-3.5 w-3.5" aria-hidden="true" /> Call customer
              </a>
            )}
            {mapLink(job.drop.location?.lat, job.drop.location?.lng) && (
              <a
                href={mapLink(job.drop.location?.lat, job.drop.location?.lng)!}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700"
              >
                <Navigation className="h-3.5 w-3.5" aria-hidden="true" /> Navigate
              </a>
            )}
          </div>
        </Card>
      )}

      {outForDelivery && (
        <Card className="p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <KeyRound className="h-4 w-4 text-blue-700" aria-hidden="true" /> Verify delivery
          </h2>
          {!job.arrivedAt ? (
            <>
              <p className="mt-1 text-xs text-slate-600">Tap when you have reached the customer.</p>
              <Button
                className="mt-3 w-full min-h-[44px]"
                loading={busy === 'arrived'}
                onClick={() => run('arrived', () => api.post(`/api/rider/jobs/${job.jobId}/arrived`))}
              >
                I&apos;ve reached the customer
              </Button>
            </>
          ) : (
            <form
              className="mt-3 space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                const result = (await run('delivery', () =>
                  api.post<{ message: string; orderNumber: string }>(`/api/rider/jobs/${job.jobId}/delivery`, {
                    deliveryCode: code,
                  })
                )) as { message: string; orderNumber: string } | undefined;
                if (result) setCompleted({ message: result.message, orderNumber: result.orderNumber });
              }}
            >
              <Field
                label="Delivery code from the customer"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="DL-0000"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={10}
                className="text-center font-mono text-lg tracking-widest"
                hint="Ask the customer to read the code from their order page. Hand over the order only after it is verified."
              />
              <Button type="submit" className="w-full min-h-[44px]" loading={busy === 'delivery'} disabled={code.length < 4}>
                Complete delivery
              </Button>
            </form>
          )}
        </Card>
      )}

      {job.exceptions && job.exceptions.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <p className="font-bold">Reported problems</p>
          <ul className="mt-1 list-disc pl-4">
            {job.exceptions.map((exception) => (
              <li key={exception.id}>
                {exception.type.replace(/_/g, ' ')} · {exception.status} · {relativeTime(exception.created_at)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Button variant="secondary" className="w-full min-h-[44px]" onClick={() => setIssueOpen(true)}>
        <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Report a problem
      </Button>

      {job.items && (
        <Card className="p-4">
          <h2 className="text-sm font-bold text-slate-900">Order contents</h2>
          <ul className="mt-2 text-xs text-slate-600">
            {job.items.map((item, index) => (
              <li key={index} className="flex justify-between py-0.5">
                <span>{item.name}</span>
                <span className="tabular-nums">× {item.quantity}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Cash on delivery is not collected by riders - payment is in test mode.</p>
        </Card>
      )}

      {job.events && <EventList events={job.events} />}

      <Modal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        title="Report a problem"
        description="The order stays open. Support reviews every report."
        footer={
          <>
            <Button variant="ghost" onClick={() => setIssueOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy === 'issue'}
              onClick={async () => {
                const done = await run(
                  'issue',
                  () => api.post(`/api/rider/jobs/${job.jobId}/report-issue`, { type: issueType, note: issueNote }),
                  'Problem reported'
                );
                if (done !== undefined) {
                  setIssueOpen(false);
                  setIssueNote('');
                }
              }}
            >
              Submit report
            </Button>
          </>
        }
      >
        <SelectField label="What happened?" value={issueType} onChange={(e) => setIssueType(e.target.value)} options={ISSUE_OPTIONS} />
        <TextAreaField label="Details (optional)" rows={3} value={issueNote} onChange={(e) => setIssueNote(e.target.value)} maxLength={500} />
      </Modal>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* History                                                                    */
/* -------------------------------------------------------------------------- */

const PERIODS = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
];

export const RiderHistoryPage: React.FC = () => {
  const [period, setPeriod] = useState('all');
  const resource = useApiResource(
    () => api.get<{ jobs: DeliveryJob[]; total: number }>(`/api/rider/history?period=${period}`),
    [period]
  );
  const jobs = resource.data?.jobs ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <SectionHeader as="h1" title="Delivery history" subtitle="Completed and cancelled deliveries." />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by period">
        {PERIODS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={period === item.value}
            onClick={() => setPeriod(item.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              period === item.value ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {resource.error && <ErrorNote>{resource.error}</ErrorNote>}
      {resource.loading && !resource.data && <Skeleton className="h-32" />}
      {resource.data && jobs.length === 0 && (
        <EmptyState
          icon={<Package className="h-8 w-8" aria-hidden="true" />}
          title="No deliveries in this period"
          description="Completed deliveries appear here with their earnings."
        />
      )}
      <div className="space-y-2">
        {jobs.map((job) => (
          <Card key={job.jobId} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-slate-900">
                  #{job.orderNumber} · {job.store.name}
                </p>
                <p className="text-xs text-slate-500">
                  {job.deliveredAt ? formatDateTime(job.deliveredAt) : formatDateTime(job.createdAt)} · {job.deliveryArea}
                  {job.distanceKm != null ? ` · ${job.distanceKm} km` : ''}
                </p>
              </div>
              <div className="text-right">
                <Badge tone={jobStatusMeta(job.jobStatus).tone}>{jobStatusMeta(job.jobStatus).label}</Badge>
                {job.jobStatus === 'completed' && (
                  <p className="mt-1 text-sm font-extrabold tabular-nums text-emerald-700">{formatINR(job.earnings)}</p>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Earnings                                                                   */
/* -------------------------------------------------------------------------- */

interface EarningsResponse {
  summary: {
    today: number;
    week: number;
    month: number;
    total: number;
    paid: number;
    pendingSettlement: number;
    totalJobs: number;
    completedJobs: number;
  };
  analytics: { completionRate: number | null; avgDeliveryMinutes: number | null; avgPickupMinutes: number | null };
  daily: { day: string; jobs: number; earnings: number }[];
  earnings: { id: string; amount: number; status: string; earned_at: string; order_number: string; store_name: string }[];
}

interface Settlement {
  id: string;
  period_start: string;
  period_end: string;
  amount: number;
  status: string;
  reference: string | null;
  paid_at: string | null;
}

export const RiderEarningsPage: React.FC = () => {
  const resource = useApiResource(() => api.get<EarningsResponse>('/api/rider/earnings'), [], { pollMs: 30000 });
  const settlements = useApiResource(() => api.get<{ settlements: Settlement[] }>('/api/rider/settlements'), []);
  const data = resource.data;

  if (resource.loading && !data) return <Spinner label="Loading earnings…" />;
  if (resource.error && !data) return <ErrorNote>{resource.error}</ErrorNote>;
  if (!data) return null;

  const maxDaily = Math.max(1, ...data.daily.map((d) => d.earnings));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader as="h1" title="Earnings" subtitle="Flat payout per completed delivery." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Today" value={formatINR(data.summary.today)} />
        <StatCard label="This week" value={formatINR(data.summary.week)} />
        <StatCard label="This month" value={formatINR(data.summary.month)} />
        <StatCard label="All time" value={formatINR(data.summary.total)} hint={`${data.summary.completedJobs} deliveries`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Paid out" value={formatINR(data.summary.paid)} />
        <StatCard label="Pending settlement" value={formatINR(data.summary.pendingSettlement)} />
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-bold text-slate-900">Performance</h2>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <dt className="text-slate-500">Completion</dt>
            <dd className="text-base font-extrabold text-slate-900">
              {data.analytics.completionRate == null ? '—' : `${data.analytics.completionRate}%`}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Avg. delivery</dt>
            <dd className="text-base font-extrabold text-slate-900">
              {data.analytics.avgDeliveryMinutes == null ? '—' : `${data.analytics.avgDeliveryMinutes} min`}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Avg. pickup</dt>
            <dd className="text-base font-extrabold text-slate-900">
              {data.analytics.avgPickupMinutes == null ? '—' : `${data.analytics.avgPickupMinutes} min`}
            </dd>
          </div>
        </dl>
      </Card>

      {data.daily.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-bold text-slate-900">Daily earnings</h2>
          <ul className="mt-3 space-y-2">
            {data.daily.map((row) => (
              <li key={row.day} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-slate-500">{formatDate(row.day)}</span>
                <span className="h-2 flex-1 rounded-full bg-slate-100">
                  <span
                    className="block h-2 rounded-full bg-blue-600"
                    style={{ width: `${Math.max(4, (row.earnings / maxDaily) * 100)}%` }}
                  />
                </span>
                <span className="w-20 shrink-0 text-right font-semibold tabular-nums text-slate-800">
                  {formatINR(row.earnings)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-sm font-bold text-slate-900">Recent earnings</h2>
        {data.earnings.length === 0 ? (
          <EmptyState icon={<BadgeIndianRupee className="h-8 w-8" aria-hidden="true" />} title="No earnings yet" description="Complete a delivery to see it here." />
        ) : (
          <ul className="space-y-2">
            {data.earnings.map((row) => (
              <li key={row.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
                <span>
                  <span className="block font-semibold text-slate-900">#{row.order_number} · {row.store_name}</span>
                  <span className="text-slate-500">{formatDateTime(row.earned_at)}</span>
                </span>
                <span className="text-right">
                  <span className="block text-sm font-extrabold tabular-nums text-emerald-700">{formatINR(row.amount)}</span>
                  <Badge tone={row.status === 'paid' ? 'success' : 'warning'}>{row.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold text-slate-900">Settlements</h2>
        {(settlements.data?.settlements ?? []).length === 0 ? (
          <p className="text-xs text-slate-500">No settlements have been issued yet. Earnings show as pending until they are.</p>
        ) : (
          <ul className="space-y-2">
            {settlements.data!.settlements.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
                <span>
                  {formatDate(s.period_start)} – {formatDate(s.period_end)}
                  {s.reference && <span className="block text-slate-400">Ref {s.reference}</span>}
                </span>
                <span className="text-right">
                  <span className="block font-bold tabular-nums">{formatINR(s.amount)}</span>
                  <Badge tone={s.status === 'paid' ? 'success' : 'warning'}>{s.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Profile, vehicle, service area                                             */
/* -------------------------------------------------------------------------- */

interface RiderProfile {
  name: string;
  email: string;
  phone: string | null;
  riderId: string;
  availability: string;
  accountStatus: string;
  serviceArea: string | null;
  vehicle: {
    type: string | null;
    model: string | null;
    registrationNumber: string | null;
    licenseNumber: string | null;
    verification: string;
  };
}

export const RiderProfilePage: React.FC = () => {
  const { refresh } = useAuth();
  const toast = useToast();
  const profile = useApiResource(() => api.get<{ profile: RiderProfile }>('/api/rider/profile'), []);
  const areas = useApiResource(
    () => api.get<{ zones: { id: string; name: string }[]; preferredArea: string | null }>('/api/rider/service-area'),
    []
  );
  const [form, setForm] = useState({
    name: '',
    phone: '',
    vehicleType: 'Bike',
    vehicleNumber: '',
    licenseNumber: '',
  });
  const [vehicleModel, setVehicleModel] = useState('');
  const [serviceArea, setServiceArea] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const p = profile.data?.profile;
    if (!p) return;
    setForm({
      name: p.name,
      phone: p.phone ?? '',
      vehicleType: p.vehicle.type ?? 'Bike',
      vehicleNumber: p.vehicle.registrationNumber ?? '',
      licenseNumber: p.vehicle.licenseNumber ?? '',
    });
    setVehicleModel(p.vehicle.model ?? '');
  }, [profile.data]);

  useEffect(() => {
    setServiceArea(areas.data?.preferredArea ?? '');
  }, [areas.data]);

  const complete = Boolean(form.phone && form.vehicleType && form.vehicleNumber);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.put<{ message: string }>('/api/rider/profile', form);
      await api.put('/api/rider/vehicle', {
        vehicleType: form.vehicleType,
        vehicleModel,
        registrationNumber: form.vehicleNumber,
        licenseNumber: form.licenseNumber,
      });
      await api.put('/api/rider/service-area', { serviceArea: serviceArea || null });
      setMessage(result.message);
      await refresh();
      profile.reload();
      areas.reload();
      toast.push({ title: 'Profile saved', description: result.message, tone: 'success' });
    } catch (error) {
      toast.push({ title: 'Could not save profile', description: errorMessage(error), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const p = profile.data?.profile;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SectionHeader
        as="h1"
        title="Rider profile"
        subtitle="Stores and customers only see what is needed to complete a delivery."
      />
      {p && (
        <Card className="flex flex-wrap items-center justify-between gap-2 p-4 text-xs">
          <span>
            <span className="block text-slate-500">Rider ID</span>
            <span className="font-mono font-bold text-slate-900">{p.riderId}</span>
          </span>
          <span>
            <span className="block text-slate-500">Account</span>
            <Badge tone={p.accountStatus === 'active' ? 'success' : 'warning'}>{p.accountStatus}</Badge>
          </span>
          <span>
            <span className="block text-slate-500">Vehicle verification</span>
            <Badge tone={p.vehicle.verification === 'verified' ? 'success' : 'warning'}>{p.vehicle.verification}</Badge>
          </span>
        </Card>
      )}
      {complete ? (
        <SuccessNote>
          Your rider profile is complete — you can go online and claim deliveries. Your contact details are shared with
          a customer only while a delivery is in progress.
        </SuccessNote>
      ) : (
        <InfoNote>
          Complete your profile to start claiming deliveries: contact number, vehicle type and vehicle number are
          required.
        </InfoNote>
      )}

      <Card className="p-5 sm:p-6">
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Field
              label="Contact number"
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+91 98111 22334"
            />
            <SelectField
              label="Vehicle type"
              value={form.vehicleType}
              onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}
              options={['Bike', 'Scooter', 'Bicycle', 'Electric scooter', 'On foot'].map((v) => ({ value: v, label: v }))}
            />
            <Field
              label="Vehicle number"
              required
              value={form.vehicleNumber}
              onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })}
              placeholder="DL 3C AB 1234"
            />
            <Field label="Vehicle model (optional)" value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} />
            <Field
              label="Driving licence number (optional)"
              value={form.licenseNumber}
              onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
              placeholder="DL-0420110012345"
            />
          </div>
          <SelectField
            label="Preferred service area"
            value={serviceArea}
            onChange={(e) => setServiceArea(e.target.value)}
            hint="Only stores in this area appear in your jobs. Leave as 'Any area' to see every zone."
            options={[{ value: '', label: 'Any area' }, ...(areas.data?.zones ?? []).map((z) => ({ value: z.name, label: z.name }))]}
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
