/* =========================================================
   DOCUMENTATION TAB
   ========================================================= */
function lastSignature(docId, employeeName){
  const sigs = DATA.signatures.filter(s => s.DocID===docId && s.EmployeeName.toLowerCase()===employeeName.toLowerCase());
  if(sigs.length===0) return null;
  return sigs.sort((a,b)=> b.Date.toString().localeCompare(a.Date.toString()))[0];
}
function docStatusFor(doc, employeeName){
  const sig = lastSignature(doc.ID, employeeName);
  if(!sig) return {label:'Not signed', cls:'status-bad'};
  const sigDate = (sig.Date instanceof Date) ? sig.Date.toISOString().slice(0,10) : sig.Date;
  const requiresRenewal = String(doc.RequiresRenewal).toString().toUpperCase()==='TRUE';
  if(requiresRenewal){
    const due = addMonths(sigDate, Number(doc.RenewalMonths||6));
    if(todayISO() > due) return {label:`Renewal overdue (signed ${fmtDate(sigDate)})`, cls:'status-bad'};
    if(daysBetween(todayISO(), due) <= 14) return {label:`Renew soon — due ${fmtDate(due)}`, cls:'status-warn'};
  }
  return {label:`Signed ${fmtDate(sigDate)}`, cls:'status-good'};
}

function renderDocsPage(){
  if(session.role==='canvasser'){
    const cards = DATA.trainings.map(doc=>{
      const st = docStatusFor(doc, session.name);
      return `<div class="doc-card">
        <div>
          <div class="ttl">${doc.Title} <span class="badge-tag" style="background:#eee;color:#555;">${doc.Category}</span></div>
          <div class="meta">${String(doc.RequiresRenewal).toUpperCase()==='TRUE'?`Re-sign every ${doc.RenewalMonths} months`:'One-time acknowledgement'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="badge-tag ${st.cls}">${st.label}</span>
          ${doc.URL?`<a class="btn btn-sm" href="${doc.URL}" target="_blank">View ↗</a>`:''}
          <button class="btn btn-sm btn-accent" data-sign="${doc.ID}">Sign</button>
        </div>
      </div>`;
    }).join('');
    return `<div class="page-head"><div><h2>Documentation</h2><div class="desc">Review and sign your trainings and policies.</div></div></div><div class="panel">${cards}</div>`;
  }
  const empNames = DATA.employees.map(e=>e.firstName+' '+e.lastName);
  let overdueCount = 0;
  const rows = empNames.map(name=>{
    const cells = DATA.trainings.map(doc=>{
      const st = docStatusFor(doc, name);
      if(st.cls==='status-bad') overdueCount++;
      return `<td><span class="badge-tag ${st.cls}">${st.label}</span></td>`;
    }).join('');
    return `<tr><td><strong>${name}</strong></td>${cells}</tr>`;
  }).join('') || `<tr><td colspan="${DATA.trainings.length+1}" class="muted">No team members yet — add some in the Team tab.</td></tr>`;

  const docList = DATA.trainings.map(doc=>`
    <div class="doc-card">
      <div><div class="ttl">${doc.Title}</div><div class="meta">${doc.Category} · ${String(doc.RequiresRenewal).toUpperCase()==='TRUE'?`renews every ${doc.RenewalMonths} months`:'no renewal required'}</div></div>
      <button class="btn btn-sm btn-danger" data-rmdoc="${doc.ID}">Remove</button>
    </div>`).join('');

  return `
    <div class="page-head">
      <div><h2>Documentation</h2><div class="desc">Track sign-off and renewal status across the team. Weekly email reminders go to the addresses in Settings.</div></div>
      <button class="btn btn-accent" id="addDoc">+ Add document</button>
    </div>
    ${overdueCount>0?`<div class="banner banner-bad">⚠ ${overdueCount} signature${overdueCount>1?'s':''} missing or overdue for renewal across the team.</div>`:`<div class="banner banner-good">✓ Everyone is up to date.</div>`}
    <div class="panel" style="overflow-x:auto;">
      <div class="panel-title">Compliance overview</div>
      <table><thead><tr><th>Team member</th>${DATA.trainings.map(d=>`<th>${d.Title}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="panel"><div class="panel-title">Documents</div>${docList}</div>
  `;
}
window.tabRefreshers.docs = async function(){
  const [trainings, signatures] = await Promise.all([gsRun('getTrainingDocs'), gsRun('getSignatures')]);
  if(JSON.stringify(trainings) !== JSON.stringify(DATA.trainings) || JSON.stringify(signatures) !== JSON.stringify(DATA.signatures)){
    DATA.trainings = trainings; DATA.signatures = signatures; render();
  }
};

function attachDocsEvents(){
  document.querySelectorAll('[data-sign]').forEach(b=>{
    b.onclick = ()=>{
      const [fn,ln] = (session.name||'').split(' ');
      ui.modal = { title:'Sign document', body:`
        <p class="small muted">By signing, you confirm you have read and understood this document.</p>
        <div class="field"><label>First name</label><input id="sign_fn" value="${fn||''}"></div>
        <div class="field"><label>Last name</label><input id="sign_ln" value="${ln||''}"></div>
        <input type="hidden" id="sign_docid" value="${b.dataset.sign}">
        <div class="modal-actions"><button class="btn" id="sign_cancel">Cancel</button><button class="btn btn-accent" id="sign_save">Confirm signature</button></div>
      `};
      render();
    };
  });
  const addDoc = document.getElementById('addDoc');
  if(addDoc) addDoc.onclick = ()=>{
    ui.modal = { title:'Add document', body:`
      <div class="field"><label>Title</label><input id="doc_title" placeholder="e.g. Anti-Bribery Policy"></div>
      <div class="field"><label>Category</label><select id="doc_category"><option>Training</option><option>Policy</option><option>Code of Conduct</option></select></div>
      <div class="field"><label>Document link (optional)</label><input id="doc_url" placeholder="https://drive.google.com/..."></div>
      <div class="field"><label><input type="checkbox" id="doc_renew"> Requires periodic re-signing</label></div>
      <div class="field"><label>Renewal period (months)</label><input type="number" id="doc_months" value="6"></div>
      <div class="modal-actions"><button class="btn" id="doc_cancel">Cancel</button><button class="btn btn-accent" id="doc_save">Add</button></div>
    `};
    render();
  };
  document.querySelectorAll('[data-rmdoc]').forEach(b=>{
    b.onclick = ()=> safeAction(async ()=>{ await gsRun('removeTrainingDoc', b.dataset.rmdoc); DATA.trainings = await gsRun('getTrainingDocs'); render(); });
  });
}
window.moduleModalAttachers.push(function attachDocsModals(){
  const signSave = document.getElementById('sign_save');
  if(signSave){
    document.getElementById('sign_cancel').onclick = closeModal;
    signSave.onclick = ()=> safeAction(async ()=>{
      const fn = document.getElementById('sign_fn').value.trim();
      const ln = document.getElementById('sign_ln').value.trim();
      if(!fn || !ln) return;
      const docId = document.getElementById('sign_docid').value;
      await gsRun('signDocument', docId, fn+' '+ln);
      DATA.signatures = await gsRun('getSignatures');
      closeModal();
    });
  }
  const docSave = document.getElementById('doc_save');
  if(docSave){
    document.getElementById('doc_cancel').onclick = closeModal;
    docSave.onclick = ()=> safeAction(async ()=>{
      const title = document.getElementById('doc_title').value.trim();
      const url = document.getElementById('doc_url').value.trim();
      const category = document.getElementById('doc_category').value;
      const requiresRenewal = document.getElementById('doc_renew').checked;
      const renewalMonths = parseInt(document.getElementById('doc_months').value)||6;
      if(!title) return;
      await gsRun('addTrainingDoc', title, category, url, requiresRenewal, renewalMonths);
      DATA.trainings = await gsRun('getTrainingDocs');
      closeModal();
    });
  }
});
