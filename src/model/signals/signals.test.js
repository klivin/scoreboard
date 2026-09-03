import { test } from 'node:test';
import assert from 'node:assert';
import { calculateEMA } from '../indicators.js';
import { emaCrossoverStrategy } from './ema-crossover.js';
import { macdCrossStrategy } from './macd-cross.js';
import { rsiRecoveryStrategy } from './rsi-recovery.js';
import { ichimokuStrategy } from './ichimoku.js';
import {
  evaluateWalkForward,
  evaluateAll,
  aggregateConsensus,
  guardSeriesAccess,
  DEFAULT_ENABLED
} from './index.js';
import { addIndicators } from '../indicators.js';

const DAY = 86400000;
const T0 = Date.parse('2025-01-01T00:00:00Z');

function candle(i, close, overrides = {}) {
  return {
    timestamp: T0 + i * DAY,
    date_utc: new Date(T0 + i * DAY).toISOString().slice(0, 10),
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1000,
    ...overrides
  };
}

function risingFallingCrossSeries() {
  const closes = [];
  for (let i = 0; i < 55; i++) closes.push(100 - i * 0.1);
  for (let i = 0; i < 80; i++) closes.push(94.5 + i * 1.2);
  return closes.map((c, i) => candle(i, c));
}

test('EMA crossover fires BUY on golden cross with true EMA50 (not pack SMA)', () => {
  const series = risingFallingCrossSeries();
  const ema20 = calculateEMA(series, 20);
  const ema50 = calculateEMA(series, 50);

  let crossIndex = -1;
  for (let i = 1; i < series.length; i++) {
    if (!Number.isFinite(ema20[i]) || !Number.isFinite(ema50[i])) continue;
    if (ema20[i - 1] <= ema50[i - 1] && ema20[i] > ema50[i]) {
      crossIndex = i;
      break;
    }
  }
  assert.ok(crossIndex > 0, 'synthetic series should have a golden cross');

  const signals = emaCrossoverStrategy.evaluate(series);
  const buy = signals.find((s) => s.signal === 'BUY');
  assert.ok(buy, 'expected BUY signal');
  assert.strictEqual(buy.timestamp, series[crossIndex].timestamp);
  assert.strictEqual(buy.inputs.maTypes.fast, 'EMA');
  assert.strictEqual(buy.inputs.maTypes.slow, 'EMA');
  assert.strictEqual(buy.inputs.emaSlowPeriod, 50);
});

test('MACD cross fires on computed MACD line vs signal (not pack MAs)', () => {
  const series = risingFallingCrossSeries();
  const signals = macdCrossStrategy.evaluate(series);
  assert.ok(signals.length > 0);
  assert.ok(signals.some((s) => s.signal === 'BUY' || s.signal === 'SELL'));
  assert.match(signals[0].inputs.computedFrom, /true MACD/);
});

test('RSI recovery requires cross back above 30 after oversold (not naive RSI<30)', () => {
  const series = [];
  let price = 100;
  for (let i = 0; i < 30; i++) {
    price *= 0.99;
    series.push(candle(i, price));
  }
  for (let i = 30; i < 40; i++) {
    price *= 1.02;
    series.push(candle(i, price));
  }

  const signals = rsiRecoveryStrategy.evaluate(series);
  const buys = signals.filter((s) => s.signal === 'BUY');
  assert.ok(buys.length >= 1, 'expected recovery BUY after oversold');
  assert.match(buys[0].inputs.rule, /crossed back above 30/);

  const naiveOversoldOnly = series.map((_, i) => {
    const slice = series.slice(0, i + 1);
    return rsiRecoveryStrategy.evaluate(slice).filter((s) => s.signal === 'BUY');
  });
  const earlyBuys = naiveOversoldOnly.slice(0, 25).flat();
  assert.strictEqual(earlyBuys.length, 0, 'should not buy on oversold alone');
});

test('Ichimoku uses pack tenkan/kijun/senkou fields', () => {
  const series = [];
  for (let i = 0; i < 60; i++) {
    const close = 100 + i;
    series.push(candle(i, close, {
      tenkan: 98 + i,
      kijun: 97 + i,
      senkouA: 90 + i,
      senkouB: 85 + i,
      chikou: close
    }));
  }
  series[55].tenkan = 160;
  series[55].kijun = 150;
  series[54].tenkan = 149;
  series[54].kijun = 150;

  const signals = ichimokuStrategy.evaluate(series);
  assert.ok(signals.length > 0);
  assert.ok(signals[0].inputs.tenkan !== undefined);
});

test('consensus aggregation exposes breakdown and score', () => {
  const consensus = aggregateConsensus([
    { id: 'a', name: 'A', signal: 'BUY', score: 1, confidence: 80, inputs: {}, invalidation: 'x' },
    { id: 'b', name: 'B', signal: 'SELL', score: -1, confidence: 60, inputs: {}, invalidation: 'y' }
  ]);
  assert.strictEqual(consensus.breakdown.length, 2);
  assert.ok(consensus.score >= -1 && consensus.score <= 1);
  assert.ok(consensus.scorePercent >= 0 && consensus.scorePercent <= 100);
});

test('walk-forward evaluate does not read future bars', () => {
  const series = addIndicators(risingFallingCrossSeries());
  let violations = 0;

  for (let t = 0; t < series.length; t++) {
    const slice = guardSeriesAccess(series, t);
    for (const id of DEFAULT_ENABLED) {
      const strategy = { emaCrossoverStrategy, macdCrossStrategy, rsiRecoveryStrategy, ichimokuStrategy }[
        id === 'ema-crossover' ? 'emaCrossoverStrategy'
          : id === 'macd-cross' ? 'macdCrossStrategy'
            : id === 'rsi-recovery' ? 'rsiRecoveryStrategy' : 'ichimokuStrategy'
      ];
      try {
        strategy.evaluate(slice, { horizon: 'weekly' });
      } catch (e) {
        if (e.message.includes('Lookahead')) violations += 1;
      }
    }
  }
  assert.strictEqual(violations, 0);
});

test('evaluateWalkForward only emits signals at bar t using data through t', () => {
  const series = addIndicators(risingFallingCrossSeries());
  const events = evaluateWalkForward(series, ['ema-crossover'], { horizon: 'weekly' });
  for (const event of events) {
    const idx = series.findIndex((r) => r.timestamp === event.timestamp);
    assert.ok(idx >= 0);
    const sliceSignals = emaCrossoverStrategy.evaluate(series.slice(0, idx + 1));
    const atT = sliceSignals.filter((s) => s.timestamp === event.timestamp);
    assert.ok(atT.length > 0, 'walk-forward signal must be reproducible from slice');
  }
});
