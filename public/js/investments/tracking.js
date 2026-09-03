export function paperTradeToEvent(trade) {
  const side = String(trade.side || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  const quantity = trade.quantity;
  const price = trade.price;
  return {
    id: trade.id,
    source: 'paper',
    badge: 'TRACKING',
    activityDate: trade.date,
    transactionDate: trade.date,
    settlementDate: null,
    activityType: side === 'SELL' ? 'sell' : 'buy',
    description: trade.note || `Paper ${side}`,
    symbol: trade.symbol ? String(trade.symbol).toUpperCase() : null,
    cusip: null,
    quantity,
    price,
    amount: quantity != null && price != null ? quantity * price : null,
    commission: trade.commission == null ? null : trade.commission,
    category: 'paper',
    note: trade.note || null,
    mapped: false,
    flags: {
      missingQuantity: quantity == null,
      missingPrice: price == null,
      unsupported: false,
      noFillInferred: quantity == null || price == null,
      needsExplicitMapping: false
    }
  };
}

export function validatePaperTrade(input) {
  const errors = [];
  const side = String(input.side || '').toUpperCase();
  if (side !== 'BUY' && side !== 'SELL') errors.push('Paper trade side must be BUY or SELL');
  if (!input.symbol || !String(input.symbol).trim()) errors.push('Paper trade symbol is required');
  if (!input.date) errors.push('Paper trade date is required');
  if (input.quantity == null || !Number.isFinite(input.quantity)) {
    errors.push('Paper trade quantity is required — no fill inferred');
  }
  if (input.price == null || !Number.isFinite(input.price)) {
    errors.push('Paper trade price is required — no fill inferred');
  }
  return {
    ok: errors.length === 0,
    errors,
    trade: {
      side,
      symbol: String(input.symbol || '').trim().toUpperCase(),
      date: input.date,
      quantity: input.quantity,
      price: input.price,
      commission: input.commission == null || input.commission === '' ? null : Number(input.commission),
      note: input.note || null
    }
  };
}

export function trackingForwardPerformance(record, markPrice) {
  const baseline = record && Number.isFinite(record.baselinePrice) ? record.baselinePrice : null;
  const mark = record && record.status === 'stopped' && Number.isFinite(record.stopPrice)
    ? record.stopPrice
    : (Number.isFinite(markPrice) ? markPrice : null);
  if (baseline == null || baseline === 0 || mark == null) {
    return {
      badge: 'TRACKING',
      symbol: record ? record.symbol : null,
      startDate: record ? record.startDate : null,
      baselinePrice: baseline,
      markPrice: mark,
      returnPct: null,
      status: record ? record.status : null
    };
  }
  return {
    badge: 'TRACKING',
    symbol: record.symbol,
    startDate: record.startDate,
    baselinePrice: baseline,
    markPrice: mark,
    returnPct: (mark - baseline) / baseline,
    status: record.status
  };
}

export function startTrackingInput(input) {
  const errors = [];
  if (!input.symbol || !String(input.symbol).trim()) errors.push('Tracking symbol is required');
  if (!input.startDate) errors.push('Tracking start date is required');
  if (input.baselinePrice == null || !Number.isFinite(Number(input.baselinePrice))) {
    errors.push('Tracking baseline price is required');
  }
  return {
    ok: errors.length === 0,
    errors,
    record: {
      symbol: String(input.symbol || '').trim().toUpperCase(),
      startDate: input.startDate,
      baselinePrice: Number(input.baselinePrice)
    }
  };
}
