import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, requireEnv } from './lib/env.mjs';

const COLLECTION_PATH = path.join(REPO_ROOT, 'data', 'collection.json');
const DETAILS_PATH = path.join(REPO_ROOT, 'data', 'details.json');

const USER_AGENT = 'VinylCollectionSite/1.0 (+local personal use)';
const REQUEST_DELAY_MS = 1100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function pickBestResult(results, year) {
  if (!results.length) return null;
  const vinylResults = results.filter((r) => (r.format || []).some((f) => /vinyl/i.test(f)));
  const pool = vinylResults.length ? vinylResults : results;
  if (year) {
    pool.sort((a, b) => Math.abs((a.year || 0) - year) - Math.abs((b.year || 0) - year));
  }
  return pool[0];
}

function looksLikeBarcode(code) {
  return /^\d{6,14}$/.test(code.replace(/[\s-]/g, ''));
}

// Discogs' search API silently returns zero results for queries containing a
// curly/smart apostrophe, so straighten quotes before this text ever reaches it.
function straightenQuotes(text) {
  return (text || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

function normalizeForMatch(text) {
  return straightenQuotes(text)
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Catalog numbers and (especially) barcodes can collide with an unrelated
// release, so any catno/barcode hit must still have the right artist. Sheet
// entries can have small typos ("Chis Rea", "Phill Collins") relative to
// Discogs' canonical spelling, so allow a couple of edits rather than
// requiring exact substring containment.
function resultMatchesArtist(result, artist) {
  const normArtist = normalizeForMatch(artist);
  if (!normArtist) return true;
  const artistPart = (result.title || '').split(' - ')[0];
  const normArtistPart = normalizeForMatch(artistPart);
  if (normArtistPart.includes(normArtist) || normArtist.includes(normArtistPart)) return true;
  const maxEdits = normArtist.length <= 4 ? 0 : normArtist.length <= 8 ? 1 : 2;
  return levenshtein(normArtist, normArtistPart) <= maxEdits;
}

async function searchByField(field, value, record, token) {
  const q = new URLSearchParams({ type: 'release', [field]: value, per_page: '25' });
  const searchData = await discogsFetch(
    `https://api.discogs.com/database/search?${q.toString()}`,
    token
  );
  await sleep(REQUEST_DELAY_MS);
  const candidates = (searchData.results || []).filter((r) => resultMatchesArtist(r, record.artist));
  return pickBestResult(candidates, record.year);
}

async function findRelease(record, token) {
  if (record.catalogNumber) {
    const fields = looksLikeBarcode(record.catalogNumber)
      ? ['barcode', 'catno']
      : ['catno', 'barcode'];
    for (const field of fields) {
      const best = await searchByField(field, record.catalogNumber, record, token);
      if (best) return { best, matchedBy: field };
    }
  }

  const q = new URLSearchParams({
    type: 'release',
    artist: straightenQuotes(record.artist),
    release_title: straightenQuotes(record.album),
    per_page: '10',
  });
  const searchData = await discogsFetch(
    `https://api.discogs.com/database/search?${q.toString()}`,
    token
  );
  await sleep(REQUEST_DELAY_MS);
  const best = pickBestResult(searchData.results || [], record.year);
  return best ? { best, matchedBy: 'text' } : null;
}

async function enrichRecord(record, token, forceReleaseId) {
  let releaseId;
  let matchedBy;
  if (forceReleaseId) {
    releaseId = forceReleaseId;
    matchedBy = 'manual';
  } else {
    const found = await findRelease(record, token);
    if (!found) return null;
    releaseId = found.best.id;
    matchedBy = found.matchedBy;
  }

  const releaseData = await discogsFetch(`https://api.discogs.com/releases/${releaseId}`, token);
  await sleep(REQUEST_DELAY_MS);

  return {
    discogsReleaseId: releaseData.id,
    discogsUrl: releaseData.uri || `https://www.discogs.com/release/${releaseData.id}`,
    matchedBy,
    label: releaseData.labels?.[0]?.name || null,
    genres: releaseData.genres || [],
    styles: releaseData.styles || [],
    country: releaseData.country || null,
    released: releaseData.released || null,
    tracklist: (releaseData.tracklist || [])
      .filter((t) => !t.type_ || t.type_ === 'track')
      .map((t) => ({ position: t.position, title: t.title, duration: t.duration || null })),
    notes: releaseData.notes || null,
    images: (releaseData.images || []).map((img) => img.uri).filter(Boolean),
    lowestPrice: typeof releaseData.lowest_price === 'number' ? releaseData.lowest_price : null,
    numForSale: releaseData.num_for_sale ?? 0,
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  const token = requireEnv('DISCOGS_TOKEN');
  const collection = JSON.parse(readFileSync(COLLECTION_PATH, 'utf8'));

  let details = {};
  if (existsSync(DETAILS_PATH)) {
    try {
      details = JSON.parse(readFileSync(DETAILS_PATH, 'utf8'));
    } catch {
      details = {};
    }
  }

  const refresh = process.argv.includes('--refresh');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;
  const forceReleaseArg = process.argv.find((a) => a.startsWith('--force-release='));
  const forceReleaseId = forceReleaseArg ? Number(forceReleaseArg.slice('--force-release='.length)) : null;

  if (forceReleaseId && only?.length !== 1) {
    throw new Error('--force-release= requires exactly one id via --only=');
  }

  const targets = collection.filter((r) => {
    if (only) return only.includes(r.id);
    return refresh || !details[r.id];
  });

  console.log(`Enriching ${targets.length} of ${collection.length} records via Discogs...`);

  let done = 0;
  let failed = 0;
  for (const record of targets) {
    try {
      const result = await enrichRecord(record, token, forceReleaseId);
      if (result) {
        details[record.id] = result;
        done += 1;
        console.log(
          `  ok   ${record.artist} — ${record.album} -> discogs #${result.discogsReleaseId} (${result.matchedBy})`
        );
      } else {
        failed += 1;
        console.log(`  miss ${record.artist} — ${record.album} (no Discogs match found)`);
      }
      writeFileSync(DETAILS_PATH, `${JSON.stringify(details, null, 2)}\n`);
    } catch (err) {
      failed += 1;
      console.error(`  fail ${record.artist} — ${record.album}: ${err.message}`);
    }
  }

  console.log(`Done. Enriched ${done}, missing/failed ${failed}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
