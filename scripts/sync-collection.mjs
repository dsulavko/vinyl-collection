import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './lib/env.mjs';
import { makeId } from './lib/slug.mjs';

const SHEET_ID = '1mkx_jgCgpAvn1G3dUjR6jq1xh1M6OcfsEt04ryokOUw';
const SHEET_GID = '0';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const OUT_PATH = path.join(REPO_ROOT, 'data', 'collection.json');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

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
    const yearRaw = (row[2] ?? '').trim();
    const catalogNumber = (row[3] ?? '').trim() || null;
    if (!artist || !album) continue;
    const year = /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
    const id = makeId(artist, album, existingIds, year ?? 'unknown');
    existingIds.add(id);
    collection.push({ id, artist, album, year, catalogNumber });
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
        prev.year !== r.year ||
        prev.catalogNumber !== r.catalogNumber)
    );
  });

  writeFileSync(OUT_PATH, `${JSON.stringify(collection, null, 2)}\n`);

  console.log(`Synced ${collection.length} records from the sheet.`);
  console.log(`  added:   ${added.length}`);
  console.log(`  removed: ${removed.length}`);
  console.log(`  changed: ${changed.length}`);
  for (const r of added) console.log(`    + ${r.artist} — ${r.album} (${r.year ?? '?'})`);
  for (const r of removed) console.log(`    - ${r.artist} — ${r.album} (${r.year ?? '?'})`);
  for (const r of changed) console.log(`    ~ ${r.artist} — ${r.album} (${r.year ?? '?'})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
