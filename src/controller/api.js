import { seriesModel } from '../model/series.js';
import { generateForecast, createForecastCard, generatePredictedSeries } from '../model/forecast.js';
import { daysToHorizon, horizonToDays } from '../model/forecast-schema.js';
import { createAndStoreForecast, ensureForecastHistory, forecastsToCsv } from '../model/forecast-history.js';
import { getRefreshRuntime } from '../model/refresh.js';
import {
  evaluateWalkForward,
  evaluateAll,
  ALL_STRATEGIES,
  DEFAULT_ENABLED,
  HORIZONS
} from '../model/signals/index.js';
import { runFullBacktest, loadBacktestSeries, formatBacktestReport } from '../model/backtest.js';

export function handleGetSeries(req, res) {
  const { symbol = 'BTC', interval = '1d', from, to, fields, since, sinceCursor } = req.query;
  
  try {
    seriesModel.load();
    const sinceExclusive = seriesModel.resolveExportSince({ since, sinceCursor });
    const series = seriesModel.getSeries(symbol, interval, from, to, fields, { sinceExclusive });
    
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
      res.setHeader('Content-Disposition', `attachment; filename="${symbol}_${interval}_series.csv"`);
      res.send(csv);
    } else {
      res.json({
        symbol,
        interval,
        count: series.length,
        since: sinceExclusive,
        sinceCursor: sinceCursor || null,
        data: series
      });
    }
  } catch (error) {
    res.status(error.message && error.message.startsWith('No ') ? 404 : 500)
      .json({ error: error.message, missing: true });
  }
}

export function handleGetIndicators(req, res) {
  const { symbol = 'BTC', interval = '1d' } = req.query;
  
  try {
    seriesModel.load();
    const indicators = seriesModel.getIndicators(symbol, interval);
    
    res.json({
      symbol,
      interval,
      count: indicators.length,
      data: indicators
    });
  } catch (error) {
    res.status(error.message && error.message.startsWith('No ') ? 404 : 500)
      .json({ error: error.message, missing: true });
  }
}

export function handleGetSymbols(req, res) {
  try {
    const symbols = seriesModel.getAvailableSymbols();
    res.json({ symbols });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export function handleGetSignals(req, res) {
  const { symbol = 'BTC' } = req.query;
  
  try {
    const signals = seriesModel.getSignals(symbol);
    
    res.json(signals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export function handleGetForecast(req, res) {
  const { symbol = 'BTC', horizon = 'weekly' } = req.query;
  const horizonDays = horizonToDays(horizon);
  const horizonKey = daysToHorizon(horizonDays);

  try {
    const record = createAndStoreForecast({ symbol, horizon: horizonKey });
    let forecast = null;
    let card = null;
    try {
      const data = seriesModel.getIndicators(symbol);
      if (data.length) {
        forecast = generateForecast(data, horizonDays);
        card = createForecastCard(symbol, data, horizonDays);
      }
    } catch {
      // record already persisted from fixture/series; card is optional
    }

    res.json({
      symbol,
      horizonDays,
      horizon: horizonKey,
      forecast,
      card,
      record
    });
  } catch (error) {
    res.status(error.message && error.message.startsWith('No ') ? 404 : 500)
      .json({ error: error.message });
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
    const payload = ensureForecastHistory();
    const format = req.query.format || 'json';

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="forecasts.csv"');
      res.send(forecastsToCsv(payload.forecasts));
      return;
    }

    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export function handleGetPredictedSeries(req, res) {
  const { symbol = 'BTC', horizon = '7', interval = '1d' } = req.query;
  const horizonDays = parseInt(horizon, 10);
  
  try {
    const data = seriesModel.getIndicators(symbol, interval);
    
    if (data.length === 0) {
      res.status(404).json({ error: 'No data available for symbol' });
      return;
    }
    
    const series = generatePredictedSeries(data, horizonDays);
    
    res.json({
      symbol,
      horizonDays,
      interval,
      ...series
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function parseEnabledStrategies(query) {
  if (!query.strategies) return DEFAULT_ENABLED;
  return String(query.strategies).split(',').map((s) => s.trim()).filter(Boolean);
}

export function handleGetTradingSignals(req, res) {
  const {
    symbol = 'BTC',
    interval = '1d',
    horizon = 'weekly',
    walkForward = 'true'
  } = req.query;

  try {
    seriesModel.load();
    const data = seriesModel.getIndicators(symbol, interval);
    if (!data.length) {
      res.status(404).json({ error: 'No data available for symbol' });
      return;
    }

    const enabled = parseEnabledStrategies(req.query);
    const options = { horizon: HORIZONS.includes(horizon) ? horizon : 'weekly' };
    const events = walkForward === 'false'
      ? evaluateAll(data, enabled, options)
      : evaluateWalkForward(data, enabled, options);

    res.json({
      symbol,
      interval,
      horizon: options.horizon,
      enabled,
      available: ALL_STRATEGIES.map((s) => ({ id: s.id, name: s.name })),
      count: events.length,
      events,
      disclaimer: 'Research signage only. Not a trade recommendation.'
    });
  } catch (error) {
    res.status(error.message && error.message.startsWith('No ') ? 404 : 500)
      .json({ error: error.message });
  }
}

function refreshFilterFromReq(req) {
  const query = req.query || {};
  const body = req.body || {};
  return {
    source: query.source || body.source || undefined,
    symbol: query.symbol || body.symbol || undefined,
    interval: query.interval || body.interval || undefined
  };
}

export async function handlePostRefresh(req, res) {
  try {
    const runtime = getRefreshRuntime();
    const result = await runtime.runRefresh(refreshFilterFromReq(req));
    seriesModel.load();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export function handleGetRefreshStatus(req, res) {
  try {
    const runtime = getRefreshRuntime();
    res.json(runtime.getStatus());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export function handleGetBacktest(req, res) {
  const {
    symbol = 'BTC',
    horizon = 'weekly',
    format = 'json'
  } = req.query;

  try {
    const { series, dataSource } = loadBacktestSeries(symbol);
    const enabled = parseEnabledStrategies(req.query);
    const result = runFullBacktest(series, {
      symbol,
      horizon: HORIZONS.includes(horizon) ? horizon : 'weekly',
      enabled,
      dataSource
    });

    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    if (format === 'markdown') {
      res.setHeader('Content-Type', 'text/markdown');
      res.send(formatBacktestReport(result));
      return;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
