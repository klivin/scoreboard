import { test } from 'node:test';
import assert from 'node:assert';
import { naiveBaseline, calculateMAE, calculateMAPE, generateForecast } from './forecast.js';

test('naiveBaseline returns last price', () => {
  const data = [
    { close: 100 },
    { close: 105 },
    { close: 110 }
  ];

  const naive = naiveBaseline(data, 7);
  
  assert.strictEqual(naive.prediction, 110);
  assert.strictEqual(naive.horizonDays, 7);
  assert.strictEqual(naive.method, 'naive');
});

test('calculateMAE returns correct mean absolute error', () => {
  const predictions = [100, 105, 110];
  const actuals = [102, 103, 108];
  
  const mae = calculateMAE(predictions, actuals);
  
  assert.strictEqual(mae, 2);
});

test('calculateMAE handles nulls', () => {
  const predictions = [100, null, 110];
  const actuals = [102, 103, 108];
  
  const mae = calculateMAE(predictions, actuals);
  
  assert.strictEqual(mae, 2);
});

test('calculateMAPE returns percentage error', () => {
  const predictions = [100, 100];
  const actuals = [110, 90];
  
  const mape = calculateMAPE(predictions, actuals);
  
  assert.ok(mape > 0);
  assert.ok(mape < 100);
});

test('generateForecast returns valid forecast structure', () => {
  const data = Array.from({ length: 30 }, (_, i) => ({
    close: 40000 + i * 100,
    ma20: 39500 + i * 100
  }));

  const forecast = generateForecast(data, 7);
  
  assert.strictEqual(forecast.method, 'trend');
  assert.strictEqual(forecast.horizonDays, 7);
  assert.ok(forecast.prediction > 0);
  assert.ok(forecast.upper > forecast.prediction);
  assert.ok(forecast.lower < forecast.prediction);
  assert.ok(forecast.naive > 0);
});

test('calculateMAE handles empty arrays', () => {
  const mae = calculateMAE([], []);
  assert.strictEqual(mae, null);
});

test('naive baseline handles single data point', () => {
  const data = [{ close: 42000 }];
  const naive = naiveBaseline(data, 1);
  
  assert.strictEqual(naive.prediction, 42000);
});

test('MAE naive baseline should be zero', () => {
  const data = [
    { close: 100 },
    { close: 105 },
    { close: 110 }
  ];
  
  const naive = naiveBaseline(data, 1);
  const predictions = [naive.prediction];
  const actuals = [110];
  
  const mae = calculateMAE(predictions, actuals);
  
  assert.strictEqual(mae, 0);
});
