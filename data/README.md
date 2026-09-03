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

If a named file is missing, ingest marks it missing and does not invent OI, ETF, price, indicator, or universe series. The UI shows an on-page error when the selected symbol+interval has no pack rows. CoinGecko 429 left most categories blank — those stay blank.

`indicators_daily.csv` is the multi-symbol daily file. Columns: `date_utc,asset_id,symbol,open,high,low,close,volume,ma20,ma50,ma100,ma200,tenkan,kijun,senkou_a,senkou_b,chikou`. Pack symbols: AVAX BNB BTC DOGE ETH LINK PEPE SHIB SOL SUI TRUMP XRP. 1h OKX files are BTC-only.

Chart overlays (real pack columns only; gaps stay gaps):
- Volume: `volume` / `volume_base` on a **separate pane**. Never put `volume_quote` / `volCcy` on the price scale.
- ETF: `etf_btc_daily_net_flows.csv` / `etf_eth_daily_net_flows.csv` field `net_flow_usd_millions`.
- Open Interest: `okx_btc_usdt_swap_oi_1d.csv` / `okx_btc_usdt_swap_oi_1h.csv` field `oi` or `oi_ccy` (not `oi_usd` on price). Short interest is not in the pack.

**Do not place brokerage Activity CSVs here.** Investments import is browser-local only (`<input type=file>` + FileReader). Real E*TRADE activity files must not be committed, uploaded, or used as fixtures.
