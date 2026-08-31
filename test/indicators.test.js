const { test } = require('node:test');
const assert = require('node:assert');
const { 
  calculateSMA, 
  calculateEMA, 
  calculateIchimoku,
  calculateNaiveForecast,
  calculateMovingAverages
} = require('../src/utils/indicators');

test('calculateSMA returns correct simple moving average', () => {
  const data = [
    { close: 100 },
    { close: 110 },
    { close: 105 },
    { close: 115 },
    { close: 120 }
  ];
  
  const sma3 = calculateSMA(data, 3);
  const expected = (105 + 115 + 120) / 3;
  assert.strictEqual(sma3, expected);
});

test('calculateSMA returns null when insufficient data', () => {
  const data = [{ close: 100 }, { close: 110 }];
  const sma5 = calculateSMA(data, 5);
  assert.strictEqual(sma5, null);
});

test('calculateEMA returns a number for sufficient data', () => {
  const data = Array.from({ length: 30 }, (_, i) => ({ close: 100 + i }));
  const ema20 = calculateEMA(data, 20);
  assert.ok(typeof ema20 === 'number');
  assert.ok(ema20 > 0);
});

test('calculateEMA returns null when insufficient data', () => {
  const data = [{ close: 100 }, { close: 110 }];
  const ema20 = calculateEMA(data, 20);
  assert.strictEqual(ema20, null);
});

test('calculateMovingAverages returns all MAs when data sufficient', () => {
  const data = Array.from({ length: 250 }, (_, i) => ({ close: 100 + i * 0.5 }));
  const mas = calculateMovingAverages(data);
  
  assert.ok(mas.ema20 !== undefined);
  assert.ok(mas.sma20 !== undefined);
  assert.ok(mas.sma50 !== undefined);
  assert.ok(mas.sma100 !== undefined);
  assert.ok(mas.sma200 !== undefined);
});

test('calculateMovingAverages only returns available MAs', () => {
  const data = Array.from({ length: 30 }, (_, i) => ({ close: 100 + i }));
  const mas = calculateMovingAverages(data);
  
  assert.ok(mas.ema20 !== undefined);
  assert.ok(mas.sma20 !== undefined);
  assert.ok(mas.sma50 === undefined);
  assert.ok(mas.sma100 === undefined);
  assert.ok(mas.sma200 === undefined);
});

test('calculateIchimoku returns correct structure', () => {
  const data = Array.from({ length: 60 }, (_, i) => ({
    high: 100 + i + Math.random() * 5,
    low: 100 + i - Math.random() * 5,
    close: 100 + i
  }));
  
  const ichimoku = calculateIchimoku(data);
  
  assert.ok(ichimoku !== null);
  assert.ok(typeof ichimoku.tenkan === 'number');
  assert.ok(typeof ichimoku.kijun === 'number');
  assert.ok(typeof ichimoku.senkouA === 'number');
  assert.ok(typeof ichimoku.senkouB === 'number');
  assert.ok(typeof ichimoku.chikou === 'number');
});

test('calculateIchimoku returns null when insufficient data', () => {
  const data = Array.from({ length: 20 }, (_, i) => ({ close: 100 + i }));
  const ichimoku = calculateIchimoku(data);
  assert.strictEqual(ichimoku, null);
});

test('calculateIchimoku tenkan and kijun are reasonable', () => {
  const data = Array.from({ length: 60 }, (_, i) => ({
    high: 110,
    low: 90,
    close: 100
  }));
  
  const ichimoku = calculateIchimoku(data);
  const expectedMidpoint = (110 + 90) / 2;
  
  assert.strictEqual(ichimoku.tenkan, expectedMidpoint);
  assert.strictEqual(ichimoku.kijun, expectedMidpoint);
});

test('calculateNaiveForecast returns last close value', () => {
  const data = [
    { close: 100 },
    { close: 110 },
    { close: 105 }
  ];
  
  const naive = calculateNaiveForecast(data);
  assert.strictEqual(naive, 105);
});

test('calculateNaiveForecast handles value field', () => {
  const data = [
    { value: 100 },
    { value: 110 },
    { value: 105 }
  ];
  
  const naive = calculateNaiveForecast(data);
  assert.strictEqual(naive, 105);
});

test('calculateNaiveForecast returns null for empty data', () => {
  const naive = calculateNaiveForecast([]);
  assert.strictEqual(naive, null);
});
