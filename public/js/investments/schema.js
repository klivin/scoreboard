export const INVESTMENTS_SCHEMA_VERSION = 1;
export const INVESTMENTS_STORAGE_KEY = 'scoreboard.investments';
export const INVESTMENTS_NAMESPACE = 'investments';

export const COLLECTION_NAMES = Object.freeze([
  'rawTransactions',
  'events',
  'paperTrades',
  'tracking',
  'symbolMaps',
  'settings'
]);

export function emptyCollections() {
  return {
    rawTransactions: [],
    events: [],
    paperTrades: [],
    tracking: [],
    symbolMaps: [],
    settings: { costMethod: 'fifo' }
  };
}

export function emptyState() {
  return {
    schemaVersion: INVESTMENTS_SCHEMA_VERSION,
    namespace: INVESTMENTS_NAMESPACE,
    collections: emptyCollections()
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCollections(raw) {
  const base = emptyCollections();
  if (!raw || typeof raw !== 'object') return base;
  return {
    rawTransactions: asArray(raw.rawTransactions),
    events: asArray(raw.events),
    paperTrades: asArray(raw.paperTrades),
    tracking: asArray(raw.tracking),
    symbolMaps: asArray(raw.symbolMaps),
    settings: {
      costMethod: raw.settings && raw.settings.costMethod === 'average' ? 'average' : 'fifo'
    }
  };
}

/**
 * Migrate any persisted payload into the current schema.
 * Unknown future versions keep data but stamp the current version only after
 * known upgrade steps. Unversioned / v0 blobs are wrapped, never discarded.
 */
export function migrateInvestmentsState(raw) {
  if (raw == null || typeof raw !== 'object') {
    return emptyState();
  }

  let version = Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0;
  let collections;

  if (version === 0) {
    if (raw.collections && typeof raw.collections === 'object') {
      collections = normalizeCollections(raw.collections);
    } else {
      collections = normalizeCollections({
        rawTransactions: raw.rawTransactions || raw.raw || raw.transactions,
        events: raw.events,
        paperTrades: raw.paperTrades || raw.paper,
        tracking: raw.tracking,
        symbolMaps: raw.symbolMaps || raw.maps,
        settings: raw.settings
      });
    }
    version = 1;
  } else {
    collections = normalizeCollections(raw.collections);
  }

  return {
    schemaVersion: INVESTMENTS_SCHEMA_VERSION,
    namespace: INVESTMENTS_NAMESPACE,
    collections,
    migratedFrom: raw.schemaVersion == null ? 0 : raw.schemaVersion
  };
}
