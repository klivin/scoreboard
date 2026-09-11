/**
 * Watch / Track row math. Pure. Never invents prices.
 * % and in-zone stay missing when mark or start/target is missing.
 */

export function finiteOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeDirection(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['put', 'sell', 'short', 'bear', 'bearish'].includes(text)) return 'short';
  return 'long';
}

export function watchReturnPct({ startMark, mark, direction = 'long' } = {}) {
  const start = finiteOrNull(startMark);
  const live = finiteOrNull(mark);
  if (start == null || start === 0 || live == null) return null;
  const raw = (live - start) / start;
  return normalizeDirection(direction) === 'short' ? -raw : raw;
}

/**
 * Target zone for open vs close.
 * - Optional targetHigh: in-zone when mark is inside [min, max].
 * - Single target: long with no lot → buy zone at/below target (open);
 *   long with a real lot → sell zone at/above target (close);
 *   short is the inverse.
 * Missing mark or target → not in zone (never fake a hit).
 */
export function evaluateTargetZone({
  mark,
  target,
  targetHigh = null,
  direction = 'long',
  hasRealLot = false
} = {}) {
  const live = finiteOrNull(mark);
  const t0 = finiteOrNull(target);
  const t1 = finiteOrNull(targetHigh);
  if (live == null || t0 == null) {
    return { inZone: false, zone: null, badge: null };
  }

  const dir = normalizeDirection(direction);
  const zone = dir === 'long'
    ? (hasRealLot ? 'sell' : 'buy')
    : (hasRealLot ? 'buy' : 'sell');

  let hit = false;
  if (t1 != null && t1 !== t0) {
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    hit = live >= lo && live <= hi;
  } else if (dir === 'long') {
    hit = hasRealLot ? live >= t0 : live <= t0;
  } else {
    hit = hasRealLot ? live <= t0 : live >= t0;
  }

  return {
    inZone: hit,
    zone: hit ? zone : null,
    badge: hit ? `${zone} zone` : null
  };
}

export function resolveWatchEntry({ record, realPosition } = {}) {
  const realAvg = realPosition ? finiteOrNull(realPosition.averagePrice) : null;
  const realBasis = realPosition ? finiteOrNull(realPosition.costBasis) : null;
  const qty = realPosition ? finiteOrNull(realPosition.quantity) : null;
  if (realAvg != null) {
    return { entry: realAvg, entryKind: 'cost' };
  }
  if (realBasis != null && qty && qty !== 0) {
    return { entry: realBasis / qty, entryKind: 'cost' };
  }
  const start = record
    ? (finiteOrNull(record.baselinePrice) ?? finiteOrNull(record.startMark))
    : null;
  return { entry: start, entryKind: 'start' };
}

export function applyStartMarkFreeze(record, { liveMark = null, seriesStartClose = null } = {}) {
  if (!record || record.status === 'stopped') return record;
  if (finiteOrNull(record.baselinePrice) != null || finiteOrNull(record.startMark) != null) {
    return record;
  }
  const freeze = finiteOrNull(seriesStartClose) ?? finiteOrNull(liveMark);
  if (freeze == null) return record;
  return {
    ...record,
    startMark: freeze,
    baselinePrice: freeze
  };
}

export function sortWatchRows(rows) {
  return (rows || []).slice().sort((a, b) => {
    if (Boolean(a.inZone) !== Boolean(b.inZone)) return a.inZone ? -1 : 1;
    const aActive = a.status !== 'stopped';
    const bActive = b.status !== 'stopped';
    if (aActive !== bActive) return aActive ? -1 : 1;
    return String(a.symbol || '').localeCompare(String(b.symbol || ''));
  });
}

export function buildWatchRows({
  tracking = [],
  realPositions = [],
  markPrices = {}
} = {}) {
  const realBySymbol = {};
  for (const position of realPositions || []) {
    if (position && position.symbol) realBySymbol[position.symbol] = position;
  }

  const rows = (tracking || []).filter(Boolean).map((record) => {
    const symbol = record.symbol ? String(record.symbol).toUpperCase() : null;
    const real = symbol ? realBySymbol[symbol] : null;
    const mark = symbol && Object.prototype.hasOwnProperty.call(markPrices, symbol)
      ? finiteOrNull(markPrices[symbol])
      : null;
    const { entry, entryKind } = resolveWatchEntry({ record, realPosition: real });
    const direction = normalizeDirection(record.direction);
    const returnPct = watchReturnPct({ startMark: entry, mark, direction });
    const zone = evaluateTargetZone({
      mark,
      target: record.targetPrice,
      targetHigh: record.targetHigh,
      direction,
      hasRealLot: Boolean(real && finiteOrNull(real.quantity) > 0)
    });

    return {
      id: record.id,
      symbol,
      startDate: record.startDate || null,
      entry,
      entryKind,
      mark,
      returnPct,
      target: finiteOrNull(record.targetPrice),
      targetHigh: finiteOrNull(record.targetHigh),
      direction,
      inZone: zone.inZone,
      zone: zone.zone,
      zoneBadge: zone.badge,
      status: record.status || 'active',
      badge: 'TRACKING',
      hasRealLot: Boolean(real && finiteOrNull(real.quantity) > 0)
    };
  });

  return sortWatchRows(rows);
}

export function collectWatchSymbols({ tracking = [], realPositions = [] } = {}) {
  const symbols = new Set();
  for (const record of tracking || []) {
    if (record && record.symbol) symbols.add(String(record.symbol).toUpperCase());
  }
  for (const position of realPositions || []) {
    if (position && position.symbol) symbols.add(String(position.symbol).toUpperCase());
  }
  return [...symbols];
}
