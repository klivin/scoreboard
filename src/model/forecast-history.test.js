import { test } from 'node:test';
import assert from 'node:assert';
import { LocalStore } from './store.js';
import { generateHistoryForSeriesMap, persistForecastRecords, listForecastRecords, rescoreRecords } from './forecast-history.js';
import { mapFixtureRows } from './forecast-history.js';
import { buildBacktestFixture } from './fixtures/backtest-pack.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-fc-'));
  const store = new LocalStore('forecasts');
  store.filepath = path.join(dir, 'forecasts.json');
  store.cache = null;
  return { store, dir };
}

test('walk-forward history from fixture has matured rows with real MAE and too-early with null MAE', () => {
  const map = mapFixtureRows(buildBacktestFixture({ days: 80, seed: 7 }));
  const records = generateHistoryForSeriesMap(map, { dataSource: 'fixture' });
  assert.ok(records.length > 0);
  assert.ok(records.some((row) => row.symbol === 'BTC'));
  assert.ok(records.some((row) => row.horizon === 'weekly'));
  assert.ok(records.some((row) => row.horizon === 'monthly'));

  const matured = records.filter((row) => row.status === 'matured');
  const early = records.filter((row) => row.status === 'too-early');
  assert.ok(matured.length > 0, 'expected some matured fixture forecasts');
  for (const row of matured) {
    assert.ok(Number.isFinite(row.actual.close));
    assert.ok(Number.isFinite(row.score.mae));
    assert.ok(Number.isFinite(row.score.naiveMae));
  }
  for (const row of early) {
    assert.strictEqual(row.score.mae, null);
    assert.strictEqual(row.actual, null);
  }
});

test('schema-versioned store persist + rescore does not invent 0 MAE for too-early', () => {
  const { store, dir } = tempStore();
  const map = mapFixtureRows(buildBacktestFixture({ days: 60, seed: 3 }));
  const generated = generateHistoryForSeriesMap({ BTC: map.BTC }, { dataSource: 'fixture', horizons: ['weekly'] });
  persistForecastRecords(generated, store);

  const listed = listForecastRecords(store);
  assert.strictEqual(store.cache.schemaVersion, 1);
  assert.strictEqual(store.cache.namespace, 'forecasts');
  assert.ok(listed.length > 0);

  const rescored = rescoreRecords(listed, { BTC: map.BTC });
  for (const row of rescored) {
    if (row.status !== 'matured') {
      assert.strictEqual(row.score.mae, null);
      assert.notStrictEqual(row.score.mae, 0);
    }
  }

  fs.rmSync(dir, { recursive: true, force: true });
});
