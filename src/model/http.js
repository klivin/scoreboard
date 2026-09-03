const DEFAULT_HEADERS = {
  'User-Agent': 'Scoreboard/1.0 (public market data; no keys)',
  Accept: 'application/json, text/html;q=0.9,*/*;q=0.8'
};

export async function httpGet(url, { fetchImpl = globalThis.fetch, headers = {} } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available');
  }

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { ...DEFAULT_HEADERS, ...headers }
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    text,
    url
  };
}

export function parseJsonBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
