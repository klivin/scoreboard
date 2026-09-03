import { test } from 'node:test';
import assert from 'node:assert';
import {
  maturityStatus,
  scoreAgainstActual,
  rescoreForecastRecord,
  buildScoredForecast,
  generateWalkForwardForecasts,
  emptyScore
} from './forecast-score.js';
import { migrateForecastStore, migrateForecastItem } from './forecast-schema.js';

const DAY = 86400000;
const START = Date.parse('2026-01-01T00:00:00Z');

function bar(dayOffset, close) {
  const timestamp = START + dayOffset * DAY;
  const date = new Date(timestamp);
  return {
    timestamp,
    date_utc: date.toISOString().slice(0, 10),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    ma20: close - 2
  };
}

function seriesThrough(lastDay, closeAt = (d) => 100 + d) {
  const rows = [];
  for (let d = 0; d <= lastDay; d += 1) {
    rows.push(bar(d, closeAt(d)));
  }
  return rows;
}

test('maturity: too-early when last bar is before the target UTC day', () => {
  const asOf = START;
  const series = seriesThrough(3);
  const result = maturityStatus({ asOfTimestamp: asOf, horizonDays: 7, series });
  assert.strictEqual(result.status, 'too-early');
  assert.strictEqual(result.actual, null);
  assert.ok(Number.isFinite(result.targetTimestamp));
});

test('maturity: matured when target-day close is finite', () => {
  const asOf = START;
  const series = seriesThrough(10, (d) => 100 + d);
  const result = maturityStatus({ asOfTimestamp: asOf, horizonDays: 7, series });
  assert.strictEqual(result.status, 'matured');
  assert.strictEqual(result.actual.close, 107);
  assert.strictEqual(result.actual.dateUtc, '2026-01-08');
});

test('maturity: missing-actual when target day elapsed but close is blank', () => {
  const asOf = START;
  const series = seriesThrough(10, (d) => 100 + d);
  series[7].close = null;
  const result = maturityStatus({ asOfTimestamp: asOf, horizonDays: 7, series });
  assert.strictEqual(result.status, 'missing-actual');
  assert.strictEqual(result.actual, null);
});

test('maturity: missing-actual when target day elapsed but the bar is absent', () => {
  const asOf = START;
  const series = seriesThrough(10, (d) => 100 + d).filter((row, i) => i !== 7);
  const result = maturityStatus({ asOfTimestamp: asOf, horizonDays: 7, series });
  assert.strictEqual(result.status, 'missing-actual');
  assert.strictEqual(result.actual, null);
});

test('maturity transitions too-early → matured → missing-actual as bars change', () => {
  const asOf = START;
  let series = seriesThrough(4);
  assert.strictEqual(maturityStatus({ asOfTimestamp: asOf, horizonDays: 7, series }).status, 'too-early');

  series = seriesThrough(10);
  const matured = maturityStatus({ asOfTimestamp: asOf, horizonDays: 7, series });
  assert.strictEqual(matured.status, 'matured');
  assert.ok(Number.isFinite(matured.actual.close));

  series[7].close = undefined;
  assert.strictEqual(maturityStatus({ asOfTimestamp: asOf, horizonDays: 7, series }).status, 'missing-actual');
});

test('MAE vs naive on a synthetic matured case — model better, direction hit', () => {
  const scored = scoreAgainstActual(110, 100, 108, 100);
  assert.strictEqual(scored.mae, 2);
  assert.strictEqual(scored.naiveMae, 8);
  assert.strictEqual(scored.maeVsNaive, 'better');
  assert.strictEqual(scored.direction, 'hit');
  assert.strictEqual(scored.naiveDirection, 'miss');
});

test('MAE vs naive when naive wins', () => {
  const scored = scoreAgainstActual(120, 100, 101, 100);
  assert.strictEqual(scored.mae, 19);
  assert.strictEqual(scored.naiveMae, 1);
  assert.strictEqual(scored.maeVsNaive, 'worse');
});

test('never fake 0 MAE when not matured', () => {
  const early = emptyScore();
  assert.strictEqual(early.mae, null);
  assert.strictEqual(early.naiveMae, null);

  const missing = scoreAgainstActual(110, 100, null, 100);
  assert.strictEqual(missing.mae, null);
  assert.strictEqual(missing.naiveMae, null);
  assert.notStrictEqual(missing.mae, 0);

  const record = {
    asOfTimestamp: START,
    horizonDays: 7,
    asOfPrice: 100,
    predicted: { point: 110 },
    naive: { point: 100 },
    status: 'too-early',
    score: { mae: 0, naiveMae: 0 }
  };
  const rescored = rescoreForecastRecord(record, seriesThrough(3));
  assert.strictEqual(rescored.status, 'too-early');
  assert.strictEqual(rescored.score.mae, null);
  assert.strictEqual(rescored.score.naiveMae, null);
  assert.strictEqual(rescored.actual, null);
});

test('rescoreForecastRecord fills MAE only after the series matures', () => {
  const record = {
    asOfTimestamp: START,
    asOfPrice: 100,
    horizonDays: 7,
    predicted: { point: 110 },
    naive: { point: 100 }
  };
  const early = rescoreForecastRecord(record, seriesThrough(2));
  assert.strictEqual(early.status, 'too-early');
  assert.strictEqual(early.score.mae, null);

  const matured = rescoreForecastRecord(record, seriesThrough(10, (d) => 100 + d));
  assert.strictEqual(matured.status, 'matured');
  assert.strictEqual(matured.score.mae, Math.abs(110 - 107));
  assert.strictEqual(matured.score.naiveMae, Math.abs(100 - 107));
});

test('buildScoredForecast + walk-forward use real series closes only', () => {
  const data = [];
  for (let i = 0; i < 50; i += 1) {
    data.push({
      ...bar(i, 200 + i * 2),
      ma20: 190 + i
    });
  }
  const latest = buildScoredForecast({
    seriesAsOf: data,
    fullSeries: data,
    symbol: 'BTC',
    horizon: 'weekly'
  });
  assert.strictEqual(latest.symbol, 'BTC');
  assert.strictEqual(latest.horizon, 'weekly');
  assert.strictEqual(latest.horizonDays, 7);
  assert.strictEqual(latest.status, 'too-early');
  assert.strictEqual(latest.score.mae, null);
  assert.ok(latest.rationale);
  assert.ok(latest.features);

  const history = generateWalkForwardForecasts(data, { symbol: 'BTC', horizons: ['weekly'] });
  assert.ok(history.length > 0);
  const matured = history.filter((row) => row.status === 'matured');
  assert.ok(matured.length > 0);
  for (const row of matured) {
    assert.ok(Number.isFinite(row.actual.close));
    assert.ok(row.score.mae == null || Number.isFinite(row.score.mae));
  }
  const early = history.filter((row) => row.status === 'too-early');
  for (const row of early) {
    assert.strictEqual(row.score.mae, null);
  }
});

test('migrateForecastStore wraps unversioned generate-cards and does not invent MAE', () => {
  const migrated = migrateForecastStore({
    items: [{
      id: 'old_1',
      symbol: 'ETH',
      horizonDays: 7,
      timestamp: START,
      forecast: {
        symbol: 'ETH',
        prediction: 2200,
        lower: 2100,
        upper: 2300,
        naive: 2150,
        side: 'LONG',
        confidence: 70,
        proCase: 'up',
        conCase: 'down'
      }
    }]
  });
  assert.strictEqual(migrated.schemaVersion, 1);
  assert.strictEqual(migrated.namespace, 'forecasts');
  assert.strictEqual(migrated.items.length, 1);
  assert.strictEqual(migrated.items[0].symbol, 'ETH');
  assert.strictEqual(migrated.items[0].horizon, 'weekly');
  assert.strictEqual(migrated.items[0].predicted.point, 2200);
  assert.strictEqual(migrated.items[0].status, 'too-early');
  assert.strictEqual(migrated.items[0].score.mae, null);

  const item = migrateForecastItem(null);
  assert.strictEqual(item, null);
});
