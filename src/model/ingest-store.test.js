import { test } from 'node:test';
import assert from 'node:assert';
import { applySeriesStoreToPack, overlayByTimestamp } from './ingest-store.js';

test('overlayByTimestamp keeps same-timestamp rows for different symbols', () => {
  const ts = Date.parse('2026-09-01T00:00:00Z');
  const merged = overlayByTimestamp(
    [{ timestamp: ts, close: 80000 }],
    [
      { timestamp: ts, symbol: 'BTC', close: 80100 },
      { timestamp: ts, symbol: 'ETH', close: 3500 },
      { timestamp: ts, symbol: 'SOL', close: 140 }
    ]
  );
  const bySymbol = Object.fromEntries(merged.map((row) => [row.symbol || 'BTC', row.close]));
  assert.strictEqual(bySymbol.BTC, 80100);
  assert.strictEqual(bySymbol.ETH, 3500);
  assert.strictEqual(bySymbol.SOL, 140);
});

test('applySeriesStoreToPack does not let BTC ingest erase ETH at the same bar', () => {
  const ts = Date.parse('2026-09-01T00:00:00Z');
  const pack = {
    candles_1d: { data: [], missing: true, filename: 'okx_btc_usdt_swap_candles_1d.csv' },
    candles_1h: { data: [], missing: true },
    oi_swap_1h: { data: [] },
    oi_swap_1d: { data: [] },
    etf_btc: { data: [] },
    etf_eth: { data: [] }
  };
  applySeriesStoreToPack(pack, [
    { source: 'okx-candles', symbol: 'ETH', interval: '1d', timestamp: ts, close: 2566 },
    { source: 'okx-candles', symbol: 'BTC', interval: '1d', timestamp: ts, close: 77820 },
    { source: 'okx-candles', symbol: 'SOL', interval: '1d', timestamp: ts, close: 102 }
  ]);
  const packCloses = Object.fromEntries(
    (pack.candles_1d.data || []).map((row) => [row.symbol || 'BTC', row.close])
  );
  assert.strictEqual(packCloses.BTC, 77820);
  assert.ok(!packCloses.ETH, 'ETH must not land on the BTC pack candle file');
  assert.ok(!packCloses.SOL, 'SOL must not land on the BTC pack candle file');
  const liveCloses = Object.fromEntries(
    pack.live_candles.map((row) => [row.symbol, row.close])
  );
  assert.strictEqual(liveCloses.ETH, 2566);
  assert.strictEqual(liveCloses.BTC, 77820);
  assert.strictEqual(liveCloses.SOL, 102);
});
