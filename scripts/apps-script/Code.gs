// Bound Apps Script for the vinyl collection Google Sheet.
//
// Setup (one-time):
//   1. Open the Sheet -> Extensions -> Apps Script.
//   2. Replace the default Code.gs contents with this file.
//   3. Project Settings -> Script Properties -> add SECRET = <a random string>.
//      Put the same value in .env as APPS_SCRIPT_SECRET.
//   4. Deploy -> New deployment -> type "Web app" -> Execute as "Me",
//      Who has access "Anyone". Copy the deployment URL into .env as
//      APPS_SCRIPT_URL.
//
// This lets update-album-years.mjs write cells while executing as the
// sheet owner (you), without a Google Cloud OAuth client.

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ error: 'invalid JSON body' });
  }

  var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || body.secret !== secret) {
    return jsonResponse({ error: 'unauthorized' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var sheet = sheets[0];
  if (body.gid !== undefined && body.gid !== null) {
    var match = sheets.filter(function (s) { return s.getSheetId() === body.gid; })[0];
    if (match) sheet = match;
  }

  var updates = Array.isArray(body.updates) ? body.updates : [];
  updates.forEach(function (u) {
    sheet.getRange(u.row, u.col).setValue(u.value);
  });

  return jsonResponse({ written: updates.length });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
