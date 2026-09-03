export const FORECAST_SCHEMA_VERSION = 1;
export const FORECAST_NAMESPACE = 'forecasts';
export const FORECAST_MODEL_VERSION = 'trend-v1';

export const HORIZON_DAYS = Object.freeze({
  weekly: 7,
  monthly: 30,
  '1d': 1
});

export function emptyForecastStore() {
  return {
    schemaVersion: FORECAST_SCHEMA_VERSION,
    namespace: FORECAST_NAMESPACE,
    items: []
  };
}

export function horizonToDays(horizon, fallbackDays) {
  if (typeof horizon === 'number' && Number.isFinite(horizon)) return horizon;
  const key = String(horizon || '').toLowerCase();
  if (HORIZON_DAYS[key] != null) return HORIZON_DAYS[key];
  const asNumber = Number(horizon);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
  if (Number.isFinite(fallbackDays) && fallbackDays > 0) return fallbackDays;
  return 7;
}

export function daysToHorizon(days) {
  if (days === 30) return 'monthly';
  if (days === 7) return 'weekly';
  if (days === 1) return '1d';
  return `${days}d`;
}

export function forecastId(symbol, horizon, asOfTimestamp) {
  return `fc_${String(symbol || '').toUpperCase()}_${horizon}_${asOfTimestamp}_${FORECAST_MODEL_VERSION}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function emptyScore() {
  return {
    mae: null,
    naiveMae: null,
    direction: null,
    naiveDirection: null,
    maeVsNaive: null
  };
}

/**
 * Lift a v0 generate-card / loose object into a v1 scored record.
 * Does not invent actuals or MAE — those stay null until rescore.
 */
export function migrateForecastItem(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const card = raw.card || raw.forecast || raw;
  const horizonDays = horizonToDays(
    raw.horizon || card.horizon || card.horizonDays || raw.horizonDays,
    raw.horizonDays || card.horizonDays
  );
  const horizon = raw.horizon && HORIZON_DAYS[raw.horizon]
    ? raw.horizon
    : daysToHorizon(horizonDays);
  const symbol = String(raw.symbol || card.symbol || '').toUpperCase() || null;
  const asOfTimestamp = Number.isFinite(raw.asOfTimestamp)
    ? raw.asOfTimestamp
    : (Number.isFinite(card.asOfTimestamp)
      ? card.asOfTimestamp
      : (Number.isFinite(raw.timestamp) ? raw.timestamp : (raw.createdAt || null)));

  const predictedPoint = Number.isFinite(raw.predicted && raw.predicted.point)
    ? raw.predicted.point
    : (Number.isFinite(card.prediction) ? card.prediction : null);
  const predictedLower = Number.isFinite(raw.predicted && raw.predicted.lower)
    ? raw.predicted.lower
    : (Number.isFinite(card.lower) ? card.lower : null);
  const predictedUpper = Number.isFinite(raw.predicted && raw.predicted.upper)
    ? raw.predicted.upper
    : (Number.isFinite(card.upper) ? card.upper : null);
  const naivePoint = Number.isFinite(raw.naive && raw.naive.point)
    ? raw.naive.point
    : (Number.isFinite(card.naive) ? card.naive : null);

  const status = raw.status === 'matured' || raw.status === 'missing-actual' || raw.status === 'too-early'
    ? raw.status
    : 'too-early';

  const actual = raw.actual && Number.isFinite(raw.actual.close)
    ? raw.actual
    : null;

  const score = raw.score && typeof raw.score === 'object'
    ? {
      mae: Number.isFinite(raw.score.mae) ? raw.score.mae : null,
      naiveMae: Number.isFinite(raw.score.naiveMae) ? raw.score.naiveMae : null,
      direction: raw.score.direction === 'hit' || raw.score.direction === 'miss' ? raw.score.direction : null,
      naiveDirection: raw.score.naiveDirection === 'hit' || raw.score.naiveDirection === 'miss'
        ? raw.score.naiveDirection
        : null,
      maeVsNaive: raw.score.maeVsNaive === 'better' || raw.score.maeVsNaive === 'worse' || raw.score.maeVsNaive === 'tie'
        ? raw.score.maeVsNaive
        : null
    }
    : emptyScore();

  if (status !== 'matured') {
    score.mae = null;
    score.naiveMae = null;
    score.direction = null;
    score.naiveDirection = null;
    score.maeVsNaive = null;
  }

  return {
    schemaVersion: FORECAST_SCHEMA_VERSION,
    id: raw.id || (symbol && asOfTimestamp != null ? forecastId(symbol, horizon, asOfTimestamp) : null),
    symbol,
    horizon,
    horizonDays,
    interval: raw.interval || '1d',
    asOfTimestamp,
    asOfDateUtc: raw.asOfDateUtc || card.asOfDateUtc || null,
    asOfPrice: Number.isFinite(raw.asOfPrice) ? raw.asOfPrice : (Number.isFinite(card.lastPrice) ? card.lastPrice : null),
    model: raw.model || card.method || 'trend',
    modelVersion: raw.modelVersion || FORECAST_MODEL_VERSION,
    predicted: {
      point: predictedPoint,
      lower: predictedLower,
      upper: predictedUpper
    },
    naive: { point: naivePoint },
    confidence: Number.isFinite(raw.confidence) ? raw.confidence : (Number.isFinite(card.confidence) ? card.confidence : null),
    features: raw.features && typeof raw.features === 'object' ? raw.features : {},
    rationale: raw.rationale && typeof raw.rationale === 'object'
      ? raw.rationale
      : {
        side: card.side || null,
        recommendation: card.recommendation || null,
        changePercent: Number.isFinite(card.changePercent) ? card.changePercent : null,
        proCase: card.proCase || null,
        conCase: card.conCase || null
      },
    actual,
    score,
    status,
    targetTimestamp: Number.isFinite(raw.targetTimestamp) ? raw.targetTimestamp : null,
    dataSource: raw.dataSource || null,
    createdAt: raw.createdAt || raw.timestamp || Date.now(),
    updatedAt: raw.updatedAt || null,
    migratedFrom: raw.schemaVersion == null ? 0 : raw.schemaVersion
  };
}

/**
 * Migrate any persisted forecast-store payload into schemaVersion 1.
 * Unversioned `{ items }` blobs and bare arrays are wrapped, never discarded.
 */
export function migrateForecastStore(raw) {
  if (raw == null || typeof raw !== 'object') {
    return emptyForecastStore();
  }

  const version = Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0;
  const sourceItems = Array.isArray(raw.items)
    ? raw.items
    : (Array.isArray(raw) ? raw : asArray(raw.forecasts));

  return {
    schemaVersion: FORECAST_SCHEMA_VERSION,
    namespace: FORECAST_NAMESPACE,
    items: sourceItems.map(migrateForecastItem).filter(Boolean),
    migratedFrom: version
  };
}
