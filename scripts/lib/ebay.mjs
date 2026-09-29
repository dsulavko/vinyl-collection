const USER_AGENT = 'VinylCollectionSite/1.0 (+local personal use)';

// eBay app keys carry their environment right in the id (e.g.
// "Foo-Bar-SBX-xxxx" vs "...-PRD-xxxx"), so sandbox vs production can be
// detected from EBAY_CLIENT_ID alone rather than needing a separate env var —
// swapping in production keys later just works without a code change.
export function isSandboxClientId(clientId) {
  return /-SBX-/i.test(clientId ?? '');
}

function apiBase(sandbox) {
  return sandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

let cachedToken = null;
let cachedExpiresAt = 0;
let cachedSandbox = null;

// Client-credentials grant — app-level access, no eBay user login involved.
// Token lives ~2h; refetch a bit early rather than exactly at expiry.
export async function getAccessToken(clientId, clientSecret) {
  const sandbox = isSandboxClientId(clientId);
  if (cachedToken && cachedSandbox === sandbox && Date.now() < cachedExpiresAt - 60_000) return cachedToken;

  const base = apiBase(sandbox);
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${base}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    // Scope is a fixed identifier string, not a routable URL — it stays
    // "api.ebay.com" even when the token request itself goes to the sandbox host.
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  if (!res.ok) {
    throw new Error(`eBay OAuth token request failed (${res.status} ${res.statusText})`);
  }
  const json = await res.json();
  cachedToken = json.access_token;
  cachedSandbox = sandbox;
  cachedExpiresAt = Date.now() + json.expires_in * 1000;
  return cachedToken;
}

// Plain stopwords/noise words don't count as "significant" for relevance
// matching — otherwise "The Beatles" vs "Beatles" or a leading "A"/"An" in an
// album title would cause false rejections.
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'is', 'it', 'by', 'vinyl', 'lp', 'ep']);

function tokenize(text) {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Deliberately allows 2-char tokens (not just length > 2): band names like
// "AC/DC" or "U2" tokenize to "ac"/"dc"/"u2", and a length-3 floor would silently
// drop the artist check entirely for them, letting any title through unchecked.
function significantTokens(text) {
  return tokenize(text).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Cheap relevance guard: require the listing title to contain at least one
// significant word from the artist name AND one from the album title. Matches
// whole tokens (not substrings) so a short token like "ac" can't false-match
// inside an unrelated word like "back" — eBay's keyword search is fuzzy (OR-ish)
// without this, unrelated merch, CDs, or wrong-artist results with high
// fuzzy-relevance can pollute the average.
export function isRelevantListing(title, artist, album) {
  const titleTokens = new Set(tokenize(title));
  const artistTokens = significantTokens(artist);
  const albumTokens = significantTokens(album);
  const artistMatch = !artistTokens.length || artistTokens.some((t) => titleTokens.has(t));
  const albumMatch = !albumTokens.length || albumTokens.some((t) => titleTokens.has(t));
  return artistMatch && albumMatch;
}

// Merch/non-vinyl listings routinely contain the full artist+album name (that's
// the point of licensed merch) so they pass isRelevantListing, but they are a
// completely different product with unrelated pricing — a $60 Funko Pop set
// must not be averaged in with $15-40 vinyl copies of the same album. Phrases
// are checked as substrings (distinctive multi-word phrases, low false-positive
// risk); single ambiguous words are checked as whole tokens to avoid matching
// inside unrelated words (e.g. "cd" inside nothing, but avoid over-matching).
const MERCH_PHRASES = [
  'funko', 'action figure', 'figurine', 't-shirt', 'tshirt', 'hoodie', 'sweatshirt',
  'poster', 'sticker', 'patch', 'enamel pin', 'pin badge', 'keychain', 'keyring',
  'tote bag', 'backpack', 'phone case', 'trading card', 'board game', 'lunch box',
  'guitar pick', 'lanyard', 'greeting card', 'compact disc', 'blu-ray', 'blu ray',
];
const MERCH_WORDS = new Set(['cd', 'dvd', 'vhs', 'cap', 'mug', 'tee', 'wallet', 'socks', 'beanie', 'cassette', 'plush', 'coaster', 'magnet', 'jersey', 'puzzle']);

export function isMerchListing(title) {
  const titleLower = (title ?? '').toLowerCase();
  if (MERCH_PHRASES.some((p) => titleLower.includes(p))) return true;
  return tokenize(title).some((t) => MERCH_WORDS.has(t));
}

// Active/current listing prices matching a keyword query. eBay's Browse API only
// exposes current listings (asking prices) — there's no public sold-price-history
// endpoint outside eBay's invite-only partner program.
//
// filter=buyingOptions:{FIXED_PRICE} excludes auctions: an auction's price.value
// is its *current bid* (often a $0.99 opening bid), not a real asking price, and
// would otherwise drag the average toward near-zero outliers that the IQR filter
// can't fully absorb if there are several of them.
//
// limit=200 is the Browse API's documented max per page — pulling the largest
// sample available up front gives the IQR outlier rejection more to work with
// than the previous limit of 50.
export async function searchListingPrices(query, token, { artist, album, sandbox = false } = {}) {
  const params = new URLSearchParams({
    q: query,
    limit: '200',
    filter: 'buyingOptions:{FIXED_PRICE}',
  });
  const url = `${apiBase(sandbox)}/buy/browse/v1/item_summary/search?${params}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });
  if (!res.ok) {
    throw new Error(`eBay search failed (${res.status} ${res.statusText}): ${query}`);
  }
  const json = await res.json();
  const items = json.itemSummaries ?? [];
  const priced = items
    .map((item) => ({
      price: item.price?.value != null ? Number(item.price.value) : null,
      currency: item.price?.currency ?? null,
      title: item.title ?? null,
    }))
    .filter((item) => item.price != null && item.currency === 'USD' && !isMerchListing(item.title));
  if (!artist && !album) return priced;
  return priced.filter((item) => isRelevantListing(item.title, artist, album));
}
