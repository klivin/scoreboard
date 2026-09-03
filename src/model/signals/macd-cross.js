import { horizonParams } from './params.js';
import { macdSeries } from './indicators.js';

export const macdCrossStrategy = {
  id: 'macd-cross',
  name: 'MACD Line / Signal Cross',
  horizon: 'weekly',

  evaluate(series, options = {}) {
    const horizon = options.horizon || 'weekly';
    const params = horizonParams(horizon);
    const signals = [];

    const { macdLine, signalLine, histogram } = macdSeries(
      series,
      params.macdFast,
      params.macdSlow,
      params.macdSignal
    );

    for (let i = 1; i < series.length; i++) {
      const prevMacd = macdLine[i - 1];
      const prevSig = signalLine[i - 1];
      const currMacd = macdLine[i];
      const currSig = signalLine[i];
      const ts = series[i].timestamp;

      if (!Number.isFinite(prevMacd) || !Number.isFinite(prevSig)
        || !Number.isFinite(currMacd) || !Number.isFinite(currSig) || !ts) {
        continue;
      }

      const crossedUp = prevMacd <= prevSig && currMacd > currSig;
      const crossedDown = prevMacd >= prevSig && currMacd < currSig;

      if (crossedUp) {
        signals.push({
          timestamp: ts,
          signal: 'BUY',
          score: 1,
          confidence: Math.min(90, 55 + Math.abs(histogram[i] || 0) * 10),
          inputs: {
            macd: currMacd,
            signal: currSig,
            histogram: histogram[i],
            periods: { fast: params.macdFast, slow: params.macdSlow, signal: params.macdSignal },
            computedFrom: 'close (true MACD, not derived from pack MAs)'
          },
          invalidation: 'Invalid if MACD line closes back below signal line'
        });
      } else if (crossedDown) {
        signals.push({
          timestamp: ts,
          signal: 'SELL',
          score: -1,
          confidence: Math.min(90, 55 + Math.abs(histogram[i] || 0) * 10),
          inputs: {
            macd: currMacd,
            signal: currSig,
            histogram: histogram[i],
            periods: { fast: params.macdFast, slow: params.macdSlow, signal: params.macdSignal },
            computedFrom: 'close (true MACD, not derived from pack MAs)'
          },
          invalidation: 'Invalid if MACD line closes back above signal line'
        });
      }
    }

    return signals;
  }
};
