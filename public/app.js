/* ============================================================
   Travel Atlas — full-stack client.
   Talks to the REST API; trips live in the server database.
   Auth is a cookie session managed by the server.
   ============================================================ */

// ---- Tiny API helper ----
async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---- State ----
let trips = [];
let currentUserEmail = null;
let selectedRating = 0;
let activeFilter = 'all';
let map, markerLayer, mapReady = false;

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const authScreen = $('authScreen');
const appEl = $('app');

// ---- Display helpers (pure, client-side) ----
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function dateRange(t) {
  if (t.end && t.end !== t.start) return fmtDate(t.start) + ' → ' + fmtDate(t.end);
  return fmtDate(t.start);
}
function daysOf(t) {
  if (!t.end) return 1;
  const a = new Date(t.start), b = new Date(t.end);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}
function esc(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

const FLAGS = { Japan:'🇯🇵', Portugal:'🇵🇹', Chile:'🇨🇱', France:'🇫🇷', Italy:'🇮🇹', Spain:'🇪🇸',
  'United States':'🇺🇸', USA:'🇺🇸', Germany:'🇩🇪', 'United Kingdom':'🇬🇧', UK:'🇬🇧', Mexico:'🇲🇽',
  Thailand:'🇹🇭', India:'🇮🇳', Brazil:'🇧🇷', Canada:'🇨🇦', Australia:'🇦🇺', Greece:'🇬🇷',
  Iceland:'🇮🇸', Morocco:'🇲🇦', Peru:'🇵🇪', Vietnam:'🇻🇳', Indonesia:'🇮🇩', Netherlands:'🇳🇱',
  Norway:'🇳🇴', Egypt:'🇪🇬', Turkey:'🇹🇷', 'South Korea':'🇰🇷', China:'🇨🇳', Switzerland:'🇨🇭' };
function flagFor(country) { return FLAGS[country] || '📍'; }
function placeholderImg(t) {
  const hues = [12, 168, 42, 200, 320];
  const h = hues[(t.place.charCodeAt(0) + t.place.length) % hues.length];
  return `linear-gradient(135deg, hsl(${h} 45% 30%), hsl(${(h+40)%360} 40% 22%))`;
}

// ---- Map ----
function initMap() {
  if (mapReady) return;
  map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([20, 10], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  mapReady = true;
}
function renderMarkers() {
  if (!markerLayer) return;
  markerLayer.clearLayers();
  const pts = [];
  visibleTrips().forEach(t => {
    if (typeof t.lat !== 'number') return;
    const icon = L.divIcon({
      className: '',
      html: `<div style="font-size:26px;line-height:1;transform:translate(-50%,-100%);filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));cursor:pointer">${t.flag || '📍'}</div>`,
      iconSize: [0, 0]
    });
    const m = L.marker([t.lat, t.lng], { icon })
      .bindPopup(`<b>${esc(t.place)}</b><br><span style="color:#8ea3b8;font-size:12px">${dateRange(t)} · ${'★'.repeat(t.rating||0)}</span>`)
      .on('click', () => openDetail(t.id));
    markerLayer.addLayer(m);
    pts.push([t.lat, t.lng]);
  });
  if (pts.length) {
    try { map.fitBounds(pts, { padding: [50, 50], maxZoom: 6 }); } catch (e) {}
  }
}

// ---- Rendering: stats, filters, list ----
function render() {
  renderStats();
  renderFilters();
  renderList();
  renderMarkers();
}
function renderStats() {
  $('statTrips').textContent = trips.length;
  $('statCountries').textContent = new Set(trips.map(t => t.country).filter(Boolean)).size;
  $('statDays').textContent = trips.reduce((s, t) => s + daysOf(t), 0);
}
function renderFilters() {
  const countries = [...new Set(trips.map(t => t.country).filter(Boolean))].sort();
  const el = $('filters');
  el.innerHTML = '';
  const mk = (val, label) => {
    const c = document.createElement('div');
    c.className = 'chip' + (activeFilter === val ? ' on' : '');
    c.textContent = label;
    c.onclick = () => { activeFilter = val; render(); };
    el.appendChild(c);
  };
  mk('all', 'All');
  countries.forEach(c => mk(c, `${flagFor(c)} ${c}`));
}
function visibleTrips() {
  const list = activeFilter === 'all' ? trips : trips.filter(t => t.country === activeFilter);
  return [...list].sort((a, b) => (b.start || '').localeCompare(a.start || ''));
}
function renderList() {
  const wrap = $('tripList');
  const list = visibleTrips();
  if (!list.length) {
    wrap.className = '';
    wrap.innerHTML = `<div class="empty"><div class="big">🗺️</div><h3>No trips yet</h3><p>Log your first destination on the left and watch it drop onto the map.</p></div>`;
    return;
  }
  wrap.className = 'grid';
  wrap.innerHTML = list.map(t => {
    const thumb = t.photo
      ? `background-image:url('${esc(t.photo)}')`
      : `background-image:${placeholderImg(t)}`;
    return `<div class="trip" data-id="${t.id}">
      <div class="thumb" style="${thumb}">
        <span class="flag">${t.flag || '📍'}</span>
        ${t.rating ? `<span class="rate">${'★'.repeat(t.rating)}</span>` : ''}
      </div>
      <div class="body">
        <h3>${esc(t.place.split(',')[0])}</h3>
        <div class="place">${esc(t.country || t.place)}</div>
        <div class="date">${dateRange(t)}</div>
        ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.trip').forEach(el =>
    el.onclick = () => openDetail(el.dataset.id));
}
function showListLoading() {
  const wrap = $('tripList');
  wrap.className = '';
  wrap.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading your journeys…</p></div>`;
}

// ---- Detail modal ----
function openDetail(id) {
  const t = trips.find(x => x.id === id);
  if (!t) return;
  const hero = t.photo ? `background-image:url('${esc(t.photo)}')` : `background-image:${placeholderImg(t)}`;
  $('modal').innerHTML = `
    <div class="hero" style="${hero}"></div>
    <div class="content">
      <h2>${t.flag || '📍'} ${esc(t.place.split(',')[0])}</h2>
      <div class="sub">${esc(t.place)}</div>
      <div class="meta">
        <div><div class="k">When</div>${dateRange(t)}</div>
        <div><div class="k">Duration</div>${daysOf(t)} day${daysOf(t)>1?'s':''}</div>
        <div><div class="k">Rating</div><span style="color:var(--gold)">${'★'.repeat(t.rating||0)}${'☆'.repeat(5-(t.rating||0))}</span></div>
      </div>
      ${t.note ? `<p class="notes">${esc(t.note)}</p>` : '<p class="notes" style="opacity:.5">No notes for this trip.</p>'}
      <div class="actions">
        <button class="close">Close</button>
        <button class="del" data-id="${t.id}">Delete trip</button>
      </div>
    </div>`;
  const ov = $('overlay');
  ov.classList.add('show');
  document.querySelector('.modal .close').onclick = closeModal;
  document.querySelector('.modal .del').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      await api('/trips/' + id, { method: 'DELETE' });
      trips = trips.filter(x => x.id !== id);
      closeModal(); render(); toast('Trip removed');
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Delete trip';
      toast(err.message || 'Could not delete trip');
    }
  };
  if (typeof t.lat === 'number') { map.setView([t.lat, t.lng], 6, { animate: true }); }
}
function closeModal() { $('overlay').classList.remove('show'); }
$('overlay').onclick = e => { if (e.target.id === 'overlay') closeModal(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---- Rating widget ----
const ratingEl = $('rating');
ratingEl.querySelectorAll('button').forEach(b => {
  b.onclick = () => {
    selectedRating = +b.dataset.v;
    ratingEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.v <= selectedRating));
  };
});

// ---- Trip form submit → POST /api/trips ----
$('tripForm').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('submitBtn');
  const place = $('place').value.trim();
  const start = $('start').value;
  if (!place || !start) return;

  btn.disabled = true; btn.textContent = 'Finding on map…';
  try {
    const { trip, located } = await api('/trips', {
      method: 'POST',
      body: {
        place,
        start,
        end: $('end').value || '',
        rating: selectedRating,
        photo: $('photo').value.trim(),
        note: $('note').value.trim(),
      },
    });
    trips.push(trip);
    render();
    // reset
    e.target.reset();
    selectedRating = 0;
    ratingEl.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    toast(located ? `${trip.flag} ${place.split(',')[0]} added!` : `${place.split(',')[0]} saved (couldn't locate on map)`);
  } catch (err) {
    if (err.status === 401) return handleSignedOut();
    toast(err.message || 'Could not save trip');
  } finally {
    btn.disabled = false; btn.textContent = 'Add to map';
  }
};

// ============================================================
//  Auth
// ============================================================
let authMode = 'login'; // 'login' | 'signup'

function setAuthMode(mode) {
  authMode = mode;
  const login = mode === 'login';
  $('authTitle').textContent = login ? 'Welcome back' : 'Create your atlas';
  $('authLede').textContent = login
    ? 'Sign in to open your personal atlas.'
    : 'Sign up and we\'ll drop a few sample trips on your map to get you started.';
  $('authSubmit').textContent = login ? 'Sign in' : 'Create account';
  $('authToggleText').textContent = login ? 'New here?' : 'Already have an account?';
  $('authToggle').textContent = login ? 'Create an account' : 'Sign in';
  hideAuthError();
}
function showAuthError(msg) { const e = $('authError'); e.textContent = msg; e.classList.add('show'); }
function hideAuthError() { $('authError').classList.remove('show'); }

$('authToggle').onclick = () => setAuthMode(authMode === 'login' ? 'signup' : 'login');

$('authForm').onsubmit = async (e) => {
  e.preventDefault();
  hideAuthError();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const btn = $('authSubmit');
  btn.disabled = true; btn.textContent = authMode === 'login' ? 'Signing in…' : 'Creating…';
  try {
    const { user } = await api('/auth/' + (authMode === 'login' ? 'login' : 'signup'), {
      method: 'POST', body: { email, password },
    });
    await enterApp(user.email);
  } catch (err) {
    showAuthError(err.message || 'Something went wrong.');
  } finally {
    btn.disabled = false;
    setAuthMode(authMode); // restores button label
  }
};

$('logoutBtn').onclick = async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  handleSignedOut();
};

function handleSignedOut() {
  currentUserEmail = null;
  trips = [];
  appEl.classList.add('hidden');
  authScreen.classList.remove('hidden');
  $('authForm').reset();
  setAuthMode('login');
}

async function enterApp(email) {
  currentUserEmail = email;
  authScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  $('userEmail').textContent = email;
  $('userEmail').title = email;
  $('avatar').textContent = (email[0] || '?').toUpperCase();

  // Leaflet needs the container visible before init/sizing.
  initMap();
  setTimeout(() => map.invalidateSize(), 0);

  showListLoading();
  try {
    const { trips: loaded } = await api('/trips');
    trips = loaded;
    render();
  } catch (err) {
    if (err.status === 401) return handleSignedOut();
    $('tripList').innerHTML = `<div class="empty"><div class="big">⚠️</div><h3>Couldn't load trips</h3><p>${esc(err.message)}</p></div>`;
  }
}

// ---- Boot: check for an existing session ----
(async function boot() {
  try {
    const { user } = await api('/auth/me');
    await enterApp(user.email);
  } catch {
    authScreen.classList.remove('hidden');
    setAuthMode('login');
  }
})();
