(async function boot(){
  try{
    DATA = await gsRun('getBootstrapData');
    await loadWeek(ui.weekMonday);
    document.getElementById('loading-screen').style.display = 'none';
    render();
    startPolling();
  }catch(err){
    const msg = (err && err.message) ? err.message : String(err);
    document.getElementById('loading-screen').innerHTML =
      '<div style="max-width:520px;text-align:left;padding:20px;">' +
      '<div style="font-size:20px;margin-bottom:10px;">⚠ Could not load Outreach Hub</div>' +
      '<div style="font-family:monospace;font-size:13px;background:#1c2128;padding:12px;border-radius:6px;white-space:pre-wrap;margin-bottom:14px;">' + msg + '</div>' +
      '<div style="font-size:13px;color:#9aa1ab;line-height:1.6;">Common causes:<br>' +
      '1. API_URL in config.js is still the placeholder, or wrong (must end in /exec).<br>' +
      '2. The Apps Script web app deployment needs a new version after the last edit.<br>' +
      '3. SPREADSHEET_ID in Config.gs (Apps Script side) is still the placeholder, or wrong.<br>' +
      '4. setupSpreadsheet() has not been run yet.<br>' +
      '5. A sheet/tab is missing or renamed.</div>' +
      '</div>';
  }
})();
