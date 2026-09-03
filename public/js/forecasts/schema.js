export const FORECASTS_SCHEMA_VERSION = 1;
export const FORECASTS_STORAGE_KEY = 'scoreboard.forecasts';
export const FORECASTS_NAMESPACE = 'forecasts';

export function emptyForecastsCollections() {
  return {
    records: [],
    settings: {
      holdingsFilter: 'all',
      horizonFilter: 'all'
    }
  };
}

export function emptyForecastsState() {
  return {
    schemaVersion: FORECASTS_SCHEMA_VERSION,
    namespace: FORECASTS_NAMESPACE,
    collections: emptyForecastsCollections()
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSettings(raw) {
  const holdings = raw && (raw.holdingsFilter === 'REAL' || raw.holdingsFilter === 'TRACKING')
    ? raw.holdingsFilter
    : 'all';
  const horizon = raw && (raw.horizonFilter === 'weekly' || raw.horizonFilter === 'monthly')
    ? raw.horizonFilter
    : 'all';
  return { holdingsFilter: holdings, horizonFilter: horizon };
}

function normalizeCollections(raw) {
  const base = emptyForecastsCollections();
  if (!raw || typeof raw !== 'object') return base;
  return {
    records: asArray(raw.records || raw.items || raw.forecasts),
    settings: normalizeSettings(raw.settings)
  };
}

/**
 * Migrate any persisted client payload into schemaVersion 1.
 * Unversioned blobs and bare record arrays are wrapped, never discarded.
 */
export function migrateForecastsState(raw) {
  if (raw == null || typeof raw !== 'object') {
    return emptyForecastsState();
  }

  let version = Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0;
  let collections;

  if (version === 0) {
    if (raw.collections && typeof raw.collections === 'object') {
      collections = normalizeCollections(raw.collections);
    } else if (Array.isArray(raw)) {
      collections = normalizeCollections({ records: raw });
    } else {
      collections = normalizeCollections({
        records: raw.records || raw.items || raw.forecasts,
        settings: raw.settings
      });
    }
    version = 1;
  } else {
    collections = normalizeCollections(raw.collections);
  }

  return {
    schemaVersion: FORECASTS_SCHEMA_VERSION,
    namespace: FORECASTS_NAMESPACE,
    collections,
    migratedFrom: raw.schemaVersion == null ? 0 : raw.schemaVersion
  };
}
