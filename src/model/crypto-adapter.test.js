import { test } from 'node:test';
import assert from 'node:assert';
import {
  BINANCE_KLINES_SOURCE,
  COINGECKO_OHLC_SOURCE,
  buildBinanceKlinesUrl,
  buildCoinGeckoOhlcUrl,
  createCryptoCandleAdapter,
  parseBinanceKlines,
  parseCoinGeckoMarketChart,
  parseCoinGeckoOhlc,
  pickCoinGeckoId
} from './crypto-adapter.js';

const T0 = Date.UTC(2026, 8, 1);

function jsonOk(data) {
  return { ok: true, status: 200, text: JSON.stringify(data), url: '' };
}

test('CoinGecko OHLC parser keeps real bars and never invents', () => {
  const parsed = parseCoinGeckoOhlc([
    [T0, 1, 2, 0.5, 1.5],
    [T0 + 86400000, 1.5, 2.5, 1.4, 2]
  ], { symbol: 'HYPE', interval: '1d' });
  assert.strictEqual(parsed.rows.length, 2);
  assert.strictEqual(parsed.rows[1].close, 2);
  assert.strictEqual(parsed.rows[0].source, COINGECKO_OHLC_SOURCE);
  const empty = parseCoinGeckoOhlc([], { symbol: 'HYPE', interval: '1d' });
  assert.deepStrictEqual(empty.rows, []);
  assert.match(empty.error, /zero/);
});

test('CoinGecko market_chart stays close-only (no invented OHLC)', () => {
  const parsed = parseCoinGeckoMarketChart({
    prices: [[T0, 12.5], [T0 + 3600000, 13]],
    total_volumes: [[T0, 100]]
  }, { symbol: 'HYPE', interval: '1h' });
  assert.strictEqual(parsed.rows.length, 2);
  assert.strictEqual(parsed.rows[0].close, 12.5);
  assert.strictEqual(parsed.rows[0].open, null);
  assert.strictEqual(parsed.rows[0].high, null);
  assert.strictEqual(parsed.rows[0].low, null);
});

test('Binance kline parser and URL are keyless', () => {
  const parsed = parseBinanceKlines([
    [T0, '10', '12', '9', '11', '50']
  ], { symbol: 'HYPE', interval: '1h' });
  assert.strictEqual(parsed.rows[0].close, 11);
  assert.strictEqual(parsed.rows[0].source, BINANCE_KLINES_SOURCE);
  const url = buildBinanceKlinesUrl({ symbol: 'HYPE', interval: '1h', since: T0 });
  assert.ok(url.includes('HYPEUSDT'));
  assert.ok(url.includes('interval=1h'));
  assert.ok(url.includes(`startTime=${T0}`));
  assert.ok(!/key|secret|apikey/i.test(url));
  assert.ok(buildCoinGeckoOhlcUrl('hyperliquid', { interval: '1h' }).includes('/coins/hyperliquid/ohlc'));
});

test('pickCoinGeckoId prefers exact symbol and HYPE hint', () => {
  assert.strictEqual(pickCoinGeckoId({
    coins: [{ id: 'hyperliquid', symbol: 'hype', name: 'Hyperliquid' }]
  }, 'HYPE'), 'hyperliquid');
  assert.strictEqual(pickCoinGeckoId({ coins: [] }, 'HYPE'), 'hyperliquid');
});

test('crypto fallback chain: OKX miss → CoinGecko OHLC fills and reports source', async () => {
  const calls = [];
  const http = async (url) => {
    calls.push(url);
    if (url.includes('okx.com')) {
      return {
        ok: false,
        status: 400,
        text: JSON.stringify({ code: '51001', msg: 'Instrument ID does not exist' }),
        url
      };
    }
    if (url.includes('/search')) {
      return jsonOk({ coins: [{ id: 'hyperliquid', symbol: 'hype', name: 'Hyperliquid' }] });
    }
    if (url.includes('/ohlc')) {
      return jsonOk([
        [T0, 20, 22, 19, 21],
        [T0 + 3600000, 21, 23, 20, 22]
      ]);
    }
    throw new Error(`unexpected ${url}`);
  };
  const adapter = createCryptoCandleAdapter({ symbol: 'HYPE', interval: '1h', httpGet: http, maxPages: 1 });
  const result = await adapter.fetchSince(null);
  assert.strictEqual(result.filledSource, 'coingecko');
  assert.strictEqual(result.source, COINGECKO_OHLC_SOURCE);
  assert.strictEqual(result.rows.length, 2);
  assert.strictEqual(result.rows[1].close, 22);
  assert.ok(calls.some((url) => url.includes('okx.com')));
  assert.ok(calls.some((url) => url.includes('hyperliquid/ohlc')));
  assert.ok(!calls.some((url) => url.includes('binance')));
});

test('crypto fallback chain: OKX+CG miss → Binance fills', async () => {
  const http = async (url) => {
    if (url.includes('okx.com')) {
      return {
        ok: false,
        status: 400,
        text: JSON.stringify({ code: '51001', msg: 'Instrument ID does not exist' }),
        url
      };
    }
    if (url.includes('coingecko')) {
      return { ok: false, status: 429, text: '{"error":"rate limit"}', url };
    }
    if (url.includes('binance') && url.includes('klines')) {
      return jsonOk([[T0, '30', '32', '29', '31', '80']]);
    }
    return { ok: false, status: 404, text: '{}', url };
  };
  const adapter = createCryptoCandleAdapter({ symbol: 'HYPE', interval: '1d', httpGet: http, maxPages: 1 });
  const result = await adapter.fetchSince(null);
  assert.strictEqual(result.filledSource, 'binance');
  assert.strictEqual(result.rows[0].close, 31);
  assert.strictEqual(result.missing, false);
});

test('crypto fallback chain: all sources empty is honest, not invented', async () => {
  const http = async (url) => {
    if (url.includes('okx.com')) {
      return jsonOk({ code: '0', data: [] });
    }
    if (url.includes('coingecko.com/api/v3/search')) return jsonOk({ coins: [] });
    if (url.includes('binance')) return { ok: false, status: 400, text: '{"msg":"Invalid symbol"}', url };
    return { ok: false, status: 404, text: '{}', url };
  };
  const adapter = createCryptoCandleAdapter({ symbol: 'ZZQX', interval: '1d', httpGet: http, maxPages: 1 });
  const result = await adapter.fetchSince(null);
  assert.deepStrictEqual(result.rows, []);
  assert.strictEqual(result.missing, true);
  assert.strictEqual(result.filledSource, null);
  assert.match(result.note, /not invented/i);
});

test('live OKX HYPE fetch (network) returns 1h+1d or honest empty', async () => {
  const daily = createCryptoCandleAdapter({ symbol: 'HYPE', interval: '1d', maxPages: 1 });
  const hourly = createCryptoCandleAdapter({ symbol: 'HYPE', interval: '1h', maxPages: 1 });
  const [d, h] = await Promise.all([daily.fetchSince(null), hourly.fetchSince(null)]);
  for (const result of [d, h]) {
    if (!result.rows.length) {
      assert.strictEqual(result.missing, true);
      assert.match(result.note || '', /not invented/i);
      continue;
    }
    const last = result.rows.reduce((max, row) => (row.timestamp > max.timestamp ? row : max), result.rows[0]);
    assert.ok(Number.isFinite(last.close));
    assert.ok(Number.isFinite(last.timestamp));
    const ageMs = Date.now() - last.timestamp;
    assert.ok(ageMs < 14 * 24 * 3600 * 1000, `last bar too old: ${new Date(last.timestamp).toISOString()}`);
    assert.ok(['okx', 'coingecko', 'binance'].includes(result.filledSource), result.filledSource);
  }
});
