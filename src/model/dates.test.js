import { test } from 'node:test';
import assert from 'node:assert';
import { parseUtcTimestamp, formatUtcTick, formatPriceLabel, firstRowTimestamp } from './dates.js';

test('parseUtcTimestamp treats YYYY-MM-DD as UTC midnight', () => {
  const ms = parseUtcTimestamp('2026-08-02');
  assert.strictEqual(ms, Date.parse('2026-08-02T00:00:00Z'));
  assert.strictEqual(formatUtcTick(ms), '8/2');
  assert.strictEqual(new Date(ms).getUTCDate(), 2);
  assert.strictEqual(new Date(ms).getUTCMonth(), 7);
});

test('parseUtcTimestamp does not collapse a range to 12/31', () => {
  const labels = [
    '2026-08-01',
    '2026-08-02',
    '2026-08-03',
    '2026-08-15',
    '2026-08-30'
  ].map((d) => formatUtcTick(parseUtcTimestamp(d)));

  assert.deepStrictEqual(labels, ['8/1', '8/2', '8/3', '8/15', '8/30']);
  assert.strictEqual(new Set(labels).size, labels.length);
  assert.ok(!labels.includes('12/31'));
});

test('firstRowTimestamp prefers pack ts_ms over other aliases', () => {
  assert.strictEqual(firstRowTimestamp({ ts_ms: 1722470400000, datetime_utc: '2024-08-01 00:00:00' }), 1722470400000);
  assert.strictEqual(firstRowTimestamp({ TS_MS: 1722470400000 }), 1722470400000);
  assert.strictEqual(firstRowTimestamp({ date_utc: '2026-08-02' }), Date.parse('2026-08-02T00:00:00Z'));
});

test('parseUtcTimestamp reads OKX 1h ts_ms and datetime_utc', () => {
  const tsMs = 1722470400000;
  assert.strictEqual(parseUtcTimestamp(null, tsMs), tsMs);
  assert.strictEqual(parseUtcTimestamp(undefined, tsMs), tsMs);
  const fromText = parseUtcTimestamp('2024-08-01 00:00:00');
  assert.strictEqual(fromText, Date.parse('2024-08-01T00:00:00Z'));
});

test('formatPriceLabel keeps ETH-scale thousands and SHIB-scale fractions', () => {
  assert.strictEqual(formatPriceLabel(3220.4), '3220');
  assert.strictEqual(formatPriceLabel(64800.2), '64800');
  assert.strictEqual(formatPriceLabel(0.000012), '0.000012');
});
