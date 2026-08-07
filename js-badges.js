/* =========================================================
   BADGES TAB (manager only)
   ========================================================= */
let badgePhotoImg = null;
let badgeLogoCache = {}; 
let badgeLogoImg = null;
let currentAutoBadgeId = ''; // Garde en mémoire le prochain ID pour la ville en cours

function renderBadgesPage(){
  const visibleLog = canSeeAllCities() ? DATA.badgeLog
    : DATA.badgeLog.filter(b => String(b.city||'').trim().toLowerCase() === myCity().toLowerCase());
  const logRows = visibleLog.map(b=>`<tr><td class="mono">${b.id}</td><td>${b.name}</td><td>${b.campaign||''}</td><td>${b.city||''}</td><td class="small">${fmtDate(b.date)}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">No badges generated yet.</td></tr>`;
  const campaignOptions = DATA.campaigns.map(c=>`<option value="${c.name}">${c.name}</option>`).join('') || '<option value="">No campaigns configured</option>';
  
  /* A badge belongs to a city (its number is prefixed from it), so the list
     is restricted the same way every other tab is. */
  const allowedCities = canSeeAllCities() ? (DATA.cities || []) : (myCity() ? [myCity()] : []);
  const cityOptions = allowedCities.map(c => `<option value="${c}">${c}</option>`).join('') || '<option value="">No cities configured</option>';

  return `
    <div class="page-head"><div><h2>Employee Badges</h2><div class="desc">Generate a printable ID badge per city prefix (e.g. GL1001, LD1001).</div></div></div>
    <div class="panel">
      <div class="badge-canvas-wrap">
        <div>
          <canvas id="badgeCanvas" width="520" height="300"></canvas>
          <div style="margin-top:10px;display:flex;gap:8px;">
            <a class="btn btn-sm btn-accent" id="downloadBadge" download="badge.png">Download PNG</a>
          </div>
        </div>
        <div style="flex:1;min-width:240px;">
          <div class="field"><label>Campaign</label><select id="bg_campaign">${campaignOptions}</select></div>
          <div class="field"><label>City</label><select id="bg_city" ${allowedCities.length===1?'disabled':''}>${cityOptions}</select></div>
          <div class="field"><label>Select Employee (Filtered by city)</label><select id="bg_emp_select"></select></div>
          <div class="field"><label>Full name</label><input id="bg_name" placeholder="e.g. Mohammed Ilyas"></div>
          <div class="field"><label>Photo</label><input type="file" id="bg_photo" accept="image/*"></div>
          <div class="field">
            <label>Fundraiser ID</label>
            <input id="bg_id" class="mono" placeholder="Loading...">
          </div>
          <button class="btn btn-accent" id="genBadge">Generate badge</button>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">Badge log</div>
      <table><thead><tr><th>ID</th><th>Name</th><th>Campaign</th><th>City</th><th>Generated</th></tr></thead><tbody>${logRows}</tbody></table>
    </div>
  `;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight){
  const words = (text||'').split(' ');
  let line = ''; let curY = y;
  for(let n=0;n<words.length;n++){
    const test = line + words[n] + ' ';
    if(ctx.measureText(test).width > maxWidth && n>0){ ctx.fillText(line, x, curY); line = words[n] + ' '; curY += lineHeight; } 
    else { line = test; }
  }
  ctx.fillText(line, x, curY); return curY;
}

function drawBadge(name, badgeIdStr){
  const canvas = document.getElementById('badgeCanvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const campaignSel = document.getElementById('bg_campaign');
  const campaignName = campaignSel ? campaignSel.value : '';
  const campaign = DATA.campaigns.find(c=>c.name===campaignName) || null;
  const city = document.getElementById('bg_city') ? document.getElementById('bg_city').value : '';
  
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = '#ddd'; ctx.strokeRect(0.5,0.5,canvas.width-1,canvas.height-1);

  ctx.textAlign = 'right'; ctx.fillStyle = '#333'; ctx.font = '11px Arial';
  ctx.fillText('Fundraiser ID No. ' + (badgeIdStr || currentAutoBadgeId), canvas.width-14, 20);

  if(badgeLogoImg){
    const maxW = 150, maxH = 60; const ratio = Math.min(maxW/badgeLogoImg.width, maxH/badgeLogoImg.height);
    ctx.drawImage(badgeLogoImg, 14, 14, badgeLogoImg.width*ratio, badgeLogoImg.height*ratio);
  } else if(campaign){
    ctx.textAlign='left'; ctx.fillStyle='#999'; ctx.font='11px Arial';
    ctx.fillText('(logo not set)', 14, 30);
  }

  ctx.textAlign='left'; ctx.fillStyle='#1a3fa0'; ctx.font='bold 22px Georgia';
  ctx.fillText(name || 'Full Name', 14, 100);

  ctx.fillStyle='#222'; ctx.font='12px Arial';
  const desc = campaign ? campaign.description : 'is a paid fundraiser.';
  let y = wrapText(ctx, desc, 14, 122, 300, 16);

  ctx.font='11px Arial'; ctx.fillStyle='#333';
  if(city) { ctx.fillText('Location: ' + city, 14, y + 12); y += 14; }
  if(campaign && campaign.expiry){ ctx.fillText('Expiry: '+fmtDate(campaign.expiry), 14, y+16); }

  ctx.font='italic 16px Georgia'; ctx.fillStyle='#222';
  ctx.fillText(campaign ? (campaign.approvedByName||'') : '', 14, 260);
  ctx.font='10px Arial'; ctx.fillStyle='#555';
  ctx.fillText('Approved by :  ' + (campaign ? (campaign.approvedByTitle||'') : ''), 14, 276);

  ctx.save(); ctx.setLineDash([4,3]); ctx.strokeStyle='#1a3fa0'; ctx.lineWidth=1.5; ctx.strokeRect(390,14,116,116); ctx.restore();
  if(badgePhotoImg){ ctx.drawImage(badgePhotoImg,392,16,112,112); } 
  else {
    ctx.fillStyle='#eee'; ctx.fillRect(392,16,112,112);
    ctx.fillStyle='#999'; ctx.font='11px Arial'; ctx.textAlign='center'; ctx.fillText('Photo', 448, 74);
  }
  
  ctx.fillStyle='#1a3fa0'; ctx.fillRect(390,138,116,26);
  ctx.fillStyle='#fff'; ctx.font='bold 12px Arial'; ctx.textAlign='center'; ctx.fillText('PUBLIC OUTREACH', 448, 155);

  ctx.textAlign='right'; ctx.fillStyle='#333'; ctx.font='10px Arial';
  ctx.fillText(companyFooterText || 'Public Outreach UK Ltd', canvas.width-14, canvas.height-14);
}

let companyFooterText = '';

async function ensureCampaignLogo(){
  const campaignSel = document.getElementById('bg_campaign');
  const campaign = DATA.campaigns.find(c=>c.name===(campaignSel?campaignSel.value:''));
  badgeLogoImg = null;
  const currentBadgeId = document.getElementById('bg_id') ? document.getElementById('bg_id').value : currentAutoBadgeId;
  
  if(!campaign || !campaign.logoFileId){ drawBadge(document.getElementById('bg_name').value, currentBadgeId); return; }
  if(badgeLogoCache[campaign.name]){ loadLogoImg(badgeLogoCache[campaign.name]); return; }
  
  const dataUrl = await gsRun('getCampaignLogoDataUrl', campaign.logoFileId);
  if(dataUrl){ badgeLogoCache[campaign.name] = dataUrl; loadLogoImg(dataUrl); }
  else { drawBadge(document.getElementById('bg_name').value, currentBadgeId); }
}
function loadLogoImg(dataUrl){
  const img = new Image();
  img.onload = ()=>{ badgeLogoImg = img; drawBadge(document.getElementById('bg_name').value, document.getElementById('bg_id').value); };
  img.src = dataUrl;
}

async function updateEmployeeListAndId(){
  const city = document.getElementById('bg_city').value;
  if(!city) return;

  // 1. Filtre la liste des employés selon la ville choisie
  const empsInCity = DATA.employees.filter(e => e.city === city);
  const empSelect = document.getElementById('bg_emp_select');
  empSelect.innerHTML = '<option value="">-- Custom / Manual Name --</option>' + 
    empsInCity.map(e => `<option value="${e.id}">${e.firstName} ${e.lastName}</option>`).join('');
  
  // 2. Va chercher le prochain numéro de badge disponible pour cette ville
  currentAutoBadgeId = await gsRun('getNextBadgeIdForCity', city);
  document.getElementById('bg_id').value = currentAutoBadgeId;
  document.getElementById('bg_name').value = '';
  drawBadge('', currentAutoBadgeId);
}

async function handleEmployeeSelection(){
  const empId = document.getElementById('bg_emp_select').value;
  const emp = DATA.employees.find(e => e.id === empId);
  
  if(emp){
    document.getElementById('bg_name').value = `${emp.firstName} ${emp.lastName}`;
    if(emp.badgeId){
      document.getElementById('bg_id').value = emp.badgeId;
    } else {
      document.getElementById('bg_id').value = currentAutoBadgeId;
    }
  } else {
    document.getElementById('bg_name').value = '';
    document.getElementById('bg_id').value = currentAutoBadgeId;
  }
  drawBadge(document.getElementById('bg_name').value, document.getElementById('bg_id').value);
}

window.tabRefreshers.badges = async function(){
  const log = await gsRun('getBadgeLog');
  if(JSON.stringify(log) !== JSON.stringify(DATA.badgeLog)){
    DATA.badgeLog = log; render();
  }
};

function attachBadgesEvents(){
  if(!companyFooterText) gsRun('getCompanyFooter').then(t=>{ companyFooterText = t; });
  
  // Initialiser la vue pour la première ville
  setTimeout(()=> {
    ensureCampaignLogo();
    updateEmployeeListAndId();
  }, 30);

  document.getElementById('bg_campaign').onchange = ensureCampaignLogo;
  document.getElementById('bg_city').onchange = updateEmployeeListAndId;
  document.getElementById('bg_emp_select').onchange = handleEmployeeSelection;
  
  document.getElementById('bg_name').oninput = (e)=> drawBadge(e.target.value, document.getElementById('bg_id').value);
  document.getElementById('bg_id').oninput = (e)=> drawBadge(document.getElementById('bg_name').value, e.target.value);

  document.getElementById('bg_photo').onchange = (e)=>{
    const f = e.target.files[0]; if(!f) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{ badgePhotoImg = img; drawBadge(document.getElementById('bg_name').value, document.getElementById('bg_id').value); };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  };

  document.getElementById('genBadge').onclick = ()=> safeAction(async ()=>{
    const name = document.getElementById('bg_name').value.trim();
    const campaignSel = document.getElementById('bg_campaign');
    const campaignName = campaignSel ? campaignSel.value : '';
    const city = document.getElementById('bg_city').value;
    const badgeIdInput = document.getElementById('bg_id').value.trim();
    const empId = document.getElementById('bg_emp_select').value; // ID de l'employé sélectionné
    
    if(!name || !campaignName || !city) return;

    drawBadge(name, badgeIdInput);
    await new Promise(r=>setTimeout(r,60));

    const canvas = document.getElementById('badgeCanvas');
    const link = document.getElementById('downloadBadge');
    link.href = canvas.toDataURL('image/png');
    link.download = `badge-${badgeIdInput || currentAutoBadgeId}.png`;

    // Le backend génère/enregistre l'ID et l'assigne à l'employé si empId est fourni
    const finalId = await gsRun('logBadge', name, campaignName, city, badgeIdInput, empId);
    
    // Mise à jour de la mémoire locale de l'employé
    if(empId && !badgeIdInput){
      const e = DATA.employees.find(x => x.id === empId);
      if(e) e.badgeId = finalId;
    }

    DATA.badgeLog.unshift({id: finalId, name, campaign: campaignName, city, date: todayISO()});
    // Rafraîchir l'ID automatique pour la ville actuelle au cas où un autre badge doit être fait
    currentAutoBadgeId = await gsRun('getNextBadgeIdForCity', city);
    render();
  });
}
