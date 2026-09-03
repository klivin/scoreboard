import { httpGet, parseJsonBody } from './http.js';
import { intervalMs } from './source-adapter.js';

export const OKX_BASE = 'https://www.okx.com';
export const OKX_CANDLES_PATH = '/api/v5/market/history-candles';
export const OKX_OI_HISTORY_PATH = '/api/v5/rubik/stat/contracts/open-interest-history';
export const OKX_INST_ID = 'BTC-USDT-SWAP';

const BAR = { '1h': '1H', '1d': '1D' };
const DEFAULT_LIMIT = 100;
const MAX_PAGES = 3;

function okxBar(interval) {
  return BAR[interval] || '1D';
}

function formatUtc(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function dateUtc(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function numeric(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildOkxCandlesUrl({ interval, since = null, after = null, limit = DEFAULT_LIMIT, instId = OKX_INST_ID } = {}) {
  const params = new URLSearchParams({
    instId,
    bar: okxBar(interval),
    limit: String(limit)
  });
  if (since != null && Number.isFinite(Number(since))) {
    params.set('before', String(since));
  }
  if (after != null && Number.isFinite(Number(after))) {
    params.set('after', String(after));
  }
  return `${OKX_BASE}${OKX_CANDLES_PATH}?${params.toString()}`;
}

export function buildOkxOiUrl({ interval, since = null, limit = DEFAULT_LIMIT, instId = OKX_INST_ID } = {}) {
  const params = new URLSearchParams({
    instId,
    period: okxBar(interval),
    limit: String(limit)
  });
  if (since != null && Number.isFinite(Number(since))) {
    params.set('begin', String(since));
  }
  return `${OKX_BASE}${OKX_OI_HISTORY_PATH}?${params.toString()}`;
}

export function normalizeOkxCandle(raw, { symbol, interval, source = 'okx-candles' } = {}) {
  const ts = numeric(Array.isArray(raw) ? raw[0] : raw && (raw.ts || raw.ts_ms || raw.timestamp));
  if (!Number.isFinite(ts)) return null;
  const open = numeric(Array.isArray(raw) ? raw[1] : raw.open);
  const high = numeric(Array.isArray(raw) ? raw[2] : raw.high);
  const low = numeric(Array.isArray(raw) ? raw[3] : raw.low);
  const close = numeric(Array.isArray(raw) ? raw[4] : raw.close);
  const volumeBase = numeric(Array.isArray(raw) ? raw[6] : (raw.volume_base || raw.volCcy));
  const volumeContracts = numeric(Array.isArray(raw) ? raw[5] : (raw.vol || raw.volume));
  return {
    source,
    symbol,
    interval,
    timestamp: ts,
    ts_ms: ts,
    datetime_utc: formatUtc(ts),
    date_utc: dateUtc(ts),
    open,
    high,
    low,
    close,
    volume: volumeBase != null ? volumeBase : volumeContracts,
    volume_base: volumeBase
  };
}

export function normalizeOkxOi(raw, { symbol, interval, source = 'okx-oi' } = {}) {
  const ts = numeric(Array.isArray(raw) ? raw[0] : raw && (raw.ts || raw.ts_ms || raw.timestamp));
  if (!Number.isFinite(ts)) return null;
  return {
    source,
    symbol,
    interval,
    timestamp: ts,
    ts_ms: ts,
    datetime_utc: formatUtc(ts),
    date_utc: dateUtc(ts),
    oi: numeric(Array.isArray(raw) ? raw[1] : (raw.oi || raw.open_interest)),
    oi_ccy: numeric(Array.isArray(raw) ? raw[2] : raw.oiCcy),
    instId: OKX_INST_ID
  };
}

async function readOkxPage(http, url) {
  const response = await http(url);
  const body = parseJsonBody(response.text);
  if (!response.ok || !body || String(body.code) !== '0') {
    const message = (body && (body.msg || body.error_message)) || `HTTP ${response.status}`;
    throw new Error(`OKX request failed (${url}): ${message}`);
  }
  return { data: Array.isArray(body.data) ? body.data : [], url };
}

export function createOkxCandleAdapter({
  symbol = 'BTC',
  interval = '1d',
  httpGet: http = httpGet,
  limit = DEFAULT_LIMIT,
  maxPages = MAX_PAGES
} = {}) {
  return {
    id: 'okx-candles',
    symbol,
    interval,
    mode: 'incremental',
    async fetchSince(cursor) {
      const since = cursor && cursor.since != null ? cursor.since : null;
      const requestUrls = [];
      const raw = [];
      let after = null;

      for (let page = 0; page < maxPages; page++) {
        const url = buildOkxCandlesUrl({ interval, since: after == null ? since : null, after, limit });
        requestUrls.push(url);
        const { data } = await readOkxPage(http, url);
        if (!data.length) break;
        raw.push(...data);
        const oldest = numeric(data[data.length - 1] && data[data.length - 1][0]);
        if (data.length < limit) break;
        if (since != null && Number.isFinite(oldest) && oldest <= since) break;
        after = oldest;
      }

      const rows = raw
        .map((item) => normalizeOkxCandle(item, { symbol, interval }))
        .filter((row) => row && (since == null || row.timestamp >= since));

      const nextTs = rows.reduce((max, row) => (row.timestamp > max ? row.timestamp : max), since);
      return {
        rows,
        nextCursor: nextTs != null ? { lastTimestamp: nextTs } : null,
        requestUrls,
        requestedSince: since
      };
    }
  };
}

export function createOkxOiAdapter({
  symbol = 'BTC',
  interval = '1d',
  httpGet: http = httpGet,
  limit = DEFAULT_LIMIT
} = {}) {
  return {
    id: 'okx-oi',
    symbol,
    interval,
    mode: 'incremental',
    async fetchSince(cursor) {
      const since = cursor && cursor.since != null ? cursor.since : null;
      const url = buildOkxOiUrl({ interval, since, limit });
      const { data } = await readOkxPage(http, url);
      const rows = data
        .map((item) => normalizeOkxOi(item, { symbol, interval }))
        .filter((row) => row && (since == null || row.timestamp >= since));

      const nextTs = rows.reduce((max, row) => (row.timestamp > max ? row.timestamp : max), since);
      return {
        rows,
        nextCursor: nextTs != null ? { lastTimestamp: nextTs } : null,
        requestUrls: [url],
        requestedSince: since
      };
    }
  };
}

export { intervalMs };
