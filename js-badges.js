/* =========================================================
   BADGES TAB (manager only)
   ========================================================= */
let badgePhotoImg = null;
let badgeLogoCache = {}; // campaignName -> dataUrl
let badgeLogoImg = null;

function renderBadgesPage(){
  const logRows = DATA.badgeLog.map(b=>`<tr><td class="mono">${b.id}</td><td>${b.name}</td><td>${b.campaign||''}</td><td class="small">${fmtDate(b.date)}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">No badges generated yet.</td></tr>`;
  const campaignOptions = DATA.campaigns.map(c=>`<option value="${c.name}">${c.name}</option>`).join('') || '<option value="">No campaigns configured — add one in the Campaigns sheet</option>';
  return `
    <div class="page-head"><div><h2>Employee Badges</h2><div class="desc">Generate a printable ID badge with a unique fundraiser number for each person and campaign.</div></div></div>
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
          <div class="field"><label>Full name</label><input id="bg_name" placeholder="e.g. Mohammed Ilyas"></div>
          <div class="field"><label>Photo</label><input type="file" id="bg_photo" accept="image/*"></div>
          <div class="field"><label>Next fundraiser ID</label><input class="mono" value="BS${DATA.nextBadgeId}" disabled></div>
          <button class="btn btn-accent" id="genBadge">Generate badge</button>
          <p class="small muted" style="margin-top:10px;">Campaign name, logo, description text and "approved by" signature come from the Campaigns tab in the spreadsheet — add or edit campaigns there.</p>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">Badge log</div>
      <table><thead><tr><th>ID</th><th>Name</th><th>Campaign</th><th>Generated</th></tr></thead><tbody>${logRows}</tbody></table>
    </div>
  `;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight){
  const words = (text||'').split(' ');
  let line = '';
  let curY = y;
  for(let n=0;n<words.length;n++){
    const test = line + words[n] + ' ';
    if(ctx.measureText(test).width > maxWidth && n>0){
      ctx.fillText(line, x, curY);
      line = words[n] + ' ';
      curY += lineHeight;
    } else { line = test; }
  }
  ctx.fillText(line, x, curY);
  return curY;
}

function currentCampaign(){
  const sel = document.getElementById('bg_campaign');
  const name = sel ? sel.value : (DATA.campaigns[0] && DATA.campaigns[0].name);
  return DATA.campaigns.find(c=>c.name===name) || null;
}

function drawBadge(name, idNum){
  const canvas = document.getElementById('badgeCanvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const campaign = currentCampaign();
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = '#ddd'; ctx.strokeRect(0.5,0.5,canvas.width-1,canvas.height-1);

  // header: fundraiser ID top right
  ctx.textAlign = 'right'; ctx.fillStyle = '#333'; ctx.font = '11px Arial';
  ctx.fillText('Fundraiser ID No. BS'+idNum, canvas.width-14, 20);

  // logo top-left
  if(badgeLogoImg){
    const maxW = 150, maxH = 60;
    const ratio = Math.min(maxW/badgeLogoImg.width, maxH/badgeLogoImg.height);
    ctx.drawImage(badgeLogoImg, 14, 14, badgeLogoImg.width*ratio, badgeLogoImg.height*ratio);
  } else if(campaign){
    ctx.textAlign='left'; ctx.fillStyle='#999'; ctx.font='11px Arial';
    ctx.fillText('(logo not set — add DriveLogoFileId in Campaigns)', 14, 30);
  }

  // name
  ctx.textAlign='left'; ctx.fillStyle='#1a3fa0'; ctx.font='bold 22px Georgia';
  ctx.fillText(name || 'Full Name', 14, 100);

  // description
  ctx.fillStyle='#222'; ctx.font='12px Arial';
  const desc = campaign ? campaign.description : 'is a paid fundraiser, engaged by Public Outreach UK.';
  let y = wrapText(ctx, desc, 14, 122, 300, 16);

  // expiry
  if(campaign && campaign.expiry){
    ctx.font='11px Arial'; ctx.fillStyle='#333';
    ctx.fillText('Expiry: '+fmtDate(campaign.expiry), 14, y+22);
  }

  // approved by
  ctx.font='italic 16px Georgia'; ctx.fillStyle='#222';
  ctx.fillText(campaign ? (campaign.approvedByName||'') : '', 14, 260);
  ctx.font='10px Arial'; ctx.fillStyle='#555';
  ctx.fillText('Approved by :  ' + (campaign ? (campaign.approvedByTitle||'') : ''), 14, 276);

  // photo box (right)
  ctx.save();
  ctx.setLineDash([4,3]); ctx.strokeStyle='#1a3fa0'; ctx.lineWidth=1.5;
  ctx.strokeRect(390,14,116,116);
  ctx.restore();
  if(badgePhotoImg){
    ctx.drawImage(badgePhotoImg,392,16,112,112);
  } else {
    ctx.fillStyle='#eee'; ctx.fillRect(392,16,112,112);
    ctx.fillStyle='#999'; ctx.font='11px Arial'; ctx.textAlign='center';
    ctx.fillText('Photo', 448, 74);
  }
  // Public Outreach brand box under photo
  ctx.fillStyle='#1a3fa0'; ctx.fillRect(390,138,116,26);
  ctx.fillStyle='#fff'; ctx.font='bold 12px Arial'; ctx.textAlign='center';
  ctx.fillText('PUBLIC OUTREACH', 448, 155);

  // footer
  ctx.textAlign='right'; ctx.fillStyle='#333'; ctx.font='10px Arial';
  ctx.fillText(companyFooterText || 'Public Outreach UK Ltd', canvas.width-14, canvas.height-14);
}

let companyFooterText = '';
async function ensureCampaignLogo(){
  const campaign = currentCampaign();
  badgeLogoImg = null;
  if(!campaign || !campaign.logoFileId){ drawBadge(document.getElementById('bg_name').value, DATA.nextBadgeId); return; }
  if(badgeLogoCache[campaign.name]){
    loadLogoImg(badgeLogoCache[campaign.name]);
    return;
  }
  const dataUrl = await gsRun('getCampaignLogoDataUrl', campaign.logoFileId);
  if(dataUrl){ badgeLogoCache[campaign.name] = dataUrl; loadLogoImg(dataUrl); }
  else { drawBadge(document.getElementById('bg_name').value, DATA.nextBadgeId); }
}
function loadLogoImg(dataUrl){
  const img = new Image();
  img.onload = ()=>{ badgeLogoImg = img; drawBadge(document.getElementById('bg_name').value, DATA.nextBadgeId); };
  img.src = dataUrl;
}

window.tabRefreshers.badges = async function(){
  const [log, nextId] = await Promise.all([gsRun('getBadgeLog'), gsRun('getNextBadgeId')]);
  if(JSON.stringify(log) !== JSON.stringify(DATA.badgeLog) || nextId !== DATA.nextBadgeId){
    DATA.badgeLog = log; DATA.nextBadgeId = nextId; render();
  }
};

function attachBadgesEvents(){
  if(!companyFooterText) gsRun('getCompanyFooter').then(t=>{ companyFooterText = t; drawBadge('', DATA.nextBadgeId); });
  setTimeout(()=> ensureCampaignLogo(), 30);
  document.getElementById('bg_campaign').onchange = ensureCampaignLogo;
  document.getElementById('bg_name').oninput = (e)=> drawBadge(e.target.value, DATA.nextBadgeId);
  document.getElementById('bg_photo').onchange = (e)=>{
    const f = e.target.files[0]; if(!f) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{ badgePhotoImg = img; drawBadge(document.getElementById('bg_name').value, DATA.nextBadgeId); };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  };
  document.getElementById('genBadge').onclick = ()=> safeAction(async ()=>{
    const name = document.getElementById('bg_name').value.trim();
    const campaign = currentCampaign();
    if(!name || !campaign) return;
    const idNum = DATA.nextBadgeId;
    drawBadge(name, idNum);
    await new Promise(r=>setTimeout(r,60));
    const canvas = document.getElementById('badgeCanvas');
    const link = document.getElementById('downloadBadge');
    link.href = canvas.toDataURL('image/png');
    link.download = 'badge-BS'+idNum+'.png';
    const newId = await gsRun('logBadge', name, campaign.name);
    DATA.badgeLog.unshift({id:newId, name, campaign:campaign.name, date:todayISO()});
    DATA.nextBadgeId = await gsRun('getNextBadgeId');
    render();
  });
}
