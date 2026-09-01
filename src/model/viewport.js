export const DEFAULT_VIEWPORT_DAYS = 5;

export function lastKnownRow(rows) {
  const list = rows || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (Number.isFinite(list[i]?.close)) return list[i];
  }
  return null;
}

export function lastKnownClose(rows) {
  const row = lastKnownRow(rows);
  return row ? row.close : null;
}

export function defaultVisibleRange(rows, days = DEFAULT_VIEWPORT_DAYS) {
  const last = lastKnownRow(rows);
  if (!last || !Number.isFinite(last.timestamp)) return null;
  const span = Math.max(1, Number(days) || DEFAULT_VIEWPORT_DAYS) * 24 * 60 * 60 * 1000;
  return {
    from: last.timestamp - span,
    to: last.timestamp
  };
}

export function defaultVisibleRangeSeconds(rows, days = DEFAULT_VIEWPORT_DAYS) {
  const range = defaultVisibleRange(rows, days);
  if (!range) return null;
  return {
    from: Math.floor(range.from / 1000),
    to: Math.floor(range.to / 1000)
  };
}
