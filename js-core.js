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

/* =========================================================
   GLOBAL STATE
   ========================================================= */
let DATA = { campaigns:[], cities:[], charity:[], trainings:[], signatures:[], logistics:{cities:{},log:[]}, badgeLog:[], nextBadgeId:1, employeesForLogin:[], employees:[] };
let scheduleCache = {};
let session = null; // {role, employeeId, name, status}
let ui = { tab:'schedule', weekMonday:getMonday(new Date()), city:null, modal:null, loginStep:'pick', pickedRole:null, loginError:null };

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

/* =========================================================
   LIVE REFRESH (polling)
   Apps Script web apps have no push/websocket channel, so "live" here means:
   every POLL_INTERVAL_MS, silently re-fetch whatever the current tab needs
   and only re-render if something actually changed. Each js-<tab>.html file
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
   RENDER ROOT
   ========================================================= */
function render(){
  const root = document.getElementById('root');
  if(!session){ root.innerHTML = renderLogin(); attachLoginEvents(); return; }
  root.innerHTML = renderShell();
  attachShellEvents();
}

/* ---------- LOGIN ---------- */
function renderLogin(){
  let body = '';
  if(ui.loginError) body += `<div class="login-error">${ui.loginError}</div>`;
  body += `
    <div class="role-row">
      <div class="role-btn ${ui.pickedRole==='manager'?'active':''}" data-role="manager"><span class="ico">🧭</span>Manager</div>
      <div class="role-btn ${ui.pickedRole==='canvasser'?'active':''}" data-role="canvasser"><span class="ico">🎯</span>Canvasser</div>
    </div>`;
  if(ui.pickedRole){
    const list = DATA.employeesForLogin.filter(e => e.loginRole === (ui.pickedRole==='manager'?'Manager':'Canvasser'));
    body += `
      <div class="field"><label>Your name</label>
        <select id="loginEmp">
          <option value="">— choose —</option>
          ${list.map(e=>`<option value="${e.id}">${e.firstName} ${e.lastName}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>PIN</label><input type="password" inputmode="numeric" maxlength="6" id="loginPin" placeholder="••••"></div>
      <button class="btn-primary" id="loginGo">Sign in</button>
      <div class="login-note">Not on the list, or forgot your PIN? Ask your manager — team members are managed in the Team tab.</div>
    `;
  }
  return `<div id="login-screen"><div class="login-box">
    <span class="tag">Field Ops</span><h1>Outreach Hub</h1>
    <p class="sub">Sign in to view your schedule, documents and team tools.</p>
    ${body}
  </div></div>`;
}
function attachLoginEvents(){
  document.querySelectorAll('.role-btn').forEach(b=>{
    b.onclick = ()=>{ ui.pickedRole=b.dataset.role; ui.loginError=null; render(); };
  });
  const go = document.getElementById('loginGo');
  if(go) go.onclick = ()=> safeButtonAction(go, 'Signing in…', async ()=>{
    const empId = document.getElementById('loginEmp').value;
    const pin = document.getElementById('loginPin').value;
    if(!empId || !pin) return;
    const res = await gsRun('login', empId, pin);
    if(!res.ok){ ui.loginError = res.error; render(); return; }
    session = { role: ui.pickedRole, employeeId: res.employee.id, name: res.employee.firstName+' '+res.employee.lastName, status: res.employee.status };
    ui.tab='schedule'; ui.loginError=null;
    render();
  });
}

/* ---------- SHELL / NAV ---------- */
function navItems(){
  const items = [
    {id:'schedule', ico:'🗓️', label:'Schedule'},
    {id:'charity', ico:'🤝', label:'Charity Campaigns'},
    {id:'docs', ico:'📄', label:'Documentation'}
  ];
  if(session.role==='manager'){
    items.push({id:'logistics', ico:'🎒', label:'Logistics'});
    items.push({id:'badges', ico:'🪪', label:'Badges'});
    items.push({id:'team', ico:'👥', label:'Team'});
  }
  return items;
}
function renderShell(){
  const items = navItems();
  return `
  <div id="app-shell">
    <div id="sidebar">
      <div class="brand">
        <span class="tag">Field Ops</span><h1>Outreach Hub</h1>
        <div class="who">${session.role==='manager'?'Manager':'Canvasser'} · ${session.name}</div>
      </div>
      ${items.map(it=>`<div class="nav-item ${ui.tab===it.id?'active':''}" data-tab="${it.id}"><span class="ico">${it.ico}</span>${it.label}</div>`).join('')}
      <div class="spacer"></div>
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
  document.getElementById('logout').onclick = ()=>{ session=null; pendingRows.clear(); ui={tab:'schedule', weekMonday:getMonday(new Date()), city:ui.city, modal:null, loginStep:'pick', pickedRole:null, loginError:null}; render(); };
  document.getElementById('refreshNow').onclick = manualRefresh;
  attachPageEvents();
  if(ui.modal) attachModalEvents();
}
function renderPage(){
  switch(ui.tab){
    case 'schedule': return renderSchedulePage();
    case 'charity': return renderCharityPage();
    case 'docs': return renderDocsPage();
    case 'logistics': return session.role==='manager' ? renderLogisticsPage() : '';
    case 'badges': return session.role==='manager' ? renderBadgesPage() : '';
    case 'team': return session.role==='manager' ? renderTeamPage() : '';
    default: return '';
  }
}
function attachPageEvents(){
  if(ui.tab==='schedule') attachScheduleEvents();
  if(ui.tab==='charity') attachCharityEvents();
  if(ui.tab==='docs') attachDocsEvents();
  if(ui.tab==='logistics' && session.role==='manager') attachLogisticsEvents();
  if(ui.tab==='badges' && session.role==='manager') attachBadgesEvents();
  if(ui.tab==='team' && session.role==='manager') attachTeamEvents();
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
