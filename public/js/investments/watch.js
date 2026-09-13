/**
 * Watch / Track row math. Pure. Never invents prices.
 * % and in-zone stay missing when mark or start/target is missing.
 */

import {
  defaultInstrumentClass,
  formatInstrumentLabel,
  markSymbolFor,
  normalizeInstrumentClass,
  resolveMarkTarget,
  sameInstrument,
  venueHint
} from './instrument.js';

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
    return { inZone: false, zone: null, badge: null, pending: true };
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
    badge: hit ? `${zone} zone` : null,
    pending: false,
    intended: `${zone} zone`
  };
}

function sortFills(fills = []) {
  return (fills || []).slice().sort((a, b) => {
    const da = String(a.date || a.activityDate || '');
    const db = String(b.date || b.activityDate || '');
    if (da !== db) return da < db ? -1 : 1;
    return Number(a.createdAt || 0) - Number(b.createdAt || 0);
  });
}

export function isSellFill(fill) {
  const side = String((fill && (fill.side || fill.activityType)) || '').toUpperCase();
  return side === 'SELL' || side === 'SOLD';
}

export function isBuyFill(fill) {
  const side = String((fill && (fill.side || fill.activityType)) || '').toUpperCase();
  return side === 'BUY' || side === 'BOUGHT' || side === '';
}

/**
 * Remaining open lot after fills. FIFO by default (same as REAL P&L).
 * Average-cost remaining when costMethod === 'average'.
 */
export function fillLotState(fills = [], { costMethod = 'fifo' } = {}) {
  const ordered = sortFills(fills);
  if (costMethod === 'average') {
    let qty = 0;
    let basis = 0;
    for (const fill of ordered) {
      const q = Math.abs(finiteOrNull(fill.quantity) ?? 0);
      const p = finiteOrNull(fill.price);
      if (q <= 0) continue;
      if (!isSellFill(fill)) {
        qty += q;
        if (p != null) basis += q * p;
      } else if (qty > 0) {
        const avg = basis / qty;
        const take = Math.min(q, qty);
        qty -= take;
        basis -= avg * take;
        if (qty <= 1e-12) {
          qty = 0;
          basis = 0;
        }
      }
    }
    return {
      quantity: qty,
      costBasis: qty > 0 ? basis : null,
      averagePrice: qty > 0 ? basis / qty : null,
      hasLot: qty > 1e-12
    };
  }

  const lots = [];
  for (const fill of ordered) {
    const q = Math.abs(finiteOrNull(fill.quantity) ?? 0);
    const p = finiteOrNull(fill.price);
    if (q <= 0) continue;
    if (!isSellFill(fill)) {
      lots.push({ qty: q, price: p, fillId: fill.id || null });
    } else {
      let remaining = q;
      while (remaining > 0 && lots.length) {
        const lot = lots[0];
        const take = Math.min(lot.qty, remaining);
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 1e-12) lots.shift();
      }
    }
  }

  const qty = lots.reduce((sum, lot) => sum + lot.qty, 0);
  const basis = lots.reduce((sum, lot) => (
    finiteOrNull(lot.price) == null ? sum : sum + lot.qty * lot.price
  ), 0);
  return {
    quantity: qty,
    costBasis: qty > 0 ? basis : null,
    averagePrice: qty > 0 ? basis / qty : null,
    hasLot: qty > 1e-12
  };
}

/**
 * Typo-fix remaining unit cost by scaling BUY fill prices so remaining
 * average equals newAverage. Does not lock Entry — later fills recompute.
 */
export function scaleBuyFillPrices(fills = [], newAverage, { costMethod = 'fifo' } = {}) {
  const target = finiteOrNull(newAverage);
  const lot = fillLotState(fills, { costMethod });
  if (target == null || !lot.hasLot || !Number.isFinite(lot.averagePrice) || lot.averagePrice === 0) {
    return { fills: (fills || []).slice(), scale: 1, ok: false };
  }
  const scale = target / lot.averagePrice;
  const next = (fills || []).map((fill) => {
    if (isSellFill(fill) || finiteOrNull(fill.price) == null) return { ...fill };
    return { ...fill, price: fill.price * scale };
  });
  const after = fillLotState(next, { costMethod });
  const drift = after.hasLot && Number.isFinite(after.averagePrice)
    ? target - after.averagePrice
    : 0;
  if (drift !== 0 && after.quantity) {
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const fill = next[i];
      const qty = Math.abs(finiteOrNull(fill.quantity) ?? 0);
      if (isSellFill(fill) || finiteOrNull(fill.price) == null || qty <= 0) continue;
      next[i] = { ...fill, price: fill.price + (drift * after.quantity) / qty };
      break;
    }
  }
  return { fills: next, scale, ok: true };
}

export function eventToFill(event) {
  if (!event) return null;
  const type = String(event.activityType || event.side || '').toLowerCase();
  if (type !== 'buy' && type !== 'sell') return null;
  if (!Number.isFinite(event.price)) return null;
  const qty = finiteOrNull(event.quantity);
  return {
    id: event.id,
    side: type === 'sell' ? 'SELL' : 'BUY',
    date: event.activityDate || event.date || null,
    quantity: qty == null ? 1 : qty,
    price: event.price,
    source: event.source || 'import',
    createdAt: event.createdAt || 0
  };
}

export function collectInstrumentFills(record, events = []) {
  const fromRecord = Array.isArray(record && record.fills) ? record.fills.slice() : [];
  const fromEvents = (events || [])
    .filter((event) => sameInstrument(event, record))
    .map(eventToFill)
    .filter(Boolean);
  return [...fromEvents, ...fromRecord];
}

export function fillVsMark(fill, mark) {
  const price = finiteOrNull(fill && fill.price);
  const live = finiteOrNull(mark);
  const qty = finiteOrNull(fill && fill.quantity);
  if (price == null || live == null) {
    return { dollar: null, pct: null };
  }
  const qtyUse = qty == null ? 1 : qty;
  return {
    dollar: (live - price) * qtyUse,
    pct: price === 0 ? null : (live - price) / price
  };
}

export function resolveWatchEntry({ record, realPosition, lot = null } = {}) {
  if (lot && lot.hasLot && finiteOrNull(lot.averagePrice) != null) {
    return {
      entry: lot.averagePrice,
      entryKind: 'cost',
      costBasis: finiteOrNull(lot.costBasis)
    };
  }
  const realAvg = realPosition ? finiteOrNull(realPosition.averagePrice) : null;
  const realBasis = realPosition ? finiteOrNull(realPosition.costBasis) : null;
  const qty = realPosition ? finiteOrNull(realPosition.quantity) : null;
  if (realAvg != null) {
    return { entry: realAvg, entryKind: 'cost', costBasis: realBasis };
  }
  if (realBasis != null && qty && qty !== 0) {
    return { entry: realBasis / qty, entryKind: 'cost', costBasis: realBasis };
  }
  if (record && finiteOrNull(record.entryOverride) != null) {
    return { entry: finiteOrNull(record.entryOverride), entryKind: 'cost', costBasis: null };
  }
  const start = record
    ? (finiteOrNull(record.baselinePrice) ?? finiteOrNull(record.startMark))
    : null;
  return { entry: start, entryKind: 'start', costBasis: null };
}

export function remainingUnrealized({ mark, lot = null, entry = null, direction = 'long' } = {}) {
  const live = finiteOrNull(mark);
  const qty = lot && lot.hasLot ? finiteOrNull(lot.quantity) : null;
  const basis = lot && lot.hasLot
    ? finiteOrNull(lot.costBasis)
    : null;
  const unit = finiteOrNull(entry) ?? (lot ? finiteOrNull(lot.averagePrice) : null);
  if (live == null || qty == null || qty === 0) {
    return { unrealizedPnl: null, unrealizedPct: null };
  }
  const dollar = basis != null
    ? (live * qty) - basis
    : (unit != null ? (live - unit) * qty : null);
  if (dollar == null) return { unrealizedPnl: null, unrealizedPct: null };
  const signed = normalizeDirection(direction) === 'short' ? -dollar : dollar;
  const denom = basis != null ? basis : (unit != null ? unit * qty : null);
  return {
    unrealizedPnl: signed,
    unrealizedPct: denom && denom !== 0 ? signed / denom : null
  };
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
    return String(a.displaySymbol || a.symbol || '').localeCompare(String(b.displaySymbol || b.symbol || ''));
  });
}

function lookupMark(markPrices, record) {
  if (!markPrices || record && record.needsInstrumentClass) return null;
  const markSymbol = markSymbolFor(record);
  const cls = normalizeInstrumentClass(record.assetClass);
  if (markSymbol && Object.prototype.hasOwnProperty.call(markPrices, markSymbol)) {
    if ((cls === 'etf' || cls === 'equity') && isAmbiguousCoin(markSymbol)) return null;
    return finiteOrNull(markPrices[markSymbol]);
  }
  if (record && record.symbol && Object.prototype.hasOwnProperty.call(markPrices, record.symbol)) {
    if (cls !== 'crypto') return null;
    return finiteOrNull(markPrices[record.symbol]);
  }
  return null;
}

function isAmbiguousCoin(symbol) {
  const upper = String(symbol || '').trim().toUpperCase();
  return upper === 'BTC' || upper === 'ETH';
}

function lookupMeta(markMeta, record) {
  if (!markMeta) return null;
  const markSymbol = markSymbolFor(record);
  return (markSymbol && markMeta[markSymbol]) || (record.symbol && markMeta[record.symbol]) || null;
}

function matchingPosition(realPositions, record) {
  return (realPositions || []).find((position) => sameInstrument(position, record)) || null;
}

function decorateFills(fills, mark) {
  return (fills || []).map((fill) => {
    const vs = fillVsMark(fill, mark);
    return {
      ...fill,
      vsDollar: vs.dollar,
      vsPct: vs.pct
    };
  });
}

export function buildWatchRow(record, {
  realPositions = [],
  markPrices = {},
  markMeta = {},
  events = [],
  costMethod = 'fifo'
} = {}) {
  const assetClass = record.needsInstrumentClass
    ? null
    : (normalizeInstrumentClass(record.assetClass) || defaultInstrumentClass(record.symbol));
  const enriched = { ...record, assetClass, markSymbol: markSymbolFor({ ...record, assetClass }) };
  const real = matchingPosition(realPositions, enriched);
  const fills = collectInstrumentFills(enriched, events);
  const lot = fillLotState(fills, { costMethod });
  const hasLot = lot.hasLot || Boolean(real && finiteOrNull(real.quantity) > 0);
  const mark = lookupMark(markPrices, enriched);
  const meta = lookupMeta(markMeta, enriched);
  const { entry, entryKind, costBasis } = resolveWatchEntry({ record: enriched, realPosition: real, lot });
  const direction = normalizeDirection(record.direction);
  const returnPct = watchReturnPct({ startMark: entry, mark, direction });
  const vsLive = remainingUnrealized({ mark, lot: lot.hasLot ? lot : null, entry, direction });
  const zone = evaluateTargetZone({
    mark,
    target: record.targetPrice,
    targetHigh: record.targetHigh,
    direction,
    hasRealLot: hasLot
  });
  const target = resolveMarkTarget(enriched);

  return {
    id: record.id,
    symbol: enriched.symbol,
    displaySymbol: target.markSymbol || enriched.symbol,
    listedSymbol: record.listedSymbol || record.symbol,
    assetClass,
    yahooTicker: record.yahooTicker || null,
    markSymbol: enriched.markSymbol,
    venue: venueHint(assetClass),
    label: formatInstrumentLabel(enriched),
    startDate: record.startDate || null,
    entry,
    entryKind,
    costBasis: costBasis ?? (lot.hasLot ? lot.costBasis : (real ? real.costBasis : null)),
    mark,
    markAsOf: meta && (meta.dateUtc || meta.asOf) || null,
    markSource: meta && (meta.sourceLabel || meta.source) || null,
    markAsOfTs: meta && meta.timestamp ? meta.timestamp : null,
    returnPct: vsLive.unrealizedPct != null ? vsLive.unrealizedPct : returnPct,
    unrealizedPnl: vsLive.unrealizedPnl,
    target: finiteOrNull(record.targetPrice),
    targetHigh: finiteOrNull(record.targetHigh),
    direction,
    inZone: zone.inZone,
    zone: zone.zone,
    zoneBadge: zone.badge,
    zonePending: zone.pending,
    status: record.status || 'active',
    hasRealLot: hasLot,
    lotQty: lot.hasLot ? lot.quantity : (real ? real.quantity : null),
    needsInstrumentClass: Boolean(record.needsInstrumentClass) || target.unresolved,
    fills: decorateFills(fills, mark),
    adapter: target.adapter,
    canRemove: true
  };
}

export function buildWatchRows({
  tracking = [],
  realPositions = [],
  markPrices = {},
  markMeta = {},
  events = [],
  costMethod = 'fifo'
} = {}) {
  const rows = (tracking || []).filter(Boolean).map((record) => buildWatchRow(record, {
    realPositions,
    markPrices,
    markMeta,
    events,
    costMethod
  }));

  for (const position of realPositions || []) {
    if (!position || !position.symbol) continue;
    const covered = rows.some((row) => sameInstrument(row, position));
    if (covered) continue;
    const assetClass = normalizeInstrumentClass(position.assetClass)
      || defaultInstrumentClass(position.symbol);
    const synthetic = {
      id: `real_${assetClass}_${position.symbol}`,
      symbol: position.symbol,
      listedSymbol: position.listedSymbol || position.symbol,
      assetClass,
      yahooTicker: position.yahooTicker || (assetClass === 'etf' ? position.symbol : null),
      markSymbol: markSymbolFor({ ...position, assetClass }),
      needsInstrumentClass: Boolean(position.needsInstrumentClass),
      startDate: position.openDate || null,
      baselinePrice: finiteOrNull(position.averagePrice),
      startMark: finiteOrNull(position.averagePrice),
      targetPrice: null,
      targetHigh: null,
      direction: 'long',
      status: 'active',
      source: 'import',
      fills: []
    };
    rows.push(buildWatchRow(synthetic, {
      realPositions,
      markPrices,
      markMeta,
      events,
      costMethod
    }));
  }

  return sortWatchRows(rows);
}

export function collectWatchTargets({ tracking = [], realPositions = [] } = {}) {
  const seen = new Set();
  const targets = [];
  const push = (record) => {
    const target = resolveMarkTarget(record);
    if (!target.ok || target.unresolved || !target.markSymbol) return;
    const key = `${target.assetClass}:${target.markSymbol}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({
      symbol: target.markSymbol,
      markSymbol: target.markSymbol,
      assetClass: target.assetClass,
      adapter: target.adapter,
      startDate: record.startDate || null
    });
  };
  for (const record of tracking || []) push(record);
  for (const position of realPositions || []) push(position);
  return targets;
}

export { formatInstrumentLabel, markSymbolFor, sameInstrument, resolveMarkTarget };
