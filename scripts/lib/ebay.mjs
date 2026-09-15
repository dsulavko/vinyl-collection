const USER_AGENT = 'VinylCollectionSite/1.0 (+local personal use)';

let cachedToken = null;
let cachedExpiresAt = 0;

// Client-credentials grant — app-level access, no eBay user login involved.
// Token lives ~2h; refetch a bit early rather than exactly at expiry.
export async function getAccessToken(clientId, clientSecret) {
  if (cachedToken && Date.now() < cachedExpiresAt - 60_000) return cachedToken;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  if (!res.ok) {
    throw new Error(`eBay OAuth token request failed (${res.status} ${res.statusText})`);
  }
  const json = await res.json();
  cachedToken = json.access_token;
  cachedExpiresAt = Date.now() + json.expires_in * 1000;
  return cachedToken;
}

// Active/current listing prices matching a keyword query. eBay's Browse API only
// exposes current listings (asking prices) — there's no public sold-price-history
// endpoint outside eBay's invite-only partner program.
export async function searchListingPrices(query, token) {
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=50`;
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
  return items
    .map((item) => ({
      price: item.price?.value != null ? Number(item.price.value) : null,
      currency: item.price?.currency ?? null,
      title: item.title ?? null,
    }))
    .filter((item) => item.price != null && item.currency === 'USD');
}
