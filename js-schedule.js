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
  const grandTotal = Object.values(totals).reduce((sum, h) => sum + h, 0);

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
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:16px;">
        <div style="font-size:32px;font-weight:800;">${grandTotal.toFixed(2)}h</div>
        <div class="small muted">all team members combined, this week</div>
      </div>
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

function openAddPersonModal(day, preselectId){
  ui.modal = {
    title:`Add person · ${fmtDate(day)}`,
    body:`
      <div class="field"><label>Person</label>
        <select id="p_emp">
          <option value="">— choose —</option>
          ${DATA.employees.map(e=>`<option value="${e.id}" ${preselectId===e.id?'selected':''}>${e.firstName} ${e.lastName} (${e.status})</option>`).join('')}
          ${session.role==='manager'?`<option value="__self__">${session.name} (me)</option>`:''}
        </select>
      </div>
      <button class="btn btn-sm" id="p_newPersonBtn" style="margin:-4px 0 14px;">+ New person…</button>
      <div class="field"><label>Status on shift</label><select id="p_status"><option>Canvasser</option><option>Supervisor</option><option>Manager</option></select></div>
      <div class="modal-actions"><button class="btn" id="p_cancel">Cancel</button><button class="btn btn-accent" id="p_save">Add</button></div>
      <input type="hidden" id="p_day" value="${day}">
    `
  };
  render();
}

function openNewPersonModal(day){
  ui.modal = {
    title:'New person',
    body:`
      <div class="field"><label>First name</label><input id="np_fn"></div>
      <div class="field"><label>Last name</label><input id="np_ln"></div>
      <div class="field"><label>Schedule status</label><select id="np_status"><option>Canvasser</option><option>Supervisor</option><option>Manager</option></select></div>
      <p class="small muted">You can set their login PIN and login role afterward in the Team tab.</p>
      <div class="modal-actions"><button class="btn" id="np_cancel">Cancel</button><button class="btn btn-accent" id="np_save">Create</button></div>
      <input type="hidden" id="np_day" value="${day}">
    `
  };
  render();
}

window.moduleModalAttachers.push(function attachSchedulePersonSelectModal(){
  const newBtn = document.getElementById('p_newPersonBtn');
  if(newBtn){
    const day = document.getElementById('p_day').value;
    newBtn.onclick = ()=> openNewPersonModal(day);
  }
  const npSave = document.getElementById('np_save');
  if(npSave){
    document.getElementById('np_cancel').onclick = closeModal;
    npSave.onclick = ()=> safeAction(async ()=>{
      const day = document.getElementById('np_day').value;
      const fn = document.getElementById('np_fn').value.trim();
      const ln = document.getElementById('np_ln').value.trim();
      const status = document.getElementById('np_status').value;
      if(!fn) throw new Error('Enter at least a first name.');
      const newEmp = await gsRun('addEmployee', fn, ln, status, 'Canvasser', '', '0000');
      DATA.employees.push(newEmp);
      openAddPersonModal(day, newEmp.id);
    });
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
    pSave.onclick = ()=>{
      const day = document.getElementById('p_day').value;
      const status = document.getElementById('p_status').value;
      const empSel = document.getElementById('p_emp');
      let name, isNew=false, fn='', ln='';
      if(empSel.value==='__self__'){
        name = session.name;
      } else if(empSel.value==='__new__'){
        fn = document.getElementById('p_fn').value.trim();
        ln = document.getElementById('p_ln').value.trim();
        if(!fn){ alert('Enter at least a first name.'); return; }
        name = (fn+' '+ln).trim();
        isNew = true;
      } else if(empSel.value){
        const emp = DATA.employees.find(e=>e.id===empSel.value);
        name = emp.firstName+' '+emp.lastName;
      } else { return; }

      // Show the person on screen immediately (before the server confirms)
      // so adding someone feels instant. We quietly reconcile with the
      // real server data right after, whether the save succeeds or not.
      const dayData = scheduleCache[ui.weekMonday] && scheduleCache[ui.weekMonday][day];
      if(dayData){
        const t = dayData.time;
        const optimisticHours = t ? computeHours(t.start, t.end, t.breakMin) : 0;
        dayData.people.push({row:-1, employeeName:name, status, hours:optimisticHours});
      }
      closeModal();

      safeAction(async ()=>{
        if(isNew){
          const res = await gsRun('addNewPersonAndAssign', day, fn, ln, status);
          DATA.employees.push(res.employee);
        } else {
          await gsRun('addPersonToDay', day, name, status);
        }
      }).finally(async ()=>{
        delete scheduleCache[ui.weekMonday];
        await loadWeek(ui.weekMonday);
        render();
      });
    };
  }
});
