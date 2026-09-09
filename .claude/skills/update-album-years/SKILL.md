---
name: update-album-years
description: Correct albumYear in data/collection.json using each record's Discogs master release (the true original release year), and write the correction back to the Google Sheet. Use when the user wants album years verified/fixed against Discogs, or notices a wrong year on a record.
---

# update-album-years

A record has two distinct years: `albumYear` (the album's first-ever release, meant
to be an authoritative fact about the album) and the specific pressing's own year
(`details.released`, already Discogs-matched via catalog number in `enrich-details`).
`albumYear` has so far been typed by hand into the sheet and can be wrong. Discogs'
**master release** (`/masters/{id}`) tracks the true original year separately from
any specific pressing — this script fetches that and corrects `albumYear` wherever it
differs, in both `data/collection.json` and the live Google Sheet.

## Prerequisites

- Records need a `discogsReleaseId` in `data/details.json` — run `/enrich-details`
  first for any that don't.
- `DISCOGS_TOKEN` in `.env`.
- One-time Apps Script setup, since this writes to the Sheet as the user's own
  Google account (via a script bound to the sheet, not a Google Cloud OAuth client):
  1. Open the Sheet -> Extensions -> Apps Script. Replace the default `Code.gs`
     contents with `scripts/apps-script/Code.gs` from this repo.
  2. In the Apps Script editor: Project Settings -> Script Properties -> add
     `SECRET` = a random string (e.g. `openssl rand -hex 24`). Put the same value
     into `.env` as `APPS_SCRIPT_SECRET`.
  3. Deploy -> New deployment -> type **Web app** -> Execute as "Me", Who has
     access "Anyone". Copy the deployment URL into `.env` as `APPS_SCRIPT_URL`.
  4. Only needs to be redone if the deployment is deleted or the secret changes.

## Steps

1. Sanity check on a couple of records first:
   ```
   node scripts/update-album-years.mjs --only=<id1>,<id2>
   ```
2. Full run:
   ```
   node scripts/update-album-years.mjs
   ```
3. Add `--refresh` to re-fetch master info even for records that already have a
   cached `masterYear` in `details.json` (useful if Discogs data changed, or a
   record's matched release was corrected via `enrich-details --force-release=`).
4. The script writes `data/collection.json` immediately after determining all
   changes, then attempts the Sheet write-back as a separate step — so a Sheet
   write failure (auth expired, network) never leaves the JSON un-updated. If a
   changed record's artist+album can't be uniquely matched to a sheet row, that
   one write is skipped and reported (the JSON change still stands).
5. Report to the user: how many records were checked, how many years were
   corrected (and what they changed from/to), how many records have no Discogs
   master (nothing to compare against), and any failures.
