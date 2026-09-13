import { BROWSER_HEADERS, createCookieJar, httpGet, parseJsonBody } from './http.js';
import { intervalMs } from './source-adapter.js';
import { normalizeTicker } from './ticker.js';

export const STOCK_ADAPTER_ID = 'stock-public';
export const STOCK_SOURCE = 'yahoo-chart';
export const YAHOO_CHART_HOSTS = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com'
];
export const STOOQ_DAILY_HOST = 'https://stooq.com';

export const STOCK_SOURCE_NOTE = [
  'Equity candles: Yahoo Finance public chart API',
  '(query1/query2.finance.yahoo.com/v8/finance/chart), no key.',
  'Daily required; hourly when Yahoo returns 1h bars.',
  'Yahoo crumb cookie is used when the anonymous chart call fails.',
  'Stooq daily CSV is a fallback (browser-like User-Agent).',
  'Empty means the public source returned no bars — prices are not invented.'
].join(' ');

export const STOCK_MISSING_NOTE = STOCK_SOURCE_NOTE;

const YAHOO_HEADERS = {
  ...BROWSER_HEADERS,
  Accept: 'application/json,text/csv;q=0.8,*/*;q=0.5'
};

const STOOQ_HEADERS = {
  ...BROWSER_HEADERS,
  Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.5',
  Referer: 'https://stooq.com/'
};

export const YAHOO_CRUMB_URLS = [
  'https://fc.yahoo.com',
  'https://query1.finance.yahoo.com/v1/test/getcrumb',
  'https://query2.finance.yahoo.com/v1/test/getcrumb'
];

const DEFAULT_RANGE = { '1h': '3mo', '1d': '5y' };

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

export function yahooInterval(interval) {
  return interval === '1h' ? '1h' : '1d';
}

export function buildYahooChartUrl({
  symbol,
  interval = '1d',
  since = null,
  now = Date.now(),
  host = YAHOO_CHART_HOSTS[0],
  range = null
} = {}) {
  const ticker = encodeURIComponent(String(symbol || '').toUpperCase());
  const params = new URLSearchParams({
    interval: yahooInterval(interval),
    includePrePost: 'false',
    events: 'div|split'
  });
  if (since != null && Number.isFinite(Number(since))) {
    const period1 = Math.floor(Number(since) / 1000);
    const period2 = Math.floor(Number(now) / 1000);
    params.set('period1', String(Math.max(0, period1)));
    params.set('period2', String(Math.max(period1 + 1, period2)));
  } else {
    params.set('range', range || DEFAULT_RANGE[interval] || '5y');
  }
  return `${host}/v8/finance/chart/${ticker}?${params.toString()}`;
}

export function buildStooqDailyUrl(symbol) {
  const ticker = String(symbol || '').toLowerCase();
  return `${STOOQ_DAILY_HOST}/q/d/l/?s=${encodeURIComponent(`${ticker}.us`)}&i=d`;
}

export function normalizeStockRow(raw, { symbol, interval, source = STOCK_ADAPTER_ID } = {}) {
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

/**
 * Parse a Yahoo v8 finance chart body. Returns only bars with a finite close.
 * Never invents missing OHLC.
 */
export function parseYahooChartBody(body, { symbol, interval } = {}) {
  const chart = body && body.chart;
  const error = chart && chart.error;
  const result = chart && Array.isArray(chart.result) ? chart.result[0] : null;
  if (!result) {
    const message = (error && (error.description || error.code)) || 'Yahoo chart returned no result';
    return { rows: [], meta: null, error: message };
  }
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators && Array.isArray(result.indicators.quote)
    ? result.indicators.quote[0]
    : null;
  if (!quote) {
    return { rows: [], meta: result.meta || null, error: 'Yahoo chart missing quote arrays' };
  }
  const rows = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const sec = numeric(timestamps[i]);
    if (!Number.isFinite(sec)) continue;
    const row = normalizeStockRow({
      timestamp: sec > 1e12 ? sec : sec * 1000,
      open: quote.open && quote.open[i],
      high: quote.high && quote.high[i],
      low: quote.low && quote.low[i],
      close: quote.close && quote.close[i],
      volume: quote.volume && quote.volume[i]
    }, { symbol, interval });
    if (row) rows.push(row);
  }
  return {
    rows,
    meta: result.meta || null,
    error: null
  };
}

export function parseStooqCsv(text, { symbol, interval = '1d' } = {}) {
  const raw = String(text || '').trim();
  if (!raw || raw.startsWith('<') || /<!DOCTYPE|javascript to verify/i.test(raw)) {
    return { rows: [], error: 'Stooq returned a challenge/HTML page, not CSV' };
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { rows: [], error: 'Stooq CSV had no data rows' };
  const header = lines[0].toLowerCase();
  if (!header.includes('date') || !header.includes('close')) {
    return { rows: [], error: 'Stooq CSV missing Date/Close columns' };
  }
  const rows = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(',');
    if (parts.length < 5) continue;
    const date = String(parts[0] || '').trim();
    const ts = Date.parse(`${date}T00:00:00Z`);
    const row = normalizeStockRow({
      timestamp: ts,
      open: parts[1],
      high: parts[2],
      low: parts[3],
      close: parts[4],
      volume: parts[5]
    }, { symbol, interval });
    if (row) rows.push(row);
  }
  return { rows, error: rows.length ? null : 'Stooq CSV parsed zero finite closes' };
}

async function readYahooPage(http, url, extra = {}) {
  const response = await http(url, { headers: YAHOO_HEADERS, cookieJar: extra.cookieJar });
  const body = parseJsonBody(response.text);
  if (!response.ok) {
    const err = body && body.chart && body.chart.error;
    const message = (err && (err.description || err.code)) || `HTTP ${response.status}`;
    throw new Error(`Yahoo chart failed (${url}): ${message}`);
  }
  return { body, url, status: response.status };
}

function looksLikeCrumb(text) {
  const crumb = String(text || '').trim();
  if (!crumb || crumb.startsWith('<') || crumb.length > 80) return null;
  if (/unauthorized|error|invalid/i.test(crumb)) return null;
  return crumb;
}

export async function fetchYahooCrumb(http = httpGet) {
  const cookieJar = createCookieJar();
  const requestUrls = [];
  try {
    const seedUrl = YAHOO_CRUMB_URLS[0];
    requestUrls.push(seedUrl);
    await http(seedUrl, { headers: BROWSER_HEADERS, cookieJar });
  } catch {
    // fc.yahoo.com is only used to collect cookies
  }
  for (const url of YAHOO_CRUMB_URLS.slice(1)) {
    requestUrls.push(url);
    try {
      const response = await http(url, { headers: BROWSER_HEADERS, cookieJar });
      const crumb = looksLikeCrumb(response.text);
      if (crumb) return { crumb, cookieJar, requestUrls };
    } catch {
      continue;
    }
  }
  return { crumb: null, cookieJar, requestUrls };
}

export function appendYahooCrumb(url, crumb) {
  if (!crumb) return url;
  const next = new URL(url);
  next.searchParams.set('crumb', crumb);
  return next.toString();
}

export function createStockAdapter({
  symbol = '',
  interval = '1d',
  httpGet: http = httpGet,
  now = () => Date.now()
} = {}) {
  const parsed = normalizeTicker(symbol);
  const upper = parsed.symbol || String(symbol || '').toUpperCase();

  return {
    id: STOCK_ADAPTER_ID,
    symbol: upper,
    interval,
    mode: 'incremental',
    source: STOCK_SOURCE,
    async fetchSince(cursor) {
      const since = cursor && cursor.since != null ? cursor.since : null;
      const requestUrls = [];
      const stamp = now();
      let lastError = null;

      const crumbState = { crumb: null, cookieJar: null };
      const tryYahooUrls = async (urls) => {
        for (const url of urls) {
          requestUrls.push(url);
          try {
            const { body } = await readYahooPage(http, url, { cookieJar: crumbState.cookieJar });
            const parsedChart = parseYahooChartBody(body, { symbol: upper, interval });
            const rows = (parsedChart.rows || []).filter((row) => (
              since == null || row.timestamp >= since
            ));
            if (rows.length) {
              const nextTs = rows.reduce((max, row) => (row.timestamp > max ? row.timestamp : max), since);
              return {
                rows,
                nextCursor: nextTs != null ? { lastTimestamp: nextTs } : null,
                requestUrls,
                requestedSince: since,
                missing: false,
                filledSource: 'yahoo',
                source: STOCK_SOURCE,
                venue: parsedChart.meta && parsedChart.meta.exchangeName,
                name: parsedChart.meta && (parsedChart.meta.shortName || parsedChart.meta.longName),
                note: STOCK_SOURCE_NOTE
              };
            }
            lastError = parsedChart.error || 'Yahoo chart returned zero finite closes';
          } catch (error) {
            lastError = error.message || String(error);
            const notFound = /404|Not Found|delisted/i.test(lastError);
            if (notFound) return null;
          }
        }
        return null;
      };

      const yahooUrls = YAHOO_CHART_HOSTS.map((host) => buildYahooChartUrl({
        symbol: upper,
        interval,
        since,
        now: stamp,
        host
      }));
      const firstYahoo = await tryYahooUrls(yahooUrls);
      if (firstYahoo) return firstYahoo;

      try {
        const crumb = await fetchYahooCrumb(http);
        requestUrls.push(...(crumb.requestUrls || []));
        if (crumb.crumb) {
          crumbState.crumb = crumb.crumb;
          crumbState.cookieJar = crumb.cookieJar;
          const crumbUrls = yahooUrls.map((url) => appendYahooCrumb(url, crumb.crumb));
          const crumbHit = await tryYahooUrls(crumbUrls);
          if (crumbHit) {
            return {
              ...crumbHit,
              note: `${STOCK_SOURCE_NOTE} Used Yahoo v8 crumb.`
            };
          }
        }
      } catch (error) {
        lastError = error.message || lastError;
      }

      if (interval === '1d') {
        const stooqUrl = buildStooqDailyUrl(upper);
        requestUrls.push(stooqUrl);
        try {
          const response = await http(stooqUrl, { headers: STOOQ_HEADERS });
          const parsedCsv = parseStooqCsv(response.text, { symbol: upper, interval: '1d' });
          const rows = (parsedCsv.rows || []).filter((row) => (
            since == null || row.timestamp >= since
          ));
          if (rows.length) {
            const nextTs = rows.reduce((max, row) => (row.timestamp > max ? row.timestamp : max), since);
            return {
              rows,
              nextCursor: nextTs != null ? { lastTimestamp: nextTs } : null,
              requestUrls,
              requestedSince: since,
              missing: false,
              filledSource: 'stooq',
              source: 'stooq',
              note: `${STOCK_SOURCE_NOTE} Used Stooq daily CSV fallback.`
            };
          }
          lastError = parsedCsv.error || lastError;
        } catch (error) {
          lastError = error.message || lastError;
        }
      }

      return {
        rows: [],
        nextCursor: null,
        requestUrls,
        requestedSince: since,
        missing: true,
        filledSource: null,
        note: [
          `No public equity candles for ${upper} ${interval}.`,
          lastError || 'Yahoo/Stooq returned empty.',
          'Prices are not invented.'
        ].join(' ')
      };
    }
  };
}

export { intervalMs };
