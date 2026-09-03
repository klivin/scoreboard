/**
 * Horizon-specific parameters for signal strategies.
 * weekly ≈ swing trades on daily bars; monthly uses longer windows on the same daily series.
 */
export const HORIZONS = ['weekly', 'monthly'];

export function horizonParams(horizon = 'weekly') {
  if (horizon === 'monthly') {
    return {
      emaFast: 50,
      emaSlow: 200,
      macdFast: 26,
      macdSlow: 52,
      macdSignal: 18,
      rsiPeriod: 21,
      rsiOversold: 30,
      rsiOverbought: 70,
      supertrendPeriod: 14,
      supertrendMultiplier: 3.5
    };
  }
  return {
    emaFast: 20,
    emaSlow: 50,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    rsiPeriod: 14,
    rsiOversold: 30,
    rsiOverbought: 70,
    supertrendPeriod: 10,
    supertrendMultiplier: 3
  };
}
