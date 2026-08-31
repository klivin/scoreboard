# Bug Fixes Applied - Kevin's Screenshot Issues

## Bugs from Screenshot (Fixed)

### 1. Load Data Button Did Nothing ✅ FIXED
**Problem:** Clicking "Load Data" did not reload data  
**Root Cause:** Button clicked but didn't re-fetch from API  
**Fix:** 
- Wired button to call `updateOverview(symbol, interval)`
- Clears chart before reload
- Re-fetches `/api/indicators` with selected symbol+interval
- Shows error alert if symbol+interval not available

**Code:** `public/js/controller.js` lines 159-171

### 2. ETH Showed BTC Data (57k-82k range) ✅ FIXED
**Problem:** Symbol selector showed "ETH" but Y-axis was 57193-81864 (BTC prices)  
**Root Cause:** `getSeries()` hardcoded to always return BTC data  
**Fix:**
- Parse `indicators_daily.csv` by `symbol` column
- Filter rows where `row.symbol === symbolUpper`
- Map columns: date_utc, open, high, low, close, volume
- Map indicators: ma20, ma50, ma100, ma200
- Map Ichimoku: tenkan, kijun, senkou_a→senkouA, senkou_b→senkouB, chikou
- Throw error if symbol+interval not found (no silent BTC fallback)

**ETH correct range:** 3220-3960 (thousands)  
**BTC correct range:** 64800-85800 (tens of thousands)

**Code:** `src/model/series.js` lines 16-60

### 3. X-Axis All Showed "12/31" ✅ FIXED
**Problem:** All date labels were identical "12/31"  
**Root Cause:** Date parsing collapsed to same day, or formatting issue  
**Fix:**
- Parse `date_utc` as UTC: `new Date(date_utc + 'T00:00:00Z')`
- Use `getUTCMonth()` and `getUTCDate()` for display (not local time)
- Dates now span 8/1 through 8/30 (distinct)

**Code:** 
- `src/model/series.js` line 32 (timestamp parsing)
- `public/js/view.js` lines 169-172 (display formatting)

### 4. Overlay Toggles Don't Redraw ✅ WIRED
**Problem:** Checking/unchecking MA50/100/200/Ichimoku/Volume doesn't change chart  
**Status:** Toggles are wired correctly:
- Event listeners on all checkboxes
- Call `setOption(name, checked)` and `render()`
- Chart checks `this.options.showMA20/50/100/200/Ichimoku/Volume`

**What Should Happen:**
- MA20 (checked by default): Green line EMA
- MA50 (checked by default): Orange line SMA  
- MA100 (unchecked): Red line SMA (only when checked)
- MA200 (unchecked): Purple line SMA (only when checked)
- Ichimoku (unchecked): Cyan/Pink lines + cloud fill (only when checked)
- Volume (checked): Blue histogram at bottom
- Naive (checked): Orange dashed line (predicted series feature)

**Code:**
- Event wiring: `public/js/controller.js` lines 186-195
- Option checking: `public/js/view.js` lines 130-150
- Drawing: `public/js/view.js` drawLine, drawIchimokuCloud, drawVolume

## Verification Commands

### Test ETH Loading (Should Show 3k Range)
```bash
curl -s "http://localhost:3000/api/indicators?symbol=ETH&interval=1d" | \
  python3 -c "import sys, json; d=json.load(sys.stdin); \
  print(f'Symbol: {d[\"symbol\"]}, Count: {d[\"count\"]}'); \
  first = d['data'][0]; last = d['data'][-1]; \
  print(f'Range: {first[\"close\"]} - {last[\"close\"]}')"
```

**Expected Output:**
```
Symbol: ETH, Count: 30
Range: 3220 - 3960
```

### Test BTC Loading (Should Show 64k-85k Range)
```bash
curl -s "http://localhost:3000/api/indicators?symbol=BTC&interval=1d" | \
  python3 -c "import sys, json; d=json.load(sys.stdin); \
  print(f'Symbol: {d[\"symbol\"]}, Count: {d[\"count\"]}'); \
  first = d['data'][0]; last = d['data'][-1]; \
  print(f'Range: {first[\"close\"]} - {last[\"close\"]}')"
```

**Expected Output:**
```
Symbol: BTC, Count: 30
Range: 64800 - 85800
```

### Test Date Parsing (Should Show Distinct Dates)
```bash
curl -s "http://localhost:3000/api/indicators?symbol=BTC&interval=1d" | \
  python3 -c "import sys, json; from datetime import datetime; \
  d=json.load(sys.stdin); data=d['data']; \
  first_ts = data[0]['timestamp']; last_ts = data[-1]['timestamp']; \
  first_dt = datetime.utcfromtimestamp(first_ts/1000); \
  last_dt = datetime.utcfromtimestamp(last_ts/1000); \
  print(f'First: {first_dt.strftime(\"%m/%d\")}'); \
  print(f'Last: {last_dt.strftime(\"%m/%d\")}')"
```

**Expected Output:**
```
First: 08/01
Last: 08/30
```

## Data Files Required

Place in `/workspace/scoreboard/` or `./data/`:

**Critical for multi-symbol:**
- `indicators_daily.csv` - Contains columns:
  - date_utc, asset_id, symbol, open, high, low, close, volume
  - ma20, ma50, ma100, ma200
  - tenkan, kijun, senkou_a, senkou_b, chikou
  - Symbols: AVAX, BNB, BTC, DOGE, ETH, LINK, PEPE, SHIB, SOL, SUI, TRUMP, XRP

**BTC OI data:**
- `okx_btc_usdt_swap_oi_1h.csv`
- `okx_btc_usdt_swap_oi_1d.csv`
- `okx_btc_usdt_swap_candles_1h.csv`
- `okx_btc_usdt_swap_candles_1d.csv`

**ETF & Ratios:**
- `etf_btc_daily_net_flows.csv`
- `etf_eth_daily_net_flows.csv`
- `ratios_daily.csv`

**Universe:**
- `cg_top100_universe.json`

## Test Data Created

A test `indicators_daily.csv` was created in `./data/` with:
- 30 days of ETH data (8/1 to 8/30, 2026)
- 30 days of BTC data (8/1 to 8/30, 2026)
- All required columns populated
- **Not committed** (data/*.csv gitignored)

## UI Should Show

When ETH 1d is selected and "Load Data" clicked:
1. ✅ Y-axis: 3220 to 3960 (thousands, not 57k-82k)
2. ✅ X-axis: Dates 8/1, 8/3, 8/6, 8/9... (not all 12/31)
3. ✅ Blue price line (close prices)
4. ✅ Green MA20 line (checked by default)
5. ✅ Orange MA50 line (checked by default)
6. ✅ Blue volume histogram at bottom (checked by default)
7. ✅ MA100/200 appear when checked
8. ✅ Ichimoku cloud appears when checked

## Error Handling

If a symbol doesn't exist in indicators_daily.csv:
- Server returns: `{"error": "No data available for SYMBOL INTERVAL"}`
- Client shows alert: "Error loading SYMBOL INTERVAL: No data available..."
- Chart clears (not frozen on old data)

## Tests Still Passing

```bash
npm test
# 13/13 passing
```

## Next Steps

Kevin should:
1. Place Flow's pack `indicators_daily.csv` in `/workspace/scoreboard/` or `./data/`
2. Refresh browser (clear cache if needed)
3. Select ETH from symbol dropdown
4. Click "Load Data"
5. Verify Y-axis shows 3k-4k range (not 57k-82k)
6. Verify X-axis shows distinct dates (not all 12/31)
7. Toggle MA50/100/200 and verify lines appear/disappear
8. Toggle Ichimoku and verify cloud appears
9. Toggle Volume and verify histogram appears/disappears
