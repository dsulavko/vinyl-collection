---
name: find-cover
description: Download cover art for records into assets/covers/ and record it in data/covers.json. Run after enrich-details so Discogs release images are available; falls back to a web image search for records Discogs has no image for.
---

# find-cover

Primary source is the Discogs release images already captured by `enrich-details` in `data/details.json` (`details[id].images`). This skill only handles downloading/saving; it does not call Discogs' search API itself.

## Steps

1. Run the bulk pass first — this handles every record that already has a Discogs image:
   ```
   node scripts/find-cover.mjs
   ```
   Add `--refresh` to re-download covers that already exist, or `--only=<id1>,<id2>` to limit to specific records.
2. The script prints `none` for any record with no Discogs image. For each of those, use the WebSearch tool yourself:
   - Search something like `"<artist> <album> vinyl album cover art"`.
   - Pick a plausible, reasonably high-resolution image URL (prefer Discogs, Wikipedia, or a record store listing over random blogs).
   - Save it by running:
     ```
     node scripts/find-cover.mjs --id=<id> --url=<image-url>
     ```
   - Do this one record at a time — you're making a judgment call on image quality/correctness that the script can't make.
3. Report to the user how many covers were saved automatically vs. required the web-search fallback, and list any records still without a cover.
