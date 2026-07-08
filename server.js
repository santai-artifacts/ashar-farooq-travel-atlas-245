// Travel Atlas — full-stack server.
// Serves the SPA from /public and a JSON REST API from /api.
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import {
  createUser, findUserByEmail, listTrips, insertTrip, deleteTrip,
} from './db.js';
import {
  hashPassword, verifyPassword, startSession, endSession, currentUser,
  requireAuth, setSessionCookie, clearSessionCookie, SESSION_COOKIE,
} from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));

// ---------------------------------------------------------------------------
// Geocoding (server-side proxy to OpenStreetMap Nominatim).
// Nominatim's usage policy REQUIRES a descriptive User-Agent — provide one.
// ---------------------------------------------------------------------------
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&accept-language=en&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'en',
      'User-Agent': 'TravelAtlas/1.0 (full-stack travel tracker demo)',
    },
  });
  if (!res.ok) throw new Error('geocode failed');
  const data = await res.json();
  if (!data.length) return null;
  const hit = data[0];
  return {
    lat: parseFloat(hit.lat),
    lng: parseFloat(hit.lon),
    country: hit.address?.country || '',
  };
}

// Best-effort emoji flag from a country name (mirrors the original client list).
const FLAGS = {
  Japan: '🇯🇵', Portugal: '🇵🇹', Chile: '🇨🇱', France: '🇫🇷', Italy: '🇮🇹', Spain: '🇪🇸',
  'United States': '🇺🇸', USA: '🇺🇸', Germany: '🇩🇪', 'United Kingdom': '🇬🇧', UK: '🇬🇧',
  Mexico: '🇲🇽', Thailand: '🇹🇭', India: '🇮🇳', Brazil: '🇧🇷', Canada: '🇨🇦', Australia: '🇦🇺',
  Greece: '🇬🇷', Iceland: '🇮🇸', Morocco: '🇲🇦', Peru: '🇵🇪', Vietnam: '🇻🇳', Indonesia: '🇮🇩',
  Netherlands: '🇳🇱', Norway: '🇳🇴', Egypt: '🇪🇬', Turkey: '🇹🇷', 'South Korea': '🇰🇷',
  China: '🇨🇳', Switzerland: '🇨🇭',
};
const flagFor = (country) => FLAGS[country] || '📍';

// Sample trips seeded into every new account so the map isn't empty on first run.
function seedTrips(userId) {
  const samples = [
    { place: 'Kyoto, Japan', country: 'Japan', lat: 35.0116, lng: 135.7681,
      start: '2024-04-02', end: '2024-04-09', rating: 5,
      photo: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=800&q=80',
      note: 'Cherry blossoms in full bloom. Wandered the Fushimi Inari gates before sunrise — completely empty and magical.' },
    { place: 'Lisbon, Portugal', country: 'Portugal', lat: 38.7223, lng: -9.1393,
      start: '2023-09-14', end: '2023-09-20', rating: 4,
      photo: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=800&q=80',
      note: 'Tram 28, pastéis de nata, and endless miradouros. The light here is unreal at golden hour.' },
    { place: 'Patagonia, Chile', country: 'Chile', lat: -50.9423, lng: -73.4068,
      start: '2023-01-05', end: '2023-01-14', rating: 5,
      photo: 'https://images.unsplash.com/photo-1531794343519-f70c81b3a01f?w=800&q=80',
      note: 'The W trek in Torres del Paine. Brutal wind, unbelievable peaks. Slept under a sky with no light pollution.' },
  ];
  for (const s of samples) {
    insertTrip({ id: randomUUID(), user_id: userId, flag: flagFor(s.country), ...s });
  }
}

const publicUser = (u) => ({ id: u.id, email: u.email });

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.post('/api/auth/signup', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (findUserByEmail(email)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }
  const user = createUser(email, hashPassword(password));
  seedTrips(user.id);
  const { token, expires } = startSession(user.id);
  setSessionCookie(res, token, expires);
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  const { token, expires } = startSession(user.id);
  setSessionCookie(res, token, expires);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const user = currentUser(req);
  if (user) endSession(user.token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: { id: user.id, email: user.email } });
});

// ---------------------------------------------------------------------------
// Trip routes (all require auth)
// ---------------------------------------------------------------------------
app.get('/api/trips', requireAuth, (req, res) => {
  res.json({ trips: listTrips(req.user.id) });
});

app.post('/api/trips', requireAuth, async (req, res) => {
  const b = req.body || {};
  const place = String(b.place || '').trim();
  const start = String(b.start || '').trim();
  if (!place || !start) {
    return res.status(400).json({ error: 'Destination and arrival date are required.' });
  }

  let geo = null;
  try { geo = await geocode(place); }
  catch { /* offline / rate-limited — still save the trip, just unplaced */ }

  const country = geo?.country || (place.split(',').pop() || '').trim();
  const rating = Math.max(0, Math.min(5, parseInt(b.rating, 10) || 0));

  const trip = insertTrip({
    id: randomUUID(),
    user_id: req.user.id,
    place,
    country,
    flag: flagFor(country),
    lat: geo?.lat,
    lng: geo?.lng,
    start,
    end: String(b.end || '').trim() || null,
    rating,
    photo: String(b.photo || '').trim() || null,
    note: String(b.note || '').trim() || null,
  });
  res.status(201).json({ trip, located: !!geo });
});

app.delete('/api/trips/:id', requireAuth, (req, res) => {
  const ok = deleteTrip(req.params.id, req.user.id);
  if (!ok) return res.status(404).json({ error: 'Trip not found.' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Static SPA
// ---------------------------------------------------------------------------
app.use(express.static(join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Travel Atlas running on http://0.0.0.0:${PORT}`);
});
