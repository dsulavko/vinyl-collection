import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, requireEnv } from './lib/env.mjs';

const COLLECTION_PATH = path.join(REPO_ROOT, 'data', 'collection.json');
const DETAILS_PATH = path.join(REPO_ROOT, 'data', 'details.json');
const PRICES_PATH = path.join(REPO_ROOT, 'data', 'prices.json');

const USER_AGENT = 'VinylCollectionSite/1.0 (+local personal use)';
const REQUEST_DELAY_MS = 1100;
const CURRENCY = 'USD';

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

function extractLowestPrice(stats) {
  const lp = stats.lowest_price;
  if (lp == null) return null;
  if (typeof lp === 'number') return lp;
  if (typeof lp === 'object' && typeof lp.value === 'number') return lp.value;
  return null;
}

// Older details.json entries (enriched before lowestPrice/numForSale were
// captured from the release payload) fall back to one Discogs API call.
async function fetchStats(releaseId, token) {
  const stats = await discogsFetch(
    `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=${CURRENCY}`,
    token
  );
  await sleep(REQUEST_DELAY_MS);
  return { lowestPrice: extractLowestPrice(stats), numForSale: stats.num_for_sale ?? 0 };
}

async function main() {
  const collection = readJson(COLLECTION_PATH, []);
  const details = readJson(DETAILS_PATH, {});
  const prices = readJson(PRICES_PATH, {});

  const refresh = process.argv.includes('--refresh');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;

  const targets = collection.filter((r) => {
    if (!details[r.id]?.discogsReleaseId) return false;
    if (only) return only.includes(r.id);
    return refresh || !prices[r.id];
  });

  const skippedNoDetail = collection.filter((r) => !details[r.id]?.discogsReleaseId).length;

  console.log(`Estimating prices for ${targets.length} of ${collection.length} records...`);
  if (skippedNoDetail) {
    console.log(`  (${skippedNoDetail} records have no Discogs release id yet — run enrich-details first)`);
  }

  let token = null;
  let done = 0;
  let noListings = 0;
  let failed = 0;
  for (const record of targets) {
    const detail = details[record.id];
    try {
      let lowestPrice;
      let numForSale;
      if ('lowestPrice' in detail) {
        // Already captured alongside the release lookup in enrich-details — no API call needed.
        lowestPrice = detail.lowestPrice;
        numForSale = detail.numForSale ?? 0;
      } else {
        token = token || requireEnv('DISCOGS_TOKEN');
        ({ lowestPrice, numForSale } = await fetchStats(detail.discogsReleaseId, token));
      }

      if (lowestPrice == null) {
        noListings += 1;
        console.log(`  none ${record.artist} — ${record.album} (no current marketplace listings)`);
      } else {
        done += 1;
        console.log(`  ok   ${record.artist} — ${record.album}: ${lowestPrice} ${CURRENCY} (${numForSale} for sale)`);
      }
      prices[record.id] = { lowestPrice, currency: CURRENCY, numForSale, updatedAt: new Date().toISOString() };
      writeFileSync(PRICES_PATH, `${JSON.stringify(prices, null, 2)}\n`);
    } catch (err) {
      failed += 1;
      console.error(`  fail ${record.artist} — ${record.album}: ${err.message}`);
    }
  }

  console.log(`Done. Priced ${done}, no listings ${noListings}, failed ${failed}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
