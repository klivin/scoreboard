import { lastKnownRow } from './viewport.js';
import { generateForecast, createForecastCard } from './forecast.js';
import {
  FORECAST_MODEL_VERSION,
  FORECAST_SCHEMA_VERSION,
  daysToHorizon,
  forecastId,
  horizonToDays
} from './forecast-schema.js';

export const MS_PER_DAY = 86400000;

export function utcDayKey(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function addUtcDays(timestamp, days) {
  return timestamp + days * MS_PER_DAY;
}

export function formatDateUtc(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function lastSeriesTimestamp(series) {
  let last = null;
  for (const row of series || []) {
    if (row && Number.isFinite(row.timestamp)) last = row.timestamp;
  }
  return last;
}

export function findBarOnUtcDay(series, targetTs) {
  const key = utcDayKey(targetTs);
  if (key == null) return null;
  for (const row of series || []) {
    if (!row || !Number.isFinite(row.timestamp)) continue;
    if (utcDayKey(row.timestamp) === key) return row;
  }
  return null;
}

export function emptyScore() {
  return {
    mae: null,
    naiveMae: null,
    direction: null,
    naiveDirection: null,
    maeVsNaive: null
  };
}

/**
 * too-early: last series bar is still before the target UTC day.
 * matured: a bar exists on the target UTC day and close is finite.
 * missing-actual: target day is in-series but close is blank or the bar is absent.
 * Never invent a close. Never default MAE to 0.
 */
export function maturityStatus({ asOfTimestamp, horizonDays, series }) {
  if (!Number.isFinite(asOfTimestamp) || !Number.isFinite(horizonDays) || horizonDays <= 0) {
    return { status: 'missing-actual', actual: null, targetTimestamp: null };
  }

  const targetTimestamp = addUtcDays(asOfTimestamp, horizonDays);
  const lastTs = lastSeriesTimestamp(series);
  const lastDay = lastTs != null ? utcDayKey(lastTs) : null;
  const targetDay = utcDayKey(targetTimestamp);

  if (lastDay == null || targetDay == null || lastDay < targetDay) {
    return { status: 'too-early', actual: null, targetTimestamp };
  }

  const bar = findBarOnUtcDay(series, targetTimestamp);
  if (!bar || !Number.isFinite(bar.close)) {
    return { status: 'missing-actual', actual: null, targetTimestamp };
  }

  return {
    status: 'matured',
    actual: {
      close: bar.close,
      timestamp: bar.timestamp,
      dateUtc: bar.date_utc || formatDateUtc(bar.timestamp)
    },
    targetTimestamp
  };
}

export function directionSign(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (to > from) return 1;
  if (to < from) return -1;
  return 0;
}

function directionLabel(predictedSign, actualSign) {
  if (predictedSign == null || actualSign == null) return null;
  return predictedSign === actualSign ? 'hit' : 'miss';
}

function maeVsNaiveLabel(mae, naiveMae) {
  if (!Number.isFinite(mae) || !Number.isFinite(naiveMae)) return null;
  if (mae < naiveMae) return 'better';
  if (mae > naiveMae) return 'worse';
  return 'tie';
}

/**
 * Score a matured prediction against a real close.
 * Returns null MAE fields when actual is not finite — never a fake 0.
 */
export function scoreAgainstActual(predicted, naive, actual, asOfPrice) {
  if (!Number.isFinite(actual)) return emptyScore();

  const mae = Number.isFinite(predicted) ? Math.abs(predicted - actual) : null;
  const naiveMae = Number.isFinite(naive) ? Math.abs(naive - actual) : null;
  const actualDir = directionSign(asOfPrice, actual);
  const predictedDir = directionSign(asOfPrice, predicted);
  const naiveDir = directionSign(asOfPrice, naive);

  return {
    mae,
    naiveMae,
    direction: directionLabel(predictedDir, actualDir),
    naiveDirection: directionLabel(naiveDir, actualDir),
    maeVsNaive: maeVsNaiveLabel(mae, naiveMae)
  };
}

function pickFiniteFeatures(row, generated) {
  const features = {};
  const meta = generated && generated.metadata ? generated.metadata : {};
  const pairs = {
    lastPrice: meta.lastPrice != null ? meta.lastPrice : (row && row.close),
    trendPct: meta.trend,
    volatilityPct: meta.volatility,
    ma20: row && row.ma20,
    ma50: row && row.ma50,
    ma100: row && row.ma100,
    ma200: row && row.ma200,
    tenkan: row && row.tenkan,
    kijun: row && row.kijun
  };
  for (const [key, value] of Object.entries(pairs)) {
    if (Number.isFinite(value)) features[key] = value;
  }
  return features;
}

export function rescoreForecastRecord(record, series) {
  if (!record) return record;
  const maturity = maturityStatus({
    asOfTimestamp: record.asOfTimestamp,
    horizonDays: record.horizonDays,
    series
  });

  const next = {
    ...record,
    schemaVersion: FORECAST_SCHEMA_VERSION,
    status: maturity.status,
    targetTimestamp: maturity.targetTimestamp,
    actual: maturity.status === 'matured' ? maturity.actual : null,
    updatedAt: Date.now()
  };

  if (maturity.status === 'matured') {
    next.score = scoreAgainstActual(
      record.predicted && record.predicted.point,
      record.naive && record.naive.point,
      maturity.actual.close,
      record.asOfPrice
    );
  } else {
    next.score = emptyScore();
  }

  return next;
}

export function buildScoredForecast({
  seriesAsOf,
  fullSeries,
  symbol,
  horizon,
  interval = '1d',
  dataSource = null
}) {
  const horizonDays = horizonToDays(horizon);
  const horizonKey = typeof horizon === 'string' && Number.isNaN(Number(horizon))
    ? String(horizon).toLowerCase()
    : daysToHorizon(horizonDays);
  const asOf = lastKnownRow(seriesAsOf);
  if (!asOf || !Number.isFinite(asOf.timestamp) || !Number.isFinite(asOf.close)) {
    throw new Error('No as-of bar with a last known close for forecast');
  }

  const generated = generateForecast(seriesAsOf, horizonDays);
  const card = createForecastCard(symbol, seriesAsOf, horizonDays);
  const record = {
    schemaVersion: FORECAST_SCHEMA_VERSION,
    id: forecastId(symbol, horizonKey, asOf.timestamp),
    symbol: String(symbol).toUpperCase(),
    horizon: horizonKey,
    horizonDays,
    interval,
    asOfTimestamp: asOf.timestamp,
    asOfDateUtc: asOf.date_utc || formatDateUtc(asOf.timestamp),
    asOfPrice: asOf.close,
    model: generated.method,
    modelVersion: FORECAST_MODEL_VERSION,
    predicted: {
      point: generated.prediction,
      lower: generated.lower,
      upper: generated.upper
    },
    naive: { point: generated.naive },
    confidence: card.confidence,
    features: pickFiniteFeatures(asOf, generated),
    rationale: {
      side: card.side,
      recommendation: card.recommendation,
      changePercent: card.changePercent,
      proCase: card.proCase,
      conCase: card.conCase
    },
    actual: null,
    score: emptyScore(),
    status: 'too-early',
    targetTimestamp: addUtcDays(asOf.timestamp, horizonDays),
    dataSource,
    createdAt: Date.now()
  };

  return rescoreForecastRecord(record, fullSeries || seriesAsOf);
}

/**
 * Walk-forward scored history. One record every `stepBars` after warmup.
 * Uses only the prefix `series[0..i]` to generate — no lookahead on features.
 */
export function generateWalkForwardForecasts(series, {
  symbol,
  horizons = ['weekly', 'monthly'],
  interval = '1d',
  dataSource = null,
  stepBars
} = {}) {
  const records = [];
  const seen = new Set();

  for (const horizon of horizons) {
    const horizonDays = horizonToDays(horizon);
    const step = Number.isFinite(stepBars) && stepBars > 0 ? stepBars : horizonDays;
    const minIndex = Math.max(30, horizonDays + 7);

    if (!series || series.length <= minIndex) continue;

    for (let i = minIndex; i < series.length; i += step) {
      const slice = series.slice(0, i + 1);
      try {
        const record = buildScoredForecast({
          seriesAsOf: slice,
          fullSeries: series,
          symbol,
          horizon,
          interval,
          dataSource
        });
        if (record.id && !seen.has(record.id)) {
          seen.add(record.id);
          records.push(record);
        }
      } catch {
        // skip bars without a last known close
      }
    }

    try {
      const latest = buildScoredForecast({
        seriesAsOf: series,
        fullSeries: series,
        symbol,
        horizon,
        interval,
        dataSource
      });
      if (latest.id && !seen.has(latest.id)) {
        seen.add(latest.id);
        records.push(latest);
      }
    } catch {
      // no latest close
    }
  }

  return records;
}
