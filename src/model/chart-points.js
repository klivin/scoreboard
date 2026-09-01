function toUtcSeconds(timestamp) {
  return Math.floor(Number(timestamp) / 1000);
}

function dedupeSorted(points) {
  const byTime = new Map();
  for (const point of points) {
    if (!point || !Number.isFinite(point.time)) continue;
    byTime.set(point.time, point);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function toCandleData(rows) {
  const points = [];
  for (const row of rows || []) {
    if (!row || !Number.isFinite(row.timestamp)) continue;
    const time = toUtcSeconds(row.timestamp);
    const valid = [row.open, row.high, row.low, row.close].every(Number.isFinite);
    if (!valid) {
      continue;
    }
    points.push({
      time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close
    });
  }
  return dedupeSorted(points);
}

export function toLineData(rows, field) {
  const points = [];
  for (const row of rows || []) {
    if (!row || !Number.isFinite(row.timestamp)) continue;
    const time = toUtcSeconds(row.timestamp);
    const value = row[field];
    if (!Number.isFinite(value)) continue;
    points.push({ time, value });
  }
  return dedupeSorted(points);
}

export function toHistogramData(rows, field = 'volume') {
  const points = [];
  for (const row of rows || []) {
    if (!row || !Number.isFinite(row.timestamp)) continue;
    const time = toUtcSeconds(row.timestamp);
    const value = row[field];
    if (!Number.isFinite(value)) continue;
    points.push({ time, value });
  }
  return dedupeSorted(points);
}

export function hasZeroClose(points) {
  return (points || []).some((point) => point && point.close === 0);
}
