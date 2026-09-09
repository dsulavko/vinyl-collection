import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, requireEnv } from './lib/env.mjs';

const COLLECTION_PATH = path.join(REPO_ROOT, 'data', 'collection.json');
const DETAILS_PATH = path.join(REPO_ROOT, 'data', 'details.json');
const PRICES_PATH = path.join(REPO_ROOT, 'data', 'prices.json');

const USER_AGENT = 'VinylCollectionSite/1.0 (+local personal use)';
const REQUEST_DELAY_MS = 1100;
const CURRENCY = 'USD';
const MIN_ESTIMATE = 5;

// Discogs' price_suggestions endpoint (real per-condition pricing) requires the
// token holder to have filled out seller settings — not done here — so there is
// no API data source for condition-specific pricing. This heuristic multiplier,
// anchored at VG+ = 1.0 (a commonly-assumed typical marketplace-listing grade),
// approximates it from the one number Discogs does expose for free: the lowest
// current listing. It is a rough estimate, not real market data.
const CONDITION_MULTIPLIERS = {
  S: 2.2, // Sealed
  M: 1.6, // Mint
  NM: 1.35, // Near Mint
  'VG+': 1.0, // Very Good Plus (anchor)
  VG: 0.75, // Very Good
  'G+': 0.55, // Good Plus
  G: 0.4, // Good
  F: 0.25, // Fair
  P: 0.15, // Poor
};

const CONDITION_SYNONYMS = {
  SEALED: 'S',
  MINT: 'M',
  'NEAR MINT': 'NM',
  'M-': 'NM',
  'VERY GOOD PLUS': 'VG+',
  'VERY GOOD': 'VG',
  'GOOD PLUS': 'G+',
  GOOD: 'G',
  FAIR: 'F',
  POOR: 'P',
};

function normalizeGrade(raw) {
  const key = raw.trim().toUpperCase();
  if (CONDITION_MULTIPLIERS[key]) return key;
  const synonym = CONDITION_SYNONYMS[key];
  return synonym && CONDITION_MULTIPLIERS[synonym] ? synonym : null;
}

// Sheet values are "sleeve/media" grades, e.g. "VG+/VG+" — take the worse of
// the two (lower multiplier) since that's the one that should drag the estimate down.
function normalizeCondition(raw) {
  if (!raw) return null;
  const grades = raw.split('/').map(normalizeGrade).filter(Boolean);
  if (!grades.length) return null;
  return grades.reduce((worst, g) => (CONDITION_MULTIPLIERS[g] < CONDITION_MULTIPLIERS[worst] ? g : worst));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

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
  let unadjusted = 0;
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

      const condition = normalizeCondition(record.condition);
      const rawEstimate =
        condition && lowestPrice != null ? round2(lowestPrice * CONDITION_MULTIPLIERS[condition]) : lowestPrice;
      const estimatedValue = Math.max(MIN_ESTIMATE, rawEstimate ?? MIN_ESTIMATE);

      if (lowestPrice == null) {
        noListings += 1;
        console.log(
          `  none ${record.artist} — ${record.album} (no current marketplace listings — defaulted to ${MIN_ESTIMATE} ${CURRENCY})`
        );
      } else {
        done += 1;
        if (condition) {
          console.log(
            `  ok   ${record.artist} — ${record.album}: ${lowestPrice} ${CURRENCY} lowest -> ${estimatedValue} ${CURRENCY} est. (${condition}, x${CONDITION_MULTIPLIERS[condition]}${estimatedValue > rawEstimate ? ', floored' : ''})`
          );
        } else {
          unadjusted += 1;
          console.log(
            `  ok   ${record.artist} — ${record.album}: ${estimatedValue} ${CURRENCY} (${numForSale} for sale, no condition set — unadjusted${estimatedValue > rawEstimate ? ', floored' : ''})`
          );
        }
      }
      prices[record.id] = {
        lowestPrice,
        currency: CURRENCY,
        numForSale,
        condition,
        estimatedValue,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(PRICES_PATH, `${JSON.stringify(prices, null, 2)}\n`);
    } catch (err) {
      failed += 1;
      console.error(`  fail ${record.artist} — ${record.album}: ${err.message}`);
    }
  }

  console.log(`Done. Priced ${done} (${unadjusted} unadjusted, no condition set), no listings ${noListings}, failed ${failed}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
