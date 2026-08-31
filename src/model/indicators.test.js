import { test } from 'node:test';
import assert from 'node:assert';
import { calculateSMA, calculateEMA, calculateIchimoku } from './indicators.js';

test('calculateSMA returns correct moving average', () => {
  const data = [
    { close: 100 },
    { close: 102 },
    { close: 104 },
    { close: 103 },
    { close: 105 }
  ];

  const sma3 = calculateSMA(data, 3, 'close');
  
  assert.strictEqual(sma3[0], null);
  assert.strictEqual(sma3[1], null);
  assert.strictEqual(sma3[2], 102);
  assert.strictEqual(sma3[3], 103);
  assert.strictEqual(sma3[4], 104);
});

test('calculateEMA returns exponential moving average', () => {
  const data = [
    { close: 100 },
    { close: 102 },
    { close: 104 }
  ];

  const ema2 = calculateEMA(data, 2, 'close');
  
  assert.strictEqual(ema2[0], null);
  assert.notStrictEqual(ema2[1], null);
  assert.notStrictEqual(ema2[2], null);
});

test('calculateIchimoku returns valid structure', () => {
  const data = Array.from({ length: 60 }, (_, i) => ({
    high: 100 + i,
    low: 90 + i,
    close: 95 + i
  }));

  const ichimoku = calculateIchimoku(data);
  
  assert.strictEqual(ichimoku.length, data.length);
  assert.strictEqual(typeof ichimoku[59].tenkan, 'number');
  assert.strictEqual(typeof ichimoku[59].kijun, 'number');
});

test('calculateSMA handles empty data', () => {
  const sma = calculateSMA([], 5);
  assert.strictEqual(sma.length, 0);
});

test('calculateSMA with period larger than data returns nulls', () => {
  const data = [{ close: 100 }, { close: 101 }];
  const sma5 = calculateSMA(data, 5, 'close');
  
  assert.strictEqual(sma5[0], null);
  assert.strictEqual(sma5[1], null);
});
