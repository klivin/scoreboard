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
- Blue bars (rgba 102, 126, 234, 0.3) at bottom
- Scaled to max volume
- Toggleable, default ON

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
- **Crosshair + tooltip** - Price and every selected overlay (MA20/50/100/200, Ichimoku, volume) at that timestamp
- **Toggles** - Checkboxes add/remove Lightweight Charts series
- **Drawings** - Horizontal line and trend line once a series is on screen

### Gaps
- Blank / missing readings stay `null`. Never coerced to 0.
- Chart points use Lightweight Charts whitespace (`{ time }` with no value).
- Last ETH close in `indicators_daily.csv` can be blank — gap, not a plunge to 0.

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
- **Current:** Only BTC OI from OKX
- **Missing:** Aggregated OI across exchanges
- **Workaround:** Use BTC-specific OI files for OI analysis

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
- Edge cases (empty data, nulls, single points)

**Status:** ✅ 13/13 tests passing

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

### In progress (Kevin chart ask)
- Lightweight Charts replaces the custom canvas
- Default viewport last few days; pan/zoom time axis
- BTC 1h from OKX 1h file; ETH 1h missing message
- Gaps stay gaps; last price marker + line
- Overlay tooltip; horizontal + trend drawings
- Status: **doing** until localhost verify (BTC 1h, ETH 1d, ETH 1h missing)

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

**Last Updated:** 2026-09-01  
**Version:** v1.1 (chart library + 1h/zoom — see feature requests)  
**Status:** v1 shipped (PR #1). Kevin chart ask logged open.
