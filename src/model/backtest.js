import { naiveBaseline } from './forecast.js';
import { addIndicators } from './indicators.js';
import {
  evaluateWalkForward,
  aggregateConsensus,
  DEFAULT_ENABLED,
  STRATEGY_BY_ID
} from './signals/index.js';
import { buildBacktestFixture, MIN_BACKTEST_DAYS } from './fixtures/backtest-pack.js';
import { seriesModel } from './series.js';

export const DEFAULT_FEE_BPS = 10;
export const DEFAULT_SLIPPAGE_BPS = 10;

/**
 * Total round-trip cost in fractional terms (entry + exit).
 */
export function roundTripCostBps(feeBps = DEFAULT_FEE_BPS, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  return 2 * (feeBps + slippageBps) / 10000;
}

export function maxDrawdown(equityCurve) {
  if (!equityCurve.length) return 0;
  let peak = equityCurve[0];
  let maxDd = 0;
  for (const value of equityCurve) {
    if (value > peak) peak = value;
    const dd = peak > 0 ? (peak - value) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

export function cagr(equityCurve, timestamps) {
  if (equityCurve.length < 2 || !timestamps.length) return 0;
  const start = equityCurve[0];
  const end = equityCurve[equityCurve.length - 1];
  const ms = timestamps[timestamps.length - 1] - timestamps[0];
  const years = ms / (365.25 * 86400000);
  if (years <= 0 || start <= 0) return 0;
  return Math.pow(end / start, 1 / years) - 1;
}

export function totalReturn(equityCurve) {
  if (equityCurve.length < 2) return 0;
  return (equityCurve[equityCurve.length - 1] / equityCurve[0]) - 1;
}

/**
 * Label bars with forward return sign over `forwardBars` (for precision/recall).
 */
export function forwardReturnLabels(series, forwardBars = 5) {
  const labels = new Array(series.length).fill(null);
  for (let i = 0; i < series.length - forwardBars; i++) {
    const curr = series[i].close;
    const future = series[i + forwardBars].close;
    if (!Number.isFinite(curr) || !Number.isFinite(future) || curr === 0) continue;
    const ret = (future - curr) / curr;
    labels[i] = ret > 0.005 ? 'up' : (ret < -0.005 ? 'down' : 'flat');
  }
  return labels;
}

export function signalMetrics(signals, labels, direction = 'BUY') {
  const filtered = signals.filter((s) => s.signal === direction);
  const sampleSize = filtered.length;
  if (sampleSize === 0) {
    return { precision: null, recall: null, hitRate: null, sampleSize: 0 };
  }

  const indexByTs = new Map();
  labels.forEach((label, i) => {
    if (label) indexByTs.set(i, label);
  });

  let truePos = 0;
  let hits = 0;
  const targetLabel = direction === 'BUY' ? 'up' : 'down';

  for (const sig of filtered) {
    const idx = sig._index;
    const label = idx !== undefined ? labels[idx] : null;
    if (label === targetLabel) truePos += 1;
    if (label && label !== 'flat') {
      if ((direction === 'BUY' && label === 'up') || (direction === 'BUY' && label === 'down')) {
        hits += label === targetLabel ? 1 : 0;
      }
    }
  }

  const positives = labels.filter((l) => l === targetLabel).length;
  const precision = sampleSize > 0 ? truePos / sampleSize : null;
  const recall = positives > 0 ? truePos / positives : null;
  const hitRate = sampleSize > 0 ? hits / sampleSize : null;

  return { precision, recall, hitRate, sampleSize };
}

/**
 * Simulate fixed-fraction long/flat strategy. Entries/exits at next bar open.
 */
export function simulateTrades(series, events, {
  feeBps = DEFAULT_FEE_BPS,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  positionFraction = 1
} = {}) {
  const trades = [];
  let position = 0;
  let entryPrice = null;
  let entryTs = null;
  let cash = 1;
  const equity = [];
  const equityTs = [];

  const eventByTs = new Map(events.map((e) => [e.timestamp, e]));

  for (let i = 0; i < series.length; i++) {
    const row = series[i];
    const next = series[i + 1];
    const event = eventByTs.get(row.timestamp);
    const direction = event?.consensus?.direction;

    if (next && direction === 'BUY' && position === 0 && Number.isFinite(next.open)) {
      position = positionFraction;
      entryPrice = next.open * (1 + (feeBps + slippageBps) / 10000);
      entryTs = next.timestamp;
    } else if (next && (direction === 'SELL' || direction === 'CLOSE') && position > 0 && Number.isFinite(next.open)) {
      const exitPrice = next.open * (1 - (feeBps + slippageBps) / 10000);
      const pnl = (exitPrice - entryPrice) / entryPrice;
      cash *= (1 + pnl * position);
      trades.push({
        entryTimestamp: entryTs,
        exitTimestamp: next.timestamp,
        entryPrice,
        exitPrice,
        pnlFraction: pnl,
        direction: 'long',
        consensus: event?.consensus
      });
      position = 0;
      entryPrice = null;
      entryTs = null;
    }

    let mark = cash;
    if (position > 0 && Number.isFinite(row.close) && Number.isFinite(entryPrice)) {
      mark = cash * (1 + ((row.close - entryPrice) / entryPrice) * position);
    }
    equity.push(mark);
    equityTs.push(row.timestamp);
  }

  return { trades, equity, equityTs, turnover: trades.length };
}

export function buyAndHoldReturn(series) {
  const first = series.find((r) => Number.isFinite(r.open) || Number.isFinite(r.close));
  const last = [...series].reverse().find((r) => Number.isFinite(r.close));
  if (!first || !last) return { totalReturn: 0, cagr: 0, maxDrawdown: 0 };
  const start = first.open ?? first.close;
  const end = last.close;
  const equity = series.filter((r) => Number.isFinite(r.close)).map((r) => r.close / start);
  const ts = series.filter((r) => Number.isFinite(r.close)).map((r) => r.timestamp);
  return {
    totalReturn: end / start - 1,
    cagr: cagr(equity, ts),
    maxDrawdown: maxDrawdown(equity)
  };
}

/**
 * Naive baseline: go long when naive forecast > current close, flat otherwise.
 * Uses only data through bar t; acts at t+1 open.
 */
export function naiveStrategyReturn(series, horizonDays = 7, feeBps = DEFAULT_FEE_BPS, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  const cost = roundTripCostBps(feeBps, slippageBps);
  let position = 0;
  let entryPrice = null;
  const equity = [1];
  const equityTs = [series[0]?.timestamp || 0];
  const trades = [];

  for (let i = 0; i < series.length - 1; i++) {
    const hist = series.slice(0, i + 1);
    const naive = naiveBaseline(hist, horizonDays);
    const currClose = series[i].close;
    const nextOpen = series[i + 1].open ?? series[i + 1].close;

    const goLong = naive && Number.isFinite(naive.prediction) && Number.isFinite(currClose)
      && naive.prediction > currClose;

    if (goLong && position === 0 && Number.isFinite(nextOpen)) {
      position = 1;
      entryPrice = nextOpen * (1 + (feeBps + slippageBps) / 10000);
    } else if (!goLong && position > 0 && Number.isFinite(nextOpen)) {
      const exitPrice = nextOpen * (1 - (feeBps + slippageBps) / 10000);
      const pnl = (exitPrice - entryPrice) / entryPrice - cost;
      equity.push(equity[equity.length - 1] * (1 + pnl));
      equityTs.push(series[i + 1].timestamp);
      trades.push({ pnlFraction: pnl });
      position = 0;
    } else {
      equity.push(equity[equity.length - 1]);
      equityTs.push(series[i].timestamp);
    }
  }

  return {
    totalReturn: totalReturn(equity),
    cagr: cagr(equity, equityTs),
    maxDrawdown: maxDrawdown(equity),
    turnover: trades.length,
    trades
  };
}

export function runStrategyBacktest(series, strategyId, options = {}) {
  const enabled = strategyId === 'consensus' ? (options.enabled || DEFAULT_ENABLED) : [strategyId];
  const events = evaluateWalkForward(series, enabled, options);
  const labels = forwardReturnLabels(series, options.forwardBars || 5);

  const flatSignals = [];
  for (let i = 0; i < series.length; i++) {
    const ev = events.find((e) => e.timestamp === series[i].timestamp);
    if (ev) {
      const primary = ev.strategies.find((s) => s.id === strategyId) || ev.strategies[0];
      flatSignals.push({
        ...primary,
        signal: strategyId === 'consensus' ? ev.consensus.direction : primary?.signal,
        _index: i,
        consensus: ev.consensus
      });
    }
  }

  const buyMetrics = signalMetrics(
    flatSignals.filter((s) => s.signal === 'BUY' || (strategyId === 'consensus' && s.signal === 'BUY')),
    labels,
    'BUY'
  );
  const sim = simulateTrades(series, events, options);
  const hitRate = sim.trades.length > 0
    ? sim.trades.filter((t) => t.pnlFraction > 0).length / sim.trades.length
    : null;

  return {
    strategyId,
    signalCount: flatSignals.length,
    buyMetrics,
    hitRate,
    maxDrawdown: maxDrawdown(sim.equity),
    cagr: cagr(sim.equity, sim.equityTs),
    totalReturn: totalReturn(sim.equity),
    turnover: sim.turnover,
    trades: sim.trades,
    events
  };
}

export function runFullBacktest(series, options = {}) {
  const prepared = prepareSeries(series);
  if (prepared.length < MIN_BACKTEST_DAYS) {
    return { error: `Series too short (${prepared.length} bars, need ${MIN_BACKTEST_DAYS}+)` };
  }

  const baselines = {
    buyAndHold: buyAndHoldReturn(prepared),
    naive: naiveStrategyReturn(prepared, options.horizonDays || 7, options.feeBps, options.slippageBps)
  };

  const enabled = options.enabled || DEFAULT_ENABLED;
  const strategies = {};
  for (const id of enabled) {
    if (!STRATEGY_BY_ID[id]) continue;
    strategies[id] = runStrategyBacktest(prepared, id, options);
  }
  strategies.consensus = runStrategyBacktest(prepared, 'consensus', { ...options, enabled });

  return {
    symbol: options.symbol || 'unknown',
    barCount: prepared.length,
    dateRange: {
      from: prepared[0].date_utc,
      to: prepared[prepared.length - 1].date_utc
    },
    feeBps: options.feeBps ?? DEFAULT_FEE_BPS,
    slippageBps: options.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    horizon: options.horizon || 'weekly',
    baselines,
    strategies,
    dataSource: options.dataSource || 'unknown'
  };
}

export function prepareSeries(raw) {
  const withTs = raw.filter((r) => r.timestamp || r.date_utc).map((r) => ({
    ...r,
    timestamp: r.timestamp || Date.parse(`${r.date_utc}T00:00:00Z`)
  }));
  withTs.sort((a, b) => a.timestamp - b.timestamp);
  const needsIndicators = withTs.some((r) => !Number.isFinite(r.ma20));
  return needsIndicators ? addIndicators(withTs) : withTs;
}

export function loadBacktestSeries(symbol = 'BTC') {
  try {
    seriesModel.load();
    const data = seriesModel.getIndicators(symbol, '1d');
    if (data.length >= MIN_BACKTEST_DAYS) {
      return { series: prepareSeries(data), dataSource: 'flow-pack' };
    }
  } catch {
    /* fall through */
  }

  const fixture = buildBacktestFixture({ days: 280 });
  const sym = String(symbol).toUpperCase();
  const filtered = fixture.filter((r) => r.symbol === sym).map((r) => ({
    ...r,
    timestamp: Date.parse(`${r.date_utc}T00:00:00Z`)
  }));
  return {
    series: prepareSeries(filtered),
    dataSource: 'deterministic-fixture (Flow pack not mounted)'
  };
}

export function formatBacktestReport(result) {
  if (result.error) return `Backtest error: ${result.error}`;

  const lines = [
    `# Backtest Report — ${result.symbol}`,
    '',
    `**Data source:** ${result.dataSource}`,
    `**Bars:** ${result.barCount} (${result.dateRange.from} → ${result.dateRange.to})`,
    `**Horizon:** ${result.horizon}`,
    `**Fees/slippage:** ${result.feeBps}bps each way`,
    '',
    '## Baselines',
    '',
    `| Metric | Buy & Hold | Naive Forecaster |`,
    `|--------|------------|------------------|`,
    `| Total return | ${pct(result.baselines.buyAndHold.totalReturn)} | ${pct(result.baselines.naive.totalReturn)} |`,
    `| CAGR | ${pct(result.baselines.buyAndHold.cagr)} | ${pct(result.baselines.naive.cagr)} |`,
    `| Max drawdown | ${pct(result.baselines.buyAndHold.maxDrawdown)} | ${pct(result.baselines.naive.maxDrawdown)} |`,
    `| Turnover | 1 (hold) | ${result.baselines.naive.turnover} |`,
    '',
    '## Strategies vs baselines',
    ''
  ];

  for (const [id, stats] of Object.entries(result.strategies)) {
    const beatsBh = stats.totalReturn > result.baselines.buyAndHold.totalReturn;
    const beatsNaive = stats.totalReturn > result.baselines.naive.totalReturn;
    lines.push(`### ${id}`);
    lines.push(`- Total return: ${pct(stats.totalReturn)} (beats B&H: ${beatsBh ? 'yes' : 'no'}, beats naive: ${beatsNaive ? 'yes' : 'no'})`);
    lines.push(`- CAGR: ${pct(stats.cagr)}`);
    lines.push(`- Max drawdown: ${pct(stats.maxDrawdown)}`);
    lines.push(`- Hit rate (trade PnL): ${stats.hitRate != null ? pct(stats.hitRate) : 'n/a'}`);
    lines.push(`- Precision (BUY, 5-bar fwd): ${stats.buyMetrics.precision != null ? pct(stats.buyMetrics.precision) : 'n/a'}`);
    lines.push(`- Recall (BUY, 5-bar fwd): ${stats.buyMetrics.recall != null ? pct(stats.buyMetrics.recall) : 'n/a'}`);
    lines.push(`- Signals: ${stats.signalCount}, Trades: ${stats.turnover}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('*Research only. Not a trade recommendation.*');
  return lines.join('\n');
}

function pct(value) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(2)}%`;
}
