/* =========================================================
   SERVER CONNECTOR
   Talks to the Apps Script backend with a plain fetch() POST — no
   google.script.run, no HtmlService iframe. This is what avoids the
   browser-extension/security-tool interference entirely: this page is a
   normal static page like any other, not a page embedded in Google's
   sandboxed iframe.
   ========================================================= */

/* Resolves the backend URL from whichever place it was set.
   index.html sets window.API_URL inline. Older deployments used a separate
   config.js with `const API_URL = …`; that still works and takes priority,
   so an existing config.js does not need to be deleted. */
function apiUrl(){
  if(typeof API_URL !== 'undefined' && API_URL) return API_URL;
  if(window.API_URL) return window.API_URL;
  throw new Error('API_URL is not set. Open index.html and check the window.API_URL line near the bottom.');
}

let gsQueue = Promise.resolve();
function gsRun(fnName, ...args){
  const run = () => fetch(apiUrl(), {
    method: 'POST',
    headers: {'Content-Type': 'text/plain;charset=utf-8'}, // keeps this a "simple request" so the browser skips a CORS preflight
    body: JSON.stringify({fn: fnName, args})
  })
    .then(r => r.json())
    .then(data => {
      if(!data.ok) throw new Error(data.error || 'Server error');
      return data.result;
    });
  // Every call is chained onto a single queue so two calls never fire at
  // the exact same instant.
  const result = gsQueue.then(run, run);
  gsQueue = result.catch(() => {});
  return result;
}

/* =========================================================
   ROLES AND PERMISSIONS

   One role per person, stored in the Employees sheet's `Role` column. It is
   both the badge shown on the schedule and the source of what someone may
   do — so a Fundraiser can never accidentally end up with Manager rights.

   Levels are ordered. A tab has a minimum level to SEE it, and everything
   from EDIT_FROM_LEVEL up may also CHANGE things. Adding a role later means
   adding one line to ROLE_LEVEL, nothing else.

   IMPORTANT — this is interface-level access control, not security. The
   Apps Script web app is deployed as "Anyone", so anyone who knows the URL
   could call it directly. Hiding a button hides it from honest mistakes,
   not from someone determined. Fine for an internal team tool; do not put
   anything here you would not accept a fundraiser being able to read.
   ========================================================= */
const ROLES = [
  'Fundraiser',
  'Team Leader',
  'Senior Team Leader',
  'Assistant Manager',
  'Manager',
  'Senior Manager / Director'
];
const ROLE_LEVEL = {
  'Fundraiser': 1,
  'Team Leader': 2,
  'Senior Team Leader': 3,
  'Assistant Manager': 4,
  'Manager': 5,
  'Senior Manager / Director': 6
};
const EDIT_FROM_LEVEL = 4; // Assistant Manager and above may change things

/* Values that predate the six roles. Read-time only — nothing in the sheet
   is rewritten, so existing rows keep working while they get tidied up by
   hand. The rights each one maps to are the rights it already had. */
const LEGACY_ROLES = {
  'Canvasser': 'Fundraiser',
  'Supervisor': 'Team Leader'
};

/* Minimum level required to see each tab. */
const TAB_MIN_LEVEL = {
  schedule:  1,
  charity:   1,
  docs:      1,
  logistics: 2,
  team:      2,
  badges:    4,
  retired:   4
};

const ROLE_TAG = {
  'Fundraiser': 'tag-fundraiser',
  'Team Leader': 'tag-tl',
  'Senior Team Leader': 'tag-stl',
  'Assistant Manager': 'tag-am',
  'Manager': 'tag-manager',
  'Senior Manager / Director': 'tag-director'
};

/* Returns the canonical role name, or null if the value is not recognised.
   Tolerates casing and stray spaces, and maps the legacy names. */
function normalizeRole(raw){
  const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if(!s) return null;
  if(ROLE_LEVEL[s]) return s;
  if(LEGACY_ROLES[s]) return LEGACY_ROLES[s];
  const lower = s.toLowerCase();
  const hit = ROLES.find(r => r.toLowerCase() === lower);
  if(hit) return hit;
  const legacyKey = Object.keys(LEGACY_ROLES).find(k => k.toLowerCase() === lower);
  if(legacyKey) return LEGACY_ROLES[legacyKey];
  // "Senior Manager", "Director" typed on their own
  if(lower === 'director' || lower === 'senior manager') return 'Senior Manager / Director';
  return null;
}
function roleLevel(role){ const r = normalizeRole(role); return r ? ROLE_LEVEL[r] : 0; }
function roleTagClass(role){ const r = normalizeRole(role); return r ? ROLE_TAG[r] : 'tag-unknown'; }
/* What to print for a role, keeping the original text visible when it is
   not one of the six — so a bad value is obvious instead of silent. */
function roleLabel(raw){
  const r = normalizeRole(raw);
  if(r) return r;
  const s = String(raw == null ? '' : raw).trim();
  return s ? s + ' ?' : 'No role set';
}

function myLevel(){ return session ? roleLevel(session.role) : 0; }

/* CITY SCOPING
   Only Senior Manager / Director sees every city. Everyone else is confined
   to the city on their record, which is why the schedule, team, badges and
   logistics tabs all ask myCity() rather than offering a picker. */
function canSeeAllCities(){ return myLevel() >= ROLE_LEVEL['Senior Manager / Director']; }
function myCity(){ return session ? String(session.city || '').trim() : ''; }
/* Whether this person may see other people's individual EOD figures.
   Fundraisers see their own line plus their city's totals, and nothing else. */
function canSeeOthersFigures(){ return myLevel() >= 2; }
function canEdit(){ return myLevel() >= EDIT_FROM_LEVEL; }
function canView(tab){
  const min = TAB_MIN_LEVEL[tab];
  return min ? myLevel() >= min : false;
}
/* First tab this person is allowed to see — used after login and as a
   fallback if they somehow land on a tab they may not open. */
function firstVisibleTab(){
  const order = ['schedule','charity','docs','logistics','team','badges','retired'];
  return order.find(canView) || 'schedule';
}

/* =========================================================
   DATE HELPERS (client-side, mirrors SheetUtil.gs logic)

   IMPORTANT — why we never use toISOString() here:
   toISOString() converts to UTC first. For a browser in BST (UTC+1) local
   midnight is 23:00 the *previous* day in UTC, so every date came out one
   day early; for a browser west of UTC (e.g. Toronto) any evening time
   rolled forward to the next UTC day, so getMonday() could return a
   Tuesday. Both produced day columns whose header didn't match the data.
   isoLocal() below reads the calendar fields directly, so the string is
   always the date the user actually sees on their own clock.
   ========================================================= */
function isoLocal(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
/* Parse a 'YYYY-MM-DD' string into a local Date at midday. Midday, not
   midnight, so that a DST transition can never tip the date over. */
function parseIso(iso){
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
function todayISO(){ return isoLocal(new Date()); }
function fmtDate(iso){
  if(!iso) return '';
  return parseIso(iso).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}
function addMonths(iso, n){ const d = parseIso(iso); d.setMonth(d.getMonth() + n); return isoLocal(d); }
function daysBetween(a, b){ return Math.round((parseIso(b) - parseIso(a)) / 86400000); }
function getMonday(d){
  // Normalise to local midday first so the time of day can never shift the date.
  const src = (d instanceof Date) ? d : parseIso(d);
  const dt = new Date(src.getFullYear(), src.getMonth(), src.getDate(), 12, 0, 0, 0);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return isoLocal(dt);
}
function shiftDate(iso, n){ const d = parseIso(iso); d.setDate(d.getDate() + n); return isoLocal(d); }
const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function computeHours(start, end, breakMin){
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if(mins < 0) mins += 24 * 60;
  mins -= (breakMin || 0);
  return Math.max(0, mins / 60);
}

/* Money / number formatting used by the schedule + weekly resume. */
function fmtGBP(n){
  const v = Number(n) || 0;
  return '£' + v.toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function num(v){ const n = Number(v); return isFinite(n) ? n : 0; }
/* Escapes text before it goes into a template string, so a name with an
   apostrophe or angle bracket can't break the markup. */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* =========================================================
   GLOBAL STATE
   ========================================================= */
let DATA = { campaigns:[], cities:[], charity:[], trainings:[], signatures:[], logistics:{cities:{},log:[]}, badgeLog:[], nextBadgeId:1, employeesForLogin:[], employees:[], retired:[] };
let scheduleCache = {};
let session = null; // {role, employeeId, name, city}
let ui = { tab:'schedule', weekMonday:getMonday(new Date()), city:null, scheduleCity:null, modal:null, loginError:null, loginPick:null, revealedPins:null };

/* Rows the user has just asked to change and that are still in flight.
   The schedule renderer greys these out so a slow server round-trip never
   looks like "nothing happened". */
let pendingRows = new Set();

/* Modules register a function here; it gets called every time a modal is
   rendered, so each module can wire up its own modal's Save/Cancel buttons
   without core.html needing to know anything about them. */
window.moduleModalAttachers = [];

/* =========================================================
   FEEDBACK: TOASTS + BUSY BUTTONS
   Every server call in this app takes a second or two (Apps Script is not
   fast). Without these two helpers the user clicks Save, nothing visibly
   happens, and they can't tell whether it worked.
   ========================================================= */
function toast(msg, kind){
  let host = document.getElementById('toastHost');
  if(!host){
    host = document.createElement('div');
    host.id = 'toastHost';
    document.body.appendChild(host); // outside #root, so render() never wipes it
  }
  const t = document.createElement('div');
  t.className = 'toast toast-' + (kind === 'bad' ? 'bad' : kind === 'info' ? 'info' : 'good');
  t.innerHTML = '<span class="ic">' + (kind === 'bad' ? '!' : kind === 'info' ? '·' : '✓') + '</span><span class="tx"></span>';
  t.querySelector('.tx').textContent = msg;
  host.appendChild(t);
  const life = kind === 'bad' ? 6000 : 2600;
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, life);
}

/* Puts a button into a spinner state and returns a function that restores it. */
function setBusy(el, label){
  if(!el) return function(){};
  const prevHtml = el.innerHTML;
  const prevDisabled = el.disabled;
  const prevWidth = el.style.minWidth;
  el.style.minWidth = el.offsetWidth + 'px'; // stop the button jumping around
  el.disabled = true;
  el.classList.add('is-busy');
  el.innerHTML = '<span class="spinner"></span>' + (label ? ' ' + label : '');
  return function restore(){
    el.innerHTML = prevHtml;
    el.disabled = prevDisabled;
    el.classList.remove('is-busy');
    el.style.minWidth = prevWidth;
  };
}

/* safeAction + a spinner on the button that triggered it + a success toast.
   Use this for anything that writes to the sheet. */
function safeButtonAction(btn, busyLabel, fn, successMsg){
  const restore = setBusy(btn, busyLabel);
  let restored = false;
  return Promise.resolve()
    .then(fn)
    .then(() => { if(successMsg) toast(successMsg, 'good'); })
    .catch(err => {
      restore(); restored = true;
      toast((err && err.message) ? err.message : String(err), 'bad');
    })
    .then(() => { if(!restored){ try{ restore(); }catch(e){} } });
}

/* Wrap any button click that calls the server: on failure, show the real
   error instead of leaving the UI stuck with no feedback. */
async function safeAction(fn){
  try{ await fn(); }
  catch(err){
    const msg = (err && err.message) ? err.message : String(err);
    toast(msg, 'bad');
  }
}

/* =========================================================
   CONFIRMATION DIALOG
   Anything that removes or hides a record asks first. One helper so every
   confirmation looks and behaves the same.
   ========================================================= */
let pendingConfirm = null;
function confirmAction(opts){
  pendingConfirm = opts.onConfirm;
  ui.modal = {
    title: opts.title || 'Are you sure?',
    body: `
      <p style="margin:0;font-size:14px;line-height:1.6;">${opts.message}</p>
      ${opts.note ? `<p class="small muted" style="margin-top:10px;">${opts.note}</p>` : ''}
      <div class="modal-actions">
        <button class="btn" id="cf_no">No, cancel</button>
        <button class="btn ${opts.danger ? 'btn-danger-solid' : 'btn-accent'}" id="cf_yes">${opts.confirmLabel || 'Yes, continue'}</button>
      </div>`
  };
  render();
}
window.moduleModalAttachers.push(function attachConfirmModal(){
  const yes = document.getElementById('cf_yes');
  if(!yes) return;
  document.getElementById('cf_no').onclick = ()=>{ pendingConfirm = null; closeModal(); };
  yes.onclick = function(){
    const fn = pendingConfirm;
    safeButtonAction(this, 'Working…', async ()=>{
      if(fn) await fn();
      pendingConfirm = null;
      closeModal();
    });
  };
});

/* =========================================================
   LIVE REFRESH (polling)
   Apps Script web apps have no push/websocket channel, so "live" here means:
   every POLL_INTERVAL_MS, silently re-fetch whatever the current tab needs
   and only re-render if something actually changed. Each js-<tab>.js file
   registers its own refresher below — this file doesn't need to know what
   each tab fetches.
   ========================================================= */
const POLL_INTERVAL_MS = 15000;
window.tabRefreshers = {}; // tab id -> async function()
let pollTimer = null;
let lastSyncAt = null;

function startPolling(){
  if(pollTimer) return;
  pollTimer = setInterval(pollTick, POLL_INTERVAL_MS);
}
function stopPolling(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
}
async function pollTick(){
  if(!session || ui.modal) return; // never interrupt an open form
  if(pendingRows.size) return;     // never re-render on top of a change still in flight
  const active = document.activeElement;
  if(active && ['INPUT','SELECT','TEXTAREA'].includes(active.tagName)) return; // never interrupt typing
  const fn = window.tabRefreshers[ui.tab];
  if(!fn) return;
  try{ await fn(); lastSyncAt = new Date(); updateSyncIndicator(); }
  catch(e){ /* transient network hiccup — try again next tick */ }
}
function updateSyncIndicator(){
  const el = document.getElementById('syncIndicator');
  if(el && lastSyncAt) el.textContent = 'Synced ' + lastSyncAt.toLocaleTimeString();
}
async function manualRefresh(){
  const btn = document.getElementById('refreshNow');
  await safeButtonAction(btn, 'Refreshing…', async () => {
    const fn = window.tabRefreshers[ui.tab];
    if(fn) await fn();
    lastSyncAt = new Date();
    render();
  });
}

/* =========================================================
   RENDER ROOT
   ========================================================= */
function render(){
  const root = document.getElementById('root');
  if(!session){ root.innerHTML = renderLogin(); attachLoginEvents(); return; }
  root.innerHTML = renderShell();
  attachShellEvents();
}

/* ---------- LOGIN ----------
   Two kinds of sign-in, both by name:
   - A Fundraiser picks "Fundraiser", then their city, then their own name from
     the fundraisers in that city. No PIN. Naming themselves is what keeps
     document signatures attributable — the alternative, a shared anonymous
     login, records whatever they type by hand.
   - Everyone from Team Leader up picks their own name and enters their PIN.
   Either way the role comes from their record, so it can't be chosen wrongly
   at the door.
*/
const FUNDRAISER_LOGIN = '__fundraiser__';

/* What the person has picked so far. Kept in ui, not just in the DOM, because
   showing a validation error re-renders the screen — and losing their
   selections every time they get something slightly wrong is maddening. */
function loginPick(){
  if(!ui.loginPick) ui.loginPick = {who:'', city:'', frName:''};
  return ui.loginPick;
}

/** The fundraisers in one city, for the second dropdown. */
function fundraisersIn(city){
  if(!city) return [];
  const c = String(city).trim().toLowerCase();
  return (DATA.employeesForLogin || [])
    .filter(e => !e.needsPin && String(e.city || '').trim().toLowerCase() === c)
    .sort((a, b) => (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName));
}

function renderLogin(){
  const pick = loginPick();
  const all = (DATA.employeesForLogin || [])
    .slice()
    .sort((a, b) => (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName));
  /* Managers are listed by name at the top level; fundraisers appear only
     after a city is chosen, so the first dropdown stays short. */
  const named = all.filter(e => e.needsPin);
  const cities = DATA.cities || [];
  const isFundraiser = pick.who === FUNDRAISER_LOGIN;
  const frList = fundraisersIn(pick.city);

  let frOptions;
  if(!pick.city){
    frOptions = '<option value="">— choose your city first —</option>';
  } else if(!frList.length){
    frOptions = `<option value="">No fundraisers listed in ${esc(pick.city)} yet</option>`;
  } else {
    frOptions = '<option value="">— choose your name —</option>' + frList.map(e =>
      `<option value="${esc(e.id)}" ${pick.frName===e.id?'selected':''}>${esc(e.firstName + ' ' + e.lastName)}</option>`
    ).join('');
  }

  return `<div id="login-screen"><div class="login-box">
    <span class="tag">Field Ops</span><h1>Outreach Hub</h1>
    <p class="sub">Sign in to view your schedule, documents and team tools.</p>
    ${ui.loginError ? `<div class="login-error">${ui.loginError}</div>` : ''}
    <div class="field"><label>Who are you?</label>
      <select id="loginEmp">
        <option value="">— choose —</option>
        <option value="${FUNDRAISER_LOGIN}" ${isFundraiser?'selected':''}>Fundraiser</option>
        ${named.length ? `<optgroup label="Team leaders and managers">
          ${named.map(e => `<option value="${esc(e.id)}" ${pick.who===e.id?'selected':''}>${esc(e.firstName + ' ' + e.lastName)}</option>`).join('')}
        </optgroup>` : ''}
      </select>
    </div>
    <div class="field" id="loginCityWrap" style="display:${isFundraiser?'block':'none'};"><label>Your city</label>
      <select id="loginCity">
        <option value="">— choose —</option>
        ${cities.map(c => `<option value="${esc(c)}" ${pick.city===c?'selected':''}>${esc(c)}</option>`).join('')}
      </select>
    </div>
    <div class="field" id="loginFrNameWrap" style="display:${isFundraiser?'block':'none'};"><label>Your name</label>
      <select id="loginFrName">${frOptions}</select>
    </div>
    <div class="field" id="loginPinWrap" style="display:${(pick.who && !isFundraiser)?'block':'none'};"><label>PIN</label>
      <input type="password" inputmode="numeric" maxlength="6" id="loginPin" placeholder="••••">
    </div>
    <button class="btn-primary" id="loginGo">Sign in</button>
    <div class="login-note">Fundraisers pick their city and their name — no PIN needed. Everyone else needs their PIN; ask a manager if you've forgotten it.</div>
  </div></div>`;
}

function attachLoginEvents(){
  const sel = document.getElementById('loginEmp');
  const go = document.getElementById('loginGo');
  if(!sel || !go) return;
  const cityWrap = document.getElementById('loginCityWrap');
  const frNameWrap = document.getElementById('loginFrNameWrap');
  const pinWrap = document.getElementById('loginPinWrap');
  const citySel = document.getElementById('loginCity');
  const frNameSel = document.getElementById('loginFrName');
  const pick = loginPick();

  /* Shown and hidden in place rather than by re-rendering, so a half-typed
     PIN isn't thrown away mid-selection. */
  sel.onchange = ()=>{
    pick.who = sel.value;
    const isFundraiser = sel.value === FUNDRAISER_LOGIN;
    cityWrap.style.display = isFundraiser ? 'block' : 'none';
    frNameWrap.style.display = isFundraiser ? 'block' : 'none';
    pinWrap.style.display = (sel.value && !isFundraiser) ? 'block' : 'none';
  };

  /* The name list follows the city, so nobody can pick a colleague from
     another city by accident. */
  citySel.onchange = ()=>{
    pick.city = citySel.value;
    pick.frName = '';
    const mine = fundraisersIn(pick.city);
    if(!pick.city){
      frNameSel.innerHTML = '<option value="">— choose your city first —</option>';
    } else if(!mine.length){
      frNameSel.innerHTML = `<option value="">No fundraisers listed in ${esc(pick.city)} yet</option>`;
    } else {
      frNameSel.innerHTML = '<option value="">— choose your name —</option>' +
        mine.map(e => `<option value="${esc(e.id)}">${esc(e.firstName + ' ' + e.lastName)}</option>`).join('');
    }
  };
  frNameSel.onchange = ()=>{ pick.frName = frNameSel.value; };

  const pinEl = document.getElementById('loginPin');
  if(pinEl) pinEl.onkeydown = (e)=>{ if(e.key === 'Enter') go.click(); };

  function refuse(msg){ ui.loginError = msg; render(); }

  go.onclick = ()=> safeButtonAction(go, 'Signing in…', async ()=>{
    const choice = sel.value;
    if(!choice) return refuse('Choose who you are.');

    /* Fundraiser: no PIN, but they name themselves. The server checks that the
       name really is a fundraiser in that city, so this path can't be used to
       sign in as a manager. */
    if(choice === FUNDRAISER_LOGIN){
      if(!citySel.value) return refuse('Choose your city.');
      if(!frNameSel.value) return refuse('Choose your name from the list. If it isn\'t there, ask a manager to add you to the team.');
      const fr = await gsRun('loginFundraiser', frNameSel.value, citySel.value);
      if(!fr.ok) return refuse(fr.error);
      session = {
        employeeId: fr.employee.id,
        name: fr.employee.firstName + ' ' + fr.employee.lastName,
        role: 'Fundraiser',
        city: fr.employee.city || citySel.value
      };
      await startSession();
      return;
    }

    if(!pinEl.value) return refuse('Enter your PIN.');
    const res = await gsRun('login', choice, pinEl.value);
    if(!res.ok) return refuse(res.error);

    const role = normalizeRole(res.employee.role);
    if(!role){
      // Better to say exactly what is wrong than to sign someone in with no
      // access and let them think the app is broken.
      return refuse('Your role is set to "' + esc(res.employee.role || '(empty)') +
        '", which is not one of the six roles. Ask a manager to set it in the Team tab.');
    }
    if(!canSeeAllCitiesFor(role) && !String(res.employee.city || '').trim()){
      return refuse('No city is set on your record, so there is nothing to show you. Ask a manager to set it in the Team tab.');
    }
    session = {
      employeeId: res.employee.id,
      name: res.employee.firstName + ' ' + res.employee.lastName,
      role: role,
      city: res.employee.city || ''
    };
    await startSession();
  });
}

/* Same test as canSeeAllCities but for a role we haven't stored yet. */
function canSeeAllCitiesFor(role){ return roleLevel(role) >= ROLE_LEVEL['Senior Manager / Director']; }

/** Sets up the first view and loads what it needs before painting, so nobody
 *  sees an empty schedule for a second after signing in. */
async function startSession(){
  ui.tab = firstVisibleTab();
  ui.loginError = null;
  ui.loginPick = null;
  ui.scheduleCity = canSeeAllCities() ? ALL_CITIES : myCity();
  ui.city = canSeeAllCities() ? (ui.city || (DATA.cities || [])[0]) : myCity();
  try{ await ensureScheduleData(); }catch(e){ /* the tab shows its own error */ }
  render();
  startPolling();
}

/* ---------- SHELL / NAV ---------- */
function navItems(){
  return [
    {id:'schedule',  ico:'🗓️', label:'Schedule'},
    {id:'charity',   ico:'🤝', label:'Charity Campaigns'},
    {id:'docs',      ico:'📄', label:'Documentation'},
    {id:'logistics', ico:'🎒', label:'Logistics'},
    {id:'badges',    ico:'🪪', label:'Badges'},
    {id:'team',      ico:'👥', label:'Team'},
    {id:'retired',   ico:'📕', label:'Retired Employees'}
  ].filter(it => canView(it.id));
}
function renderShell(){
  const items = navItems();
  if(!canView(ui.tab)) ui.tab = firstVisibleTab();
  return `
  <div id="app-shell">
    <div id="sidebar">
      <div class="brand">
        <span class="tag">Field Ops</span><h1>Outreach Hub</h1>
        <div class="who">${esc(session.name)}</div>
        <div class="who-role">
          <span class="badge-tag ${roleTagClass(session.role)}">${esc(session.role)}</span>
          ${canSeeAllCities() ? '<span class="badge-tag tag-allcities">All cities</span>' : (myCity() ? `<span class="badge-tag tag-city">${esc(myCity())}</span>` : '')}
        </div>
      </div>
      ${items.map(it=>`<div class="nav-item ${ui.tab===it.id?'active':''}" data-tab="${it.id}"><span class="ico">${it.ico}</span>${it.label}</div>`).join('')}
      <div class="spacer"></div>
      ${canEdit() ? '' : '<div class="small" style="padding:0 20px 8px;color:#5b6169;">👁 View only</div>'}
      <div id="syncIndicator" class="small" style="padding:0 20px 6px;color:#5b6169;">Live sync on</div>
      <button class="btn" id="refreshNow" style="margin:0 20px 8px;background:transparent;color:#C9CDD2;border-color:#2a2f36;">🔄 Refresh now</button>
      <button id="logout">Sign out</button>
    </div>
    <div id="content">${renderPage()}</div>
  </div>
  ${ui.modal ? renderModal() : ''}
  `;
}
function attachShellEvents(){
  document.querySelectorAll('.nav-item').forEach(n=>{ n.onclick = ()=>{ ui.tab=n.dataset.tab; ui.modal=null; render(); }; });
  document.getElementById('logout').onclick = ()=>{
    session=null; pendingRows.clear(); scheduleCache={}; summaryCache={};
    stopPolling();
    ui={tab:'schedule', weekMonday:getMonday(new Date()), city:null, scheduleCity:null, modal:null, loginError:null, loginPick:null, revealedPins:null};
    render();
  };
  document.getElementById('refreshNow').onclick = manualRefresh;
  attachPageEvents();
  if(ui.modal) attachModalEvents();
}
function renderPage(){
  if(!canView(ui.tab)) return `<div class="empty-state"><div class="ico">🔒</div>You don't have access to this section.</div>`;
  switch(ui.tab){
    case 'schedule':  return renderSchedulePage();
    case 'charity':   return renderCharityPage();
    case 'docs':      return renderDocsPage();
    case 'logistics': return renderLogisticsPage();
    case 'badges':    return renderBadgesPage();
    case 'team':      return renderTeamPage();
    case 'retired':   return renderRetiredPage();
    default: return '';
  }
}
function attachPageEvents(){
  if(!canView(ui.tab)) return;
  if(ui.tab==='schedule')  attachScheduleEvents();
  if(ui.tab==='charity')   attachCharityEvents();
  if(ui.tab==='docs')      attachDocsEvents();
  if(ui.tab==='logistics') attachLogisticsEvents();
  if(ui.tab==='badges')    attachBadgesEvents();
  if(ui.tab==='team')      attachTeamEvents();
  if(ui.tab==='retired')   attachRetiredEvents();
}

/* ---------- GENERIC MODAL ---------- */
function renderModal(){
  return `<div class="modal-overlay" id="modalOverlay"><div class="modal-box ${ui.modal.wide?'wide':''}">
    <h3>${ui.modal.title}</h3>${ui.modal.body}
  </div></div>`;
}
function closeModal(){ ui.modal=null; document.onkeydown = null; render(); }

function attachModalEvents(){
  const ov = document.getElementById('modalOverlay');
  if(ov){
    /* Click-outside-to-close, done properly.
       A `click` fires on the nearest common ancestor of where the press
       started and where it ended. So selecting the text inside a field and
       releasing the mouse past the edge of the dialog used to deliver the
       click to the overlay — and the form closed, losing what you typed.
       Require the press to BEGIN on the overlay as well, so a drag that
       started inside the dialog can never close it. */
    let pressedOnOverlay = false;
    ov.addEventListener('pointerdown', (e)=>{ pressedOnOverlay = (e.target === ov); });
    ov.addEventListener('click', (e)=>{
      if(pressedOnOverlay && e.target === ov) closeModal();
      pressedOnOverlay = false;
    });
    /* Escape closes it too — the reliable way out now that a stray drag
       no longer does. */
    document.onkeydown = (e)=>{ if(e.key === 'Escape' && ui.modal) closeModal(); };
  }
  window.moduleModalAttachers.forEach(fn => fn());
}
