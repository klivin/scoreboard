const { test } = require('node:test');
const assert = require('node:assert');
const Series = require('../src/models/Series');

test('Series initializes correctly', () => {
  const series = new Series('BTC', [], { source: 'test' });
  
  assert.strictEqual(series.symbol, 'BTC');
  assert.strictEqual(series.metadata.source, 'test');
  assert.strictEqual(series.data.length, 0);
});

test('Series addPoint adds data', () => {
  const series = new Series('BTC');
  series.addPoint({ timestamp: '2024-01-01', close: 100 });
  
  assert.strictEqual(series.length(), 1);
});

test('Series getRange filters by date correctly', () => {
  const series = new Series('BTC');
  series.addPoint({ timestamp: '2024-01-01T00:00:00Z', close: 100 });
  series.addPoint({ timestamp: '2024-01-02T00:00:00Z', close: 110 });
  series.addPoint({ timestamp: '2024-01-03T00:00:00Z', close: 120 });
  
  const range = series.getRange('2024-01-02', '2024-01-03');
  
  assert.strictEqual(range.length, 2);
  assert.strictEqual(range[0].close, 110);
  assert.strictEqual(range[1].close, 120);
});

test('Series getLatest returns last n points', () => {
  const series = new Series('BTC');
  series.addPoint({ timestamp: '2024-01-01', close: 100 });
  series.addPoint({ timestamp: '2024-01-02', close: 110 });
  series.addPoint({ timestamp: '2024-01-03', close: 120 });
  
  const latest = series.getLatest(2);
  
  assert.strictEqual(latest.length, 2);
  assert.strictEqual(latest[0].close, 110);
  assert.strictEqual(latest[1].close, 120);
});

test('Series getFields filters fields correctly', () => {
  const series = new Series('BTC');
  series.addPoint({ timestamp: '2024-01-01', close: 100, volume: 1000, open: 95 });
  series.addPoint({ timestamp: '2024-01-02', close: 110, volume: 1100, open: 105 });
  
  const filtered = series.getFields(['close', 'volume']);
  
  assert.strictEqual(filtered.length, 2);
  assert.ok(filtered[0].timestamp);
  assert.ok(filtered[0].close);
  assert.ok(filtered[0].volume);
  assert.strictEqual(filtered[0].open, undefined);
});
