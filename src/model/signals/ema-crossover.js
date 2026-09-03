import { horizonParams } from './params.js';
import { emaSeries } from './indicators.js';

export const emaCrossoverStrategy = {
  id: 'ema-crossover',
  name: 'EMA Golden/Death Cross',
  horizon: 'weekly',

  evaluate(series, options = {}) {
    const horizon = options.horizon || 'weekly';
    const params = horizonParams(horizon);
    const signals = [];

    const emaFast = emaSeries(series, params.emaFast);
    const emaSlow = emaSeries(series, params.emaSlow);

    for (let i = 1; i < series.length; i++) {
      const prevFast = emaFast[i - 1];
      const prevSlow = emaSlow[i - 1];
      const currFast = emaFast[i];
      const currSlow = emaSlow[i];
      const ts = series[i].timestamp;

      if (!Number.isFinite(prevFast) || !Number.isFinite(prevSlow)
        || !Number.isFinite(currFast) || !Number.isFinite(currSlow) || !ts) {
        continue;
      }

      const crossedUp = prevFast <= prevSlow && currFast > currSlow;
      const crossedDown = prevFast >= prevSlow && currFast < currSlow;

      if (crossedUp) {
        signals.push({
          timestamp: ts,
          signal: 'BUY',
          score: 1,
          confidence: Math.min(95, 60 + Math.abs(currFast - currSlow) / currSlow * 500),
          inputs: {
            emaFast: currFast,
            emaSlow: currSlow,
            emaFastPeriod: params.emaFast,
            emaSlowPeriod: params.emaSlow,
            maTypes: { fast: 'EMA', slow: 'EMA' },
            close: series[i].close
          },
          invalidation: `Invalid if price closes back below EMA${params.emaSlow} (${params.emaSlow}-period EMA, not pack SMA)`
        });
      } else if (crossedDown) {
        signals.push({
          timestamp: ts,
          signal: 'SELL',
          score: -1,
          confidence: Math.min(95, 60 + Math.abs(currFast - currSlow) / currSlow * 500),
          inputs: {
            emaFast: currFast,
            emaSlow: currSlow,
            emaFastPeriod: params.emaFast,
            emaSlowPeriod: params.emaSlow,
            maTypes: { fast: 'EMA', slow: 'EMA' },
            close: series[i].close
          },
          invalidation: `Invalid if price closes back above EMA${params.emaFast}`
        });
      }
    }

    return signals;
  }
};
