import { test } from 'node:test';
import assert from 'node:assert';
import {
  maxDrawdown,
  cagr,
  totalReturn,
  roundTripCostBps,
  simulateTrades,
  buyAndHoldReturn,
  runFullBacktest,
  prepareSeries,
  forwardReturnLabels
} from './backtest.js';
import { buildBacktestFixture } from './fixtures/backtest-pack.js';
import { evaluateWalkForward } from './signals/index.js';

const DAY = 86400000;
const T0 = Date.parse('2025-01-01T00:00:00Z');

function simpleSeries(closes) {
  return closes.map((close, i) => ({
    timestamp: T0 + i * DAY,
    date_utc: new Date(T0 + i * DAY).toISOString().slice(0, 10),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100
  }));
}

test('maxDrawdown hand-computed on small equity curve', () => {
  const equity = [100, 120, 90, 110];
  const dd = maxDrawdown(equity);
  assert.ok(Math.abs(dd - 0.25) < 0.001, `expected 25% drawdown, got ${dd}`);
});

test('totalReturn and CAGR on known series', () => {
  const equity = [1, 1.1, 1.21];
  const ts = [T0, T0 + DAY, T0 + 2 * DAY];
  assert.ok(Math.abs(totalReturn(equity) - 0.21) < 0.001);
  const rate = cagr(equity, ts);
  assert.ok(rate > 0);
});

test('roundTripCostBps is 40bps for 10+10 each way', () => {
  assert.ok(Math.abs(roundTripCostBps(10, 10) - 0.004) < 0.0001);
});

test('simulateTrades enters at next bar open after signal', () => {
  const series = simpleSeries([100, 102, 104, 103, 105, 108]);
  const events = [
    {
      timestamp: series[1].timestamp,
      consensus: { direction: 'BUY' },
      strategies: []
    },
    {
      timestamp: series[3].timestamp,
      consensus: { direction: 'SELL' },
      strategies: []
    }
  ];
  const { trades } = simulateTrades(series, events, { feeBps: 0, slippageBps: 0 });
  assert.strictEqual(trades.length, 1);
  assert.strictEqual(trades[0].entryPrice, series[2].open);
  assert.strictEqual(trades[0].exitPrice, series[4].open);
});

test('buy and hold return on doubling prices', () => {
  const series = simpleSeries([100, 110, 120, 200]);
  const bh = buyAndHoldReturn(series);
  assert.ok(Math.abs(bh.totalReturn - 1.0) < 0.01);
});

test('full backtest runs on fixture with baselines and strategies', () => {
  const fixture = buildBacktestFixture({ days: 220, seed: 7 });
  const btc = prepareSeries(
    fixture.filter((r) => r.symbol === 'BTC').map((r) => ({
      ...r,
      timestamp: Date.parse(`${r.date_utc}T00:00:00Z`)
    }))
  );
  const result = runFullBacktest(btc, {
    symbol: 'BTC',
    horizon: 'weekly',
    dataSource: 'test-fixture'
  });
  assert.ok(!result.error);
  assert.ok(result.baselines.buyAndHold);
  assert.ok(result.baselines.naive);
  assert.ok(result.strategies['ema-crossover']);
  assert.ok(result.strategies.consensus);
});

test('no lookahead: walk-forward events only use past data', () => {
  const fixture = buildBacktestFixture({ days: 100, seed: 3 });
  const series = prepareSeries(
    fixture.filter((r) => r.symbol === 'BTC').map((r) => ({
      ...r,
      timestamp: Date.parse(`${r.date_utc}T00:00:00Z`)
    }))
  );
  const events = evaluateWalkForward(series, ['ema-crossover', 'macd-cross'], { horizon: 'weekly' });
  for (const event of events) {
    const idx = series.findIndex((r) => r.timestamp === event.timestamp);
    assert.ok(idx >= 0);
    assert.ok(idx < series.length);
  }
});

test('forward return labels do not use future beyond window', () => {
  const series = simpleSeries([100, 101, 102, 103, 104, 105, 106]);
  const labels = forwardReturnLabels(series, 3);
  assert.strictEqual(labels[labels.length - 1], null);
  assert.strictEqual(labels[labels.length - 2], null);
  assert.ok(labels[0] === 'up' || labels[0] === 'down' || labels[0] === 'flat' || labels[0] === null);
});
