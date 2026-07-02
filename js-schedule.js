/* =========================================================
   SCHEDULE TAB
   One shift time per day, applied to everyone working that day.
   Adding a person is just a name + status pick — no dynamic fields.
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

function renderSchedulePage(){
  const week = scheduleCache[ui.weekMonday] || {};
  const sunday = shiftDate(ui.weekMonday,6);
  const totals = {};
  let dayCols = '';
  for(let i=0;i<7;i++){
    const dateIso = shiftDate(ui.weekMonday,i);
    const day = week[dateIso] || {time:null, people:[]};
    const timeLine = day.time
      ? `<div class="small" style="padding:6px 8px;background:#F4F4F4;border-radius:6px;margin-bottom:6px;">${day.time.start}–${day.time.end}${day.time.breakMin>0?` (break ${day.time.breakMin}m)`:''} ${session.role==='manager'?`<button class="btn btn-sm" data-settime="${dateIso}" style="float:right;padding:2px 8px;">Edit</button>`:''}</div>`
      : (session.role==='manager' ? `<button class="add-shift-btn" data-settime="${dateIso}" style="margin-bottom:6px;">+ Set shift time</button>` : `<div class="small muted" style="margin-bottom:6px;">No shift time set</div>`);
    const peopleHtml = day.people.map(p=>{
      totals[p.employeeName] = (totals[p.employeeName]||0) + Number(p.hours);
      const mine = session.role==='canvasser' && p.employeeName===session.name;
      return `<div class="shift-card" style="${mine?'border-left-color:#2256B0;background:#F4F8FF;':''}">
        ${session.role==='manager'?`<button class="rm" data-row="${p.row}">×</button>`:''}
        <div class="nm">${p.employeeName} <span class="badge-tag tag-${p.status.toLowerCase()}">${p.status}</span></div>
        <div class="tm"><strong>${Number(p.hours).toFixed(2)}h</strong></div>
      </div>`;
    }).join('');
    dayCols += `<div class="day-col">
      <div class="day-head"><div class="dname">${DAY_NAMES[i]}</div><div class="ddate">${fmtDate(dateIso)}</div></div>
      <div class="day-body">
        ${timeLine}
        ${peopleHtml || '<div class="small muted" style="padding:4px 0;">No one added yet</div>'}
        ${session.role==='manager' && day.time ? `<button class="add-shift-btn" data-addperson="${dateIso}">+ Add person</button>` : ''}
      </div>
    </div>`;
  }
  const totalsRows = Object.keys(totals).sort().map(k=>`<tr><td>${k}</td><td class="mono">${totals[k].toFixed(2)}h</td></tr>`).join('') ||
    `<tr><td colspan="2" class="muted">No shifts scheduled this week yet.</td></tr>`;

  return `
    <div class="page-head"><div><h2>Schedule</h2><div class="desc">${session.role==='manager'?'Set each day\'s shift time once, then add the people working that day.':'View your assigned shifts for the week.'}</div></div></div>
    <div class="week-nav">
      <button class="btn btn-sm" id="prevWeek">‹ Prev</button>
      <span class="lbl">${fmtDate(ui.weekMonday)} – ${fmtDate(sunday)}</span>
      <button class="btn btn-sm" id="nextWeek">Next ›</button>
      <button class="btn btn-sm" id="thisWeek">This week</button>
    </div>
    <div class="day-grid">${dayCols}</div>
    <div class="panel">
      <div class="panel-title">Weekly hours total</div>
      <table><thead><tr><th>Person</th><th>Hours</th></tr></thead><tbody>${totalsRows}</tbody></table>
    </div>
  `;
}

async function goToWeek(monday){
  ui.weekMonday = monday;
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

function attachScheduleEvents(){
  document.getElementById('prevWeek').onclick = ()=> goToWeek(shiftDate(ui.weekMonday,-7));
  document.getElementById('nextWeek').onclick = ()=> goToWeek(shiftDate(ui.weekMonday,7));
  document.getElementById('thisWeek').onclick = ()=> goToWeek(getMonday(new Date()));
  document.querySelectorAll('[data-settime]').forEach(b=> b.onclick = ()=> openSetTimeModal(b.dataset.settime));
  document.querySelectorAll('[data-addperson]').forEach(b=> b.onclick = ()=> openAddPersonModal(b.dataset.addperson));
  document.querySelectorAll('.shift-card .rm').forEach(b=>{
    b.onclick = ()=> safeAction(async ()=>{
      await gsRun('removePersonFromDay', parseInt(b.dataset.row));
      delete scheduleCache[ui.weekMonday];
      await loadWeek(ui.weekMonday);
      render();
    });
  });
}

function openSetTimeModal(day){
  const week = scheduleCache[ui.weekMonday] || {};
  const existing = (week[day] && week[day].time) || {start:'10:00', end:'18:00', breakMin:0};
  ui.modal = {
    title:`Set shift time · ${fmtDate(day)}`,
    body:`
      <p class="small muted">This time applies to everyone added to this day. Changing it later updates everyone already added.</p>
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
    tSave.onclick = ()=> safeAction(async ()=>{
      const day = document.getElementById('t_day').value;
      const start = normalizeTime(document.getElementById('t_start').value);
      const end = normalizeTime(document.getElementById('t_end').value);
      if(!start || !end) throw new Error('Please enter times as HH:MM, e.g. 09:00 or 18:30.');
      const breakMin = parseInt(document.getElementById('t_break').value)||0;
      await gsRun('setDayTime', day, start, end, breakMin);
      delete scheduleCache[ui.weekMonday];
      await loadWeek(ui.weekMonday);
      closeModal();
    });
  }
  const pSave = document.getElementById('p_save');
  if(pSave){
    document.getElementById('p_cancel').onclick = closeModal;
    pSave.onclick = ()=> safeAction(async ()=>{
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
        name = fn + ' ' + ln;
      } else if(empSel.value){
        const emp = DATA.employees.find(e=>e.id===empSel.value);
        name = emp.firstName+' '+emp.lastName;
      } else { return; }
      await gsRun('addPersonToDay', day, name, status);
      delete scheduleCache[ui.weekMonday];
      await loadWeek(ui.weekMonday);
      closeModal();
    });
  }
});
