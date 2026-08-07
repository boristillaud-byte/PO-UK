/* =========================================================
   SCHEDULE TAB — one schedule per city

   Each city has its own week grid. Within a city, each day has ONE shift
   time that applies to everyone working that day there.

   Who sees what:
   - Senior Manager / Director: a tab per city, plus an "All cities" tab that
     totals the week across every city.
   - Everyone else: their own city only, no city tabs to get lost in.
   - Fundraiser: their city's totals plus their OWN line. A colleague's
     individual £RCP is not theirs to read, so those figures are hidden — both
     in the Weekly resume and on the day cards.

   EOD (End of Day): per person per day per city, a manager records the actual
   canvass hours, admin hours, #RCP and £RCP. £RCP/h is always derived
   (£RCP / canvass hours) and never stored, so it can't go stale.
   ========================================================= */

const ALL_CITIES = '__ALL__';
let summaryCache = {};   // monday -> getWeekSummary result

function weekKey(monday, city){ return monday + '|' + city; }

/** Cities this person may switch between on the schedule. */
function scheduleCityTabs(){
  if(canSeeAllCities()) return [ALL_CITIES].concat(DATA.cities || []);
  return myCity() ? [myCity()] : [];
}
/** Whose EOD figures this person may see: everyone's, or only their own. */
function maySeeFiguresFor(name){
  return canSeeOthersFigures() || name === session.name;
}

/** Picks a sane starting city, and repairs an impossible one. */
function normalizeScheduleCity(){
  const tabs = scheduleCityTabs();
  if(!tabs.length){ ui.scheduleCity = null; return; }
  if(!ui.scheduleCity || tabs.indexOf(ui.scheduleCity) === -1) ui.scheduleCity = tabs[0];
}

async function loadWeek(monday, city){
  const k = weekKey(monday, city);
  if(!scheduleCache[k]) scheduleCache[k] = await gsRun('getWeekSchedule', monday, city);
  return scheduleCache[k];
}
async function loadSummary(monday){
  if(!summaryCache[monday]) summaryCache[monday] = await gsRun('getWeekSummary', monday);
  return summaryCache[monday];
}
/** Fetches whatever the current view needs. */
async function ensureScheduleData(){
  normalizeScheduleCity();
  if(!ui.scheduleCity) return;
  if(ui.scheduleCity === ALL_CITIES) await loadSummary(ui.weekMonday);
  else await loadWeek(ui.weekMonday, ui.scheduleCity);
}
async function reloadScheduleData(){
  if(ui.scheduleCity === ALL_CITIES) delete summaryCache[ui.weekMonday];
  else delete scheduleCache[weekKey(ui.weekMonday, ui.scheduleCity)];
  // A change in one city moves the all-cities totals too.
  delete summaryCache[ui.weekMonday];
  await ensureScheduleData();
}

function normalizeTime(raw){
  const s = (raw||'').trim();
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if(!m) m = s.match(/^(\d{1,2})(\d{2})$/);
  if(!m) return null;
  const h = parseInt(m[1]), mi = parseInt(m[2]);
  if(h>23 || mi>59) return null;
  return String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0');
}

/* Reads a number out of an input, tolerating a comma decimal separator and
   a stray £ sign — field staff type both. */
function readNum(id){
  const el = document.getElementById(id);
  if(!el) return 0;
  const raw = String(el.value || '').replace(/[£\s]/g,'').replace(',','.');
  if(raw === '') return 0;
  const n = Number(raw);
  if(!isFinite(n) || n < 0) throw new Error('“' + el.value + '” is not a valid number. Use digits only, e.g. 6.5');
  return n;
}

function rateOf(rcpValue, canvassHours){
  const h = num(canvassHours);
  if(h <= 0) return null;
  return num(rcpValue) / h;
}
function fmtRate(r){ return r === null ? '—' : fmtGBP(r) + '/h'; }

function eodMap(day){
  const m = {};
  (day.eod || []).forEach(e => { m[e.employeeName] = e; });
  return m;
}

/* ---------------------------------------------------------
   WEEK ROLL-UP for one city's Weekly resume.
   If an EOD exists for a person on a day, its hours (canvass + admin)
   replace that day's scheduled hours for that person.
   --------------------------------------------------------- */
function buildWeekTotals(week){
  const byPerson = {};
  function slot(name){
    if(!byPerson[name]) byPerson[name] = {name, hours:0, canvass:0, admin:0, rcpCount:0, rcpValue:0, eodDays:0, days:0};
    return byPerson[name];
  }
  for(let i=0;i<7;i++){
    const dateIso = shiftDate(ui.weekMonday, i);
    const day = week[dateIso] || {time:null, people:[], eod:[]};
    const em = eodMap(day);
    day.people.forEach(p => {
      const s = slot(p.employeeName);
      s.days++;
      const e = em[p.employeeName];
      if(e){
        s.eodDays++;
        s.canvass  += num(e.canvassHours);
        s.admin    += num(e.adminHours);
        s.hours    += num(e.canvassHours) + num(e.adminHours);
        s.rcpCount += num(e.rcpCount);
        s.rcpValue += num(e.rcpValue);
      } else {
        s.hours += num(p.hours);
      }
    });
    (day.eod || []).forEach(e => {
      if(day.people.some(p => p.employeeName === e.employeeName)) return;
      const s = slot(e.employeeName);
      s.eodDays++;
      s.canvass  += num(e.canvassHours);
      s.admin    += num(e.adminHours);
      s.hours    += num(e.canvassHours) + num(e.adminHours);
      s.rcpCount += num(e.rcpCount);
      s.rcpValue += num(e.rcpValue);
    });
  }
  const people = Object.keys(byPerson).sort().map(k => byPerson[k]);
  const t = {hours:0, canvass:0, admin:0, rcpCount:0, rcpValue:0, eodDays:0};
  people.forEach(p => {
    t.hours += p.hours; t.canvass += p.canvass; t.admin += p.admin;
    t.rcpCount += p.rcpCount; t.rcpValue += p.rcpValue; t.eodDays += p.eodDays;
  });
  return {people, totals:t};
}

function statTiles(t, rate, subLine){
  return `
    <div class="stat-row">
      <div class="stat"><div class="k">Total hours</div><div class="v mono">${num(t.hours).toFixed(2)}h</div>
        <div class="sub">${num(t.canvass).toFixed(2)}h canvass · ${num(t.admin).toFixed(2)}h admin</div></div>
      <div class="stat"><div class="k">#RCP</div><div class="v mono">${num(t.rcpCount)}</div>
        <div class="sub">${subLine}</div></div>
      <div class="stat"><div class="k">£RCP</div><div class="v mono">${fmtGBP(t.rcpValue)}</div>
        <div class="sub">${num(t.rcpCount)>0?fmtGBP(num(t.rcpValue)/num(t.rcpCount))+' avg':'—'}</div></div>
      <div class="stat stat-hi"><div class="k">£RCP / h</div><div class="v mono">${rate===null||rate===undefined?'—':fmtGBP(rate)}</div>
        <div class="sub">£RCP / canvass hours</div></div>
    </div>`;
}

function renderWeeklyResume(week){
  const {people, totals} = buildWeekTotals(week);
  const rate = rateOf(totals.rcpValue, totals.canvass);
  const tiles = statTiles(totals, rate, `${totals.eodDays} EOD${totals.eodDays===1?'':'s'} recorded`);

  /* A Fundraiser sees the city totals above, then only their own line —
     their colleagues' individual figures are not theirs to read. */
  const visible = canSeeOthersFigures() ? people : people.filter(p => p.name === session.name);
  const ownOnlyNote = canSeeOthersFigures() ? '' :
    `<div class="small muted" style="margin-top:10px;">The tiles above are the whole city for the week; the table is your own figures. Your colleagues' individual numbers are only visible to team leaders and managers.</div>`;

  const rows = visible.map(p => {
    const r = rateOf(p.rcpValue, p.canvass);
    return `<tr>
      <td>${esc(p.name)}</td>
      <td class="mono">${p.hours.toFixed(2)}h</td>
      <td class="mono">${p.canvass>0?p.canvass.toFixed(2)+'h':'<span class="muted">—</span>'}</td>
      <td class="mono">${p.admin>0?p.admin.toFixed(2)+'h':'<span class="muted">—</span>'}</td>
      <td class="mono">${p.rcpCount||'<span class="muted">—</span>'}</td>
      <td class="mono">${p.rcpValue>0?fmtGBP(p.rcpValue):'<span class="muted">—</span>'}</td>
      <td class="mono">${fmtRate(r)}</td>
      <td class="small muted">${p.eodDays}/${p.days}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="muted">${canSeeOthersFigures() ? 'No shifts scheduled this week yet.' : 'You have no shifts scheduled this week.'}</td></tr>`;

  /* No total row when the table is a single person: repeating their own
     numbers underneath them would say nothing. */
  const foot = (canSeeOthersFigures() && people.length) ? `<tfoot><tr class="tot">
      <td>Total</td>
      <td class="mono">${totals.hours.toFixed(2)}h</td>
      <td class="mono">${totals.canvass.toFixed(2)}h</td>
      <td class="mono">${totals.admin.toFixed(2)}h</td>
      <td class="mono">${totals.rcpCount}</td>
      <td class="mono">${fmtGBP(totals.rcpValue)}</td>
      <td class="mono">${fmtRate(rate)}</td>
      <td></td>
    </tr></tfoot>` : '';

  return `
    <div class="panel">
      <div class="panel-title">Weekly resume · ${esc(ui.scheduleCity)}</div>
      ${tiles}
      <div class="panel-sub">${canSeeOthersFigures() ? 'Detail by person' : 'Your week'}</div>
      <table class="resume-table">
        <thead><tr>
          <th>${canSeeOthersFigures() ? 'Person' : 'You'}</th><th>Hours</th><th>Canvass h</th><th>Admin h</th>
          <th>#RCP</th><th>£RCP</th><th>£RCP/h</th><th>EOD</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        ${foot}
      </table>
      <div class="small muted" style="margin-top:10px;">Hours show the EOD figures (canvass + admin) when an EOD has been recorded for that day, otherwise the scheduled hours. The EOD column counts days recorded out of days scheduled.</div>
      ${ownOnlyNote}
    </div>`;
}

/* ---------------------------------------------------------
   ALL CITIES OVERVIEW (Senior Manager / Director)
   One row per city for the selected week, plus the grand total.
   --------------------------------------------------------- */
function renderCityOverview(){
  const sum = summaryCache[ui.weekMonday];
  if(!sum) return `<div class="panel"><div class="small muted">Loading the week…</div></div>`;

  const rows = sum.cities.map(c=>`
    <tr>
      <td><button class="btn btn-sm" data-gotocity="${esc(c.city)}">${esc(c.city)} ›</button></td>
      <td class="mono">${num(c.hours).toFixed(2)}h</td>
      <td class="mono">${c.canvass>0?num(c.canvass).toFixed(2)+'h':'<span class="muted">—</span>'}</td>
      <td class="mono">${c.admin>0?num(c.admin).toFixed(2)+'h':'<span class="muted">—</span>'}</td>
      <td class="mono">${c.rcpCount||'<span class="muted">—</span>'}</td>
      <td class="mono">${c.rcpValue>0?fmtGBP(c.rcpValue):'<span class="muted">—</span>'}</td>
      <td class="mono">${c.rcpPerHour===null?'—':fmtGBP(c.rcpPerHour)+'/h'}</td>
      <td class="small muted">${c.peopleCount}</td>
    </tr>`).join('') || `<tr><td colspan="8" class="muted">No cities configured yet — add them in Logistics.</td></tr>`;

  const t = sum.total;
  const foot = sum.cities.length ? `<tfoot><tr class="tot">
      <td>All cities</td>
      <td class="mono">${num(t.hours).toFixed(2)}h</td>
      <td class="mono">${num(t.canvass).toFixed(2)}h</td>
      <td class="mono">${num(t.admin).toFixed(2)}h</td>
      <td class="mono">${num(t.rcpCount)}</td>
      <td class="mono">${fmtGBP(t.rcpValue)}</td>
      <td class="mono">${t.rcpPerHour===null?'—':fmtGBP(t.rcpPerHour)+'/h'}</td>
      <td class="small muted">${num(t.peopleCount)}</td>
    </tr></tfoot>` : '';

  return `
    <div class="panel">
      <div class="panel-title">All cities · week of ${fmtDate(ui.weekMonday)}</div>
      ${statTiles(t, t.rcpPerHour, `${num(t.eodCount)} EOD${num(t.eodCount)===1?'':'s'} recorded`)}
      <div class="panel-sub">By city</div>
      <table class="resume-table">
        <thead><tr>
          <th>City</th><th>Hours</th><th>Canvass h</th><th>Admin h</th>
          <th>#RCP</th><th>£RCP</th><th>£RCP/h</th><th>People</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        ${foot}
      </table>
      <div class="small muted" style="margin-top:10px;">£RCP/h per city is that city's £RCP divided by its own canvass hours; the all-cities figure divides the combined totals, so it is not the average of the three. Click a city to open its schedule.</div>
    </div>`;
}

/* ---------------------------------------------------------
   THE WEEK GRID for one city
   --------------------------------------------------------- */
function renderCityWeek(){
  const week = scheduleCache[weekKey(ui.weekMonday, ui.scheduleCity)];
  if(!week) return `<div class="panel"><div class="small muted">Loading ${esc(ui.scheduleCity)}…</div></div>`;

  const canWrite = canEdit();
  const showAllFigures = canSeeOthersFigures();
  let dayCols = '';
  for(let i=0;i<7;i++){
    const dateIso = shiftDate(ui.weekMonday,i);
    const day = week[dateIso] || {time:null, people:[], eod:[]};
    const em = eodMap(day);
    const timeLine = day.time
      ? `<div class="small" style="padding:6px 8px;background:#F4F4F4;border-radius:6px;margin-bottom:6px;">${day.time.start}–${day.time.end}${day.time.breakMin>0?` (break ${day.time.breakMin}m)`:''} ${canWrite?`<button class="btn btn-sm" data-settime="${dateIso}" style="float:right;padding:2px 8px;">Edit</button>`:''}</div>`
      : (canWrite ? `<button class="add-shift-btn" data-settime="${dateIso}" style="margin-bottom:6px;">+ Set shift time</button>` : `<div class="small muted" style="margin-bottom:6px;">No shift time set</div>`);

    const peopleHtml = day.people.map(p=>{
      const mine = p.employeeName===session.name;
      const isPending = pendingRows.has(p.row);
      const e = em[p.employeeName];
      const eodLine = (e && maySeeFiguresFor(p.employeeName)) ? `<div class="eod-mini">
          <span>C <strong>${num(e.canvassHours).toFixed(2)}h</strong></span>
          <span>A <strong>${num(e.adminHours).toFixed(2)}h</strong></span>
          <span>#<strong>${num(e.rcpCount)}</strong></span>
          <span><strong>${fmtGBP(e.rcpValue)}</strong></span>
          <span class="rate">${fmtRate(rateOf(e.rcpValue, e.canvassHours))}</span>
        </div>` : '';
      return `<div class="shift-card ${isPending?'is-pending':''}" style="${mine?'border-left-color:#2256B0;background:#F4F8FF;':''}">
        ${canWrite?`<button class="rm" data-row="${p.row}" data-day="${dateIso}" data-name="${esc(p.employeeName)}" title="Remove from this day">×</button>`:''}
        <div class="nm">${esc(p.employeeName)} <span class="badge-tag ${roleTagClass(p.status)}">${esc(roleLabel(p.status))}</span></div>
        <div class="tm"><strong>${num(p.hours).toFixed(2)}h</strong> ${e?'<span class="eod-flag">EOD</span>':''}</div>
        ${eodLine}
      </div>`;
    }).join('');

    const orphanEod = showAllFigures ? (day.eod || [])
      .filter(e => !day.people.some(p => p.employeeName === e.employeeName))
      .map(e => `<div class="shift-card orphan">
        <div class="nm">${esc(e.employeeName)} <span class="badge-tag status-warn">off roster</span></div>
        <div class="eod-mini">
          <span>C <strong>${num(e.canvassHours).toFixed(2)}h</strong></span>
          <span>A <strong>${num(e.adminHours).toFixed(2)}h</strong></span>
          <span>#<strong>${num(e.rcpCount)}</strong></span>
          <span><strong>${fmtGBP(e.rcpValue)}</strong></span>
        </div>
      </div>`).join('') : '';

    const eodCount = (day.eod || []).length;
    const eodBtn = (canWrite && day.people.length)
      ? `<button class="eod-btn" data-eod="${dateIso}">📋 EOD${eodCount?` <span class="cnt">${eodCount}/${day.people.length}</span>`:''}</button>`
      : '';

    dayCols += `<div class="day-col">
      <div class="day-head"><div class="dname">${DAY_NAMES[i]}</div><div class="ddate">${fmtDate(dateIso)}</div></div>
      <div class="day-body">
        ${timeLine}
        ${peopleHtml || '<div class="small muted" style="padding:4px 0;">No one added yet</div>'}
        ${orphanEod}
        ${canWrite && day.time ? `<button class="add-shift-btn" data-addperson="${dateIso}">+ Add person</button>` : ''}
        ${eodBtn}
      </div>
    </div>`;
  }
  return `<div class="day-grid">${dayCols}</div>${renderWeeklyResume(week)}`;
}

function renderSchedulePage(){
  normalizeScheduleCity();
  const tabs = scheduleCityTabs();
  const sunday = shiftDate(ui.weekMonday,6);

  if(!tabs.length){
    return `<div class="page-head"><div><h2>Schedule</h2></div></div>
      <div class="empty-state"><div class="ico">🏙</div>No city is set on your record, so there is no schedule to show.<br>
      <span class="small">Ask a manager to set your city in the Team tab.</span></div>`;
  }

  /* One city and no choice to make: don't draw a tab strip that does nothing. */
  const cityTabs = tabs.length > 1 ? `<div class="city-tabs">${tabs.map(c=>
    `<div class="city-tab ${ui.scheduleCity===c?'active':''}" data-schedcity="${esc(c)}">${c===ALL_CITIES?'📊 All cities':esc(c)}</div>`
  ).join('')}</div>` : `<div class="small muted" style="margin-bottom:14px;">📍 ${esc(tabs[0])}</div>`;

  const desc = canEdit()
    ? 'Set each day\'s shift time once, add the people working that day, then record each person\'s EOD numbers.'
    : 'View the shifts for the week.';

  return `
    <div class="page-head"><div><h2>Schedule</h2><div class="desc">${desc}</div></div></div>
    ${cityTabs}
    <div class="week-nav">
      <button class="btn btn-sm" id="prevWeek">‹ Prev</button>
      <span class="lbl">${fmtDate(ui.weekMonday)} – ${fmtDate(sunday)}</span>
      <button class="btn btn-sm" id="nextWeek">Next ›</button>
      <button class="btn btn-sm" id="thisWeek">This week</button>
    </div>
    ${ui.scheduleCity === ALL_CITIES ? renderCityOverview() : renderCityWeek()}
  `;
}

async function goToWeek(monday){
  ui.weekMonday = monday;
  pendingRows.clear();
  await ensureScheduleData();
  render();
}
async function goToScheduleCity(city){
  ui.scheduleCity = city;
  pendingRows.clear();
  render();                    // show the tab as selected straight away
  await ensureScheduleData();
  render();
}

window.tabRefreshers.schedule = async function(){
  normalizeScheduleCity();
  if(!ui.scheduleCity) return;
  if(ui.scheduleCity === ALL_CITIES){
    const fresh = await gsRun('getWeekSummary', ui.weekMonday);
    if(JSON.stringify(fresh) !== JSON.stringify(summaryCache[ui.weekMonday])){
      summaryCache[ui.weekMonday] = fresh; render();
    }
    return;
  }
  const k = weekKey(ui.weekMonday, ui.scheduleCity);
  const fresh = await gsRun('getWeekSchedule', ui.weekMonday, ui.scheduleCity);
  if(JSON.stringify(fresh) !== JSON.stringify(scheduleCache[k])){
    scheduleCache[k] = fresh; render();
  }
};

function attachScheduleEvents(){
  const prev = document.getElementById('prevWeek');
  if(!prev) return; // the "no city" state has no controls
  prev.onclick = ()=> goToWeek(shiftDate(ui.weekMonday,-7));
  document.getElementById('nextWeek').onclick = ()=> goToWeek(shiftDate(ui.weekMonday,7));
  document.getElementById('thisWeek').onclick = ()=> goToWeek(getMonday(new Date()));
  document.querySelectorAll('[data-schedcity]').forEach(t=> t.onclick = ()=> goToScheduleCity(t.dataset.schedcity));
  document.querySelectorAll('[data-gotocity]').forEach(b=> b.onclick = ()=> goToScheduleCity(b.dataset.gotocity));
  document.querySelectorAll('[data-settime]').forEach(b=> b.onclick = ()=> openSetTimeModal(b.dataset.settime));
  document.querySelectorAll('[data-addperson]').forEach(b=> b.onclick = ()=> openAddPersonModal(b.dataset.addperson));
  document.querySelectorAll('[data-eod]').forEach(b=> b.onclick = ()=> openEodModal(b.dataset.eod));
  document.querySelectorAll('.shift-card .rm').forEach(b=>{
    b.onclick = ()=>{
      const row = parseInt(b.dataset.row);
      const day = b.dataset.day;
      const name = b.dataset.name;
      const city = ui.scheduleCity;
      pendingRows.add(row);
      const card = b.closest('.shift-card');
      if(card) card.classList.add('is-pending');
      setBusy(b, '');
      safeAction(async ()=>{
        try{
          await gsRun('removePersonFromDay', row, day, city, name);
          await reloadScheduleData();
          pendingRows.delete(row);
          render();
          toast(name + ' removed from ' + fmtDate(day), 'good');
        }catch(err){
          pendingRows.delete(row);
          render();
          throw err;
        }
      });
    };
  });
}

function openSetTimeModal(day){
  const week = scheduleCache[weekKey(ui.weekMonday, ui.scheduleCity)] || {};
  const existing = (week[day] && week[day].time) || {start:'10:00', end:'18:00', breakMin:0};
  const count = (week[day] && week[day].people) ? week[day].people.length : 0;
  ui.modal = {
    title:`Set shift time · ${esc(ui.scheduleCity)} · ${fmtDate(day)}`,
    body:`
      <p class="small muted">Applies to everyone added to this day in ${esc(ui.scheduleCity)}${count?` (${count} right now)`:''}. Other cities are unaffected.</p>
      <div class="grid2">
        <div class="field"><label>Start time (HH:MM)</label><input type="text" inputmode="numeric" id="t_start" value="${existing.start}" placeholder="10:00"></div>
        <div class="field"><label>End time (HH:MM)</label><input type="text" inputmode="numeric" id="t_end" value="${existing.end}" placeholder="18:00"></div>
      </div>
      <div class="field"><label>Break (minutes)</label><input type="number" id="t_break" value="${existing.breakMin}" min="0"></div>
      <div class="modal-actions"><button class="btn" id="t_cancel">Cancel</button><button class="btn btn-accent" id="t_save">Save time</button></div>
      <input type="hidden" id="t_day" value="${day}">
    `
  };
  render();
}

function openAddPersonModal(day){
  /* Anyone can be added to any city's schedule — covering a shift in another
     city is normal — but the person's own city is shown so it is a conscious
     choice rather than a mis-click. */
  const people = DATA.employees.slice().sort((a,b)=>
    (a.firstName+a.lastName).localeCompare(b.firstName+b.lastName));
  ui.modal = {
    title:`Add person · ${esc(ui.scheduleCity)} · ${fmtDate(day)}`,
    body:`
      <div class="field"><label>Person</label>
        <select id="p_emp">
          <option value="">— choose —</option>
          ${people.map(e=>`<option value="${esc(e.id)}">${esc(e.firstName)} ${esc(e.lastName)} — ${esc(roleLabel(e.role))}${e.city?` (${esc(e.city)})`:''}</option>`).join('')}
          <option value="__self__">${esc(session.name)} (me)</option>
          <option value="__new__">+ New person…</option>
        </select>
      </div>
      <div id="p_newFields" style="display:none;">
        <div class="grid2">
          <div class="field"><label>First name</label><input id="p_fn"></div>
          <div class="field"><label>Last name</label><input id="p_ln"></div>
        </div>
        <p class="small muted">They will be created with ${esc(ui.scheduleCity)} as their city and PIN 0000. Set a real PIN in the Team tab.</p>
      </div>
      <div class="field"><label>Role on shift</label><select id="p_status">${ROLES.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select></div>
      <div class="modal-actions"><button class="btn" id="p_cancel">Cancel</button><button class="btn btn-accent" id="p_save">Add</button></div>
      <input type="hidden" id="p_day" value="${day}">
    `
  };
  render();
}

/* ---------------------------------------------------------
   EOD MODAL
   --------------------------------------------------------- */
function openEodModal(day){
  const week = scheduleCache[weekKey(ui.weekMonday, ui.scheduleCity)] || {};
  const d = week[day] || {people:[], eod:[]};
  const names = d.people.map(p => p.employeeName);
  (d.eod || []).forEach(e => { if(!names.includes(e.employeeName)) names.push(e.employeeName); });
  ui.modal = {
    title:`End of day · ${esc(ui.scheduleCity)} · ${fmtDate(day)}`,
    body:`
      <div class="field"><label>Person</label>
        <select id="e_name">
          <option value="">— choose —</option>
          ${names.map(n=>{
            const done = (d.eod||[]).some(e=>e.employeeName===n);
            return `<option value="${esc(n)}">${esc(n)}${done?' ✓':''}</option>`;
          }).join('')}
        </select>
      </div>
      <div id="e_form" style="display:none;">
        <div class="grid2">
          <div class="field"><label>Canvass hours</label><input type="text" inputmode="decimal" id="e_canvass" placeholder="6.5"></div>
          <div class="field"><label>Admin hours</label><input type="text" inputmode="decimal" id="e_admin" placeholder="1"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>#RCP</label><input type="text" inputmode="numeric" id="e_count" placeholder="3"></div>
          <div class="field"><label>£RCP</label><input type="text" inputmode="decimal" id="e_value" placeholder="45.00"></div>
        </div>
        <div class="calc-box">
          <span class="k">£RCP / h</span>
          <span class="v mono" id="e_rate">—</span>
          <span class="small muted">£RCP / canvass hours · calculated automatically</span>
        </div>
        <div class="modal-actions">
          <button class="btn" id="e_cancel">Cancel</button>
          <button class="btn btn-danger" id="e_delete" style="display:none;">Delete</button>
          <button class="btn btn-accent" id="e_save">Save EOD</button>
        </div>
      </div>
      <div id="e_hint" class="small muted">Choose a person to record or edit their end-of-day numbers. A ✓ means their EOD is already recorded.</div>
      <input type="hidden" id="e_day" value="${day}">
    `
  };
  render();
}

window.moduleModalAttachers.push(function attachScheduleEodModal(){
  const sel = document.getElementById('e_name');
  if(!sel) return;
  const day = document.getElementById('e_day').value;
  const week = scheduleCache[weekKey(ui.weekMonday, ui.scheduleCity)] || {};
  const d = week[day] || {people:[], eod:[]};

  const form = document.getElementById('e_form');
  const hint = document.getElementById('e_hint');
  const delBtn = document.getElementById('e_delete');
  const rateEl = document.getElementById('e_rate');

  function refreshRate(){
    let r = null;
    try{ r = rateOf(readNum('e_value'), readNum('e_canvass')); }catch(e){ rateEl.textContent = '—'; return; }
    rateEl.textContent = r === null ? '—' : fmtGBP(r);
  }
  ['e_canvass','e_value'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.oninput = refreshRate;
  });

  sel.onchange = ()=>{
    const name = sel.value;
    if(!name){ form.style.display='none'; hint.style.display='block'; return; }
    form.style.display='block'; hint.style.display='none';
    const existing = (d.eod||[]).find(e=>e.employeeName===name);
    const person = (d.people||[]).find(p=>p.employeeName===name);
    document.getElementById('e_canvass').value = existing ? num(existing.canvassHours) : (person ? num(person.hours) : '');
    document.getElementById('e_admin').value   = existing ? num(existing.adminHours) : 0;
    document.getElementById('e_count').value   = existing ? num(existing.rcpCount) : '';
    document.getElementById('e_value').value   = existing ? num(existing.rcpValue) : '';
    delBtn.style.display = existing ? 'block' : 'none';
    refreshRate();
  };

  document.getElementById('e_cancel').onclick = closeModal;

  document.getElementById('e_save').onclick = function(){
    const btn = this;
    const who = sel.value;
    safeButtonAction(btn, 'Saving…', async ()=>{
      if(!who) throw new Error('Choose a person first.');
      const canvass = readNum('e_canvass');
      const admin = readNum('e_admin');
      const count = readNum('e_count');
      const value = readNum('e_value');
      if(canvass + admin > 24) throw new Error('Canvass + admin hours can\'t be more than 24 in one day.');
      if(count > 0 && canvass === 0) throw new Error('Enter the canvass hours too, otherwise £RCP/h can\'t be calculated.');
      await gsRun('setEodEntry', day, ui.scheduleCity, who, canvass, admin, count, value);
      await reloadScheduleData();
      closeModal();
    }, 'EOD saved for ' + who);
  };

  delBtn.onclick = function(){
    const btn = this;
    const who = sel.value;
    safeButtonAction(btn, 'Deleting…', async ()=>{
      await gsRun('removeEodEntry', day, ui.scheduleCity, who);
      await reloadScheduleData();
      closeModal();
    }, 'EOD deleted');
  };
});

window.moduleModalAttachers.push(function attachSchedulePersonSelectModal(){
  const empSel = document.getElementById('p_emp');
  if(!empSel) return;
  empSel.onchange = ()=>{
    const box = document.getElementById('p_newFields');
    if(box) box.style.display = empSel.value==='__new__' ? 'block' : 'none';
    // Default the shift role to the person's own role, so it only has to be
    // changed when someone covers a different position that day.
    const roleSel = document.getElementById('p_status');
    if(!roleSel) return;
    let role = null;
    if(empSel.value === '__self__') role = normalizeRole(session.role);
    else {
      const emp = DATA.employees.find(e=>e.id===empSel.value);
      if(emp) role = normalizeRole(emp.role);
    }
    if(role) roleSel.value = role;
  };
});

window.moduleModalAttachers.push(function attachScheduleModals(){
  const tSave = document.getElementById('t_save');
  if(tSave){
    document.getElementById('t_cancel').onclick = closeModal;
    tSave.onclick = function(){
      const btn = this;
      safeButtonAction(btn, 'Saving…', async ()=>{
        const day = document.getElementById('t_day').value;
        const start = normalizeTime(document.getElementById('t_start').value);
        const end = normalizeTime(document.getElementById('t_end').value);
        if(!start || !end) throw new Error('Please enter times as HH:MM, e.g. 09:00 or 18:30.');
        const breakMin = parseInt(document.getElementById('t_break').value)||0;
        await gsRun('setDayTime', day, ui.scheduleCity, start, end, breakMin);
        await reloadScheduleData();
        closeModal();
      }, 'Shift time saved');
    };
  }
  const pSave = document.getElementById('p_save');
  if(pSave){
    document.getElementById('p_cancel').onclick = closeModal;
    pSave.onclick = function(){
      const btn = this;
      safeButtonAction(btn, 'Adding…', async ()=>{
        const day = document.getElementById('p_day').value;
        const status = document.getElementById('p_status').value;
        const empSel = document.getElementById('p_emp');
        let name;
        if(empSel.value==='__self__'){
          name = session.name;
        } else if(empSel.value==='__new__'){
          const fn = document.getElementById('p_fn').value.trim();
          const ln = document.getElementById('p_ln').value.trim();
          if(!fn) throw new Error('Enter at least a first name.');
          const newEmp = await gsRun('addEmployee', fn, ln, ui.scheduleCity, status, '', '0000', '');
          DATA.employees.push(newEmp);
          name = (fn + ' ' + ln).trim();
        } else if(empSel.value){
          const emp = DATA.employees.find(e=>e.id===empSel.value);
          name = emp.firstName+' '+emp.lastName;
        } else {
          throw new Error('Choose a person first.');
        }
        await gsRun('addPersonToDay', day, ui.scheduleCity, name, status);
        await reloadScheduleData();
        closeModal();
        toast(name + ' added to ' + fmtDate(day), 'good');
      });
    };
  }
});
