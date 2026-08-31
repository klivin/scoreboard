# Data Directory

This directory contains market data files consumed by Scoreboard's ingest system.

## Expected Files from Flow's v1 Pack

### OKX BTC Open Interest & Candles
- `okx_btc_oi_1h.json` - Bitcoin open interest data (1-hour intervals)
- `okx_btc_oi_1d.json` - Bitcoin open interest data (1-day intervals)
- `okx_btc_candles_1h.json` - Bitcoin OHLCV candlestick data (1-hour intervals)
- `okx_btc_candles_1d.json` - Bitcoin OHLCV candlestick data (1-day intervals)

### ETF Flows
- `farside_btc_etf.json` - Bitcoin ETF flow data from Farside
- `farside_eth_etf.json` - Ethereum ETF flow data from Farside

### Universe & Indicators
- `top100_freeze.json` - Snapshot of top 100 crypto assets
- `indicators.json` - Pre-calculated indicators including MA20/50/100/200 and Ichimoku components
- `alt_btc_ratios.json` - Altcoin/Bitcoin ratio data

### Backtesting & Gaps
- `backtest_sketch.json` - Backtest configuration and results
- `gaps.md` - Documentation of missing data points (e.g., CoinGecko categories that returned 429)

## File Format

All JSON files should contain arrays of time-series records with at least:
- `timestamp` (ISO 8601 or Unix milliseconds)
- Relevant data fields (e.g., `open`, `high`, `low`, `close`, `volume` for candles)

## Local Development

For local development runs, the ingest system will also check `/workspace/scoreboard/` as an overlay path. This allows running against the original Flow pack location on shared computers.

## Missing Files

If any expected file is missing, the ingest system will:
1. Log a warning to the error_log
2. Use fixture data if available
3. Mark the series as using fallback data in `gaps.md`
