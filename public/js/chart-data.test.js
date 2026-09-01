import { test } from 'node:test';
import assert from 'node:assert';
import { toCandleData, lastKnownRow, toHistogramData } from './chart-data.js';

test('client candle mapper keeps missing close as a gap', () => {
  const points = toCandleData([
    { timestamp: Date.parse('2026-08-30T00:00:00Z'), open: 3900, high: 3950, low: 3880, close: 3920 },
    { timestamp: Date.parse('2026-08-31T00:00:00Z'), open: null, high: null, low: null, close: null }
  ]);
  assert.strictEqual(points.length, 1);
  assert.ok(Number.isFinite(points[0].close));
  assert.strictEqual(lastKnownRow([
    { close: 3920 },
    { close: null }
  ]).close, 3920);
});

test('histogram skips blank ETF/volume instead of plotting 0', () => {
  const points = toHistogramData([
    { timestamp: Date.parse('2026-08-28T00:00:00Z'), etf_net_flow_usd_millions: 12.4 },
    { timestamp: Date.parse('2026-08-29T00:00:00Z'), etf_net_flow_usd_millions: null }
  ], 'etf_net_flow_usd_millions');
  assert.strictEqual(points.length, 1);
  assert.strictEqual(points[0].value, 12.4);
  assert.ok(!points.some((point) => point.value === 0));
});
