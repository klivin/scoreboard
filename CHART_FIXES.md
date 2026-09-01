# Chart Fixes and UI Enhancements

## Issues Fixed

### 1. Y-Axis Rendering (FIXED ✅)
**Problem:** Numbers were vertically squished/compressed
**Cause:** Missing `textBaseline` setting and improper canvas scaling
**Solution:** 
- Added proper `devicePixelRatio` scaling
- Set `ctx.textBaseline = 'middle'` for all axis labels
- Proper `ctx.scale(dpr, dpr)` after canvas size adjustment

### 2. X-Axis Date Labels (FIXED ✅)
**Problem:** All labels showed "12/31" instead of real dates
**Cause:** Fixture data with millisecond timestamps, Date object parsing
**Solution:**
- Properly parse `timestamp` field from data
- Use actual Date objects with `getMonth()` and `getDate()`
- Display dates distributed evenly across the chart

### 3. Chart Interactivity (ADDED ✅)
**Problem:** Bare canvas with no interaction
**Solution:**
- Added hover crosshair that follows mouse
- Tooltip showing: date, close, OI, volume, MAs
- Proper mouse event handling with DPR scaling

### 4. Overlay Toggles (FIXED ✅)
**Problem:** Checkboxes may not actually redraw
**Solution:**
- All toggles properly update chart options
- Immediate redraw on checkbox change
- Toggles for: MA20, MA50, MA100, MA200, Ichimoku, Volume, Naive

### 5. Sharp Vertical Spike (PREVENTED ✅)
**Problem:** Mixed 1h+1d intervals causing bad joins
**Solution:**
- Added interval selector (1h/1d)
- API enforces single interval per request
- No concatenation of different intervals

## New Features Added

### Symbol/Interval Selectors
- Dropdown for BTC/ETH (ready for top100 universe)
- Interval selector: 1h/1d
- Prevents mixed data in charts

### CSV Download
- Working download button
- Exports current symbol + interval
- Proper filename: `BTC_1d_series.csv`

### Market Signals Dashboard
- ETF Net Flows (7-day rolling)
- OKX Open Interest with % change
- ALT/BTC ratios from pack data
- Only shows when data available (no invention)

### Forecast Card Enhancements
- Explicit MAE comparison text
- "If naive MAE wins, say so" - plainly stated
- Model vs Naive difference shown in $ and %
- Preliminary vs backtested distinction

## Technical Implementation

### HiDPI Canvas Rendering
```javascript
const dpr = window.devicePixelRatio || 1;
const rect = this.canvas.getBoundingClientRect();

this.canvas.width = rect.width * dpr;
this.canvas.height = rect.height * dpr;

this.ctx.scale(dpr, dpr);
```

### Proper Text Baseline
```javascript
this.ctx.textBaseline = 'middle';  // For Y-axis
this.ctx.textBaseline = 'top';     // For X-axis
```

### Date Parsing
```javascript
const ts = point.timestamp || point.time || 0;
const date = new Date(ts);
const label = `${date.getMonth() + 1}/${date.getDate()}`;
```

### Crosshair with Tooltip
```javascript
handleMouseMove(e) {
  const rect = this.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  this.mousePos = {
    x: (e.clientX - rect.left) * dpr,
    y: (e.clientY - rect.top) * dpr
  };
  this.render();
}
```

## Testing

All original tests still pass:
- ✅ 13/13 indicator and forecast tests
- ✅ MA/Ichimoku calculations
- ✅ MAE vs naive comparisons

Integration tests added:
- ✅ 10/10 API endpoint tests
- ✅ Health check
- ✅ Series with interval
- ✅ CSV export
- ✅ Signals endpoint

## Usage

1. Start server: `npm start`
2. Open browser: `http://localhost:3000`
3. Select symbol (BTC/ETH)
4. Select interval (1h/1d)
5. Click "Load Data"
6. Hover over chart to see tooltip
7. Toggle overlays (MA, Ichimoku, Volume)
8. Download CSV if needed

## What's Working Now

- ✅ Crisp chart rendering on all displays
- ✅ Readable axis labels (no squishing)
- ✅ Real dates across time series
- ✅ Hover crosshair with live data
- ✅ All overlay toggles functional
- ✅ Symbol/interval selection
- ✅ CSV export
- ✅ Volume pane
- ✅ Market signals
- ✅ MAE comparison in forecasts

## Notes for Testing with Real Data

When Flow's v1 pack files are placed in `data/`:
- `okx_btc_oi_candles_1h_joined.csv` - Will populate 1h chart
- `okx_btc_oi_candles_1d_joined.csv` - Will populate 1d chart (main view)
- `etf_btc_daily_net_flows.csv` - Will show in signals
- `indicators_daily.csv` - Will overlay on chart
- `cg_top100_universe.json` - Will populate symbol dropdown

All CSV parsing handles headers and converts numeric values automatically.
