/* =========================================================
   CHARITY CAMPAIGNS TAB
   ========================================================= */
function renderCharityPage(){
  const cards = DATA.charity.map(c=>`
    <div class="doc-card">
      <div><div class="ttl">${c.Title}</div><div class="meta">${c.Notes||''}</div></div>
      <div style="display:flex;gap:8px;">
        <a class="btn btn-sm" href="${c.URL}" target="_blank" rel="noopener">Open document ↗</a>
        ${session.role==='manager'?`<button class="btn btn-sm btn-danger" data-rmch="${c.ID}">Remove</button>`:''}
      </div>
    </div>`).join('') || `<div class="empty-state"><div class="ico">🤝</div>No campaign documents yet.</div>`;
  return `
    <div class="page-head">
      <div><h2>Charity Campaigns</h2><div class="desc">Shared campaign documents and resources stored on Drive.</div></div>
      ${session.role==='manager'?'<button class="btn btn-accent" id="addCharity">+ Add document link</button>':''}
    </div>
    <div class="panel">${cards}</div>
    <div class="login-note">Make sure each Drive file's sharing is set to "Anyone with the link" so the whole team can open it.</div>
  `;
}
window.tabRefreshers.charity = async function(){
  const fresh = await gsRun('getCharityDocs');
  if(JSON.stringify(fresh) !== JSON.stringify(DATA.charity)){ DATA.charity = fresh; render(); }
};

function attachCharityEvents(){
  const add = document.getElementById('addCharity');
  if(add) add.onclick = ()=>{
    ui.modal = { title:'Add campaign document', body:`
      <div class="field"><label>Title</label><input id="ch_title" placeholder="e.g. UNICEF Autumn Campaign Brief"></div>
      <div class="field"><label>Drive link</label><input id="ch_url" placeholder="https://drive.google.com/..."></div>
      <div class="field"><label>Notes (optional)</label><input id="ch_notes"></div>
      <div class="modal-actions"><button class="btn" id="ch_cancel">Cancel</button><button class="btn btn-accent" id="ch_save">Add</button></div>
    `};
    render();
  };
  document.querySelectorAll('[data-rmch]').forEach(b=>{
    b.onclick = ()=> safeAction(async ()=>{ await gsRun('removeCharityDoc', b.dataset.rmch); DATA.charity = await gsRun('getCharityDocs'); render(); });
  });
}
window.moduleModalAttachers.push(function attachCharityModals(){
  const save = document.getElementById('ch_save');
  if(!save) return;
  document.getElementById('ch_cancel').onclick = closeModal;
  save.onclick = ()=> safeAction(async ()=>{
    const title = document.getElementById('ch_title').value.trim();
    const url = document.getElementById('ch_url').value.trim();
    const notes = document.getElementById('ch_notes').value.trim();
    if(!title || !url) return;
    await gsRun('addCharityDoc', title, url, notes);
    DATA.charity = await gsRun('getCharityDocs');
    closeModal();
  });
});
