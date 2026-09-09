const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function makeId(artist, album, existingIds, year) {
  const base = slugify(`${artist}-${album}`);
  if (!existingIds.has(base)) return base;
  const withYear = `${base}-${year}`;
  if (!existingIds.has(withYear)) return withYear;
  let n = 2;
  while (existingIds.has(`${withYear}-${n}`)) n += 1;
  return `${withYear}-${n}`;
}
