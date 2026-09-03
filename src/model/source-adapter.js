export const OVERLAP_BARS = 3;

export const INTERVAL_MS = {
  '1h': 3600000,
  '1d': 86400000
};

export function intervalMs(interval) {
  return INTERVAL_MS[interval] || INTERVAL_MS['1d'];
}

export function watermarkId(source, symbol, interval) {
  return `${source}:${String(symbol || '').toUpperCase()}:${interval}`;
}

export function seriesRowId(source, symbol, interval, timestamp) {
  return `${watermarkId(source, symbol, interval)}:${timestamp}`;
}

export function overlapSince(lastTimestamp, interval, overlapBars = OVERLAP_BARS) {
  if (lastTimestamp == null || !Number.isFinite(Number(lastTimestamp))) return null;
  return Number(lastTimestamp) - overlapBars * intervalMs(interval);
}

export function naturalKey(row) {
  return `${String(row.symbol || '').toUpperCase()}|${row.interval}|${row.timestamp}`;
}

export function upsertByNaturalKey(existing, incoming) {
  const map = new Map();
  for (const row of existing || []) {
    if (!row || row.timestamp == null) continue;
    map.set(naturalKey(row), row);
  }

  let inserted = 0;
  let updated = 0;
  for (const row of incoming || []) {
    if (!row || row.timestamp == null) continue;
    const key = naturalKey(row);
    if (map.has(key)) {
      map.set(key, { ...map.get(key), ...row });
      updated += 1;
    } else {
      map.set(key, row);
      inserted += 1;
    }
  }

  const rows = [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
  return { rows, inserted, updated, total: rows.length };
}

export function validateMonotonicAndGaps(rows, { source, symbol, interval } = {}) {
  const withTs = (rows || []).filter((row) => row && Number.isFinite(row.timestamp));
  const dropped = (rows || []).length - withTs.length;
  const issues = [];

  if (dropped > 0) {
    issues.push({
      type: 'missing_timestamp',
      source,
      symbol,
      interval,
      count: dropped,
      message: `Dropped ${dropped} row(s) with no timestamp. Missing bars were not invented.`
    });
  }

  const seen = new Set();
  const unique = [];
  for (const row of withTs) {
    const key = naturalKey(row);
    if (seen.has(key)) {
      issues.push({
        type: 'duplicate_timestamp',
        source,
        symbol,
        interval,
        timestamp: row.timestamp,
        message: `Duplicate ${symbol} ${interval} at ${row.timestamp}; upsert keeps one row.`
      });
      unique[unique.findIndex((item) => naturalKey(item) === key)] = row;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  const sorted = unique.sort((a, b) => a.timestamp - b.timestamp);
  const step = intervalMs(interval);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const delta = curr.timestamp - prev.timestamp;
    if (delta <= 0) {
      issues.push({
        type: 'not_monotonic',
        source,
        symbol,
        interval,
        from: prev.timestamp,
        to: curr.timestamp,
        message: `Timestamps are not strictly increasing at ${prev.timestamp} -> ${curr.timestamp}.`
      });
      continue;
    }
    if (delta > step * 1.5) {
      issues.push({
        type: 'gap',
        source,
        symbol,
        interval,
        from: prev.timestamp,
        to: curr.timestamp,
        missingMs: delta - step,
        message: `Gap between ${prev.timestamp} and ${curr.timestamp} (${delta}ms > ${step}ms). Not filled.`
      });
    }
  }

  return { rows: sorted, issues };
}

export function maxTimestamp(rows) {
  let max = null;
  for (const row of rows || []) {
    if (!row || !Number.isFinite(row.timestamp)) continue;
    if (max == null || row.timestamp > max) max = row.timestamp;
  }
  return max;
}

export function buildWatermarkRecord({
  source,
  symbol,
  interval,
  lastTimestamp,
  lastSuccessAt,
  rowCount,
  previous = null
}) {
  return {
    id: watermarkId(source, symbol, interval),
    source,
    symbol: String(symbol || '').toUpperCase(),
    interval,
    lastTimestamp: lastTimestamp != null ? lastTimestamp : (previous && previous.lastTimestamp) || null,
    lastSuccessAt,
    rowCount: rowCount != null ? rowCount : (previous && previous.rowCount) || 0
  };
}

export function describeAdapter(adapter) {
  return {
    id: adapter.id,
    symbol: adapter.symbol,
    interval: adapter.interval,
    mode: adapter.mode || 'incremental'
  };
}
