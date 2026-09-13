import { httpGet, parseJsonBody } from './http.js';
import { intervalMs } from './source-adapter.js';
import { normalizeTicker } from './ticker.js';
import { createOkxCandleAdapter, isOkxInstrumentError } from './okx-adapter.js';

export const CRYPTO_ADAPTER_ID = 'crypto-candles';
export const COINGECKO_OHLC_SOURCE = 'coingecko-ohlc';
export const BINANCE_KLINES_SOURCE = 'binance-klines';
export const OKX_CANDLES_SOURCE = 'okx-candles';

export const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
export const BINANCE_KLINES_HOSTS = [
  'https://api.binance.com',
  'https://data-api.binance.vision'
];

/** Known CoinGecko ids when search is rate-limited. Not an allowlist — search still runs. */
export const COINGECKO_ID_HINTS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  HYPE: 'hyperliquid',
  BNB: 'binancecoin',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  SUI: 'sui',
  PEPE: 'pepe',
  SHIB: 'shiba-inu'
};

const DEFAULT_LIMIT = 100;

function numeric(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatUtc(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function dateUtc(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function normalizeCryptoRow(raw, { symbol, interval, source } = {}) {
  const ts = numeric(raw && (raw.timestamp || raw.ts_ms || raw.ts));
  if (!Number.isFinite(ts)) return null;
  const open = numeric(raw.open);
  const high = numeric(raw.high);
  const low = numeric(raw.low);
  const close = numeric(raw.close);
  if (!Number.isFinite(close)) return null;
  return {
    source,
    symbol: String(symbol || '').toUpperCase(),
    interval,
    timestamp: ts,
    ts_ms: ts,
    datetime_utc: formatUtc(ts),
    date_utc: dateUtc(ts),
    open: Number.isFinite(open) ? open : null,
    high: Number.isFinite(high) ? high : null,
    low: Number.isFinite(low) ? low : null,
    close,
    volume: numeric(raw.volume)
  };
}

export function parseCoinGeckoOhlc(body, { symbol, interval } = {}) {
  const list = Array.isArray(body) ? body : [];
  const rows = [];
  for (const item of list) {
    if (!Array.isArray(item) || item.length < 5) continue;
    const row = normalizeCryptoRow({
      timestamp: item[0],
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4]
    }, { symbol, interval, source: COINGECKO_OHLC_SOURCE });
    if (row) rows.push(row);
  }
  return {
    rows,
    error: rows.length ? null : 'CoinGecko OHLC returned zero finite closes'
  };
}

/**
 * market_chart prices are [ts, price] only. Do not invent OHLC — close-only
 * rows are kept with open/high/low null.
 */
export function parseCoinGeckoMarketChart(body, { symbol, interval } = {}) {
  const prices = body && Array.isArray(body.prices) ? body.prices : [];
  const volumes = body && Array.isArray(body.total_volumes) ? body.total_volumes : [];
  const volByTs = new Map();
  for (const pair of volumes) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    volByTs.set(Number(pair[0]), pair[1]);
  }
  const rows = [];
  for (const pair of prices) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const ts = numeric(pair[0]);
    const close = numeric(pair[1]);
    if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
    rows.push(normalizeCryptoRow({
      timestamp: ts,
      open: null,
      high: null,
      low: null,
      close,
      volume: volByTs.get(ts)
    }, { symbol, interval, source: COINGECKO_OHLC_SOURCE }));
  }
  return {
    rows: rows.filter(Boolean),
    error: rows.length ? null : 'CoinGecko market_chart returned zero finite prices'
  };
}

export function parseBinanceKlines(body, { symbol, interval } = {}) {
  const list = Array.isArray(body) ? body : [];
  const rows = [];
  for (const item of list) {
    if (!Array.isArray(item) || item.length < 6) continue;
    const row = normalizeCryptoRow({
      timestamp: item[0],
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4],
      volume: item[5]
    }, { symbol, interval, source: BINANCE_KLINES_SOURCE });
    if (row) rows.push(row);
  }
  return {
    rows,
    error: rows.length ? null : 'Binance klines returned zero finite closes'
  };
}

export function buildCoinGeckoSearchUrl(symbol) {
  return `${COINGECKO_BASE}/search?query=${encodeURIComponent(String(symbol || ''))}`;
}

export function buildCoinGeckoOhlcUrl(coinId, { interval = '1d', days = null } = {}) {
  const span = days || (interval === '1h' ? '30' : 'max');
  return `${COINGECKO_BASE}/coins/${encodeURIComponent(coinId)}/ohlc?vs_currency=usd&days=${span}`;
}

export function buildCoinGeckoMarketChartUrl(coinId, { interval = '1d', days = null } = {}) {
  const span = days || (interval === '1h' ? '90' : '365');
  const params = new URLSearchParams({
    vs_currency: 'usd',
    days: String(span)
  });
  if (interval === '1h') params.set('interval', 'hourly');
  return `${COINGECKO_BASE}/coins/${encodeURIComponent(coinId)}/market_chart?${params.toString()}`;
}

export function buildBinanceKlinesUrl({
  symbol,
  interval = '1d',
  since = null,
  limit = 1000,
  host = BINANCE_KLINES_HOSTS[0]
} = {}) {
  const pair = `${String(symbol || '').toUpperCase()}USDT`;
  const params = new URLSearchParams({
    symbol: pair,
    interval: interval === '1h' ? '1h' : '1d',
    limit: String(limit)
  });
  if (since != null && Number.isFinite(Number(since))) {
    params.set('startTime', String(Math.max(0, Math.floor(Number(since)))));
  }
  return `${host}/api/v3/klines?${params.toString()}`;
}

export function pickCoinGeckoId(searchBody, symbol) {
  const upper = String(symbol || '').toUpperCase();
  const coins = searchBody && Array.isArray(searchBody.coins) ? searchBody.coins : [];
  const exact = coins.find((coin) => String(coin.symbol || '').toUpperCase() === upper);
  if (exact && exact.id) return exact.id;
  if (COINGECKO_ID_HINTS[upper]) {
    const hinted = coins.find((coin) => coin.id === COINGECKO_ID_HINTS[upper]);
    if (hinted) return hinted.id;
    return COINGECKO_ID_HINTS[upper];
  }
  return null;
}

export async function resolveCoinGeckoId(symbol, http = httpGet) {
  const upper = String(symbol || '').toUpperCase();
  const url = buildCoinGeckoSearchUrl(upper);
  try {
    const response = await http(url);
    if (response.ok) {
      const body = parseJsonBody(response.text);
      const id = pickCoinGeckoId(body, upper);
      if (id) return { id, url, source: 'search' };
    }
  } catch {
    // fall through to hint
  }
  if (COINGECKO_ID_HINTS[upper]) {
    return { id: COINGECKO_ID_HINTS[upper], url, source: 'hint' };
  }
  return { id: null, url, source: null };
}

async function fetchCoinGeckoCandles({
  symbol,
  interval,
  since,
  http
}) {
  const requestUrls = [];
  const resolved = await resolveCoinGeckoId(symbol, http);
  if (resolved.url) requestUrls.push(resolved.url);
  if (!resolved.id) {
    return {
      rows: [],
      requestUrls,
      missing: true,
      filledSource: null,
      source: COINGECKO_OHLC_SOURCE,
      error: `CoinGecko has no coin id for ${symbol}`
    };
  }

  const ohlcUrl = buildCoinGeckoOhlcUrl(resolved.id, { interval });
  requestUrls.push(ohlcUrl);
  try {
    const response = await http(ohlcUrl);
    if (response.status === 429) {
      return {
        rows: [],
        requestUrls,
        missing: true,
        filledSource: null,
        source: COINGECKO_OHLC_SOURCE,
        error: 'CoinGecko 429 rate limit'
      };
    }
    if (response.ok) {
      const parsed = parseCoinGeckoOhlc(parseJsonBody(response.text), { symbol, interval });
      const rows = (parsed.rows || []).filter((row) => since == null || row.timestamp >= since);
      if (rows.length) {
        return {
          rows,
          requestUrls,
          missing: false,
          filledSource: 'coingecko',
          source: COINGECKO_OHLC_SOURCE,
          coinId: resolved.id
        };
      }
    }
  } catch (error) {
    // try market_chart next — still no invented OHLC
  }

  const chartUrl = buildCoinGeckoMarketChartUrl(resolved.id, { interval });
  requestUrls.push(chartUrl);
  try {
    const response = await http(chartUrl);
    if (response.ok) {
      const parsed = parseCoinGeckoMarketChart(parseJsonBody(response.text), { symbol, interval });
      const rows = (parsed.rows || []).filter((row) => since == null || row.timestamp >= since);
      if (rows.length) {
        return {
          rows,
          requestUrls,
          missing: false,
          filledSource: 'coingecko',
          source: COINGECKO_OHLC_SOURCE,
          coinId: resolved.id,
          note: 'CoinGecko market_chart is close-only; open/high/low stay missing (not invented).'
        };
      }
    }
  } catch (error) {
    return {
      rows: [],
      requestUrls,
      missing: true,
      filledSource: null,
      source: COINGECKO_OHLC_SOURCE,
      error: error.message || 'CoinGecko market_chart failed'
    };
  }

  return {
    rows: [],
    requestUrls,
    missing: true,
    filledSource: null,
    source: COINGECKO_OHLC_SOURCE,
    error: `No CoinGecko candles for ${symbol} ${interval}`
  };
}

async function fetchBinanceCandles({
  symbol,
  interval,
  since,
  http
}) {
  const requestUrls = [];
  let lastError = null;
  for (const host of BINANCE_KLINES_HOSTS) {
    const url = buildBinanceKlinesUrl({ symbol, interval, since, host });
    requestUrls.push(url);
    try {
      const response = await http(url);
      if (!response.ok) {
        lastError = `Binance HTTP ${response.status}`;
        continue;
      }
      const parsed = parseBinanceKlines(parseJsonBody(response.text), { symbol, interval });
      const rows = (parsed.rows || []).filter((row) => since == null || row.timestamp >= since);
      if (rows.length) {
        return {
          rows,
          requestUrls,
          missing: false,
          filledSource: 'binance',
          source: BINANCE_KLINES_SOURCE
        };
      }
      lastError = parsed.error;
    } catch (error) {
      lastError = error.message || String(error);
    }
  }
  return {
    rows: [],
    requestUrls,
    missing: true,
    filledSource: null,
    source: BINANCE_KLINES_SOURCE,
    error: lastError || `No Binance klines for ${symbol}USDT`
  };
}

export function createCoinGeckoOhlcAdapter({
  symbol = '',
  interval = '1d',
  httpGet: http = httpGet
} = {}) {
  const parsed = normalizeTicker(symbol);
  const upper = parsed.symbol || String(symbol || '').toUpperCase();
  return {
    id: COINGECKO_OHLC_SOURCE,
    symbol: upper,
    interval,
    mode: 'incremental',
    async fetchSince(cursor) {
      const since = cursor && cursor.since != null ? cursor.since : null;
      const result = await fetchCoinGeckoCandles({ symbol: upper, interval, since, http });
      const nextTs = (result.rows || []).reduce(
        (max, row) => (row.timestamp > max ? row.timestamp : max),
        since
      );
      return {
        ...result,
        nextCursor: result.rows && result.rows.length && nextTs != null
          ? { lastTimestamp: nextTs }
          : null,
        requestedSince: since
      };
    }
  };
}

export function createBinanceKlineAdapter({
  symbol = '',
  interval = '1d',
  httpGet: http = httpGet
} = {}) {
  const parsed = normalizeTicker(symbol);
  const upper = parsed.symbol || String(symbol || '').toUpperCase();
  return {
    id: BINANCE_KLINES_SOURCE,
    symbol: upper,
    interval,
    mode: 'incremental',
    async fetchSince(cursor) {
      const since = cursor && cursor.since != null ? cursor.since : null;
      const result = await fetchBinanceCandles({ symbol: upper, interval, since, http });
      const nextTs = (result.rows || []).reduce(
        (max, row) => (row.timestamp > max ? row.timestamp : max),
        since
      );
      return {
        ...result,
        nextCursor: result.rows && result.rows.length && nextTs != null
          ? { lastTimestamp: nextTs }
          : null,
        requestedSince: since
      };
    }
  };
}

/**
 * Crypto candles: OKX spot/swap → CoinGecko OHLC / market_chart → Binance public.
 * Reports which source filled. Never invents OHLC.
 */
export function createCryptoCandleAdapter({
  symbol = '',
  interval = '1d',
  httpGet: http = httpGet,
  limit = DEFAULT_LIMIT,
  maxPages = 3
} = {}) {
  const parsed = normalizeTicker(symbol);
  const upper = parsed.symbol || String(symbol || '').toUpperCase();
  const okx = createOkxCandleAdapter({
    symbol: upper,
    interval,
    httpGet: http,
    limit,
    maxPages
  });

  return {
    id: CRYPTO_ADAPTER_ID,
    symbol: upper,
    interval,
    mode: 'incremental',
    instId: okx.instId,
    async fetchSince(cursor) {
      const since = cursor && cursor.since != null ? cursor.since : null;
      const requestUrls = [];
      const errors = [];

      try {
        const okxResult = await okx.fetchSince(cursor);
        requestUrls.push(...(okxResult.requestUrls || []));
        if (okxResult.rows && okxResult.rows.length) {
          return {
            ...okxResult,
            requestUrls,
            filledSource: 'okx',
            source: OKX_CANDLES_SOURCE,
            instId: okxResult.instId || okx.instId
          };
        }
        errors.push(okxResult.note || okxResult.error || 'OKX returned no rows');
      } catch (error) {
        errors.push(error.message || String(error));
        if (!isOkxInstrumentError(error) && /key|secret|passphrase/i.test(error.message || '')) {
          throw error;
        }
      }

      const cg = await fetchCoinGeckoCandles({ symbol: upper, interval, since, http });
      requestUrls.push(...(cg.requestUrls || []));
      if (cg.rows && cg.rows.length) {
        const nextTs = cg.rows.reduce((max, row) => (row.timestamp > max ? row.timestamp : max), since);
        return {
          rows: cg.rows,
          nextCursor: nextTs != null ? { lastTimestamp: nextTs } : null,
          requestUrls,
          requestedSince: since,
          missing: false,
          filledSource: 'coingecko',
          source: COINGECKO_OHLC_SOURCE,
          coinId: cg.coinId,
          note: cg.note || 'Filled from CoinGecko public OHLC (no key).'
        };
      }
      if (cg.error) errors.push(cg.error);

      const binance = await fetchBinanceCandles({ symbol: upper, interval, since, http });
      requestUrls.push(...(binance.requestUrls || []));
      if (binance.rows && binance.rows.length) {
        const nextTs = binance.rows.reduce((max, row) => (row.timestamp > max ? row.timestamp : max), since);
        return {
          rows: binance.rows,
          nextCursor: nextTs != null ? { lastTimestamp: nextTs } : null,
          requestUrls,
          requestedSince: since,
          missing: false,
          filledSource: 'binance',
          source: BINANCE_KLINES_SOURCE,
          note: 'Filled from Binance public klines (no key).'
        };
      }
      if (binance.error) errors.push(binance.error);

      return {
        rows: [],
        nextCursor: null,
        requestUrls,
        requestedSince: since,
        missing: true,
        filledSource: null,
        source: CRYPTO_ADAPTER_ID,
        note: [
          `No public crypto candles for ${upper} ${interval}.`,
          errors.filter(Boolean).join(' · ') || 'OKX / CoinGecko / Binance returned empty.',
          'Prices are not invented.'
        ].join(' ')
      };
    }
  };
}

export { intervalMs };
