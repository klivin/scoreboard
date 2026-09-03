const FILL_TYPES = new Set(['buy', 'sell']);

function sortEvents(events) {
  return (events || []).slice().sort((a, b) => {
    const da = a.activityDate || a.transactionDate || '';
    const db = b.activityDate || b.transactionDate || '';
    if (da !== db) return da < db ? -1 : 1;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function missingMetric() {
  return null;
}

function addFinite(current, delta) {
  if (!Number.isFinite(delta)) return current;
  if (!Number.isFinite(current)) return delta;
  return current + delta;
}

function cloneLot(lot) {
  return { ...lot };
}

function processFifo(symbolState, event) {
  const qty = Math.abs(event.quantity);
  const price = event.price;
  const fee = Number.isFinite(event.commission) ? event.commission : 0;
  const closed = [];

  if (event.activityType === 'buy') {
    symbolState.lots.push({
      qty,
      remaining: qty,
      price,
      fees: fee,
      date: event.activityDate,
      source: event.source,
      eventId: event.id
    });
    return { closed, realized: 0, fees: fee };
  }

  let remaining = qty;
  let realized = 0;
  let allocatedFees = 0;
  while (remaining > 0 && symbolState.lots.length > 0) {
    const lot = symbolState.lots[0];
    const take = Math.min(lot.remaining, remaining);
    const lotFeeShare = lot.remaining > 0 ? (lot.fees * take) / lot.qty : 0;
    const sellFeeShare = qty > 0 ? (fee * take) / qty : 0;
    const pnl = (price - lot.price) * take - lotFeeShare - sellFeeShare;
    realized += pnl;
    allocatedFees += lotFeeShare + sellFeeShare;
    closed.push({
      qty: take,
      buyPrice: lot.price,
      sellPrice: price,
      realized: pnl,
      buyDate: lot.date,
      sellDate: event.activityDate,
      eventId: event.id
    });
    lot.remaining -= take;
    remaining -= take;
    if (lot.remaining <= 1e-12) symbolState.lots.shift();
  }

  return {
    closed,
    realized,
    fees: allocatedFees,
    unmatchedSell: remaining > 1e-12 ? remaining : 0
  };
}

function processAverage(symbolState, event) {
  const qty = Math.abs(event.quantity);
  const price = event.price;
  const fee = Number.isFinite(event.commission) ? event.commission : 0;

  if (event.activityType === 'buy') {
    const existingQty = symbolState.avgQty || 0;
    const existingCost = symbolState.avgCost || 0;
    const newQty = existingQty + qty;
    const newCost = existingCost + (price * qty) + fee;
    symbolState.avgQty = newQty;
    symbolState.avgCost = newCost;
    symbolState.avgPrice = newQty > 0 ? newCost / newQty : null;
    symbolState.lots = newQty > 0
      ? [{
        qty: newQty,
        remaining: newQty,
        price: symbolState.avgPrice,
        fees: 0,
        date: event.activityDate,
        source: event.source,
        eventId: event.id
      }]
      : [];
    return { closed: [], realized: 0, fees: fee };
  }

  const avgPrice = symbolState.avgPrice;
  if (!Number.isFinite(avgPrice) || !symbolState.avgQty) {
    return { closed: [], realized: 0, fees: fee, unmatchedSell: qty };
  }
  const take = Math.min(symbolState.avgQty, qty);
  const realized = (price - avgPrice) * take - fee;
  symbolState.avgQty -= take;
  symbolState.avgCost = symbolState.avgQty * avgPrice;
  symbolState.lots = symbolState.avgQty > 0
    ? [{
      qty: symbolState.avgQty,
      remaining: symbolState.avgQty,
      price: avgPrice,
      fees: 0,
      date: event.activityDate,
      source: event.source,
      eventId: event.id
    }]
    : [];
  return {
    closed: [{
      qty: take,
      buyPrice: avgPrice,
      sellPrice: price,
      realized,
      sellDate: event.activityDate,
      eventId: event.id
    }],
    realized,
    fees: fee,
    unmatchedSell: qty - take > 1e-12 ? qty - take : 0
  };
}

function emptyBucket() {
  return {
    positions: [],
    skipped: [],
    dividends: [],
    fees: [],
    realizedPnl: null,
    unrealizedPnl: null,
    costBasis: null,
    dividendsTotal: null,
    returnPct: null,
    drawdownPct: null,
    peakEquity: null,
    closedLots: [],
    equityPoints: []
  };
}

function finalizeBucket(symbols, extras, markPrices) {
  const positions = [];
  let costBasis = null;
  let unrealized = null;
  let dividendsTotal = null;

  for (const [symbol, state] of Object.entries(symbols)) {
    const remainingLots = state.lots.filter((lot) => lot.remaining > 1e-12).map(cloneLot);
    const qty = remainingLots.reduce((sum, lot) => sum + lot.remaining, 0);
    const basis = remainingLots.reduce((sum, lot) => sum + lot.remaining * lot.price, 0);
    const mark = markPrices && Object.prototype.hasOwnProperty.call(markPrices, symbol)
      ? markPrices[symbol]
      : null;
    const positionUnrealized = Number.isFinite(mark) && qty > 0
      ? remainingLots.reduce((sum, lot) => sum + (mark - lot.price) * lot.remaining, 0)
      : null;

    if (qty > 0) {
      positions.push({
        symbol,
        quantity: qty,
        costBasis: Number.isFinite(basis) ? basis : missingMetric(),
        averagePrice: qty > 0 && Number.isFinite(basis) ? basis / qty : missingMetric(),
        markPrice: Number.isFinite(mark) ? mark : missingMetric(),
        unrealizedPnl: positionUnrealized,
        lots: remainingLots
      });
      costBasis = addFinite(costBasis, basis);
      if (positionUnrealized != null) {
        unrealized = addFinite(unrealized, positionUnrealized);
      }
    }
  }

  for (const div of extras.dividends) {
    if (Number.isFinite(div.amount)) {
      dividendsTotal = addFinite(dividendsTotal, div.amount);
    }
  }

  const realized = extras.realizedAcc;
  const numerParts = [realized, unrealized, dividendsTotal].filter((v) => Number.isFinite(v));
  const returnPct = Number.isFinite(costBasis) && costBasis !== 0 && numerParts.length
    ? numerParts.reduce((a, b) => a + b, 0) / costBasis
    : missingMetric();

  let peak = null;
  let maxDd = null;
  for (const point of extras.equityPoints) {
    if (!Number.isFinite(point.equity)) continue;
    if (!Number.isFinite(peak) || point.equity > peak) peak = point.equity;
    if (Number.isFinite(peak) && peak !== 0) {
      const dd = (peak - point.equity) / peak;
      if (!Number.isFinite(maxDd) || dd > maxDd) maxDd = dd;
    }
  }

  return {
    positions,
    skipped: extras.skipped,
    dividends: extras.dividends,
    fees: extras.fees,
    realizedPnl: extras.realizedAcc,
    unrealizedPnl: unrealized,
    costBasis,
    dividendsTotal,
    returnPct,
    drawdownPct: maxDd,
    peakEquity: peak,
    closedLots: extras.closedLots,
    equityPoints: extras.equityPoints
  };
}

function computeBucket(events, options = {}) {
  const method = options.costMethod === 'average' ? 'average' : 'fifo';
  const markPrices = options.markPrices || {};
  const symbols = {};
  const extras = {
    skipped: [],
    dividends: [],
    fees: [],
    closedLots: [],
    realizedAcc: null,
    equityPoints: []
  };

  const ensure = (symbol) => {
    if (!symbols[symbol]) {
      symbols[symbol] = { lots: [], avgQty: 0, avgCost: 0, avgPrice: null };
    }
    return symbols[symbol];
  };

  for (const event of sortEvents(events)) {
    if (!event) continue;
    if (event.activityType === 'dividend') {
      extras.dividends.push({
        id: event.id,
        symbol: event.symbol,
        date: event.activityDate,
        amount: event.amount,
        badge: event.badge
      });
      continue;
    }
    if (event.activityType === 'fee') {
      extras.fees.push({
        id: event.id,
        symbol: event.symbol,
        date: event.activityDate,
        amount: event.amount != null ? event.amount : event.commission,
        badge: event.badge
      });
      continue;
    }
    if (event.activityType === 'exchange' || event.activityType === 'option' || event.activityType === 'expired') {
      if (!event.mapped) {
        extras.skipped.push({
          event,
          reason: 'needs_explicit_mapping',
          noFillInferred: true
        });
        continue;
      }
    }
    if (event.flags && event.flags.unsupported) {
      extras.skipped.push({ event, reason: 'unsupported', noFillInferred: true });
      continue;
    }
    if (!FILL_TYPES.has(event.activityType)) {
      extras.skipped.push({ event, reason: 'not_a_fill', noFillInferred: true });
      continue;
    }
    if (event.quantity == null || event.price == null) {
      extras.skipped.push({
        event,
        reason: 'missing_quantity_or_price',
        noFillInferred: true
      });
      continue;
    }
    if (!event.symbol) {
      extras.skipped.push({ event, reason: 'missing_symbol', noFillInferred: true });
      continue;
    }

    const state = ensure(event.symbol);
    const result = method === 'average'
      ? processAverage(state, event)
      : processFifo(state, event);
    if (Number.isFinite(result.realized)) {
      extras.realizedAcc = addFinite(extras.realizedAcc, result.realized);
    }
    extras.closedLots.push(...result.closed);

    let mtm = 0;
    let mtmKnown = true;
    for (const [symbol, symbolState] of Object.entries(symbols)) {
      const qty = symbolState.lots.reduce((sum, lot) => sum + lot.remaining, 0);
      if (qty <= 0) continue;
      const mark = Number.isFinite(markPrices[symbol])
        ? markPrices[symbol]
        : (symbol === event.symbol ? event.price : null);
      if (!Number.isFinite(mark)) {
        mtmKnown = false;
        break;
      }
      mtm += symbolState.lots.reduce((sum, lot) => sum + lot.remaining * mark, 0);
    }
    extras.equityPoints.push({
      date: event.activityDate,
      realized: extras.realizedAcc,
      equity: mtmKnown
        ? (Number.isFinite(extras.realizedAcc) ? extras.realizedAcc : 0) + mtm
        : null
    });
  }

  return finalizeBucket(symbols, extras, markPrices);
}

export function computeLotsAndPnl(events, options = {}) {
  const real = [];
  const tracking = [];
  for (const event of events || []) {
    if (!event) continue;
    if (event.badge === 'TRACKING') tracking.push(event);
    else real.push(event);
  }
  return {
    method: options.costMethod === 'average' ? 'average' : 'fifo',
    REAL: computeBucket(real, options),
    TRACKING: computeBucket(tracking, options)
  };
}

export function formatMissing(value, formatter) {
  if (value == null || !Number.isFinite(value)) return 'missing';
  return formatter ? formatter(value) : String(value);
}
