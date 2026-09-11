# Scoreboard Wiki

## Product Overview

Scoreboard is a crypto market analysis and forecasting dashboard built with vanilla JavaScript MVC architecture. It analyzes BTC and 11 altcoins using Flow's data pack, displays technical indicators, and generates forecasts with naive baseline comparison.

**Stack:**
- Frontend: Vanilla HTML/CSS/JavaScript (MVC pattern, no React)
- Chart: TradingView Lightweight Charts (see Chart Library below)
- Backend: Node.js + Express
- Storage: Local JSON files (Firestore-ready via adapter)
- Testing: Node.js native test runner

**No keys in the client. No trades. No Pooli.** Optional Chat LLM keys stay on the Node server in gitignored `.env`.

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
- `okx-adapter.js` / `fallback-adapters.js` / `stock-adapter.js` / `ticker.js` / `refresh.js` - Incremental ingest (OKX any crypto ticker; Yahoo Finance public equity candles; ETF/CG fallback)
- `store.js` - Local JSON storage (forecasts, errors, universe, ingest_watermarks, ingest_series)
- `store-adapter.js` - Abstraction layer for local/Firestore backends

**Investments (browser-local, not the chart store)** (`public/js/investments/`)
- `schema.js` - `schemaVersion` + collection namespaces + migrations
- `store.js` - `localStorage` key `scoreboard.investments` only (never `store/*.json`)
- `csv.js` / `parse.js` / `validate.js` - Activity CSV parse (header-row scan + `#`/`$` header normalize + trailing disclaimer skip), preview
- `lots.js` - FIFO and average-cost lots, P&L, drawdown (REAL and TRACKING separate)
- `tracking.js` - paper BUY/SELL + start/stop tracking (always TRACKING)
- `markers.js` / `export.js` - chart marker payloads + local CSV/JSON export
- `view.js` / `controller.js` - Investments tab UI (FileReader; no upload)

**View** (`public/js/view.js`, `public/js/chart-view.js`, `public/js/scanner/`)
- `ChartView` - Lightweight Charts price chart (pan/zoom, overlays, drawings)
- `StatsView` - Statistics cards
- `SignalsView` - Market signals (ETF flows, OI, ratios)
- `ForecastView` - Forecast cards with steelman analysis
- `UniverseView` / scanner - Universe tab money-scanner (research board)

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
| OKX BTC-USDT-SWAP candles | `okx-candles` BTC (`1h`, `1d`) | **incremental** | Live `GET https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT-SWAP&bar=1H\|1D`. Second refresh sends `before=<watermark - 3 bars>` so it only requests the delta (plus overlap). Public, no key. |
| OKX ETH-USDT-SWAP candles | `okx-candles` ETH (`1h`, `1d`) | **incremental** | Same public candles endpoint with `instId=ETH-USDT-SWAP`. Own watermark `okx-candles:ETH:1h` / `okx-candles:ETH:1d`. Second refresh sends `before=` for that symbol+interval only. Public, no key. ETH is in `defaultAdapters` so Load Data without a ticker still refreshes it. |
| OKX `{SYM}-USDT-SWAP` / `{SYM}-USDT` candles | `okx-candles` (`1h`, `1d`, any crypto ticker) | **incremental** | Same public `history-candles` path for tickers typed in Overview. Default instId is `{SYM}-USDT-SWAP`. If OKX returns instrument-missing (`51001`), retry `{SYM}-USDT` spot. Watermark key is `(okx-candles, SYM, interval)` — a later Load Data only requests the overlap-adjusted tail. |
| OKX BTC-USDT-SWAP OI | `okx-oi` (`1h`, `1d`) | **incremental** | Live `GET https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=1H\|1D` with `begin=` when a cursor exists. `/api/v5/public/open-interest-history` is **404** (verified). Public, no key. ETH swap OI uses the same path when ETH is loaded. |
| ETF net flows (Farside) | `etf-farside` (BTC, ETH) | **bounded-overlap fallback** | `fetchSince` **ignores** the cursor. Re-fetches/re-parses the whole small HTML table (or the pack CSV if Cloudflare/HTML fails), then dedupes by date. `nextCursor` is always `null`. Not claimed as incremental. |
| CoinGecko top100 | `coingecko-top100` | **bounded-overlap fallback** | `fetchSince` **ignores** the cursor. Re-fetches the whole top100 markets page. On **429**, re-parses `cg_top100_universe.json`. Categories stay blank when missing. `nextCursor` is always `null`. Not claimed as incremental. |
| Stocks | `stock-public` (`1h`, `1d`) | **incremental** | Yahoo Finance public chart API `GET https://query1.finance.yahoo.com/v8/finance/chart/{SYM}?interval=1d\|1h` (query2 host fallback). First load uses `range=5y` (1d) or `range=3mo` (1h). Second refresh sends `period1`/`period2` from the watermark overlap. Daily is required; hourly when Yahoo returns 1h bars. Stooq `https://stooq.com/q/d/l/?s={sym}.us&i=d` is a daily fallback (often JS-challenge blocked from datacenter IPs). Empty + note if both fail. **Never invents prices.** |

Do not invent series. Multi-exchange OI is still absent. ETH 1h/1d live candles come from OKX ingest after Load Data (ETH is in `defaultAdapters`), not from interpolating the pack. Alt 1h that OKX lists (SOL, etc.) can be ingested after Add / Load; alts that OKX does not list stay missing (not interpolated, not zero-filled).

### Series preference (live ingest vs pack indicators)

Daily charts used to prefer `indicators_daily.csv` and only fall back to OKX candles when that file was empty. That left BTC/ETH 1d stuck on a stagnant pack date (~Aug 31) even when `ingest_series` already had a live `okx-candles` 1d watermark (~Sept 10).

`getSeries(symbol, '1d')` now **merges** pack indicator rows with live `okx-candles` (plus BTC pack candle CSVs) **by calendar date** (`mergeDailyPreferLive`):

- Overlapping dates: live OKX OHLC wins. Pack MA/Ichimoku columns are kept when the live row does not carry them.
- Live-only dates (the missing daily tail) are appended. Pack-only older days with a finite close stay.
- Pack-only rows **without a finite `close`** are dropped (Flow pack `indicators_daily.csv` can carry probe stubs through a future date such as 2026-09-26 with `close: null`). After merge, trailing non-finite closes are trimmed so `.at(-1)` is the last live OKX day, not a null pack stub. Live gaps stay gaps — closes are not invented or zero-filled.
- Missing calendar days stay missing. No invented bars, no zero-fill.
- Hourly is candles-only (never interpolated from daily). BTC 1h still reads the OKX 1h pack/ingest overlay. ETH 1h reads live ingest after Load Data; if ingest is empty the on-page missing message still fires. ETH 1d ingest is 0 until Load Data runs the ETH OKX adapters.

ETH (and other alt) ingest is **not** written onto the BTC pack candle files (`okx_btc_usdt_swap_candles_*.csv`). Those overlays stay BTC-only so equal timestamps cannot clobber BTC. Non-BTC rows live on `pack.live_candles` / `ingest_series` filtered by symbol. Overlay keys are `symbol|timestamp` so same-clock BTC/ETH/SOL rows coexist.

---

## Arbitrary tickers (Overview text field)

**Status:** doing. Research / paper only. No brokerage keys. Not Pooli.

The Overview **combo box is replaced** by a ticker text field + **Add / Load**. The user can type any crypto or stock (`ETH`, `SOL`, `AAPL`, `ETH-USDT-SWAP`). Interval still has `1h` / `1d`. Load Data refreshes **both** hourly and daily for that ticker, then charts the selected interval on the same Lightweight Charts path as BTC/ETH.

Chat tap-to-load (`AppController.loadAsset` / `public/js/load-asset.js`) writes `#ticker-input` and calls `setSelectedSymbol` when present, then the same `reloadSelected()` path. Do not add a second OKX watermark ingest in the Chat seam.

```
type/add ticker
  → normalizeTicker (uppercase, strip $, BTCUSDT / BTC-USDT-SWAP → BTC)
  → classify: known crypto | well-formed US ticker (equity) | pair-suffix crypto | unknown (try OKX)
  → POST /api/refresh?symbol=SYM   // creates adapters if needed; 1h + 1d
  → upsert ingest_series + ingest_watermarks (source, symbol, interval)
  → GET /api/indicators?symbol=SYM&interval=
  → ChartView (same overlays; missing ETF/OI stay missing)
```

**Normalize** (`src/model/ticker.js`, mirrored in `public/js/ticker.js`):

| Input | Symbol | Class | OKX instIds tried |
|---|---|---|---|
| `eth` / `ETH` | ETH | crypto | `ETH-USDT-SWAP`, then `ETH-USDT` |
| `SOL-USDT` | SOL | crypto | spot first (hint), then swap already recorded |
| `BTCUSDT` | BTC | crypto | `BTC-USDT-SWAP`, `BTC-USDT` |
| `AAPL` / `AAPL.US` / `CDNS` | AAPL / CDNS | stock | none — Yahoo equity adapter |
| empty / junk | `''` | — | error, no fetch |

Well-formed US tickers (1–5 letters, not a crypto hint) **use the equity ingest path** even if they are not in the research catalog. Catalog names are hints/tags only. Crypto pair suffixes still attempt OKX. If Yahoo/Stooq return no bars, the chart says missing — we do not invent a series.

**Cache / increment**

- Natural key and watermark stay `(source, symbol, interval)` — `okx-candles:SOL:1h`.
- First load: recent OKX pages (no `before=`). Rows upserted; watermark advances only after the whole page succeeds.
- Second Load Data: `before=<lastTimestamp − 3 bars>` (same overlap as BTC). Never a full re-download when a watermark exists.
- Failed HTTP leaves the previous watermark in place.

**Series merge (do not break BTC/ETH)**

- Pack OKX candle/OI CSVs often have **no `symbol` column**. Unlabeled pack rows are **BTC only**.
- Ingest overlay keys by `symbol|timestamp` (unlabeled pack = BTC). A later BTC refresh must not erase ETH/SOL bars that share the same clock time.
- Ingest rows always carry `symbol`. `getSeries` / `getLiveCandles` filter labeled rows by ticker so ETH/SOL ingest cannot land on the BTC chart.
- Daily: `mergeDailyPreferLive` — pack `indicators_daily.csv` (MAs / Ichimoku) merges with live ingest daily OHLC by calendar date. Live OKX OHLC wins; pack indicator columns are kept when ingest does not provide them. Live-only dates append. Pack-only null-close tails are dropped.
- Hourly: `getLiveCandles` (BTC pack overlay + `live_candles` / ingest). Daily is never interpolated into 1h.
- Non-BTC ingest lives on `pack.live_candles`; BTC pack candle CSVs stay BTC-only.

**Stocks — Yahoo Finance public candles**

`src/model/stock-adapter.js` (`stock-public`) fetches keyless Yahoo Finance chart bars and caches them in `ingest_series` with a per `(source, symbol, interval)` watermark, same overlap as OKX. Daily is required; hourly when the Yahoo 1h series exists. Stooq daily CSV is a fallback. **Do not invent equity OHLC. Do not commit a fake live CDNS series** — tests use a file labeled `RECORDED_FIXTURE_NOT_LIVE` or a live fetch.

**UI**

- `#ticker-input` + `#ticker-add-btn` (Enter also loads)
- Optional recent chips (`localStorage` `scoreboard.recentTickers`, max 8)
- Hidden `#symbol-select` stays in sync so Universe row-click, Forecasts jump, and Chat tap-to-load still set the Overview ticker

**Files:** `src/model/ticker.js`, `src/model/stock-adapter.js`, `src/model/okx-adapter.js` (per-symbol instId), `src/model/refresh.js` (`adaptersForTicker` / `ensureSymbolAdapters`), `src/model/series.js` (symbol-filtered candles + `mergeDailyPreferLive`), `public/js/ticker.js`, `public/js/controller.js`, `public/js/load-asset.js`

### Source Priority (pack seed)

1. **Ingest store** after a refresh (`ingest_series` / `universe`) — live `okx-candles` preferred over older pack OHLC on the same day
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
  // 1d: merge indicators_daily.csv (by symbol) with live okx-candles for that symbol
  //     overlapping calendar dates prefer ingest OHLC; do not invent gap days
  // 1h: BTC/ETH live OKX candles only — never interpolate daily into 1h
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

## Universe money-scanner (research board)

**Status:** doing. The Universe tab is a **research / paper scanner**, not a trade blotter and not a ranked sentiment feed.

**Not a trade bot.** The banner on the tab is required: research only, no automatic recommendations, no execution, no keys. Paper tracking is TRACKING, never REAL.

### What a row is

Each row is a **supported** asset (Flow-pack crypto first; CoinGecko names if present; REAL/TRACKING symbols the user already has). Stocks and other classes appear only when we actually have them — the pack does not include equities, so stock cells stay missing / the stock filter is empty. Do not invent tickers.

| Column | Source | Missing behavior |
|---|---|---|
| Current price | Last finite close on the 1d series | `missing` (never `$0`) |
| Liquidity / freshness | Last finite volume + age of last bar | volume or age `missing` if unknown |
| 1d / 7d / 30d direction + confidence | Trend model (`generateForecast`) vs last close; confidence from the model’s own band width | both `missing` if no last price / forecast |
| Flip timestamp | Last bullish↔bearish change of **model direction** or **signal consensus** | `missing` if no prior state |
| Signal consensus | Existing signal engine (`evaluateWalkForward` / last event) | `missing` if no votes — **not** a fake 50 / NEUTRAL |
| Backtest status | Stored `store/backtest_{SYMBOL}_{horizon}.json` if present | `missing` — scanner does **not** invent a backtest or run one live |
| ETF / OI / corr | Pack ETF millions, OKX OI contracts, `corr_30d_vs_btc.csv` | `missing` when the series is absent (alts have no OI; most have no ETF) |

Direction is the **model’s sided prediction** (prediction ≷ last close → BULLISH / BEARISH / NEUTRAL). That is not a sentiment poll and not a ranking. Confidence is derived from forecast band width relative to price; if bands are absent, confidence is missing. There is **no** composite scanner score.

### Filters and sort

- **New bullish / bearish flip:** last recorded flip is to that family and its timestamp is within 7 days of scan time. Older flips stay in history but are not “new”.
- **Confidence / horizon:** filter and sort use the selected horizon’s model confidence (1d / 7d / 30d). Missing confidence sorts last, never as `0`.
- **Asset class:** `crypto` for pack / CoinGecko coins; `stock` only if explicitly classified (none in pack); otherwise `unknown`.
- **REAL holdings / TRACKING:** from Investments `scoreboard.investments` (REAL import events / open lots; TRACKING watch records). Badges are never mixed.

### Tracking (baseline freeze)

Add to Tracking / Remove Tracking calls Investments `addTracking` / `stopTracking` when `scoreboard.investments` exists. Fallback: `scoreboard.scanner.tracking` (`schemaVersion: 1`, namespace `scanner`).

Start **requires** a finite baseline price. Missing price cannot start tracking (no inferred `$0` fill). Start freezes `{ symbol, startDate, baselinePrice, startedAt }`. Evaluation uses **only data at or after that baseline**:

- Actual forward P&amp;L vs frozen baseline (or stop price if stopped)
- Model forecast made **at the baseline bar** (no lookahead) vs actual at 1d / 7d / 30d
- Naive last-price forecast from the same baseline vs the same actuals

Stop sets status `stopped` and **keeps** the row + history. History is never deleted.

### Flip history

A flip is a change of bullish/bearish **family** (BULLISH/LONG/BUY ↔ BEARISH/SHORT/SELL). NEUTRAL ↔ sided is recorded as a state change. Same-family updates are not flips. Each event stores `{ at, source, prior, next }`. The Flip history panel shows the selected symbol’s events. Persist computed flips in `store/scanner_flips` (server) so a later scan can compare against the last known state.

### API

```
GET /api/scanner
GET /api/scanner/evaluate?symbol=&startedAt=&baselinePrice=
GET /api/universe          # still the raw CoinGecko freeze (unchanged)
```

`GET /api/scanner` returns `{ disclaimer, generatedAt, note, rows[] }`. Holdings badges are applied in the browser from the Investments store (the server does not see brokerage CSV).

### Files

```
src/model/scanner.js              # row / flip / filter / evaluation (pure)
src/model/scanner-build.js        # assemble rows from series + signals + forecasts
src/controller/api.js             # GET /api/scanner
public/js/scanner/                # Universe tab view + controller
```

Clicking a scanner row sets `#ticker-input` (and hidden `#symbol-select`) and opens Overview (same `updateOverview` path as Add / Load).

---

## Inline Chat pane (research only)

**Status:** done (pane + live LLM wiring). Bullmania-style **Chat** tab: ask about any investment, get a short research summary plus tappable asset cards. Cards load the Overview chart. Personal hobby use. No keys, no orders, no custody. Not Pooli. No NFA banner in the pane.

House Cursor agents stay grok-4.6. The **in-app** runtime is a server-side tool loop (`POST /api/chat`). **xAI Grok** and non-5.6 OpenAI models use OpenAI-compatible `/v1/chat/completions`. OpenAI **GPT-5.6** family (`gpt-5.6-sol`, alias `gpt-5.6`, `gpt-5.6-terra`, `gpt-5.6-luna`) uses `/v1/responses` so function tools work (chat/completions defaults `reasoning_effort` to medium and rejects tools). Both adapters return the same `{ toolCalls }` / `{ content }` shape for `runChatTurn`. Default live model is **`grok-4.6`**. OpenAI default is `gpt-4o-mini`.

**Never** put a key in the repo, PR body, or client JS. The Node server loads gitignored `.env` via a tiny zero-dep parser (`src/model/dotenv.js`). If no usable key is present, a deterministic **stub provider** still runs the same tools so the UI and tests work.

### Why a tool loop (not regex)

The UI must not scrape free text for tickers. Interactive chips are valid only when `resolve_assets` returned `{ ok: true }` for that query. “load SKR” and “compare MSTR vs BTC” are tool calls, then structured cards.

### System prompt (tight)

Personal hobby dashboard. Never custody / keys / orders. Only emit chart links/cards for assets the tools resolved. Named-ticker questions: resolve → refresh series (Overview path) → chart context → web/news → then cards. Do not say a real listed ticker “couldn’t resolve” until load+search failed. Catalog is hints/tags only. Do not append NFA / legal disclaimer banners.

### Tools

| Tool | Args | Result |
|---|---|---|
| `resolve_assets` | `{ queries: string[] }` | Per query: `{ ok, query, symbol, name, assetClass: crypto\|equity\|etf\|other, venue, scoreboardId, load: { symbol, assetClass, intervalHint: '1d'\|'1h' } }`. Catalog hit or well-formed US ticker / known crypto. Junk: `ok: false`. |
| `refresh_series` | `{ symbol, scoreboardId?, interval? }` | Same `POST /api/refresh?symbol=` path as Overview Load Data. Then cached series can be read. |
| `search_assets` | `{ naturalQuery }` | Ranked catalog hits (e.g. “coins doing buybacks”). Then the model **must** `resolve_assets` on the hits. Static research tags, not a live chain feed. |
| `get_chart_context` | `{ scoreboardId }` | Last cached bar metadata if `ingest_series` / pack series exists. **Never invent OHLCV.** Missing → `{ ok: false }`. |
| `web_search` | `{ query }` | Keyless Yahoo Finance search (quotes + news) + DuckDuckGo HTML + Wikipedia opensearch. Snippets only — not invented prices. |

### Final assistant turn

```
content: [
  { type: 'text', markdown },
  { type: 'asset_card', symbol, name, assetClass, scoreboardId, load, blurb, strategyConsiderations[] }
]
```

The server **strips** any `asset_card` that does not match a successful `resolve_assets` row from this turn. Same `load` payload the charting path needs.

### Tap → chart

`AppController.loadAsset({ symbol, assetClass, intervalHint })` (`public/js/load-asset.js`):

1. Write the symbol onto `#symbol-select` and `#ticker-input` (`setSelectedSymbol` when present)
2. Set `#interval-select` from `intervalHint` (`1d` default; `1h` when the card asked for hourly)
3. Switch to Overview
4. Call existing **Load Data** `reloadSelected()` (`POST /api/refresh` then `GET /api/indicators`)

Do **not** add a second OKX watermark ingest here. Daily freshness is PR #13; arbitrary tickers are PR #14. This seam stays thin so those PRs can fill it.

### Persistence

```
scoreboard.chat
  schemaVersion: 2
  namespace: chat
  collections.messages[]   # user + assistant turns (content blocks)
  collections.settings     # { provider: 'xai'|'openai'|null, model: string|null }
                           # never api keys — stripped on migrate/save
```

Unversioned arrays / `{ messages }` blobs migrate; history is never discarded. v1 payloads keep messages and gain settings. **Clear history** wipes messages and **keeps** the provider/model override. There is no NFA banner in the Chat pane chrome.

In-app Chat settings (provider + model dropdowns) persist in `collections.settings`. `null` means “use server env default”. The client sends only those non-secret fields on `POST /api/chat` and `GET /api/chat/status`.

### API

```
GET  /api/chat/status   # { provider, hasLiveLlm, model, envDefault, availableProviders }
POST /api/chat          # { messages, provider?, model? } → { provider, model, content, toolTrace }
```

Optional non-secret override (never keys): body `provider` / `model`, query `?provider=&model=`, or headers `X-Scoreboard-Chat-Provider` / `X-Scoreboard-Chat-Model`. Request override beats env when that provider has a usable key; otherwise the selected provider stays **stub**.

Client never sees API keys. Server env (`.env`, gitignored):

```
# canonical
SCOREBOARD_XAI_API_KEY=...
SCOREBOARD_OPENAI_API_KEY=...
SCOREBOARD_CHAT_PROVIDER=xai        # xai | openai; default xai when xAI key present
SCOREBOARD_CHAT_MODEL=grok-4.6      # optional; default grok-4.6 (xAI) or gpt-4o-mini (OpenAI)
SCOREBOARD_XAI_BASE_URL=https://api.x.ai/v1
SCOREBOARD_OPENAI_BASE_URL=https://api.openai.com/v1

# accepted aliases (legacy)
XAI_API_KEY / GROK_API_KEY
OPENAI_API_KEY
XAI_BASE_URL / OPENAI_BASE_URL / CHAT_MODEL
```

### Files

```
src/model/chat/           # catalog, tools, stub, live provider, loop, sanitize
public/js/chat/           # schema, store, view, controller
public/js/load-asset.js   # tap → Overview Load Data seam
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
- `scoreboard.chat` — Chat tab history (`schemaVersion` 2 + `collections.messages` + `collections.settings` provider/model only; never keys)

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
GET /api/scanner
GET /api/scanner/evaluate
GET /api/missing
GET /api/chat/status
POST /api/chat
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
- **1h pack file that exists:** BTC only, from `okx_btc_usdt_swap_candles_1h.csv` (~1700 bars, columns `ts_ms`, `datetime_utc`, ohlcv) plus optional joined OI.
- **1h live ingest (default adapters):** BTC and ETH from public OKX `history-candles` (`BTC-USDT-SWAP` / `ETH-USDT-SWAP`) after Load Data.
- **1h via typed ticker:** any ticker OKX lists as `{SYM}-USDT-SWAP` or `{SYM}-USDT` (SOL, …) after Add / Load. Cached in `ingest_series` with a per-symbol watermark.
- **1h that still does not exist:** symbols OKX does not list; equities when Yahoo 1h is empty. Overlay / repo CSVs for alts are `indicators_daily.csv` (daily). There is no ETH 1h pack file — ETH 1h is live ingest only.
- **Required behavior:** BTC 1h charts from the OKX 1h file plus ingest overlay. ETH 1h charts from live ingest after Load Data; if ingest is empty, on-page missing message. Other 1h comes from ingest only. Do not interpolate daily into 1h. Do not plot zeros.
- **Impact:** 1h interval selector has pack rows for BTC; other symbols need a successful OKX refresh.

### Equity candles are public Yahoo (not the Flow pack)
- **Source:** Yahoo Finance public chart API (`query1` / `query2` `/v8/finance/chart/{SYM}`). Stooq daily CSV fallback (often blocked).
- **Behavior:** `stock-public` incremental ingest for any well-formed US ticker (`CDNS`, `AAPL`, …). Missing/failed public fetch stays empty. Prices are never invented.
- **Impact:** Overview Load Data and Chat tap can chart CDNS when Yahoo returns bars. Last daily bar should be near today after a successful refresh.

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
- Chat tool loop (resolve → refresh → chart → web_search → cards; junk → no card; search → resolve)
- Chat tap/load payload + `scoreboard.chat` schema migration (no NFA banner)
- Signal strategies (synthetic crosses, RSI recovery, lookahead)
- Consensus aggregation
- Backtest metrics (drawdown, CAGR, simulateTrades)
- Edge cases (empty data, nulls, single points)
- Scanner rows (missing stays missing), flip history, tracking baseline, filters/sorts

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
# Chat (server-side only — never commit, never send to the browser)
# .env is gitignored and loaded by src/model/dotenv.js (no dotenv npm dep)
SCOREBOARD_XAI_API_KEY=...
SCOREBOARD_CHAT_PROVIDER=xai
SCOREBOARD_CHAT_MODEL=grok-4.6
# optional
SCOREBOARD_OPENAI_API_KEY=...
SCOREBOARD_XAI_BASE_URL=https://api.x.ai/v1
SCOREBOARD_OPENAI_BASE_URL=https://api.openai.com/v1
# aliases still accepted: XAI_API_KEY / GROK_API_KEY / OPENAI_API_KEY
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
│   │   ├── chat/          # Chat tab (history, cards)
│   │   ├── load-asset.js  # tap → Overview Load Data
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
│   │   ├── ticker.js
│   │   ├── stock-adapter.js
│   │   ├── okx-adapter.js
│   │   ├── series.js
│   │   ├── chat/          # Chat tools, stub, live provider
│   │   ├── dotenv.js      # zero-dep .env loader (no secrets logged)
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

**CSV header scan:** E*TRADE Activity files start with a title / account / `Total:` preamble. The parser scans for a row containing `Activity/Trade Date` (or both `Activity Type` and `Symbol`) and reads data from there. Header names are matched case-insensitively after stripping trailing `#` / `$` / spaces (`Quantity #` → Quantity, `Price $` → Price, `Amount $` → Amount).

**CSV footer skip:** After the first accepted activity row, parsing stops at a blank gap, at two consecutive non-dated non-activity rows, or at disclaimer prose (`Morgan Stanley`, `Brokerage services are offered`, `Member SIPC`). Trailing legal paragraphs are dropped — they are not unsupported trades.

**Activity types (E*TRADE):** Bought / Sold → buy/sell fills when qty+price exist. Bought To Open / Sold To Close (and other to-open/to-close) → `option` events, **not** share lots on the underlying symbol. Dividend / Qualified Dividend → dividend (non-fill; missing qty/price stays missing). Option Expired → expired (non-fill; empty price stays missing, never a 0 fill). Exchange Delivered Out / Exchange Received In → exchange (non-fill; explicit map + user cost required). Symbol `--` stays missing — no inference. Unsupported types are flagged per row and do not abort the import.

**Fills:** a buy/sell becomes a lot fill only when **both** quantity and price are present. Missing quantity or price is marked; no fill is inferred. Dividends, fees, exchanges, and options/expired do not invent fills or contracts. Exchanges / ticker changes / options require an explicit symbol map. An option-contract map still does not open FIFO share lots.

**P&L:** FIFO (default) or average-cost. Realized, unrealized, cost basis, return, dividends, drawdown. Missing mark prices stay `missing`, not `0`.

**Charts:** transaction markers on the Overview asset chart (exact date, qty, price, fees, source, badge). Click/tap opens a detail strip.

**Export:** client-side JSON/CSV download via Blob. No server round-trip.

---

## Changelog

### Inline Chat pane (research only)
- Chat tab: schema-versioned `scoreboard.chat` history (`schemaVersion` 2), Clear; no NFA banner
- Server tool loop: `resolve_assets` / `refresh_series` / `get_chart_context` / `web_search` / `search_assets` then structured `content[]`
- Cards only from successful resolve; tap → `loadAsset` → Overview Load Data (`reloadSelected`)
- Live xAI / non-5.6 OpenAI via `/chat/completions`; OpenAI GPT-5.6 family via `/v1/responses`; deterministic stub when no usable key
- Default live model **`grok-4.6`** (xAI public id). OpenAI default `gpt-4o-mini`. In-app OpenAI picker also lists `gpt-5.6-sol`, public alias `gpt-5.6` (→ Sol), `gpt-5.6-terra`, and `gpt-5.6-luna`. Provider/model persist in `collections.settings` (no keys)
- Zero-dep `.env` loader; canonical `SCOREBOARD_*` vars (legacy `XAI_API_KEY` / `GROK_API_KEY` / `OPENAI_API_KEY` aliases)
- `/api/chat/status` returns `{ provider, hasLiveLlm, model }` never the key
- Status: **done** — pane + production LLM wiring; no keys in repo

### Ticker text field (any crypto / stock)
- Overview combo box replaced by ticker text input + Add / Load + optional recent chips
- Crypto: OKX public swap then spot candles, hourly + daily, watermark per (source, symbol, interval)
- Stocks: Yahoo Finance public chart API (`stock-public`, incremental watermark); Stooq daily fallback; no invented prices
- Series filter keeps unlabeled pack candles as BTC; ingest cannot cross-plot onto another symbol
- Chat tap-to-load syncs `#ticker-input` via `setSelectedSymbol` / `load-asset.js`
- Status: **doing**

### Forecasts tab (scored history, second product slice)
- Forecasts tab lists walk-forward scored records: symbol, horizon, as-of, predicted range/point, confidence, model/version, actual, MAE vs naive, status
- Status `too-early` | `matured` | `missing-actual`. MAE is `null` unless matured — never a fake 0
- Click jumps Overview to the as-of timestamp and shows rationale/features
- REAL / TRACKING filter reads `scoreboard.investments`; empty store → filter inactive, all rows shown
- Weekly / monthly horizon filters; JSON/CSV export of the filtered list
- Schema-versioned server `store/forecasts.json` + client `scoreboard.forecasts` with migrations
- Reuses `src/model/forecast.js`. Fixture seed when Flow pack is absent (labeled, not live)

### Universe money-scanner (research board)
- Universe tab is a scanner table (price, freshness, 1d/7d/30d model direction + confidence, flips, consensus, backtest status, ETF/OI/corr)
- Research-only banner; missing cells say missing; no fabricated ranking/sentiment
- Filters/sorts: new flip, confidence, horizon, asset class, REAL, TRACKING
- Tracking uses Investments `scoreboard.investments` (fallback local scanner namespace); baseline freeze + evaluation vs naive
- Flip history recorded on consensus/direction change
- Status: **doing**

### Investments tab (first slice, local-only)
- Investments tab: empty state, privacy warning, local file import, preview + Commit
- Schema-versioned `scoreboard.investments` store; REAL vs TRACKING never mix
- FIFO + average-cost lots; paper BUY/SELL; start/stop tracking preserves history
- Transaction markers on asset charts; local CSV/JSON export
- Activity CSV: scan for the real header after E*TRADE preamble; normalize `Quantity #` / `Price $` / `Amount $` (**done**, 2026-09-05; synthetic fixture only)
- Activity CSV: skip trailing Morgan Stanley / brokerage disclaimer; Bought To Open and Option Expired stay option events (not underlying share lots); Exchange `--` stays needs-mapping; empty option price stays missing (**done**, 2026-09-08; synthetic fixture only)
- Tests: synthetic CSV only (including preamble + `#`/`$` headers + footer). Real brokerage files are not in-repo and were not imported
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
- ETH 1h: live OKX ingest after Load Data; on-page missing message if ingest is empty (no pack; not interpolated; not zeros)
- Gaps stay gaps; last price marker + line
- Overlay tooltip; horizontal + trend drawings
- Status: **done** — verified on localhost (BTC 1h last few days, ETH 1d pack, ETH 1h missing until live ingest)

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
- OKX ETH-USDT-SWAP candles (`1h`, `1d`) are live incremental with their own watermarks (public, no key). ETH OI is not registered.
- Daily `getSeries` merges live `okx-candles` over older pack `indicators_daily.csv` by calendar date. Pack-only `close: null` probe stubs (e.g. through 2026-09-26) are dropped so the last bar is the live OKX day, not a null pack tail.
- ETF (Farside) and CoinGecko top100 use the same interface as a bounded-overlap fallback — cursor is not faked
- Load Data refreshes sources first, then reads the store
- Export: `since` / `sinceCursor`
- Status: OKX incremental **done** (BTC candles/OI + ETH candles). ETF/CG fallback **doing** (not incremental)

### Initial Release
- ✅ Vanilla JS MVC architecture
- ✅ Technical indicators (MA20/50/100/200)
- ✅ Naive baseline forecasting
- ✅ Local JSON storage
- ✅ CSV export
- ✅ Interactive charts with hover

---

**Last Updated:** 2026-09-11  
**Version:** v1.10 (dynamic US equity resolve + Yahoo stock adapter + Chat web_search)  
**Status:** Not Pooli. No keys client-side. No trades. Research chat (no NFA chrome). Import stays in-browser.
