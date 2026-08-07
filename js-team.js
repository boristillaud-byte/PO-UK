/* =========================================================
   TEAM TAB — people, roles, and PINs
   Visible from Team Leader up; editable from Assistant Manager up.
   Everyone except Senior Manager / Director sees only their own city.

   Also holds the Retired Employees tab, because it is the same records
   viewed from the other side.
   ========================================================= */
function roleOptions(selected){
  return ROLES.map(r => `<option value="${esc(r)}" ${selected===r?'selected':''}>${esc(r)}</option>`).join('');
}

/** The people this person is allowed to see. */
function visibleEmployees(){
  if(canSeeAllCities()) return DATA.employees || [];
  const c = myCity().toLowerCase();
  return (DATA.employees || []).filter(e => String(e.city || '').trim().toLowerCase() === c);
}
function visibleRetired(){
  if(canSeeAllCities()) return DATA.retired || [];
  const c = myCity().toLowerCase();
  return (DATA.retired || []).filter(e => String(e.city || '').trim().toLowerCase() === c);
}

function renderTeamPage(){
  const editable = canEdit();
  const showPins = canSeeAllCities();   // Senior Manager / Director only
  const people = visibleEmployees();

  /* Rows whose Role is not one of the six. They still work — the app reads
     the old value and grants the rights it always had — but they should get
     tidied up, so say so instead of leaving it to be discovered. */
  const unknown = people.filter(e => !normalizeRole(e.role));
  const legacy  = people.filter(e => {
    const raw = String(e.role || '').trim();
    return raw && !ROLE_LEVEL[raw] && normalizeRole(raw);
  });
  const noCity = people.filter(e => !String(e.city || '').trim());

  let banner = '';
  if(unknown.length){
    banner += `<div class="banner banner-bad">⚠ ${unknown.length} ${unknown.length>1?'people have':'person has'} no usable role (${unknown.map(e=>esc(e.firstName+' '+e.lastName)).join(', ')}). They cannot sign in until a role is set.</div>`;
  }
  if(noCity.length){
    banner += `<div class="banner banner-bad">⚠ ${noCity.length} ${noCity.length>1?'people have':'person has'} no city (${noCity.map(e=>esc(e.firstName+' '+e.lastName)).join(', ')}). Without a city they have no schedule to open.</div>`;
  }
  if(legacy.length){
    banner += `<div class="banner banner-warn">${legacy.length} ${legacy.length>1?'rows':'row'} still use${legacy.length>1?'':'s'} an old role name (${[...new Set(legacy.map(e=>esc(String(e.role).trim())))].join(', ')}). They keep the rights they had — open each one and pick a new role when you get a chance.</div>`;
  }

  const rows = people.slice().sort((a,b)=>
      (String(a.city||'')+a.firstName+a.lastName).localeCompare(String(b.city||'')+b.firstName+b.lastName)
    ).map(e=>{
    const known = !!normalizeRole(e.role);
    const revealed = ui.revealedPins && ui.revealedPins[e.id];
    const pinCell = showPins ? `<td class="mono">
        ${revealed ? esc(revealed) : '••••'}
        <button class="btn btn-sm pin-eye" data-pin="${esc(e.id)}" title="${revealed?'Hide':'Show'} PIN">${revealed?'🙈':'👁'}</button>
      </td>` : '';
    return `
    <tr>
      <td>${esc(e.firstName)} ${esc(e.lastName)}</td>
      <td>${esc(e.city) || '<span class="muted">—</span>'}</td>
      <td><span class="mono">${esc(e.badgeId) || '—'}</span></td>
      <td><span class="badge-tag ${roleTagClass(e.role)}">${esc(roleLabel(e.role))}</span>${known?'':' <span class="small muted">not recognised</span>'}</td>
      ${pinCell}
      <td style="text-align:right;">
        ${editable ? `
          <button class="btn btn-sm" data-edit="${esc(e.id)}">Edit</button>
          <button class="btn btn-sm btn-danger" data-retire="${esc(e.id)}">Retired</button>
        ` : '<span class="small muted">view only</span>'}
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="${showPins?6:5}" class="muted">No team members${canSeeAllCities()?'':' in '+esc(myCity())} yet.</td></tr>`;

  return `
    <div class="page-head">
      <div><h2>Team</h2><div class="desc">People who can sign in, be scheduled, sign documents, and get badges.${canSeeAllCities()?'':' Showing '+esc(myCity())+' only.'}</div></div>
      ${editable ? '<button class="btn btn-accent" id="addEmp">+ Add person</button>' : ''}
    </div>
    ${banner}
    <div class="panel"><table>
      <thead><tr><th>Name</th><th>City</th><th>Badge ID</th><th>Role</th>${showPins?'<th>PIN</th>':''}<th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${showPins ? `<div class="small muted" style="margin-top:10px;">PINs are convenience codes, not passwords — the backend is reachable by anyone with the URL. Don't reuse anything important.</div>` : ''}
    </div>
    ${editable ? `<div class="panel">
      <div class="panel-title">What each role can do</div>
      ${renderRoleMatrix()}
    </div>` : ''}
  `;
}

/* A plain statement of the permission model, generated from the same
   constants the app enforces — so it cannot drift out of date. */
function renderRoleMatrix(){
  const tabs = [
    {id:'schedule', label:'Schedule'},
    {id:'charity', label:'Charity'},
    {id:'docs', label:'Documentation'},
    {id:'logistics', label:'Logistics'},
    {id:'team', label:'Team'},
    {id:'badges', label:'Badges'},
    {id:'retired', label:'Retired'}
  ];
  const head = `<tr><th>Role</th>${tabs.map(t=>`<th style="text-align:center;">${t.label}</th>`).join('')}<th style="text-align:center;">Can edit</th><th style="text-align:center;">Cities</th></tr>`;
  const body = ROLES.map(r=>{
    const lvl = ROLE_LEVEL[r];
    const cells = tabs.map(t=>`<td style="text-align:center;">${lvl >= TAB_MIN_LEVEL[t.id] ? '✓' : '<span class="muted">—</span>'}</td>`).join('');
    const allCities = lvl >= ROLE_LEVEL['Senior Manager / Director'];
    return `<tr><td><span class="badge-tag ${roleTagClass(r)}">${esc(r)}</span></td>${cells}<td style="text-align:center;">${lvl>=EDIT_FROM_LEVEL?'✓':'<span class="muted">—</span>'}</td><td style="text-align:center;" class="small">${allCities?'All':'Own city'}</td></tr>`;
  }).join('');
  return `<table class="role-matrix"><thead>${head}</thead><tbody>${body}</tbody></table>
    <div class="small muted" style="margin-top:10px;">A ✓ without “Can edit” means read-only. Everyone can sign their own documents regardless of role. Fundraisers see their city's totals but not each colleague's figures.</div>`;
}

window.tabRefreshers.team = async function(){
  const fresh = await gsRun('getEmployeesFull');
  if(JSON.stringify(fresh) !== JSON.stringify(DATA.employees)){ DATA.employees = fresh; render(); }
};

function attachTeamEvents(){
  const add = document.getElementById('addEmp');
  if(add) add.onclick = ()=> openEmpModal(null);
  document.querySelectorAll('[data-edit]').forEach(b=> b.onclick = ()=> openEmpModal(DATA.employees.find(e=>e.id===b.dataset.edit)));

  /* PIN reveal. The PINs are fetched once, on the first click, rather than
     shipped with every page load. */
  document.querySelectorAll('[data-pin]').forEach(b=>{
    b.onclick = function(){
      const id = b.dataset.pin;
      ui.revealedPins = ui.revealedPins || {};
      if(ui.revealedPins[id]){ delete ui.revealedPins[id]; render(); return; }
      safeButtonAction(this, '', async ()=>{
        if(!DATA.pins) DATA.pins = await gsRun('getEmployeePins');
        ui.revealedPins[id] = DATA.pins[id] || '(none set)';
        render();
      });
    };
  });

  document.querySelectorAll('[data-retire]').forEach(b=>{
    b.onclick = ()=>{
      const emp = DATA.employees.find(e=>e.id===b.dataset.retire);
      if(!emp) return;
      const full = emp.firstName + ' ' + emp.lastName;
      confirmAction({
        title: 'Retire ' + full + '?',
        message: `Are you sure you want to retire <strong>${esc(full)}</strong>?`,
        note: 'They move to Retired Employees with today\'s date and can no longer sign in. Their past shifts, EOD figures and signatures are kept. You can reinstate them later from the Retired Employees tab.',
        confirmLabel: 'Yes, retire',
        danger: true,
        onConfirm: async ()=>{
          await gsRun('retireEmployee', emp.id);
          const [emps, ret, forLogin] = await Promise.all([
            gsRun('getEmployeesFull'), gsRun('getRetiredEmployees'), gsRun('getEmployeesForLogin')
          ]);
          DATA.employees = emps; DATA.retired = ret; DATA.employeesForLogin = forLogin;
          DATA.pins = null;
          toast(full + ' retired', 'good');
        }
      });
    };
  });
}

function openEmpModal(emp){
  /* Non-Directors can only place people in their own city, so there is nothing
     to choose — showing a locked field is clearer than a picker with one item. */
  const lockedCity = !canSeeAllCities();
  const cityValue = emp ? (emp.city || '') : (lockedCity ? myCity() : '');
  const cityField = lockedCity
    ? `<div class="field"><label>City</label><input value="${esc(cityValue || myCity())}" disabled>
         <input type="hidden" id="emp_city" value="${esc(cityValue || myCity())}"></div>`
    : `<div class="field"><label>City</label><select id="emp_city"><option value="">— select city —</option>
         ${(DATA.cities||[]).map(c=>`<option value="${esc(c)}" ${cityValue===c?'selected':''}>${esc(c)}</option>`).join('')}
       </select></div>`;

  const currentRole = emp ? normalizeRole(emp.role) : null;
  const rawRole = emp ? String(emp.role||'').trim() : '';
  ui.modal = { title: emp?'Edit person':'Add person', body:`
    <div class="grid2">
      <div class="field"><label>First name</label><input id="emp_fn" value="${emp?esc(emp.firstName):''}"></div>
      <div class="field"><label>Last name</label><input id="emp_ln" value="${emp?esc(emp.lastName):''}"></div>
    </div>
    ${cityField}
    <div class="field"><label>Role</label>
      <select id="emp_role">
        ${currentRole ? '' : '<option value="">— choose a role —</option>'}
        ${roleOptions(currentRole)}
      </select>
      ${(!currentRole && rawRole) ? `<div class="small" style="color:var(--bad);margin-top:5px;">Current value in the sheet is “${esc(rawRole)}”, which is not one of the six roles. Pick one to replace it.</div>` : ''}
      ${(currentRole && rawRole && rawRole !== currentRole) ? `<div class="small muted" style="margin-top:5px;">Sheet still says “${esc(rawRole)}”; saving will write “${esc(currentRole)}”.</div>` : ''}
    </div>
    <div class="field"><label>Existing Badge ID (optional)</label><input id="emp_badgeid" class="mono" placeholder="Leave blank to auto-generate later" value="${emp?esc(emp.badgeId||''):''}"></div>
    <div class="field"><label>Email</label><input id="emp_email" value="${emp?esc(emp.email||''):''}"></div>
    <div class="field"><label>PIN ${emp?'(leave blank to keep current)':''}</label><input id="emp_pin" maxlength="6" inputmode="numeric" placeholder="${emp?'••••':'e.g. 1234'}">
      <div class="small muted" style="margin-top:4px;">Fundraisers don't need one — they sign in without a PIN.</div>
    </div>
    <input type="hidden" id="emp_editid" value="${emp?esc(emp.id):''}">
    <div class="modal-actions"><button class="btn" id="emp_cancel">Cancel</button><button class="btn btn-accent" id="emp_save">Save</button></div>
  `};
  render();
}

window.moduleModalAttachers.push(function attachTeamModals(){
  const empSave = document.getElementById('emp_save');
  if(!empSave) return;
  document.getElementById('emp_cancel').onclick = closeModal;
  empSave.onclick = function(){
    safeButtonAction(this, 'Saving…', async ()=>{
      const fn = document.getElementById('emp_fn').value.trim();
      const ln = document.getElementById('emp_ln').value.trim();
      const city = document.getElementById('emp_city').value;
      const badgeId = document.getElementById('emp_badgeid').value.trim();
      const role = document.getElementById('emp_role').value;
      const email = document.getElementById('emp_email').value.trim();
      const pin = document.getElementById('emp_pin').value.trim();
      if(!fn) throw new Error('First name is required.');
      if(!city) throw new Error('City is required.');
      if(!role) throw new Error('Pick a role.');
      if(pin && !/^[0-9]{4,6}$/.test(pin)) throw new Error('A PIN must be 4 to 6 digits.');
      const editId = document.getElementById('emp_editid').value;
      if(editId){
        await gsRun('updateEmployee', editId, fn, ln, city, role, email, pin, badgeId);
      } else {
        await gsRun('addEmployee', fn, ln, city, role, email, pin || '0000', badgeId);
      }
      const [emps, forLogin] = await Promise.all([gsRun('getEmployeesFull'), gsRun('getEmployeesForLogin')]);
      DATA.employees = emps;
      DATA.employeesForLogin = forLogin;
      if(pin) DATA.pins = null; // force a re-fetch next time one is revealed
      closeModal();
      toast((fn + ' ' + ln).trim() + (editId ? ' updated' : ' added'), 'good');
    });
  };
});

/* =========================================================
   RETIRED EMPLOYEES TAB
   Assistant Manager and above. Reinstating puts the person back in Team
   with the role and PIN they had, so a mis-click is not permanent.
   ========================================================= */
function renderRetiredPage(){
  const list = visibleRetired().slice().sort((a,b)=>
    String(b.retiredDate||'').localeCompare(String(a.retiredDate||'')));

  const rows = list.map(e=>`
    <tr>
      <td>${esc(e.firstName)} ${esc(e.lastName)}</td>
      <td>${esc(e.city) || '—'}</td>
      <td><span class="mono">${esc(e.badgeId) || '—'}</span></td>
      <td><span class="badge-tag ${roleTagClass(e.role)}">${esc(roleLabel(e.role))}</span></td>
      <td class="small">${e.retiredDate ? esc(fmtDate(e.retiredDate)) : '<span class="muted">no date</span>'}</td>
      <td style="text-align:right;">
        ${canEdit() ? `<button class="btn btn-sm" data-reinstate="${esc(e.id)}">Reinstate</button>` : ''}
      </td>
    </tr>`).join('') || `<tr><td colspan="6" class="muted">Nobody has been retired${canSeeAllCities()?'':' in '+esc(myCity())} yet.</td></tr>`;

  return `
    <div class="page-head"><div><h2>Retired Employees</h2><div class="desc">People who have left. Their past shifts, EOD figures and signatures stay in the records; they cannot sign in.${canSeeAllCities()?'':' Showing '+esc(myCity())+' only.'}</div></div></div>
    <div class="panel"><table>
      <thead><tr><th>Name</th><th>City</th><th>Badge ID</th><th>Role when retired</th><th>Retired on</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
}

window.tabRefreshers.retired = async function(){
  const fresh = await gsRun('getRetiredEmployees');
  if(JSON.stringify(fresh) !== JSON.stringify(DATA.retired)){ DATA.retired = fresh; render(); }
};

function attachRetiredEvents(){
  document.querySelectorAll('[data-reinstate]').forEach(b=>{
    b.onclick = ()=>{
      const emp = (DATA.retired||[]).find(e=>e.id===b.dataset.reinstate);
      if(!emp) return;
      const full = emp.firstName + ' ' + emp.lastName;
      confirmAction({
        title: 'Reinstate ' + full + '?',
        message: `Put <strong>${esc(full)}</strong> back in the team?`,
        note: 'They return with the role, city and PIN they had when they were retired, and will be able to sign in again.',
        confirmLabel: 'Yes, reinstate',
        onConfirm: async ()=>{
          await gsRun('reinstateEmployee', emp.id);
          const [emps, ret, forLogin] = await Promise.all([
            gsRun('getEmployeesFull'), gsRun('getRetiredEmployees'), gsRun('getEmployeesForLogin')
          ]);
          DATA.employees = emps; DATA.retired = ret; DATA.employeesForLogin = forLogin;
          DATA.pins = null;
          toast(full + ' reinstated', 'good');
        }
      });
    };
  });
}
