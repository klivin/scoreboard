/**
 * Watch / Track instrument class: crypto | etf | equity.
 * Same ticker (BTC / ETH) may exist twice when class differs.
 * Never silently price an ETF lot with OKX coin spot.
 */

export const INSTRUMENT_CLASSES = Object.freeze(['crypto', 'etf', 'equity']);

/** Spot / perp coins Scoreboard can ingest via OKX. */
export const OKX_CRYPTO_SYMBOLS = new Set([
  'AVAX', 'BNB', 'BTC', 'DOGE', 'ETH', 'LINK', 'PEPE', 'SHIB', 'SOL', 'SUI', 'TRUMP', 'XRP',
  'ADA', 'DOT', 'MATIC', 'POL', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'LTC', 'BCH',
  'UNI', 'AAVE', 'FIL', 'ICP', 'ETC', 'HBAR', 'ALGO', 'VET', 'MKR', 'INJ', 'SEI',
  'TIA', 'TON', 'OKB', 'SKR', 'LEO', 'KCS'
]);

/** Coin names that are also used loosely for ETFs — never assume spot. */
export const AMBIGUOUS_COIN_SYMBOLS = new Set(['BTC', 'ETH']);

/**
 * Spot Bitcoin / Ether ETFs → Yahoo ticker.
 * Listed E*TRADE symbols stay these tickers; they are not BTC-USDT.
 */
export const CRYPTO_ETF_TICKERS = Object.freeze({
  IBIT: 'BTC',
  FBTC: 'BTC',
  BITB: 'BTC',
  ARKB: 'BTC',
  BRRR: 'BTC',
  HODL: 'BTC',
  BTCO: 'BTC',
  EZBC: 'BTC',
  BTCW: 'BTC',
  GBTC: 'BTC',
  BITO: 'BTC',
  ETHA: 'ETH',
  FETH: 'ETH',
  ETHW: 'ETH',
  CETH: 'ETH',
  QETH: 'ETH',
  ETHV: 'ETH',
  ETHE: 'ETH',
  EZET: 'ETH'
});

export const SUGGESTED_BTC_ETFS = Object.freeze(['IBIT', 'FBTC', 'BITB', 'ARKB', 'GBTC']);
export const SUGGESTED_ETH_ETFS = Object.freeze(['ETHA', 'FETH', 'ETHE', 'ETHW']);

export function normalizeInstrumentClass(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'crypto' || text === 'coin' || text === 'spot' || text === 'perp') return 'crypto';
  if (text === 'etf') return 'etf';
  if (text === 'equity' || text === 'stock' || text === 'share') return 'equity';
  return null;
}

export function isKnownCryptoEtf(symbol) {
  const upper = String(symbol || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CRYPTO_ETF_TICKERS, upper);
}

export function isOkxCryptoSymbol(symbol) {
  return OKX_CRYPTO_SYMBOLS.has(String(symbol || '').trim().toUpperCase());
}

export function isAmbiguousCoinSymbol(symbol) {
  return AMBIGUOUS_COIN_SYMBOLS.has(String(symbol || '').trim().toUpperCase());
}

export function etfUnderlier(symbol) {
  const upper = String(symbol || '').trim().toUpperCase();
  return CRYPTO_ETF_TICKERS[upper] || null;
}

export function suggestedEtfTickers(symbol) {
  const upper = String(symbol || '').trim().toUpperCase();
  if (upper === 'ETH' || etfUnderlier(upper) === 'ETH') return SUGGESTED_ETH_ETFS.slice();
  if (upper === 'BTC' || etfUnderlier(upper) === 'BTC') return SUGGESTED_BTC_ETFS.slice();
  return [...SUGGESTED_BTC_ETFS, ...SUGGESTED_ETH_ETFS];
}

export function defaultInstrumentClass(symbol) {
  const upper = String(symbol || '').trim().toUpperCase();
  if (!upper) return 'equity';
  if (isKnownCryptoEtf(upper)) return 'etf';
  if (isOkxCryptoSymbol(upper)) return 'crypto';
  return 'equity';
}

export function venueHint(assetClass) {
  const cls = normalizeInstrumentClass(assetClass);
  if (cls === 'crypto') return 'coin';
  if (cls === 'etf') return 'ETF';
  if (cls === 'equity') return 'equity';
  return 'pick venue';
}

export function instrumentKey({ assetClass, markSymbol, symbol } = {}) {
  const cls = normalizeInstrumentClass(assetClass) || 'unknown';
  const mark = String(markSymbol || symbol || '').trim().toUpperCase();
  return `${cls}:${mark}`;
}

export function markSymbolFor(record = {}) {
  const cls = normalizeInstrumentClass(record.assetClass);
  const yahoo = record.yahooTicker ? String(record.yahooTicker).trim().toUpperCase() : '';
  const marked = record.markSymbol ? String(record.markSymbol).trim().toUpperCase() : '';
  const symbol = record.symbol ? String(record.symbol).trim().toUpperCase() : '';
  if (cls === 'etf') return yahoo || marked || (isKnownCryptoEtf(symbol) ? symbol : '');
  return marked || yahoo || symbol;
}

/**
 * Which ticker Price is fetched for, and which adapter.
 * ETF/equity → Yahoo. Crypto → OKX. Coin ticker + etf/equity without a Yahoo
 * ticker is unresolved — do not fetch $77k spot.
 */
export function resolveMarkTarget(record = {}) {
  const cls = normalizeInstrumentClass(record.assetClass) || defaultInstrumentClass(record.symbol);
  const symbol = String(record.symbol || '').trim().toUpperCase();
  const markSymbol = markSymbolFor({ ...record, assetClass: cls });
  const unresolved = Boolean(record.needsInstrumentClass)
    || ((cls === 'etf' || cls === 'equity') && isAmbiguousCoinSymbol(markSymbol || symbol) && !isKnownCryptoEtf(markSymbol));

  if (unresolved || !markSymbol) {
    return {
      ok: false,
      assetClass: cls,
      symbol,
      markSymbol: markSymbol || symbol,
      adapter: null,
      unresolved: true
    };
  }

  const adapter = cls === 'crypto' ? 'okx' : 'yahoo';
  return {
    ok: true,
    assetClass: cls,
    symbol,
    markSymbol,
    adapter,
    unresolved: false
  };
}

export function formatInstrumentLabel(record = {}) {
  const cls = normalizeInstrumentClass(record.assetClass);
  const target = resolveMarkTarget(record);
  const priced = target.markSymbol || record.symbol || 'missing';
  return `${priced} · ${venueHint(cls || (record.needsInstrumentClass ? null : cls))}`;
}

export function sameInstrument(a = {}, b = {}) {
  if (a.needsInstrumentClass || b.needsInstrumentClass) {
    const listedA = String(a.listedSymbol || a.symbol || '').trim().toUpperCase();
    const listedB = String(b.listedSymbol || b.symbol || '').trim().toUpperCase();
    return Boolean(a.needsInstrumentClass && b.needsInstrumentClass && listedA && listedA === listedB);
  }
  const keyA = instrumentKey({
    assetClass: a.assetClass || defaultInstrumentClass(a.symbol),
    markSymbol: markSymbolFor(a),
    symbol: a.symbol
  });
  const keyB = instrumentKey({
    assetClass: b.assetClass || defaultInstrumentClass(b.symbol),
    markSymbol: markSymbolFor(b),
    symbol: b.symbol
  });
  return Boolean(markSymbolFor(a) || a.symbol) && keyA === keyB;
}

/**
 * Manual Add / class picker.
 * ETF requires a concrete Yahoo ticker — never OKX coin spot.
 */
export function resolveWatchInstrument(input = {}) {
  const errors = [];
  const listed = String(input.symbol || '').trim().toUpperCase();
  if (!listed) {
    return { ok: false, errors: ['Tracking symbol is required'] };
  }

  let assetClass = normalizeInstrumentClass(input.assetClass);
  if (!assetClass) assetClass = defaultInstrumentClass(listed);

  let yahooTicker = String(input.yahooTicker || '').trim().toUpperCase() || null;
  if (assetClass === 'etf' && !yahooTicker && isKnownCryptoEtf(listed)) {
    yahooTicker = listed;
  }

  let markSymbol = listed;
  let symbol = listed;
  let needsInstrumentClass = false;

  if (assetClass === 'etf') {
    if (!yahooTicker) {
      const suggestions = suggestedEtfTickers(listed).join(', ');
      errors.push(`ETF rows need a Yahoo ticker (${suggestions}, …). Coin spot is not used.`);
    } else {
      markSymbol = yahooTicker;
      symbol = yahooTicker;
    }
  } else if (assetClass === 'crypto') {
    markSymbol = listed;
    symbol = listed;
    yahooTicker = null;
  } else {
    markSymbol = listed;
    symbol = listed;
    yahooTicker = null;
  }

  return {
    ok: errors.length === 0,
    errors,
    listedSymbol: listed,
    symbol,
    assetClass,
    yahooTicker: assetClass === 'etf' ? yahooTicker : null,
    markSymbol,
    needsInstrumentClass
  };
}

/**
 * Import: keep the E*TRADE listed ticker. Known ETF → etf + Yahoo that ticker.
 * Bare BTC/ETH from a brokerage file is unresolved — picker, not OKX spot.
 */
export function classifyImportedInstrument(input = {}) {
  const listed = String(input.listedSymbol || input.symbolRaw || input.symbol || '')
    .trim()
    .toUpperCase();
  const mapped = String(input.symbol || listed).trim().toUpperCase();
  if (!listed && !mapped) {
    return {
      symbol: null,
      listedSymbol: null,
      assetClass: null,
      yahooTicker: null,
      markSymbol: null,
      needsInstrumentClass: false,
      blockedCryptoCollapse: false
    };
  }
  const description = String(input.description || '');

  if (isKnownCryptoEtf(listed) || isKnownCryptoEtf(mapped)) {
    const ticker = isKnownCryptoEtf(listed) ? listed : mapped;
    return {
      symbol: ticker,
      listedSymbol: listed || ticker,
      assetClass: 'etf',
      yahooTicker: ticker,
      markSymbol: ticker,
      needsInstrumentClass: false,
      blockedCryptoCollapse: isAmbiguousCoinSymbol(mapped) && isKnownCryptoEtf(listed)
    };
  }

  if (isAmbiguousCoinSymbol(listed) || isAmbiguousCoinSymbol(mapped)) {
    const looksEtf = /\b(etf|trust|ishares|fidelity|bitwise|ark|grayscale|vaneck)\b/i.test(description);
    return {
      symbol: listed || mapped,
      listedSymbol: listed || mapped,
      assetClass: null,
      yahooTicker: null,
      markSymbol: listed || mapped,
      needsInstrumentClass: true,
      blockedCryptoCollapse: true,
      suggestedEtfs: suggestedEtfTickers(listed || mapped),
      hint: looksEtf
        ? 'Brokerage lot looks like an ETF — pick a Yahoo ticker, do not use coin spot.'
        : 'BTC/ETH from a brokerage file may be an ETF. Pick coin or a Yahoo ETF ticker.'
    };
  }

  const symbol = listed || mapped;
  const assetClass = defaultInstrumentClass(symbol);
  return {
    symbol,
    listedSymbol: listed || symbol,
    assetClass,
    yahooTicker: assetClass === 'etf' ? symbol : null,
    markSymbol: symbol,
    needsInstrumentClass: false,
    blockedCryptoCollapse: false
  };
}

export function refreshAssetClassParam(assetClass) {
  const cls = normalizeInstrumentClass(assetClass);
  if (cls === 'crypto') return 'crypto';
  if (cls === 'etf') return 'etf';
  if (cls === 'equity') return 'equity';
  return null;
}
