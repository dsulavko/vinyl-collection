import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, requireEnv } from './lib/env.mjs';
import { getAccessToken as getEbayAccessToken, searchListingPrices } from './lib/ebay.mjs';

const COLLECTION_PATH = path.join(REPO_ROOT, 'data', 'collection.json');
const DETAILS_PATH = path.join(REPO_ROOT, 'data', 'details.json');
const PRICES_PATH = path.join(REPO_ROOT, 'data', 'prices.json');

const USER_AGENT = 'VinylCollectionSite/1.0 (+local personal use)';
const DISCOGS_REQUEST_DELAY_MS = 1100;
const EBAY_REQUEST_DELAY_MS = 250;
const CURRENCY = 'USD';

// eBay's active-listing average is weighted higher than Discogs' lowest-listing
// number since it's an actual average across multiple concurrent listings, while
// Discogs only exposes the single cheapest one (a floor, not an average).
const EBAY_WEIGHT = 0.7;
const DISCOGS_WEIGHT = 0.3;

// Neither API's free tier exposes real per-condition sold-price data (Discogs'
// price_suggestions needs seller settings; eBay's sold-price history is
// invite-only-partner). This heuristic multiplier, anchored at VG+ = 1.0 (a
// commonly-assumed typical marketplace-listing grade), approximates it from
// what both APIs do expose for free: current listing prices.
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

function multiplierFor(condition) {
  return condition ? CONDITION_MULTIPLIERS[condition] : 1;
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

function quantile(sortedValues, q) {
  if (sortedValues.length === 1) return sortedValues[0];
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedValues[base + 1] !== undefined) {
    return sortedValues[base] + rest * (sortedValues[base + 1] - sortedValues[base]);
  }
  return sortedValues[base];
}

// Averages a set of listing prices, rejecting IQR outliers first (>=4 points) so
// one wildly-mispriced listing can't drag the "average" toward a near-minimum.
// This is the actual "non-minimal, average price" mechanism the model relies on.
function averagePrices(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < 4) {
    return round2(sorted.reduce((a, b) => a + b, 0) / sorted.length);
  }
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const kept = sorted.filter((v) => v >= lo && v <= hi);
  const use = kept.length ? kept : sorted;
  return round2(use.reduce((a, b) => a + b, 0) / use.length);
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
async function fetchDiscogsStats(releaseId, token) {
  const stats = await discogsFetch(
    `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=${CURRENCY}`,
    token
  );
  await sleep(DISCOGS_REQUEST_DELAY_MS);
  return { lowestPrice: extractLowestPrice(stats), numForSale: stats.num_for_sale ?? 0 };
}

function tryGetEbayCredentials() {
  try {
    return { clientId: requireEnv('EBAY_CLIENT_ID'), clientSecret: requireEnv('EBAY_CLIENT_SECRET') };
  } catch {
    return null;
  }
}

// eBay's Browse API only returns current/active listings (asking prices), same
// caveat as Discogs — there's no public sold-price-history endpoint outside
// eBay's invite-only partner program.
async function fetchEbayAverage(record, credentials) {
  const token = await getEbayAccessToken(credentials.clientId, credentials.clientSecret);
  const query = `${record.artist} ${record.album} vinyl`;
  const listings = await searchListingPrices(query, token);
  await sleep(EBAY_REQUEST_DELAY_MS);
  return { average: averagePrices(listings.map((l) => l.price)), sampleSize: listings.length };
}

// Seeds the collection-average baseline from prices.json entries already backed
// by real data (never from other placeholders — that would let a guess feed the
// next guess and drift away from reality over successive runs).
function seedBaselineValues(prices) {
  const values = [];
  for (const entry of Object.values(prices)) {
    if (entry.estimateSource && entry.estimateSource !== 'placeholder' && entry.estimateSource !== 'insufficient-data') {
      if (typeof entry.rawBasePrice === 'number') values.push(entry.rawBasePrice);
    } else if (!entry.estimateSource && typeof entry.lowestPrice === 'number') {
      // Pre-existing entry from before this multi-source model — its lowestPrice
      // was real Discogs data (unlike a no-listings entry, which had lowestPrice == null).
      values.push(entry.lowestPrice);
    }
  }
  return values;
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

  const ebayCredentials = tryGetEbayCredentials();
  if (!ebayCredentials) {
    console.log('  (EBAY_CLIENT_ID/EBAY_CLIENT_SECRET not set — using Discogs-only signal; see .env.example)');
  }

  const baselineValues = seedBaselineValues(prices);

  let discogsToken = null;
  const counts = { 'discogs+ebay': 0, ebay: 0, discogs: 0, placeholder: 0, 'insufficient-data': 0 };
  let failed = 0;

  for (const record of targets) {
    const detail = details[record.id];
    try {
      let discogsLowest;
      let numForSale;
      if ('lowestPrice' in detail) {
        // Already captured alongside the release lookup in enrich-details — no API call needed.
        discogsLowest = detail.lowestPrice;
        numForSale = detail.numForSale ?? 0;
      } else {
        discogsToken = discogsToken || requireEnv('DISCOGS_TOKEN');
        ({ lowestPrice: discogsLowest, numForSale } = await fetchDiscogsStats(detail.discogsReleaseId, discogsToken));
      }

      let ebayAverage = null;
      let ebaySampleSize = 0;
      if (ebayCredentials) {
        try {
          ({ average: ebayAverage, sampleSize: ebaySampleSize } = await fetchEbayAverage(record, ebayCredentials));
        } catch (ebayErr) {
          console.error(`  ebay-warn ${record.artist} — ${record.album}: ${ebayErr.message}`);
        }
      }

      const condition = normalizeCondition(record.condition);
      const multiplier = multiplierFor(condition);

      let rawBasePrice = null;
      let estimateSource = null;
      if (ebayAverage != null && discogsLowest != null) {
        rawBasePrice = round2(ebayAverage * EBAY_WEIGHT + discogsLowest * DISCOGS_WEIGHT);
        estimateSource = 'discogs+ebay';
      } else if (ebayAverage != null) {
        rawBasePrice = ebayAverage;
        estimateSource = 'ebay';
      } else if (discogsLowest != null) {
        rawBasePrice = discogsLowest;
        estimateSource = 'discogs';
      }

      let estimatedValue;
      if (rawBasePrice != null) {
        estimatedValue = Math.max(0.01, round2(rawBasePrice * multiplier));
        baselineValues.push(rawBasePrice);
        counts[estimateSource] += 1;
        console.log(
          `  ok   ${record.artist} — ${record.album}: ${estimatedValue} ${CURRENCY} est. ` +
            `(${estimateSource}${condition ? `, ${condition} x${multiplier}` : ', no condition set — unadjusted'}` +
            `${ebaySampleSize ? `, eBay ${ebaySampleSize} listing(s)` : ''})`
        );
      } else if (baselineValues.length) {
        const baselineAverage = round2(baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length);
        rawBasePrice = baselineAverage;
        estimateSource = 'placeholder';
        estimatedValue = Math.max(0.01, round2(baselineAverage * multiplier));
        counts.placeholder += 1;
        console.log(
          `  none ${record.artist} — ${record.album}: no Discogs or eBay listings — ` +
            `collection-average placeholder ${estimatedValue} ${CURRENCY} (baseline ${baselineAverage} x${multiplier})`
        );
      } else {
        estimateSource = 'insufficient-data';
        estimatedValue = null;
        counts['insufficient-data'] += 1;
        console.log(
          `  none ${record.artist} — ${record.album}: no listings anywhere and no collection baseline yet — left unpriced`
        );
      }

      prices[record.id] = {
        lowestPrice: discogsLowest,
        currency: CURRENCY,
        numForSale: numForSale ?? 0,
        ebayAveragePrice: ebayAverage,
        ebaySampleSize,
        rawBasePrice,
        estimateSource,
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

  console.log(
    `Done. discogs+ebay ${counts['discogs+ebay']}, ebay-only ${counts.ebay}, discogs-only ${counts.discogs}, ` +
      `placeholder ${counts.placeholder}, insufficient-data ${counts['insufficient-data']}, failed ${failed}.`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
