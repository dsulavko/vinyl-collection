import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './lib/env.mjs';
import { makeId } from './lib/slug.mjs';
import { parseCsv } from './lib/csv.mjs';

const SHEET_ID = '1mkx_jgCgpAvn1G3dUjR6jq1xh1M6OcfsEt04ryokOUw';
const SHEET_GID = '0';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const OUT_PATH = path.join(REPO_ROOT, 'data', 'collection.json');

async function main() {
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch sheet CSV: ${res.status} ${res.statusText}`);
  }
  const csvText = await res.text();
  const rows = parseCsv(csvText);
  const dataRows = rows.slice(1); // drop header row

  const existingIds = new Set();
  const collection = [];
  for (const row of dataRows) {
    const artist = (row[0] ?? '').trim();
    const album = (row[1] ?? '').trim();
    const albumYearRaw = (row[2] ?? '').trim();
    const condition = (row[3] ?? '').trim() || null;
    const catalogNumber = (row[4] ?? '').trim() || null;
    if (!artist || !album) continue;
    const albumYear = /^\d{4}$/.test(albumYearRaw) ? Number(albumYearRaw) : null;
    const id = makeId(artist, album, existingIds, albumYear ?? 'unknown');
    existingIds.add(id);
    collection.push({ id, artist, album, albumYear, condition, catalogNumber });
  }

  let previous = [];
  if (existsSync(OUT_PATH)) {
    try {
      previous = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
    } catch {
      previous = [];
    }
  }
  const previousById = new Map(previous.map((r) => [r.id, r]));
  const currentIds = new Set(collection.map((r) => r.id));

  const added = collection.filter((r) => !previousById.has(r.id));
  const removed = previous.filter((r) => !currentIds.has(r.id));
  const changed = collection.filter((r) => {
    const prev = previousById.get(r.id);
    return (
      prev &&
      (prev.artist !== r.artist ||
        prev.album !== r.album ||
        prev.albumYear !== r.albumYear ||
        prev.condition !== r.condition ||
        prev.catalogNumber !== r.catalogNumber)
    );
  });

  writeFileSync(OUT_PATH, `${JSON.stringify(collection, null, 2)}\n`);

  console.log(`Synced ${collection.length} records from the sheet.`);
  console.log(`  added:   ${added.length}`);
  console.log(`  removed: ${removed.length}`);
  console.log(`  changed: ${changed.length}`);
  for (const r of added) console.log(`    + ${r.artist} — ${r.album} (${r.albumYear ?? '?'})`);
  for (const r of removed) console.log(`    - ${r.artist} — ${r.album} (${r.albumYear ?? '?'})`);
  for (const r of changed) console.log(`    ~ ${r.artist} — ${r.album} (${r.albumYear ?? '?'})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
