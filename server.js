const express = require('express');
const path = require('path');
const { ingestAll } = require('./src/utils/ingest');
const { calculateAllIndicators } = require('./src/utils/indicators');
const LocalStore = require('./src/utils/store');
const Series = require('./src/models/Series');

const app = express();
const PORT = process.env.PORT || 3000;
const store = new LocalStore();

let cachedData = null;

function initializeData() {
  console.log('Ingesting data...');
  const data = ingestAll();
  
  Object.entries(data.series).forEach(([key, series]) => {
    store.saveSeries(series);
    const indicators = calculateAllIndicators(series);
    store.saveIndicators(series.symbol, series.metadata.interval, indicators);
  });
  
  store.saveUniverse(data.universe);
  store.saveErrorLog(data.errorLog);
  
  cachedData = data;
  console.log(`Data ingested: ${Object.keys(data.series).length} series loaded`);
  
  return data;
}

app.use(express.static('public'));
app.use(express.json());

app.get('/api/series', (req, res) => {
  const { symbol, from, to, fields, interval = '1d', format = 'json' } = req.query;
  
  if (!symbol) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }
  
  const seriesData = store.loadSeries(symbol, interval);
  
  if (!seriesData) {
    return res.status(404).json({ error: `Series not found: ${symbol} (${interval})` });
  }
  
  const series = new Series(seriesData.symbol, seriesData.data, seriesData.metadata);
  
  let data = series.data;
  
  if (from || to) {
    data = series.getRange(from, to);
  }
  
  if (fields) {
    const fieldList = fields.split(',').map(f => f.trim());
    data = series.getFields(fieldList);
  }
  
  if (format === 'csv') {
    if (data.length === 0) {
      return res.status(200).send('');
    }
    
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(','),
      ...data.map(row => headers.map(h => row[h] ?? '').join(','))
    ].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${symbol}_${interval}.csv"`);
    return res.send(csv);
  }
  
  res.json({
    symbol: series.symbol,
    interval,
    metadata: series.metadata,
    count: data.length,
    data
  });
});

app.get('/api/indicators', (req, res) => {
  const { symbol, interval = '1d' } = req.query;
  
  if (!symbol) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }
  
  const indicators = store.loadIndicators(symbol, interval);
  
  if (!indicators) {
    return res.status(404).json({ error: `Indicators not found: ${symbol} (${interval})` });
  }
  
  res.json(indicators);
});

app.get('/api/universe', (req, res) => {
  const universe = store.loadUniverse();
  
  if (!universe) {
    return res.status(404).json({ error: 'Universe not found' });
  }
  
  res.json(universe);
});

app.get('/api/forecasts', (req, res) => {
  const forecasts = store.list('forecasts').map(id => store.load('forecasts', id));
  res.json({ count: forecasts.length, forecasts });
});

app.get('/api/error-log', (req, res) => {
  const logs = store.list('error_logs').map(id => store.load('error_logs', id));
  res.json({ count: logs.length, logs });
});

app.get('/api/status', (req, res) => {
  const seriesCount = store.list('series').length;
  const forecastCount = store.list('forecasts').length;
  const hasUniverse = store.loadUniverse() !== null;
  
  res.json({
    status: 'ok',
    seriesCount,
    forecastCount,
    hasUniverse,
    timestamp: new Date().toISOString()
  });
});

initializeData();

const server = app.listen(PORT, () => {
  console.log(`Scoreboard v1 running on http://localhost:${PORT}`);
});

module.exports = { app, server };
