---
name: sync-collection
description: Pull the latest Artist/Album/Year rows from the Google Sheet (the primary data source) into data/collection.json. Use whenever the user adds/edits/removes records in the sheet and wants the site to reflect it.
---

# sync-collection

Re-syncs `data/collection.json` from the public Google Sheet (read-only source of truth for artist/album/year, plus an optional per-record catalog number from the "Каталог №" column). Never touches `data/details.json`, `data/covers.json`, or `data/prices.json` — those are keyed by stable id and untouched by re-syncing, so enrichment work is never lost.

## Steps

1. Run:
   ```
   node scripts/sync-collection.mjs
   ```
2. Report the printed added/removed/changed summary to the user in plain language.
3. If any records were added, tell the user they can run `/enrich-details`, `/find-cover`, and `/estimate-price` next to fill in the new records' detail card, cover, and price.
4. If any records were removed, mention that their old `details.json`/`covers.json`/`prices.json` entries are now orphaned (harmless, but can be cleaned up later if desired — not done automatically).
