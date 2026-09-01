import { test } from 'node:test';
import assert from 'node:assert';
import { SeriesModel, filterRowsBySymbol, mapIndicatorRow, normalizeCandleRow, missingSeriesMessage } from './series.js';
import { parseCSV } from './ingest.js';
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
    oi_swap_1h: { data: [], missing: true, filename: 'okx_btc_usdt_swap_oi_1h.csv' },
    oi_swap_1d: { data: [], missing: true, filename: 'okx_btc_usdt_swap_oi_1d.csv' },
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
  assert.throws(() => model.getSeries('ETH', '1h'), /No 1h series for ETH/);
  assert.match(missingSeriesMessage('ETH', '1h'), /not interpolated/);
});

test('blank ETH close stays a gap, never 0', () => {
  const mapped = mapIndicatorRow({
    date_utc: '2026-08-31',
    symbol: 'ETH',
    open: 3900, high: 3950, low: 3880, close: '', volume: 10
  });
  assert.strictEqual(mapped.close, null);
  assert.notStrictEqual(mapped.close, 0);
});

test('BTC 1h loader uses pack candles file columns only (Kevin no-data bug)', () => {
  const csv = [
    'ts_ms,datetime_utc,open,high,low,close,volume',
    '1722470400000,2024-08-01 00:00:00,64000,64100,63900,64050,11',
    '1722474000000,2024-08-01 01:00:00,64050,64200,64000,64120,12'
  ].join('\n');
  const parsed = parseCSV(csv);
  const joinedJunk = parseCSV('date_utc,oi\n2024-08-01,1\n');
  const model = new SeriesModel();
  model.replaceData({
    ...makePack(),
    candles_1h: { data: parsed, missing: false, filename: 'okx_btc_usdt_swap_candles_1h.csv' },
    oi_1h: { data: joinedJunk, missing: false, filename: 'okx_btc_oi_candles_1h_joined.csv' }
  });
  const series = model.getSeries('BTC', '1h');
  assert.strictEqual(series.length, 2);
  assert.strictEqual(series[0].timestamp, 1722470400000);
  assert.strictEqual(series[0].close, 64050);
  assert.ok(series.every((row) => row.close !== 0 || row.close === 64050 || row.close === 64120));
});

test('BTC 1h charts from OKX ts_ms/datetime_utc candles, not daily indicators', () => {
  const hour = 3600000;
  const start = Date.parse('2026-08-30T00:00:00Z');
  const candles = Array.from({ length: 12 }, (_, i) => ({
    ts_ms: start + i * hour,
    datetime_utc: new Date(start + i * hour).toISOString(),
    open: 64000 + i,
    high: 64100 + i,
    low: 63900 + i,
    close: 64050 + i,
    volume: 100 + i
  }));
  const model = new SeriesModel();
  const pack = makePack();
  pack.candles_1h = { data: candles, missing: false, filename: 'okx_btc_usdt_swap_candles_1h.csv' };
  model.replaceData(pack);

  const btc1h = model.getSeries('BTC', '1h');
  assert.strictEqual(btc1h.length, 12);
  assert.strictEqual(btc1h[0].timestamp, start);
  assert.ok(btc1h[0].close > 60000);

  assert.throws(() => model.getSeries('ETH', '1h'), /No 1h series for ETH/);
  const eth1d = model.getSeries('ETH', '1d');
  assert.ok(eth1d[0].close < 10000);
});

test('normalizeCandleRow reads ts_ms and datetime_utc', () => {
  const ts = 1722470400000;
  const row = normalizeCandleRow({
    ts_ms: ts,
    datetime_utc: '2024-08-01 00:00:00',
    open: 1, high: 2, low: 0.5, close: 1.5, volume: 9
  });
  assert.strictEqual(row.timestamp, ts);
  assert.strictEqual(row.close, 1.5);
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

test('getSeries attaches ETF millions and OI contracts, never oi_usd on the row', () => {
  const model = new SeriesModel();
  const pack = makePack();
  pack.etf_btc = {
    data: [
      { date_utc: '2026-08-10', net_flow_usd_millions: 15.2, net_flow_usd: 1.52e7 },
      { date_utc: '2026-08-09', net_flow_usd_millions: '' }
    ],
    missing: false,
    filename: 'etf_btc_daily_net_flows.csv'
  };
  pack.oi_swap_1d = {
    data: [
      { date_utc: '2026-08-10', oi: 2.1e6, oi_usd: 2.0e9 }
    ],
    missing: false,
    filename: 'okx_btc_usdt_swap_oi_1d.csv'
  };
  model.replaceData(pack);
  const btc = model.getSeries('BTC', '1d');
  const last = btc[btc.length - 1];
  assert.strictEqual(last.etf_net_flow_usd_millions, 15.2);
  assert.strictEqual(last.oi, 2.1e6);
  assert.ok(last.oi < 1e8, 'OI must be contracts, not oi_usd');
  const blankEtf = btc.find((row) => row.timestamp === Date.parse('2026-08-09T00:00:00Z'));
  if (blankEtf) {
    assert.strictEqual(blankEtf.etf_net_flow_usd_millions, null);
  }
});

test('ETH series does not inherit BTC open interest', () => {
  const model = new SeriesModel();
  const pack = makePack();
  pack.oi_swap_1d = {
    data: [{ date_utc: '2026-08-10', oi: 2.1e6, oi_usd: 2e9 }],
    missing: false,
    filename: 'okx_btc_usdt_swap_oi_1d.csv'
  };
  model.replaceData(pack);
  const eth = model.getSeries('ETH', '1d');
  assert.ok(eth.every((row) => row.oi == null));
});
