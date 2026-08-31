# Data Directory

This directory should contain Flow's v1 pack data files. The ingest module will read from this directory first, and can also accept `/workspace/scoreboard/` as an overlay path for local runs on the shared computer.

## Expected Files

### OKX OI Data
- `okx_btc_usdt_swap_oi_1h.csv` - Hourly open interest data
- `okx_btc_usdt_swap_oi_1d.csv` - Daily open interest data

### OKX Candles
- `okx_btc_usdt_swap_candles_1h.csv` - Hourly candle data
- `okx_btc_usdt_swap_candles_1d.csv` - Daily candle data

### Joined Data
- `okx_btc_oi_candles_1h_joined.csv` - Hourly OI + candles joined
- `okx_btc_oi_candles_1d_joined.csv` - Daily OI + candles joined

### ETF Flows (Farside)
- `etf_btc_daily_net_flows.csv` - Bitcoin ETF daily net flows
- `etf_eth_daily_net_flows.csv` - Ethereum ETF daily net flows

### Universe Data (CoinGecko)
- `cg_top100_universe.json` - Top 100 universe (weekly freeze)
- `cg_top100_snapshot.json` - Top 100 snapshot (weekly freeze)

### Indicators
- `indicators_daily.csv` - MA20/50/100/200 + Ichimoku indicators

### Ratios & Correlations
- `ratios_daily.csv` - Alt/BTC ratios
- `corr_30d_vs_btc.csv` - 30-day correlation vs BTC

### Metadata
- `backtest_sketch.json` - Backtest configuration
- `gaps.md` - Data gaps documentation
- `manifest.json` - Data manifest

## File Format Notes

All CSV files should have headers. Timestamps should be in ISO 8601 format or Unix timestamps.
JSON files should be valid JSON with appropriate schema for their content type.

If any files are missing during ingest, the system will use fixture data and mark them as missing in the UI.
