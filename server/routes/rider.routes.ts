import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logging.js';
import { rateLimit } from '../rateLimit.js';
import { ApiError, route } from '../http.js';
import { AuthenticatedRequest, publicUser, requireAuth, requireRole } from '../auth.js';
import { codesMatch, randomId } from '../codes.js';
import { toRupees } from '../pricing.js';
import { RIDER_ZONES, areaLabel, haversineKm, zoneForText } from '../catalog.js';
import { IST_MONTH_START, IST_TODAY, IST_WEEK_START, Period, istDate, periodClause } from '../time.js';
import { audit, notify, notifyCustomerOfOrder, notifyStoreSeller } from '../notifications.js';
import { hydrateOrder } from './customer.routes.js';
import { buildAccountRouter } from './account.routes.js';
import { optionalPhone, optionalString, requireEnum, requireString, requireUploadUrl } from '../validation.js';

export const riderRouter = Router();

riderRouter.use(requireAuth, requireRole('rider'));
// Every rider has exactly one profile row (availability, account state, service area, vehicle).
riderRouter.use((req: AuthenticatedRequest, _res, next) => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO rider_profiles (user_id, availability, account_status, created_at, updated_at)
     VALUES (?, 'offline', 'active', ?, ?)`
  ).run(req.user!.id, now, now);
  next();
});

const MAX_CODE_ATTEMPTS = 5;
const CODE_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const ACTIVE_JOB_STATUSES = `'claimed', 'pickup_verified', 'out_for_delivery'`;

function getRider(riderId: string) {
  return db
    .prepare(
      `SELECT u.*, rp.availability, rp.account_status, rp.service_area, rp.vehicle_model,
              rp.vehicle_verification, rp.city AS rp_city, rp.state AS rp_state, rp.pincode AS rp_pincode,
              rp.last_online_at
       FROM users u LEFT JOIN rider_profiles rp ON rp.user_id = u.id WHERE u.id = ?`
    )
    .get(riderId) as any;
}

function requireEligible(riderId: string, { needOnline }: { needOnline: boolean }) {
  const rider = getRider(riderId);
  if (rider.account_status === 'suspended') {
    throw new ApiError(403, 'Your rider account is suspended. Please contact support.', 'account_suspended');
  }
  if (rider.account_status === 'inactive') {
    throw new ApiError(403, 'Your rider account is inactive. Please contact support.', 'account_inactive');
  }
  if (rider.account_status === 'pending') {
    throw new ApiError(409, 'Your rider account is awaiting approval.', 'account_pending');
  }
  if (!rider.onboarding_completed) {
    throw new ApiError(
      409,
      'Complete your rider profile (vehicle details) before claiming deliveries.',
      'onboarding_required'
    );
  }
  if (needOnline && rider.availability !== 'online') {
    throw new ApiError(409, 'You are offline. Go online to claim delivery jobs.', 'rider_offline');
  }
  return rider;
}

const JOB_SELECT = `
  SELECT dj.id AS job_id, dj.order_id, dj.rider_id, dj.status AS job_status, dj.earnings, dj.claimed_at,
         dj.picked_up_at, dj.pickup_verified_at, dj.pickup_started_at, dj.out_for_delivery_at, dj.arrived_at,
         dj.delivered_at, dj.created_at, dj.updated_at, dj.cancelled_reason,
         o.order_number, o.status AS order_status, o.total AS order_total, o.address_snapshot,
         o.fulfillment_type, o.customer_id,
         s.id AS store_id, s.name AS store_name, s.address AS store_address, s.city AS store_city,
         s.pincode AS store_pincode, s.latitude AS store_lat, s.longitude AS store_lng, s.status AS store_status,
         s.contact_phone AS store_phone, s.opening_hours,
         u.phone AS customer_phone,
         (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
         (SELECT COUNT(*) FROM delivery_exceptions de WHERE de.job_id = dj.id AND de.status = 'open') AS open_exceptions
  FROM delivery_jobs dj
  JOIN orders o ON o.id = dj.order_id
  JOIN stores s ON s.id = o.store_id
  JOIN users u ON u.id = o.customer_id`;

/** Customer address/phone are private until the job belongs to the rider AND is in progress. */
function jobSummary(row: any, includePrivate: boolean) {
  const address = row.address_snapshot ? JSON.parse(row.address_snapshot) : {};
  const dropLat = address.latitude ?? null;
  const dropLng = address.longitude ?? null;
  const distanceKm =
    row.store_lat != null && row.store_lng != null && dropLat != null && dropLng != null
      ? haversineKm(row.store_lat, row.store_lng, dropLat, dropLng)
      : null;
  const step = jobStep(row.job_status, row);
  return {
    jobId: row.job_id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    orderStatus: row.order_status,
    jobStatus: row.job_status,
    step,
    earnings: row.earnings,
    orderTotal: includePrivate ? row.order_total : undefined,
    itemCount: row.item_count,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    pickupStartedAt: includePrivate ? row.pickup_started_at : null,
    pickupVerifiedAt: row.pickup_verified_at,
    pickedUpAt: row.picked_up_at,
    outForDeliveryAt: row.out_for_delivery_at,
    arrivedAt: row.arrived_at,
    deliveredAt: row.delivered_at,
    openExceptions: row.open_exceptions ?? 0,
    distanceKm,
    pickupArea: areaLabel(row.store_address, row.store_city),
    deliveryArea: address.area
      ? `${address.area}, ${String(address.city || '').split(',')[0]}`
      : areaLabel(address.address, address.city),
    store: {
      id: row.store_id,
      name: row.store_name,
      address: row.store_address,
      city: row.store_city,
      phone: row.store_phone,
      openingHours: row.opening_hours,
      status: row.store_status,
      // Coordinates only for the rider who owns an in-progress job (navigation).
      location: includePrivate && row.store_lat != null ? { lat: row.store_lat, lng: row.store_lng } : null,
    },
    dropCity: address.city || null,
    dropPincode: address.pincode || null,
    drop: includePrivate
      ? {
          address: address.address,
          area: address.area ?? null,
          city: address.city,
          pincode: address.pincode,
          name: address.name,
          instructions: address.instructions ?? null,
          location: dropLat != null ? { lat: dropLat, lng: dropLng } : null,
        }
      : null,
    customerPhone: includePrivate ? row.customer_phone : null,
  };
}

/** 1 Pickup · 2 Pickup verified · 3 Delivery · 4 Completed (the progress header). */
function jobStep(jobStatus: string, row: any): { current: number; total: number; label: string } {
  switch (jobStatus) {
    case 'claimed':
      return { current: 1, total: 4, label: row.pickup_started_at ? 'Verify pickup' : 'Go to store' };
    case 'pickup_verified':
      return { current: 2, total: 4, label: 'Pickup verified' };
    case 'out_for_delivery':
      return { current: 3, total: 4, label: row.arrived_at ? 'Verify delivery' : 'Deliver to customer' };
    case 'completed':
      return { current: 4, total: 4, label: 'Completed' };
    default:
      return { current: 0, total: 4, label: jobStatus };
  }
}

function riderZoneFilter(rider: any) {
  return rider.service_area ? String(rider.service_area) : null;
}

function isInRiderZone(row: any, zone: string | null): boolean {
  if (!zone) return true;
  const storeZone = zoneForText(row.store_address, row.store_city);
  return !storeZone || storeZone === zone;
}

function availableJobRows(rider: any) {
  const rows = db
    .prepare(
      `${JOB_SELECT}
       WHERE dj.status = 'available' AND dj.rider_id IS NULL AND o.status = 'ready_for_pickup'
         AND o.fulfillment_type = 'delivery'
       ORDER BY dj.created_at ASC LIMIT 100`
    )
    .all() as any[];
  const zone = riderZoneFilter(rider);
  return rows.filter((row) => isInRiderZone(row, zone));
}

function recordEvent(orderId: string, type: string, actorId: string, note: string, now = new Date().toISOString()) {
  db.prepare(
    `INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
     VALUES (?, ?, ?, 'rider', ?, ?, ?)`
  ).run(randomId('he'), orderId, type, actorId, note, now);
}

/* -------------------------------------------------------------------------- */
/* Availability (online / offline)                                            */
/* -------------------------------------------------------------------------- */

riderRouter.put(
  '/availability',
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    const target = requireEnum(req.body?.availability, 'Availability', ['online', 'offline'] as const);
    const rider = getRider(riderId);

    if (target === 'online') {
      requireEligible(riderId, { needOnline: false });
    } else {
      const active = db
        .prepare(`SELECT id FROM delivery_jobs WHERE rider_id = ? AND status IN (${ACTIVE_JOB_STATUSES})`)
        .get(riderId);
      if (active) {
        throw ApiError.conflict(
          'Finish or release your active delivery before going offline.',
          'active_job_exists'
        );
      }
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE rider_profiles SET availability = ?, last_online_at = CASE WHEN ? = 'online' THEN ? ELSE last_online_at END,
         updated_at = ? WHERE user_id = ?`
    ).run(target, target, now, now, riderId);
    audit(riderId, 'rider', `rider.${target}`, 'user', riderId, { from: rider.availability });
    res.json({
      availability: target,
      message: target === 'online' ? 'You are online. Eligible jobs will appear here.' : 'You are offline.',
    });
  })
);

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

riderRouter.get(
  '/dashboard',
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    const rider = getRider(riderId);
    const online = rider.availability === 'online';

    const available = online && rider.account_status === 'active' ? availableJobRows(rider) : [];
    const active = db
      .prepare(
        `${JOB_SELECT}
         WHERE dj.rider_id = ? AND dj.status IN (${ACTIVE_JOB_STATUSES})
         ORDER BY dj.claimed_at DESC LIMIT 1`
      )
      .get(riderId) as any;

    const today = db
      .prepare(
        `SELECT COUNT(*) AS completed, COALESCE(SUM(earnings), 0) AS earnings
         FROM delivery_jobs WHERE rider_id = ? AND status = 'completed' AND ${istDate('delivered_at')} = ${IST_TODAY}`
      )
      .get(riderId) as any;
    const pending = db
      .prepare(`SELECT COUNT(*) AS c FROM delivery_jobs WHERE rider_id = ? AND status IN (${ACTIVE_JOB_STATUSES})`)
      .get(riderId) as any;
    const total = db
      .prepare(
        `SELECT COUNT(*) AS completed, COALESCE(SUM(earnings), 0) AS total
         FROM delivery_jobs WHERE rider_id = ? AND status = 'completed'`
      )
      .get(riderId) as any;

    res.json({
      rider: {
        id: rider.id,
        name: rider.name,
        phone: rider.phone,
        vehicleType: rider.vehicle_type,
        vehicleNumber: rider.vehicle_number,
        onboardingCompleted: Boolean(rider.onboarding_completed),
        availability: rider.availability,
        accountStatus: rider.account_status,
        serviceArea: rider.service_area,
      },
      availableCount: available.length,
      availableJobs: available.slice(0, 5).map((row) => jobSummary(row, false)),
      activeJob: active ? jobSummary(active, true) : null,
      kpis: {
        todaysDeliveries: today.completed + pending.c,
        todaysEarnings: toRupees(today.earnings),
        pendingJobs: pending.c,
        completedToday: today.completed,
      },
      // Legacy shape kept for older clients.
      earnings: {
        completedJobs: total.completed,
        total: toRupees(total.total),
        today: toRupees(today.earnings),
      },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* Jobs                                                                       */
/* -------------------------------------------------------------------------- */

riderRouter.get(
  '/jobs',
  route((req: AuthenticatedRequest, res) => {
    const rider = getRider(req.user!.id);
    if (rider.availability !== 'online') {
      res.json({ offline: true, jobs: [], upcoming: [], availability: rider.availability });
      return;
    }
    const rows = availableJobRows(rider);
    res.json({ offline: false, availability: 'online', jobs: rows.map((row) => jobSummary(row, false)), upcoming: [] });
  })
);

// Legacy alias of /jobs.
riderRouter.get(
  '/jobs/available',
  route((req: AuthenticatedRequest, res) => {
    const rider = getRider(req.user!.id);
    const rows = rider.availability === 'online' ? availableJobRows(rider) : [];
    res.json({
      offline: rider.availability !== 'online',
      jobs: rows.map((row) => jobSummary(row, false)),
      upcoming: [],
    });
  })
);

riderRouter.get(
  '/jobs/active',
  route((req: AuthenticatedRequest, res) => {
    const job = db
      .prepare(
        `${JOB_SELECT}
         WHERE dj.rider_id = ? AND dj.status IN (${ACTIVE_JOB_STATUSES})
         ORDER BY dj.claimed_at DESC LIMIT 1`
      )
      .get(req.user!.id) as any;

    if (!job) {
      res.json({ job: null });
      return;
    }
    res.json({ job: { ...jobSummary(job, true), ...jobExtras(job) } });
  })
);

function jobExtras(job: any) {
  const events = db
    .prepare(
      `SELECT event_type, actor_role, note, created_at FROM handoff_events WHERE order_id = ? ORDER BY created_at ASC, rowid ASC`
    )
    .all(job.order_id);
  const exceptions = db
    .prepare(
      `SELECT id, type, note, status, created_at, resolved_at FROM delivery_exceptions WHERE job_id = ? ORDER BY created_at DESC`
    )
    .all(job.job_id);
  const items = db
    .prepare(`SELECT product_name AS name, quantity FROM order_items WHERE order_id = ?`)
    .all(job.order_id);
  return { events, exceptions, items };
}

riderRouter.get(
  '/jobs/:id',
  route((req: AuthenticatedRequest, res) => {
    const job = db.prepare(`${JOB_SELECT} WHERE dj.id = ?`).get(req.params.id) as any;
    if (!job) throw ApiError.notFound('Delivery job not found.');

    const owned = job.rider_id === req.user!.id;
    const rider = getRider(req.user!.id);
    // Another rider's job (or a job this rider may not see) is indistinguishable from a missing one.
    if (!owned && (job.rider_id || job.job_status !== 'available' || !isInRiderZone(job, riderZoneFilter(rider)))) {
      throw ApiError.notFound('This delivery is no longer available.');
    }
    const inProgress = owned && ['claimed', 'pickup_verified', 'out_for_delivery'].includes(job.job_status);
    res.json({ job: { ...jobSummary(job, inProgress), ...(owned ? jobExtras(job) : {}), owned } });
  })
);

/* -------------------------------------------------------------------------- */
/* Claiming (atomic)                                                          */
/* -------------------------------------------------------------------------- */

riderRouter.post(
  '/jobs/:id/claim',
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    const rider = requireEligible(riderId, { needOnline: true });

    const activeJob = db
      .prepare(`SELECT id FROM delivery_jobs WHERE rider_id = ? AND status IN (${ACTIVE_JOB_STATUSES})`)
      .get(riderId);
    if (activeJob) {
      throw ApiError.conflict(
        'You already have an active delivery in progress. Complete it before claiming another.',
        'active_job_exists'
      );
    }

    const job = db
      .prepare(`${JOB_SELECT} WHERE dj.id = ?`)
      .get(req.params.id) as any;
    if (!job) throw ApiError.notFound('Delivery job not found.');

    if (job.job_status !== 'available' || job.rider_id) {
      throw ApiError.conflict('This delivery has already been assigned to another rider.', 'already_claimed');
    }
    if (['cancelled', 'rejected'].includes(job.order_status)) {
      throw ApiError.badRequest('This delivery is no longer available.', 'job_unavailable');
    }
    if (job.order_status !== 'ready_for_pickup') {
      throw ApiError.badRequest('The store has not marked this order ready for pickup yet.', 'not_ready');
    }
    if (!isInRiderZone(job, riderZoneFilter(rider))) {
      throw ApiError.badRequest('This delivery is outside your service area.', 'outside_service_area');
    }

    const now = new Date().toISOString();

    const result = withTransaction(() => {
      // Conditional update = the atomic claim. Only one rider can win the race.
      const claim = db
        .prepare(
          `UPDATE delivery_jobs
           SET rider_id = ?, status = 'claimed', claimed_at = ?, updated_at = ?
           WHERE id = ? AND rider_id IS NULL AND status = 'available'`
        )
        .run(riderId, now, now, job.job_id);

      if (claim.changes === 0) return false;

      db.prepare(`UPDATE orders SET rider_id = ?, rider_assigned_at = ?, updated_at = ? WHERE id = ?`).run(
        riderId,
        now,
        now,
        job.order_id
      );
      recordEvent(job.order_id, 'RIDER_ASSIGNED', riderId, 'Delivery claimed by rider', now);
      notifyCustomerOfOrder(job.customer_id, job.order_id, job.order_number, 'rider_assigned');
      notifyStoreSeller(
        job.store_id,
        'order',
        `Rider assigned · #${job.order_number}`,
        'A rider claimed this order and is heading to your store. Share the pickup code only with them.',
        `/seller/orders/${job.order_id}`
      );
      notify(riderId, 'job', 'Job assigned', `Delivery #${job.order_number} has been assigned to you.`, '/rider/active');
      return true;
    });

    if (!result) {
      logger.warn('rider.claim_conflict', { riderId, jobId: job.job_id });
      throw ApiError.conflict('This delivery has already been assigned to another rider.', 'already_claimed');
    }

    logger.info('rider.job_claimed', { riderId, jobId: job.job_id });
    res.json({ message: 'Job claimed successfully. Head to the store for pickup.', jobId: job.job_id });
  })
);

/** A rider can hand a not-yet-picked-up job back to the pool. */
riderRouter.post(
  '/jobs/:id/release',
  route((req: AuthenticatedRequest, res) => {
    const now = new Date().toISOString();
    const result = withTransaction(() => {
      const release = db
        .prepare(
          `UPDATE delivery_jobs
           SET rider_id = NULL, status = 'available', claimed_at = NULL, pickup_started_at = NULL, updated_at = ?
           WHERE id = ? AND rider_id = ? AND status = 'claimed'`
        )
        .run(now, req.params.id, req.user!.id);
      if (release.changes === 0) return false;

      const job = db.prepare(`SELECT order_id FROM delivery_jobs WHERE id = ?`).get(req.params.id) as any;
      db.prepare(`UPDATE orders SET rider_id = NULL, rider_assigned_at = NULL, updated_at = ? WHERE id = ?`).run(
        now,
        job.order_id
      );
      recordEvent(job.order_id, 'RIDER_RELEASED', req.user!.id, 'Rider released the job back to the pool', now);
      return true;
    });

    if (!result) {
      throw ApiError.badRequest('Only a claimed job that has not been picked up can be released.');
    }
    res.json({ message: 'Job released. It is available to other riders again.' });
  })
);

/* -------------------------------------------------------------------------- */
/* Handoff: pickup → out for delivery → delivery                              */
/* -------------------------------------------------------------------------- */

function ownedJob(riderId: string, jobId: string) {
  const job = db.prepare(`${JOB_SELECT} WHERE dj.id = ? AND dj.rider_id = ?`).get(jobId, riderId) as any;
  if (!job) throw ApiError.notFound('This delivery is not assigned to you.');
  return job;
}

function codeAttempts(jobId: string, type: 'pickup' | 'delivery'): number {
  const since = new Date(Date.now() - CODE_ATTEMPT_WINDOW_MS).toISOString();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS failures FROM handoff_verifications
       WHERE job_id = ? AND verification_type = ? AND success = 0 AND created_at > ?`
    )
    .get(jobId, type, since) as any;
  return row?.failures ?? 0;
}

function recordVerification(jobId: string, orderId: string, actorId: string, type: 'pickup' | 'delivery', success: boolean) {
  db.prepare(
    `INSERT INTO handoff_verifications (id, order_id, job_id, actor_id, verification_type, success, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(randomId('hv'), orderId, jobId, actorId, type, success ? 1 : 0, new Date().toISOString());
}

function assertAttemptsLeft(jobId: string, type: 'pickup' | 'delivery') {
  if (codeAttempts(jobId, type) >= MAX_CODE_ATTEMPTS) {
    throw new ApiError(
      429,
      'Too many incorrect code attempts for this delivery. Ask the other party to re-confirm the code, then try again in a few minutes.',
      'too_many_attempts'
    );
  }
}

riderRouter.post(
  '/jobs/:id/start-pickup',
  route((req: AuthenticatedRequest, res) => {
    const job = ownedJob(req.user!.id, req.params.id);
    if (job.job_status !== 'claimed') throw ApiError.badRequest('Pickup has already been started for this delivery.');
    if (!job.pickup_started_at) {
      const now = new Date().toISOString();
      db.prepare(`UPDATE delivery_jobs SET pickup_started_at = ?, updated_at = ? WHERE id = ?`).run(now, now, job.job_id);
      recordEvent(job.order_id, 'PICKUP_VERIFICATION_STARTED', req.user!.id, 'Rider arrived at the store', now);
    }
    res.json({ message: 'Pickup started. Ask the seller for the pickup handoff code.' });
  })
);

function verifyPickup(req: AuthenticatedRequest, res: any) {
  const riderId = req.user!.id;
  const job = ownedJob(riderId, req.params.id);
  const pickup = db.prepare(`SELECT pickup_code FROM orders WHERE id = ?`).get(job.order_id) as any;

  if (job.job_status !== 'claimed') {
    throw ApiError.badRequest(
      ['pickup_verified', 'out_for_delivery', 'completed'].includes(job.job_status)
        ? 'Pickup for this delivery has already been verified.'
        : `Pickup cannot be verified while the job is "${job.job_status}".`
    );
  }
  if (job.order_status !== 'ready_for_pickup') {
    throw ApiError.badRequest(
      job.order_status === 'placed'
        ? 'The store has not accepted this order yet.'
        : 'The store has not marked this order ready for pickup yet.',
      'not_ready'
    );
  }

  assertAttemptsLeft(job.job_id, 'pickup');

  const entered = req.body?.pickupCode;
  if (!entered) throw ApiError.badRequest('Enter the pickup code shown at the store.');

  if (!codesMatch(entered, pickup.pickup_code)) {
    recordVerification(job.job_id, job.order_id, riderId, 'pickup', false);
    logger.warn('rider.pickup_code_failed', { riderId, jobId: job.job_id, attempts: codeAttempts(job.job_id, 'pickup') });
    throw ApiError.badRequest(
      'Incorrect pickup code. Please confirm the code with the seller.',
      'invalid_pickup_code'
    );
  }

  const now = new Date().toISOString();
  withTransaction(() => {
    db.prepare(
      `UPDATE delivery_jobs SET status = 'pickup_verified', pickup_verified_at = ?, picked_up_at = ?, updated_at = ? WHERE id = ?`
    ).run(now, now, now, job.job_id);
    db.prepare(`UPDATE orders SET status = 'picked_up', picked_up_at = ?, updated_at = ? WHERE id = ?`).run(
      now,
      now,
      job.order_id
    );
    recordEvent(job.order_id, 'PICKUP_VERIFIED', riderId, 'Pickup code verified at store', now);
    recordEvent(job.order_id, 'ORDER_PICKED_UP', riderId, 'Rider collected the order', now);
    recordVerification(job.job_id, job.order_id, riderId, 'pickup', true);
    notifyCustomerOfOrder(job.customer_id, job.order_id, job.order_number, 'picked_up');
    notifyStoreSeller(
      job.store_id,
      'order',
      `Picked up · #${job.order_number}`,
      'The rider verified the pickup code and collected the order.',
      `/seller/orders/${job.order_id}`
    );
  });

  logger.info('rider.pickup_verified', { riderId, jobId: job.job_id });
  res.json({
    message: 'Pickup confirmed. Start the delivery when you leave the store.',
    jobStatus: 'pickup_verified',
    orderStatus: 'picked_up',
    pickedUpAt: now,
  });
}

const pickupLimiter = rateLimit({ windowMs: CODE_ATTEMPT_WINDOW_MS, max: 20, keyPrefix: 'verify_pickup' });
riderRouter.post('/jobs/:id/pickup', pickupLimiter, route(verifyPickup));
riderRouter.post('/jobs/:id/verify-pickup', pickupLimiter, route(verifyPickup));

riderRouter.post(
  '/jobs/:id/start-delivery',
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    const job = ownedJob(riderId, req.params.id);
    if (job.job_status !== 'pickup_verified') {
      throw ApiError.badRequest(
        job.job_status === 'claimed'
          ? 'Verify pickup at the store before starting the delivery.'
          : 'This delivery is not waiting to start.'
      );
    }
    if (job.order_status !== 'picked_up') throw ApiError.badRequest('This order is not ready to go out for delivery.');
    const now = new Date().toISOString();
    withTransaction(() => {
      db.prepare(`UPDATE delivery_jobs SET status = 'out_for_delivery', out_for_delivery_at = ?, updated_at = ? WHERE id = ?`).run(
        now,
        now,
        job.job_id
      );
      db.prepare(`UPDATE orders SET status = 'out_for_delivery', updated_at = ? WHERE id = ?`).run(now, job.order_id);
      recordEvent(job.order_id, 'OUT_FOR_DELIVERY', riderId, 'Rider is on the way to the customer', now);
      notifyCustomerOfOrder(job.customer_id, job.order_id, job.order_number, 'out_for_delivery');
      notifyStoreSeller(
        job.store_id,
        'order',
        `Out for delivery · #${job.order_number}`,
        'The rider is on the way to the customer.',
        `/seller/orders/${job.order_id}`
      );
    });
    res.json({ message: 'Out for delivery.', jobStatus: 'out_for_delivery', orderStatus: 'out_for_delivery' });
  })
);

riderRouter.post(
  '/jobs/:id/arrived',
  route((req: AuthenticatedRequest, res) => {
    const job = ownedJob(req.user!.id, req.params.id);
    if (job.job_status !== 'out_for_delivery') {
      throw ApiError.badRequest('Start the delivery before marking that you have reached the customer.');
    }
    if (!job.arrived_at) {
      const now = new Date().toISOString();
      db.prepare(`UPDATE delivery_jobs SET arrived_at = ?, updated_at = ? WHERE id = ?`).run(now, now, job.job_id);
      recordEvent(job.order_id, 'DELIVERY_VERIFICATION_STARTED', req.user!.id, 'Rider reached the customer', now);
    }
    res.json({ message: 'Ask the customer for their delivery code.' });
  })
);

function verifyDelivery(req: AuthenticatedRequest, res: any) {
  const riderId = req.user!.id;
  const job = ownedJob(riderId, req.params.id);
  const secret = db.prepare(`SELECT delivery_code FROM orders WHERE id = ?`).get(job.order_id) as any;

  if (job.job_status !== 'out_for_delivery') {
    throw ApiError.badRequest(
      job.job_status === 'completed'
        ? 'This delivery is already completed.'
        : 'Verify pickup and start the delivery before completing it.'
    );
  }

  assertAttemptsLeft(job.job_id, 'delivery');

  const entered = req.body?.deliveryCode;
  if (!entered) throw ApiError.badRequest("Enter the customer's delivery code.");

  if (!codesMatch(entered, secret.delivery_code)) {
    recordVerification(job.job_id, job.order_id, riderId, 'delivery', false);
    logger.warn('rider.delivery_code_failed', { riderId, jobId: job.job_id, attempts: codeAttempts(job.job_id, 'delivery') });
    throw ApiError.badRequest(
      'The delivery code is incorrect. Please ask the customer to confirm it.',
      'invalid_delivery_code'
    );
  }

  const now = new Date().toISOString();
  withTransaction(() => {
    const done = db
      .prepare(`UPDATE delivery_jobs SET status = 'completed', delivered_at = ?, updated_at = ? WHERE id = ? AND status = 'out_for_delivery'`)
      .run(now, now, job.job_id);
    if (done.changes === 0) throw ApiError.conflict('This delivery was already completed.');
    db.prepare(`UPDATE orders SET status = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ?`).run(
      now,
      now,
      job.order_id
    );
    recordEvent(job.order_id, 'DELIVERY_VERIFIED', riderId, 'Delivery code verified', now);
    recordEvent(job.order_id, 'ORDER_DELIVERED', riderId, 'Order delivered', now);
    recordVerification(job.job_id, job.order_id, riderId, 'delivery', true);

    // One earning record per completed job (UNIQUE job_id makes this idempotent).
    db.prepare(
      `INSERT OR IGNORE INTO rider_earnings (id, rider_id, job_id, order_id, amount, status, earned_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    ).run(randomId('earn'), riderId, job.job_id, job.order_id, job.earnings, now);

    notifyCustomerOfOrder(job.customer_id, job.order_id, job.order_number, 'delivered');
    notifyStoreSeller(
      job.store_id,
      'order',
      `Delivered · #${job.order_number}`,
      'The customer verified the delivery. Order complete.',
      `/seller/orders/${job.order_id}`
    );
    notify(riderId, 'earnings', 'Earnings added', `₹${job.earnings} has been added to today's earnings.`, '/rider/earnings');
  });

  logger.info('rider.delivery_completed', { riderId, jobId: job.job_id });
  res.json({
    message: `Delivery completed. ₹${job.earnings} added to your earnings.`,
    jobStatus: 'completed',
    orderStatus: 'delivered',
    deliveredAt: now,
    earnings: job.earnings,
    orderNumber: job.order_number,
  });
}

const deliveryLimiter = rateLimit({ windowMs: CODE_ATTEMPT_WINDOW_MS, max: 20, keyPrefix: 'verify_delivery' });
riderRouter.post('/jobs/:id/delivery', deliveryLimiter, route(verifyDelivery));
riderRouter.post('/jobs/:id/verify-delivery', deliveryLimiter, route(verifyDelivery));

/* -------------------------------------------------------------------------- */
/* Exceptions                                                                 */
/* -------------------------------------------------------------------------- */

const ISSUE_TYPES = [
  'customer_unavailable',
  'store_unavailable',
  'wrong_pickup_code',
  'wrong_delivery_code',
  'unable_to_complete',
  'navigation_problem',
  'safety_issue',
  'other',
] as const;

/**
 * Riders can never mark an order delivered/failed themselves. A reported problem
 * creates a controlled exception record; the order stays incomplete until
 * support/seller resolution or a correct handoff code.
 */
riderRouter.post(
  '/jobs/:id/report-issue',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyPrefix: 'rider_issue' }),
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    const job = ownedJob(riderId, req.params.id);
    if (!['claimed', 'pickup_verified', 'out_for_delivery'].includes(job.job_status)) {
      throw ApiError.badRequest('Issues can only be reported on an active delivery.');
    }
    const type = requireEnum(req.body?.type, 'Issue type', ISSUE_TYPES);
    const note = optionalString(req.body?.note, 'Details', { max: 500 }) || null;
    const id = randomId('exc');
    const now = new Date().toISOString();

    withTransaction(() => {
      db.prepare(
        `INSERT INTO delivery_exceptions (id, job_id, order_id, rider_id, type, note, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
      ).run(id, job.job_id, job.order_id, riderId, type, note, now);
      recordEvent(job.order_id, `EXCEPTION_${type.toUpperCase()}`, riderId, `Rider reported: ${type.replace(/_/g, ' ')}`, now);

      if (type === 'store_unavailable') {
        notifyStoreSeller(
          job.store_id,
          'order',
          `Rider can't reach your store · #${job.order_number}`,
          'The assigned rider reported that the store was unavailable for pickup. Please respond or contact support.',
          `/seller/orders/${job.order_id}`
        );
      }
      if (type === 'customer_unavailable') {
        notify(
          job.customer_id,
          'delivery',
          `Delivery attempt · #${job.order_number}`,
          'Your rider could not reach you. Keep your phone nearby — support or the rider will follow up.',
          `/customer/orders/${job.order_id}`
        );
      }
      audit(riderId, 'rider', 'delivery.exception', 'delivery_job', job.job_id, { type });
    });

    res.status(201).json({
      id,
      message:
        'Problem reported. The order stays open and support will follow up — you cannot mark it delivered without the customer code.',
    });
  })
);

/* -------------------------------------------------------------------------- */
/* History, earnings, settlements                                             */
/* -------------------------------------------------------------------------- */

riderRouter.get(
  '/history',
  route((req: AuthenticatedRequest, res) => {
    const period = (['today', 'week', 'month'].includes(String(req.query.period)) ? req.query.period : 'all') as Period;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 25));
    const where = `dj.rider_id = ? AND dj.status IN ('completed','cancelled') ${periodClause('COALESCE(dj.delivered_at, dj.updated_at)', period)}`;
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM delivery_jobs dj WHERE ${where}`).get(req.user!.id) as any).c;
    const jobs = db
      .prepare(`${JOB_SELECT} WHERE ${where} ORDER BY COALESCE(dj.delivered_at, dj.updated_at) DESC LIMIT ? OFFSET ?`)
      .all(req.user!.id, pageSize, (page - 1) * pageSize) as any[];
    res.json({
      // Completed deliveries never expose the customer's exact address or phone.
      jobs: jobs.map((row) => ({ ...jobSummary(row, false), ...jobExtrasSafe(row) })),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    });
  })
);

function jobExtrasSafe(job: any) {
  const events = db
    .prepare(
      `SELECT event_type, actor_role, created_at FROM handoff_events WHERE order_id = ? ORDER BY created_at ASC, rowid ASC`
    )
    .all(job.order_id);
  return { events };
}

riderRouter.get(
  '/earnings',
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    const sum = (clause: string) =>
      toRupees(
        (
          db
            .prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM rider_earnings WHERE rider_id = ? ${clause}`)
            .get(riderId) as any
        ).t
      );
    const today = sum(`AND ${istDate('earned_at')} = ${IST_TODAY}`);
    const week = sum(`AND ${istDate('earned_at')} >= ${IST_WEEK_START}`);
    const month = sum(`AND ${istDate('earned_at')} >= ${IST_MONTH_START}`);
    const total = sum('');
    const paid = sum(`AND status = 'paid'`);
    const pendingSettlement = sum(`AND status IN ('pending','processing')`);

    const totals = db
      .prepare(
        `SELECT COUNT(*) AS totalJobs,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completedJobs,
                COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelledJobs
         FROM delivery_jobs WHERE rider_id = ?`
      )
      .get(riderId) as any;
    const timing = db
      .prepare(
        `SELECT AVG((julianday(delivered_at) - julianday(claimed_at)) * 1440) AS avgDeliveryMinutes,
                AVG((julianday(pickup_verified_at) - julianday(claimed_at)) * 1440) AS avgPickupMinutes
         FROM delivery_jobs WHERE rider_id = ? AND status = 'completed' AND claimed_at IS NOT NULL`
      )
      .get(riderId) as any;
    const daily = db
      .prepare(
        `SELECT ${istDate('earned_at')} AS day, COUNT(*) AS jobs, COALESCE(SUM(amount), 0) AS earnings
         FROM rider_earnings WHERE rider_id = ? GROUP BY ${istDate('earned_at')} ORDER BY day DESC LIMIT 14`
      )
      .all(riderId) as any[];

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const rows = db
      .prepare(
        `SELECT e.id, e.amount, e.status, e.earned_at, o.order_number, o.id AS order_id, s.name AS store_name
         FROM rider_earnings e JOIN orders o ON o.id = e.order_id JOIN stores s ON s.id = o.store_id
         WHERE e.rider_id = ? ORDER BY e.earned_at DESC LIMIT ? OFFSET ?`
      )
      .all(riderId, pageSize, (page - 1) * pageSize);

    res.json({
      summary: {
        today,
        week,
        month,
        total,
        paid,
        pendingSettlement,
        totalJobs: totals.totalJobs,
        completedJobs: totals.completedJobs,
        totalEarnings: total,
      },
      analytics: {
        completionRate:
          totals.completedJobs + totals.cancelledJobs > 0
            ? Math.round((totals.completedJobs / (totals.completedJobs + totals.cancelledJobs)) * 100)
            : null,
        avgDeliveryMinutes: timing.avgDeliveryMinutes == null ? null : Math.round(timing.avgDeliveryMinutes),
        avgPickupMinutes: timing.avgPickupMinutes == null ? null : Math.round(timing.avgPickupMinutes),
      },
      daily: daily.reverse(),
      earnings: rows,
      page,
    });
  })
);

riderRouter.get(
  '/settlements',
  route((req: AuthenticatedRequest, res) => {
    const settlements = db
      .prepare(
        `SELECT id, period_start, period_end, amount, status, reference, created_at, paid_at
         FROM settlements WHERE user_id = ? AND role = 'rider' ORDER BY created_at DESC LIMIT 100`
      )
      .all(req.user!.id);
    res.json({ settlements });
  })
);

/* -------------------------------------------------------------------------- */
/* Profile, vehicle, service area                                             */
/* -------------------------------------------------------------------------- */

function profilePayload(riderId: string) {
  const rider = getRider(riderId);
  return {
    ...publicUser(rider),
    riderId: `RDR-${String(rider.id).slice(-6).toUpperCase()}`,
    avatarUrl: rider.avatar_url ?? null,
    address: rider.address ?? null,
    city: rider.rp_city ?? null,
    state: rider.rp_state ?? null,
    pincode: rider.rp_pincode ?? null,
    availability: rider.availability,
    accountStatus: rider.account_status,
    serviceArea: rider.service_area,
    vehicle: {
      type: rider.vehicle_type,
      model: rider.vehicle_model,
      registrationNumber: rider.vehicle_number,
      licenseNumber: rider.license_number,
      verification: rider.vehicle_verification,
    },
  };
}

riderRouter.get(
  '/profile',
  route((req: AuthenticatedRequest, res) => {
    res.json({ profile: profilePayload(req.user!.id) });
  })
);

riderRouter.get(
  '/vehicle',
  route((req: AuthenticatedRequest, res) => {
    res.json({ vehicle: profilePayload(req.user!.id).vehicle });
  })
);

riderRouter.put(
  '/vehicle',
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    const current = getRider(riderId);
    const vehicleType = optionalString(req.body?.vehicleType, 'Vehicle type', { max: 40 });
    const model = optionalString(req.body?.vehicleModel, 'Vehicle model', { max: 60 });
    const registration = optionalString(req.body?.registrationNumber, 'Registration number', { max: 20 });
    const license = optionalString(req.body?.licenseNumber, 'Licence number', { max: 30 });
    if (registration && !/^[A-Za-z0-9\s-]{4,20}$/.test(registration)) {
      throw ApiError.badRequest('Please provide a valid vehicle registration number.');
    }
    const newType = vehicleType ?? current.vehicle_type;
    const newReg = registration ?? current.vehicle_number;
    const changedIdentity = newReg !== current.vehicle_number || newType !== current.vehicle_type;
    const now = new Date().toISOString();
    withTransaction(() => {
      db.prepare(
        `UPDATE users SET vehicle_type = ?, vehicle_number = ?, license_number = ?,
           onboarding_completed = ?, updated_at = ? WHERE id = ?`
      ).run(
        newType || null,
        newReg || null,
        license ?? current.license_number,
        current.phone && newType && newReg ? 1 : 0,
        now,
        riderId
      );
      // Riders cannot verify their own vehicle; a changed identity goes back to review.
      db.prepare(
        `UPDATE rider_profiles SET vehicle_model = ?, vehicle_verification = CASE WHEN ? THEN 'pending' ELSE vehicle_verification END,
           updated_at = ? WHERE user_id = ?`
      ).run(model ?? current.vehicle_model, changedIdentity ? 1 : 0, now, riderId);
    });
    res.json({ message: 'Vehicle details saved.', vehicle: profilePayload(riderId).vehicle });
  })
);

riderRouter.get(
  '/service-area',
  route((req: AuthenticatedRequest, res) => {
    const rider = getRider(req.user!.id);
    const eligible =
      rider.account_status === 'active' && Boolean(rider.onboarding_completed) && Boolean(rider.service_area);
    res.json({
      zones: RIDER_ZONES.map((zone) => ({ id: zone.id, name: zone.name })),
      preferredArea: rider.service_area,
      currentZone: rider.service_area,
      eligibility: {
        eligible,
        reason: eligible
          ? `You can claim deliveries from stores in ${rider.service_area}.`
          : !rider.service_area
            ? 'Choose a preferred service area to get zone-specific jobs. Until then you can claim jobs from any zone.'
            : rider.account_status !== 'active'
              ? 'Your account is not active.'
              : 'Complete your vehicle details to start claiming jobs.',
      },
    });
  })
);

riderRouter.put(
  '/service-area',
  route((req: AuthenticatedRequest, res) => {
    const area = req.body?.serviceArea;
    const valid = RIDER_ZONES.map((z) => z.name) as string[];
    if (area !== null && !valid.includes(area)) throw ApiError.badRequest(`Choose one of: ${valid.join(', ')}.`);
    const active = db
      .prepare(`SELECT id FROM delivery_jobs WHERE rider_id = ? AND status IN (${ACTIVE_JOB_STATUSES})`)
      .get(req.user!.id);
    if (active) throw ApiError.conflict('Finish your active delivery before changing your service area.');
    db.prepare(`UPDATE rider_profiles SET service_area = ?, updated_at = ? WHERE user_id = ?`).run(
      area,
      new Date().toISOString(),
      req.user!.id
    );
    res.json({ message: area ? `Service area set to ${area}.` : 'Service area cleared.' });
  })
);

riderRouter.put(
  '/profile',
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    const current = getRider(riderId);
    const name = requireString(req.body?.name ?? req.user!.name, 'Full name', { min: 2, max: 80 });
    const phone = req.body?.phone ? optionalPhone(req.body.phone) : req.user!.phone;
    const vehicleType = optionalString(req.body?.vehicleType, 'Vehicle type', { max: 40 });
    const vehicleNumber = optionalString(req.body?.vehicleNumber, 'Vehicle number', { max: 20 });
    const licenseNumber = optionalString(req.body?.licenseNumber, 'Licence number', { max: 30 });
    const address = optionalString(req.body?.address, 'Address', { max: 240 });
    const avatar =
      req.body?.avatarUrl === undefined
        ? current.avatar_url
        : req.body.avatarUrl
          ? requireUploadUrl(req.body.avatarUrl)
          : null;

    if (phone && !/^[+]?[0-9\s-]{8,16}$/.test(phone)) {
      throw ApiError.badRequest('Please provide a valid contact number.');
    }
    if (vehicleNumber && !/^[A-Za-z0-9\s-]{4,20}$/.test(vehicleNumber)) {
      throw ApiError.badRequest('Please provide a valid vehicle number.');
    }

    const newType = vehicleType ?? current.vehicle_type;
    const newNumber = vehicleNumber ?? current.vehicle_number;
    const completed = Boolean(phone && newType && newNumber);
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE users SET name = ?, phone = ?, vehicle_type = ?, vehicle_number = ?, license_number = ?,
         address = ?, avatar_url = ?, onboarding_completed = ?, updated_at = ? WHERE id = ?`
    ).run(
      name,
      phone || null,
      newType || null,
      newNumber || null,
      licenseNumber ?? current.license_number,
      address ?? current.address,
      avatar ?? null,
      completed ? 1 : 0,
      now,
      riderId
    );

    const rider = getRider(riderId);
    res.json({
      message: completed
        ? 'Rider profile complete. You can now claim deliveries.'
        : 'Profile saved. Add a contact number, vehicle type and vehicle number to start accepting deliveries.',
      rider: {
        id: rider.id,
        name: rider.name,
        phone: rider.phone,
        vehicleType: rider.vehicle_type,
        vehicleNumber: rider.vehicle_number,
        licenseNumber: rider.license_number,
        onboardingCompleted: Boolean(rider.onboarding_completed),
      },
      profile: profilePayload(riderId),
    });
  })
);

riderRouter.use(buildAccountRouter('rider'));

void config;
