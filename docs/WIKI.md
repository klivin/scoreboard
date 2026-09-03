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
- `ingest.js` - Pack-file parsers (CSV/JSON on disk). No network.
- `okx-adapter.js` / `fallback-adapters.js` / `refresh.js` - Incremental ingest (OKX live; ETF/CG fallback)
- `store.js` - Local JSON storage (forecasts, errors, universe, ingest_watermarks, ingest_series)
- `store-adapter.js` - Abstraction layer for local/Firestore backends

**Investments (browser-local, not the chart store)** (`public/js/investments/`)
- `schema.js` - `schemaVersion` + collection namespaces + migrations
- `store.js` - `localStorage` key `scoreboard.investments` only (never `store/*.json`)
- `csv.js` / `parse.js` / `validate.js` - Activity CSV parse, normalize, preview
- `lots.js` - FIFO and average-cost lots, P&L, drawdown (REAL and TRACKING separate)
- `tracking.js` - paper BUY/SELL + start/stop tracking (always TRACKING)
- `markers.js` / `export.js` - chart marker payloads + local CSV/JSON export
- `view.js` / `controller.js` - Investments tab UI (FileReader; no upload)

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

### Current behavior (before incremental refresh)

`src/model/ingest.js` has **zero network calls** (no `fetch` / `https` / `axios`). Load Data used to re-read the same static Flow-pack CSV/JSON files from disk (`/workspace/scoreboard` overlay, then repo `data/`). That was a static replay of whatever Flow last dropped: no live OKX/Farside/CoinGecko fetch, no cursor, no watermark, no dedup.

Pack files remain a **seed / fallback** for series that are not live (alt daily indicators, ratios, correlations) and for ETF/CoinGecko when the public page/API cannot be fetched.

### New architecture

```
POST /api/refresh
    → source adapters.fetchSince(cursor)
    → normalize to existing series shape
    → validate monotonic timestamps + flag gaps (never invent / zero-fill)
    → upsert ingest_series by natural key (symbol+interval+timestamp)
    → atomically write ingest_watermarks only after that page succeeds
GET /api/indicators  (and the chart)
    → seriesModel.load() merges ingest_series over the pack
    → never reads the raw dump as the Load Data path
```

**Adapter interface**

```
{ id, symbol, interval, mode, fetchSince(cursor) -> { rows, nextCursor } }
```

- `cursor` for incremental sources: `{ lastTimestamp, since }` where `since` is `lastTimestamp` minus a 3-bar safety overlap.
- `nextCursor` is `{ lastTimestamp }` for OKX. ETF and CoinGecko return `nextCursor: null` — they do **not** fake a cursor.

**Watermark store** (`store/ingest_watermarks.json`, Firestore-migratable collection `ingest_watermarks`)

Per `(source, symbol, interval)`:

```
{ lastTimestamp, lastSuccessAt, rowCount }
```

Advanced only after fetch + normalize + upsert of the whole page succeeds. A failed HTTP call leaves the previous watermark in place.

**Refresh API (polling, not SSE)**

```
POST /api/refresh?source=&symbol=&interval=
GET  /api/refresh/status
```

`POST` runs the selected adapters (all of them if no filter) and returns per-source progress, `lastSuccessAt`, and `lastSuccessAgeMs`. `GET /api/refresh/status` is the poll/status snapshot. Load Data calls `POST /api/refresh` first, renders last-success age per source, then reloads the chart from `/api/indicators` (store-backed).

No API keys in client JS. OKX public endpoints need none. Keyed sources are out of scope and must stay server-only if ever added.

### Per-source incremental vs fallback

| Source | Adapter id | Mode | What it does |
|---|---|---|---|
| OKX BTC-USDT-SWAP candles | `okx-candles` (`1h`, `1d`) | **incremental** | Live `GET https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT-SWAP&bar=1H\|1D`. Second refresh sends `before=<watermark - 3 bars>` so it only requests the delta (plus overlap). Public, no key. |
| OKX BTC-USDT-SWAP OI | `okx-oi` (`1h`, `1d`) | **incremental** | Live `GET https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=1H\|1D` with `begin=` when a cursor exists. `/api/v5/public/open-interest-history` is **404** (verified). Public, no key. |
| ETF net flows (Farside) | `etf-farside` (BTC, ETH) | **bounded-overlap fallback** | `fetchSince` **ignores** the cursor. Re-fetches/re-parses the whole small HTML table (or the pack CSV if Cloudflare/HTML fails), then dedupes by date. `nextCursor` is always `null`. Not claimed as incremental. |
| CoinGecko top100 | `coingecko-top100` | **bounded-overlap fallback** | `fetchSince` **ignores** the cursor. Re-fetches the whole top100 markets page. On **429**, re-parses `cg_top100_universe.json`. Categories stay blank when missing. `nextCursor` is always `null`. Not claimed as incremental. |

Do not invent series. ETH 1h, multi-exchange OI, and alt hourly candles are still absent.

### Source Priority (pack seed)

1. **Ingest store** after a refresh (`ingest_series` / `universe`)
2. **Overlay path:** `/workspace/scoreboard/` (Flow pack on shared computer)
3. **Repo path:** `./data/` (local development)
4. **Error:** If a required symbol+interval still has no rows (no silent fallback, no zeros)

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
- **Fit all** and **Last few days** are explicit controls, not the default
- **Overlay toggles preserve zoom/pan:** MA/Ichimoku/volume/ETF/OI/predicted toggles call `ChartView.refreshOverlays()`, which captures the visible logical range, updates series, then restores the range. Symbol, interval, Load Data, Fit all, and Last few days still reset viewport.

### Interactivity
- **Crosshair + tooltip** - Price and every selected overlay (MA20/50/100/200, Ichimoku, volume, ETF net flow, Open Interest) at that timestamp. Missing fields say `missing`, not `0`.
- **Day tap strip** - Clicking a bar fills `#chart-day-strip` with the same fields for that timestamp
- **Toggles** - Checkboxes add/remove Lightweight Charts series via `refreshOverlays()` (preserves zoom/pan). Volume / ETF / OI each get a new pane under price
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

**Did anything beat both baselines on this fixture?** No strategy or consensus beat buy-and-hold on total return (see `docs/BACKTEST.md`). Several beat the naive last-price forecaster only because naive stayed flat (0 trades): last close equals the naive prediction, so it never goes long. Do not oversell these results.

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

### Forecast Cards (Overview generate)
- **Horizons:** 1d, 7d, 30d
- **Sided prediction:** LONG/SHORT/NEUTRAL
- **Confidence bands:** Upper/lower bounds
- **Steelman analysis:** Pro case + Con case
- **MAE comparison:** "Naive baseline wins on recent MAE" or "Trend model shows lower MAE"
- **Recommendation:** Based on confidence and change %

### Scored forecast history (Forecasts tab)

**Status:** doing (second product slice). Research/paper only.

The Forecasts tab lists **walk-forward scored records**, not just the latest generate-card. Each record is produced by the existing trend/naive model on a historical as-of slice (`series[0..i]`). The actual is the close on the UTC day `asOf + horizonDays`. Prices and outcomes are never invented.

```
as-of bar t
  → generateForecast(series[0..t], horizonDays)   // trend point + bands + naive
  → target = asOfTimestamp + horizonDays (UTC days)
  → look up close on that UTC day in the full series
  → status + MAE only when that close exists
```

**Status machine**

| Status | When | MAE / direction |
|---|---|---|
| `too-early` | Last available series bar is still before the target UTC day | `null` (UI: n/a) — not 0 |
| `matured` | A bar exists on the target UTC day **and** `close` is finite | `\|predicted − actual\|` and `\|naive − actual\|`; direction hit vs as-of price |
| `missing-actual` | Target day is in-series (last bar ≥ target day) but that day’s close is blank or the bar is absent | `null` — not 0 |

**Horizons:** `weekly` = 7 UTC days, `monthly` = 30 UTC days (same day-count as the signal-engine weekly/monthly windows; still daily bars).

**Record (schemaVersion 1)**

```
{
  id, symbol, horizon, horizonDays, interval,
  asOfTimestamp, asOfDateUtc, asOfPrice,
  model, modelVersion,                 // trend / trend-v1
  predicted: { point, lower, upper },
  naive: { point },
  confidence,
  features: { lastPrice, trendPct, volatilityPct, ma20, … finite only },
  rationale: { side, recommendation, changePercent, proCase, conCase },
  actual: { close, timestamp, dateUtc } | null,
  score: { mae, naiveMae, direction, naiveDirection, maeVsNaive },
  status, targetTimestamp
}
```

**Stores (schema-versioned, migratable)**

| Store | Key / file | Role |
|---|---|---|
| Server | `store/forecasts.json` (Firestore collection `forecasts`) | Canonical history. File wrapper `{ schemaVersion, namespace, items }`. Unversioned `{ items }` from v1 generate-cards is migrated, never discarded. |
| Client | `scoreboard.forecasts` localStorage | Cached records + filter settings (`holdingsFilter`, `horizonFilter`). Own namespace — not mixed with `scoreboard.investments`. |

Migrations live in `src/model/forecast-schema.js` (server) and `public/js/forecasts/schema.js` (client).

**Holdings filter:** reads Investments `scoreboard.investments` collections (`events` = REAL symbols; `paperTrades` + `tracking` = TRACKING). If both are empty, the filter is **inactive** — the tab shows every forecast and says so.

**Click → Overview:** payload `{ chartJumpTimestamp, rationale, features, symbol, horizon }`. Overview time scale jumps to a window around `asOfTimestamp` and the rationale/features strip fills. No new prices are drawn.

**Seed:** `GET /api/forecasts` rescores stored rows against current series. If the store is empty it walk-forwards available 1d series. If the Flow pack is not mounted it uses the **labeled** backtest fixture (`src/model/fixtures/backtest-pack.js`) and sets `dataSource: "fixture"`.

**Export:** JSON/CSV of the currently filtered list (client Blob). MAE cells that are not matured stay empty/`n/a`, never `0`.

**API**

```
GET /api/forecasts
GET /api/forecasts?format=csv
GET /api/forecast?symbol=BTC&horizon=weekly|monthly|7|30
```

---

## Persistence

### Local Storage (Default)

**Directory:** `store/`

**Collections:**
- `forecasts.json` - Schema-versioned scored forecast history (`{ schemaVersion, namespace, items }`). Unversioned generate-cards are migrated; MAE is never invented as 0
- `error_logs.json` - MAE/MAPE plus ingest gap / refresh errors
- `universe.json` - Crypto universe data
- `ingest_watermarks.json` - Per-source `{ lastTimestamp, lastSuccessAt, rowCount }`
- `ingest_series.json` - Upserted adapter rows (natural key `source:symbol:interval:timestamp`)

**Browser local stores (separate namespaces):**
- `scoreboard.investments` — Investments tab (REAL / TRACKING)
- `scoreboard.forecasts` — Forecasts tab cache + filter settings

These server-side files are **not** used for brokerage imports. Investments use a separate browser namespace (`scoreboard.investments`).

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
GET /api/series?symbol=BTC&interval=1h&since=1700000000000
GET /api/series?symbol=BTC&interval=1h&sinceCursor=okx-candles:BTC:1h
GET /api/indicators?symbol=BTC&interval=1d
```

`since=<timestamp>` and `sinceCursor=<watermark id>` return only rows **after** that point (exclusive), from the same store/series data as the chart.

### Incremental refresh
```
POST /api/refresh
POST /api/refresh?source=okx-candles&symbol=BTC&interval=1h
GET  /api/refresh/status
```

Polling status (not SSE). `POST` is synchronous and returns the same per-source payload as status, including `requestedSince` / `requestUrls` so a second OKX refresh can be shown to request only the delta.

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
- Forecast maturity (`too-early` / `matured` / `missing-actual`) and MAE vs naive (never fake 0)
- Forecasts tab REAL/TRACKING filter + click payload
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
│   ├── FEATURE_REQUESTS.md
│   └── BACKTEST.md        # Snapshot of last fixture backtest (honest numbers)
├── public/                # Frontend
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js
│   │   ├── controller.js
│   │   ├── forecasts/     # Forecasts tab (list, filter, export, click jump)
│   │   ├── investments/   # Investments tab (local import)
│   │   └── view.js
│   └── index.html
├── src/                   # Backend
│   ├── controller/
│   │   └── api.js
│   ├── model/
│   │   ├── forecast.js
│   │   ├── forecast-schema.js
│   │   ├── forecast-score.js
│   │   ├── forecast-history.js
│   │   ├── backtest.js
│   │   ├── signals/
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
- **Cause:** Event listener not wired, or refresh hung
- **Fix:** Load Data calls `POST /api/refresh` then `GET /api/indicators`. Check `#refresh-status` for per-source last-success age. Verify controller `setupEventListeners()` calls `reloadSelected()`.

### Overlay toggles preserve zoom/pan
- **Symptom:** Toggling MA200 / Ichimoku / Volume snaps chart back to ~1-week default
- **Cause:** Toggle called full `render()` → `destroyChart()` → `applyDefaultViewport()`
- **Fix:** `refreshOverlays()` + `captureVisibleRange()` / `restoreVisibleRange()` in `public/js/chart-view.js`

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

## Investments (local-only)

**Status:** doing (first slice). Separate functional tab from Overview/Forecasts/Universe.

**Privacy:**
- Import is `<input type="file">` + `FileReader` in the browser. The raw CSV is never POSTed, never written under `store/`, and never sent to Firestore.
- UI shows a prominent warning: the file stays in this browser / local store and is not transmitted.
- Do not commit real E*TRADE activity files. Tests use synthetic rows with the same columns.
- No keys. No trades. Not Pooli.

**Store (schema-versioned):**
```
scoreboard.investments
  schemaVersion: 1
  collections.rawTransactions   # original parsed rows
  collections.events            # normalized events (REAL from import)
  collections.paperTrades       # TRACKING paper BUY/SELL
  collections.tracking          # start/stop watch records (history preserved)
  collections.symbolMaps        # explicit symbol/CUSIP remaps only
  collections.settings          # costMethod fifo | average
```

**REAL vs TRACKING:** confirmed imported holdings/transactions are REAL. Watchlist, paper marks, and start/stop tracking are TRACKING. Badges appear in the tab, P&L panels, and chart markers. P&L is never mixed across badges.

**Fills:** a buy/sell becomes a lot fill only when **both** quantity and price are present. Missing quantity or price is marked; no fill is inferred. Dividends, fees, exchanges, and options/expired do not invent fills. Exchanges / ticker changes / options require an explicit symbol map.

**P&L:** FIFO (default) or average-cost. Realized, unrealized, cost basis, return, dividends, drawdown. Missing mark prices stay `missing`, not `0`.

**Charts:** transaction markers on the Overview asset chart (exact date, qty, price, fees, source, badge). Click/tap opens a detail strip.

**Export:** client-side JSON/CSV download via Blob. No server round-trip.

---

## Changelog

### Forecasts tab (scored history, second product slice)
- Forecasts tab lists walk-forward scored records: symbol, horizon, as-of, predicted range/point, confidence, model/version, actual, MAE vs naive, status
- Status `too-early` | `matured` | `missing-actual`. MAE is `null` unless matured — never a fake 0
- Click jumps Overview to the as-of timestamp and shows rationale/features
- REAL / TRACKING filter reads `scoreboard.investments`; empty store → filter inactive, all rows shown
- Weekly / monthly horizon filters; JSON/CSV export of the filtered list
- Schema-versioned server `store/forecasts.json` + client `scoreboard.forecasts` with migrations
- Reuses `src/model/forecast.js`. Fixture seed when Flow pack is absent (labeled, not live)
- Status: **doing**

### Investments tab (first slice, local-only)
- Investments tab: empty state, privacy warning, local file import, preview + Commit
- Schema-versioned `scoreboard.investments` store; REAL vs TRACKING never mix
- FIFO + average-cost lots; paper BUY/SELL; start/stop tracking preserves history
- Transaction markers on asset charts; local CSV/JSON export
- Tests: synthetic CSV only. Real brokerage files are not in-repo and were not imported
- Localhost UI (synthetic CSV): empty state + privacy warning, preview/Commit, REAL vs TRACKING, paper BUY, start/stop keeps history
- Chart markers unit-tested; live candle overlay not visually confirmed on this host (no Flow pack)
- Status: **doing** — first-slice UI/tests passed; screenshot import and broker sync stay open

### Signal engine + backtest (research, first slice)
- Extensible strategies: EMA golden/death (true EMA50), MACD from close, RSI recovery, Ichimoku pack fields
- Consensus 0–100 with breakdown; chart markers + strategy/horizon panel
- Walk-forward backtest vs buy-and-hold and naive; `npm run backtest`
- **Honesty:** on the CI fixture, nothing beat buy-and-hold. Status **doing**, not done
- Supertrend/ATR not implemented (open)

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

### Overlay toggles preserve zoom/pan
- Toggle handlers call `refreshOverlays()` instead of full `render()`
- Captured logical range restored after series add/remove (double `requestAnimationFrame`)
- Fit all / Last few days / symbol / interval / Load Data still reset viewport
- Status: **done** — verified on localhost (BTC 1d zoomed window survived MA200 / Ichimoku / Volume / ETF / OI; Fit all and 1h interval reset)

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

### Incremental refresh (this PR)
- Source adapters + `ingest_watermarks` / `ingest_series`
- OKX BTC-USDT-SWAP candles + OI are live incremental (public, no key)
- ETF (Farside) and CoinGecko top100 use the same interface as a bounded-overlap fallback — cursor is not faked
- Load Data refreshes sources first, then reads the store
- Export: `since` / `sinceCursor`
- Status: OKX incremental **done**. ETF/CG fallback **doing** (not incremental)

### Initial Release
- ✅ Vanilla JS MVC architecture
- ✅ Technical indicators (MA20/50/100/200)
- ✅ Naive baseline forecasting
- ✅ Local JSON storage
- ✅ CSV export
- ✅ Interactive charts with hover

---

**Last Updated:** 2026-09-03  
**Version:** v1.5 (Investments tab + local-only import)  
**Status:** Not Pooli. No keys client-side. No trades. Import stays in-browser.
