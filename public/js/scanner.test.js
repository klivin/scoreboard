import { test } from 'node:test';
import assert from 'node:assert';
import { ScannerTrackingStore } from './scanner/tracking-fallback.js';
import { MemoryStorage } from './investments/store.js';
import { mergeHoldingSymbols, formatScannerCell } from './scanner/model.js';

test('fallback scanner tracking namespace freezes baseline and preserves history', () => {
  const store = new ScannerTrackingStore({ storage: new MemoryStorage() });
  const added = store.addTracking({
    symbol: 'sol',
    baselinePrice: 140,
    startedAt: Date.UTC(2026, 2, 1)
  });
  assert.strictEqual(added.ok, true);
  assert.strictEqual(added.record.symbol, 'SOL');
  assert.strictEqual(added.record.baselinePrice, 140);
  assert.strictEqual(added.record.status, 'active');
  assert.strictEqual(store.getState().schemaVersion, 1);
  assert.strictEqual(store.getState().namespace, 'scanner');

  const stopped = store.stopTracking(added.record.id, {
    stopDate: '2026-04-01',
    stopPrice: 155
  });
  assert.strictEqual(stopped.status, 'stopped');
  assert.strictEqual(stopped.baselinePrice, 140);
  assert.strictEqual(stopped.history.length, 2);
  assert.strictEqual(store.getState().collections.tracking.length, 1);
});

test('mergeHoldingSymbols adds missing REAL/TRACKING symbols with missing market cells', () => {
  const rows = mergeHoldingSymbols([], {
    collections: {
      events: [{ symbol: 'AAPL', badge: 'REAL' }],
      tracking: [{ id: 't1', symbol: 'XYZ', status: 'active' }]
    }
  });
  const aapl = rows.find((r) => r.symbol === 'AAPL');
  const xyz = rows.find((r) => r.symbol === 'XYZ');
  assert.ok(aapl);
  assert.ok(xyz);
  assert.strictEqual(aapl.holdings.real, true);
  assert.strictEqual(aapl.holdings.badge, 'REAL');
  assert.strictEqual(aapl.currentPrice, null);
  assert.strictEqual(formatScannerCell(aapl.currentPrice), 'missing');
  assert.strictEqual(xyz.holdings.tracking, true);
  assert.strictEqual(xyz.assetClass, 'unknown');
});
