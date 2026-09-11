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

### Ticker text field (any crypto / stock)
**Status:** doing  
**Request:** Replace the Overview asset combo box with a ticker text field. User types/adds any crypto or stock (`ETH`, `SOL`, `AAPL`, …), then Load Data fetches daily + hourly and charts them on the same Lightweight Charts path as BTC/ETH. Cache each asset. A later pull fetches only the latest increment (OKX watermark + overlap), not a full re-download.

**Must ship:**
1. Text input + Add/Load (optional short recent/favorites list). Entering a ticker attempts load. Keep `#symbol-select` as a hidden sync for scanner/forecast jump.
2. Crypto: OKX public `history-candles` for `{SYM}-USDT-SWAP`, falling back to `{SYM}-USDT` spot when the swap instrument does not exist. Persist `ingest_series` + `ingest_watermarks` per `(source, symbol, interval)` for `1h` and `1d`. Second Load Data sends `before=<watermark − 3 bars>`.
3. Stocks: any well-formed US ticker (not a hardcoded allowlist) uses `stock-public` against the **Yahoo Finance public chart API** (Stooq daily CSV fallback). Daily required; hourly when Yahoo returns 1h. Watermark incremental like OKX. Honest empty + note if the public source fails. **Do not invent prices. Do not hardcode fake equity series.**
4. Charting: same overlays as BTC/ETH for that series. Missing ETF/OI/Ichimoku-from-pack say **missing**.
5. Do not break BTC/ETH pack charts: unlabeled pack candles/OI stay BTC; ingest rows are filtered by symbol; pack daily indicators merge with ingest OHLC (pack MAs/Ichimoku kept when ingest lacks them).

**Verification:**
- `npm test` — ticker normalize (CDNS is equity without an allowlist); mocked HTTP incremental ETH/SOL fetch; stock adapter returns Yahoo-shaped rows or honest empty; ETH ingest 1h does not pollute BTC
- Localhost: type `ETH` / `SOL` → Add/Load → candles + increment on second Load Data; `CDNS` / `AAPL` → Yahoo daily last bar near today (or honest empty if the public source fails)
- BTC 1d / ETH 1d pack path still plots the correct asset

**Design:** `docs/WIKI.md` (Arbitrary tickers)

**Priority:** High

---

### ✅ Custom Tickers
**Status:** done (12 symbols supported; dropdown replaced by ticker field — see above)  
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
- OKX candles: **done** for BTC (`1h`/`1d`) and ETH (`1h`/`1d`) (true incremental; public `history-candles`; per-source+symbol+interval watermark + overlap; second refresh sends `before=`). OKX OI remains **BTC only**. Verified live (prior): BTC 1h candles URL returned 6 rows, sample close 80853 at 2026-09-03 16:00:00 UTC; OI 6 rows, `oi` 2.925M contracts. `npm test` mocks HTTP.
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

### Daily last bar stuck on pack date (prefer live OKX ingest)
**Status:** done  
**Request:** Kevin (2026-09-11 PT): Daily last bar looks like ~Aug 31 while today is Sept 11. Hourly works fine. Incremental refresh should pull only the missing daily tail, same as BTC hourly. Free-text ticker UI is a separate follow-up — not this item.

**Root cause (verified, do not re-derive):**
1. `SeriesModel.getSeries` for `1d` preferred `getDailyFromIndicators(symbol)` (stagnant Flow pack `indicators_daily.csv`) and only fell back to `getBtcCandles('1d')` if that was empty. Live OKX daily rows were already in `store/ingest_series.json` (BTC 1d watermark lastTimestamp ~2026-09-10 16:00 UTC) and refresh adapters already included `okx-candles BTC 1d`. The chart never showed them because the pack won.
2. `defaultAdapters()` registered OKX candles/OI for **BTC only**. No ETH OKX candle adapter, so ETH daily could not extend via live incremental ingest.
3. “4-week probe / pack unrebuilt” is secondary: even with a live OKX daily watermark, the UI path ignored fresher ingest.

**Must ship:**
1. For daily BTC (and any symbol with live OKX/ingest candles): prefer / merge live `okx-candles` over pack indicators so the last daily bar is current (within ~1 day of now after Load Data). Do not invent bars. Gaps stay gaps.
2. Register OKX ETH-USDT-SWAP candle adapters for `1h` and `1d` (public, no key — same endpoints as BTC with `instId=ETH-USDT-SWAP`). Watermarks per source+symbol+interval. Second refresh only requests the delta (`before=`).
3. After Load Data, BTC 1d and ETH 1d last bar date near today (Sept 11 2026 era), not stuck on an old pack date. Hourly keeps working.
4. Tests: series preference prefers fresher ingest over older pack; ETH adapters exist; idempotent second daily refresh uses watermark/`before=`. `npm test` passes.

**Design:** `docs/WIKI.md` (Data Ingestion — series preference / live vs pack)

**Verified (agent, 2026-09-11):** Seeded stagnant `indicators_daily.csv` ending **2026-08-31**. Old 1d path (`getDailyFromIndicators`) last bar stayed `2026-08-31T00:00:00.000Z`. After live OKX refresh + merge, `getSeries` last bars:

| Series | Last timestamp (UTC) | Close |
|---|---|---|
| BTC 1d | **2026-09-11T16:00:00.000Z** | 77864 |
| ETH 1d | **2026-09-11T16:00:00.000Z** | 2569.05 |
| BTC 1h | 2026-09-11T16:00:00.000Z | 77855.7 |
| ETH 1h | 2026-09-11T16:00:00.000Z | 2569.05 |

Pack indicators still ended Aug 31 after refresh (ingest did not rewrite the CSV). Second daily refresh sent `before=1788883200000` for BTC and ETH (`instId=ETH-USDT-SWAP`); inserted 0, rowCount unchanged. `npm test` 159/159.

**Not in this slice:** free-text ticker field.

### Daily last bar is a null pack stub after live merge
**Status:** doing  
**Request:** Residual after PR #13 (Kevin’s Mac, 2026-09-11 PT). `mergeDailyPreferLive` prefers live OHLC on overlapping dates, but Flow pack `indicators_daily.csv` still has trailing rows through **2026-09-26** with `close: null`. Those pack-only null days sort **after** the live last bar (BTC ingest last finite close ~2026-09-10 / agent 2026-09-11), so `getSeries('BTC','1d').at(-1)` is a null-close future pack day. Chart “last bar” still looks wrong. ETH 1d ingest count is 0 until a fresh Load Data with the ETH adapters.

**Must ship:**
1. Do not keep pack-only rows that lack a finite `close` (trim trailing non-finite closes after merge). Live gaps stay gaps — do not invent closes.
2. After merge+optional refresh, last BTC/ETH 1d bar with finite close is the live OKX day (near today), not a null pack stub.
3. Test: pack with older real days + future null closes + live mid date → series last finite close equals live; null pack tails discarded.
4. Docs + `npm test`. No free-text ticker UI.

**Design:** `docs/WIKI.md` (series preference — pack null tails)

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

### E*TRADE Activity CSV preamble + #/$ headers
**Status:** done  
**Request:** E*TRADE Activity exports put a title / account / `Total:` preamble before the real header (around line 7). Import was treating line 1 as the header and failing with “No recognized Activity CSV columns”, then every data row as “no usable Activity/Trade or Transaction Date” / “unsupported activity type”. Headers also ship as `Quantity #`, `Price $`, `Amount $`.

**Must ship:**
1. Scan lines for a row containing `Activity/Trade Date` (or `Activity Type` + `Symbol`) and parse from there
2. Normalize header names: strip trailing `#` / `$` / spaces; case-insensitive match
3. Map Bought / Sold to REAL fills when qty+price are present. Bought To Open and Option Expired stay option events (not share lots). Dividend, Qualified Dividend, Exchange Delivered Out / Received In stay non-fill events and must not abort the import
4. Synthetic fixture only — do **not** commit Kevin’s private CSV or real account numbers/symbols. Import stays FileReader / local-only

**Verification:**
- `npm test` (PR #11): preamble fixture finds columns; FAKE1 Bought/Sold become REAL lots. Follow-up: Bought To Open is an option event and does **not** add share lots (qty 6, basis $150, realized $59.60 from Bought/Sold only). Dividend / Option Expired / Exchange rows stay non-fills; no “No recognized Activity CSV columns”
- Localhost UI (2026-09-05, synthetic CSV only — not Kevin’s E*TRADE file): Investments tab privacy warning + file picker; preamble + `Quantity #`/`Price $`/`Amount $` preview listed buy/sell/dividend/expired/exchange as REAL; Commit enabled. Mapping warnings on option/expired/exchange only (not abort). File stays in the browser.

**Shipped:** Investments CSV parser scans for the real header; `#`/`$` suffixes normalize to Quantity/Price/Amount. Helper: `buildEtradePreambleCsv` in `public/js/investments/csv.js`.

**Local synthetic CSV to try:**
```
Investment Transactions Activity Types

Account Activity for Synthetic Account -0000 from 2025-01-01 to 2026-09-03

Total:,20519.86

Activity/Trade Date,Transaction Date,Settlement Date,Activity Type,Description,Symbol,Cusip,Quantity #,Price $,Amount $,Commission,Category,Note
08/10/2026,08/10/2026,08/12/2026,Bought,SYNTHETIC BUY FAKE1,FAKE1,SYN-FAKE1,10,25,-250,1,Trade,synthetic-bought
08/12/2026,08/12/2026,08/14/2026,Bought To Open,SYNTHETIC OPEN FAKE1,FAKE1,SYN-FAKE1,2,20,-40,,Trade,synthetic-bought-to-open
08/20/2026,08/20/2026,08/22/2026,Sold,SYNTHETIC SELL FAKE1,FAKE1,SYN-FAKE1,4,40,160,,Trade,synthetic-sold
06/01/2026,06/01/2026,06/01/2026,Qualified Dividend,SYNTHETIC DIVIDEND FAKE1,FAKE1,SYN-FAKE1,,,12.5,,Dividend,synthetic-dividend
05/01/2026,05/01/2026,05/01/2026,Option Expired,SYNTHETIC OPTION EXPIRED,FAKE3,,1,,,,Option,synthetic-option-expired
04/01/2026,04/01/2026,04/01/2026,Exchange Delivered Out,SYNTHETIC EXCHANGE OUT NO SYMBOL,--,,3,,,,Exchange,synthetic-exchange-out-dash
04/01/2026,04/01/2026,04/01/2026,Exchange Received In,SYNTHETIC EXCHANGE IN,FAKE5,SYN-FAKE5,3,,,,Exchange,synthetic-exchange-in

Brokerage services are offered by Morgan Stanley Smith Barney LLC, Member SIPC.
© 2026 Morgan Stanley Smith Barney LLC. Member SIPC.
```
Save as `synthetic-etrade-activity.csv`, `npm start`, Investments tab → choose file → preview → Commit. Do not use Kevin’s real export. Expected after Commit: FAKE1 qty 6, basis $150, realized $59.60, dividends $12.50. Footer prose is not a row. Bought To Open / Option Expired do not change FAKE1 lots. Exchange `--` stays needs-mapping.

---

### E*TRADE footer skip + option events stay off share lots
**Status:** done  
**Request:** After PR #11, Buys/Sells are correct. Remaining Activity CSV issues:

1. Skip trailing disclaimer/footer prose. E*TRADE files end with a blank gap then legal paragraphs (Morgan Stanley / “Brokerage services are offered…”). Stop parsing after a blank gap or consecutive non-dated non-activity rows. Do not surface footer lines as unsupported trades.
2. Option Expired and Bought To Open must **not** become share lots on the underlying symbol. Keep them as option events, or skip them from FIFO share P&L, unless an explicit option-contract mapping exists. Empty option price stays **missing**, never a 0 fill. Do not invent contracts.
3. Exchange Delivered Out with Symbol `--` stays needs-mapping (no inference). Exchange Received In with a symbol still needs user cost/mapping; do not invent a price. Preserve the raw event.
4. Cash dividends missing qty/price is correct — leave that.

**Must ship:**
- Parser stops at footer gap / consecutive non-dated non-activity / Morgan Stanley disclaimer text
- Bought / Sold still become REAL share lots
- Bought To Open / Option Expired do not change underlying share qty or cost basis
- Empty option price is missing, not 0
- Exchange `--` and Exchange Received In stay needs-mapping / no invented price
- Dividend missing qty/price remains a non-fill dividend event
- Synthetic fixture only (FAKE symbols). No private account numbers/tickers. Import stays FileReader / local-only

**Verification:**
- `npm test` — 151/151. Footer prose is ignored (no unsupported-trade warnings); FAKE1 Bought 10 @ 25 + Sold 4 @ 40 → qty 6, basis $150, realized $59.60; Bought To Open / Option Expired skipped from share lots (even with a symbol map); Option Expired empty price is `null` not 0; Exchange `--` and Exchange Received In stay `needs_explicit_mapping` with price missing; Qualified Dividend stays a dividend with qty/price missing and amount $12.50
- Do **not** upload or commit Kevin’s private CSV

**Shipped:** `parseActivityCsv` stops after a post-data blank gap, two consecutive non-dated non-activity rows, or footer-prose keywords. `Bought To Open` classifies as `option` (not `buy`). Option/expired events never open FIFO share lots. Helper footer: `ETRADE_SYNTHETIC_FOOTER` / `footer: true` on `buildEtradePreambleCsv`.

**Localhost UI (2026-09-08, synthetic CSV only — not Kevin’s E*TRADE file):** Investments preview listed buy / option / sell / dividend / expired / exchange; footer prose was not a row; no unsupported-activity warning. Option Expired price **missing** (not 0). Exchange `--` symbol missing + needs-mapping; Exchange FAKE5 price missing + needs-mapping. After Commit: FAKE1 qty 6, basis $150.00, realized $59.60, dividends $12.50. File stays in the browser.

---

### Watch / Track rows (open vs close) — not a transaction ledger
**Status:** doing  
**Request:** Kevin does not like the TRACKING / Investments screen. Missing useful tracking tools. Rewrite so **WATCH / TRACK rows** are the primary UI (not a fill/ledger dump). Useful for deciding **open vs close**. Real E*TRADE positions stay secondary and distinct.

**Verified before the rewrite (do not re-guess):**
1. UI was ledger-first: REAL section listed every imported transaction; watch/start-track was buried under paper BUY/SELL.
2. Mark and Unrealized were always `missing` in the UI — `InvestmentsController.markPrices` stayed `{}` and was never filled from Overview ingest.
3. Activity `Price × Qty` lots were correct when the file was an Activity export. **Cost Basis / Average Cost / Last Price** headers were not in `HEADER_ALIASES`. A Positions/holdings CSV failed with “No recognized Activity CSV columns”, so cost never landed. If Price/Last Price (mark) were treated as fill cost, basis would equal mark and unrealized would be $0.

**Must ship:**
1. Add a symbol + target. Direction defaults to long / call / buy. Start date is a date picker defaulting to today. Put/sell is available (cheap).
2. On Refresh, load **current price** via the same incremental ingest as Overview (`POST /api/refresh?symbol=` then `GET /api/indicators` — Yahoo equities / OKX crypto). Do not invent prices. Missing stays missing.
3. Each watch row: symbol, start date, cost/entry (if a REAL lot exists) or start mark, live mark, % gain/loss, target, in-range badge. In-zone rows are visually obvious and pinned to the top.
   - Long, no lot: **buy zone** when mark ≤ target (open).
   - Long, has REAL lot: **sell zone** when mark ≥ target (close).
   - Short is the inverse. Optional target-to makes a range.
4. REAL positions (secondary): cost, mark, unrealized $, %. Paper/tracking vs REAL stay distinct.
5. E*TRADE Positions mapping: Cost Basis / Average Cost → lot cost. Last Price / Price → mark hint only, never cost. Activity fills still use Price. FileReader only; synthetic fixtures only.
6. Hide/bury the transaction ledger (`<details>`). No transaction dump as the primary view.

**Verification:**
- `npm test` — watch % / in-zone / pin; Positions Cost Basis ≠ Last Price; primary HTML is watchlist not ledger
- Localhost: add CDNS or BTC + target + start=today → Refresh shows live mark and % vs start. Import synthetic Positions → FAKE1 cost $150, mark, unrealized $, %. In-zone row highlighted. Ledger is collapsed.

**Privacy:** never commit/upload Kevin’s private CSV. No brokerage keys. No live trades. Not Pooli.

**Design:** `docs/WIKI.md` (Investments / Watch / Track)

**Priority:** High

---

### Forecasts tab (scored history)
**Status:** doing  
**Request:** The Forecasts tab must list **actual scored forecasts**, not a dead generate-cards page. Second product slice after Investments. Research/paper only — no keys, no trades, not Pooli.

**Must ship:**
1. Functional Forecasts tab listing forecasts by symbol, horizon, as-of timestamp
2. Each row: predicted range/point, confidence, model/version, actual outcome when matured, MAE/direction vs naive, status (`too-early` | `matured` | `missing-actual`)
3. Click a forecast: jump Overview chart to that as-of timestamp and show rationale/features used
4. Filter by REAL holdings vs TRACKING assets via Investments local store `scoreboard.investments`. If that store is empty, show all forecasts and note the holdings filter is inactive
5. Weekly / monthly horizon filters
6. Persist forecast history in a schema-versioned local **and** server store with migrations. Reuse `src/model/forecast.js` (trend + naive) — do not invent prices or outcomes
7. When actuals are unavailable, status is too-early or missing-actual. **Never fake 0 MAE**
8. Export JSON/CSV of the (filtered) forecast list

**Honesty:**
- Outcomes come from the same series closes used by Overview (Flow pack / ingest store) or, when the pack is absent, the labeled deterministic fixture already used by backtest. Fixture closes are not live market claims.
- Missing or not-yet-elapsed actuals stay `missing` / `too-early`. MAE fields stay `null` (UI: `n/a`), never `0`.

**Verification:**
- `npm test` — maturity transitions, MAE vs naive on synthetic matured cases, REAL/TRACKING filter, click payload includes chart jump timestamp + rationale
- Localhost: Forecasts tab lists scored rows (fixture or pack). Empty state is honest if nothing can be scored. Click jumps Overview. Investments and Overview stay intact.

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

**Localhost UI (2026-09-03, this host — no Flow pack; OKX incremental filled BTC 1d):**
- Universe: research-only banner; 100 rows after CoinGecko refresh; count “1 with price · rest missing (not 0)”
- BTC (after refresh): live price ~$80,976, 1d/7d/30d BULLISH, consensus BUY — not a fabricated rank
- AAVE/ADA/alts without series: every market cell **missing**, never 0
- Asset class = Stock: honest empty state
- Investments start-track ETH @ 2000 → Universe TRACKING badge; Remove Tracking keeps history; evaluation baseline $2,000, status stopped, model/actual **missing** (no ETH series)
- BTC row click opens Overview with symbol BTC

**Priority:** High

---

## Chat

### Inline Chat pane (Bullmania-style, research only)
**Status:** done  
**Request:** Persistent in-app Chat tab/pane so Kevin can ask about any investment (example: “what are 5 crypto coins that are doing buybacks”) and tap a resolved asset onto the Overview chart. Personal hobby / research. No keys, no live trades, no custody. Not Pooli. No NFA banner.

**Must ship:**
1. Chat tab (vanilla HTML/CSS/JS MVC). History in schema-versioned `scoreboard.chat` localStorage. Clear. No NFA banner.
2. Defined **tool loop** (not UI regex ticker parsing): `resolve_assets` (dynamic, not catalog-only), `refresh_series` (same Overview ticker path), `get_chart_context`, `web_search`. Final assistant turn is structured `content[]` (`text` + `asset_card`). **No card without a successful `resolve_assets` row.** Junk tokens only: text-only “couldn’t resolve”. Real listed tickers must load + search before that line.
3. Every resolved stock/crypto is a tappable chip/card. Tap calls `AppController.loadAsset({ symbol, assetClass, intervalHint })` — same Overview symbol + **Load Data** path (`reloadSelected`). Free-text ticker work (PR #14 / `bc-cde1c994`) is **not** on main yet; this seam is thin so that PR can fill `#ticker-input` later. Do **not** duplicate OKX watermark ingest (PR #13).
4. “load SKR”, “compare MSTR vs BTC” go through tools, not a client regex.
5. Model wiring: if `OPENAI_API_KEY` or `XAI_API_KEY` / `GROK_API_KEY` is set **server-side**, use that function-calling endpoint. **Never** put keys in the repo or client JS. If no key: full UI + tool loop + card renderer + deterministic **local stub** that exercises resolve → cards → tap-to-load.

**Honesty:**
- Cards only after `resolve_assets` succeeds. Catalog is hints/tags, not the sole resolve source. Well-formed US tickers (CDNS, …) resolve as equity.
- `get_chart_context` never invents OHLCV — cached series or “missing”.
- Buyback / research lists are a labeled static catalog, not a live on-chain feed.
- House cloud agents stay grok-4.6. In-app chat uses whatever tool-calling key is already on the server, else the stub.

**Verification:**
- `npm test` — resolve success → cards; unknown → no card; search → resolve → cards; tap/load payload; history schema migration; NFA banner absent
- Localhost UI (2026-09-11, this host — no Flow pack, **stub** provider, no LLM key): Chat tab Clear + demo-provider note (no NFA banner). “5 buyback coins” → BNB/MKR/OKB/LEO/KCS cards. Tap BNB → Overview symbol BNB + Load Data path (`No data available for BNB 1d` is honest — pack missing). History persisted across tabs. “load SKR” and “compare MSTR vs BTC” cards. `load ZZQXNOTATICKER` → text-only couldn’t resolve, no card. Clear empties transcript.
- No secrets in git

**Design:** `docs/WIKI.md` (Inline Chat pane)

**Priority:** High

---

### Production Chat LLM (xAI Grok 4.6 + OpenAI)
**Status:** done  
**Request:** Wire the research-only Chat pane to real LLMs on Kevin’s Mac. Keep the existing tool loop + structured `asset_card`s. Default model: **Grok 4.6**. Easy swap to OpenAI. Never Pooli. Never commit keys.

**Must ship:**
1. xAI + non-5.6 OpenAI over OpenAI-compatible `/chat/completions`. OpenAI GPT-5.6 family uses `/v1/responses` for function tools (chat/completions rejects tools unless `reasoning_effort` is `none`). Stub when no usable key.
2. Default xAI model id `grok-4.6` (verified against current xAI docs). OpenAI default `gpt-4o-mini`.
3. Env defaults: `SCOREBOARD_CHAT_PROVIDER=xai|openai`, `SCOREBOARD_CHAT_MODEL=...`. In-app Chat settings (provider + model) persist in schema-versioned `scoreboard.chat` localStorage. Env wins when no override.
4. Tiny zero-dep dotenv loader reads gitignored `.env` on the Node server. Canonical keys (aliases accepted):
   - `SCOREBOARD_XAI_API_KEY` (aliases `XAI_API_KEY` / `GROK_API_KEY`)
   - `SCOREBOARD_OPENAI_API_KEY` (alias `OPENAI_API_KEY`)
   - `SCOREBOARD_CHAT_PROVIDER`, `SCOREBOARD_CHAT_MODEL`
   - optional `SCOREBOARD_XAI_BASE_URL`, `SCOREBOARD_OPENAI_BASE_URL`
5. `/api/chat/status` may expose `{ provider, hasLiveLlm, model }` — never the key. Request body/query/header may override provider/model only.
6. No NFA banner. Research/personal system prompt (no legal-spam disclaimer). Settings never store API keys in localStorage.

**Verification:**
- `npm test` — 223/223: env detection, alias keys, env vs request precedence, settings persist without keys, stub with no keys
- Localhost UI (2026-09-11, this host — no LLM key): Chat tab model picker (Provider/Model); no NFA banner. Server default → stub note naming `SCOREBOARD_XAI_API_KEY` / `SCOREBOARD_OPENAI_API_KEY`. Select xAI + Grok 4.6 still stub (honest). Load SKR → SKR card. Clear history keeps picker. `scoreboard.chat` schemaVersion 2 settings are `{ provider, model }` only — no keys. OpenAI + `gpt-4o-mini` still stub; tap SKR card → Overview ticker SKR + honest missing series. Live path unit-tested with mock fetch (`grok-4.6` + tools; GPT-5.6 → `/v1/responses`); this host had no key so live completions were not called.

**Shipped:** zero-dep `.env` loader; canonical `SCOREBOARD_*` vars + legacy aliases; default xAI model id `grok-4.6`; in-app picker persists in `scoreboard.chat` `collections.settings`.

**Design:** `docs/WIKI.md` (Inline Chat pane)

**Priority:** High

---

### Chat + Overview: any US equity (CDNS) without catalog allowlist
**Status:** done  
**Request:** Kevin / CoS (2026-09-11). Chat asked for a good entry on **CDNS** (Cadence). Reply was “couldn’t resolve CDNS in Scoreboard’s catalog” — no card, no chart. Root: `resolve_assets` was catalog-only (MSTR/COIN/TSLA/AAPL/NVDA). `stock-adapter.js` was an honest-missing stub. No `web_search`. Prompt forbade cards without resolve.

**Must ship:**
1. Equities: any well-formed US ticker resolves without a hardcoded allowlist. Catalog stays hints/tags only.
2. Real keyless stock adapter: Yahoo Finance public chart API (daily required; hourly when Yahoo returns 1h). Stooq daily CSV fallback. Watermark incremental like OKX. Honest empty if the public source fails — **never invent prices**.
3. Named-ticker Chat tool order: `resolve_assets` → `refresh_series` (same Overview ticker / Load Data path) → `get_chart_context` → `web_search` → `asset_card` + chart-grounded entry notes.
4. Prompt: never “couldn’t resolve” for a real listed ticker until load+search failed. No NFA banner.
5. Overview ticker Load Data and Chat tap chart CDNS.

**Verification:**
- `npm test` — dynamic resolve CDNS; stock adapter recorded Yahoo fixture or honest empty; tool order resolve→refresh→chart→search; no invented live CDNS OHLC
- Live Yahoo CDNS 1d last bar near today when the VM can reach query1.finance.yahoo.com

**Shipped:** Yahoo `v8/finance/chart` (documented source). Stooq often JS-challenge blocked from this host. Chat tools wired for OpenAI Responses + xAI chat/completions via the existing loop.

**Design:** `docs/WIKI.md` (equity adapter + Chat resolve/search)

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

**Last Updated:** 2026-09-11 (CDNS dynamic equity + Yahoo adapter + Chat tool order)  
**Maintainer:** Kevin (reviewer), updated by Scoreboard team  
**Status Tracking:** This file updated as features ship
