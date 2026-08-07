/* =========================================================
   SCHEDULE TAB
   One shift time per day, applied to everyone working that day.
   Adding a person is just a name + status pick — no dynamic fields.

   EOD (End of Day): per person per day, a manager records the actual
   canvass hours, admin hours, #RCP and £RCP. £RCP/h is always derived
   (£RCP / canvass hours) and never stored, so it can't go stale.
   ========================================================= */
async function loadWeek(monday){
  if(!scheduleCache[monday]){
    scheduleCache[monday] = await gsRun('getWeekSchedule', monday);
  }
  return scheduleCache[monday];
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

/* Builds {employeeName -> eod entry} for one day. */
function eodMap(day){
  const m = {};
  (day.eod || []).forEach(e => { m[e.employeeName] = e; });
  return m;
}

/* ---------------------------------------------------------
   WEEK ROLL-UP used by the Weekly resume panel.
   Per the agreed rule: if an EOD exists for a person on a day, its hours
   (canvass + admin) replace that day's scheduled hours for that person.
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
    // An EOD for someone no longer on the day's roster still counts.
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

function renderWeeklyResume(week){
  const {people, totals} = buildWeekTotals(week);
  const rate = rateOf(totals.rcpValue, totals.canvass);

  const tiles = `
    <div class="stat-row">
      <div class="stat"><div class="k">Total hours</div><div class="v mono">${totals.hours.toFixed(2)}h</div>
        <div class="sub">${totals.canvass.toFixed(2)}h canvass · ${totals.admin.toFixed(2)}h admin</div></div>
      <div class="stat"><div class="k">#RCP</div><div class="v mono">${totals.rcpCount}</div>
        <div class="sub">${totals.eodDays} EOD${totals.eodDays===1?'':'s'} recorded</div></div>
      <div class="stat"><div class="k">£RCP</div><div class="v mono">${fmtGBP(totals.rcpValue)}</div>
        <div class="sub">${totals.rcpCount>0?fmtGBP(totals.rcpValue/totals.rcpCount)+' avg':'—'}</div></div>
      <div class="stat stat-hi"><div class="k">£RCP / h</div><div class="v mono">${rate===null?'—':fmtGBP(rate)}</div>
        <div class="sub">£RCP / canvass hours</div></div>
    </div>`;

  const rows = people.map(p => {
    const r = rateOf(p.rcpValue, p.canvass);
    return `<tr>
      <td>${p.name}</td>
      <td class="mono">${p.hours.toFixed(2)}h</td>
      <td class="mono">${p.canvass>0?p.canvass.toFixed(2)+'h':'<span class="muted">—</span>'}</td>
      <td class="mono">${p.admin>0?p.admin.toFixed(2)+'h':'<span class="muted">—</span>'}</td>
      <td class="mono">${p.rcpCount||'<span class="muted">—</span>'}</td>
      <td class="mono">${p.rcpValue>0?fmtGBP(p.rcpValue):'<span class="muted">—</span>'}</td>
      <td class="mono">${fmtRate(r)}</td>
      <td class="small muted">${p.eodDays}/${p.days}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="muted">No shifts scheduled this week yet.</td></tr>`;

  const foot = people.length ? `<tfoot><tr class="tot">
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
      <div class="panel-title">Weekly resume</div>
      ${tiles}
      <div class="panel-sub">Detail by person</div>
      <table class="resume-table">
        <thead><tr>
          <th>Person</th><th>Hours</th><th>Canvass h</th><th>Admin h</th>
          <th>#RCP</th><th>£RCP</th><th>£RCP/h</th><th>EOD</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        ${foot}
      </table>
      <div class="small muted" style="margin-top:10px;">Hours show the EOD figures (canvass + admin) when an EOD has been recorded for that day, otherwise the scheduled hours. The EOD column counts days recorded out of days scheduled.</div>
    </div>`;
}

function renderSchedulePage(){
  const week = scheduleCache[ui.weekMonday] || {};
  const sunday = shiftDate(ui.weekMonday,6);
  const isManager = session.role==='manager';
  let dayCols = '';
  for(let i=0;i<7;i++){
    const dateIso = shiftDate(ui.weekMonday,i);
    const day = week[dateIso] || {time:null, people:[], eod:[]};
    const em = eodMap(day);
    const timeLine = day.time
      ? `<div class="small" style="padding:6px 8px;background:#F4F4F4;border-radius:6px;margin-bottom:6px;">${day.time.start}–${day.time.end}${day.time.breakMin>0?` (break ${day.time.breakMin}m)`:''} ${isManager?`<button class="btn btn-sm" data-settime="${dateIso}" style="float:right;padding:2px 8px;">Edit</button>`:''}</div>`
      : (isManager ? `<button class="add-shift-btn" data-settime="${dateIso}" style="margin-bottom:6px;">+ Set shift time</button>` : `<div class="small muted" style="margin-bottom:6px;">No shift time set</div>`);

    const peopleHtml = day.people.map(p=>{
      const mine = session.role==='canvasser' && p.employeeName===session.name;
      const isPending = pendingRows.has(p.row);
      const e = em[p.employeeName];
      const eodLine = e ? `<div class="eod-mini">
          <span>C <strong>${num(e.canvassHours).toFixed(2)}h</strong></span>
          <span>A <strong>${num(e.adminHours).toFixed(2)}h</strong></span>
          <span>#<strong>${num(e.rcpCount)}</strong></span>
          <span><strong>${fmtGBP(e.rcpValue)}</strong></span>
          <span class="rate">${fmtRate(rateOf(e.rcpValue, e.canvassHours))}</span>
        </div>` : '';
      return `<div class="shift-card ${isPending?'is-pending':''}" style="${mine?'border-left-color:#2256B0;background:#F4F8FF;':''}">
        ${isManager?`<button class="rm" data-row="${p.row}" data-day="${dateIso}" data-name="${p.employeeName}" title="Remove from this day">×</button>`:''}
        <div class="nm">${p.employeeName} <span class="badge-tag tag-${p.status.toLowerCase()}">${p.status}</span></div>
        <div class="tm"><strong>${num(p.hours).toFixed(2)}h</strong> ${e?'<span class="eod-flag">EOD</span>':''}</div>
        ${eodLine}
      </div>`;
    }).join('');

    // EOD recorded for someone who has since been taken off the roster.
    const orphanEod = (day.eod || []).filter(e => !day.people.some(p => p.employeeName === e.employeeName))
      .map(e => `<div class="shift-card orphan">
        <div class="nm">${e.employeeName} <span class="badge-tag status-warn">off roster</span></div>
        <div class="eod-mini">
          <span>C <strong>${num(e.canvassHours).toFixed(2)}h</strong></span>
          <span>A <strong>${num(e.adminHours).toFixed(2)}h</strong></span>
          <span>#<strong>${num(e.rcpCount)}</strong></span>
          <span><strong>${fmtGBP(e.rcpValue)}</strong></span>
        </div>
      </div>`).join('');

    const eodCount = (day.eod || []).length;
    const eodBtn = (isManager && day.people.length)
      ? `<button class="eod-btn" data-eod="${dateIso}">📋 EOD${eodCount?` <span class="cnt">${eodCount}/${day.people.length}</span>`:''}</button>`
      : '';

    dayCols += `<div class="day-col">
      <div class="day-head"><div class="dname">${DAY_NAMES[i]}</div><div class="ddate">${fmtDate(dateIso)}</div></div>
      <div class="day-body">
        ${timeLine}
        ${peopleHtml || '<div class="small muted" style="padding:4px 0;">No one added yet</div>'}
        ${orphanEod}
        ${isManager && day.time ? `<button class="add-shift-btn" data-addperson="${dateIso}">+ Add person</button>` : ''}
        ${eodBtn}
      </div>
    </div>`;
  }

  return `
    <div class="page-head"><div><h2>Schedule</h2><div class="desc">${isManager?'Set each day\'s shift time once, add the people working that day, then record each person\'s EOD numbers.':'View your assigned shifts and end-of-day numbers for the week.'}</div></div></div>
    <div class="week-nav">
      <button class="btn btn-sm" id="prevWeek">‹ Prev</button>
      <span class="lbl">${fmtDate(ui.weekMonday)} – ${fmtDate(sunday)}</span>
      <button class="btn btn-sm" id="nextWeek">Next ›</button>
      <button class="btn btn-sm" id="thisWeek">This week</button>
    </div>
    <div class="day-grid">${dayCols}</div>
    ${renderWeeklyResume(week)}
  `;
}

async function goToWeek(monday){
  ui.weekMonday = monday;
  pendingRows.clear();
  await loadWeek(monday);
  render();
}

window.tabRefreshers.schedule = async function(){
  const fresh = await gsRun('getWeekSchedule', ui.weekMonday);
  if(JSON.stringify(fresh) !== JSON.stringify(scheduleCache[ui.weekMonday])){
    scheduleCache[ui.weekMonday] = fresh;
    render();
  }
};

/* Re-fetch the current week from the server, bypassing the cache. */
async function reloadWeek(){
  delete scheduleCache[ui.weekMonday];
  await loadWeek(ui.weekMonday);
}

function attachScheduleEvents(){
  document.getElementById('prevWeek').onclick = ()=> goToWeek(shiftDate(ui.weekMonday,-7));
  document.getElementById('nextWeek').onclick = ()=> goToWeek(shiftDate(ui.weekMonday,7));
  document.getElementById('thisWeek').onclick = ()=> goToWeek(getMonday(new Date()));
  document.querySelectorAll('[data-settime]').forEach(b=> b.onclick = ()=> openSetTimeModal(b.dataset.settime));
  document.querySelectorAll('[data-addperson]').forEach(b=> b.onclick = ()=> openAddPersonModal(b.dataset.addperson));
  document.querySelectorAll('[data-eod]').forEach(b=> b.onclick = ()=> openEodModal(b.dataset.eod));
  document.querySelectorAll('.shift-card .rm').forEach(b=>{
    b.onclick = ()=>{
      const row = parseInt(b.dataset.row);
      const day = b.dataset.day;
      const name = b.dataset.name;
      // Mark the card as in-flight straight away so the click is visibly
      // acknowledged even though the server takes a second or two.
      pendingRows.add(row);
      const card = b.closest('.shift-card');
      if(card) card.classList.add('is-pending');
      setBusy(b, '');
      safeAction(async ()=>{
        try{
          await gsRun('removePersonFromDay', row, day, name);
          await reloadWeek();
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
  const week = scheduleCache[ui.weekMonday] || {};
  const existing = (week[day] && week[day].time) || {start:'10:00', end:'18:00', breakMin:0};
  const count = (week[day] && week[day].people) ? week[day].people.length : 0;
  ui.modal = {
    title:`Set shift time · ${fmtDate(day)}`,
    body:`
      <p class="small muted">This time applies to everyone added to this day. Changing it later updates everyone already added${count?` (${count} right now)`:''}.</p>
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
  ui.modal = {
    title:`Add person · ${fmtDate(day)}`,
    body:`
      <div class="field"><label>Person</label>
        <select id="p_emp">
          <option value="">— choose —</option>
          ${DATA.employees.map(e=>`<option value="${e.id}">${e.firstName} ${e.lastName} (${e.status})</option>`).join('')}
          ${session.role==='manager'?`<option value="__self__">${session.name} (me)</option>`:''}
          <option value="__new__">+ New person…</option>
        </select>
      </div>
      <div id="p_newFields" style="display:none;">
        <div class="field"><label>First name</label><input id="p_fn"></div>
        <div class="field"><label>Last name</label><input id="p_ln"></div>
      </div>
      <div class="field"><label>Status on shift</label><select id="p_status"><option>Canvasser</option><option>Supervisor</option><option>Manager</option></select></div>
      <div class="modal-actions"><button class="btn" id="p_cancel">Cancel</button><button class="btn btn-accent" id="p_save">Add</button></div>
      <input type="hidden" id="p_day" value="${day}">
    `
  };
  render();
}

/* ---------------------------------------------------------
   EOD MODAL
   Pick one of the people on that day, then record their actual numbers.
   £RCP/h is shown live as you type and is never entered by hand.
   --------------------------------------------------------- */
function openEodModal(day){
  const week = scheduleCache[ui.weekMonday] || {};
  const d = week[day] || {people:[], eod:[]};
  const names = d.people.map(p => p.employeeName);
  (d.eod || []).forEach(e => { if(!names.includes(e.employeeName)) names.push(e.employeeName); });
  ui.modal = {
    title:`End of day · ${fmtDate(day)}`,
    body:`
      <div class="field"><label>Person</label>
        <select id="e_name">
          <option value="">— choose —</option>
          ${names.map(n=>{
            const done = (d.eod||[]).some(e=>e.employeeName===n);
            return `<option value="${n}">${n}${done?' ✓':''}</option>`;
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
  const week = scheduleCache[ui.weekMonday] || {};
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
    safeButtonAction(btn, 'Saving…', async ()=>{
      const name = sel.value;
      if(!name) throw new Error('Choose a person first.');
      const canvass = readNum('e_canvass');
      const admin = readNum('e_admin');
      const count = readNum('e_count');
      const value = readNum('e_value');
      if(canvass + admin > 24) throw new Error('Canvass + admin hours can\'t be more than 24 in one day.');
      if(count > 0 && canvass === 0) throw new Error('Enter the canvass hours too, otherwise £RCP/h can\'t be calculated.');
      await gsRun('setEodEntry', day, name, canvass, admin, count, value);
      await reloadWeek();
      closeModal();
    }, 'EOD saved for ' + sel.value);
  };

  delBtn.onclick = function(){
    const btn = this;
    safeButtonAction(btn, 'Deleting…', async ()=>{
      const name = sel.value;
      await gsRun('removeEodEntry', day, name);
      await reloadWeek();
      closeModal();
    }, 'EOD deleted');
  };
});

window.moduleModalAttachers.push(function attachSchedulePersonSelectModal(){
  const empSel = document.getElementById('p_emp');
  if(empSel){
    empSel.onchange = ()=>{
      const box = document.getElementById('p_newFields');
      if(box) box.style.display = empSel.value==='__new__' ? 'block' : 'none';
    };
  }
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
        await gsRun('setDayTime', day, start, end, breakMin);
        await reloadWeek();
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
          const newEmp = await gsRun('addEmployee', fn, ln, status, 'Canvasser', '', '0000');
          DATA.employees.push(newEmp);
          name = (fn + ' ' + ln).trim();
        } else if(empSel.value){
          const emp = DATA.employees.find(e=>e.id===empSel.value);
          name = emp.firstName+' '+emp.lastName;
        } else {
          throw new Error('Choose a person first.');
        }
        await gsRun('addPersonToDay', day, name, status);
        await reloadWeek();
        closeModal();
        toast(name + ' added to ' + fmtDate(day), 'good');
      });
    };
  }
});
