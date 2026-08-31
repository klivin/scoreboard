# Scoreboard

Crypto market analysis and forecasting dashboard built with vanilla HTML/CSS/JS.

## Features

- **Data Ingestion**: Consumes Flow's v1 pack (OKX, Farside ETF, universe, indicators)
- **Technical Indicators**: MA20/50/100/200, EMA20, Ichimoku Cloud
- **Forecasts**: 1d/7d/30d predictions with steelman analysis and MAE vs naive comparison
- **Charts**: Canvas-based price charts with toggleable indicator overlays
- **REST API**: Query series, indicators, universe, and forecasts
- **CSV Export**: Download series data in CSV format

## Quick Start

```bash
npm install
npm test      # Run tests (24 passing)
npm start     # Start server on port 3000
```

Visit `http://localhost:3000` to view the dashboard.

## Architecture

**Vanilla HTML/CSS/JS MVC** - No React, no frameworks, no god-scripts.

- **Model**: `src/models/` - Series, Forecast, Universe, ErrorLog
- **View**: `public/js/view.js` - Chart rendering and UI updates
- **Controller**: `public/js/controller.js` - Event handling and orchestration

## Data Files

Place Flow's v1 pack files in `data/` or `/workspace/scoreboard/`:

- `okx_btc_oi_1h.json` / `okx_btc_oi_1d.json`
- `okx_btc_candles_1h.json` / `okx_btc_candles_1d.json`
- `farside_btc_etf.json` / `farside_eth_etf.json`
- `top100_freeze.json`
- `indicators.json`
- `alt_btc_ratios.json`
- `backtest_sketch.json`
- `gaps.md`

Missing files trigger warnings and use fixture data. See `data/README.md` for details.

## API Endpoints

- `GET /api/series?symbol=BTC&interval=1d&from=&to=&fields=&format=json|csv`
- `GET /api/indicators?symbol=BTC&interval=1d`
- `GET /api/universe`
- `GET /api/forecasts`
- `GET /api/error-log`
- `GET /api/status`

## Testing

All indicator calculations and forecast MAE comparisons are tested:

```bash
npm test
```

## What's NOT in v1

- No Firestore (isolated for later)
- No CoinGecko API calls (429 prevention)
- No trade execution
- No real-time streaming

## Project Structure

```
scoreboard/
├── data/              # Flow's v1 pack files
├── public/            # Frontend assets
│   ├── css/           # Styles
│   ├── js/            # MVC JavaScript
│   └── index.html     # Main page
├── src/
│   ├── models/        # Data models
│   └── utils/         # Indicators, ingest, store
├── test/              # Test suite
├── store/             # Local JSON collections
└── server.js          # Express server
```
