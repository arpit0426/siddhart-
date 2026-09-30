import { db } from './db.js';

export interface UserRow {
  id: string;
  role: 'customer' | 'seller' | 'rider';
  name: string;
  email: string;
  phone: string | null;
  status: string;
  created_at: string;
}

export function userExists(email: string): UserRow | null {
  const row = db
    .prepare(`SELECT id, role, name, email, phone, status, created_at FROM users WHERE email = ?`)
    .get(email.trim().toLowerCase()) as any;
  return row ?? null;
}

export function findUserById(id: string): any | null {
  return (db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as any) ?? null;
}
