import { test } from 'node:test';
import assert from 'node:assert';
import { SeriesModel, filterRowsBySymbol, mapIndicatorRow } from './series.js';
import { formatUtcTick } from './dates.js';

function makePack({ includeEth = true } = {}) {
  const days = 10;
  const indicators = [];
  for (let i = 0; i < days; i++) {
    const date_utc = `2026-08-${String(i + 1).padStart(2, '0')}`;
    if (includeEth) {
      indicators.push({
        date_utc,
        asset_id: 'eth',
        symbol: 'ETH',
        open: 3200 + i * 10,
        high: 3250 + i * 10,
        low: 3180 + i * 10,
        close: 3220 + i * 10,
        volume: 1000 + i,
        ma20: 3210 + i,
        ma50: 3190 + i,
        ma100: 3170 + i,
        ma200: 3150 + i,
        tenkan: 3215 + i,
        kijun: 3205 + i,
        senkou_a: 3210 + i,
        senkou_b: 3200 + i,
        chikou: 3220 + i
      });
    }
    indicators.push({
      date_utc,
      asset_id: 'btc',
      symbol: 'BTC',
      open: 64000 + i * 100,
      high: 65000 + i * 100,
      low: 63000 + i * 100,
      close: 64800 + i * 100,
      volume: 2000 + i,
      ma20: 64500 + i,
      ma50: 63800 + i,
      ma100: 62900 + i,
      ma200: 61500 + i,
      tenkan: 64600 + i,
      kijun: 64200 + i,
      senkou_a: 64400 + i,
      senkou_b: 64000 + i,
      chikou: 64800 + i
    });
  }

  return {
    indicators: { data: indicators, missing: false, filename: 'indicators_daily.csv' },
    oi_1h: { data: [], missing: true, filename: 'okx_btc_oi_candles_1h_joined.csv' },
    oi_1d: { data: [], missing: true, filename: 'okx_btc_oi_candles_1d_joined.csv' },
    candles_1h: { data: [], missing: true, filename: 'okx_btc_usdt_swap_candles_1h.csv' },
    candles_1d: { data: [], missing: true, filename: 'okx_btc_usdt_swap_candles_1d.csv' },
    etf_btc: { data: [], missing: true },
    etf_eth: { data: [], missing: true },
    ratios: { data: [], missing: true },
    universe: { data: null, missing: true },
    missing: []
  };
}

test('filterRowsBySymbol keeps only the requested asset', () => {
  const pack = makePack();
  const eth = filterRowsBySymbol(pack.indicators.data, 'ETH');
  const btc = filterRowsBySymbol(pack.indicators.data, 'btc');
  assert.ok(eth.every((row) => row.symbol === 'ETH'));
  assert.ok(btc.every((row) => row.symbol === 'BTC'));
  assert.strictEqual(eth.length, 10);
  assert.strictEqual(btc.length, 10);
});

test('ETH series is thousands, not BTC 57k-82k', () => {
  const model = new SeriesModel();
  model.replaceData(makePack());
  const eth = model.getSeries('ETH', '1d');
  const btc = model.getSeries('BTC', '1d');

  const ethMin = Math.min(...eth.map((r) => r.close));
  const ethMax = Math.max(...eth.map((r) => r.close));
  const btcMin = Math.min(...btc.map((r) => r.close));

  assert.ok(ethMin > 1000 && ethMax < 10000, `ETH range ${ethMin}-${ethMax}`);
  assert.ok(btcMin > 50000, `BTC min ${btcMin}`);
  assert.notDeepStrictEqual(eth.map((r) => r.close), btc.map((r) => r.close));
});

test('missing symbol does not silently return BTC', () => {
  const model = new SeriesModel();
  model.replaceData(makePack());
  assert.throws(() => model.getSeries('SOL', '1d'), /No data available for SOL 1d/);
});

test('ETH 1h does not reuse daily ETH or BTC', () => {
  const model = new SeriesModel();
  model.replaceData(makePack());
  assert.throws(() => model.getSeries('ETH', '1h'), /No data available for ETH 1h/);
});

test('x-axis timestamps are distinct UTC dates', () => {
  const model = new SeriesModel();
  model.replaceData(makePack());
  const eth = model.getSeries('ETH', '1d');
  const labels = eth.map((row) => formatUtcTick(row.timestamp));
  assert.strictEqual(new Set(labels).size, labels.length);
  assert.ok(labels.includes('8/1'));
  assert.ok(labels.includes('8/2'));
  assert.ok(!labels.includes('12/31'));
});

test('mapIndicatorRow copies MA and Ichimoku pack columns', () => {
  const mapped = mapIndicatorRow({
    date_utc: '2026-08-03',
    symbol: 'ETH',
    open: 1, high: 2, low: 0.5, close: 1.5, volume: 9,
    ma20: 10, ma50: 11, ma100: 12, ma200: 13,
    tenkan: 14, kijun: 15, senkou_a: 16, senkou_b: 17, chikou: 18
  });
  assert.strictEqual(mapped.ma200, 13);
  assert.strictEqual(mapped.senkouA, 16);
  assert.strictEqual(mapped.senkouB, 17);
  assert.strictEqual(mapped.chikou, 18);
  assert.strictEqual(mapped.timestamp, Date.parse('2026-08-03T00:00:00Z'));
});

test('available symbols come from the pack, not a hardcoded BTC-only list', () => {
  const model = new SeriesModel();
  model.replaceData(makePack());
  assert.deepStrictEqual(model.getAvailableSymbols(), ['BTC', 'ETH']);
});
