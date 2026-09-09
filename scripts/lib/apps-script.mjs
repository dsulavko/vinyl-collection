import { requireEnv } from './env.mjs';

// Writes cells via a bound Apps Script Web App deployment (see
// scripts/apps-script/Code.gs) instead of the OAuth-authenticated Sheets API —
// the deployment executes as the sheet owner, so no Google Cloud OAuth client
// is needed. A shared secret (checked inside the script) stands in for OAuth.
export async function writeSheetCells(updates, gid) {
  const url = requireEnv('APPS_SCRIPT_URL');
  const secret = requireEnv('APPS_SCRIPT_SECRET');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, gid, updates }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Apps Script write failed: ${data.error || `${res.status} ${res.statusText}`}`);
  }
  return data.written;
}
