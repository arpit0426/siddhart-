import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireAuth, requireRole, AuthenticatedRequest } from '../auth.js';

export const riderRouter = Router();

// All rider routes require rider authentication
riderRouter.use(requireAuth, requireRole('rider'));

// Normalize code helper (handles "PK-1234" vs "1234")
function normalizeCode(input: string): string {
  return (input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Get Available Delivery Jobs
riderRouter.get('/jobs/available', (_req, res) => {
  const jobs = db.prepare(`
    SELECT dj.id, dj.order_id, dj.status, dj.earnings, dj.created_at,
           o.order_number, o.status as order_status, o.total as order_total,
           o.address_snapshot, o.created_at as order_created_at,
           s.name as store_name, s.address as store_address, s.city as store_city, s.phone as store_phone
    FROM delivery_jobs dj
    JOIN orders o ON dj.order_id = o.id
    JOIN stores s ON o.store_id = s.id
    WHERE dj.status = 'available' AND dj.rider_id IS NULL AND o.status != 'cancelled'
    ORDER BY dj.created_at ASC
  `).all() as any[];

  const formatted = jobs.map(j => ({
    ...j,
    address_snapshot: JSON.parse(j.address_snapshot || '{}')
  }));

  res.json({ jobs: formatted });
});

// Get Current Active Delivery Job for Rider
riderRouter.get('/jobs/active', (req: AuthenticatedRequest, res) => {
  const riderId = req.user!.id;

  const job = db.prepare(`
    SELECT dj.id, dj.order_id, dj.status, dj.earnings, dj.claimed_at, dj.picked_up_at, dj.created_at,
           o.order_number, o.status as order_status, o.total as order_total,
           o.address_snapshot, o.customer_id,
           u.name as customer_name, u.phone as customer_phone,
           s.name as store_name, s.address as store_address, s.city as store_city, s.phone as store_phone
    FROM delivery_jobs dj
    JOIN orders o ON dj.order_id = o.id
    JOIN stores s ON o.store_id = s.id
    JOIN users u ON o.customer_id = u.id
    WHERE dj.rider_id = ? AND dj.status IN ('claimed', 'pickup_verified', 'out_for_delivery')
  `).get(riderId) as any;

  if (!job) {
    res.json({ job: null });
    return;
  }

  const items = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).all(job.order_id);

  res.json({
    job: {
      ...job,
      address_snapshot: JSON.parse(job.address_snapshot || '{}'),
      items
    }
  });
});

// Atomic Job Claiming (Guarantees only ONE rider can claim a job)
riderRouter.post('/jobs/:id/claim', (req: AuthenticatedRequest, res) => {
  const riderId = req.user!.id;
  const jobId = req.params.id;

  // Check if rider already has an active job
  const existingActive = db.prepare(`
    SELECT id FROM delivery_jobs 
    WHERE rider_id = ? AND status IN ('claimed', 'pickup_verified', 'out_for_delivery')
  `).get(riderId);

  if (existingActive) {
    res.status(400).json({ error: 'You already have an active delivery job in progress. Please complete it first.' });
    return;
  }

  const now = new Date().toISOString();

  // ATOMIC CONDITIONAL UPDATE: Concurrency safe!
  const result = db.prepare(`
    UPDATE delivery_jobs 
    SET rider_id = ?, status = 'claimed', claimed_at = ?, updated_at = ?
    WHERE id = ? AND rider_id IS NULL AND status = 'available'
  `).run(riderId, now, now, jobId);

  if (result.changes === 0) {
    res.status(409).json({ error: 'This delivery job has already been claimed by another rider.' });
    return;
  }

  // Update order's assigned rider
  const job = db.prepare(`SELECT order_id FROM delivery_jobs WHERE id = ?`).get(jobId) as any;
  if (job) {
    db.prepare(`UPDATE orders SET rider_id = ?, updated_at = ? WHERE id = ?`).run(riderId, now, job.order_id);
    db.prepare(`
      INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
      VALUES (?, ?, 'RIDER_ASSIGNED', 'rider', ?, 'Delivery claimed by rider', ?)
    `).run(`he_${crypto.randomUUID().slice(0, 8)}`, job.order_id, riderId, now);
  }

  res.json({ message: 'Delivery job claimed successfully! Proceed to store for pickup.' });
});

// Verify Pickup using Seller's Pickup Code
riderRouter.post('/jobs/:id/verify-pickup', (req: AuthenticatedRequest, res) => {
  const riderId = req.user!.id;
  const jobId = req.params.id;
  const { pickupCode } = req.body;

  if (!pickupCode) {
    res.status(400).json({ error: 'Please enter the pickup code provided by the store seller' });
    return;
  }

  const job = db.prepare(`
    SELECT dj.*, o.pickup_code as actual_pickup_code, o.id as order_id, o.status as order_status
    FROM delivery_jobs dj
    JOIN orders o ON dj.order_id = o.id
    WHERE dj.id = ? AND dj.rider_id = ?
  `).get(jobId, riderId) as any;

  if (!job) {
    res.status(404).json({ error: 'Assigned job not found' });
    return;
  }

  if (job.status !== 'claimed') {
    res.status(400).json({ error: `Cannot verify pickup for a job with status "${job.status}"` });
    return;
  }

  // Validate pickup code
  const enteredNorm = normalizeCode(pickupCode);
  const actualNorm = normalizeCode(job.actual_pickup_code);

  if (enteredNorm !== actualNorm && enteredNorm !== actualNorm.replace(/^PK/, '')) {
    res.status(400).json({ error: 'Incorrect pickup code. Please ask the seller for the 4-digit pickup code.' });
    return;
  }

  const now = new Date().toISOString();

  // ATOMIC UPDATE
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE delivery_jobs 
      SET status = 'out_for_delivery', picked_up_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, jobId);

    db.prepare(`
      UPDATE orders 
      SET status = 'out_for_delivery', updated_at = ?
      WHERE id = ?
    `).run(now, job.order_id);

    db.prepare(`
      INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
      VALUES (?, ?, 'PICKUP_VERIFIED', 'rider', ?, 'Pickup verified with seller code. Out for delivery.', ?)
    `).run(`he_${crypto.randomUUID().slice(0, 8)}`, job.order_id, riderId, now);

    db.exec('COMMIT');
    res.json({ message: 'Pickup verified! Order is now Out for Delivery to customer.' });
  } catch (err: any) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: 'Failed to record pickup verification: ' + err.message });
  }
});

// Verify Delivery using Customer's Delivery Code
riderRouter.post('/jobs/:id/verify-delivery', (req: AuthenticatedRequest, res) => {
  const riderId = req.user!.id;
  const jobId = req.params.id;
  const { deliveryCode } = req.body;

  if (!deliveryCode) {
    res.status(400).json({ error: 'Please enter the delivery code provided by the customer' });
    return;
  }

  const job = db.prepare(`
    SELECT dj.*, o.delivery_code as actual_delivery_code, o.id as order_id, o.status as order_status
    FROM delivery_jobs dj
    JOIN orders o ON dj.order_id = o.id
    WHERE dj.id = ? AND dj.rider_id = ?
  `).get(jobId, riderId) as any;

  if (!job) {
    res.status(404).json({ error: 'Assigned job not found' });
    return;
  }

  if (job.status !== 'out_for_delivery' && job.status !== 'pickup_verified') {
    res.status(400).json({ error: `Cannot verify delivery for job in "${job.status}" status` });
    return;
  }

  // Validate delivery code
  const enteredNorm = normalizeCode(deliveryCode);
  const actualNorm = normalizeCode(job.actual_delivery_code);

  if (enteredNorm !== actualNorm && enteredNorm !== actualNorm.replace(/^DL/, '')) {
    res.status(400).json({ error: 'Incorrect delivery code. Please ask the customer for their delivery verification code.' });
    return;
  }

  const now = new Date().toISOString();

  // ATOMIC UPDATE: Delivery Completion
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE delivery_jobs 
      SET status = 'completed', delivered_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, jobId);

    db.prepare(`
      UPDATE orders 
      SET status = 'delivered', updated_at = ?
      WHERE id = ?
    `).run(now, job.order_id);

    db.prepare(`
      INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
      VALUES (?, ?, 'DELIVERY_COMPLETED', 'rider', ?, 'Delivery code verified. Order completed successfully.', ?)
    `).run(`he_${crypto.randomUUID().slice(0, 8)}`, job.order_id, riderId, now);

    db.exec('COMMIT');
    res.json({ message: 'Delivery completed! Payout ₹40 credited to your rider account.' });
  } catch (err: any) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: 'Failed to record delivery verification: ' + err.message });
  }
});

// Rider Earnings and History
riderRouter.get('/history', (req: AuthenticatedRequest, res) => {
  const riderId = req.user!.id;

  const jobs = db.prepare(`
    SELECT dj.*, o.order_number, o.total as order_total,
           s.name as store_name, s.city as store_city,
           u.name as customer_name
    FROM delivery_jobs dj
    JOIN orders o ON dj.order_id = o.id
    JOIN stores s ON o.store_id = s.id
    JOIN users u ON o.customer_id = u.id
    WHERE dj.rider_id = ?
    ORDER BY dj.updated_at DESC
  `).all(riderId) as any[];

  const summary = db.prepare(`
    SELECT 
      COALESCE(SUM(earnings), 0) as totalEarnings,
      COUNT(*) as totalJobs,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completedJobs
    FROM delivery_jobs
    WHERE rider_id = ? AND status = 'completed'
  `).get(riderId) as any;

  res.json({
    summary: {
      totalEarnings: summary.totalEarnings,
      completedJobs: summary.completedJobs
    },
    jobs
  });
});
