import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './lib/env.mjs';

const COLLECTION_PATH = path.join(REPO_ROOT, 'data', 'collection.json');
const DETAILS_PATH = path.join(REPO_ROOT, 'data', 'details.json');
const COVERS_PATH = path.join(REPO_ROOT, 'data', 'covers.json');
const COVERS_DIR = path.join(REPO_ROOT, 'assets', 'covers');
const USER_AGENT = 'VinylCollectionSite/1.0 (+local personal use)';

function readJson(p, fallback) {
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

async function downloadImage(url, id) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Image fetch failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || '';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const relPath = `assets/covers/${id}.${ext}`;
  mkdirSync(COVERS_DIR, { recursive: true });
  writeFileSync(path.join(REPO_ROOT, relPath), buf);
  return relPath;
}

async function main() {
  const collection = readJson(COLLECTION_PATH, []);
  const details = readJson(DETAILS_PATH, {});
  const covers = readJson(COVERS_PATH, {});

  const urlArg = process.argv.find((a) => a.startsWith('--url='));
  const idArg = process.argv.find((a) => a.startsWith('--id='));

  // Manual path: used for the web-search fallback once a cover URL has been found by hand.
  if (urlArg && idArg) {
    const url = urlArg.slice('--url='.length);
    const id = idArg.slice('--id='.length);
    const relPath = await downloadImage(url, id);
    covers[id] = { imagePath: relPath, sourceUrl: url, updatedAt: new Date().toISOString() };
    writeFileSync(COVERS_PATH, `${JSON.stringify(covers, null, 2)}\n`);
    console.log(`Saved cover for ${id} -> ${relPath}`);
    return;
  }

  const refresh = process.argv.includes('--refresh');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;

  const targets = collection.filter((r) => {
    if (only) return only.includes(r.id);
    return refresh || !covers[r.id];
  });

  console.log(`Fetching covers for ${targets.length} of ${collection.length} records (from Discogs release images)...`);

  let done = 0;
  let noImage = 0;
  let failed = 0;
  for (const record of targets) {
    const detail = details[record.id];
    const imageUrl = detail?.images?.[0];
    if (!imageUrl) {
      noImage += 1;
      console.log(`  none ${record.artist} — ${record.album} (no Discogs image — needs web-search fallback)`);
      continue;
    }
    try {
      const relPath = await downloadImage(imageUrl, record.id);
      covers[record.id] = { imagePath: relPath, sourceUrl: imageUrl, updatedAt: new Date().toISOString() };
      writeFileSync(COVERS_PATH, `${JSON.stringify(covers, null, 2)}\n`);
      done += 1;
      console.log(`  ok   ${record.artist} — ${record.album}`);
    } catch (err) {
      failed += 1;
      console.error(`  fail ${record.artist} — ${record.album}: ${err.message}`);
    }
  }

  console.log(`Done. Saved ${done}, no Discogs image ${noImage}, failed ${failed}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
