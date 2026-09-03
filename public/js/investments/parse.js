const MISSING_TOKENS = new Set(['', '--', '—', 'n/a', 'na', 'null', 'none', '.']);

export const ACTIVITY_TYPES = Object.freeze([
  'buy',
  'sell',
  'dividend',
  'exchange',
  'option',
  'expired',
  'fee',
  'unsupported'
]);

export function parseOptionalNumber(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (MISSING_TOKENS.has(text.toLowerCase())) return null;
  const wrappedNegative = /\(.*\)/.test(text);
  const cleaned = text.replace(/[$,\s]/g, '').replace(/[()]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return wrappedNegative ? -Math.abs(num) : num;
}

export function parseOptionalDate(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (MISSING_TOKENS.has(text.toLowerCase())) return null;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return { iso: `${match[1]}-${match[2]}-${match[3]}`, display: text };
  }

  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const mm = match[1].padStart(2, '0');
    const dd = match[2].padStart(2, '0');
    return { iso: `${match[3]}-${mm}-${dd}`, display: text };
  }

  match = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    const mm = match[1].padStart(2, '0');
    const dd = match[2].padStart(2, '0');
    return { iso: `${match[3]}-${mm}-${dd}`, display: text };
  }

  return { iso: null, display: text, unparsed: true };
}

export function classifyActivityType(typeText) {
  const text = String(typeText || '').trim().toLowerCase();
  if (!text) return 'unsupported';

  if (/\b(expir|expired|expiration)\b/.test(text)) return 'expired';
  if (/\b(option|assigned|exercised|assignment|exercise)\b/.test(text)) return 'option';
  if (/\b(dividend|div\.?)\b/.test(text)) return 'dividend';
  if (/\b(exchange|conversion|reorg|reorganization|merger)\b/.test(text)) return 'exchange';
  if (/\b(fee|commission|margin interest|advisory)\b/.test(text)) return 'fee';
  if (/\b(sell|sold|sale)\b/.test(text)) return 'sell';
  if (/\b(buy|bought|purchase|reinvest)\b/.test(text)) return 'buy';
  return 'unsupported';
}

export function emptyToMissing(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (MISSING_TOKENS.has(text.toLowerCase())) return null;
  return text;
}

export function applySymbolMaps(symbol, cusip, maps = []) {
  const sym = emptyToMissing(symbol);
  const id = emptyToMissing(cusip);
  for (const map of maps) {
    if (!map) continue;
    const fromSym = emptyToMissing(map.fromSymbol);
    const fromCusip = emptyToMissing(map.fromCusip);
    if (fromSym && sym && fromSym.toUpperCase() === sym.toUpperCase()) {
      return { symbol: map.toSymbol || sym, cusip: map.toCusip || id, mapped: true, mapId: map.id };
    }
    if (fromCusip && id && fromCusip.toUpperCase() === id.toUpperCase()) {
      return { symbol: map.toSymbol || sym, cusip: map.toCusip || id, mapped: true, mapId: map.id };
    }
  }
  return { symbol: sym, cusip: id, mapped: false, mapId: null };
}

export function eventFingerprint(event) {
  return [
    event.activityDate || '',
    event.transactionDate || '',
    event.activityType || '',
    event.symbol || '',
    event.quantity ?? '',
    event.price ?? '',
    event.amount ?? '',
    event.description || ''
  ].join('|');
}

export function normalizeRow(row, options = {}) {
  const record = row.record || {};
  const maps = options.symbolMaps || [];
  const badge = options.badge || 'REAL';
  const source = options.source || 'import';

  const activityDate = parseOptionalDate(record['Activity/Trade Date'] || record['Transaction Date']);
  const transactionDate = parseOptionalDate(record['Transaction Date']);
  const settlementDate = parseOptionalDate(record['Settlement Date']);
  const activityType = classifyActivityType(record['Activity Type']);
  const quantity = parseOptionalNumber(record.Quantity);
  const price = parseOptionalNumber(record.Price);
  const amount = parseOptionalNumber(record.Amount);
  const commission = parseOptionalNumber(record.Commission);
  const mapped = applySymbolMaps(record.Symbol, record.Cusip, maps);

  const missingQuantity = quantity == null;
  const missingPrice = price == null;
  const fillEligible = (activityType === 'buy' || activityType === 'sell')
    && !missingQuantity
    && !missingPrice;
  const needsMapping = (activityType === 'exchange' || activityType === 'option' || activityType === 'expired')
    && !mapped.mapped;

  const event = {
    id: options.id || `evt_${row.lineNumber}_${Date.now()}`,
    lineNumber: row.lineNumber || null,
    source,
    badge,
    activityDate: activityDate && activityDate.iso ? activityDate.iso : null,
    activityDateDisplay: activityDate ? activityDate.display : null,
    transactionDate: transactionDate && transactionDate.iso ? transactionDate.iso : null,
    settlementDate: settlementDate && settlementDate.iso ? settlementDate.iso : null,
    activityType,
    description: emptyToMissing(record.Description),
    symbol: mapped.symbol ? String(mapped.symbol).toUpperCase() : null,
    symbolRaw: emptyToMissing(record.Symbol),
    cusip: mapped.cusip,
    quantity,
    price,
    amount,
    commission,
    category: emptyToMissing(record.Category),
    note: emptyToMissing(record.Note),
    mapped: mapped.mapped,
    mapId: mapped.mapId,
    raw: row.raw || record,
    flags: {
      missingQuantity,
      missingPrice,
      unsupported: activityType === 'unsupported',
      noFillInferred: !fillEligible,
      needsExplicitMapping: needsMapping,
      unparsedDate: Boolean(activityDate && activityDate.unparsed)
    }
  };
  event.fingerprint = eventFingerprint(event);
  return event;
}

export function normalizeRows(rows, options = {}) {
  return (rows || []).map((row, index) => normalizeRow(row, {
    ...options,
    id: options.idPrefix ? `${options.idPrefix}_${index + 1}` : options.id
  }));
}
