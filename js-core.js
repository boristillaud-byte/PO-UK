/* =========================================================
   SERVER CONNECTOR
   Talks to the Apps Script backend with a plain fetch() POST — no
   google.script.run, no HtmlService iframe. This is what avoids the
   browser-extension/security-tool interference entirely: this page is a
   normal static page like any other, not a page embedded in Google's
   sandboxed iframe.
   ========================================================= */
let gsQueue = Promise.resolve();
function gsRun(fnName, ...args){
  const run = () => fetch(API_URL, {
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
   ========================================================= */
function todayISO(){ return new Date().toISOString().slice(0,10); }
function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function addMonths(iso,n){ const d=new Date(iso+'T00:00:00'); d.setMonth(d.getMonth()+n); return d.toISOString().slice(0,10); }
function daysBetween(a,b){ return Math.round((new Date(b)-new Date(a))/86400000); }
function getMonday(d){
  const dt=new Date(d); const day=dt.getDay(); const diff = day===0?-6:1-day;
  dt.setDate(dt.getDate()+diff); return dt.toISOString().slice(0,10);
}
function shiftDate(iso,n){ const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
const DAY_NAMES=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function computeHours(start,end,breakMin){
  const [sh,sm]=start.split(':').map(Number); const [eh,em]=end.split(':').map(Number);
  let mins=(eh*60+em)-(sh*60+sm); if(mins<0) mins+=24*60; mins-=(breakMin||0);
  return Math.max(0, mins/60);
}

/* =========================================================
   GLOBAL STATE
   ========================================================= */
let DATA = { campaigns:[], cities:[], charity:[], trainings:[], signatures:[], logistics:{cities:{},log:[]}, badgeLog:[], nextBadgeId:1, employeesForLogin:[], employees:[] };
let scheduleCache = {};
let session = null; // {role, employeeId, name, status}
let ui = { tab:'schedule', weekMonday:getMonday(new Date()), city:null, modal:null, loginStep:'pick', pickedRole:null, loginError:null };

/* Modules register a function here; it gets called every time a modal is
   rendered, so each module can wire up its own modal's Save/Cancel buttons
   without core.html needing to know anything about them. */
window.moduleModalAttachers = [];

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
  const fn = window.tabRefreshers[ui.tab];
  if(fn) await fn();
  lastSyncAt = new Date();
  render();
}

/* Wrap any button click that calls the server: on failure, show the real
   error instead of leaving the UI stuck with no feedback. */
async function safeAction(fn){
  try{ await fn(); }
  catch(err){
    const msg = (err && err.message) ? err.message : String(err);
    alert('Something went wrong:\n\n' + msg);
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
  if(go) go.onclick = ()=> safeAction(async ()=>{
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
  document.getElementById('logout').onclick = ()=>{ session=null; ui={tab:'schedule', weekMonday:getMonday(new Date()), city:ui.city, modal:null, loginStep:'pick', pickedRole:null, loginError:null}; render(); };
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
  return `<div class="modal-overlay" id="modalOverlay"><div class="modal-box">
    <h3>${ui.modal.title}</h3>${ui.modal.body}
  </div></div>`;
}
function closeModal(){ ui.modal=null; render(); }
function attachModalEvents(){
  const ov = document.getElementById('modalOverlay');
  if(ov) ov.onclick = (e)=>{ if(e.target.id==='modalOverlay') closeModal(); };
  window.moduleModalAttachers.forEach(fn => fn());
}
