# Scoreboard Wiki

## Product Overview

Scoreboard is a crypto market analysis and forecasting dashboard built with vanilla JavaScript MVC architecture. It analyzes BTC and 11 altcoins using Flow's data pack, displays technical indicators, and generates forecasts with naive baseline comparison.

**Stack:**
- Frontend: Vanilla HTML/CSS/JavaScript (MVC pattern, no React)
- Chart: TradingView Lightweight Charts (see Chart Library below)
- Backend: Node.js + Express
- Storage: Local JSON files (Firestore-ready via adapter)
- Testing: Node.js native test runner

**No keys. No trades. No Pooli.**

---

## Architecture

### MVC Pattern

**Model** (`src/model/`)
- `series.js` - Series data model, loads by symbol from indicators_daily.csv
- `indicators.js` - Technical indicator calculations (MA, Ichimoku)
- `forecast.js` - Forecasting engine (naive baseline, trend model, MAE/MAPE)
- `signals/` - Extensible signal engine (EMA, MACD, RSI recovery, Ichimoku) + consensus
- `backtest.js` - Walk-forward backtest vs buy-and-hold and naive baseline
- `ingest.js` - Data loading from overlay and repo paths
- `store.js` - Local JSON storage (forecasts, errors, universe)
- `store-adapter.js` - Abstraction layer for local/Firestore backends

**View** (`public/js/view.js`, `public/js/chart-view.js`)
- `ChartView` - Lightweight Charts price chart (pan/zoom, overlays, drawings)
- `StatsView` - Statistics cards
- `SignalsView` - Market signals (ETF flows, OI, ratios)
- `ForecastView` - Forecast cards with steelman analysis
- `UniverseView` - Crypto universe display

**Controller** (`public/js/controller.js`)
- `AppController` - Coordinates data loading and view updates
- Event handling for UI controls
- API communication

**No god-script in index.html** - clean separation of concerns.

---

## Data Ingestion

### Source Priority

1. **Overlay path:** `/workspace/scoreboard/` (Flow pack on shared computer)
2. **Repo path:** `./data/` (local development)
3. **Error:** If file missing (no silent fallback)

Kevin's shared computer has Flow pack at `/workspace/scoreboard/`. For local development, place files in `./data/`.

### Flow Pack Files

**Multi-Symbol Indicators (Critical):**
- `indicators_daily.csv` - **12 symbols:** AVAX, BNB, BTC, DOGE, ETH, LINK, PEPE, SHIB, SOL, SUI, TRUMP, XRP
  - Columns: `date_utc, asset_id, symbol, open, high, low, close, volume`
  - Indicators: `ma20, ma50, ma100, ma200`
  - Ichimoku: `tenkan, kijun, senkou_a, senkou_b, chikou`

**BTC OKX Data:**
- `okx_btc_usdt_swap_oi_1h.csv` - Hourly OI
- `okx_btc_usdt_swap_oi_1d.csv` - Daily OI
- `okx_btc_usdt_swap_candles_1h.csv` - Hourly candles
- `okx_btc_usdt_swap_candles_1d.csv` - Daily candles

**ETF Flows (Farside):**
- `etf_btc_daily_net_flows.csv` - Bitcoin ETF flows
- `etf_eth_daily_net_flows.csv` - Ethereum ETF flows

**Ratios & Correlations:**
- `ratios_daily.csv` - Alt/BTC ratios
- `corr_30d_vs_btc.csv` - 30-day correlations vs BTC

**Universe (CoinGecko):**
- `cg_top100_universe.json` - Top 100 weekly freeze
- `cg_top100_snapshot.json` - Snapshot metadata

**Metadata:**
- `backtest_sketch.json` - Backtest configuration
- `gaps.md` - Data gaps documentation
- `manifest.json` - Data manifest

### Parsing

**CSV Parsing:**
```javascript
// src/model/ingest.js
parseCSV(content) {
  // Splits by comma, trims headers
  // Converts numeric strings to floats
  // Preserves text fields (date_utc, symbol, asset_id)
}
```

**Symbol Filtering:**
```javascript
// src/model/series.js
getSeries(symbol, interval) {
  // Filters indicators_daily.csv by symbol column
  // Maps senkou_a → senkouA, senkou_b → senkouB
  // Parses date_utc as UTC: new Date(date_utc + 'T00:00:00Z')
  // Throws error if symbol+interval not found
}
```

**Date Parsing (UTC):**
- Input: `date_utc` column (YYYY-MM-DD)
- Parse: `new Date(date_utc + 'T00:00:00Z')` → UTC midnight
- Display: `getUTCMonth()` and `getUTCDate()` to avoid local timezone collapse

### Gitignore

**Not committed:**
- `data/*.csv` - Pack files (gitignored)
- `data/*.json` - Pack JSON files (gitignored)
- `store/*.json` - Local storage files (gitignored)

**Committed:**
- `data/README.md` - Expected files documentation
- `store/.gitkeep` - Directory placeholder

---

## Chart Library

**Pick: TradingView Lightweight Charts (Apache-2.0), vendored via npm and served from `/vendor/lightweight-charts`.**

**Why this, not a custom canvas:**
- v1's HiDPI canvas could draw lines but could not grow toward TradingView (pan/zoom time axis, pinch, last-value line, whitespace gaps, primitives) without rebuilding a charting engine.
- Lightweight Charts is TradingView's open-source path. Same interaction model Kevin asked for (Yahoo / CoinMarketCap: scroll to pan, wheel/pinch to zoom the time axis).
- Native last-value price line, series markers, crosshair subscription, multi-pane volume, whitespace points (missing readings stay gaps — no drop to 0).
- Room to grow: primitives (drawings), extra panes, more series types.

**Why not TradingView Charting Library:** no license exists in this repo. Do not pirate it.

**Why not klinecharts (this pass):** built-in drawings are nice, but Lightweight Charts is the usual OSS path, better maintained, and closer to the TradingView north star. Revisit if we need a full drawing toolbox before primitives land.

**TradingView is the north star, not a pixel clone.** This PR ships: default last-few-days viewport, pan/zoom, real 1h BTC, on-page missing 1h, gaps-as-gaps, last-price marker + line, overlay tooltip, horizontal + trend drawings.

### Chart plan (do not fake as shipped)

| Item | Status | Notes |
|---|---|---|
| Horizontal + trend lines | this PR | Click-to-place after zoom exists |
| Rays / extended lines | planned | Same primitive, one-sided extend |
| Channels / parallel | planned | Two trend lines + fill |
| Fib / pitchfork | planned | Measure from two or three anchors |
| Copy items / patterns | planned | Duplicate selected drawing; save/load a pattern pack (JSON). Not in this PR. |
| Full Charting Library UI | blocked | Needs a real TradingView license |

---

## Chart Overlays

### Price
- Candlesticks (Lightweight Charts). Last known close gets a marker + last-value line.
- Missing OHLC is whitespace, never a 0 print.

### Moving Averages
- **MA20** (green #10b981) - EMA 20-period, default ON
- **MA50** (orange #f59e0b) - SMA 50-period, default ON
- **MA100** (red #ef4444) - SMA 100-period, default OFF
- **MA200** (purple #8b5cf6) - SMA 200-period, default OFF

Calculated in `src/model/indicators.js` or loaded from `indicators_daily.csv`.

### Ichimoku Cloud (Full Implementation)
- **Tenkan-sen** (cyan #06b6d4) - Conversion line (9-period)
- **Kijun-sen** (pink #ec4899) - Base line (26-period)
- **Senkou Span A** (green #10b981) - Leading span A
- **Senkou Span B** (red #ef4444) - Leading span B
- **Cloud shading** - Semi-transparent fill between A & B
- **Chikou Span** - Lagging span (calculated, used in indicators)

Loaded from `indicators_daily.csv` columns: `tenkan, kijun, senkou_a, senkou_b, chikou`.

### Volume Histogram
- Own Lightweight Charts pane (not the price scale)
- Histogram colored by candle direction
- Toggleable, default ON
- Pack `volume` / `volume_base` (never `volume_quote` / `volCcy` on the price axis)
- After Load Data / Fit all / Last few days, BTC price must fill the chart (~tens of thousands)

### ETF net flow
- Own pane (histogram) when toggled
- BTC: `etf_btc_daily_net_flows.csv`; ETH: `etf_eth_daily_net_flows.csv`
- Field: `net_flow_usd_millions` only. Blank days stay gaps (not 0)
- Not applied to alts (no pack file)

### Open Interest
- Own pane (line) when toggled; BTC only
- Files: `okx_btc_usdt_swap_oi_1d.csv` (daily) and `okx_btc_usdt_swap_oi_1h.csv` (1h). Joined OI CSVs are fallback if the swap OI file is missing
- Plot `oi` (contracts) or `oi_ccy`, **never** `oi_usd` on the price scale
- **Short interest is not in the Flow pack.** The UI label is Open Interest. Do not invent a short-interest series.

### Predicted vs Actual vs Naive
- **Predicted** (dashed purple #9333ea) - Trend model forecasts
- **Actual** (solid green #10b981) - Historical actual prices
- **Naive** (dashed orange #f59e0b) - Naive baseline forecasts
- Separate toggleable series
- Naive default ON (always visible for comparison)

### Viewport and zoom
- **Default viewport:** last few days (`src/model/viewport.js`), not `fitContent()` on the full dump
- **Pan:** drag / horizontal scroll
- **Zoom:** mouse wheel and pinch on the time axis
- **Fit all** is a control, not the default

### Interactivity
- **Crosshair + tooltip** - Price and every selected overlay (MA20/50/100/200, Ichimoku, volume, ETF net flow, Open Interest) at that timestamp. Missing fields say `missing`, not `0`.
- **Day tap strip** - Clicking a bar fills `#chart-day-strip` with the same fields for that timestamp
- **Toggles** - Checkboxes add/remove Lightweight Charts series. Volume / ETF / OI each get a new pane under price
- **Drawings** - Horizontal line and trend line once a series is on screen

### Gaps
- Blank / missing readings stay `null`. Never coerced to 0.
- Chart points use Lightweight Charts whitespace (`{ time }` with no value).
- Last ETH close in `indicators_daily.csv` can be blank — gap, not a plunge to 0.

---

## Signal Engine (research only)

**Not a trade bot.** Scoreboard exposes algorithmic **signage** for research: which rules would have fired, with inputs and invalidation text. No wallet access, no order routing, no keys.

### Architecture

```
src/model/signals/
  params.js          — weekly vs monthly parameter sets
  indicators.js      — true EMA, MACD, RSI, ATR helpers (not pack SMA masquerading as EMA)
  ema-crossover.js   — golden/death cross on true EMA fast/slow
  macd-cross.js      — MACD line vs signal from close
  rsi-recovery.js    — oversold/overbought recovery (not naive RSI<30)
  ichimoku.js        — pack tenkan/kijun/senkou + chikou confirmation
  index.js           — registry, walk-forward evaluate, consensus
  lookahead.js       — slice-at-t utilities for no-lookahead tests
```

Each strategy implements:

```javascript
{ id, name, horizon, evaluate(series, { horizon }) → [{
  timestamp, signal: 'BUY'|'SELL'|'CLOSE',
  score, confidence, inputs, invalidation
}]}
```

### MA type discipline

| Display | Pack column | Type in pack | Used by signal engine |
|---------|-------------|--------------|------------------------|
| MA20 | `ma20` | EMA | Chart overlay only; EMA cross **recomputes** true EMA20 from close |
| MA50 | `ma50` | **SMA** | Chart overlay only; EMA cross uses **true EMA50 from close**, never `ma50` |
| MACD | — | — | Computed from close (12/26/9 weekly, 26/52/18 monthly) |
| Ichimoku | `tenkan,kijun,senkou_*` | Pack | Used directly; not recomputed |

### RSI recovery rule

Not `RSI < 30 → BUY`. Requires:
1. RSI was below 30 (oversold) on a prior bar
2. RSI **crosses back above** 30 → BUY
3. Symmetric for overbought: was above 70, crosses back below 70 → SELL

### Consensus

Enabled strategies vote per bar. Consensus returns:
- `score` in \[-1, 1\] and `scorePercent` in \[0, 100\]
- `direction`: BUY | SELL | CLOSE | NEUTRAL
- `breakdown[]`: each strategy’s signal, inputs, reason, invalidation

Never a bare magic BUY/SELL without explanation.

### Horizons

| Horizon | EMA cross | MACD | RSI period |
|---------|-----------|------|------------|
| weekly | 20 / 50 | 12 / 26 / 9 | 14 |
| monthly | 50 / 200 | 26 / 52 / 18 | 21 |

Same daily bar series; longer windows for monthly swing context.

### Chart integration

- `GET /api/trading-signals?symbol=BTC&interval=1d&horizon=weekly&strategies=ema-crossover,macd-cross,...`
- Markers on price pane (BUY green up, SELL red down, CLOSE gray)
- Hover/click shows consensus + per-algorithm breakdown
- UI panel: enable/disable each strategy; horizon selector re-fetches

### Backtest methodology

File: `src/model/backtest.js`

1. **Walk-forward:** at bar *t*, strategies see only `series[0..t]` (`evaluateWalkForward`)
2. **No lookahead:** unit tests assert no index > *t* is read; entries/exits fill at **next bar open** (not same-bar close)
3. **Costs:** default 10bps fee + 10bps slippage each way (configurable)
4. **Metrics per strategy and consensus:** precision/recall (5-bar forward label), hit rate (trade PnL), max drawdown, CAGR/total return, turnover, sample size
5. **Baselines:** buy-and-hold; naive forecaster (`naiveBaseline` — last price, long when forecast > close)

Reproduce:

```bash
npm run backtest              # BTC + ETH, weekly
npm run backtest -- --symbol BTC --horizon monthly
```

Outputs: `store/backtest_{SYMBOL}_{horizon}.json`, `_trades.csv`, `_report.md`

When Flow pack is not mounted, backtest uses a **deterministic OHLC fixture** (`src/model/fixtures/backtest-pack.js`) — results are reproducible in CI but are **not** live market claims. Mount the pack at `/workspace/scoreboard/` or `./data/` for real fixture history.

### API

```
GET /api/trading-signals?symbol=BTC&interval=1d&horizon=weekly
GET /api/backtest?symbol=BTC&horizon=weekly&format=json|markdown
```

---

## Forecasting

### Naive Baseline
```javascript
// src/model/forecast.js
naiveBaseline(data, horizonDays) {
  // Returns last price as prediction
  // Baseline for comparison
}
```

**Always displayed.** If naive MAE wins, explicitly stated in forecast cards.

### Trend Model
```javascript
generateForecast(data, horizonDays) {
  // 7-day momentum calculation
  // Volatility-based confidence bands
  // Upper/lower bounds (2-7d range)
}
```

### Error Metrics
- **MAE** (Mean Absolute Error) - Average prediction error
- **MAPE** (Mean Absolute Percentage Error) - Percentage error

### Forecast Cards
- **Horizons:** 1d, 7d, 30d
- **Sided prediction:** LONG/SHORT/NEUTRAL
- **Confidence bands:** Upper/lower bounds
- **Steelman analysis:** Pro case + Con case
- **MAE comparison:** "Naive baseline wins on recent MAE" or "Trend model shows lower MAE"
- **Recommendation:** Based on confidence and change %

---

## Persistence

### Local Storage (Default)

**Directory:** `store/`

**Collections:**
- `forecasts.json` - Forecast predictions and metadata
- `error_logs.json` - MAE/MAPE calculations
- `universe.json` - Crypto universe data

**Interface:**
```javascript
getAll() → Array<any>
getById(id) → any | null
add(item) → object
update(id, updates) → object
delete(id) → boolean
query(filter) → Array<any>
```

### Firestore Adapter

**File:** `src/model/store-adapter.js`

**Config-based swap:**
```bash
# .env
STORE_TYPE=firestore
FIREBASE_CONFIG='{"apiKey":"...","projectId":"..."}'
```

**Setup:**
1. Create NEW Firebase project: "Scoreboard" at console.firebase.google.com
2. **Never use pooli-19f1c**
3. Enable Firestore Database
4. Get config from Project Settings → Web App
5. Set environment variables in `.env`
6. Restart server

**No code rewrite needed.** Same interface for both backends.

See `FIREBASE_SETUP.md` for complete migration guide including:
- Step-by-step Firebase setup
- Security rules
- Migration script
- Testing instructions

---

## API Endpoints

### Data Retrieval
```
GET /api/series?symbol=BTC&interval=1d&format=json
GET /api/series?symbol=BTC&interval=1d&format=csv
GET /api/indicators?symbol=BTC&interval=1d
```

### Forecasting
```
GET /api/forecast?symbol=BTC&horizon=7
GET /api/predicted-series?symbol=BTC&interval=1d&horizon=7
GET /api/forecasts
```

### Market Signals
```
GET /api/signals?symbol=BTC
GET /api/trading-signals?symbol=BTC&interval=1d&horizon=weekly
GET /api/backtest?symbol=BTC&horizon=weekly
GET /api/universe
GET /api/missing
```

### Health
```
GET /health
```

All endpoints support symbol parameter for multi-asset queries. Returns JSON by default, CSV with `format=csv`.

---

## Known Gaps

### CoinGecko Rate Limiting
- **Issue:** 429 rate limit left most categories blank
- **Behavior:** Categories stay blank (not invented)
- **UI:** Shows message "Universe data missing - CoinGecko 429 left most categories blank"
- **Impact:** `cg_top100_universe.json` may have limited data

### No Aggregated OI
- **Current:** Only BTC OI from OKX (`okx_btc_usdt_swap_oi_1d.csv` / `_1h.csv`)
- **Missing:** Aggregated OI across exchanges
- **Short interest:** not in the Flow pack. Chart overlay is Open Interest (contracts / `oi_ccy`), not short interest, and never `oi_usd` on the price scale.

### Overlay panes vs price scale
- **Issue (Kevin screenshot):** Volume on the default right scale sent the Y-axis to trillions (`volume_quote` ~1e9, `oi_usd` ~2e9) and crushed BTC (~78k) to a flat line.
- **Required:** Price pane autoscales OHLC + MAs + Ichimoku only. Volume, ETF millions, and OI contracts each use a separate pane (`priceScaleId` `volume` / `etf` / `oi`, never `right`).

### Hourly Data Limited (verified hypothesis)
- **1h data that exists:** BTC only, from `okx_btc_usdt_swap_candles_1h.csv` (~1700 bars, columns `ts_ms`, `datetime_utc`, ohlcv) plus optional joined OI.
- **1h data that does not exist:** ETH and other alts. Overlay / repo CSVs for alts are `indicators_daily.csv` (daily). There is no ETH 1h pack file.
- **Required behavior:** BTC 1h charts from the OKX 1h file. ETH 1h shows an on-page missing message. Do not interpolate daily into 1h. Do not plot zeros.
- **Impact:** 1h interval selector only has pack rows for BTC.

### Historical Depth
- **Pack scope:** Dataset time range determined by Flow pack
- **Indicators:** MA200 requires 200+ days of history
- **Backtest:** Limited by available history in pack

---

## Testing

### Test Suite
```bash
npm test
```

**Coverage:**
- SMA/EMA calculations
- Ichimoku structure validation
- Naive baseline forecaster
- MAE/MAPE error metrics
- Forecast generation
- Signal strategies (synthetic crosses, RSI recovery, lookahead)
- Consensus aggregation
- Backtest metrics (drawdown, CAGR, simulateTrades)
- Edge cases (empty data, nulls, single points)

Run backtest report: `npm run backtest`

### Integration Tests
```bash
./final_verification.sh
```

Verifies all API endpoints, chart features, controls, and data loading.

---

## Development

### Running Locally
```bash
npm install
npm test
npm start
```

Server runs on `http://localhost:3000`

### Environment Variables
```bash
# Optional
PORT=3000
STORE_TYPE=local  # or 'firestore'
FIREBASE_CONFIG='{"apiKey":"..."}' # if STORE_TYPE=firestore
```

### File Structure
```
scoreboard/
├── data/                   # Data files (gitignored)
│   └── README.md
├── docs/                   # Documentation
│   ├── WIKI.md            # This file
│   └── FEATURE_REQUESTS.md
├── public/                # Frontend
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js
│   │   ├── controller.js
│   │   └── view.js
│   └── index.html
├── src/                   # Backend
│   ├── controller/
│   │   └── api.js
│   ├── model/
│   │   ├── forecast.js
│   │   ├── indicators.js
│   │   ├── ingest.js
│   │   ├── series.js
│   │   ├── store.js
│   │   └── store-adapter.js
│   └── server.js
├── store/                 # Local JSON storage
└── package.json
```

---

## Deployment Notes

### Data Setup
1. Place Flow pack files in `/workspace/scoreboard/` or `./data/`
2. Ensure `indicators_daily.csv` has all 12 symbols
3. Restart server to load new data

### Firestore Migration
1. Follow `FIREBASE_SETUP.md`
2. Create NEW project "Scoreboard"
3. Set environment variables
4. Restart server
5. No code changes needed

### Browser Cache
After updates, users may need to clear browser cache to see changes. Hard refresh: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac).

---

## Troubleshooting

### Price is a flat line / Y-axis in trillions
- **Symptom:** BTC tooltip ~77822 but axis goes to billions/trillions; volume checkbox ON
- **Cause:** Volume histogram (or `oi_usd` / `volume_quote` / ETF dollars) shared the candle price scale
- **Fix:** Volume / ETF / OI are separate Lightweight Charts panes. Price autoscale uses OHLC + MAs + Ichimoku only

### ETH Shows BTC Data
- **Symptom:** ETH Y-axis shows 57k-82k (BTC range)
- **Cause:** Missing `indicators_daily.csv` or wrong symbol filtering
- **Fix:** Ensure `indicators_daily.csv` exists and has ETH rows with `symbol` column

### All Dates Show 12/31
- **Symptom:** X-axis labels all identical
- **Cause:** Date parsing issue or local timezone collapse
- **Fix:** Use UTC parsing: `new Date(date_utc + 'T00:00:00Z')`

### Load Data Does Nothing
- **Symptom:** Button click has no effect
- **Cause:** Event listener not wired
- **Fix:** Verify controller `setupEventListeners()` calls `updateOverview()`

### Overlays Don't Toggle
- **Symptom:** Checking boxes doesn't change chart
- **Cause:** `toggle-ma20` was mapped to `showma20`, not `showMA20`. The canvas never saw the option change.
- **Fix:** Use `public/js/toggles.js` (`toggle-ma20` → `showMA20`). `setOption(mappedKey, checked)` then `render()`.

### No Data Available Error
- **Symptom:** API returns error for valid symbol
- **Cause:** Symbol missing from `indicators_daily.csv`
- **Fix:** Check CSV has rows with matching `symbol` column

---

## Resources

- **GitHub:** https://github.com/klivin/scoreboard
- **PR #1:** Bug fixes and features
- **Firebase Console:** https://console.firebase.google.com (for Firestore setup)
- **Flow Pack:** Contact Kevin for access to shared computer pack at `/workspace/scoreboard/`

---

### BTC 1h shows "No data to display" (loader bug)
- **Cause (main before this PR):** Pack file was found, but rows used `ts_ms` / `datetime_utc`. The mapper only read `date_utc` / `timestamp` / `ts`, so every timestamp was null, the range filter dropped all ~1700 bars, and the API returned `data: []`. The UI then painted "No data to display" instead of candles. A joined OI CSV was also preferred over `okx_btc_usdt_swap_candles_1h.csv`.
- **Fix:** BTC 1h always maps `okx_btc_usdt_swap_candles_1h.csv` via `ts_ms` then `datetime_utc`. Joined OI is not the price series. Overlay search includes `/workspace/scoreboard/`, `/workspace/scoreboard/data/`, and repo `data/`. Load Data re-reads the pack from disk.

### ETH 1h shows zeros or daily ETH
- **Cause:** Daily `indicators_daily.csv` reused for 1h, or blank close coerced to 0
- **Fix:** Interval `1h` only reads OKX 1h files (BTC). Missing symbol+interval is an on-page 404. Nulls stay null.

---

## Changelog

### Shipped (Kevin chart ask)
- Lightweight Charts replaces the custom canvas
- Default viewport last few days; pan/zoom time axis
- BTC 1h from `okx_btc_usdt_swap_candles_1h.csv` (`ts_ms` / `datetime_utc`); Load Data plots those candles
- ETH 1h on-page missing message (no pack; not interpolated; not zeros)
- Gaps stay gaps; last price marker + line
- Overlay tooltip; horizontal + trend drawings
- Status: **done** — verified on localhost (BTC 1h last few days, ETH 1d, ETH 1h missing)

### Overlay panes (y-axis bug)
- Volume histogram on its own pane/scale (never `right` with candles)
- ETF net flow (`net_flow_usd_millions`) and Open Interest (`oi` / `oi_ccy`) optional panes
- Tooltip + day-tap strip: missing fields say missing, not 0
- Short interest is not in the pack
- Status: **done** — BTC 1d Volume ON: price ~58k–80k (not a flat line), volume/ETF/OI on separate panes

### Latest (PR #1, grok-4.6)
- ✅ Fixed ETH loading (filter `indicators_daily.csv` by `symbol`; no BTC fallback)
- ✅ ETH 1h errors on-page instead of drawing daily ETH or BTC
- ✅ Fixed X-axis dates (UTC `date_utc` ticks, not all 12/31)
- ✅ Load Data re-fetches `/api/indicators` for the selected symbol+interval and redraws
- ✅ Overlay toggles actually flip canvas keys (`showMA20`, not `showma20`)
- ✅ Full Ichimoku Cloud (tenkan/kijun/senkou A/B fill + chikou) and volume pane
- ✅ Store adapter for Firestore
- ✅ Predicted vs Actual vs Naive series
- ✅ HiDPI canvas rendering
- ✅ Symbol list from the pack (12 names in the Flow indicators file)

### Initial Release
- ✅ Vanilla JS MVC architecture
- ✅ Technical indicators (MA20/50/100/200)
- ✅ Naive baseline forecasting
- ✅ Local JSON storage
- ✅ CSV export
- ✅ Interactive charts with hover

---

**Last Updated:** 2026-09-03  
**Version:** v1.2 (signal engine + backtest, research only)  
**Status:** Kevin chart ask done on localhost. Not Pooli.
