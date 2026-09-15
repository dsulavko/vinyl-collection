---
name: estimate-price
description: Estimate resale value, preferring Discogs' real per-condition price_suggestions when available and falling back to a blend of Discogs' lowest marketplace listing and eBay's active-listing average, condition-adjusted using each record's "Состояние" grade from the sheet. Requires enrich-details to have already run (needs each record's Discogs release id).
---

# estimate-price

`enrich-details.mjs` already pulls `lowest_price`/`num_for_sale` off the Discogs release payload (that data rides along with the tracklist/label lookup, no extra request), and stores it in `data/details.json` as `lowestPrice`/`numForSale`. This script tries Discogs' `price_suggestions` endpoint first (real per-condition sold-listing data), falls back to blending Discogs-lowest with a live eBay Browse API search, and writes the result to `data/prices.json`.

## Why price_suggestions first

Discogs' `marketplace/price_suggestions/{release_id}` returns actual sold-listing-derived prices *per Goldmine grade* (Mint, Near Mint, VG+, VG, Good+, Good, Fair, Poor) — real market data for the exact condition a copy is in, not a heuristic. It's strictly better than any blend built from asking prices, but it's gated: the Discogs account behind `DISCOGS_TOKEN` must have its seller settings filled out (Sell Music → Settings in the Discogs UI), and even then a given release may not have enough sold history for every grade.

When it's unavailable for a release (or the grade isn't in the response), the script falls back to the older two-signal blend:

Discogs' free `stats`/release-payload API only exposes the *lowest current listing* for a release — the cheapest copy anyone's asking for right now, not an average. Using it alone means every estimate is anchored to a market floor. eBay's Browse API returns multiple concurrent active listings for a search, so it can produce an actual average across several asking prices — outlier-trimmed (IQR rejection) so one mispriced listing doesn't skew it. eBay's sold/completed-listings data is restricted to its invite-only partner program, so this fallback signal is still a *current asking price*, not a completed sale — flag that plainly when price_suggestions wasn't the source.

## The model

For each record with a Discogs release id:

1. **Discogs price_suggestions (preferred)** — fetch per-condition suggestions for the release, match the record's own normalized grade to the response's grade key (Sealed copies use the Mint figure — Discogs has no separate Sealed grade), use that value directly as the estimate. No multiplier needed; it's already condition-specific real data. Tagged `estimateSource: "discogs-price-suggestions"`.
2. **Fallback — Discogs lowest + eBay blend** (only when step 1 has no matching data):
   - **Discogs signal** — `lowestPrice` from `details.json` (or one `marketplace/stats` fallback call for older entries that predate that field).
   - **eBay signal** — search the Browse API for `"<artist> <album> vinyl"`, collect USD listing prices, average them with IQR-outlier rejection (plain mean under 4 data points).
   - **Blend**: both present → `70% eBay average + 30% Discogs lowest` (eBay weighted higher since it's a real average, Discogs kept as a floor-side cross-check). Only one present → use that one, tagged with its single source. Neither present → see "no listings anywhere" below.
   - **Condition adjustment**: the blended base price is multiplied by a heuristic grade multiplier, anchored at VG+ = 1.0, using the worse of the sheet's `sleeve/media` grades:

     | Grade | S | M | NM | VG+ | VG | G+ | G | F | P |
     |---|---|---|---|---|---|---|---|---|---|
     | Multiplier | 2.2 | 1.6 | 1.35 | 1.0 | 0.75 | 0.55 | 0.4 | 0.25 | 0.15 |

     Records with no `condition` set in the sheet get an unadjusted estimate (multiplier 1).

## No listings anywhere: no fabricated price

Earlier versions of this script floored any missing/tiny estimate to a flat $5 — indistinguishable from a real $5 estimate, and unrelated to the record's actual value. This version never writes a hardcoded constant:

- If a record has zero listings on both Discogs and eBay, its estimate is instead derived from **the rest of the collection's own condition-normalized average price** (from every other record's real Discogs/eBay data), scaled by *this* record's own condition multiplier, and tagged `estimateSource: "placeholder"` so it's clearly distinguishable from a real per-record estimate.
- Only in the (self-resolving) edge case where *no record in the whole collection* has real data yet is there nothing to derive a placeholder from — those records are left with `estimatedValue: null`, tagged `estimateSource: "insufficient-data"`, rather than guessing.
- `estimatedValue` is never `0` — real listing prices are never zero, and the placeholder path only ever multiplies a real average by a real condition multiplier.

`estimateSource` on every entry tells you exactly what backed the number: `discogs-price-suggestions`, `discogs+ebay`, `ebay`, `discogs`, `placeholder`, or `insufficient-data`.

## Prerequisites

- Records must already have a `discogsReleaseId` in `data/details.json` — run `/enrich-details` first for any that don't. This skill skips and reports records missing that field rather than guessing.
- `DISCOGS_TOKEN` in `.env` — needed on every run now, since `price_suggestions` is attempted for every record. For it to actually return data (rather than a 403 that triggers the fallback), the account behind that token needs seller settings filled out: on discogs.com, open the "Sell Music" menu (top nav) → Settings, and fill in the marketplace/shipping preferences. This is a one-time account setup step, not something this script or Claude can do on your behalf.
- `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` in `.env` — free app keys from [developer.ebay.com](https://developer.ebay.com) (create an app, use the production keyset, no user login/consent needed, it's a client-credentials app-token grant). **Optional**: without these the script logs a warning once and only uses eBay as part of the fallback, which still avoids the old flat-default behavior but loses the "average, not minimum" benefit of eBay's multiple listings for records without price_suggestions data.
- For a condition-adjusted estimate, the record needs `condition` filled in the sheet and `/sync-collection` re-run first. Without it, `price_suggestions` uses the VG+ figure and the fallback blend is unadjusted (multiplier 1).

## Steps

1. Sanity check on a couple of records first — this is the step that catches any eBay API response-shape drift, or confirms whether price_suggestions is actually unlocked for your account, before trusting a full run:
   ```
   node scripts/estimate-price.mjs --only=<id1>,<id2>
   ```
2. Full run:
   ```
   node scripts/estimate-price.mjs
   ```
3. Add `--refresh` to re-check prices for records that already have one (useful for periodically refreshing values since listings change over time, after filling in condition for previously-unadjusted records, after price_suggestions becomes newly available on the account, or to let `placeholder` estimates catch up as more real data accumulates in the collection).
4. Report to the user the breakdown from the script's summary line: how many got a `discogs-price-suggestions` estimate (the best-quality signal), how many fell back to `discogs+ebay`/`ebay`-only/`discogs`-only, how many got a collection-average `placeholder` (no listings anywhere), how many are `insufficient-data` (no baseline yet either), and how many were skipped for missing Discogs data. Make clear that `placeholder` values are not real per-record market data.
