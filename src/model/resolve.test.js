import { test } from 'node:test';
import assert from 'node:assert';
import {
  probeCoinGeckoListed,
  probeOkxListed,
  probeYahooListed,
  resolveTicker
} from './resolve.js';
import { adaptersForTicker, createRefreshRuntime } from './refresh.js';
import { sourceLabel } from './source-adapter.js';
import { normalizeTicker } from './ticker.js';

function jsonOk(data, extra = {}) {
  return { ok: true, status: 200, text: JSON.stringify(data), url: '', ...extra };
}

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

function okxInstruments(instId) {
  return jsonOk({ code: '0', data: [{ instId, state: 'live' }] });
}

function okxEmpty() {
  return jsonOk({ code: '0', data: [] });
}

function okxCandle(ts, close) {
  return [String(ts), String(close), String(close + 1), String(close - 1), String(close), '10', '1.5', '100', '1'];
}

function cgSearch(symbol, id) {
  return jsonOk({ coins: [{ id, symbol: String(symbol).toLowerCase(), name: id }] });
}

function yahooEmpty(symbol = 'HYPE') {
  return {
    ok: false,
    status: 404,
    text: JSON.stringify({
      chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } }
    }),
    url: `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`
  };
}

function yahooBars(symbol = 'CDNS') {
  const ts = Math.floor(Date.now() / 1000) - 86400;
  return jsonOk({
    chart: {
      result: [{
        meta: { symbol, shortName: symbol, exchangeName: 'NMS' },
        timestamp: [ts],
        indicators: { quote: [{ open: [10], high: [11], low: [9], close: [10.5], volume: [100] }] }
      }],
      error: null
    }
  });
}

test('HYPE classifies unknown locally and is not Yahoo equity', () => {
  const parsed = normalizeTicker('HYPE');
  assert.strictEqual(parsed.assetClass, 'unknown');
  assert.strictEqual(parsed.equityHint, true);
  assert.ok(adaptersForTicker('HYPE').every((adapter) => adapter.id === 'crypto-candles'));
  assert.ok(!adaptersForTicker('HYPE').some((adapter) => adapter.id === 'stock-public'));
});

test('resolveTicker: OKX/CG listing loads HYPE as crypto · coin', async () => {
  const http = async (url) => {
    if (url.includes('okx.com') && url.includes('instruments') && url.includes('HYPE-USDT')) {
      return okxInstruments('HYPE-USDT');
    }
    if (url.includes('coingecko.com/api/v3/search')) return cgSearch('HYPE', 'hyperliquid');
    if (url.includes('binance')) return { ok: false, status: 400, text: '{"msg":"Invalid symbol"}', url };
    if (url.includes('yahoo')) return yahooEmpty('HYPE');
    return { ok: false, status: 404, text: '{}', url };
  };
  const resolved = await resolveTicker('HYPE', { httpGet: http });
  assert.strictEqual(resolved.ok, true);
  assert.strictEqual(resolved.symbol, 'HYPE');
  assert.strictEqual(resolved.assetClass, 'crypto');
  assert.strictEqual(resolved.venue, 'coin');
  assert.strictEqual(resolved.needsPicker, false);
  assert.ok(resolved.crypto.exists);
  assert.strictEqual(resolved.crypto.source, 'okx');
});

test('resolveTicker: both crypto and equity show a venue picker', async () => {
  const http = async (url) => {
    if (url.includes('okx.com') && url.includes('instruments')) return okxInstruments('BOTH-USDT');
    if (url.includes('coingecko.com/api/v3/search')) return cgSearch('BOTH', 'both-coin');
    if (url.includes('binance')) return { ok: false, status: 400, text: '{}', url };
    if (url.includes('yahoo')) return yahooBars('BOTH');
    return { ok: false, status: 404, text: '{}', url };
  };
  const resolved = await resolveTicker('BOTH', { httpGet: http });
  assert.strictEqual(resolved.needsPicker, true);
  assert.strictEqual(resolved.assetClass, 'crypto');
  assert.strictEqual(resolved.candidates.length, 2);
  assert.ok(resolved.candidates.some((row) => row.assetClass === 'crypto'));
  assert.ok(resolved.candidates.some((row) => row.assetClass === 'equity'));
});

test('resolveTicker: equity-only unknown stays equity after crypto miss', async () => {
  const http = async (url) => {
    if (url.includes('okx.com')) return okxEmpty();
    if (url.includes('coingecko.com/api/v3/search')) return jsonOk({ coins: [] });
    if (url.includes('binance')) return { ok: false, status: 400, text: '{}', url };
    if (url.includes('yahoo')) return yahooBars('CDNS');
    return { ok: false, status: 404, text: '{}', url };
  };
  const resolved = await resolveTicker('CDNS', { httpGet: http });
  assert.strictEqual(resolved.assetClass, 'equity');
  assert.strictEqual(resolved.needsPicker, false);
  assert.strictEqual(resolved.venue, 'equity');
});

test('forced assetClass skips venue probe', async () => {
  const calls = [];
  const http = async (url) => {
    calls.push(url);
    throw new Error(`should not fetch ${url}`);
  };
  const crypto = await resolveTicker('HYPE', { httpGet: http, assetClass: 'crypto' });
  assert.strictEqual(crypto.assetClass, 'crypto');
  assert.strictEqual(crypto.forced, true);
  const equity = await resolveTicker('HYPE', { httpGet: http, assetClass: 'equity' });
  assert.strictEqual(equity.assetClass, 'equity');
  assert.deepStrictEqual(calls, []);
});

test('refresh reports filledSource from the crypto fallback chain', async () => {
  const T0 = 1_700_000_000_000;
  const http = async (url) => {
    if (url.includes('okx.com') && url.includes('instruments')) return okxInstruments('HYPE-USDT');
    if (url.includes('okx.com') && url.includes('history-candles')) {
      if (url.includes('HYPE-USDT-SWAP')) {
        return {
          ok: false,
          status: 400,
          text: JSON.stringify({ code: '51001', msg: 'Instrument ID does not exist' }),
          url
        };
      }
      return jsonOk({ code: '0', data: [okxCandle(T0, 42)] });
    }
    if (url.includes('coingecko.com/api/v3/search')) return cgSearch('HYPE', 'hyperliquid');
    if (url.includes('binance') || url.includes('yahoo')) {
      return { ok: false, status: 404, text: '{}', url };
    }
    return { ok: false, status: 404, text: '{}', url };
  };
  const runtime = createRefreshRuntime({
    httpGet: http,
    watermarkStore: memoryStore(),
    seriesStore: memoryStore(),
    errorLogStore: memoryStore(),
    universeStore: memoryStore(),
    adapters: []
  });
  const result = await runtime.runRefresh({ symbol: 'HYPE', interval: '1d' });
  const daily = result.ran.find((row) => row.interval === '1d');
  assert.ok(daily);
  assert.strictEqual(daily.status, 'ok');
  assert.strictEqual(daily.filledSource, 'okx');
  assert.strictEqual(daily.sourceLabel, 'OKX');
  assert.strictEqual(typeof daily.lastSuccessAgeMs, 'number');
  assert.ok(daily.lastSuccessAgeMs >= 0);
  assert.strictEqual(result.filledSource, 'okx');
  assert.strictEqual(result.resolve.assetClass, 'crypto');
  assert.match(sourceLabel('crypto-candles', 'okx'), /OKX/);
});

test('probes report honest misses without inventing listings', async () => {
  const http = async (url) => {
    if (url.includes('okx.com')) return okxEmpty();
    if (url.includes('coingecko')) return jsonOk({ coins: [] });
    if (url.includes('yahoo')) return yahooEmpty('ZZQX');
    return { ok: false, status: 404, text: '{}', url };
  };
  const okx = await probeOkxListed('ZZQX', http);
  const cg = await probeCoinGeckoListed('ZZQX', http);
  const yahoo = await probeYahooListed('ZZQX', http);
  assert.strictEqual(okx.exists, false);
  assert.strictEqual(cg.exists, false);
  assert.strictEqual(yahoo.exists, false);
});
