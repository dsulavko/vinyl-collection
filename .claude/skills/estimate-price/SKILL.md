---
name: estimate-price
description: Fold Discogs marketplace listing stats (already fetched by enrich-details) into data/prices.json, condition-adjusted using each record's "Состояние" grade from the sheet. Requires enrich-details to have already run (needs each record's Discogs release id).
---

# estimate-price

`enrich-details.mjs` already pulls `lowest_price`/`num_for_sale` off the release payload (that data rides along with the tracklist/label lookup, no extra request), and stores it in `data/details.json` as `lowestPrice`/`numForSale`. This script copies those into `data/prices.json` — no API calls, no rate limiting, runs instantly for records already enriched. Older `details.json` entries enriched before this existed don't have those fields yet; for those, this script falls back to one `marketplace/stats` API call per record (needs `DISCOGS_TOKEN`).

**Scope note for the user**: Discogs' free API only exposes the *lowest current listing* and *number for sale* for a release — not a median/high price or historical sold-price data. There is also a `price_suggestions` endpoint that returns real per-condition pricing, but it requires the token holder to have filled out Discogs seller settings (discogs.com/settings/marketplace) — not set up here, so it's not used.

Instead, this script applies a documented heuristic multiplier to the lowest listing, based on each record's `condition` field (synced from the sheet's "Состояние" column, format `sleeve/media` e.g. `VG+/VG+` — the worse of the two grades is used), anchored at VG+ = 1.0:

| Grade | S | M | NM | VG+ | VG | G+ | G | F | P |
|---|---|---|---|---|---|---|---|---|---|
| Multiplier | 2.2 | 1.6 | 1.35 | 1.0 | 0.75 | 0.55 | 0.4 | 0.25 | 0.15 |

**This is a rough estimate, not real market data or an appraisal** — say so plainly when reporting results. Records with no `condition` set in the sheet get an unadjusted estimate (`estimatedValue == lowestPrice`), same as before this multiplier existed.

`estimatedValue` is floored at $5 (`MIN_ESTIMATE` in the script) — records with no current Discogs listings, or whose computed estimate would fall below that, get $5 rather than a null/unrealistically-low value.

## Prerequisites

- Records must already have a `discogsReleaseId` in `data/details.json` — run `/enrich-details` first for any that don't. This skill skips and reports records missing that field rather than guessing.
- `DISCOGS_TOKEN` in `.env` is only needed for the fallback path (pre-existing entries missing `lowestPrice`).
- For a condition-adjusted estimate, the record needs `condition` filled in the sheet and `/sync-collection` re-run first. Without it, the estimate is just the raw lowest listing (unadjusted).

## Steps

1. Sanity check on a couple of records first:
   ```
   node scripts/estimate-price.mjs --only=<id1>,<id2>
   ```
2. Full run:
   ```
   node scripts/estimate-price.mjs
   ```
3. Add `--refresh` to re-check prices for records that already have one (useful for periodically refreshing values since listings change over time, or after filling in condition for previously-unadjusted records).
4. Report to the user how many got a price (and how many of those were condition-adjusted vs. unadjusted), how many had no current listings, and how many were skipped for missing Discogs data.
