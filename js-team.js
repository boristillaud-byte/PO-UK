/* =========================================================
   TEAM TAB (manager only) — manage employee list / logins
   ========================================================= */
function renderTeamPage(){
  const rows = DATA.employees.map(e=>`
    <tr>
      <td>${e.firstName} ${e.lastName}</td>
      <td>${e.city || '—'}</td>
      <td><span class="mono">${e.badgeId || '—'}</span></td>
      <td><span class="badge-tag tag-${e.status.toLowerCase()}">${e.status}</span></td>
      <td>${e.loginRole||''}</td>
      <td style="text-align:right;">
        <button class="btn btn-sm" data-edit="${e.id}">Edit</button>
        <button class="btn btn-sm btn-danger" data-rmemp="${e.id}">Remove</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="6" class="muted">No team members yet.</td></tr>`;
  return `
    <div class="page-head">
      <div><h2>Team</h2><div class="desc">People who can log in, be scheduled, sign documents, and get badges.</div></div>
      <button class="btn btn-accent" id="addEmp">+ Add person</button>
    </div>
    <div class="panel"><table><thead><tr><th>Name</th><th>City</th><th>Badge ID</th><th>Schedule status</th><th>Login role</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
  `;
}

window.tabRefreshers.team = async function(){
  const fresh = await gsRun('getEmployeesFull');
  if(JSON.stringify(fresh) !== JSON.stringify(DATA.employees)){ DATA.employees = fresh; render(); }
};

function attachTeamEvents(){
  document.getElementById('addEmp').onclick = ()=> openEmpModal(null);
  document.querySelectorAll('[data-edit]').forEach(b=> b.onclick = ()=> openEmpModal(DATA.employees.find(e=>e.id===b.dataset.edit)));
  document.querySelectorAll('[data-rmemp]').forEach(b=>{
    b.onclick = ()=> safeAction(async ()=>{ await gsRun('removeEmployee', b.dataset.rmemp); DATA.employees = DATA.employees.filter(e=>e.id!==b.dataset.rmemp); render(); });
  });
}

function openEmpModal(emp){
  const cityOpts = (DATA.cities||[]).map(c=>`<option value="${c}" ${emp&&emp.city===c?'selected':''}>${c}</option>`).join('');
  ui.modal = { title: emp?'Edit person':'Add person', body:`
    <div class="field"><label>First name</label><input id="emp_fn" value="${emp?emp.firstName:''}"></div>
    <div class="field"><label>Last name</label><input id="emp_ln" value="${emp?emp.lastName:''}"></div>
    <div class="field"><label>City</label><select id="emp_city"><option value="">-- Select City --</option>${cityOpts}</select></div>
    <div class="field"><label>Existing Badge ID (optional)</label><input id="emp_badgeid" class="mono" placeholder="Leave blank to auto-generate later" value="${emp?(emp.badgeId||''):''}"></div>
    <div class="field"><label>Schedule status</label><select id="emp_status">
      <option ${emp&&emp.status==='Canvasser'?'selected':''}>Canvasser</option>
      <option ${emp&&emp.status==='Supervisor'?'selected':''}>Supervisor</option>
      <option ${emp&&emp.status==='Manager'?'selected':''}>Manager</option>
    </select></div>
    <div class="field"><label>Login role</label><select id="emp_loginrole">
      <option value="Canvasser" ${emp&&emp.loginRole==='Canvasser'?'selected':''}>Canvasser</option>
      <option value="Manager" ${emp&&emp.loginRole==='Manager'?'selected':''}>Manager</option>
    </select></div>
    <div class="field"><label>Email</label><input id="emp_email" value="${emp?(emp.email||''):''}"></div>
    <div class="field"><label>PIN ${emp?'(leave blank to keep current)':''}</label><input id="emp_pin" maxlength="6" placeholder="${emp?'••••':'e.g. 1234'}"></div>
    <input type="hidden" id="emp_editid" value="${emp?emp.id:''}">
    <div class="modal-actions"><button class="btn" id="emp_cancel">Cancel</button><button class="btn btn-accent" id="emp_save">Save</button></div>
  `};
  render();
}

window.moduleModalAttachers.push(function attachTeamModals(){
  const empSave = document.getElementById('emp_save');
  if(!empSave) return;
  document.getElementById('emp_cancel').onclick = closeModal;
  empSave.onclick = ()=> safeAction(async ()=>{
    const fn = document.getElementById('emp_fn').value.trim();
    const ln = document.getElementById('emp_ln').value.trim();
    const city = document.getElementById('emp_city').value;
    const badgeId = document.getElementById('emp_badgeid').value.trim();
    const status = document.getElementById('emp_status').value;
    const loginRole = document.getElementById('emp_loginrole').value;
    const email = document.getElementById('emp_email').value.trim();
    const pin = document.getElementById('emp_pin').value.trim();
    if(!fn || !city) throw new Error("First name and City are required.");
    const editId = document.getElementById('emp_editid').value;
    if(editId){
      await gsRun('updateEmployee', editId, fn, ln, city, status, loginRole, email, pin, badgeId);
      const e = DATA.employees.find(x=>x.id===editId);
      Object.assign(e, {firstName:fn, lastName:ln, city, status, loginRole, email, badgeId});
    } else {
      const newEmp = await gsRun('addEmployee', fn, ln, city, status, loginRole, email, pin || '0000', badgeId);
      DATA.employees.push(newEmp);
    }
    DATA.employeesForLogin = await gsRun('getEmployeesForLogin');
    closeModal();
  });
});
