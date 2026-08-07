/* =========================================================
   LOGISTICS TAB (manager only)
   ========================================================= */
function renderLogisticsPage(){
  const editable = canEdit();
  /* Only a Director may move between cities; everyone else is pinned to their
     own, so we don't draw a tab strip they aren't allowed to use. */
  const cities = canSeeAllCities() ? (DATA.cities || []) : (myCity() ? [myCity()] : []);
  if(!canSeeAllCities()) ui.city = myCity();
  if(!cities.length){
    return `<div class="page-head"><div><h2>Logistics</h2></div></div>
      <div class="empty-state"><div class="ico">🏙</div>No city is set on your record.<br><span class="small">Ask a manager to set your city in the Team tab.</span></div>`;
  }
  if(!ui.city || cities.indexOf(ui.city) === -1) ui.city = cities[0];
  const city = ui.city;
  const cdata = DATA.logistics.cities[city] || {tablets:[], vests:0, lastCheck:null};
  const lastCheck = cdata.lastCheck;
  let bannerHtml = '';
  if(!lastCheck){
    bannerHtml = `<div class="banner banner-bad">⚠ Equipment in ${city} has never been confirmed. Run a check below.</div>`;
  } else {
    const days = daysBetween(lastCheck.date, todayISO());
    if(days>=7) bannerHtml = `<div class="banner banner-bad">⚠ Equipment check overdue in ${city} — last confirmed ${fmtDate(lastCheck.date)} (${days} days ago).</div>`;
    else bannerHtml = `<div class="banner banner-good">✓ Equipment confirmed in ${city} on ${fmtDate(lastCheck.date)} by ${lastCheck.confirmedBy}.</div>`;
  }
  const tabletsHtml = cdata.tablets.map(t=>`<li><span class="mono">#${t.id}</span><span class="small muted">since ${fmtDate(t.dateAdded)}</span></li>`).join('') || `<li class="muted">No tablets in this city.</li>`;
  const log = DATA.logistics.log.slice(0,30).map(l=>`<tr><td class="small">${fmtDate(l.date)}</td><td>${l.action}</td></tr>`).join('') || `<tr><td colspan="2" class="muted">No activity yet.</td></tr>`;

  return `
    <div class="page-head">
      <div><h2>Logistics</h2><div class="desc">Track tablets, vests and equipment by city. A reminder email goes out automatically if a city goes 7+ days without a check.</div></div>
      ${editable && canSeeAllCities() ? '<button class="btn btn-sm" id="addCity">+ Add city</button>' : ''}
    </div>
    ${cities.length>1 ? `<div class="city-tabs">${cities.map(c=>`<div class="city-tab ${c===city?'active':''}" data-city="${c}">${c}</div>`).join('')}</div>` : `<div class="small muted" style="margin-bottom:14px;">📍 ${esc(city)}</div>`}
    ${bannerHtml}
    <div class="grid2">
      <div class="panel">
        <div class="panel-title">Tablets in ${city}</div>
        <ul class="equip-list">${tabletsHtml}</ul>
        ${editable ? `<div style="display:flex;gap:8px;margin-top:14px;">
          <button class="btn btn-sm" id="addTablet">+ Add tablet</button>
          <button class="btn btn-sm" id="transferTablet">Transfer tablet</button>
        </div>` : ''}
      </div>
      <div class="panel">
        <div class="panel-title">Vests in ${city}</div>
        <div style="font-size:34px;font-weight:800;">${cdata.vests||0}</div>
        <div class="small muted" style="margin-bottom:10px;">current count</div>
        ${editable ? '<button class="btn btn-sm" id="adjustVests">+/- Adjust vests</button>' : ''}
      </div>
    </div>
    ${editable ? `<div class="panel">
      <div class="panel-title">Daily check</div>
      <p class="small muted">Confirm today that the equipment listed above is physically present in ${city}.</p>
      <button class="btn btn-accent" id="confirmEquip">Confirm equipment present today</button>
    </div>` : ''}
    <div class="panel"><div class="panel-title">Activity log</div><table><thead><tr><th>Date</th><th>Action</th></tr></thead><tbody>${log}</tbody></table></div>
  `;
}

async function refreshLogistics(){
  DATA.logistics = await gsRun('getLogisticsSnapshot');
  render();
}

window.tabRefreshers.logistics = async function(){
  const [freshLogistics, freshCities] = await Promise.all([gsRun('getLogisticsSnapshot'), gsRun('getCities')]);
  const changed = JSON.stringify(freshLogistics) !== JSON.stringify(DATA.logistics) || JSON.stringify(freshCities) !== JSON.stringify(DATA.cities);
  if(changed){ DATA.logistics = freshLogistics; DATA.cities = freshCities; render(); }
};

function attachLogisticsEvents(){
  if(!document.querySelector('#content .panel')) return; // the "no city" state has no controls
  document.querySelectorAll('.city-tab').forEach(t=> t.onclick = ()=>{ ui.city=t.dataset.city; render(); });
  // Viewers (Team Leader / Senior Team Leader) get no action buttons at all,
  // so every handler below is bound only if its button was rendered.
  const $ = (id)=> document.getElementById(id);
  if($('addCity')) $('addCity').onclick = ()=>{
    ui.modal = { title:'Add city', body:`
      <div class="field"><label>City name</label><input id="cityadd_name" placeholder="e.g. Edinburgh"></div>
      <div class="modal-actions"><button class="btn" id="cityadd_cancel">Cancel</button><button class="btn btn-accent" id="cityadd_save">Add</button></div>
    `};
    render();
  };
  if($('addTablet')) $('addTablet').onclick = ()=>{
    ui.modal = { title:`Add tablet · ${ui.city}`, body:`
      <div class="field"><label>Tablet ID</label><input id="tab_id" placeholder="e.g. 2153"></div>
      <div class="field"><label>Date (YYYY-MM-DD)</label><input type="text" inputmode="numeric" id="tab_date" value="${todayISO()}" placeholder="${todayISO()}"></div>
      <div class="modal-actions"><button class="btn" id="tab_cancel">Cancel</button><button class="btn btn-accent" id="tab_save">Add</button></div>
    `};
    render();
  };
  if($('transferTablet')) $('transferTablet').onclick = ()=>{
    const cdata = DATA.logistics.cities[ui.city];
    const others = DATA.cities.filter(c=>c!==ui.city);
    ui.modal = { title:`Transfer tablet from ${ui.city}`, body:`
      <div class="field"><label>Tablet</label><select id="tr_tablet">${cdata.tablets.map(t=>`<option value="${t.id}">#${t.id}</option>`).join('') || '<option value="">No tablets available</option>'}</select></div>
      <div class="field"><label>Destination city</label><select id="tr_dest">${others.map(c=>`<option>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Date (YYYY-MM-DD)</label><input type="text" inputmode="numeric" id="tr_date" value="${todayISO()}" placeholder="${todayISO()}"></div>
      <div class="modal-actions"><button class="btn" id="tr_cancel">Cancel</button><button class="btn btn-accent" id="tr_save">Transfer</button></div>
    `};
    render();
  };
  if($('adjustVests')) $('adjustVests').onclick = ()=>{
    ui.modal = { title:`Adjust vests · ${ui.city}`, body:`
      <div class="field"><label>Change (negative to remove, e.g. -2)</label><input type="number" id="ve_delta" value="1"></div>
      <div class="field"><label>Reason (optional)</label><input id="ve_reason" placeholder="e.g. 5 UNICEF vests received"></div>
      <div class="field"><label>Date (YYYY-MM-DD)</label><input type="text" inputmode="numeric" id="ve_date" value="${todayISO()}" placeholder="${todayISO()}"></div>
      <div class="modal-actions"><button class="btn" id="ve_cancel">Cancel</button><button class="btn btn-accent" id="ve_save">Save</button></div>
    `};
    render();
  };
  if($('confirmEquip')) $('confirmEquip').onclick = function(){
    safeButtonAction(this, 'Confirming…', async ()=>{
      await gsRun('confirmEquipmentCheck', ui.city, session.name);
      await refreshLogistics();
    }, 'Equipment confirmed for ' + ui.city);
  };
}
window.moduleModalAttachers.push(function attachLogisticsModals(){
  const cityAddSave = document.getElementById('cityadd_save');
  if(cityAddSave){
    document.getElementById('cityadd_cancel').onclick = closeModal;
    cityAddSave.onclick = ()=> safeAction(async ()=>{
      const name = document.getElementById('cityadd_name').value.trim();
      if(!name) return;
      await gsRun('addCity', name);
      DATA.cities = await gsRun('getCities');
      ui.city = name;
      closeModal();
      await refreshLogistics();
    });
  }
  const tabSave = document.getElementById('tab_save');
  if(tabSave){
    document.getElementById('tab_cancel').onclick = closeModal;
    tabSave.onclick = ()=> safeAction(async ()=>{
      const idVal = document.getElementById('tab_id').value.trim();
      const date = document.getElementById('tab_date').value || todayISO();
      if(!idVal) return;
      await gsRun('addTablet', ui.city, idVal, date);
      closeModal();
      await refreshLogistics();
    });
  }
  const trSave = document.getElementById('tr_save');
  if(trSave){
    document.getElementById('tr_cancel').onclick = closeModal;
    trSave.onclick = ()=> safeAction(async ()=>{
      const tabletId = document.getElementById('tr_tablet').value;
      const dest = document.getElementById('tr_dest').value;
      const date = document.getElementById('tr_date').value || todayISO();
      if(!tabletId || !dest) return;
      await gsRun('transferTablet', ui.city, tabletId, dest, date);
      closeModal();
      await refreshLogistics();
    });
  }
  const veSave = document.getElementById('ve_save');
  if(veSave){
    document.getElementById('ve_cancel').onclick = closeModal;
    veSave.onclick = ()=> safeAction(async ()=>{
      const delta = parseInt(document.getElementById('ve_delta').value);
      const reason = document.getElementById('ve_reason').value.trim();
      const date = document.getElementById('ve_date').value || todayISO();
      if(!delta) return;
      await gsRun('adjustVests', ui.city, delta, reason, date);
      closeModal();
      await refreshLogistics();
    });
  }
});
