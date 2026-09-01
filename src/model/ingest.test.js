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

test('parseCSV keeps OKX 1h ts_ms/datetime_utc rows (does not drop on extra columns)', () => {
  const rows = parseCSV([
    'ts_ms,datetime_utc,open,high,low,close,volume,extra',
    '1722470400000,2024-08-01 00:00:00,64000,64100,63900,64050,12,keep-me'
  ].join('\n'));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].ts_ms, 1722470400000);
  assert.strictEqual(rows[0].datetime_utc, '2024-08-01 00:00:00');
  assert.strictEqual(rows[0].close, 64050);
});
