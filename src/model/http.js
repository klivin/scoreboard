export const DEFAULT_HEADERS = {
  'User-Agent': 'Scoreboard/1.0 (public market data; no keys)',
  Accept: 'application/json, text/html;q=0.9,*/*;q=0.8'
};

/** Browser-like headers for hosts that challenge datacenter UAs (Stooq, Yahoo crumb). */
export const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'application/json,text/csv;q=0.9,text/html;q=0.8,*/*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9'
};

export function createCookieJar(seed = '') {
  const map = new Map();
  const store = {
    addFromSetCookie(lines) {
      for (const line of lines || []) {
        const pair = String(line || '').split(';')[0];
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (name) map.set(name, value);
      }
    },
    header() {
      return [...map.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    },
    toString() {
      return store.header();
    }
  };
  if (seed) {
    for (const part of String(seed).split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }
  return store;
}

function readSetCookie(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  if (typeof headers.raw === 'function') {
    const raw = headers.raw();
    if (raw && Array.isArray(raw['set-cookie'])) return raw['set-cookie'];
  }
  const single = headers.get && headers.get('set-cookie');
  return single ? [single] : [];
}

export async function httpGet(url, {
  fetchImpl = globalThis.fetch,
  headers = {},
  cookieJar = null
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available');
  }

  const requestHeaders = { ...DEFAULT_HEADERS, ...headers };
  if (cookieJar) {
    const cookie = cookieJar.header();
    if (cookie) requestHeaders.Cookie = cookie;
  }

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: requestHeaders
  });

  if (cookieJar && response && response.headers) {
    cookieJar.addFromSetCookie(readSetCookie(response.headers));
  }

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    text,
    url,
    headers: response.headers || null
  };
}

export function parseJsonBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
