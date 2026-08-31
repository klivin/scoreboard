#!/bin/bash

echo "=== Scoreboard v1 Integration Test ==="
echo ""

echo "1. Testing health endpoint..."
curl -s http://localhost:3000/health | grep -q "ok" && echo "✓ Health check passed" || echo "✗ Health check failed"

echo ""
echo "2. Testing missing files detection..."
curl -s http://localhost:3000/api/missing | grep -q "missing" && echo "✓ Missing files endpoint working" || echo "✗ Missing files endpoint failed"

echo ""
echo "3. Testing series endpoint (JSON)..."
curl -s http://localhost:3000/api/series?symbol=BTC | grep -q "count" && echo "✓ Series JSON endpoint working" || echo "✗ Series JSON failed"

echo ""
echo "4. Testing series endpoint (CSV)..."
curl -s "http://localhost:3000/api/series?symbol=BTC&format=csv" | head -1 | grep -q "timestamp" && echo "✓ Series CSV export working" || echo "✗ Series CSV failed"

echo ""
echo "5. Testing indicators endpoint..."
curl -s http://localhost:3000/api/indicators?symbol=BTC | grep -q "ma20" && echo "✓ Indicators endpoint working" || echo "✗ Indicators failed"

echo ""
echo "6. Testing forecast generation..."
curl -s "http://localhost:3000/api/forecast?symbol=BTC&horizon=7" | grep -q "prediction" && echo "✓ Forecast generation working" || echo "✗ Forecast failed"

echo ""
echo "7. Testing forecast cards..."
curl -s "http://localhost:3000/api/forecast?symbol=BTC&horizon=7" | grep -q "proCase" && echo "✓ Forecast cards working" || echo "✗ Forecast cards failed"

echo ""
echo "8. Testing universe endpoint..."
curl -s http://localhost:3000/api/universe | grep -q "updated" && echo "✓ Universe endpoint working" || echo "✗ Universe failed"

echo ""
echo "9. Testing forecasts history..."
curl -s http://localhost:3000/api/forecasts | grep -q "forecasts" && echo "✓ Forecasts history working" || echo "✗ Forecasts history failed"

echo ""
echo "10. Testing naive baseline presence..."
curl -s "http://localhost:3000/api/forecast?symbol=BTC&horizon=1" | grep -q "naive" && echo "✓ Naive baseline present" || echo "✗ Naive baseline missing"

echo ""
echo "=== Integration Test Complete ==="
