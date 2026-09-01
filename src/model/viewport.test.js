import { test } from 'node:test';
import assert from 'node:assert';
import { defaultVisibleRange, lastKnownClose, lastKnownRow, DEFAULT_VIEWPORT_DAYS } from './viewport.js';

test('default viewport is last few days, not the full dump', () => {
  const rows = [
    { timestamp: Date.parse('2026-07-01T00:00:00Z'), close: 60000 },
    { timestamp: Date.parse('2026-08-28T00:00:00Z'), close: 64000 },
    { timestamp: Date.parse('2026-08-31T00:00:00Z'), close: 65000 }
  ];
  const range = defaultVisibleRange(rows);
  assert.strictEqual(range.to, Date.parse('2026-08-31T00:00:00Z'));
  assert.strictEqual(range.from, range.to - DEFAULT_VIEWPORT_DAYS * 86400000);
  assert.ok(range.from > rows[0].timestamp);
});

test('last known close skips a blank trailing reading', () => {
  const rows = [
    { timestamp: 1, close: 3220 },
    { timestamp: 2, close: null }
  ];
  assert.strictEqual(lastKnownClose(rows), 3220);
  assert.strictEqual(lastKnownRow(rows).timestamp, 1);
});
