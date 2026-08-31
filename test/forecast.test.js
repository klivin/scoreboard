const { test } = require('node:test');
const assert = require('node:assert');
const Forecast = require('../src/models/Forecast');

test('Forecast calculates MAE correctly', () => {
  const forecast = new Forecast('BTC', '1d', {
    value: 100,
    side: 'bullish'
  });
  
  forecast.setActual(110);
  const mae = forecast.getMeanAbsoluteError();
  
  assert.strictEqual(mae, 10);
});

test('Forecast calculates naive MAE correctly', () => {
  const forecast = new Forecast('BTC', '1d', {
    value: 100,
    side: 'bullish'
  });
  
  forecast.setNaive(95);
  forecast.setActual(110);
  const naiveMae = forecast.getNaiveMeanAbsoluteError();
  
  assert.strictEqual(naiveMae, 15);
});

test('Forecast correctly identifies when naive is better', () => {
  const forecast = new Forecast('BTC', '1d', {
    value: 100,
    side: 'bullish'
  });
  
  forecast.setNaive(108);
  forecast.setActual(110);
  
  const naiveBetter = forecast.isNaiveBetter();
  assert.strictEqual(naiveBetter, true);
});

test('Forecast correctly identifies when model is better', () => {
  const forecast = new Forecast('BTC', '1d', {
    value: 109,
    side: 'bullish'
  });
  
  forecast.setNaive(100);
  forecast.setActual(110);
  
  const naiveBetter = forecast.isNaiveBetter();
  assert.strictEqual(naiveBetter, false);
});

test('Forecast returns null comparison when actual is not set', () => {
  const forecast = new Forecast('BTC', '1d', {
    value: 100,
    side: 'bullish'
  });
  
  forecast.setNaive(95);
  
  const mae = forecast.getMeanAbsoluteError();
  const naiveMae = forecast.getNaiveMeanAbsoluteError();
  const naiveBetter = forecast.isNaiveBetter();
  
  assert.strictEqual(mae, null);
  assert.strictEqual(naiveMae, null);
  assert.strictEqual(naiveBetter, null);
});

test('Forecast stores steelman analysis', () => {
  const forecast = new Forecast('BTC', '1d', {
    value: 100,
    side: 'bullish',
    steelman: {
      pro: ['Strong momentum', 'ETF inflows'],
      con: ['Resistance ahead', 'Volume declining']
    },
    pick: 'Bullish but cautious'
  });
  
  assert.strictEqual(forecast.steelman.pro.length, 2);
  assert.strictEqual(forecast.steelman.con.length, 2);
  assert.strictEqual(forecast.pick, 'Bullish but cautious');
});

test('Forecast toJSON includes all relevant fields', () => {
  const forecast = new Forecast('BTC', '1d', {
    value: 100,
    side: 'bullish',
    confidence: 0.7
  });
  
  forecast.setNaive(95);
  forecast.setActual(105);
  
  const json = forecast.toJSON();
  
  assert.strictEqual(json.symbol, 'BTC');
  assert.strictEqual(json.horizon, '1d');
  assert.strictEqual(json.prediction.value, 100);
  assert.strictEqual(json.actual, 105);
  assert.strictEqual(json.naive, 95);
  assert.strictEqual(json.error, 5);
  assert.strictEqual(json.naiveError, 10);
  assert.strictEqual(json.naiveBetter, false);
});
