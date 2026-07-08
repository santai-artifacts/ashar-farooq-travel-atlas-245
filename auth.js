// Authentication helpers — password hashing + session tokens using only Node built-ins.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  createSession, findSession, deleteSession, findUserById, pruneSessions,
} from './db.js';

const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'atlas_sid';

// ---- Passwords (scrypt with per-user salt) ----
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// ---- Sessions ----
export function startSession(userId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  createSession(token, userId, expires.toISOString());
  return { token, expires };
}

export function endSession(token) {
  if (token) deleteSession(token);
}

// Parse the session cookie off a raw Cookie header (no cookie-parser dependency).
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Resolve the current user from the session cookie, or null.
export function currentUser(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const session = findSession(token);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    deleteSession(token);
    return null;
  }
  const user = findUserById(session.user_id);
  return user ? { id: user.id, email: user.email, token } : null;
}

// Express middleware: 401 unless authenticated.
export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

// Set / clear the session cookie.
export function setSessionCookie(res, token, expires) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    expires,
    path: '/',
  });
}
export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// Opportunistic cleanup of expired sessions.
pruneSessions();
