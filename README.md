# Scoreboard

Crypto market analysis and forecasting dashboard built with vanilla JavaScript MVC architecture.

## Documentation

- **[📖 Wiki](docs/WIKI.md)** - Complete product documentation, architecture, data sources, and troubleshooting
- **[📋 Feature Requests](docs/FEATURE_REQUESTS.md)** - Status tracker for all features (open/doing/done)

## Features

- **Real-time Price Charts**: Interactive candlestick charts with technical indicators
- **Technical Indicators**: 
  - Moving Averages (MA20 EMA, MA50/100/200 SMA)
  - Ichimoku Cloud (Tenkan, Kijun, Senkou A/B, Chikou)
  - Volume overlays
- **Forecasting Engine**: 
  - Naive baseline predictions
  - Trend-based forecasting with confidence bands
  - Multi-horizon forecasts (1d, 7d, 30d)
  - Steelman analysis (bull/bear cases)
- **Data Management**: 
  - Local JSON store (Firestore-compatible schema)
  - CSV/JSON data ingestion
  - RESTful API with CSV export

## Architecture

### Stack
- **Frontend**: Vanilla HTML/CSS/JavaScript (MVC pattern)
- **Chart**: TradingView Lightweight Charts (pan/zoom, gaps, drawings)
- **Backend**: Node.js + Express
- **Storage**: Local JSON files (Firestore-ready schema)
- **Testing**: Node.js native test runner

### Project Structure

```
scoreboard/
├── data/              # Data files directory
│   └── README.md      # Expected data files documentation
├── public/            # Frontend assets
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── app.js       # Main application entry
│   │   ├── controller.js # MVC Controller
│   │   └── view.js      # MVC Views
│   └── index.html
├── src/               # Backend source
│   ├── controller/
│   │   └── api.js       # API route handlers
│   ├── model/
│   │   ├── forecast.js      # Forecasting logic
│   │   ├── forecast.test.js
│   │   ├── indicators.js    # Technical indicators
│   │   ├── indicators.test.js
│   │   ├── ingest.js        # Data ingestion
│   │   ├── series.js        # Series model
│   │   └── store.js         # Local JSON store
│   └── server.js      # Express server
├── store/             # Local JSON storage
└── package.json
```

## Data Requirements

Place Flow's v1 pack data files in the `data/` directory. See `data/README.md` for the complete list of expected files.

### Local Development with Shared Data

For local development on the shared computer, the application supports an overlay path at `/workspace/scoreboard/`. When this directory exists, the ingest module will prioritize files from this location over the repo-local `data/` directory.

**Priority order:**
1. `/workspace/scoreboard/<filename>` (overlay path)
2. `./data/<filename>` (repo-local)
3. Fixture data (if file is missing)

## Installation

```bash
npm install
```

## Usage

### Run Tests

```bash
npm test
```

### Start Server

```bash
npm start
```

The application will be available at `http://localhost:3000`

### Development Mode (with auto-reload)

```bash
npm run dev
```

## API Endpoints

### GET /api/series
Get time series data for a symbol.

**Query Parameters:**
- `symbol` - Symbol name (default: BTC)
- `from` - Start date (ISO 8601)
- `to` - End date (ISO 8601)
- `fields` - Comma-separated field list
- `format` - Response format: `json` or `csv` (default: json)

**Example:**
```bash
curl "http://localhost:3000/api/series?symbol=BTC&format=csv"
```

### GET /api/indicators
Get series data with calculated indicators.

**Query Parameters:**
- `symbol` - Symbol name (default: BTC)

### GET /api/forecast
Generate forecast for a symbol.

**Query Parameters:**
- `symbol` - Symbol name (default: BTC)
- `horizon` - Forecast horizon in days (default: 7)

### GET /api/missing
Check for missing data files.

### GET /api/universe
Get universe data (CoinGecko top 100).

### GET /api/forecasts
Get recent forecasts.

## Testing

The test suite covers:
- ✅ Indicator calculations (SMA, EMA, Ichimoku)
- ✅ Forecast methods (naive baseline, trend)
- ✅ Error metrics (MAE, MAPE)
- ✅ Naive baseline comparison

Run tests with:
```bash
npm test
```

## Forecasting Methodology

### Naive Baseline
The naive baseline assumes the price will remain constant at the current level. This serves as the benchmark for all other forecasting methods.

### Trend Forecasting
The trend model:
1. Calculates 7-day momentum
2. Projects trend forward based on horizon
3. Adds volatility-based confidence bands
4. Compares against naive baseline

**If naive MAE wins, we say so.** The application always displays both the trend prediction and the naive baseline, allowing users to evaluate which method performs better.

## Notes

- **CoinGecko Data**: The universe endpoint may show limited data due to CoinGecko API rate limiting (429 errors). This is expected and noted in the UI.
- **Fixture Data**: When data files are missing, the application uses synthetic fixture data and displays a warning.
- **Naive Baseline**: Always displayed on forecast cards for comparison. The naive prediction serves as the performance benchmark.

## Future Enhancements

- Firestore integration (schema-compatible)
- Additional forecasting models
- Backtesting framework
- Real-time WebSocket updates
- Multi-asset correlation analysis

## License

MIT
