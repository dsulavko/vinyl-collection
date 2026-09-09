---
name: estimate-price
description: Fold Discogs marketplace listing stats (already fetched by enrich-details) into data/prices.json. Requires enrich-details to have already run (needs each record's Discogs release id).
---

# estimate-price

`enrich-details.mjs` already pulls `lowest_price`/`num_for_sale` off the release payload (that data rides along with the tracklist/label lookup, no extra request), and stores it in `data/details.json` as `lowestPrice`/`numForSale`. This script just copies those into `data/prices.json` — no API calls, no rate limiting, runs instantly. Older `details.json` entries enriched before this existed don't have those fields yet; for those, this script falls back to one `marketplace/stats` API call per record (needs `DISCOGS_TOKEN`).

**Scope note for the user**: Discogs' free API only exposes the *lowest current listing* and *number for sale* for a release — not a median/high price or historical sold-price data (those require owning the item in a Discogs collection or paid access). This is a "what's the cheapest one on Discogs right now" estimate, not an appraisal. Set that expectation when reporting results.

## Prerequisites

- Records must already have a `discogsReleaseId` in `data/details.json` — run `/enrich-details` first for any that don't. This skill skips and reports records missing that field rather than guessing.
- `DISCOGS_TOKEN` in `.env` is only needed for the fallback path (pre-existing entries missing `lowestPrice`).

## Steps

1. Sanity check on a couple of records first:
   ```
   node scripts/estimate-price.mjs --only=<id1>,<id2>
   ```
2. Full run:
   ```
   node scripts/estimate-price.mjs
   ```
3. Add `--refresh` to re-check prices for records that already have one (useful for periodically refreshing values since listings change over time).
4. Report to the user how many got a price, how many had no current listings, and how many were skipped for missing Discogs data.
