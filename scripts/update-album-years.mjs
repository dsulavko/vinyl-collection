import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, requireEnv } from './lib/env.mjs';
import { parseCsv } from './lib/csv.mjs';
import { writeSheetCells } from './lib/apps-script.mjs';

const COLLECTION_PATH = path.join(REPO_ROOT, 'data', 'collection.json');
const DETAILS_PATH = path.join(REPO_ROOT, 'data', 'details.json');

const SHEET_ID = '1mkx_jgCgpAvn1G3dUjR6jq1xh1M6OcfsEt04ryokOUw';
const SHEET_GID = 0;
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const ALBUM_YEAR_COL = 3; // "Год выпуска альбома" — 3rd column

const USER_AGENT = 'VinylCollectionSite/1.0 (+local personal use)';
const REQUEST_DELAY_MS = 1100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(p, fallback) {
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

async function discogsFetch(url, token) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Authorization: `Discogs token=${token}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Discogs request failed (${res.status} ${res.statusText}): ${url}`);
  }
  return res.json();
}

// Caches { masterId, masterYear } onto the details.json entry so re-runs don't
// re-fetch. masterYear is null when the release has no master (nothing to correct).
async function fetchMasterYear(detail, token) {
  const releaseData = await discogsFetch(`https://api.discogs.com/releases/${detail.discogsReleaseId}`, token);
  await sleep(REQUEST_DELAY_MS);
  if (!releaseData.master_id) {
    return { masterId: null, masterYear: null };
  }
  const masterData = await discogsFetch(`https://api.discogs.com/masters/${releaseData.master_id}`, token);
  await sleep(REQUEST_DELAY_MS);
  return { masterId: releaseData.master_id, masterYear: masterData.year || null };
}

// Fetches the live sheet CSV and matches each change to its row by exact
// artist+album, without writing anything. Shared by the real write path and
// --dry-run reporting.
async function locateSheetRows(changes) {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Failed to fetch sheet CSV: ${res.status} ${res.statusText}`);
  const rows = parseCsv(await res.text());
  const dataRows = rows.slice(1);

  const located = [];
  const skipped = [];
  for (const change of changes) {
    const matches = dataRows
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => (row[0] ?? '').trim() === change.artist && (row[1] ?? '').trim() === change.album);
    if (matches.length !== 1) {
      skipped.push({ ...change, reason: matches.length === 0 ? 'no matching row' : 'ambiguous (multiple matching rows)' });
      continue;
    }
    const sheetRow = matches[0].i + 2; // +1 header row, +1 for 1-based rows
    located.push({ ...change, sheetRow });
  }
  return { located, skipped };
}

async function reconcileWithSheet(changes) {
  const { located, skipped } = await locateSheetRows(changes);
  const updates = located.map((c) => ({ row: c.sheetRow, col: ALBUM_YEAR_COL, value: c.newYear }));
  const written = updates.length ? await writeSheetCells(updates, SHEET_GID) : 0;
  return { written, skipped };
}

async function main() {
  const token = requireEnv('DISCOGS_TOKEN');
  const collection = readJson(COLLECTION_PATH, []);
  const details = readJson(DETAILS_PATH, {});

  const refresh = process.argv.includes('--refresh');
  const dryRun = process.argv.includes('--dry-run');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;

  const targets = collection.filter((r) => {
    if (!details[r.id]?.discogsReleaseId) return false;
    if (only) return only.includes(r.id);
    return true;
  });

  const skippedNoDetail = collection.filter((r) => !details[r.id]?.discogsReleaseId).length;

  console.log(`Checking master year for ${targets.length} of ${collection.length} records...`);
  if (skippedNoDetail) {
    console.log(`  (${skippedNoDetail} records have no Discogs release id yet — run enrich-details first)`);
  }

  let noMaster = 0;
  let failed = 0;
  const changes = [];

  for (const record of targets) {
    const detail = details[record.id];
    try {
      let masterYear;
      if (!refresh && 'masterYear' in detail) {
        masterYear = detail.masterYear;
      } else {
        const result = await fetchMasterYear(detail, token);
        detail.masterId = result.masterId;
        detail.masterYear = result.masterYear;
        writeFileSync(DETAILS_PATH, `${JSON.stringify(details, null, 2)}\n`);
        masterYear = result.masterYear;
      }

      if (masterYear == null) {
        noMaster += 1;
        console.log(`  none ${record.artist} — ${record.album} (no Discogs master release)`);
        continue;
      }

      if (masterYear !== record.albumYear) {
        changes.push({ id: record.id, artist: record.artist, album: record.album, oldYear: record.albumYear, newYear: masterYear });
        console.log(`  diff ${record.artist} — ${record.album}: ${record.albumYear ?? '?'} -> ${masterYear}`);
        record.albumYear = masterYear;
      } else {
        console.log(`  ok   ${record.artist} — ${record.album}: ${masterYear} (unchanged)`);
      }
    } catch (err) {
      failed += 1;
      console.error(`  fail ${record.artist} — ${record.album}: ${err.message}`);
    }
  }

  if (changes.length && dryRun) {
    console.log(`\n${changes.length} record(s) need correcting (--dry-run, nothing written):`);
    const { located, skipped } = await locateSheetRows(changes);
    for (const c of located) {
      console.log(`  row ${c.sheetRow}, column C: ${c.artist} — ${c.album}: ${c.oldYear ?? '?'} -> ${c.newYear}`);
    }
    for (const s of skipped) {
      console.log(`  ?    ${s.artist} — ${s.album}: ${s.oldYear ?? '?'} -> ${s.newYear} (${s.reason} — locate manually)`);
    }
  } else if (changes.length) {
    writeFileSync(COLLECTION_PATH, `${JSON.stringify(collection, null, 2)}\n`);
    console.log(`\nUpdated ${changes.length} record(s) in data/collection.json.`);

    console.log('Writing corrected years back to the Google Sheet...');
    try {
      const { written, skipped } = await reconcileWithSheet(changes);
      console.log(`  wrote ${written} cell(s) to the sheet.`);
      for (const s of skipped) {
        console.log(`  skip sheet write for ${s.artist} — ${s.album}: ${s.reason} (JSON already updated)`);
      }
    } catch (err) {
      console.error(`  Sheet write failed: ${err.message}`);
      console.error('  data/collection.json was still updated locally.');
    }
  } else {
    console.log('\nNo album years needed correcting.');
  }

  console.log(`\nDone. ${changes.length} changed, ${noMaster} with no master release, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
