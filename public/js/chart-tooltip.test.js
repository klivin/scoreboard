import { test } from 'node:test';
import assert from 'node:assert';
import { buildTooltipLines, formatMissingOr } from './chart-tooltip.js';

test('tooltip says missing, not 0, for blank volume / ETF / OI', () => {
  const lines = buildTooltipLines({
    timestamp: Date.parse('2026-08-28T00:00:00Z'),
    close: 77822,
    ma20: 70899,
    volume: null,
    etf_net_flow_usd_millions: null,
    oi: null
  }, {
    showMA20: true,
    showVolume: true,
    showEtf: true,
    showOi: true
  });
  assert.ok(lines.some((line) => line.includes('Price: $77822')));
  assert.ok(lines.some((line) => line.includes('MA20 (EMA): $70899')));
  assert.ok(lines.some((line) => line === 'Volume: missing'));
  assert.ok(lines.some((line) => line === 'ETF net flow: missing'));
  assert.ok(lines.some((line) => line === 'Open Interest: missing'));
  assert.ok(!lines.some((line) => /Volume: 0/.test(line)));
});

test('formatMissingOr does not coerce null to 0', () => {
  assert.strictEqual(formatMissingOr(null, (v) => String(v)), 'missing');
  assert.strictEqual(formatMissingOr(0, (v) => String(v)), '0');
});
