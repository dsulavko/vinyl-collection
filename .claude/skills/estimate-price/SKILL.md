---
name: estimate-price
description: Estimate resale value from a blend of Discogs' lowest marketplace listing and eBay's active-listing average, condition-adjusted using each record's "Состояние" grade from the sheet. Requires enrich-details to have already run (needs each record's Discogs release id).
---

# estimate-price

`enrich-details.mjs` already pulls `lowest_price`/`num_for_sale` off the Discogs release payload (that data rides along with the tracklist/label lookup, no extra request), and stores it in `data/details.json` as `lowestPrice`/`numForSale`. This script reuses that, adds a live eBay Browse API search per record, blends the two, and writes the result to `data/prices.json`.

## Why two sources

Discogs' free API only exposes the *lowest current listing* for a release — the cheapest copy anyone's asking for right now, not an average. Using it alone means every estimate is anchored to a market floor. eBay's Browse API returns multiple concurrent active listings for a search, so it can produce an actual average across several asking prices — outlier-trimmed (IQR rejection) so one mispriced listing doesn't skew it.

Neither API exposes real sold-price history for free: Discogs' per-condition `price_suggestions` endpoint needs the token holder to have filled out seller settings (not set up here); eBay's sold/completed-listings data is restricted to its invite-only partner program. So both signals are *current asking prices*, not completed sales — **this is a rough estimate, not real market data or an appraisal**, say so plainly when reporting results.

## The model

For each record with a Discogs release id:

1. **Discogs signal** — `lowestPrice` from `details.json` (or one `marketplace/stats` fallback call for older entries that predate that field).
2. **eBay signal** — search the Browse API for `"<artist> <album> vinyl"`, collect USD listing prices, average them with IQR-outlier rejection (plain mean under 4 data points).
3. **Blend**: both present → `70% eBay average + 30% Discogs lowest` (eBay weighted higher since it's a real average, Discogs kept as a floor-side cross-check). Only one present → use that one, tagged with its single source. Neither present → see "no listings anywhere" below.
4. **Condition adjustment**: the blended base price is multiplied by a heuristic grade multiplier, anchored at VG+ = 1.0, using the worse of the sheet's `sleeve/media` grades:

   | Grade | S | M | NM | VG+ | VG | G+ | G | F | P |
   |---|---|---|---|---|---|---|---|---|---|
   | Multiplier | 2.2 | 1.6 | 1.35 | 1.0 | 0.75 | 0.55 | 0.4 | 0.25 | 0.15 |

   Records with no `condition` set in the sheet get an unadjusted estimate (multiplier 1).

## No listings anywhere: no fabricated price

Earlier versions of this script floored any missing/tiny estimate to a flat $5 — indistinguishable from a real $5 estimate, and unrelated to the record's actual value. This version never writes a hardcoded constant:

- If a record has zero listings on both Discogs and eBay, its estimate is instead derived from **the rest of the collection's own condition-normalized average price** (from every other record's real Discogs/eBay data), scaled by *this* record's own condition multiplier, and tagged `estimateSource: "placeholder"` so it's clearly distinguishable from a real per-record estimate.
- Only in the (self-resolving) edge case where *no record in the whole collection* has real data yet is there nothing to derive a placeholder from — those records are left with `estimatedValue: null`, tagged `estimateSource: "insufficient-data"`, rather than guessing.
- `estimatedValue` is never `0` — real listing prices are never zero, and the placeholder path only ever multiplies a real average by a real condition multiplier.

`estimateSource` on every entry tells you exactly what backed the number: `discogs+ebay`, `ebay`, `discogs`, `placeholder`, or `insufficient-data`.

## Prerequisites

- Records must already have a `discogsReleaseId` in `data/details.json` — run `/enrich-details` first for any that don't. This skill skips and reports records missing that field rather than guessing.
- `DISCOGS_TOKEN` in `.env` is only needed for the fallback path (pre-existing entries missing `lowestPrice`).
- `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` in `.env` — free app keys from [developer.ebay.com](https://developer.ebay.com) (create an app, use the production keyset, no user login/consent needed, it's a client-credentials app-token grant). **Optional**: without these the script logs a warning once and falls back to Discogs-only, which still avoids the old flat-default behavior but loses the "average, not minimum" benefit of eBay's multiple listings.
- For a condition-adjusted estimate, the record needs `condition` filled in the sheet and `/sync-collection` re-run first. Without it, the estimate is the unadjusted blended base price.

## Steps

1. Sanity check on a couple of records first — this is the step that catches any eBay API response-shape drift before trusting a full run:
   ```
   node scripts/estimate-price.mjs --only=<id1>,<id2>
   ```
2. Full run:
   ```
   node scripts/estimate-price.mjs
   ```
3. Add `--refresh` to re-check prices for records that already have one (useful for periodically refreshing values since listings change over time, after filling in condition for previously-unadjusted records, or to let `placeholder` estimates catch up as more real data accumulates in the collection).
4. Report to the user the breakdown from the script's summary line: how many got a `discogs+ebay`/`ebay`-only/`discogs`-only estimate, how many got a collection-average `placeholder` (no listings anywhere), how many are `insufficient-data` (no baseline yet either), and how many were skipped for missing Discogs data. Make clear that `placeholder` values are not real per-record market data.
