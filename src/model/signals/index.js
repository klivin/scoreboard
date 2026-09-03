import { emaCrossoverStrategy } from './ema-crossover.js';
import { macdCrossStrategy } from './macd-cross.js';
import { rsiRecoveryStrategy } from './rsi-recovery.js';
import { ichimokuStrategy } from './ichimoku.js';
import { sliceAt } from './lookahead.js';

export const ALL_STRATEGIES = [
  emaCrossoverStrategy,
  macdCrossStrategy,
  rsiRecoveryStrategy,
  ichimokuStrategy
];

export const STRATEGY_BY_ID = Object.fromEntries(
  ALL_STRATEGIES.map((s) => [s.id, s])
);

export const DEFAULT_ENABLED = ['ema-crossover', 'macd-cross', 'rsi-recovery', 'ichimoku'];

/**
 * Walk-forward: at each bar t, evaluate each strategy on series[0..t] only.
 */
export function evaluateWalkForward(series, enabledIds, options = {}) {
  const horizon = options.horizon || 'weekly';
  const strategies = enabledIds
    .map((id) => STRATEGY_BY_ID[id])
    .filter(Boolean);

  const byTimestamp = new Map();

  for (let t = 0; t < series.length; t++) {
    const slice = sliceAt(series, t);
    const ts = series[t].timestamp;
    if (!ts) continue;

    for (const strategy of strategies) {
      const emitted = strategy.evaluate(slice, { ...options, horizon });
      const atT = emitted.filter((sig) => sig.timestamp === ts);
      for (const sig of atT) {
        if (!byTimestamp.has(ts)) {
          byTimestamp.set(ts, { timestamp: ts, strategies: [] });
        }
        byTimestamp.get(ts).strategies.push({
          id: strategy.id,
          name: strategy.name,
          ...sig
        });
      }
    }
  }

  const events = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  return events.map((event) => ({
    ...event,
    consensus: aggregateConsensus(event.strategies)
  }));
}

/**
 * Full-series evaluate (for unit tests with known synthetic crosses).
 */
export function evaluateAll(series, enabledIds, options = {}) {
  const horizon = options.horizon || 'weekly';
  const strategies = enabledIds
    .map((id) => STRATEGY_BY_ID[id])
    .filter(Boolean);

  const byTimestamp = new Map();
  for (const strategy of strategies) {
    const emitted = strategy.evaluate(series, { ...options, horizon });
    for (const sig of emitted) {
      const ts = sig.timestamp;
      if (!byTimestamp.has(ts)) {
        byTimestamp.set(ts, { timestamp: ts, strategies: [] });
      }
      byTimestamp.get(ts).strategies.push({
        id: strategy.id,
        name: strategy.name,
        ...sig
      });
    }
  }

  return [...byTimestamp.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((event) => ({
      ...event,
      consensus: aggregateConsensus(event.strategies)
    }));
}

/**
 * Transparent consensus: -1..1 score mapped to 0-100 display, with per-strategy breakdown.
 */
export function aggregateConsensus(strategyVotes) {
  if (!strategyVotes || strategyVotes.length === 0) {
    return {
      score: 0,
      scorePercent: 50,
      direction: 'NEUTRAL',
      confidence: 0,
      breakdown: []
    };
  }

  const breakdown = strategyVotes.map((v) => ({
    id: v.id,
    name: v.name,
    signal: v.signal,
    score: v.score,
    confidence: v.confidence,
    inputs: v.inputs,
    invalidation: v.invalidation,
    reason: formatVoteReason(v)
  }));

  let weightedSum = 0;
  let weightTotal = 0;
  let buyVotes = 0;
  let sellVotes = 0;

  for (const v of strategyVotes) {
    const w = (v.confidence || 50) / 100;
    if (v.signal === 'BUY') {
      weightedSum += (v.score ?? 1) * w;
      buyVotes += 1;
    } else if (v.signal === 'SELL') {
      weightedSum -= Math.abs(v.score ?? 1) * w;
      sellVotes += 1;
    }
    weightTotal += w;
  }

  const rawScore = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const clamped = Math.max(-1, Math.min(1, rawScore));
  const scorePercent = Math.round((clamped + 1) * 50);
  const avgConfidence = strategyVotes.reduce((s, v) => s + (v.confidence || 0), 0) / strategyVotes.length;

  let direction = 'NEUTRAL';
  if (buyVotes > sellVotes && clamped > 0.15) direction = 'BUY';
  else if (sellVotes > buyVotes && clamped < -0.15) direction = 'SELL';
  else if (strategyVotes.some((v) => v.signal === 'CLOSE')) direction = 'CLOSE';

  return {
    score: clamped,
    scorePercent,
    direction,
    confidence: Math.round(avgConfidence),
    breakdown
  };
}

function formatVoteReason(vote) {
  if (vote.id === 'ema-crossover') {
    return `${vote.signal}: EMA${vote.inputs?.emaFastPeriod} crossed ${vote.signal === 'BUY' ? 'above' : 'below'} EMA${vote.inputs?.emaSlowPeriod} (both true EMA)`;
  }
  if (vote.id === 'macd-cross') {
    return `${vote.signal}: MACD line crossed ${vote.signal === 'BUY' ? 'above' : 'below'} signal (hist ${Number(vote.inputs?.histogram || 0).toFixed(4)})`;
  }
  if (vote.id === 'rsi-recovery') {
    return `${vote.signal}: RSI recovery — ${vote.inputs?.rule || ''}`;
  }
  if (vote.id === 'ichimoku') {
    return `${vote.signal}: TK cross with ${vote.inputs?.confirmations || 0}/3 confirmations`;
  }
  return `${vote.signal} from ${vote.name}`;
}

export { sliceAt, guardSeriesAccess } from './lookahead.js';
export { horizonParams, HORIZONS } from './params.js';
