import { seriesModel } from '../model/series.js';
import { generateForecast, createForecastCard, calculateMAE } from '../model/forecast.js';
import { forecastStore } from '../model/store.js';

export function handleGetSeries(req, res) {
  const { symbol = 'BTC', from, to, fields } = req.query;
  
  try {
    const series = seriesModel.getSeries(symbol, from, to, fields);
    
    const format = req.query.format || 'json';
    
    if (format === 'csv') {
      if (series.length === 0) {
        res.status(404).send('No data found');
        return;
      }
      
      const headers = Object.keys(series[0]);
      const csv = [
        headers.join(','),
        ...series.map(row => headers.map(h => row[h]).join(','))
      ].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${symbol}_series.csv"`);
      res.send(csv);
    } else {
      res.json({
        symbol,
        count: series.length,
        data: series
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export function handleGetIndicators(req, res) {
  const { symbol = 'BTC' } = req.query;
  
  try {
    const indicators = seriesModel.getIndicators(symbol);
    
    res.json({
      symbol,
      count: indicators.length,
      data: indicators.slice(-90)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export function handleGetForecast(req, res) {
  const { symbol = 'BTC', horizon = '7' } = req.query;
  const horizonDays = parseInt(horizon, 10);
  
  try {
    const data = seriesModel.getIndicators(symbol);
    
    if (data.length === 0) {
      res.status(404).json({ error: 'No data available for symbol' });
      return;
    }
    
    const forecast = generateForecast(data, horizonDays);
    const card = createForecastCard(symbol, data, horizonDays);
    
    forecastStore.add({
      symbol,
      horizonDays,
      forecast: card,
      timestamp: Date.now()
    });
    
    res.json({
      symbol,
      horizonDays,
      forecast,
      card
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export function handleGetMissing(req, res) {
  try {
    const missing = seriesModel.getMissingFiles();
    const universe = seriesModel.getUniverse();
    
    res.json({
      missing,
      universeNote: universe.note || null,
      usingFixtures: missing.length > 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export function handleGetUniverse(req, res) {
  try {
    const universe = seriesModel.getUniverse();
    res.json(universe);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export function handleGetForecasts(req, res) {
  try {
    const forecasts = forecastStore.getAll();
    res.json({
      count: forecasts.length,
      forecasts: forecasts.slice(-20)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
