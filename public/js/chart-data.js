export function lastKnownRow(rows) {
  const list = rows || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (Number.isFinite(list[i]?.close)) return list[i];
  }
  return null;
}

export function toUtcSeconds(timestamp) {
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

export function timeKey(time) {
  if (typeof time === 'number' && Number.isFinite(time)) return time;
  if (typeof time === 'string') {
    const suffix = time.length === 10 ? 'T00:00:00Z' : '';
    const ms = Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(time) || time.length === 10 ? `${time}${suffix}` : `${time}Z`);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  if (time && typeof time === 'object') {
    if (Number.isFinite(time.timestamp)) return time.timestamp;
    if (Number.isFinite(time.year) && Number.isFinite(time.month) && Number.isFinite(time.day)) {
      return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
    }
  }
  return null;
}

export function predictedToLine(points) {
  return dedupeSorted((points || []).map((point) => {
    if (!point || !Number.isFinite(point.timestamp)) return null;
    const time = toUtcSeconds(point.timestamp);
    if (!Number.isFinite(point.value)) return null;
    return { time, value: point.value };
  }).filter(Boolean));
}
