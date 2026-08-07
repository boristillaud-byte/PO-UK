/* =========================================================
   BOOT
   Runs the first two server calls, then hands over to render().
   Everything that can go wrong at startup is caught here and turned into a
   message that names the actual problem — a generic list of "common causes"
   costs more time than it saves.
   ========================================================= */
(function boot(){

  function fail(headline, detail, hints){
    const el = document.getElementById('loading-screen');
    if(!el) return;
    el.innerHTML =
      '<div style="max-width:620px;text-align:left;padding:20px;font-weight:400;letter-spacing:normal;">' +
      '<div style="font-size:20px;font-weight:700;margin-bottom:10px;">⚠ ' + headline + '</div>' +
      (detail ? '<div style="font-family:monospace;font-size:13px;background:#1c2128;padding:12px;border-radius:6px;white-space:pre-wrap;margin-bottom:14px;">' + detail + '</div>' : '') +
      '<div style="font-size:13px;color:#9aa1ab;line-height:1.7;">' + hints + '</div>' +
      '</div>';
  }

  /* ---- Pre-flight: is config.js actually on the page? ----
     A missing or blocked config.js is by far the most common deployment
     mistake, and it used to surface as a bare "API_URL is not defined"
     inside the first fetch. Check it up front and say so plainly. */
  var url = null;
  try{ url = API_URL; }catch(e){ url = undefined; }
  if(typeof url === 'undefined' && typeof window.API_URL !== 'undefined') url = window.API_URL;

  if(typeof url === 'undefined'){
    fail('config.js has not loaded',
      'API_URL is not defined',
      'Every other script on this page loaded fine — only <b>config.js</b> is missing, so the app has no idea which Apps Script URL to call.<br><br>' +
      '<b>Check, in this order:</b><br>' +
      '1. <b>Is config.js in the same folder as index.html?</b> It is the one file that is never overwritten by an update, so it is easy to forget when deploying to a new folder or host.<br>' +
      '2. Open your browser\'s <b>Network</b> tab and reload. Look for the <code>config.js</code> row: <code>404</code> means the file is not there or the name is wrong (it is case-sensitive on most hosts — <code>Config.js</code> will not work).<br>' +
      '3. If it returns <code>200</code> but the app still fails, check the <b>Console</b> tab. A wrong <code>Content-Type</code> (it must be <code>application/javascript</code> or <code>text/javascript</code>) makes the browser refuse to run the file.<br>' +
      '4. Confirm the file contains a line starting with <code>const API_URL = \'https://script.google.com/macros/s/…/exec\';</code>');
    return;
  }

  if(!url || /PASTE|YOUR_|xxxx/i.test(String(url))){
    fail('API_URL is still the placeholder', String(url),
      'Open <b>config.js</b> and replace the value with your deployed web app URL: Apps Script → <b>Deploy</b> → <b>Manage deployments</b> → copy the URL under the active deployment.');
    return;
  }

  if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(String(url).trim())){
    fail('API_URL does not look like a deployed web app URL', String(url),
      'It must look exactly like <code>https://script.google.com/macros/s/AKfy…/exec</code>.<br><br>' +
      'Two URLs are easy to mix up: the one ending in <code>/dev</code> only works for you while signed in to the editor, and the <code>/macros/d/…</code> form is the editor link, not the web app. Use <b>Deploy → Manage deployments</b> and copy the URL shown there.');
    return;
  }

  /* ---- Normal startup ---- */
  (async function(){
    try{
      DATA = await gsRun('getBootstrapData');
      await loadWeek(ui.weekMonday);
      document.getElementById('loading-screen').style.display = 'none';
      render();
      startPolling();
    }catch(err){
      const msg = (err && err.message) ? err.message : String(err);

      if(/Sheet not found/i.test(msg)){
        fail('A tab is missing from the spreadsheet', msg,
          'Run <b>setupSpreadsheet()</b> from Setup.gs in the Apps Script editor — it creates any missing tab and leaves the existing ones untouched. Then reload this page.<br><br>' +
          'If the tab does exist, check it has not been renamed: the names the app expects are listed in <b>Config.gs → SHEETS</b>.');
        return;
      }
      if(/Unknown function/i.test(msg)){
        fail('The deployed script is older than this page', msg,
          'The front end is calling a function the deployed backend does not have yet. In Apps Script: <b>Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy</b>. Saving the code alone does not update the live web app.');
        return;
      }
      if(/Failed to fetch|NetworkError|Load failed/i.test(msg)){
        fail('Could not reach the Apps Script web app', msg,
          '1. Confirm the deployment\'s <b>Who has access</b> is set to <b>Anyone</b> — otherwise the browser gets a login redirect instead of data.<br>' +
          '2. Open the API_URL directly in a new tab: it should return <code>{"ok":true,"message":"Outreach Hub API is running."}</code>.<br>' +
          '3. If that works but the app does not, an extension or network filter is blocking the request — try a private window.');
        return;
      }

      fail('Could not load Outreach Hub', msg,
        '1. The Apps Script deployment may need a <b>new version</b> after the last edit (Deploy → Manage deployments → Edit → New version).<br>' +
        '2. <b>SPREADSHEET_ID</b> in Config.gs may be wrong.<br>' +
        '3. <b>setupSpreadsheet()</b> may not have been run yet.<br>' +
        '4. Open the API_URL in a new tab to check the backend responds at all.');
    }
  })();

})();
