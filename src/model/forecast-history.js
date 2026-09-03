import { addIndicators } from './indicators.js';
import { parseUtcTimestamp } from './dates.js';
import { buildBacktestFixture } from './fixtures/backtest-pack.js';
import { seriesModel } from './series.js';
import { forecastStore } from './store-adapter.js';
import { migrateForecastStore, FORECAST_SCHEMA_VERSION, FORECAST_NAMESPACE } from './forecast-schema.js';
import { generateWalkForwardForecasts, rescoreForecastRecord, buildScoredForecast } from './forecast-score.js';

function stampCache(store, migrated) {
  if (!store) return migrated;
  if (store.cache && typeof store.cache === 'object') {
    store.cache.schemaVersion = FORECAST_SCHEMA_VERSION;
    store.cache.namespace = FORECAST_NAMESPACE;
    store.cache.items = migrated.items;
    if (typeof store._save === 'function') store._save();
  }
  return migrated;
}

export function loadMigratedForecastStore(store = forecastStore) {
  if (store && typeof store._load === 'function' && !store.cache) {
    store._load();
  }
  const raw = store && store.cache
    ? store.cache
    : { items: store && typeof store.getAll === 'function' ? store.getAll() : [] };
  const migrated = migrateForecastStore(raw);
  stampCache(store, migrated);
  return migrated;
}

export function listForecastRecords(store = forecastStore) {
  return loadMigratedForecastStore(store).items;
}

export function persistForecastRecords(records, store = forecastStore) {
  loadMigratedForecastStore(store);
  if (typeof store.upsertMany === 'function') {
    store.upsertMany(records.filter((row) => row && row.id));
  } else {
    for (const record of records || []) {
      if (!record || !record.id) continue;
      store.add(record);
    }
  }
  if (store && store.cache) {
    store.cache.schemaVersion = FORECAST_SCHEMA_VERSION;
    store.cache.namespace = FORECAST_NAMESPACE;
    if (typeof store._save === 'function') store._save();
  }
  return listForecastRecords(store);
}

export function mapFixtureRows(rows) {
  const grouped = {};
  for (const row of rows || []) {
    if (!row || !row.symbol) continue;
    const symbol = String(row.symbol).toUpperCase();
    if (!grouped[symbol]) grouped[symbol] = [];
    grouped[symbol].push({
      ...row,
      timestamp: parseUtcTimestamp(row.date_utc, row.timestamp)
    });
  }
  const map = {};
  for (const [symbol, list] of Object.entries(grouped)) {
    list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    map[symbol] = addIndicators(list);
  }
  return map;
}

export function loadSeriesBySymbol() {
  try {
    seriesModel.load();
    const symbols = seriesModel.getAvailableSymbols();
    const map = {};
    for (const symbol of symbols) {
      try {
        const data = seriesModel.getIndicators(symbol, '1d');
        if (data && data.length) map[String(symbol).toUpperCase()] = data;
      } catch {
        // symbol+interval missing — skip, do not invent
      }
    }
    if (Object.keys(map).length) {
      return { map, dataSource: 'series' };
    }
  } catch {
    // pack missing
  }

  return {
    map: mapFixtureRows(buildBacktestFixture()),
    dataSource: 'fixture'
  };
}

export function rescoreRecords(records, seriesBySymbol) {
  return (records || []).map((record) => {
    const series = seriesBySymbol && record.symbol
      ? seriesBySymbol[String(record.symbol).toUpperCase()]
      : null;
    if (!series || !series.length) return record;
    return rescoreForecastRecord(record, series);
  });
}

export function generateHistoryForSeriesMap(seriesBySymbol, { dataSource = null, horizons = ['weekly', 'monthly'] } = {}) {
  const records = [];
  for (const [symbol, series] of Object.entries(seriesBySymbol || {})) {
    records.push(...generateWalkForwardForecasts(series, { symbol, horizons, dataSource }));
  }
  records.sort((a, b) => (b.asOfTimestamp || 0) - (a.asOfTimestamp || 0));
  return records;
}

/**
 * Return scored history. Rescores stored rows. If the store is empty, walk-forward
 * generate from available series (or the labeled backtest fixture).
 */
export function ensureForecastHistory(options = {}) {
  const store = options.store || forecastStore;
  const loaded = options.seriesBundle || loadSeriesBySymbol();
  const existing = listForecastRecords(store);
  let records;
  let seeded = false;

  if (existing.length) {
    records = rescoreRecords(existing, loaded.map);
    persistForecastRecords(records, store);
  } else {
    records = generateHistoryForSeriesMap(loaded.map, {
      dataSource: loaded.dataSource,
      horizons: options.horizons || ['weekly', 'monthly']
    });
    seeded = records.length > 0;
    if (records.length) persistForecastRecords(records, store);
  }

  records.sort((a, b) => (b.asOfTimestamp || 0) - (a.asOfTimestamp || 0));

  return {
    schemaVersion: FORECAST_SCHEMA_VERSION,
    namespace: FORECAST_NAMESPACE,
    forecasts: records,
    count: records.length,
    seeded,
    dataSource: loaded.dataSource,
    note: loaded.dataSource === 'fixture'
      ? 'Forecasts were generated from the deterministic backtest fixture (not live Flow pack). Outcomes are fixture closes, not invented zeros, and are not live market claims.'
      : null
  };
}

export function createAndStoreForecast({ symbol, horizon, store = forecastStore, seriesBundle } = {}) {
  const loaded = seriesBundle || loadSeriesBySymbol();
  const series = loaded.map[String(symbol || '').toUpperCase()];
  if (!series || !series.length) {
    throw new Error(`No series available for ${symbol} — cannot invent a forecast`);
  }
  const record = buildScoredForecast({
    seriesAsOf: series,
    fullSeries: series,
    symbol,
    horizon,
    dataSource: loaded.dataSource
  });
  persistForecastRecords([record], store);
  return record;
}

export function forecastsToCsv(forecasts) {
  const headers = [
    'id', 'symbol', 'horizon', 'horizonDays', 'asOfDateUtc', 'asOfTimestamp',
    'asOfPrice', 'predictedPoint', 'predictedLower', 'predictedUpper',
    'naivePoint', 'confidence', 'model', 'modelVersion',
    'actualClose', 'mae', 'naiveMae', 'direction', 'naiveDirection',
    'maeVsNaive', 'status', 'dataSource'
  ];
  const escape = (value) => {
    if (value == null) return '';
    const text = String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const rows = (forecasts || []).map((fc) => ({
    id: fc.id,
    symbol: fc.symbol,
    horizon: fc.horizon,
    horizonDays: fc.horizonDays,
    asOfDateUtc: fc.asOfDateUtc,
    asOfTimestamp: fc.asOfTimestamp,
    asOfPrice: fc.asOfPrice,
    predictedPoint: fc.predicted && fc.predicted.point,
    predictedLower: fc.predicted && fc.predicted.lower,
    predictedUpper: fc.predicted && fc.predicted.upper,
    naivePoint: fc.naive && fc.naive.point,
    confidence: fc.confidence,
    model: fc.model,
    modelVersion: fc.modelVersion,
    actualClose: fc.actual && fc.actual.close,
    mae: fc.score && fc.score.mae,
    naiveMae: fc.score && fc.score.naiveMae,
    direction: fc.score && fc.score.direction,
    naiveDirection: fc.score && fc.score.naiveDirection,
    maeVsNaive: fc.score && fc.score.maeVsNaive,
    status: fc.status,
    dataSource: fc.dataSource
  }));
  return [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n');
}
