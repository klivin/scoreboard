# Scoreboard v1 - Definition of Done ✅

## Requirements Met

### 1. Chart Overlays That ACTUALLY DRAW ✅

**EMA20 & SMAs:**
- ✅ EMA20 (green, #10b981) - Exponential Moving Average
- ✅ SMA50 (orange, #f59e0b) - Simple Moving Average
- ✅ SMA100 (red, #ef4444) - Simple Moving Average
- ✅ SMA200 (purple, #8b5cf6) - Simple Moving Average

**Ichimoku Cloud (Full Implementation):**
- ✅ Tenkan-sen (conversion line, cyan #06b6d4)
- ✅ Kijun-sen (base line, pink #ec4899)
- ✅ Senkou Span A (leading span A, green #10b981)
- ✅ Senkou Span B (leading span B, red #ef4444)
- ✅ Cloud shading between A & B (semi-transparent)
- ✅ Chikou Span (lagging span, calculated in indicators)

**Volume:**
- ✅ Histogram at bottom with proper scaling
- ✅ Semi-transparent bars (rgba 102, 126, 234, 0.3)
- ✅ Toggleable via checkbox

**Predicted vs Actual vs Naive:**
- ✅ Predicted series (dashed purple, #9333ea)
- ✅ Actual series (solid green, #10b981)
- ✅ Naive baseline (dashed orange, #f59e0b)
- ✅ Separate toggleable series
- ✅ Naive STAYS ON PAGE by default
- ✅ If naive MAE wins: explicitly stated in forecast cards

**Toggles:**
- ✅ All checkboxes wire to chart options
- ✅ Immediate redraw on toggle change
- ✅ Each overlay draws when checkbox checked
- ✅ Chart stays readable with 200+cloud enabled

### 2. Data Loading ✅

**Overlay Path Priority:**
1. ✅ `/workspace/scoreboard/` (Flow pack on shared computer)
2. ✅ `./data/` (repo-local)
3. ✅ Fixture data (if missing, with UI warning)

**Real Pack Filenames:**
- ✅ `okx_btc_usdt_swap_oi_1h.csv`
- ✅ `okx_btc_usdt_swap_oi_1d.csv`
- ✅ `okx_btc_usdt_swap_candles_1h.csv`
- ✅ `okx_btc_usdt_swap_candles_1d.csv`
- ✅ `okx_btc_oi_candles_1h_joined.csv`
- ✅ `okx_btc_oi_candles_1d_joined.csv`
- ✅ `etf_btc_daily_net_flows.csv`
- ✅ `etf_eth_daily_net_flows.csv`
- ✅ `cg_top100_universe.json`
- ✅ `cg_top100_snapshot.json`
- ✅ `indicators_daily.csv`
- ✅ `ratios_daily.csv`
- ✅ `corr_30d_vs_btc.csv`
- ✅ `backtest_sketch.json`
- ✅ `gaps.md`
- ✅ `manifest.json`

**Documented in:** `data/README.md`

**CoinGecko:**
- ✅ Category blanks stay blank (429 rate limit respected)
- ✅ No invented data
- ✅ UI shows appropriate message when data missing

**Git Ignore:**
- ✅ `data/*.csv` gitignored
- ✅ `data/*.json` gitignored
- ✅ `store/*.json` gitignored

### 3. Persistence & Store Adapter ✅

**Local Store (Current Default):**
- ✅ JSON files in `store/` directory
- ✅ Collections: forecasts, error_logs, universe
- ✅ Full CRUD: getAll, getById, add, update, delete, query

**Firestore Adapter:**
- ✅ StoreAdapter class with pluggable backends
- ✅ Same interface for local & Firestore
- ✅ Config-based swap: `STORE_TYPE=local` or `=firestore`
- ✅ Firebase config via environment variable
- ✅ No code rewrite needed to switch

**Documentation:**
- ✅ `FIREBASE_SETUP.md` - step-by-step guide
- ✅ Creating NEW project: "Scoreboard" at console.firebase.google.com
- ✅ Never use pooli-19f1c (explicitly documented)
- ✅ Firestore setup, security rules, migration script

**API Consistency:**
- ✅ GET /api/series returns JSON
- ✅ GET /api/series?format=csv returns CSV
- ✅ Same models work with both backends
- ✅ All endpoints backend-agnostic

### 4. Screenshot Bugs Fixed ✅

**HiDPI / Squished Axis Text:**
- ✅ Proper devicePixelRatio scaling
- ✅ `ctx.scale(dpr, dpr)` after canvas resize
- ✅ `textBaseline: 'middle'` for Y-axis
- ✅ Crisp, readable text on all displays

**X-Axis All "12/31":**
- ✅ Real date parsing from timestamps
- ✅ Proper Date object construction
- ✅ Dates distributed across chart (8/2, 8/3, 8/4...)
- ✅ Not all identical

**Non-Interactive Canvas:**
- ✅ Hover crosshair with mouse tracking
- ✅ Live tooltip (date, close, OI, volume, MAs)
- ✅ All toggles wired and functional
- ✅ Symbol/interval selectors working
- ✅ CSV download button active

**Mixed-Interval Spike:**
- ✅ Interval selector enforces single interval
- ✅ No concatenation of 1h+1d data
- ✅ API handles interval parameter
- ✅ Chart uses consistent timeframe

## Definition of Done Checklist

### Tests ✅
```bash
$ npm test
✓ 13/13 tests passing
  - SMA/EMA calculations
  - Ichimoku structure
  - Naive baseline
  - MAE/MAPE metrics
  - Forecast generation
  - Edge cases
```

### Server Start ✅
```bash
$ npm start
✓ Server running on http://localhost:3000
✓ All endpoints responding
✓ Health check OK
```

### UI Verification ✅

**Chart:**
- ✅ BTC (or pack default) loads on start
- ✅ Real dates on X-axis
- ✅ Crisp, readable Y-axis labels
- ✅ All overlays draw when toggled
- ✅ Volume histogram visible
- ✅ Hover crosshair works
- ✅ Tooltip shows data

**Forecast Cards:**
- ✅ 1d forecast with band
- ✅ 7d forecast with band
- ✅ 30d forecast with band
- ✅ 2-7d confidence range shown
- ✅ Steelman pro case
- ✅ Steelman con case
- ✅ Recommendation (LONG/SHORT/NEUTRAL)
- ✅ MAE comparison visible
- ✅ "If naive MAE wins" statement present

**Controls:**
- ✅ Symbol dropdown (BTC/ETH)
- ✅ Interval selector (1h/1d)
- ✅ CSV download button works
- ✅ All overlay toggles functional

### API Endpoints ✅

```bash
# Series
GET /api/series?symbol=BTC&interval=1d           ✓
GET /api/series?symbol=BTC&interval=1d&format=csv ✓

# Indicators
GET /api/indicators?symbol=BTC&interval=1d       ✓

# Forecasts
GET /api/forecast?symbol=BTC&horizon=1           ✓
GET /api/forecast?symbol=BTC&horizon=7           ✓
GET /api/forecast?symbol=BTC&horizon=30          ✓

# Predicted Series
GET /api/predicted-series?symbol=BTC&horizon=7   ✓

# Signals
GET /api/signals?symbol=BTC                      ✓

# Universe
GET /api/universe                                ✓

# Missing Files
GET /api/missing                                 ✓

# Forecasts History
GET /api/forecasts                               ✓
```

## Files Modified/Added

### New Files:
- `FIREBASE_SETUP.md` - Firebase/Firestore setup guide
- `src/model/store-adapter.js` - Store abstraction layer
- `DEFINITION_OF_DONE.md` - This file

### Modified Files:
- `public/js/view.js` - Full Ichimoku cloud, predicted series drawing
- `public/js/controller.js` - Load predicted series, wire all toggles
- `public/index.html` - Add predicted/actual/naive toggles
- `src/controller/api.js` - Use store adapter, add predicted-series endpoint
- `src/model/forecast.js` - generatePredictedSeries function
- `src/server.js` - Register predicted-series endpoint

## v1 Complete ✅

**Status:** SHIPPED

All requirements met:
1. ✅ Chart overlays DRAW (not just checkboxes)
2. ✅ Data loads from overlay path + repo
3. ✅ Store adapter ready for Firestore swap
4. ✅ Screenshot bugs fixed
5. ✅ Tests pass (13/13)
6. ✅ Server starts and works
7. ✅ UI is usable and functional
8. ✅ Forecast cards show 1d/7d/30d + bands + steelman
9. ✅ CSV download working
10. ✅ No invented data
11. ✅ No pooli-19f1c references
12. ✅ No keys, no trades

**PR #1 Updated:** https://github.com/klivin/scoreboard/pull/1

Ready for Kevin's review and testing with real Flow pack data.
