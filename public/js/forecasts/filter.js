function upperSymbol(value) {
  return value ? String(value).toUpperCase() : null;
}

/**
 * REAL symbols come from imported events.
 * TRACKING symbols come from paper trades and start/stop tracking records.
 */
export function holdingsSymbolsFromInvestments(state) {
  const real = new Set();
  const tracking = new Set();
  const collections = state && state.collections ? state.collections : null;

  if (!collections) {
    return { real: [], tracking: [], active: false };
  }

  for (const event of collections.events || []) {
    const symbol = upperSymbol(event && event.symbol);
    if (symbol) real.add(symbol);
  }
  for (const trade of collections.paperTrades || []) {
    const symbol = upperSymbol(trade && trade.symbol);
    if (symbol) tracking.add(symbol);
  }
  for (const row of collections.tracking || []) {
    const symbol = upperSymbol(row && row.symbol);
    if (symbol) tracking.add(symbol);
  }

  return {
    real: [...real],
    tracking: [...tracking],
    active: real.size > 0 || tracking.size > 0
  };
}

export function investmentsStoreIsEmpty(state) {
  const holdings = holdingsSymbolsFromInvestments(state);
  return !holdings.active;
}

/**
 * Filter scored forecasts by holdings badge and horizon.
 * When the Investments store has no REAL or TRACKING symbols, holdings
 * filters are inactive and every forecast is returned (with a note).
 */
export function filterForecasts(forecasts, options = {}) {
  const holdingsFilter = options.holdingsFilter || 'all';
  const horizonFilter = options.horizonFilter || 'all';
  const holdings = holdingsSymbolsFromInvestments(options.investmentsState);
  const filterInactive = (holdingsFilter === 'REAL' || holdingsFilter === 'TRACKING') && !holdings.active;

  let rows = Array.isArray(forecasts) ? forecasts.slice() : [];

  if ((holdingsFilter === 'REAL' || holdingsFilter === 'TRACKING') && holdings.active) {
    const allowed = new Set(holdingsFilter === 'REAL' ? holdings.real : holdings.tracking);
    rows = rows.filter((row) => allowed.has(upperSymbol(row && row.symbol)));
  }

  if (horizonFilter === 'weekly' || horizonFilter === 'monthly') {
    rows = rows.filter((row) => row && row.horizon === horizonFilter);
  }

  return {
    rows,
    holdings,
    filterInactive,
    note: filterInactive
      ? 'Holdings filter inactive — Investments store (scoreboard.investments) is empty. Showing all forecasts.'
      : null
  };
}
