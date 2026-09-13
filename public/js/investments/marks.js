/**
 * Live marks from the same Overview ingest path (Yahoo equities / OKX crypto).
 * Never invents a price. Missing series → missing mark.
 */

import { refreshAssetClassParam, resolveMarkTarget } from './instrument.js';

function finiteClose(row) {
  if (!row || row.close === undefined || row.close === null || row.close === '') return null;
  const close = Number(row.close);
  return Number.isFinite(close) ? close : null;
}

function rowDateUtc(row) {
  if (!row) return null;
  if (row.date_utc) return String(row.date_utc).slice(0, 10);
  if (Number.isFinite(row.timestamp)) return new Date(row.timestamp).toISOString().slice(0, 10);
  return null;
}

export function lastFiniteClose(series) {
  if (!Array.isArray(series)) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const row = series[i];
    const close = finiteClose(row);
    if (close == null) continue;
    const dateUtc = rowDateUtc(row);
    return {
      close,
      timestamp: Number.isFinite(row.timestamp) ? row.timestamp : null,
      dateUtc
    };
  }
  return null;
}

export function closeOnOrBeforeDate(series, dateUtc) {
  if (!Array.isArray(series) || !dateUtc) return null;
  let found = null;
  for (const row of series) {
    const close = finiteClose(row);
    if (close == null) continue;
    const rowDate = rowDateUtc(row);
    if (!rowDate || rowDate > dateUtc) continue;
    found = {
      close,
      timestamp: Number.isFinite(row.timestamp) ? row.timestamp : null,
      dateUtc: rowDate
    };
  }
  return found;
}

export function markFromIndicatorsPayload(payload) {
  if (!payload || payload.error) return null;
  return lastFiniteClose(payload.data || payload.indicators || []);
}

function missingResult(symbol, assetClass, error) {
  return {
    symbol: symbol || null,
    markSymbol: symbol || null,
    assetClass: assetClass || null,
    mark: null,
    startClose: null,
    asOf: null,
    lastDateUtc: null,
    timestamp: null,
    series: [],
    source: null,
    sourceLabel: null,
    error: error || 'missing'
  };
}

/**
 * Same path as Overview Load Data: POST /api/refresh?symbol=&assetClass= then GET /api/indicators.
 * ETF/equity → Yahoo. Crypto → OKX. Unresolved coin-as-ETF does not fetch spot.
 */
export async function fetchSymbolMark(symbol, options = {}) {
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const interval = options.interval || '1d';
  const startDate = options.startDate || null;
  const target = resolveMarkTarget({
    symbol,
    assetClass: options.assetClass,
    yahooTicker: options.yahooTicker,
    markSymbol: options.markSymbol,
    needsInstrumentClass: options.needsInstrumentClass
  });
  const markSymbol = target.markSymbol || String(symbol || '').trim().toUpperCase();
  if (!markSymbol || !fetchImpl) {
    return missingResult(markSymbol, target.assetClass, 'missing');
  }
  if (!target.ok || target.unresolved) {
    return missingResult(markSymbol, target.assetClass, 'pick venue — coin spot not used');
  }

  const refreshParams = new URLSearchParams({ symbol: markSymbol, interval });
  const cls = refreshAssetClassParam(target.assetClass);
  if (cls) refreshParams.set('assetClass', cls);

  let refreshMeta = {};
  try {
    const refreshResponse = await fetchImpl(`/api/refresh?${refreshParams.toString()}`, { method: 'POST' });
    refreshMeta = await refreshResponse.json().catch(() => ({}));
  } catch {
    // Refresh failure still tries cached indicators; do not invent.
  }

  try {
    const indicatorParams = new URLSearchParams({
      symbol: markSymbol,
      interval
    });
    const response = await fetchImpl(`/api/indicators?${indicatorParams.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      return missingResult(markSymbol, target.assetClass, payload.error || `No data for ${markSymbol}`);
    }
    const series = Array.isArray(payload.data) ? payload.data : [];
    const last = lastFiniteClose(series);
    const start = startDate ? closeOnOrBeforeDate(series, startDate) : null;
    return {
      symbol: markSymbol,
      markSymbol,
      assetClass: target.assetClass,
      adapter: target.adapter,
      mark: last ? last.close : null,
      startClose: start ? start.close : null,
      asOf: last ? last.dateUtc : null,
      lastDateUtc: last ? last.dateUtc : null,
      timestamp: last ? last.timestamp : null,
      series,
      source: refreshMeta.filledSource || refreshMeta.sourceLabel || null,
      sourceLabel: refreshMeta.sourceLabel || refreshMeta.filledSource || null,
      venue: refreshMeta.venue || target.assetClass,
      error: last ? null : 'missing'
    };
  } catch (error) {
    return missingResult(
      markSymbol,
      target.assetClass,
      error && error.message ? error.message : 'missing'
    );
  }
}

export async function fetchMarksForSymbols(symbols, options = {}) {
  const marks = {};
  const startCloses = {};
  const errors = {};
  const meta = {};
  for (const symbol of symbols || []) {
    const result = await fetchSymbolMark(symbol, options);
    const key = result.markSymbol || result.symbol;
    if (Number.isFinite(result.mark)) marks[key] = result.mark;
    if (Number.isFinite(result.startClose)) startCloses[key] = result.startClose;
    if (result.error) errors[key] = result.error;
    if (result.asOf || result.timestamp || result.sourceLabel) {
      meta[key] = {
        dateUtc: result.asOf,
        timestamp: result.timestamp,
        asOf: result.asOf,
        source: result.source || result.sourceLabel || null,
        sourceLabel: result.sourceLabel || result.source || null,
        venue: result.venue || result.assetClass || null
      };
    }
  }
  return { marks, startCloses, errors, meta };
}

export async function fetchMarksForTargets(targets, options = {}) {
  const marks = {};
  const startCloses = {};
  const errors = {};
  const meta = {};
  for (const target of targets || []) {
    const result = await fetchSymbolMark(target.markSymbol || target.symbol, {
      ...options,
      assetClass: target.assetClass,
      markSymbol: target.markSymbol || target.symbol,
      startDate: target.startDate || options.startDate || null
    });
    const key = result.markSymbol || result.symbol;
    if (Number.isFinite(result.mark)) marks[key] = result.mark;
    if (Number.isFinite(result.startClose)) startCloses[key] = result.startClose;
    if (result.error) errors[key] = result.error;
    if (result.asOf || result.timestamp || result.sourceLabel) {
      meta[key] = {
        dateUtc: result.asOf,
        timestamp: result.timestamp,
        asOf: result.asOf,
        source: result.source || result.sourceLabel || null,
        sourceLabel: result.sourceLabel || result.source || null,
        venue: result.venue || result.assetClass || null
      };
    }
  }
  return { marks, startCloses, errors, meta };
}
