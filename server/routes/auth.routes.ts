import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { hashPassword, verifyPassword, createSession, deleteSession, requireAuth, AuthenticatedRequest } from '../auth.js';
import { seedDemoData } from '../seed.js';

export const authRouter = Router();

// Demo accounts metadata for staging convenience
const DEMO_ACCOUNTS = [
  { role: 'customer', name: 'Aarav Sharma', email: 'customer.demo@nearbuy.app', password: 'NearBuy@2026' },
  { role: 'seller', name: 'Rahul Verma', email: 'seller.demo@nearbuy.app', password: 'NearBuy@2026' },
  { role: 'rider', name: 'Arjun Kumar', email: 'rider.demo@nearbuy.app', password: 'NearBuy@2026' }
];

// Public: Get demo accounts info for quick switch/demo banner
authRouter.get('/demo-accounts', (_req, res) => {
  res.json({ accounts: DEMO_ACCOUNTS });
});

// Quick Demo Login: Authenticates one of the 3 demo users directly
authRouter.post('/demo-login', (req, res) => {
  const { role } = req.body;
  const demoAccount = DEMO_ACCOUNTS.find(a => a.role === role);
  if (!demoAccount) {
    res.status(400).json({ error: `Invalid demo role '${role}'` });
    return;
  }

  // Ensure demo data is seeded
  let user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(demoAccount.email) as any;
  if (!user) {
    seedDemoData();
    user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(demoAccount.email) as any;
  }

  const token = createSession(user.id, user.role);

  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      phone: user.phone,
      status: user.status
    }
  });
});

// Register
authRouter.post('/register', (req, res) => {
  const { role, name, email, phone, password } = req.body;

  if (!role || !['customer', 'seller', 'rider'].includes(role)) {
    res.status(400).json({ error: 'Valid role is required (customer, seller, rider)' });
    return;
  }
  if (!name || name.trim().length < 2) {
    res.status(400).json({ error: 'Full name is required (min 2 characters)' });
    return;
  }
  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'Valid email address is required' });
    return;
  }
  if (!password || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  const id = `usr_${role}_${crypto.randomUUID().slice(0, 8)}`;
  const { hash, salt } = hashPassword(password);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, role, name, email, phone, password_hash, password_salt, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(id, role, name.trim(), normalizedEmail, phone || '', hash, salt, now, now);

  // If customer, initialize cart
  if (role === 'customer') {
    db.prepare(`
      INSERT INTO carts (id, customer_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(`cart_${crypto.randomUUID().slice(0, 8)}`, id, now, now);
  }

  const token = createSession(id, role);

  res.status(201).json({
    token,
    user: {
      id,
      role,
      name: name.trim(),
      email: normalizedEmail,
      phone: phone || null,
      status: 'active'
    }
  });
});

// Login
authRouter.post('/login', (req, res) => {
  const { email, password, expectedRole } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalizedEmail) as any;

  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const valid = verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  // Check expected role if specified
  if (expectedRole && user.role !== expectedRole) {
    res.status(403).json({
      error: `This account is registered as a ${user.role}. Please sign in via the ${user.role} portal.`
    });
    return;
  }

  const token = createSession(user.id, user.role);

  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      phone: user.phone,
      status: user.status
    }
  });
});

// Logout
authRouter.post('/logout', (req: AuthenticatedRequest, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    deleteSession(token);
  }
  res.json({ message: 'Signed out successfully' });
});

// Current User Profile
authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});
