/**
 * Deterministic backtest fixture when Flow pack is not mounted.
 * OHLC only — indicators are computed via addIndicators() at runtime.
 * NOT a substitute for Flow pack in production UI; used for reproducible backtest CI.
 */
export function buildBacktestFixture({ days = 280, seed = 42 } = {}) {
  const symbols = ['BTC', 'ETH'];
  const rows = [];
  let state = seed;

  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  const bases = { BTC: 42000, ETH: 2200 };

  for (const symbol of symbols) {
    let close = bases[symbol];
    for (let d = 0; d < days; d++) {
      const date = new Date(Date.UTC(2025, 0, 1 + d));
      const date_utc = date.toISOString().slice(0, 10);
      const drift = (rand() - 0.48) * 0.025;
      const open = close;
      close = Math.max(close * 0.5, close * (1 + drift));
      const high = Math.max(open, close) * (1 + rand() * 0.01);
      const low = Math.min(open, close) * (1 - rand() * 0.01);
      rows.push({
        date_utc,
        asset_id: symbol.toLowerCase(),
        symbol,
        open,
        high,
        low,
        close,
        volume: 1000 + d * 10 + rand() * 500
      });
    }
  }

  return rows;
}

export const MIN_BACKTEST_DAYS = 200;
