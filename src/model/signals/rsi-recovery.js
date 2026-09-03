import { horizonParams } from './params.js';
import { rsiSeries } from './indicators.js';

/**
 * RSI threshold + recovery (not naive RSI<30=buy).
 * BUY: RSI was oversold (<30) on a prior bar and crosses back above 30.
 * SELL: RSI was overbought (>70) and crosses back below 70.
 */
export const rsiRecoveryStrategy = {
  id: 'rsi-recovery',
  name: 'RSI Oversold/Overbought Recovery',
  horizon: 'weekly',

  evaluate(series, options = {}) {
    const horizon = options.horizon || 'weekly';
    const params = horizonParams(horizon);
    const signals = [];
    const rsi = rsiSeries(series, params.rsiPeriod);

    let wasOversold = false;
    let wasOverbought = false;

    for (let i = 1; i < series.length; i++) {
      const prevRsi = rsi[i - 1];
      const currRsi = rsi[i];
      const ts = series[i].timestamp;

      if (!Number.isFinite(prevRsi) || !Number.isFinite(currRsi) || !ts) continue;

      if (prevRsi < params.rsiOversold) wasOversold = true;
      if (prevRsi > params.rsiOverbought) wasOverbought = true;

      const recoveryBuy = wasOversold && prevRsi < params.rsiOversold && currRsi >= params.rsiOversold;
      const recoverySell = wasOverbought && prevRsi > params.rsiOverbought && currRsi <= params.rsiOverbought;

      if (recoveryBuy) {
        signals.push({
          timestamp: ts,
          signal: 'BUY',
          score: 1,
          confidence: Math.min(85, 50 + (params.rsiOversold - Math.min(prevRsi, params.rsiOversold - 1)) * 2),
          inputs: {
            rsi: currRsi,
            prevRsi,
            period: params.rsiPeriod,
            rule: `recovery: was oversold, crossed back above ${params.rsiOversold}`
          },
          invalidation: `Invalid if RSI falls back below ${params.rsiOversold} without new recovery`
        });
        wasOversold = false;
      } else if (recoverySell) {
        signals.push({
          timestamp: ts,
          signal: 'SELL',
          score: -1,
          confidence: Math.min(85, 50 + (Math.max(prevRsi, params.rsiOverbought + 1) - params.rsiOverbought) * 2),
          inputs: {
            rsi: currRsi,
            prevRsi,
            period: params.rsiPeriod,
            rule: `recovery: was overbought, crossed back below ${params.rsiOverbought}`
          },
          invalidation: `Invalid if RSI rises back above ${params.rsiOverbought} without new recovery`
        });
        wasOverbought = false;
      }
    }

    return signals;
  }
};
