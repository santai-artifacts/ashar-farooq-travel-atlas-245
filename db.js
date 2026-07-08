// Database layer — built-in node:sqlite (Node >=22.5). No native builds, no npm deps.
// Exposes a small set of prepared-statement helpers so the rest of the app never
// writes raw SQL inline.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'atlas.db'));

// Reasonable defaults for a small server app.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS trips (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    place      TEXT NOT NULL,
    country    TEXT,
    flag       TEXT,
    lat        REAL,
    lng        REAL,
    start      TEXT NOT NULL,
    end        TEXT,
    rating     INTEGER DEFAULT 0,
    photo      TEXT,
    note       TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// ---- Users ----
const _createUser = db.prepare(
  'INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)'
);
const _findUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const _findUserById = db.prepare('SELECT * FROM users WHERE id = ?');

export function createUser(email, passwordHash) {
  const info = _createUser.run(email, passwordHash, new Date().toISOString());
  return _findUserById.get(info.lastInsertRowid);
}
export function findUserByEmail(email) {
  return _findUserByEmail.get(email);
}
export function findUserById(id) {
  return _findUserById.get(id);
}

// ---- Sessions ----
const _createSession = db.prepare(
  'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
);
const _findSession = db.prepare('SELECT * FROM sessions WHERE token = ?');
const _deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
const _deleteExpired = db.prepare("DELETE FROM sessions WHERE expires_at < ?");

export function createSession(token, userId, expiresAt) {
  _createSession.run(token, userId, new Date().toISOString(), expiresAt);
}
export function findSession(token) {
  return _findSession.get(token);
}
export function deleteSession(token) {
  _deleteSession.run(token);
}
export function pruneSessions() {
  _deleteExpired.run(new Date().toISOString());
}

// ---- Trips ----
const _listTrips = db.prepare(
  'SELECT * FROM trips WHERE user_id = ? ORDER BY start DESC, created_at DESC'
);
const _insertTrip = db.prepare(`
  INSERT INTO trips (id, user_id, place, country, flag, lat, lng, start, end, rating, photo, note, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const _findTrip = db.prepare('SELECT * FROM trips WHERE id = ? AND user_id = ?');
const _deleteTrip = db.prepare('DELETE FROM trips WHERE id = ? AND user_id = ?');

export function listTrips(userId) {
  return _listTrips.all(userId);
}
export function insertTrip(t) {
  _insertTrip.run(
    t.id, t.user_id, t.place, t.country ?? null, t.flag ?? null,
    t.lat ?? null, t.lng ?? null, t.start, t.end ?? null,
    t.rating ?? 0, t.photo ?? null, t.note ?? null, new Date().toISOString()
  );
  return _findTrip.get(t.id, t.user_id);
}
export function deleteTrip(id, userId) {
  const info = _deleteTrip.run(id, userId);
  return info.changes > 0;
}
