import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { logger } from '../logging.js';
import { rateLimit } from '../rateLimit.js';
import { ApiError, route } from '../http.js';
import { AuthenticatedRequest, requireAuth, requireRole } from '../auth.js';
import { codesMatch } from '../codes.js';
import { toRupees } from '../pricing.js';
import { randomId } from '../codes.js';
import { hydrateOrder } from './customer.routes.js';
import { optionalPhone, optionalString, requireString } from '../validation.js';

export const riderRouter = Router();

riderRouter.use(requireAuth, requireRole('rider'));

const MAX_CODE_ATTEMPTS = 5;
const CODE_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

function requireOnboarding(riderId: string) {
  const rider = db.prepare(`SELECT * FROM users WHERE id = ?`).get(riderId) as any;
  if (!rider?.onboarding_completed) {
    throw new ApiError(
      409,
      'Complete your rider profile (vehicle details) before claiming deliveries.',
      'onboarding_required'
    );
  }
  return rider;
}

/** Customers' exact address and phone are only shared once a rider owns the job. */
function jobSummary(row: any, includePrivate: boolean) {
  const address = row.address_snapshot ? JSON.parse(row.address_snapshot) : {};
  return {
    jobId: row.job_id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    orderStatus: row.order_status,
    jobStatus: row.job_status,
    earnings: row.earnings,
    orderTotal: row.order_total,
    itemCount: row.item_count,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    pickedUpAt: row.picked_up_at,
    deliveredAt: row.delivered_at,
    store: {
      id: row.store_id,
      name: row.store_name,
      address: row.store_address,
      city: row.store_city,
      phone: row.store_phone,
      openingHours: row.opening_hours,
    },
    dropCity: address.city || null,
    dropPincode: address.pincode || null,
    // Exact drop address + customer contact are private until the job is claimed.
    drop: includePrivate
      ? { address: address.address, city: address.city, pincode: address.pincode, name: address.name }
      : null,
    customerPhone: includePrivate ? row.customer_phone : null,
  };
}

const JOB_SELECT = `
  SELECT dj.id AS job_id, dj.order_id, dj.rider_id, dj.status AS job_status, dj.earnings, dj.claimed_at,
         dj.picked_up_at, dj.delivered_at, dj.created_at,
         o.order_number, o.status AS order_status, o.total AS order_total, o.address_snapshot,
         s.id AS store_id, s.name AS store_name, s.address AS store_address, s.city AS store_city,
         s.contact_phone AS store_phone, s.opening_hours,
         u.phone AS customer_phone,
         (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
  FROM delivery_jobs dj
  JOIN orders o ON o.id = dj.order_id
  JOIN stores s ON s.id = o.store_id
  JOIN users u ON u.id = o.customer_id`;

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

riderRouter.get(
  '/dashboard',
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    const rider = db.prepare(`SELECT * FROM users WHERE id = ?`).get(riderId) as any;

    const available = db
      .prepare(
        `${JOB_SELECT}
         WHERE dj.status = 'available' AND dj.rider_id IS NULL AND o.status = 'ready_for_pickup'
         ORDER BY dj.created_at ASC`
      )
      .all() as any[];

    const active = db
      .prepare(
        `${JOB_SELECT}
         WHERE dj.rider_id = ? AND dj.status IN ('claimed', 'pickup_verified', 'out_for_delivery')
         ORDER BY dj.claimed_at DESC LIMIT 1`
      )
      .get(riderId) as any;

    const earnings = db
      .prepare(
        `SELECT COUNT(*) AS completed,
                COALESCE(SUM(earnings), 0) AS total,
                COALESCE(SUM(CASE WHEN date(delivered_at) = date('now') THEN earnings ELSE 0 END), 0) AS today
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
      },
      availableCount: available.length,
      availableJobs: available.slice(0, 5).map((row) => jobSummary(row, false)),
      activeJob: active ? jobSummary(active, true) : null,
      earnings: {
        completedJobs: earnings.completed,
        total: toRupees(earnings.total),
        today: toRupees(earnings.today),
      },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* Jobs                                                                       */
/* -------------------------------------------------------------------------- */

riderRouter.get(
  '/jobs/available',
  route((req: AuthenticatedRequest, res) => {
    const rows = db
      .prepare(
        `${JOB_SELECT}
         WHERE dj.status = 'available' AND dj.rider_id IS NULL
           AND o.status = 'ready_for_pickup'
         ORDER BY dj.created_at ASC`
      )
      .all() as any[];
    // Riders may be assigned before the store finishes packing; those jobs are
    // surfaced separately so a rider can see what is coming without claiming.
    const upcoming = db
      .prepare(
        `${JOB_SELECT}
         WHERE dj.status = 'available' AND dj.rider_id IS NULL
           AND o.status IN ('accepted', 'preparing', 'packed')
         ORDER BY dj.created_at ASC`
      )
      .all() as any[];

    res.json({
      jobs: rows.map((row) => jobSummary(row, false)),
      upcoming: upcoming.map((row) => jobSummary(row, false)),
    });
  })
);

riderRouter.get(
  '/jobs/active',
  route((req: AuthenticatedRequest, res) => {
    const job = db
      .prepare(
        `${JOB_SELECT}
         WHERE dj.rider_id = ? AND dj.status IN ('claimed', 'pickup_verified', 'out_for_delivery')
         ORDER BY dj.claimed_at DESC LIMIT 1`
      )
      .get(req.user!.id) as any;

    if (!job) {
      res.json({ job: null });
      return;
    }
    res.json({ job: { ...jobSummary(job, true), order: hydrateOrder(job.order_id, 'rider') } });
  })
);

riderRouter.get(
  '/jobs/:id',
  route((req: AuthenticatedRequest, res) => {
    const job = db
      .prepare(`${JOB_SELECT} WHERE dj.id = ?`)
      .get(req.params.id) as any;
    if (!job) throw ApiError.notFound('Delivery job not found.');

    const owned = job.rider_id === req.user!.id;
    const claimable = !job.rider_id;
    if (!owned && !claimable) {
      throw ApiError.forbidden('This delivery is assigned to another rider.');
    }
    res.json({ job: jobSummary(job, owned) });
  })
);

/* -------------------------------------------------------------------------- */
/* Claiming (atomic)                                                          */
/* -------------------------------------------------------------------------- */

riderRouter.post(
  '/jobs/:id/claim',
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    requireOnboarding(riderId);

    const activeJob = db
      .prepare(
        `SELECT id FROM delivery_jobs WHERE rider_id = ? AND status IN ('claimed', 'pickup_verified', 'out_for_delivery')`
      )
      .get(riderId);
    if (activeJob) {
      throw ApiError.conflict(
        'You already have an active delivery in progress. Complete it before claiming another.',
        'active_job_exists'
      );
    }

    const job = db
      .prepare(
        `SELECT dj.id, dj.order_id, dj.rider_id, dj.status, o.status AS order_status
         FROM delivery_jobs dj JOIN orders o ON o.id = dj.order_id WHERE dj.id = ?`
      )
      .get(req.params.id) as any;
    if (!job) throw ApiError.notFound('Delivery job not found.');

    if (job.status !== 'available' || job.rider_id) {
      throw ApiError.conflict('This delivery has already been claimed by another rider.', 'already_claimed');
    }
    if (job.order_status === 'placed') {
      throw ApiError.badRequest('The store has not accepted this order yet. Check back shortly.');
    }
    if (['cancelled', 'rejected'].includes(job.order_status)) {
      throw ApiError.badRequest('This order was cancelled by the store.');
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
        .run(riderId, now, now, job.id);

      if (claim.changes === 0) return false;

      db.prepare(
        `UPDATE orders SET rider_id = ?, rider_assigned_at = ?, updated_at = ? WHERE id = ?`
      ).run(riderId, now, now, job.order_id);

      db.prepare(
        `INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
         VALUES (?, ?, 'RIDER_ASSIGNED', 'rider', ?, 'Delivery claimed by rider', ?)`
      ).run(randomId('he'), job.order_id, riderId, now);

      return true;
    });

    if (!result) {
      logger.warn('rider.claim_conflict', { riderId, jobId: job.id });
      throw ApiError.conflict('This delivery has already been claimed by another rider.', 'already_claimed');
    }

    logger.info('rider.job_claimed', { riderId, jobId: job.id });
    res.json({ message: 'Delivery claimed. Head to the store for pickup.', jobId: job.id });
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
           SET rider_id = NULL, status = 'available', claimed_at = NULL, updated_at = ?
           WHERE id = ? AND rider_id = ? AND status = 'claimed'`
        )
        .run(now, req.params.id, req.user!.id);
      if (release.changes === 0) return false;

      const job = db.prepare(`SELECT order_id FROM delivery_jobs WHERE id = ?`).get(req.params.id) as any;
      db.prepare(`UPDATE orders SET rider_id = NULL, rider_assigned_at = NULL, updated_at = ? WHERE id = ?`).run(
        now,
        job.order_id
      );
      db.prepare(
        `INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
         VALUES (?, ?, 'RIDER_RELEASED', 'rider', ?, 'Rider released the job back to the pool', ?)`
      ).run(randomId('he'), job.order_id, req.user!.id, now);
      return true;
    });

    if (!result) {
      throw ApiError.badRequest('Only a claimed job that has not been picked up can be released.');
    }
    res.json({ message: 'Job released. It is available to other riders again.' });
  })
);

/* -------------------------------------------------------------------------- */
/* Handoff verification                                                       */
/* -------------------------------------------------------------------------- */

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
  '/jobs/:id/verify-pickup',
  rateLimit({ windowMs: CODE_ATTEMPT_WINDOW_MS, max: 20, keyPrefix: 'verify_pickup' }),
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    const job = db
      .prepare(
        `SELECT dj.*, o.pickup_code, o.status AS order_status
         FROM delivery_jobs dj JOIN orders o ON o.id = dj.order_id
         WHERE dj.id = ? AND dj.rider_id = ?`
      )
      .get(req.params.id, riderId) as any;

    if (!job) throw ApiError.notFound('This delivery is not assigned to you.');
    if (job.status !== 'claimed') {
      throw ApiError.badRequest(
        job.status === 'out_for_delivery' || job.status === 'completed'
          ? 'Pickup for this delivery has already been verified.'
          : `Pickup cannot be verified while the job is "${job.status}".`
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

    assertAttemptsLeft(job.id, 'pickup');

    const entered = req.body?.pickupCode;
    if (!entered) throw ApiError.badRequest('Enter the pickup code shown at the store.');

    if (!codesMatch(entered, job.pickup_code)) {
      recordVerification(job.id, job.order_id, riderId, 'pickup', false);
      logger.warn('rider.pickup_code_failed', { riderId, jobId: job.id, attempts: codeAttempts(job.id, 'pickup') });
      throw ApiError.badRequest(
        'Incorrect pickup code. Please confirm the code with the store staff and try again.',
        'invalid_pickup_code'
      );
    }

    const now = new Date().toISOString();
    withTransaction(() => {
      db.prepare(
        `UPDATE delivery_jobs SET status = 'out_for_delivery', pickup_verified_at = ?, picked_up_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(now, now, now, job.id);

      db.prepare(
        `UPDATE orders SET status = 'out_for_delivery', picked_up_at = ?, updated_at = ? WHERE id = ?`
      ).run(now, now, job.order_id);

      db.prepare(
        `INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
         VALUES (?, ?, 'PICKUP_VERIFIED', 'rider', ?, 'Pickup code verified at store', ?)`
      ).run(randomId('he'), job.order_id, riderId, now);

      recordVerification(job.id, job.order_id, riderId, 'pickup', true);
    });

    logger.info('rider.pickup_verified', { riderId, jobId: job.id });
    res.json({ message: 'Pickup verified. This order is now out for delivery.', jobStatus: 'out_for_delivery' });
  })
);

riderRouter.post(
  '/jobs/:id/verify-delivery',
  rateLimit({ windowMs: CODE_ATTEMPT_WINDOW_MS, max: 20, keyPrefix: 'verify_delivery' }),
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    const job = db
      .prepare(
        `SELECT dj.*, o.delivery_code, o.status AS order_status
         FROM delivery_jobs dj JOIN orders o ON o.id = dj.order_id
         WHERE dj.id = ? AND dj.rider_id = ?`
      )
      .get(req.params.id, riderId) as any;

    if (!job) throw ApiError.notFound('This delivery is not assigned to you.');
    if (!['out_for_delivery', 'pickup_verified'].includes(job.status)) {
      throw ApiError.badRequest(
        job.status === 'completed'
          ? 'This delivery is already completed.'
          : 'Verify pickup at the store before completing the delivery.'
      );
    }

    assertAttemptsLeft(job.id, 'delivery');

    const entered = req.body?.deliveryCode;
    if (!entered) throw ApiError.badRequest("Enter the customer's delivery code.");

    if (!codesMatch(entered, job.delivery_code)) {
      recordVerification(job.id, job.order_id, riderId, 'delivery', false);
      logger.warn('rider.delivery_code_failed', { riderId, jobId: job.id, attempts: codeAttempts(job.id, 'delivery') });
      throw ApiError.badRequest(
        "Incorrect delivery code. Please ask the customer for the code shown in their NearBuy order.",
        'invalid_delivery_code'
      );
    }

    const now = new Date().toISOString();
    withTransaction(() => {
      db.prepare(
        `UPDATE delivery_jobs SET status = 'completed', delivered_at = ?, updated_at = ? WHERE id = ?`
      ).run(now, now, job.id);

      db.prepare(`UPDATE orders SET status = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ?`).run(
        now,
        now,
        job.order_id
      );

      db.prepare(
        `INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
         VALUES (?, ?, 'DELIVERY_COMPLETED', 'rider', ?, 'Delivery code verified, order delivered', ?)`
      ).run(randomId('he'), job.order_id, riderId, now);

      recordVerification(job.id, job.order_id, riderId, 'delivery', true);
    });

    logger.info('rider.delivery_completed', { riderId, jobId: job.id });
    const earnings = db.prepare(`SELECT earnings FROM delivery_jobs WHERE id = ?`).get(job.id) as any;
    res.json({
      message: `Delivery completed. ₹${earnings.earnings} added to your earnings.`,
      jobStatus: 'completed',
      orderStatus: 'delivered',
    });
  })
);

/* -------------------------------------------------------------------------- */
/* History, earnings, profile                                                 */
/* -------------------------------------------------------------------------- */

riderRouter.get(
  '/history',
  route((req: AuthenticatedRequest, res) => {
    const jobs = db
      .prepare(`${JOB_SELECT} WHERE dj.rider_id = ? ORDER BY dj.updated_at DESC LIMIT 100`)
      .all(req.user!.id) as any[];
    res.json({ jobs: jobs.map((row) => jobSummary(row, true)) });
  })
);

riderRouter.get(
  '/earnings',
  route((req: AuthenticatedRequest, res) => {
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS totalJobs,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completedJobs,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN earnings ELSE 0 END), 0) AS totalEarnings
         FROM delivery_jobs WHERE rider_id = ?`
      )
      .get(req.user!.id) as any;
    const daily = db
      .prepare(
        `SELECT date(delivered_at) AS day, COUNT(*) AS jobs, COALESCE(SUM(earnings), 0) AS earnings
         FROM delivery_jobs WHERE rider_id = ? AND status = 'completed' AND delivered_at IS NOT NULL
         GROUP BY date(delivered_at) ORDER BY day DESC LIMIT 14`
      )
      .all(req.user!.id) as any[];

    res.json({
      summary: {
        totalJobs: totals.totalJobs,
        completedJobs: totals.completedJobs,
        totalEarnings: toRupees(totals.totalEarnings),
      },
      daily: daily.reverse(),
    });
  })
);

riderRouter.put(
  '/profile',
  route((req: AuthenticatedRequest, res) => {
    const riderId = req.user!.id;
    const name = requireString(req.body?.name ?? req.user!.name, 'Full name', { min: 2, max: 80 });
    const phone = req.body?.phone ? optionalPhone(req.body.phone) : req.user!.phone;
    const vehicleType = optionalString(req.body?.vehicleType, 'Vehicle type', { max: 40 });
    const vehicleNumber = optionalString(req.body?.vehicleNumber, 'Vehicle number', { max: 20 });
    const licenseNumber = optionalString(req.body?.licenseNumber, 'Licence number', { max: 30 });

    if (phone && !/^[+]?[0-9\s-]{8,16}$/.test(phone)) {
      throw ApiError.badRequest('Please provide a valid contact number.');
    }
    if (vehicleNumber && !/^[A-Za-z0-9\s-]{4,20}$/.test(vehicleNumber)) {
      throw ApiError.badRequest('Please provide a valid vehicle number.');
    }

    const completed = Boolean(phone && vehicleType && vehicleNumber);
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE users SET name = ?, phone = ?, vehicle_type = ?, vehicle_number = ?, license_number = ?,
         onboarding_completed = ?, updated_at = ? WHERE id = ?`
    ).run(
      name,
      phone || null,
      vehicleType || null,
      vehicleNumber || null,
      licenseNumber || null,
      completed ? 1 : 0,
      now,
      riderId
    );

    const rider = db.prepare(`SELECT * FROM users WHERE id = ?`).get(riderId) as any;
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
    });
  })
);
