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

export function todayIsoDate(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function normalizeDirection(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['put', 'sell', 'short', 'bear', 'bearish'].includes(text)) return 'short';
  return 'long';
}

export function trackingForwardPerformance(record, markPrice) {
  const baseline = record && Number.isFinite(record.baselinePrice)
    ? record.baselinePrice
    : (record && Number.isFinite(record.startMark) ? record.startMark : null);
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
  const raw = (mark - baseline) / baseline;
  const direction = normalizeDirection(record && record.direction);
  return {
    badge: 'TRACKING',
    symbol: record.symbol,
    startDate: record.startDate,
    baselinePrice: baseline,
    markPrice: mark,
    returnPct: direction === 'short' ? -raw : raw,
    status: record.status
  };
}

export function startTrackingInput(input = {}, now = new Date()) {
  const errors = [];
  const symbol = input.symbol ? String(input.symbol).trim().toUpperCase() : '';
  const startDate = input.startDate || todayIsoDate(now);
  const baselineRaw = input.baselinePrice;
  const baselinePrice = baselineRaw == null || baselineRaw === '' ? null : Number(baselineRaw);
  const targetRaw = input.targetPrice;
  const targetPrice = targetRaw == null || targetRaw === '' ? null : Number(targetRaw);
  const targetHighRaw = input.targetHigh;
  const targetHigh = targetHighRaw == null || targetHighRaw === '' ? null : Number(targetHighRaw);
  const direction = normalizeDirection(input.direction);

  if (!symbol) errors.push('Tracking symbol is required');
  if (!startDate) errors.push('Tracking start date is required');
  if (baselineRaw != null && baselineRaw !== '' && !Number.isFinite(baselinePrice)) {
    errors.push('Tracking start mark must be a number when provided');
  }
  if (input.requireTarget && !Number.isFinite(targetPrice)) {
    errors.push('Target price is required');
  } else if (targetRaw != null && targetRaw !== '' && !Number.isFinite(targetPrice)) {
    errors.push('Target price must be a number when provided');
  }
  if (targetHighRaw != null && targetHighRaw !== '' && !Number.isFinite(targetHigh)) {
    errors.push('Target range high must be a number when provided');
  }

  return {
    ok: errors.length === 0,
    errors,
    record: {
      symbol,
      startDate,
      baselinePrice: Number.isFinite(baselinePrice) ? baselinePrice : null,
      startMark: Number.isFinite(baselinePrice) ? baselinePrice : null,
      targetPrice: Number.isFinite(targetPrice) ? targetPrice : null,
      targetHigh: Number.isFinite(targetHigh) ? targetHigh : null,
      direction
    }
  };
}
