---
name: enrich-details
description: Fetch tracklist, label, genre, country, and notes for records from Discogs and store them in data/details.json. Use after sync-collection has added new records, or when the user wants richer detail-card content for records that show "not enriched yet".
---

# enrich-details

Looks up each record on Discogs and writes structured release data (tracklist, label, genres, styles, country, notes, the Discogs release id/URL used later by `find-cover`, and `lowestPrice`/`numForSale` used by `estimate-price`) into `data/details.json`, keyed by record id.

If a record has a `catalogNumber` (from the sheet's "Каталог №" column), the script tries an exact Discogs `catno`/`barcode` search first — this matches the user's actual physical pressing rather than a best guess from fuzzy artist/title search, so it also fixes records that fuzzy search couldn't find (typos, generic titles). Falls back to artist/title text search if there's no catalog number or it finds nothing. Each `details.json` entry records `matchedBy: "catno" | "barcode" | "text"` so misses/quality can be told apart later.

## Prerequisites

Requires `DISCOGS_TOKEN` in `.env` at the repo root. If missing, guide the user to:
1. Create a free Discogs account at discogs.com if they don't have one.
2. Go to discogs.com/settings/developers and generate a personal access token.
3. Copy `.env.example` to `.env` and set `DISCOGS_TOKEN=<their token>`.

## Steps

1. If this is the first run, or the user wants to sanity-check before a big batch, run on a couple of known records first:
   ```
   node scripts/enrich-details.mjs --only=<id1>,<id2>
   ```
   (ids are the `id` field in `data/collection.json`, e.g. `ac-dc-back-in-black`). Show the user the resulting entries in `data/details.json` before continuing.
2. For the full run (only fills in records missing from `details.json`):
   ```
   node scripts/enrich-details.mjs
   ```
3. To force re-fetching everything (e.g. Discogs matched the wrong release), add `--refresh`.
4. The script writes to disk after every record, is safe to interrupt (Ctrl+C) and re-run, and rate-limits itself (~1 request/sec) to stay under Discogs' authenticated limit. A full run over ~110 records takes a few minutes — mention this to the user before kicking off a big batch.
5. Report how many records were enriched vs. missing/failed. For misses, Discogs likely doesn't have a vinyl release matching that artist/album/year closely enough — mention the user can retry with a more specific album title in the sheet, or that `find-cover`'s web-search fallback can still be used even without a Discogs match.
