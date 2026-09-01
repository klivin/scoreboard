import { test } from 'node:test';
import assert from 'node:assert';
import { toCandleData, toLineData, hasZeroClose } from './chart-points.js';

test('missing close becomes whitespace, never a 0 candle', () => {
  const points = toCandleData([
    { timestamp: Date.parse('2026-08-01T00:00:00Z'), open: 3200, high: 3300, low: 3100, close: 3220 },
    { timestamp: Date.parse('2026-08-02T00:00:00Z'), open: null, high: null, low: null, close: null }
  ]);
  assert.strictEqual(points.length, 1);
  assert.ok(Number.isFinite(points[0].close));
  assert.ok(!hasZeroClose(points));
});

test('line overlay whitespace does not insert 0', () => {
  const points = toLineData([
    { timestamp: Date.parse('2026-08-01T00:00:00Z'), ma20: 3210 },
    { timestamp: Date.parse('2026-08-02T00:00:00Z'), ma20: null }
  ], 'ma20');
  assert.strictEqual(points.length, 1);
  assert.strictEqual(points[0].value, 3210);
  assert.ok(!points.some((p) => p.value === 0));
});
