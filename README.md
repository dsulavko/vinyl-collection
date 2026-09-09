# Vinyl Collection

A personal vinyl collection site: an iPod-style Cover Flow you spin through and click to see a record's detail card (tracklist, label/genre, notes, and an estimated resale value). Plain HTML/CSS/JS, no build step, no framework.

The [Google Sheet](https://docs.google.com/spreadsheets/d/1mkx_jgCgpAvn1G3dUjR6jq1xh1M6OcfsEt04ryokOUw) is the source of truth for the collection (artist, album, album release year, condition, catalog number). Everything else — description, tracklist, cover art, price — is enriched locally via Discogs and cached in `data/*.json`.

## Layout

```
index.html, css/style.css, js/app.js   the site
data/collection.json                    synced from the Sheet (id, artist, album, albumYear, condition, catalogNumber)
data/details.json                       Discogs tracklist/label/genre/notes, keyed by id
data/covers.json                        cover image paths, keyed by id
data/prices.json                        Discogs lowest listing + condition-adjusted estimate, keyed by id
assets/covers/                          downloaded cover images
scripts/                                the Node scripts each skill runs
.claude/skills/                         the 4 skills (see below)
```

Records are keyed by a stable `id` (slug of artist+album) so re-syncing the sheet never destroys enrichment work — each of the 4 data files is only ever touched by its own skill.

## Setup

1. **Discogs token** (needed for `enrich-details` and `estimate-price`): create a free account at discogs.com, then generate a personal access token at [discogs.com/settings/developers](https://www.discogs.com/settings/developers).
2. Copy `.env.example` to `.env` and set `DISCOGS_TOKEN=<your token>`. `.env` is gitignored — never commit it.
3. Requires Node 18+ (uses built-in `fetch`, no `npm install` needed).

## Running the skills

Run these manually from Claude Code whenever the collection changes — nothing runs automatically in the background.

- **`/sync-collection`** — pulls the latest Artist/Album/Year rows from the Sheet into `data/collection.json`. Run this first, whenever you edit the Sheet.
- **`/enrich-details`** — looks up each record on Discogs for tracklist, label, genre, country, notes → `data/details.json`. Run after syncing new records.
- **`/find-cover`** — downloads the Discogs cover image into `assets/covers/` → `data/covers.json`; falls back to a web image search for anything Discogs has no image for.
- **`/estimate-price`** — reads Discogs marketplace stats (lowest current listing + count for sale) → `data/prices.json`. Run after `enrich-details` (needs the Discogs release id).

Each script can also be run directly, e.g. `node scripts/enrich-details.mjs --only=ac-dc-back-in-black` to test on one record, or `--refresh` to redo everything.

**Note on price data**: Discogs' free API only exposes the lowest current marketplace listing and how many copies are for sale — not a median/high estimate or sold-price history. Treat it as "cheapest one on Discogs right now," not an appraisal.

## Viewing the site

No build step — just serve the directory (fetch() needs a real server, not `file://`):

```
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`.

**Controls**: drag the click wheel in a circle (or scroll / arrow keys) to spin through covers, click a cover to bring it to center, click again (or the wheel's center button, or Enter) to open its detail card. Esc closes the detail card.
