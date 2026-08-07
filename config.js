/**
 * CONFIG.GS
 * Central place for the spreadsheet ID, sheet names, and Settings tab access.
 * This is the ONLY file where the spreadsheet ID should be hardcoded.
 */

// ⬇️ PASTE YOUR SPREADSHEET ID HERE (from the sheet's URL)
const SPREADSHEET_ID = '15zPk6BkgPslpPz06ImXq4jbxnNLpICZ1NBxUYKI_C0A';

const SHEETS = {
  META:       'Meta',
  SETTINGS:   'Settings',
  EMPLOYEES:  'Employees',
  CAMPAIGNS:  'Campaigns',
  CITIES:     'Cities',
  SCHEDULE:   'Schedule',
  DAYTIMES:   'DayTimes',
  EOD:        'EOD',
  CHARITY:    'Charity',
  DOCS:       'Documentation',
  SIGNATURES: 'Signatures',
  TABLETS:    'Tablets',
  VESTS:      'Vests',
  LOG:        'LogisticsLog',
  CHECKS:     'Checks',
  BADGES:     'Badges',
  COUNTERS:   'Counters'
};

function ss(){
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}
function sheet(name){
  const sh = ss().getSheetByName(name);
  if(!sh) throw new Error('Sheet not found: ' + name + '. Run setupSpreadsheet() from Setup.gs first.');
  return sh;
}

function getSetting(key, fallback){
  const rows = readSheetObjects(SHEETS.SETTINGS);
  const row = rows.find(r => r.Key === key);
  return row ? row.Value : fallback;
}
function setSetting(key, value){
  const rows = readSheetObjects(SHEETS.SETTINGS);
  const row = rows.find(r => r.Key === key);
  if(row){ sheet(SHEETS.SETTINGS).getRange(row.__row, 2).setValue(value); }
  else { appendObjectRow(SHEETS.SETTINGS, {Key:key, Value:value}, ['Key','Value']); }
}
function getReminderEmails(){
  const raw = String(getSetting('ReminderEmails', '') || '');
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}
