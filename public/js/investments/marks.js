/**
 * Live marks from the same Overview ingest path (Yahoo equities / OKX crypto).
 * Never invents a price. Missing series → missing mark.
 */

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

/**
 * Same path as Overview Load Data: POST /api/refresh?symbol= then GET /api/indicators.
 * Returns { symbol, mark, startClose, series, error } — mark is null when the source has no close.
 */
export async function fetchSymbolMark(symbol, options = {}) {
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const interval = options.interval || '1d';
  const startDate = options.startDate || null;
  const upper = String(symbol || '').trim().toUpperCase();
  if (!upper || !fetchImpl) {
    return { symbol: upper || null, mark: null, startClose: null, series: [], error: 'missing' };
  }

  try {
    await fetchImpl(`/api/refresh?symbol=${encodeURIComponent(upper)}`, { method: 'POST' });
  } catch {
    // Refresh failure still tries cached indicators; do not invent.
  }

  try {
    const response = await fetchImpl(
      `/api/indicators?symbol=${encodeURIComponent(upper)}&interval=${encodeURIComponent(interval)}`
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      return {
        symbol: upper,
        mark: null,
        startClose: null,
        series: [],
        error: payload.error || `No data for ${upper}`
      };
    }
    const series = Array.isArray(payload.data) ? payload.data : [];
    const last = lastFiniteClose(series);
    const start = startDate ? closeOnOrBeforeDate(series, startDate) : null;
    return {
      symbol: upper,
      mark: last ? last.close : null,
      startClose: start ? start.close : null,
      lastDateUtc: last ? last.dateUtc : null,
      series,
      error: last ? null : 'missing'
    };
  } catch (error) {
    return {
      symbol: upper,
      mark: null,
      startClose: null,
      series: [],
      error: error && error.message ? error.message : 'missing'
    };
  }
}

export async function fetchMarksForSymbols(symbols, options = {}) {
  const marks = {};
  const startCloses = {};
  const errors = {};
  for (const symbol of symbols || []) {
    const result = await fetchSymbolMark(symbol, options);
    if (Number.isFinite(result.mark)) marks[result.symbol] = result.mark;
    if (Number.isFinite(result.startClose)) startCloses[result.symbol] = result.startClose;
    if (result.error) errors[result.symbol] = result.error;
  }
  return { marks, startCloses, errors };
}
