const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

const CYRILLIC_TO_LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ў: 'u',
};

export function transliterate(text) {
  return text.replace(/[а-яёіў]/gi, (ch) => {
    const lower = ch.toLowerCase();
    const mapped = CYRILLIC_TO_LATIN[lower];
    return mapped === undefined ? ch : mapped;
  });
}

function slugify(text) {
  return transliterate(text)
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
