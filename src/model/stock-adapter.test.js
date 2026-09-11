import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createStockAdapter,
  STOCK_ADAPTER_ID,
  STOCK_SOURCE,
  STOCK_SOURCE_NOTE,
  buildYahooChartUrl,
  buildStooqDailyUrl,
  parseYahooChartBody,
  parseStooqCsv
} from './stock-adapter.js';
import { createRefreshRuntime } from './refresh.js';
import { normalizeTicker } from './ticker.js';

const root = dirname(fileURLToPath(import.meta.url));
const RECORDED_YAHOO = JSON.parse(
  readFileSync(join(root, 'fixtures/yahoo-cdns-chart.recorded.json'), 'utf8')
);

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
        const index = items.findIndex((item) => item.id === row.id);
        if (index < 0) {
          items.push({ ...row });
          inserted += 1;
        } else {
          items[index] = { ...items[index], ...row };
          updated += 1;
        }
      }
      return { inserted, updated, total: items.length };
    }
  };
}

test('recorded Yahoo CDNS fixture is labeled and parses to real-shaped rows', () => {
  assert.strictEqual(RECORDED_YAHOO._label, 'RECORDED_FIXTURE_NOT_LIVE');
  assert.match(RECORDED_YAHOO._note, /not a live/i);
  const parsed = parseYahooChartBody(RECORDED_YAHOO, { symbol: 'CDNS', interval: '1d' });
  assert.strictEqual(parsed.rows.length, 5);
  const last = parsed.rows[parsed.rows.length - 1];
  assert.strictEqual(last.symbol, 'CDNS');
  assert.strictEqual(last.interval, '1d');
  assert.ok(Number.isFinite(last.timestamp));
  assert.ok(Number.isFinite(last.open));
  assert.ok(Number.isFinite(last.high));
  assert.ok(Number.isFinite(last.low));
  assert.ok(Number.isFinite(last.close));
  assert.ok(last.date_utc);
  assert.strictEqual(parsed.meta.symbol, 'CDNS');
});

test('parseYahooChartBody skips null closes and never invents bars', () => {
  const parsed = parseYahooChartBody({
    chart: {
      result: [{
        meta: { symbol: 'FAKE' },
        timestamp: [1000, 2000],
        indicators: { quote: [{ open: [1, null], high: [2, null], low: [0.5, null], close: [1.5, null], volume: [10, null] }] }
      }],
      error: null
    }
  }, { symbol: 'FAKE', interval: '1d' });
  assert.strictEqual(parsed.rows.length, 1);
  assert.strictEqual(parsed.rows[0].close, 1.5);
});

test('parseStooqCsv rejects JS-challenge HTML instead of inventing rows', () => {
  const parsed = parseStooqCsv('<!DOCTYPE html><noscript>This site requires JavaScript', { symbol: 'CDNS' });
  assert.deepStrictEqual(parsed.rows, []);
  assert.match(parsed.error, /challenge|HTML/i);
});

test('stock adapter uses Yahoo URL and returns recorded-shaped rows', async () => {
  const calls = [];
  const adapter = createStockAdapter({
    symbol: 'CDNS',
    interval: '1d',
    httpGet: async (url) => {
      calls.push(url);
      return { ok: true, status: 200, text: JSON.stringify(RECORDED_YAHOO), url };
    }
  });
  assert.strictEqual(adapter.id, STOCK_ADAPTER_ID);
  assert.strictEqual(adapter.mode, 'incremental');
  assert.strictEqual(adapter.source, STOCK_SOURCE);
  const result = await adapter.fetchSince(null);
  assert.ok(calls[0].includes('query1.finance.yahoo.com/v8/finance/chart/CDNS'));
  assert.ok(calls[0].includes('interval=1d'));
  assert.ok(!/key|secret|token=/i.test(calls[0]));
  assert.strictEqual(result.rows.length, 5);
  assert.strictEqual(result.missing, false);
  assert.strictEqual(result.rows[0].symbol, 'CDNS');
  assert.match(result.note, /Yahoo Finance/i);
  assert.match(STOCK_SOURCE_NOTE, /not invented/i);
});

test('stock adapter incremental second fetch sends period1 from watermark overlap', async () => {
  const calls = [];
  const adapter = createStockAdapter({
    symbol: 'CDNS',
    interval: '1d',
    now: () => 1_789_200_000_000,
    httpGet: async (url) => {
      calls.push(url);
      return { ok: true, status: 200, text: JSON.stringify(RECORDED_YAHOO), url };
    }
  });
  const since = 1_789_000_000_000;
  await adapter.fetchSince({ lastTimestamp: since + 86400000, since });
  assert.ok(calls[0].includes(`period1=${Math.floor(since / 1000)}`));
  assert.ok(calls[0].includes('period2='));
});

test('stock adapter returns honest empty when public sources fail', async () => {
  const adapter = createStockAdapter({
    symbol: 'ZZQX',
    interval: '1d',
    httpGet: async (url) => {
      if (url.includes('yahoo')) {
        return {
          ok: false,
          status: 404,
          text: JSON.stringify({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }),
          url
        };
      }
      return { ok: true, status: 200, text: '<!DOCTYPE html>javascript to verify', url };
    }
  });
  const result = await adapter.fetchSince(null);
  assert.deepStrictEqual(result.rows, []);
  assert.strictEqual(result.missing, true);
  assert.match(result.note, /not invented/i);
});

test('refresh for CDNS upserts Yahoo rows and never invents extras', async () => {
  const seriesStore = memoryStore();
  const runtime = createRefreshRuntime({
    httpGet: async (url) => {
      if (url.includes('yahoo')) {
        return { ok: true, status: 200, text: JSON.stringify(RECORDED_YAHOO), url };
      }
      throw new Error(`unexpected URL ${url}`);
    },
    watermarkStore: memoryStore(),
    seriesStore,
    errorLogStore: memoryStore(),
    universeStore: memoryStore(),
    adapters: []
  });
  const result = await runtime.runRefresh({ symbol: 'CDNS', interval: '1d' });
  assert.ok(result.ran.length >= 1);
  const daily = result.ran.find((row) => row.interval === '1d');
  assert.strictEqual(daily.status, 'ok');
  assert.ok(daily.rowCount >= 5);
  assert.ok(seriesStore.getAll().every((row) => row.symbol === 'CDNS' && Number.isFinite(row.close)));
});

test('Yahoo and Stooq URL builders never include keys', () => {
  const yahoo = buildYahooChartUrl({ symbol: 'CDNS', interval: '1h' });
  assert.ok(yahoo.includes('/v8/finance/chart/CDNS'));
  assert.ok(yahoo.includes('interval=1h'));
  assert.ok(!/key|secret|apikey/i.test(yahoo));
  const stooq = buildStooqDailyUrl('CDNS');
  assert.ok(stooq.includes('cdns.us'));
  assert.ok(!/key|secret/i.test(stooq));
});

test('CDNS classifies as stock without a hardcoded allowlist entry', () => {
  assert.strictEqual(normalizeTicker('CDNS').assetClass, 'stock');
  assert.strictEqual(normalizeTicker('cdns').symbol, 'CDNS');
});

test('live Yahoo CDNS fetch (network) returns real-shaped rows or honest empty', async () => {
  const adapter = createStockAdapter({ symbol: 'CDNS', interval: '1d' });
  const result = await adapter.fetchSince(null);
  if (!result.rows.length) {
    assert.strictEqual(result.missing, true);
    assert.match(result.note, /not invented/i);
    return;
  }
  const last = result.rows[result.rows.length - 1];
  assert.ok(Number.isFinite(last.close));
  assert.ok(Number.isFinite(last.timestamp));
  const ageMs = Date.now() - last.timestamp;
  assert.ok(ageMs < 14 * 24 * 3600 * 1000, `last bar too old: ${new Date(last.timestamp).toISOString()}`);
  assert.ok(last.date_utc);
});
