# Backtest snapshot (research only)

Regenerate with `npm run backtest`. This file is a committed snapshot of the last CI run **without the Flow pack mounted**. Numbers below are from the deterministic OHLC fixture in `src/model/fixtures/backtest-pack.js` (280 daily bars, 2025-01-01 → 2025-10-07). They are **not** live-market claims.

**Honest result:** nothing beat buy-and-hold on total return. Several strategies beat the naive last-price forecaster only because that baseline stayed flat (0% return, 0 trades): `naiveBaseline` predicts last close, so “forecast > close” never fires.

Fees: 10bps + 10bps slippage each way. Fills at next-bar open.

## BTC weekly

| Strategy | Total return | CAGR | Max DD | Hit rate | BUY precision | Signals / trades | Beats B&H | Beats naive |
|----------|--------------|------|--------|----------|---------------|------------------|-----------|-------------|
| Buy & hold | **23.21%** | 30.99% | 8.97% | — | — | 1 / 1 | — | — |
| Naive last-price | 0.00% | 0.00% | 0.00% | — | — | 0 / 0 | no | — |
| ema-crossover | −7.60% | −9.83% | 8.46% | 0% | 0% | 4 / 1 | **no** | **no** |
| macd-cross | 2.38% | 3.13% | 5.70% | 44.44% | 44.44% | 19 / 9 | **no** | yes |
| rsi-recovery | 0.00% | 0.00% | 0.00% | n/a | n/a | 0 / 0 | **no** | **no** |
| ichimoku | 4.27% | 5.62% | 13.46% | 25.00% | 40.00% | 10 / 4 | **no** | yes |
| consensus | 2.85% | 3.74% | 5.70% | 44.44% | 40.00% | 31 / 9 | **no** | yes |

## ETH weekly

| Strategy | Total return | CAGR | Max DD | Hit rate | BUY precision | Signals / trades | Beats B&H | Beats naive |
|----------|--------------|------|--------|----------|---------------|------------------|-----------|-------------|
| Buy & hold | **12.72%** | 17.94% | 7.02% | — | — | 1 / 1 | — | — |
| Naive last-price | 0.00% | 0.00% | 0.00% | — | — | 0 / 0 | no | — |
| ema-crossover | −0.88% | −1.15% | 6.74% | 33.33% | 50.00% | 8 / 3 | **no** | **no** |
| macd-cross | 1.23% | 1.61% | 5.93% | 40.00% | 45.45% | 21 / 10 | **no** | yes |
| rsi-recovery | 0.00% | 0.00% | 0.00% | n/a | n/a | 0 / 0 | **no** | **no** |
| ichimoku | −0.60% | −0.79% | 7.42% | 50.00% | 60.00% | 12 / 4 | **no** | **no** |
| consensus | 1.08% | 1.42% | 4.95% | 45.45% | 50.00% | 36 / 11 | **no** | yes |

RSI recovery fired zero times on this random-walk-ish fixture (no deep oversold recoveries). That is expected, not a silent skip.

*Research signage only. Never a call to execute a trade.*
