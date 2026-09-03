import { test } from 'node:test';
import assert from 'node:assert';
import {
  OVERLAP_BARS,
  naturalKey,
  overlapSince,
  upsertByNaturalKey,
  validateMonotonicAndGaps,
  watermarkId
} from './source-adapter.js';
import { createOkxCandleAdapter, createOkxOiAdapter, buildOkxCandlesUrl } from './okx-adapter.js';
import { createEtfAdapter, createCoinGeckoAdapter, parseFarsideHtml } from './fallback-adapters.js';
import { createRefreshRuntime } from './refresh.js';
import { SeriesModel } from './series.js';

const HOUR = 3600000;
const T0 = 1700000000000;

function memoryStore(seed = []) {
  const items = seed.map((item) => ({ ...item }));
  return {
    getAll: () => items.slice(),
    getById: (id) => items.find((item) => item.id === id) || null,
    add: (item) => {
      const row = { ...item, id: item.id || `auto_${items.length}` };
      items.push(row);
      return row;
    },
    update: (id, updates) => {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return null;
      items[index] = { ...items[index], ...updates };
      return items[index];
    },
    upsert: (id, item) => {
      const index = items.findIndex((row) => row.id === id);
      if (index < 0) {
        items.push({ ...item, id });
        return { item: items[items.length - 1], inserted: true };
      }
      items[index] = { ...items[index], ...item, id };
      return { item: items[index], inserted: false };
    },
    upsertMany: (rows) => {
      let inserted = 0;
      let updated = 0;
      for (const row of rows || []) {
        const result = items.find((item) => item.id === row.id)
          ? { inserted: false }
          : { inserted: true };
        const index = items.findIndex((item) => item.id === row.id);
        if (index < 0) {
          items.push({ ...row });
          inserted += 1;
        } else {
          items[index] = { ...items[index], ...row };
          updated += 1;
        }
        void result;
      }
      return { inserted, updated, total: items.length };
    }
  };
}

function candle(ts, close) {
  return [String(ts), String(close), String(close + 10), String(close - 10), String(close), '10', '1.5', '100', '1'];
}

function jsonOk(data) {
  return { ok: true, status: 200, text: JSON.stringify({ code: '0', data }), url: '' };
}

test('upsertByNaturalKey dedupes symbol+interval+timestamp', () => {
  const existing = [
    { symbol: 'BTC', interval: '1h', timestamp: T0, close: 1 }
  ];
  const incoming = [
    { symbol: 'BTC', interval: '1h', timestamp: T0, close: 2 },
    { symbol: 'BTC', interval: '1h', timestamp: T0 + HOUR, close: 3 }
  ];
  const result = upsertByNaturalKey(existing, incoming);
  assert.strictEqual(result.total, 2);
  assert.strictEqual(result.inserted, 1);
  assert.strictEqual(result.updated, 1);
  assert.strictEqual(result.rows[0].close, 2);
  assert.strictEqual(naturalKey(result.rows[1]), 'BTC|1h|' + (T0 + HOUR));
});

test('validateMonotonicAndGaps flags gaps and does not invent bars', () => {
  const rows = [
    { symbol: 'BTC', interval: '1h', timestamp: T0 },
    { symbol: 'BTC', interval: '1h', timestamp: T0 + HOUR },
    { symbol: 'BTC', interval: '1h', timestamp: T0 + 5 * HOUR }
  ];
  const { rows: out, issues } = validateMonotonicAndGaps(rows, {
    source: 'okx-candles',
    symbol: 'BTC',
    interval: '1h'
  });
  assert.strictEqual(out.length, 3);
  const gaps = issues.filter((issue) => issue.type === 'gap');
  assert.strictEqual(gaps.length, 1);
  assert.strictEqual(gaps[0].from, T0 + HOUR);
  assert.strictEqual(gaps[0].to, T0 + 5 * HOUR);
});

test('validateMonotonicAndGaps drops missing timestamps and collapses duplicate keys', () => {
  const { rows, issues } = validateMonotonicAndGaps([
    { symbol: 'BTC', interval: '1h', timestamp: T0, close: 1 },
    { symbol: 'BTC', interval: '1h', close: 0 },
    { symbol: 'BTC', interval: '1h', timestamp: T0, close: 9 }
  ], { source: 'okx-candles', symbol: 'BTC', interval: '1h' });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].close, 9);
  assert.ok(issues.some((issue) => issue.type === 'missing_timestamp'));
  assert.ok(issues.some((issue) => issue.type === 'duplicate_timestamp'));
});

function okxOnlyRuntime(httpGet) {
  return createRefreshRuntime({
    httpGet,
    watermarkStore: memoryStore(),
    seriesStore: memoryStore(),
    errorLogStore: memoryStore(),
    universeStore: memoryStore(),
    adapters: [createOkxCandleAdapter({ symbol: 'BTC', interval: '1h', httpGet, maxPages: 1 })],
    now: (() => {
      let t = 1_700_100_000_000;
      return () => { t += 1000; return t; };
    })()
  });
}

test('refresh upserts once and second run requests only the overlap-adjusted delta', async () => {
  const page = [
    candle(T0 + 2 * HOUR, 3),
    candle(T0 + HOUR, 2),
    candle(T0, 1)
  ];
  const calls = [];
  const httpGet = async (url) => {
    calls.push(url);
    return { ...jsonOk(page), url };
  };

  const runtime = okxOnlyRuntime(httpGet);
  const first = await runtime.runRefresh({ source: 'okx-candles', symbol: 'BTC', interval: '1h' });
  assert.strictEqual(first.ran[0].status, 'ok');
  assert.strictEqual(first.ran[0].rowCount, 3);
  assert.ok(!calls[0].includes('before='), `first request should be full recent page, got ${calls[0]}`);

  const watermark = first.sources[0].lastTimestamp;
  assert.strictEqual(watermark, T0 + 2 * HOUR);

  const second = await runtime.runRefresh({ source: 'okx-candles', symbol: 'BTC', interval: '1h' });
  assert.strictEqual(second.ran[0].rowCount, 3);
  assert.strictEqual(second.ran[0].inserted, 0);
  assert.ok(calls[1].includes('before='), `second request must send a cursor, got ${calls[1]}`);

  const expectedSince = overlapSince(watermark, '1h');
  assert.strictEqual(expectedSince, T0 + 2 * HOUR - OVERLAP_BARS * HOUR);
  assert.ok(calls[1].includes(`before=${expectedSince}`), `second URL should start at overlap-adjusted watermark ${expectedSince}: ${calls[1]}`);
  assert.ok(!calls[1].includes('after='));
  assert.strictEqual(second.ran[0].requestedSince, expectedSince);
});

test('watermark does not advance when the OKX fetch fails', async () => {
  let fail = false;
  const httpGet = async (url) => {
    if (fail) throw new Error('network down');
    return { ...jsonOk([candle(T0, 1)]), url };
  };
  const runtime = okxOnlyRuntime(httpGet);
  await runtime.runRefresh({ source: 'okx-candles' });
  fail = true;
  const second = await runtime.runRefresh({ source: 'okx-candles' });
  assert.strictEqual(second.ran[0].status, 'error');
  assert.strictEqual(second.sources[0].lastTimestamp, T0);
});

test('gapped OKX page is stored without invented bars and logged to error_log', async () => {
  const page = [
    candle(T0 + 5 * HOUR, 5),
    candle(T0 + HOUR, 2),
    candle(T0, 1)
  ];
  const errorLogStore = memoryStore();
  const seriesStore = memoryStore();
  const httpGet = async (url) => ({ ...jsonOk(page), url });
  const runtime = createRefreshRuntime({
    httpGet,
    watermarkStore: memoryStore(),
    seriesStore,
    errorLogStore,
    universeStore: memoryStore(),
    adapters: [createOkxCandleAdapter({ symbol: 'BTC', interval: '1h', httpGet, maxPages: 1 })]
  });
  const result = await runtime.runRefresh();
  assert.strictEqual(result.ran[0].rowCount, 3);
  assert.ok(result.ran[0].gaps >= 1);
  assert.strictEqual(seriesStore.getAll().length, 3);
  assert.ok(errorLogStore.getAll().some((item) => item.type === 'gap'));
});

test('ETF and CoinGecko adapters ignore cursor and return nextCursor null', async () => {
  const etfHtml = `
    <table>
      <tr><th>Date</th><th>IBIT</th><th>Total</th></tr>
      <tr><td>01 Aug 2026</td><td>1.2</td><td>4.5</td></tr>
      <tr><td>02 Aug 2026</td><td>0.5</td><td>(1.1)</td></tr>
    </table>`;
  const httpGet = async (url) => {
    if (url.includes('farside')) return { ok: true, status: 200, text: etfHtml, url };
    if (url.includes('coingecko')) {
      return {
        ok: true,
        status: 200,
        text: JSON.stringify([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap: 1000 }]),
        url
      };
    }
    return { ok: false, status: 404, text: '{}', url };
  };

  const etf = createEtfAdapter({ symbol: 'BTC', httpGet });
  const cg = createCoinGeckoAdapter({ httpGet });
  const etfResult = await etf.fetchSince({ lastTimestamp: 999, since: 999 });
  const cgResult = await cg.fetchSince({ lastTimestamp: 999, since: 999 });
  assert.strictEqual(etf.nextCursor, undefined);
  assert.strictEqual(etfResult.nextCursor, null);
  assert.strictEqual(cgResult.nextCursor, null);
  assert.strictEqual(etf.mode, 'bounded-overlap');
  assert.strictEqual(cg.mode, 'bounded-overlap');
  assert.strictEqual(etfResult.rows.length, 2);
  assert.strictEqual(etfResult.rows[1].net_flow_usd_millions, -1.1);
  assert.strictEqual(cgResult.snapshot.coins[0].symbol, 'BTC');
});

test('parseFarsideHtml reads Total column and keeps blank-able numbers', () => {
  const rows = parseFarsideHtml(`
    <table>
      <tr><th>Date</th><th>Total</th></tr>
      <tr><td>28 Aug 2026</td><td>18.4</td></tr>
      <tr><td>29 Aug 2026</td><td>-</td></tr>
    </table>`);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].net_flow_usd_millions, 18.4);
  assert.strictEqual(rows[1].net_flow_usd_millions, null);
});

test('OKX candle URL encodes public instId and before cursor, never a key', () => {
  const url = buildOkxCandlesUrl({ interval: '1h', since: T0 });
  assert.ok(url.startsWith('https://www.okx.com/api/v5/market/history-candles'));
  assert.ok(url.includes('instId=BTC-USDT-SWAP'));
  assert.ok(url.includes('bar=1H'));
  assert.ok(url.includes(`before=${T0}`));
  assert.ok(!/key|secret|passphrase/i.test(url));
});

test('series export sinceExclusive returns only rows after the cursor', () => {
  const model = new SeriesModel();
  const packDays = [];
  for (let i = 0; i < 5; i++) {
    packDays.push({
      date_utc: `2026-08-0${i + 1}`,
      asset_id: 'btc',
      symbol: 'BTC',
      open: 64000,
      high: 65000,
      low: 63000,
      close: 64800 + i,
      volume: 10
    });
  }
  model.replaceData({
    indicators: { data: packDays, missing: false },
    oi_1h: { data: [] },
    oi_1d: { data: [] },
    oi_swap_1h: { data: [] },
    oi_swap_1d: { data: [] },
    candles_1h: { data: [] },
    candles_1d: { data: [] },
    etf_btc: { data: [] },
    etf_eth: { data: [] },
    ratios: { data: [] },
    universe: { data: null, missing: true },
    missing: []
  });
  const since = Date.parse('2026-08-03T00:00:00Z');
  const rows = model.getSeries('BTC', '1d', null, null, null, { sinceExclusive: since });
  assert.ok(rows.every((row) => row.timestamp > since));
  assert.strictEqual(rows.length, 2);
});

test('createOkxOiAdapter is incremental and uses the public rubik history path', async () => {
  const calls = [];
  const httpGet = async (url) => {
    calls.push(url);
    return {
      ...jsonOk([[String(T0), '100', '1', '1']]),
      url
    };
  };
  const adapter = createOkxOiAdapter({ symbol: 'BTC', interval: '1d', httpGet });
  assert.strictEqual(adapter.mode, 'incremental');
  const result = await adapter.fetchSince({ since: T0 - HOUR });
  assert.ok(calls[0].includes('/api/v5/rubik/stat/contracts/open-interest-history'));
  assert.ok(calls[0].includes(`begin=${T0 - HOUR}`));
  assert.strictEqual(result.rows[0].oi, 100);
  assert.ok(result.nextCursor.lastTimestamp === T0);
});

test('watermark id is source:symbol:interval', () => {
  assert.strictEqual(watermarkId('okx-candles', 'btc', '1h'), 'okx-candles:BTC:1h');
});
