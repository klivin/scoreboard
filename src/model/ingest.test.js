import { test } from 'node:test';
import assert from 'node:assert';
import { parseCSV } from './ingest.js';

test('parseCSV keeps date_utc and symbol as text', () => {
  const rows = parseCSV([
    'date_utc,asset_id,symbol,close',
    '2026-08-01,eth,ETH,3220',
    '2026-08-02,btc,BTC,64800'
  ].join('\n'));

  assert.strictEqual(rows[0].date_utc, '2026-08-01');
  assert.strictEqual(rows[0].symbol, 'ETH');
  assert.strictEqual(rows[0].close, 3220);
  assert.strictEqual(rows[1].close, 64800);
});

test('parseCSV does not turn empty date cells into 0', () => {
  const rows = parseCSV('date_utc,symbol,close\n,ETH,3220\n');
  assert.strictEqual(rows[0].date_utc, null);
  assert.strictEqual(rows[0].symbol, 'ETH');
});
