import { calculateEMA } from '../indicators.js';

export { calculateEMA };

/**
 * True EMA — never reuse pack ma50 (SMA) as EMA.
 */
export function emaSeries(candles, period, field = 'close') {
  return calculateEMA(candles, period, field);
}

export function macdSeries(candles, fastPeriod, slowPeriod, signalPeriod, field = 'close') {
  const fast = calculateEMA(candles, fastPeriod, field);
  const slow = calculateEMA(candles, slowPeriod, field);
  const macdLine = fast.map((f, i) => (
    Number.isFinite(f) && Number.isFinite(slow[i]) ? f - slow[i] : null
  ));

  const macdAsCandles = macdLine.map((value) => ({ close: value }));
  const signalLine = calculateEMA(macdAsCandles, signalPeriod, 'close');

  const histogram = macdLine.map((m, i) => {
    const sig = signalLine[i];
    return Number.isFinite(m) && Number.isFinite(sig) ? m - sig : null;
  });

  return { macdLine, signalLine, histogram };
}

export function rsiSeries(candles, period = 14, field = 'close') {
  const result = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return result;

  const gains = [];
  const losses = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1][field];
    const curr = candles[i][field];
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) {
      gains.push(null);
      losses.push(null);
      continue;
    }
    const delta = curr - prev;
    gains.push(delta > 0 ? delta : 0);
    losses.push(delta < 0 ? -delta : 0);
  }

  let avgGain = null;
  let avgLoss = null;
  for (let i = period; i < gains.length; i++) {
    if (avgGain === null) {
      const gSlice = gains.slice(i - period, i);
      const lSlice = losses.slice(i - period, i);
      if (gSlice.some((v) => v === null) || lSlice.some((v) => v === null)) {
        result[i] = null;
        continue;
      }
      avgGain = gSlice.reduce((a, b) => a + b, 0) / period;
      avgLoss = lSlice.reduce((a, b) => a + b, 0) / period;
    } else if (gains[i] === null || losses[i] === null) {
      result[i] = null;
      continue;
    } else {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }

  return result;
}

export function atrSeries(candles, period = 14) {
  const tr = candles.map((row, i) => {
    if (!Number.isFinite(row.high) || !Number.isFinite(row.low)) return null;
    if (i === 0) return row.high - row.low;
    const prevClose = candles[i - 1].close;
    if (!Number.isFinite(prevClose)) return row.high - row.low;
    return Math.max(
      row.high - row.low,
      Math.abs(row.high - prevClose),
      Math.abs(row.low - prevClose)
    );
  });

  const result = new Array(candles.length).fill(null);
  let atr = null;
  for (let i = 0; i < tr.length; i++) {
    if (!Number.isFinite(tr[i])) {
      result[i] = null;
      continue;
    }
    if (atr === null) {
      if (i < period - 1) continue;
      const slice = tr.slice(i - period + 1, i + 1);
      if (slice.some((v) => !Number.isFinite(v))) continue;
      atr = slice.reduce((a, b) => a + b, 0) / period;
    } else {
      atr = (atr * (period - 1) + tr[i]) / period;
    }
    result[i] = atr;
  }
  return result;
}
