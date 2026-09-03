/**
 * Client-safe scanner helpers (no server-only imports).
 * Filter/sort/format/holdings/tracking freeze. Missing stays missing.
 */

export const SCANNER_DISCLAIMER =
  'Research / paper only. Not automatic trade recommendations. No execution, no keys, no trades.';

export const SCANNER_HORIZONS = Object.freeze([1, 7, 30]);
export const NEW_FLIP_MS = 7 * 24 * 60 * 60 * 1000;
export const SCANNER_TRACKING_SCHEMA_VERSION = 1;
export const SCANNER_TRACKING_NAMESPACE = 'scanner';
export const SCANNER_TRACKING_KEY = 'scoreboard.scanner.tracking';

const BULLISH = new Set(['BULLISH', 'LONG', 'BUY']);
const BEARISH = new Set(['BEARISH', 'SHORT', 'SELL']);
const NEUTRAL = new Set(['NEUTRAL', 'CLOSE']);

export function finiteOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatScannerCell(value, formatter) {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return 'missing';
  return formatter ? formatter(value) : String(value);
}

export function isoDateFromTimestamp(ts) {
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

export function directionFamily(direction) {
  if (direction == null || direction === '') return null;
  const upper = String(direction).toUpperCase();
  if (BULLISH.has(upper)) return 'bullish';
  if (BEARISH.has(upper)) return 'bearish';
  if (NEUTRAL.has(upper)) return 'neutral';
  return null;
}

export function isNewFlip(flip, now = Date.now()) {
  return Boolean(flip && Number.isFinite(flip.at) && Number.isFinite(now) && (now - flip.at) <= NEW_FLIP_MS);
}

function horizonConfidence(row, horizon) {
  const slot = row && row.horizons && row.horizons[horizon];
  return slot ? finiteOrNull(slot.confidence) : null;
}

function horizonDirection(row, horizon) {
  const slot = row && row.horizons && row.horizons[horizon];
  return slot ? slot.direction : null;
}

export function filterScannerRows(rows, filters = {}) {
  const list = rows || [];
  const horizon = filters.horizon == null || filters.horizon === '' ? null : Number(filters.horizon);
  const now = filters.now || Date.now();

  return list.filter((row) => {
    if (!row) return false;

    if (filters.assetClass && filters.assetClass !== 'all') {
      if (row.assetClass !== filters.assetClass) return false;
    }

    if (filters.realHoldings) {
      if (!row.holdings || !row.holdings.real) return false;
    }

    if (filters.tracking) {
      if (!row.holdings || !row.holdings.tracking) return false;
    }

    if (filters.minConfidence != null && Number.isFinite(Number(filters.minConfidence))) {
      const conf = horizonConfidence(row, horizon || 7);
      if (conf == null || conf < Number(filters.minConfidence)) return false;
    }

    if (filters.flip && filters.flip !== 'all') {
      const wanted = filters.flip === 'bullish' || filters.flip === 'new-bullish' ? 'bullish'
        : (filters.flip === 'bearish' || filters.flip === 'new-bearish' ? 'bearish' : null);
      if (wanted) {
        const flip = row.flip || {};
        const fam = flip.lastFlipDirection || directionFamily(flip.next);
        if (fam !== wanted) return false;
        if (!isNewFlip({ at: flip.lastFlipAt, next: flip.next }, now)) return false;
      }
    }

    if (horizon && filters.requireHorizonDirection) {
      if (!horizonDirection(row, horizon)) return false;
    }

    return true;
  });
}

function compareNullable(a, b, dir) {
  const aMissing = a == null || (typeof a === 'number' && !Number.isFinite(a));
  const bMissing = b == null || (typeof b === 'number' && !Number.isFinite(b));
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (a < b) return dir === 'desc' ? 1 : -1;
  if (a > b) return dir === 'desc' ? -1 : 1;
  return 0;
}

export function sortScannerRows(rows, sortBy = 'symbol', direction = 'asc') {
  const dir = direction === 'desc' ? 'desc' : 'asc';
  const horizon = typeof sortBy === 'object' ? Number(sortBy.horizon || 7) : 7;
  const key = typeof sortBy === 'object' ? sortBy.key : sortBy;

  return (rows || []).slice().sort((a, b) => {
    let cmp = 0;
    if (key === 'confidence') {
      cmp = compareNullable(horizonConfidence(a, horizon), horizonConfidence(b, horizon), dir);
    } else if (key === 'flip' || key === 'lastFlipAt') {
      cmp = compareNullable(a.flip && a.flip.lastFlipAt, b.flip && b.flip.lastFlipAt, dir);
    } else if (key === 'horizon') {
      cmp = compareNullable(horizonDirection(a, horizon), horizonDirection(b, horizon), dir);
    } else if (key === 'assetClass') {
      cmp = compareNullable(a.assetClass, b.assetClass, dir);
    } else if (key === 'real' || key === 'realHoldings') {
      cmp = compareNullable(a.holdings && a.holdings.real ? 1 : 0, b.holdings && b.holdings.real ? 1 : 0, dir);
    } else if (key === 'tracking') {
      cmp = compareNullable(a.holdings && a.holdings.tracking ? 1 : 0, b.holdings && b.holdings.tracking ? 1 : 0, dir);
    } else if (key === 'price' || key === 'currentPrice') {
      cmp = compareNullable(a.currentPrice, b.currentPrice, dir);
    } else {
      cmp = compareNullable(a.symbol, b.symbol, dir);
    }
    if (cmp !== 0) return cmp;
    return compareNullable(a.symbol, b.symbol, 'asc');
  });
}

export function freezeTrackingBaseline(input = {}) {
  const errors = [];
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const baselinePrice = finiteOrNull(input.baselinePrice);
  const startedAt = finiteOrNull(input.startedAt) ?? Date.now();
  const startDate = input.startDate || isoDateFromTimestamp(startedAt);

  if (!symbol) errors.push('Tracking symbol is required');
  if (!startDate) errors.push('Tracking start date is required');
  if (baselinePrice == null) errors.push('Tracking baseline price is required — missing cannot start tracking');
  if (baselinePrice === 0) errors.push('Tracking baseline price cannot be 0 (missing prices stay missing)');

  if (errors.length) return { ok: false, errors, record: null };

  return {
    ok: true,
    errors: [],
    record: {
      badge: 'TRACKING',
      symbol,
      startDate,
      baselinePrice,
      startedAt,
      stoppedAt: null,
      stopDate: null,
      stopPrice: null,
      status: 'active',
      history: [{
        action: 'start',
        date: startDate,
        price: baselinePrice,
        at: startedAt
      }]
    }
  };
}

export function stopTrackingRecord(record, stop = {}) {
  if (!record) return null;
  const stoppedAt = finiteOrNull(stop.stoppedAt) ?? Date.now();
  const stopDate = stop.stopDate || isoDateFromTimestamp(stoppedAt);
  const history = Array.isArray(record.history) ? record.history.slice() : [];
  history.push({
    action: 'stop',
    date: stopDate,
    price: stop.stopPrice == null ? null : finiteOrNull(stop.stopPrice),
    at: stoppedAt
  });
  return {
    ...record,
    status: 'stopped',
    stoppedAt,
    stopDate,
    stopPrice: stop.stopPrice == null ? null : finiteOrNull(stop.stopPrice),
    history
  };
}

export function snapshotHoldings(investmentsState) {
  const realSymbols = new Set();
  const trackingBySymbol = new Map();
  const collections = investmentsState && investmentsState.collections
    ? investmentsState.collections
    : {};

  for (const event of collections.events || []) {
    if (!event || !event.symbol) continue;
    if (event.badge === 'TRACKING') continue;
    realSymbols.add(String(event.symbol).toUpperCase());
  }

  for (const record of collections.tracking || []) {
    if (!record || !record.symbol) continue;
    const symbol = String(record.symbol).toUpperCase();
    const existing = trackingBySymbol.get(symbol);
    if (!existing || record.status === 'active') {
      trackingBySymbol.set(symbol, record);
    }
  }

  return { realSymbols, trackingBySymbol };
}

export function applyHoldingsToRows(rows, investmentsState) {
  const snap = snapshotHoldings(investmentsState);
  return (rows || []).map((row) => {
    const symbol = row && row.symbol ? String(row.symbol).toUpperCase() : null;
    const real = symbol ? snap.realSymbols.has(symbol) : false;
    const track = symbol ? snap.trackingBySymbol.get(symbol) : null;
    const trackingActive = Boolean(track && track.status === 'active');
    let badge = null;
    if (real) badge = 'REAL';
    if (trackingActive) badge = badge === 'REAL' ? 'REAL' : 'TRACKING';
    return {
      ...row,
      holdings: {
        real,
        tracking: trackingActive,
        trackingId: track ? track.id : null,
        trackingStatus: track ? track.status : null,
        badge
      }
    };
  });
}

export function emptyClientScannerRow(symbol) {
  const slot = { direction: null, confidence: null, prediction: null, naive: null, changePercent: null };
  return {
    symbol: String(symbol || '').toUpperCase() || null,
    name: null,
    assetClass: 'unknown',
    currentPrice: null,
    priceTimestamp: null,
    liquidity: { volume: null, freshnessMs: null, freshnessLabel: null, lastBarAt: null },
    horizons: { 1: { ...slot }, 7: { ...slot }, 30: { ...slot } },
    flip: { lastFlipAt: null, lastFlipDirection: null, prior: null, next: null, isNew: false },
    consensus: { direction: null, scorePercent: null, confidence: null, breakdown: null, missing: true },
    backtest: { status: 'missing', beatsBuyHold: null, beatsNaive: null, note: 'missing' },
    context: { etfNetFlowUsdMillions: null, oiContracts: null, correlationVsBtc: null, correlationCategory: null },
    holdings: { real: false, tracking: false, trackingId: null, trackingStatus: null, badge: null },
    flipHistory: []
  };
}

export function mergeHoldingSymbols(rows, investmentsState) {
  const snap = snapshotHoldings(investmentsState);
  const have = new Set((rows || []).map((r) => r && r.symbol).filter(Boolean));
  const extra = [];
  for (const symbol of snap.realSymbols) {
    if (!have.has(symbol)) extra.push(emptyClientScannerRow(symbol));
  }
  for (const symbol of snap.trackingBySymbol.keys()) {
    if (!have.has(symbol)) extra.push(emptyClientScannerRow(symbol));
  }
  return applyHoldingsToRows([...(rows || []), ...extra], investmentsState);
}

export function emptyScannerTrackingState() {
  return {
    schemaVersion: SCANNER_TRACKING_SCHEMA_VERSION,
    namespace: SCANNER_TRACKING_NAMESPACE,
    collections: { tracking: [] }
  };
}

export function migrateScannerTrackingState(raw) {
  if (raw == null || typeof raw !== 'object') return emptyScannerTrackingState();
  const tracking = Array.isArray(raw.collections && raw.collections.tracking)
    ? raw.collections.tracking
    : (Array.isArray(raw.tracking) ? raw.tracking : []);
  return {
    schemaVersion: SCANNER_TRACKING_SCHEMA_VERSION,
    namespace: SCANNER_TRACKING_NAMESPACE,
    collections: { tracking },
    migratedFrom: raw.schemaVersion == null ? 0 : raw.schemaVersion
  };
}
