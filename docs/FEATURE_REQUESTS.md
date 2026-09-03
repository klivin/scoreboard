# Scoreboard Feature Requests

Status key: **open** (not started) | **doing** (in progress) | **done** (shipped and verified in UI)

---

## Critical Fixes (Kevin's Screenshot Bugs)

### ✅ Load Data Must Work
**Status:** done  
**Request:** Clicking "Load Data" button should re-fetch data from API and redraw chart  
**Verification:**
- Button click triggers `updateOverview(symbol, interval)`
- API called: `GET /api/indicators?symbol=X&interval=Y`
- Chart redraws with new data
- Error alert shown if symbol+interval unavailable

**Shipped:** PR #1, commit fixing Load Data button wiring

---

### ✅ ETH Must Not Plot BTC
**Status:** done  
**Request:** Selecting ETH should show ETH prices (thousands), not BTC prices (57k-82k)  
**Verification:**
- ETH Y-axis range: 3220-3960 (not 57193-81864)
- Data loaded from `indicators_daily.csv` filtered by `symbol = 'ETH'`
- No silent fallback to BTC
- Error shown if symbol missing

**Shipped:** PR #1, commit fixing series.js getSeries() symbol filtering

---

### ✅ X-Axis Real Dates Not 12/31
**Status:** done  
**Request:** X-axis should show distinct dates (8/1, 8/2, 8/3...) not all "12/31"  
**Verification:**
- `date_utc` parsed as UTC: `new Date(date_utc + 'T00:00:00Z')`
- Display uses `getUTCMonth()` and `getUTCDate()`
- Distinct date labels visible on chart
- No local timezone collapse

**Shipped:** PR #1, commit fixing UTC date parsing and formatting

---

### ✅ Overlays Actually Toggle
**Status:** done  
**Request:** Checking/unchecking overlay boxes must visibly change the chart  
**Root cause (still live after earlier “fixes”):** checkbox ids were mapped with a hyphen-collapse regex (`toggle-ma20` → `showma20`) that never matched `ChartView` keys (`showMA20`). The canvas kept drawing the default MA20/MA50 pair.

**Fix:** explicit map in `public/js/toggles.js` (`toggle-ma20` → `showMA20`, `toggle-ichimoku` → `showIchimoku`, …). Change handler calls `setOption(mappedKey, checked)` then `render()`.

**Verification:**
- MA50 checkbox: Orange line appears/disappears
- MA100 checkbox: Red line appears/disappears
- MA200 checkbox: Purple line appears/disappears
- Ichimoku checkbox: Cyan/pink lines + cloud fill + chikou appears/disappears
- Volume checkbox: Blue histogram appears/disappears
- Naive checkbox: Orange dashed line appears/disappears
- Each change triggers immediate redraw

**Shipped:** PR #1, grok-4.6 pass — toggle keys actually match the canvas options

---

### Price Y-axis crushed by volume / OI / ETF dollars
**Status:** done  
**Request:** BTC 1d tooltip shows price ~77822 but the Y-axis goes to 9,000,000,000,000 and price is a flat line at the bottom. Volume checkbox ON. Volume / OI / ETF dollars must never share the price scale with candles.

**Pack magnitudes (do not invent):**
- candles `volume_base` ~1e4, `volume_quote` ~1e9
- OI `oi_usd` ~2e9, `oi` contracts ~2e6
- ETF `net_flow_usd_millions` ~tens; `net_flow_usd` ~1e7

**Must ship:**
1. Price series owns the main scale. Volume uses a Lightweight Charts histogram on its **own pane/scale**. Never put `volume`, `oi_usd`, `volume_quote`, or ETF dollars on the price scale. Autoscale price to OHLC + MAs + Ichimoku only.
2. Overlays:
   - Volume — separate pane (default ON)
   - ETF net flow — `etf_btc_daily_net_flows.csv` / `etf_eth_daily_net_flows.csv`, field `net_flow_usd_millions`; gaps stay gaps (no zeros for blanks)
   - Open Interest — `okx_btc_usdt_swap_oi_1d.csv` (and 1h OI when interval is 1h). Prefer `oi` (contracts) or `oi_ccy` on its own pane, not `oi_usd` on price. UI label is **Open Interest**. Short interest is not in the Flow pack (do not invent).
3. Day tap / crosshair: tooltip and a detail strip show price, every selected MA/Ichimoku, volume, ETF net flow that day, OI that day. Missing fields say **missing**, not 0.

**Verification:**
- BTC 1d with Volume ON: price visible ~70–80k range, volume in lower pane, y-axis NOT trillions
- Toggle ETF flow / OI: separate panes, price scale unchanged
- Hover Aug 28-ish: tooltip has price + MAs + volume + flow/OI when selected
- `npm test && npm start`

**Verified (localhost):** BTC 1d Volume ON — price Y-axis ~58k–80k (not trillions), candles fill the pane, volume histogram on a lower pane with its own billions scale. ETF net flow pane uses millions; OI uses contracts. Aug 28 tooltip: Price $77822, MA20 $70899, Volume 4.63B, ETF 18.4M USD, OI 2.15M contracts. Missing fields say missing.

**Shipped:** overlay panes PR against main

---

### Overlay toggles must preserve zoom/pan (not refit to last few days)
**Status:** done  
**Request:** Toggling MA20/50/100/200, Ichimoku, Volume, Predicted/Actual/Naive, ETF flow, or OI must not reset the visible time range. Only **Fit all**, **Last few days**, **Symbol**, **Interval**, and initial **Load Data** may change viewport.

**Root cause:** Checkbox handlers called `render()`, which destroyed the chart and re-applied `applyDefaultViewport()` (~5-day window).

**Fix:** `ChartView.refreshOverlays()` captures `timeScale().getVisibleLogicalRange()` (falls back to `getVisibleRange()`), removes/re-adds overlay series without destroying candles, then restores the range on the next animation frame. Toggle handlers call `refreshOverlays()` instead of full `render()`. Price + overlay panes share one Lightweight Charts time scale — that shared scale is what we capture/restore.

**Verification:**
- Zoom BTC 1d into ~1 day mid-history; toggle MA200, Ichimoku, Volume, ETF, OI one at a time — window unchanged
- **Fit all** resets range; interval change to 1h resets to that interval's default
- `npm test` — `public/js/chart-view.test.js` overlay toggle range preservation
- Headless Chrome against localhost: logical range `{from:40.25,to:43.75}` unchanged after MA200 / Ichimoku / Volume / ETF / OI toggles; Fit all → `{from:0,to:93}`; interval 1h rebuilt the chart and left the zoomed window

**Shipped:** overlay zoom-preserve PR against main

---

## Chart Features

### Kevin's chart: viewport, zoom, 1h, gaps, overlays, drawing
**Status:** done  
**Request:** Stop rebuilding a custom canvas universe. Use an off-the-shelf chart (TradingView capability is the north star, not a pixel clone). After merge, localhost must work:

1. Default viewport = last few days, not the full history dump
2. Scroll + pinch/wheel zoom like Yahoo Finance / CoinMarketCap (pan/zoom the time axis)
3. 1-hour series must display for BTC from Flow pack `okx_btc_usdt_swap_candles_1h.csv` (~1700 bars, `ts_ms` / `datetime_utc` / ohlcv). ETH 1h is **not** in the pack (alts are `indicators_daily.csv` only). If 1h is missing for a symbol, show an on-page message. Do **not** interpolate daily into 1h. Do **not** plot zeros.
4. Never draw a drop to 0 when a reading is missing. Gaps stay gaps. Last known / current price must stand out (marker + last-value line). Last ETH close in `indicators_daily.csv` can be blank — treat as gap, never 0.
5. Crosshair/tap tooltip shows price + every selected overlay (SMA/EMA 20/50/100/200, Ichimoku, volume) at that timestamp
6. Drawing: at least horizontal + trend lines once zoom exists. Advanced lines / copy items / patterns are planned in the wiki, not faked as shipped.

**Library pick:** TradingView Lightweight Charts (Apache-2.0). Charting Library is not licensed in-repo — do not pirate. See `docs/WIKI.md`.

**Loader bug (Kevin, localhost after pull of main):** BTC 1h showed "No data to display" even though `okx_btc_usdt_swap_candles_1h.csv` (~1700 bars) was on disk. Not missing data. Mapper ignored `ts_ms`/`datetime_utc` and preferred a joined/daily CSV. Load Data on BTC+1h must plot those candles.

**Hypothesis to verify (do not invent series):**
- ETH 1h is empty because overlay CSVs are daily-only and there is no ETH 1h pack file
- BTC 1h charts from `okx_btc_usdt_swap_candles_1h.csv`

**Verification (localhost after merge):**
```
git pull origin main
npm start
# open http://localhost:3000
# BTC 1h → last few days, real OKX bars, zoom/pan
# ETH 1d → ETH prices, blank last close is a gap (not 0)
# ETH 1h → on-page missing message, not zeros
```

**Status rule:** `open` until work starts, `doing` while implementing, `done` only if the above works on localhost.

---

### ✅ Ichimoku + Volume + MA20/50/100/200
**Status:** done  
**Request:** Full Ichimoku Cloud with volume histogram and all moving averages  
**Components:**
- ✅ MA20 (green EMA)
- ✅ MA50 (orange SMA)
- ✅ MA100 (red SMA)
- ✅ MA200 (purple SMA)
- ✅ Ichimoku Tenkan (cyan)
- ✅ Ichimoku Kijun (pink)
- ✅ Senkou A (green)
- ✅ Senkou B (red)
- ✅ Cloud shading (semi-transparent fill)
- ✅ Volume histogram (blue bars at bottom)

**Verification:**
- All indicators visible when toggles checked
- Cloud fill appears between Senkou A and B
- Volume histogram scaled to max volume
- Lines render without overlap issues

**Shipped:** PR #1, full Ichimoku + volume rendering

---

### ✅ Predicted vs Naive
**Status:** done  
**Request:** Separate toggleable series for predicted, actual, naive forecasts  
**Components:**
- ✅ Predicted series (dashed purple)
- ✅ Actual series (solid green)
- ✅ Naive series (dashed orange, default ON)
- ✅ Independent toggles
- ✅ Historical comparison data

**Verification:**
- API endpoint: `/api/predicted-series?symbol=X&interval=Y&horizon=Z`
- Predicted toggle shows/hides purple dashed line
- Actual toggle shows/hides green solid line
- Naive always visible (default checked)
- Naive MAE comparison displayed in forecast cards

**Shipped:** PR #1, forecast series visualization

---

### ✅ CSV Export
**Status:** done  
**Request:** Download button to export series data as CSV  
**Verification:**
- "Download CSV" button in UI
- Click triggers `GET /api/series?symbol=X&interval=Y&format=csv`
- Browser downloads `series.csv`
- Columns: timestamp, date_utc, open, high, low, close, volume, ma20, ma50, ma100, ma200

**Shipped:** PR #1, CSV download button wired

---

## API Features

### ✅ Query API
**Status:** done  
**Request:** REST API for programmatic data access  
**Endpoints:**
- ✅ `GET /api/series?symbol=BTC&interval=1d&format=json`
- ✅ `GET /api/series?symbol=BTC&interval=1d&format=csv`
- ✅ `GET /api/indicators?symbol=BTC&interval=1d`
- ✅ `GET /api/forecast?symbol=BTC&horizon=7`
- ✅ `GET /api/predicted-series?symbol=BTC&interval=1d&horizon=7`
- ✅ `GET /api/signals?symbol=BTC`
- ✅ `GET /api/universe`
- ✅ `GET /api/missing`
- ✅ `GET /health`

**Verification:**
- All endpoints return JSON or CSV
- Symbol parameter works for multi-asset
- Error handling for missing data
- CORS headers if needed

**Shipped:** Initial release + PR #1 enhancements

---

## Storage

### ✅ Migratable Firestore
**Status:** done  
**Request:** Local JSON store now, Firestore later via config (no code rewrite)  
**Implementation:**
- ✅ Store adapter pattern (`src/model/store-adapter.js`)
- ✅ Local JSON backend (default)
- ✅ Firestore backend (config-based)
- ✅ Same interface for both
- ✅ Environment variable switch: `STORE_TYPE=firestore`
- ✅ Firebase setup documentation (`FIREBASE_SETUP.md`)

**Verification:**
- Set `STORE_TYPE=local` → uses `store/*.json`
- Set `STORE_TYPE=firestore` + `FIREBASE_CONFIG` → uses Firestore
- No code changes needed to swap
- Collections: forecasts, error_logs, universe

**Important:** Always create NEW Firebase project named "Scoreboard". Never use pooli-19f1c.

**Shipped:** PR #1, store adapter + Firebase setup guide

---

## Data Features

### ✅ Custom Tickers
**Status:** done (12 symbols supported)  
**Request:** Symbol selector for different assets  
**Symbols Supported:**
- ✅ AVAX
- ✅ BNB
- ✅ BTC (default)
- ✅ DOGE
- ✅ ETH
- ✅ LINK
- ✅ PEPE
- ✅ SHIB
- ✅ SOL
- ✅ SUI
- ✅ TRUMP
- ✅ XRP

**Source:** `indicators_daily.csv` from Flow pack

**Verification:**
- Dropdown in UI shows all 12 symbols
- Selecting symbol loads correct data (no BTC fallback)
- Y-axis range reflects symbol price (ETH thousands, BTC tens of thousands)
- Error shown if symbol missing from pack

**Shipped:** PR #1, multi-symbol support from indicators_daily.csv

---

### ✅ Top100 Weekly Freeze
**Status:** done (data file expected)  
**Request:** CoinGecko top 100 weekly snapshot  
**Files:**
- `cg_top100_universe.json` - Top 100 crypto universe
- `cg_top100_snapshot.json` - Weekly freeze metadata

**Known Gap:** CoinGecko 429 rate limit left most categories blank. Categories stay blank (not invented).

**Verification:**
- Files loaded if present in pack
- Universe displayed in UI (crypto list)
- Missing categories handled gracefully
- No invented data

**Shipped:** Initial release, universe display in UI

---

### ✅ ETF Flows
**Status:** done  
**Request:** ETF net flow data from Farside  
**Files:**
- `etf_btc_daily_net_flows.csv` - Bitcoin ETF flows
- `etf_eth_daily_net_flows.csv` - Ethereum ETF flows

**Verification:**
- Loaded from Flow pack
- Displayed in "Market Signals" section
- Latest flow values shown
- Recent change % calculated

**Shipped:** PR #1, ETF signals display

---

### ✅ OI (Open Interest)
**Status:** done (BTC only)  
**Request:** Open interest data from OKX  
**Files:**
- `okx_btc_usdt_swap_oi_1h.csv` - Hourly BTC OI
- `okx_btc_usdt_swap_oi_1d.csv` - Daily BTC OI
- `okx_btc_oi_candles_1h_joined.csv` - Joined 1h data
- `okx_btc_oi_candles_1d_joined.csv` - Joined 1d data

**Known Gap:** Only BTC OI available. No aggregated multi-exchange OI yet.

**Verification:**
- OI loaded for BTC
- Displayed in Market Signals
- Latest OI value shown
- Change % calculated

**Shipped:** PR #1, OI signals display

---

### ✅ Alt/BTC Ratios
**Status:** done  
**Request:** Altcoin/Bitcoin ratio analysis  
**File:**
- `ratios_daily.csv` - Alt/BTC ratios

**Verification:**
- Loaded from Flow pack
- Displayed in Market Signals
- Latest ratio value shown
- Change % calculated

**Shipped:** PR #1, ratio signals display

---

### ✅ Category Correlation
**Status:** done (data file expected)  
**Request:** 30-day correlation vs BTC by category  
**File:**
- `corr_30d_vs_btc.csv` - Category correlations

**Known Gap:** CoinGecko 429 left many categories blank.

**Verification:**
- File loaded if present
- Correlations displayed if available
- Blank categories stay blank (not invented)

**Shipped:** Initial release, correlation data ingestion

---

## Live Incremental Refresh

### Incremental ingest (source adapters + watermark)
**Status:** doing (OKX incremental **done**; ETF/CoinGecko remain fallback)  
**Request:** Load Data must stop replaying the same static Flow-pack dump. `src/model/ingest.js` has no network calls. Refresh must become real incremental ingest with source adapters and a persisted watermark.

**Must ship:**
1. Adapter interface `{ id, symbol, interval, fetchSince(cursor) -> { rows, nextCursor } }`
2. **OKX BTC/USDT swap** public candles + OI: true incremental fetch (public, no key)
3. **ETF (Farside)** and **CoinGecko top100**: same interface, but `fetchSince` is a bounded-overlap fallback (re-fetch/re-parse the whole small file, dedupe by natural key). Do **not** fake a cursor. Do **not** mark these done as incremental.
4. Watermark store `ingest_watermarks`: `(source, symbol, interval) -> { lastTimestamp, lastSuccessAt, rowCount }`. Advance atomically only after fetch+normalize+upsert of the whole page.
5. Safety overlap, dedupe/upsert by `symbol+interval+timestamp`, monotonic check, gaps flagged to `error_log` (never invent bars, never zero-fill)
6. `POST /api/refresh` + `GET /api/refresh/status` (polling). Load Data calls refresh first, shows last-success age, then reads the store — never the raw dump.
7. Series export accepts `since=<timestamp>` or `sinceCursor=<id>`
8. No API keys in client JS. No trades. No invented series. Not Pooli.

**Per-source status:**
- OKX candles + OI: **done** (true incremental; public `history-candles` + `rubik/.../open-interest-history`; watermark + overlap; second refresh sends `before=` / `begin=`). Verified live: 1h candles URL returned 6 rows, sample close 80853 at 2026-09-03 16:00:00 UTC; OI 6 rows, `oi` 2.925M contracts. `npm test` mocks HTTP (80/80).
- ETF Farside: **doing** (bounded-overlap fallback, `nextCursor` is null, cursor ignored; Cloudflare often blocks the HTML scrape so pack CSV is re-parsed). Not incremental.
- CoinGecko top100: **doing** (bounded-overlap fallback, 429-limited, `nextCursor` is null). Not incremental.

**Design:** `docs/WIKI.md` (Data Ingestion — incremental refresh)

**Kevin check (second refresh only pulls new rows):**
```
# 1) first incremental page (no watermark)
curl -sS -X POST 'http://localhost:3000/api/refresh?source=okx-candles&symbol=BTC&interval=1h' | python3 -m json.tool
# note sources[0].lastTimestamp, rowCount, requestUrls (no before=)

# 2) immediately again — same rowCount, requestUrls include before=<lastTimestamp - 3h>
curl -sS -X POST 'http://localhost:3000/api/refresh?source=okx-candles&symbol=BTC&interval=1h' | python3 -m json.tool

# 3) export only rows after the watermark
curl -sS 'http://localhost:3000/api/series?symbol=BTC&interval=1h&sinceCursor=okx-candles:BTC:1h&format=json'
```

## Investments

### Investments tab + local brokerage import (first slice)
**Status:** doing  
**Request:** Separate Investments scope from chart/universe. Browser-only Activity CSV import (`<input type=file>` + FileReader). Validate + preview before commit. Preserve raw rows plus normalized events. REAL vs TRACKING badges never mix P&L. FIFO lots (average-cost selectable). Paper BUY/SELL and start/stop tracking are always TRACKING. Transaction markers on asset charts. Local CSV/JSON export. Schema-versioned local store with its own collection namespaces.

**Privacy (critical):**
- Kevin's attached E*TRADE Activity CSV is private. Do **not** read, hardcode, commit, upload, or embed it.
- File stays in this browser / local store and is **not transmitted**. Server must not receive the raw CSV.
- Tests use **synthetic** rows with the same columns only. No real brokerage fixtures.

**Columns (canonical + aliases):** Activity/Trade Date, Transaction Date, Settlement Date, Activity Type, Description, Symbol, Cusip, Quantity, Price, Amount, Commission, Category, Note.

**Supported activity types:** buys, sells, dividends, exchanges, options/expired, fees. Never infer a fill when quantity/price is missing. Missing fields stay missing (not 0). Unsupported and missing-price events are marked clearly. Symbol changes / ETFs / options require **explicit** mapping — no automatic symbol inference. Never overwrite REAL positions from a screenshot; import history first.

**Shipped in this slice:**
- Investments tab (empty state + prominent privacy warning + local file picker)
- Parse → validate → preview → explicit Commit
- `scoreboard.investments` local store (schemaVersion, collections: `rawTransactions`, `events`, `paperTrades`, `tracking`, `symbolMaps`, `settings`) — not mixed with chart/server `store/`
- REAL vs TRACKING sections, badges, and separate P&L
- FIFO lot matching + realized/unrealized P&L, cost basis, return, dividends, drawdown
- Average-cost method selectable (implemented)
- Paper BUY/SELL at a point-in-time (always TRACKING) + forward performance
- Start/stop tracking (stop preserves history)
- Transaction markers on Overview charts with click/tap detail
- Local CSV/JSON export (download Blob; no upload)

**Not shipped / open:**
- Screenshot / OCR position import (intentionally absent — would overwrite REAL)
- Broker sync, keys, or any server-side CSV ingest
- Automatic symbol inference (will stay forbidden)

**Verification:**
- `npm test` passes (synthetic CSV only: parse/validate, missing qty/price, REAL vs TRACKING, FIFO, markers, start/stop history, schema migration)
- Fresh localhost: Investments tab visible; click shows empty state + privacy warning + import button
- After selecting a **synthetic** file: preview with errors/warnings + Commit; nothing leaves the browser
- REAL and TRACKING sections render separately
- Existing chart/universe features stay intact

**Localhost UI (2026-09-03, synthetic CSV only — not Kevin's E*TRADE file):**
- Investments tab: privacy warning + empty state + file input
- Preview listed missing-price / missing-qty / needs-mapping; Commit required
- After commit: REAL P&L (realized $559, unrealized **missing**, basis $360, dividends $25); flagged rows marked no-fill
- Paper BUY BTC 2024-07-01 qty 2 @ 140 stayed TRACKING; not mixed into REAL
- Start ETH 2024-01-01 @ 2000 then Stop: row remains, status stopped, history kept, still TRACKING
- Overview tab controls still render (this host had no Flow pack, so BTC 1d chart was empty — not an Investments regression)
- Chart transaction markers: unit-tested; not visually confirmed on live candles (no pack)

**Priority:** High

---

## Universe money-scanner

### Universe tab → money-scanner / research board
**Status:** doing  
**Request:** Universe tab must become a usable money-scanner / research board, not a dead CoinGecko card list. Table of supported stocks/crypto/assets with current price, liquidity/data freshness, 1d/7d/30d model direction + confidence, bullish/bearish flip timestamp, signal consensus (reuse the signal engine), backtest status, and ETF/OI/correlation context where those series actually exist.

**Honesty (critical):**
- Research / paper only. Not automatic trade recommendations. Banner must say so.
- No fabricated ranking or sentiment. No composite “hot list” score.
- Missing cells say **missing**, never `0`.
- Stocks are not in the Flow pack — do not invent equity series. Unsupported asset classes stay empty/missing.
- No keys. No trades. Not Pooli.

**Must ship:**
1. Sort/filter by: new bullish/bearish flip, confidence, horizon, asset class, REAL holdings, TRACKING
2. Add to Tracking / Remove Tracking wired to Investments `scoreboard.investments` `collections.tracking` when that store is present; otherwise a schema-versioned local tracking namespace
3. Selecting a row opens the Overview chart for that asset
4. Start tracking freezes baseline timestamp + price. Evaluation view compares forecast/actual forward P&amp;L and model vs naive from that baseline. Stop preserves history
5. Flip history: when consensus/direction flips, record timestamp and prior/new state

**Design:** `docs/WIKI.md` (Universe money-scanner)

**Verification:**
- `npm test` — row construction (missing stays missing), flip detection + history, start/stop baseline freeze + history, filters/sorts
- Localhost Universe tab: usable scanner table, research-only banner, honest empty/missing cells
- REAL / TRACKING badges respected when Investments store has them
- Row click still loads Overview for that symbol

**Priority:** High

---

## Future Enhancements

### Supertrend/ATR regime filter (signal strategy e)
**Status:** open  
**Request:** Optional Supertrend/ATR regime filter as fifth signal strategy and consensus voter  
**Blockers:** Not implemented in first signal-engine slice  
**Priority:** Medium

---

### 🔲 5x/Day Probe
**Status:** open  
**Request:** Automated data refresh 5 times per day  
**Implementation Ideas:**
- Cron job or scheduled task calling `POST /api/refresh`
- Incremental OKX watermark already exists; schedule is the remaining work
- Trigger forecast recalculation
- Log refresh status

**Blockers:**
- Scheduler / cron not wired
- ETF and CoinGecko are still bounded-overlap fallback, not true incremental

**Depends on:** Live Incremental Refresh (OKX watermark + `/api/refresh`)

**Priority:** Medium (nice-to-have for production)

---

### 🔲 Multi-Exchange OI Aggregation
**Status:** open  
**Request:** Aggregate open interest across multiple exchanges (not just OKX)  
**Implementation Ideas:**
- Fetch from Binance, Bybit, Deribit, etc.
- Aggregate total OI
- Show per-exchange breakdown

**Blockers:**
- Need API access or data source for other exchanges
- Flow pack currently only has OKX

**Priority:** Medium

---

### 🔲 Hourly Data for All Symbols
**Status:** open  
**Request:** 1h interval for all 12 symbols (currently BTC only)  
**Implementation Ideas:**
- Expand Flow pack to include hourly data for alts
- Update `indicators_daily.csv` to `indicators_hourly.csv` for 1h

**Blockers:**
- Flow pack only has BTC 1h data
- Need data source for alt 1h data

**Priority:** Medium

---

### 🔲 Custom Date Ranges
**Status:** open  
**Request:** Date picker to select custom from/to range  
**Implementation Ideas:**
- Add date inputs in UI
- Pass `from` and `to` to API: `GET /api/series?symbol=BTC&from=2024-01-01&to=2024-12-31`
- Filter series by date range

**Priority:** Low (current view shows full history)

---

### 🔲 Export Chart as Image
**Status:** open  
**Request:** Download button to save chart as PNG  
**Implementation Ideas:**
- `canvas.toDataURL('image/png')`
- Trigger browser download
- Include overlays and current state

**Priority:** Low (nice-to-have)

---

### 🔲 Mobile Responsive Design
**Status:** open  
**Request:** Touch-friendly UI for mobile devices  
**Implementation Ideas:**
- Responsive CSS breakpoints
- Touch events for chart interaction
- Collapsible panels

**Priority:** Low (desktop-first for v1)

---

### 🔲 Dark Mode
**Status:** open  
**Request:** Dark theme toggle  
**Implementation Ideas:**
- CSS variables for colors
- Toggle button in UI
- LocalStorage to persist preference

**Priority:** Low

---

### 🔲 Alerts & Notifications
**Status:** open  
**Request:** Price alerts, forecast confidence thresholds  
**Implementation Ideas:**
- Set alert conditions (price > X, confidence > Y%)
- Browser notifications
- Email/SMS integration (future)

**Priority:** Low

---

### 🔲 Backtest Visualization
**Status:** open  
**Request:** Interactive backtest results display  
**Implementation Ideas:**
- Load `backtest_sketch.json`
- Show strategy performance
- Compare naive vs trend model
- Equity curve chart

**Priority:** Low (backtest file exists but not visualized)

---

### Signal engine + walk-forward backtest (research signage)
**Status:** doing  
**Request:** Extensible signal engine with chart markers, strategy toggles, horizon selector (weekly/monthly), walk-forward backtest vs buy-and-hold and naive baseline. **Research/paper only — no execution, no keys, no trades.**

**Shipped in this slice (first pass, not finished product):**
- `src/model/signals/` — EMA 20/50 crossover (true EMA50, not pack SMA), MACD 12/26/9 from close, RSI(14) recovery (cross back above 30 / below 70), Ichimoku trend confirmation from pack tenkan/kijun/senkou
- Consensus aggregator with transparent 0–100 score and per-strategy breakdown
- `src/model/backtest.js` — walk-forward, next-bar-open fills, 10bps fee/slippage (configurable)
- `npm run backtest` — regenerates report + JSON/CSV in `store/`
- Chart markers + hover/click tooltip with algorithm inputs, consensus, invalidation
- Strategy toggle panel + weekly/monthly horizon selector
- API: `GET /api/trading-signals`, `GET /api/backtest`

**Not shipped / open:**
- Supertrend/ATR regime filter (optional strategy e) — **open**
- Interactive equity-curve backtest visualization tab
- Full out-of-sample validation on live Flow pack when mounted (CI uses deterministic fixture when pack absent)

**Backtest honesty (2026-09-03, fixture, weekly):** no strategy or consensus beat buy-and-hold on total return (BTC B&H 23.21%, best strategy ichimoku 4.27%; ETH B&H 12.72%, best MACD 1.23%). See `docs/BACKTEST.md`. Status stays **doing**.

**Verification:**
- `npm test` passes (lookahead, per-strategy synthetic tests, consensus, backtest metrics)
- `npm run backtest` prints report with actual numbers vs baselines
- Localhost: signal markers on BTC 1d when data loaded; toggles re-fetch signals

**Priority:** High (research foundation)

---

## Completed Milestones

### Scoreboard v1.0 ✅
- ✅ Vanilla JS MVC architecture
- ✅ Flow pack data ingestion (overlay + repo paths)
- ✅ 12-symbol support (BTC, ETH, 10 alts)
- ✅ Technical indicators (MA20/50/100/200, full Ichimoku)
- ✅ Volume histogram
- ✅ Naive baseline forecasting (always visible)
- ✅ Trend model with confidence bands
- ✅ MAE/MAPE comparison (naive vs trend)
- ✅ Steelman forecast analysis
- ✅ Market signals (ETF flows, OI, alt/BTC ratios)
- ✅ Predicted vs actual vs naive series
- ✅ Interactive charts (hover, crosshair, tooltip)
- ✅ Overlay toggles (all functional)
- ✅ CSV export
- ✅ REST API (JSON + CSV formats)
- ✅ Local JSON storage
- ✅ Firestore adapter (migration-ready)
- ✅ HiDPI canvas rendering
- ✅ UTC date parsing (distinct X-axis dates)
- ✅ Tests (13/13 passing)
- ✅ Documentation (README, WIKI, FIREBASE_SETUP, this file)

**Ship Date:** PR #1  
**Status:** Production-ready with documented gaps

---

## Submission Notes

**How to Add Requests:**
1. Add new section with title
2. Set status: open | doing | done
3. Describe request clearly
4. List verification criteria
5. Note blockers if any
6. Set priority

**Marking Done:**
- Must actually work in the UI (not just code present)
- ETH Y-axis not 57k → verify ETH loads ETH
- Load Data redraws → verify button triggers fetch
- Distinct dates → verify X-axis shows 8/1, 8/2, not all 12/31
- Toggles change canvas → verify chart redraws on checkbox

**Stay Honest:**
- If a feature is broken, status = open or doing
- If a feature is half-done, note what's missing
- If a feature has gaps, document them

---

**Last Updated:** 2026-09-03  
**Maintainer:** Kevin (reviewer), updated by Scoreboard team  
**Status Tracking:** This file updated as features ship
