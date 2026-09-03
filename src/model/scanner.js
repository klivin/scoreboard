/**
 * Universe money-scanner (research / paper only).
 * Pure functions: row construction, flip history, tracking evaluation, filter/sort.
 * Missing numeric fields stay null — never coerced to 0.
 * No composite ranking or invented sentiment.
 */

import { lastKnownClose, lastKnownRow } from './viewport.js';
import { generateForecast, naiveBaseline } from './forecast.js';

export const SCANNER_DISCLAIMER =
  'Research / paper only. Not automatic trade recommendations. No execution, no keys, no trades.';

export const SUPPORTED_PACK_SYMBOLS = Object.freeze([
  'AVAX', 'BNB', 'BTC', 'DOGE', 'ETH', 'LINK', 'PEPE', 'SHIB', 'SOL', 'SUI', 'TRUMP', 'XRP'
]);

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

export function classifyAssetClass(input = {}) {
  if (input.assetClass) return String(input.assetClass).toLowerCase();
  if (input.asset_class) return String(input.asset_class).toLowerCase();
  const hint = String(input.classHint || input.type || '').toLowerCase();
  if (hint === 'stock' || hint === 'equity') return 'stock';
  if (hint === 'etf') return 'etf';
  if (hint === 'crypto' || hint === 'coin') return 'crypto';
  if (SUPPORTED_PACK_SYMBOLS.includes(String(input.symbol || '').toUpperCase())) return 'crypto';
  if (input.fromCoinGecko || input.coinGecko) return 'crypto';
  return 'unknown';
}

export function dataFreshness(lastBarAt, now = Date.now()) {
  if (!Number.isFinite(lastBarAt)) {
    return { freshnessMs: null, freshnessLabel: null, lastBarAt: null };
  }
  const freshnessMs = now - lastBarAt;
  if (!Number.isFinite(freshnessMs)) {
    return { freshnessMs: null, freshnessLabel: null, lastBarAt };
  }
  const abs = Math.abs(freshnessMs);
  let freshnessLabel;
  if (abs < 60 * 1000) freshnessLabel = `${Math.round(abs / 1000)}s`;
  else if (abs < 60 * 60 * 1000) freshnessLabel = `${Math.round(abs / 60000)}m`;
  else if (abs < 48 * 60 * 60 * 1000) freshnessLabel = `${Math.round(abs / 3600000)}h`;
  else freshnessLabel = `${Math.round(abs / 86400000)}d`;
  return { freshnessMs, freshnessLabel, lastBarAt };
}

/**
 * Model sided prediction from an existing forecast. Not a sentiment poll.
 * Confidence comes from the model's own band width; missing bands → missing confidence.
 */
export function modelHorizonFromForecast(forecast, lastPrice) {
  const prediction = forecast ? finiteOrNull(forecast.prediction) : null;
  const naive = forecast ? finiteOrNull(forecast.naive) : null;
  const upper = forecast ? finiteOrNull(forecast.upper) : null;
  const lower = forecast ? finiteOrNull(forecast.lower) : null;
  const price = finiteOrNull(lastPrice);

  if (prediction == null || price == null || price === 0) {
    return {
      direction: null,
      confidence: null,
      prediction,
      naive,
      changePercent: null
    };
  }

  let direction = 'NEUTRAL';
  if (prediction > price) direction = 'BULLISH';
  else if (prediction < price) direction = 'BEARISH';

  const changePercent = ((prediction - price) / price) * 100;
  let confidence = null;
  if (upper != null && lower != null) {
    const bandWidth = Math.abs(upper - lower);
    const relative = bandWidth / Math.abs(price);
    if (Number.isFinite(relative)) {
      confidence = Math.max(0, Math.min(100, 100 - relative * 100));
    }
  }

  return { direction, confidence, prediction, naive, changePercent };
}

export function emptyHorizonSlot() {
  return {
    direction: null,
    confidence: null,
    prediction: null,
    naive: null,
    changePercent: null
  };
}

export function emptyConsensus() {
  return {
    direction: null,
    scorePercent: null,
    confidence: null,
    breakdown: null,
    missing: true
  };
}

export function consensusFromEvent(event) {
  if (!event || !event.consensus) return emptyConsensus();
  const c = event.consensus;
  const hasVotes = Array.isArray(c.breakdown) ? c.breakdown.length > 0 : false;
  if (!hasVotes && c.direction == null && c.scorePercent == null) return emptyConsensus();
  if (!hasVotes && (c.direction == null || c.direction === 'NEUTRAL') && (c.confidence === 0 || c.confidence == null)) {
    return emptyConsensus();
  }
  return {
    direction: c.direction || null,
    scorePercent: finiteOrNull(c.scorePercent),
    confidence: finiteOrNull(c.confidence),
    breakdown: Array.isArray(c.breakdown) && c.breakdown.length ? c.breakdown : null,
    missing: false
  };
}

export function lastConsensusEvent(events) {
  if (!events || !events.length) return null;
  return events[events.length - 1];
}

export function pickCorrelation(corrRows, symbol, category) {
  if (!corrRows || !corrRows.length) {
    return { value: null, category: category || null };
  }
  const upper = String(symbol || '').toUpperCase();
  const bySymbol = corrRows.find((row) => {
    const keys = [row.symbol, row.asset, row.ticker, row.asset_id];
    return keys.some((key) => key && String(key).toUpperCase() === upper);
  });
  if (bySymbol) {
    return {
      value: finiteOrNull(bySymbol.corr ?? bySymbol.correlation ?? bySymbol.corr_30d ?? bySymbol.value),
      category: bySymbol.category || category || null
    };
  }
  if (category) {
    const byCat = corrRows.find((row) => (
      row.category && String(row.category).toLowerCase() === String(category).toLowerCase()
    ));
    if (byCat) {
      return {
        value: finiteOrNull(byCat.corr ?? byCat.correlation ?? byCat.corr_30d ?? byCat.value),
        category
      };
    }
  }
  return { value: null, category: category || null };
}

export function backtestStatusFromResult(result) {
  if (!result || result.error || !result.strategies) {
    return {
      status: 'missing',
      beatsBuyHold: null,
      beatsNaive: null,
      note: result && result.error ? result.error : 'missing'
    };
  }
  const consensus = result.strategies.consensus;
  const bh = result.baselines && finiteOrNull(result.baselines.buyAndHold && result.baselines.buyAndHold.totalReturn);
  const naive = result.baselines && finiteOrNull(result.baselines.naive && result.baselines.naive.totalReturn);
  const ret = consensus ? finiteOrNull(consensus.totalReturn) : null;
  return {
    status: 'available',
    beatsBuyHold: ret != null && bh != null ? ret > bh : null,
    beatsNaive: ret != null && naive != null ? ret > naive : null,
    note: result.dataSource || null
  };
}

export function emptyScannerRow(symbol, extras = {}) {
  const horizons = {};
  for (const h of SCANNER_HORIZONS) horizons[h] = emptyHorizonSlot();
  return {
    symbol: String(symbol || '').toUpperCase() || null,
    name: extras.name || null,
    assetClass: classifyAssetClass({ symbol, ...extras }),
    currentPrice: null,
    priceTimestamp: null,
    liquidity: {
      volume: null,
      ...dataFreshness(null)
    },
    horizons,
    flip: {
      lastFlipAt: null,
      lastFlipDirection: null,
      prior: null,
      next: null,
      isNew: false
    },
    consensus: emptyConsensus(),
    backtest: {
      status: 'missing',
      beatsBuyHold: null,
      beatsNaive: null,
      note: 'missing'
    },
    context: {
      etfNetFlowUsdMillions: null,
      oiContracts: null,
      correlationVsBtc: null,
      correlationCategory: extras.category || null
    },
    holdings: {
      real: false,
      tracking: false,
      trackingId: null,
      trackingStatus: null,
      badge: null
    },
    flipHistory: []
  };
}

export function buildScannerRow(input = {}) {
  const symbol = String(input.symbol || '').toUpperCase();
  const row = emptyScannerRow(symbol, input);
  if (!symbol) {
    row.symbol = null;
    return row;
  }

  const series = input.series || [];
  const last = lastKnownRow(series);
  const lastPrice = lastKnownClose(series);
  row.currentPrice = finiteOrNull(lastPrice);
  row.priceTimestamp = last && Number.isFinite(last.timestamp) ? last.timestamp : null;

  const lastVolume = last ? finiteOrNull(last.volume) : null;
  row.liquidity = {
    volume: lastVolume,
    ...dataFreshness(row.priceTimestamp, input.now)
  };

  const horizonInputs = input.horizons || {};
  for (const h of SCANNER_HORIZONS) {
    const forecast = horizonInputs[h] || horizonInputs[String(h)];
    if (forecast) {
      row.horizons[h] = modelHorizonFromForecast(forecast, row.currentPrice);
    }
  }

  row.consensus = consensusFromEvent(input.consensusEvent);
  row.backtest = input.backtest
    ? backtestStatusFromResult(input.backtest)
    : row.backtest;

  const ctx = input.context || {};
  row.context = {
    etfNetFlowUsdMillions: finiteOrNull(ctx.etfNetFlowUsdMillions ?? ctx.net_flow_usd_millions),
    oiContracts: finiteOrNull(ctx.oiContracts ?? ctx.oi),
    correlationVsBtc: finiteOrNull(ctx.correlationVsBtc ?? ctx.corr),
    correlationCategory: ctx.correlationCategory || ctx.category || null
  };

  if (input.name) row.name = input.name;
  if (input.assetClass) row.assetClass = classifyAssetClass(input);

  const history = Array.isArray(input.flipHistory) ? input.flipHistory.slice() : [];
  row.flipHistory = history;
  const latest = latestFlip(history);
  if (latest) {
    row.flip = {
      lastFlipAt: latest.at,
      lastFlipDirection: directionFamily(latest.next),
      prior: latest.prior,
      next: latest.next,
      isNew: isNewFlip(latest, input.now)
    };
  }

  if (input.holdings) {
    row.holdings = {
      real: Boolean(input.holdings.real),
      tracking: Boolean(input.holdings.tracking),
      trackingId: input.holdings.trackingId || null,
      trackingStatus: input.holdings.trackingStatus || null,
      badge: input.holdings.badge || null
    };
  }

  return row;
}

export function detectDirectionFlip(prior, next, at, source = 'direction') {
  if (prior == null || next == null || !Number.isFinite(at)) return null;
  const priorFam = directionFamily(prior);
  const nextFam = directionFamily(next);
  if (priorFam == null || nextFam == null) return null;
  if (priorFam === nextFam) return null;
  return {
    at,
    source,
    prior: String(prior).toUpperCase(),
    next: String(next).toUpperCase(),
    family: nextFam
  };
}

export function collectFlipHistory(states, source = 'direction') {
  const history = [];
  if (!states || !states.length) return history;
  let prev = null;
  for (const state of states) {
    if (!state || state.direction == null || !Number.isFinite(state.at)) continue;
    if (prev) {
      const flip = detectDirectionFlip(prev.direction, state.direction, state.at, source);
      if (flip) history.push(flip);
    }
    prev = state;
  }
  return history;
}

export function mergeFlipHistories(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    for (const item of list || []) {
      if (!item || !Number.isFinite(item.at)) continue;
      const key = `${item.at}|${item.source}|${item.prior}|${item.next}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  merged.sort((a, b) => a.at - b.at);
  return merged;
}

export function latestFlip(history) {
  if (!history || !history.length) return null;
  return history[history.length - 1];
}

export function isNewFlip(flip, now = Date.now()) {
  return Boolean(flip && Number.isFinite(flip.at) && Number.isFinite(now) && (now - flip.at) <= NEW_FLIP_MS);
}

export function appendFlipIfChanged(history, prior, next, at, source) {
  const flip = detectDirectionFlip(prior, next, at, source);
  if (!flip) return history ? history.slice() : [];
  return mergeFlipHistories(history, [flip]);
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
        const flipEvent = {
          at: flip.lastFlipAt,
          next: flip.next
        };
        if (!isNewFlip(flipEvent, now)) return false;
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
      const da = horizonDirection(a, horizon);
      const db = horizonDirection(b, horizon);
      cmp = compareNullable(da, db, dir);
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

function sliceAtOrBefore(series, timestamp) {
  if (!series || !series.length || !Number.isFinite(timestamp)) return [];
  return series.filter((row) => row && Number.isFinite(row.timestamp) && row.timestamp <= timestamp);
}

function closeAtOrAfter(series, timestamp) {
  if (!series || !series.length || !Number.isFinite(timestamp)) return null;
  for (const row of series) {
    if (row && Number.isFinite(row.timestamp) && row.timestamp >= timestamp && Number.isFinite(row.close)) {
      return { price: row.close, timestamp: row.timestamp };
    }
  }
  return null;
}

function forecastAtBaseline(seriesToBaseline, horizonDays) {
  if (!seriesToBaseline || seriesToBaseline.length === 0) {
    return { model: emptyHorizonSlot(), naive: null };
  }
  try {
    const forecast = generateForecast(seriesToBaseline, horizonDays);
    const lastPrice = lastKnownClose(seriesToBaseline);
    return {
      model: modelHorizonFromForecast(forecast, lastPrice),
      naive: forecast ? finiteOrNull(forecast.naive) : (naiveBaseline(seriesToBaseline, horizonDays) || {}).prediction
    };
  } catch {
    const naive = naiveBaseline(seriesToBaseline, horizonDays);
    return {
      model: emptyHorizonSlot(),
      naive: naive ? finiteOrNull(naive.prediction) : null
    };
  }
}

/**
 * Evaluation from a frozen tracking baseline. Lookahead-free: forecasts use
 * only bars at or before the baseline timestamp.
 */
export function evaluateTrackingFromBaseline(record, series, options = {}) {
  const now = options.now || Date.now();
  const baselinePrice = record ? finiteOrNull(record.baselinePrice) : null;
  const baselineTs = record
    ? (finiteOrNull(record.startedAt) ?? Date.parse(record.startDate))
    : null;

  const mark = record && record.status === 'stopped'
    ? finiteOrNull(record.stopPrice)
    : (options.markPrice != null ? finiteOrNull(options.markPrice) : lastKnownClose(series));

  let actualReturnPct = null;
  if (baselinePrice != null && baselinePrice !== 0 && mark != null) {
    actualReturnPct = (mark - baselinePrice) / baselinePrice;
  }

  const seriesToBaseline = Number.isFinite(baselineTs) ? sliceAtOrBefore(series, baselineTs) : [];
  const dayMs = 24 * 60 * 60 * 1000;
  const horizons = {};

  for (const h of SCANNER_HORIZONS) {
    const made = forecastAtBaseline(seriesToBaseline, h);
    const targetTs = Number.isFinite(baselineTs) ? baselineTs + h * dayMs : null;
    const actual = closeAtOrAfter(series, targetTs);
    const actualPrice = actual ? actual.price : null;
    const modelPred = made.model.prediction;
    const naivePred = made.naive;

    horizons[h] = {
      modelDirection: made.model.direction,
      modelConfidence: made.model.confidence,
      modelPrediction: modelPred,
      naivePrediction: naivePred,
      actualPrice,
      modelError: modelPred != null && actualPrice != null ? actualPrice - modelPred : null,
      naiveError: naivePred != null && actualPrice != null ? actualPrice - naivePred : null,
      modelAbsError: modelPred != null && actualPrice != null ? Math.abs(actualPrice - modelPred) : null,
      naiveAbsError: naivePred != null && actualPrice != null ? Math.abs(actualPrice - naivePred) : null
    };
  }

  return {
    badge: 'TRACKING',
    symbol: record ? record.symbol : null,
    status: record ? record.status : null,
    startDate: record ? record.startDate : null,
    baselinePrice,
    baselineTimestamp: Number.isFinite(baselineTs) ? baselineTs : null,
    markPrice: mark,
    actualReturnPct,
    evaluatedAt: now,
    horizons,
    history: record && Array.isArray(record.history) ? record.history : []
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
