export const PACK_CRYPTO = [
  'AVAX', 'BNB', 'BTC', 'DOGE', 'ETH', 'LINK', 'PEPE', 'SHIB', 'SOL', 'SUI', 'TRUMP', 'XRP'
];

export const KNOWN_CRYPTO = new Set([
  ...PACK_CRYPTO,
  'ADA', 'DOT', 'MATIC', 'POL', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'LTC', 'BCH',
  'UNI', 'AAVE', 'FIL', 'ICP', 'ETC', 'HBAR', 'ALGO', 'VET', 'MKR', 'INJ', 'SEI',
  'TIA', 'RENDER', 'FET', 'TAO', 'WIF', 'BONK', 'FLOKI', 'TON', 'OKB', 'WLD', 'SAND',
  'MANA', 'AXS', 'IMX', 'STX', 'RUNE', 'KAS', 'ENA', 'JUP', 'PYTH', 'ONDO'
]);

export const KNOWN_STOCKS = new Set([
  'AAPL', 'MSFT', 'GOOG', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX', 'AMD',
  'INTC', 'IBM', 'ORCL', 'ADBE', 'CRM', 'AVGO', 'QCOM', 'TXN', 'CSCO',
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'V', 'MA', 'AXP',
  'JNJ', 'UNH', 'PFE', 'MRK', 'ABBV', 'LLY',
  'XOM', 'CVX', 'COP',
  'WMT', 'COST', 'HD', 'TGT', 'NKE', 'SBUX', 'MCD', 'KO', 'PEP', 'PG', 'DIS',
  'BA', 'CAT', 'GE', 'HON',
  'MSTR', 'COIN', 'IBIT',
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI'
]);

export const KNOWN_CRYPTO_EXTRAS = new Set(['SKR', 'LEO', 'KCS']);

/** Common English words that look like 1–5 letter tickers. Not an asset allowlist. */
export const TICKER_STOPWORDS = new Set([
  'A', 'I', 'AM', 'AN', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'HE', 'IF', 'IN', 'IS', 'IT',
  'ME', 'MY', 'NO', 'OF', 'OK', 'ON', 'OR', 'SO', 'TO', 'UP', 'US', 'WE',
  'AND', 'ARE', 'BUT', 'BUY', 'CAN', 'DID', 'FOR', 'GET', 'GOT', 'HAS', 'HER', 'HIM',
  'HIS', 'HOW', 'ITS', 'LET', 'MAY', 'NEW', 'NOR', 'NOT', 'NOW', 'OFF', 'OLD', 'ONE',
  'OUR', 'OUT', 'OWN', 'SAY', 'SEE', 'SHE', 'THE', 'TOO', 'TWO', 'WAS', 'WAY', 'WHO',
  'WHY', 'YES', 'YET', 'YOU',
  'ALSO', 'BACK', 'BEEN', 'BEST', 'BOTH', 'CALL', 'COME', 'DOES', 'DOWN', 'EACH',
  'EVEN', 'EVER', 'FROM', 'GOOD', 'HAVE', 'HERE', 'HIGH', 'INTO', 'JUST', 'KEEP',
  'LAST', 'LESS', 'LIKE', 'LONG', 'LOOK', 'MADE', 'MAKE', 'MANY', 'MORE', 'MOST',
  'MUCH', 'MUST', 'NAME', 'NEAR', 'NEED', 'NEXT', 'ONLY', 'OVER', 'SAME', 'SOME',
  'SUCH', 'SURE', 'TAKE', 'THAN', 'THAT', 'THEM', 'THEN', 'THEY', 'THIS', 'THUS',
  'TOLD', 'VERY', 'WANT', 'WELL', 'WERE', 'WHAT', 'WHEN', 'WITH', 'YOUR',
  'ABOUT', 'AFTER', 'AGAIN', 'BEING', 'COULD', 'DOING', 'ENTRY', 'FIRST', 'GOING',
  'GREAT', 'LOAD', 'OTHER', 'PRICE', 'RIGHT', 'STILL', 'THEIR', 'THERE', 'THESE',
  'THINK', 'THOSE', 'TODAY', 'UNDER', 'UNTIL', 'VALUE', 'WHICH', 'WHILE', 'WOULD'
]);

/**
 * US common-stock / ETF ticker shape (not a listing allowlist).
 * 1–5 letters, optional share-class suffix (BRK.B), optional .US.
 */
export function looksLikeUsEquityTicker(symbol) {
  const upper = String(symbol || '').toUpperCase();
  if (!upper) return false;
  if (TICKER_STOPWORDS.has(upper)) return false;
  return /^[A-Z]{1,5}$/.test(upper);
}

export function classifyAssetClass(symbol, marketHint = null) {
  const upper = String(symbol || '').toUpperCase();
  if (marketHint === 'swap' || marketHint === 'spot' || marketHint === 'crypto') return 'crypto';
  if (KNOWN_CRYPTO.has(upper) || KNOWN_CRYPTO_EXTRAS.has(upper)) return 'crypto';
  if (KNOWN_STOCKS.has(upper)) return 'stock';
  if (looksLikeUsEquityTicker(upper)) return 'stock';
  return 'unknown';
}

export function normalizeTicker(raw) {
  const input = raw == null ? '' : String(raw);
  let cleaned = input.trim().toUpperCase();
  if (!cleaned) {
    return emptyResult(input, 'empty');
  }

  cleaned = cleaned.replace(/^\$/, '').trim();
  cleaned = cleaned.replace(/[\/_\s]+/g, '-');

  let symbol = cleaned;
  let instIdSwap = null;
  let instIdSpot = null;
  let marketHint = null;

  if (/^[A-Z0-9]{2,15}-USDT-SWAP$/.test(cleaned)) {
    symbol = cleaned.split('-')[0];
    instIdSwap = cleaned;
    instIdSpot = `${symbol}-USDT`;
    marketHint = 'swap';
  } else if (/^[A-Z0-9]{2,15}-USDT$/.test(cleaned)) {
    symbol = cleaned.split('-')[0];
    instIdSwap = `${symbol}-USDT-SWAP`;
    instIdSpot = cleaned;
    marketHint = 'spot';
  } else if (/^[A-Z0-9]{2,15}USDT$/.test(cleaned) && cleaned.length > 4) {
    symbol = cleaned.slice(0, -4);
    instIdSwap = `${symbol}-USDT-SWAP`;
    instIdSpot = `${symbol}-USDT`;
    marketHint = 'crypto';
  } else if (/^[A-Z0-9]{1,10}\.[A-Z]{1,4}$/.test(cleaned)) {
    symbol = cleaned.split('.')[0];
  } else {
    symbol = cleaned.split('-')[0].split('.')[0];
  }

  symbol = symbol.replace(/[^A-Z0-9]/g, '');
  if (!symbol) {
    return emptyResult(input, 'invalid');
  }

  const assetClass = classifyAssetClass(symbol, marketHint);
  if (assetClass !== 'stock') {
    instIdSwap = instIdSwap || `${symbol}-USDT-SWAP`;
    instIdSpot = instIdSpot || `${symbol}-USDT`;
  }

  return {
    symbol,
    assetClass,
    instIdSwap,
    instIdSpot,
    marketHint,
    error: null,
    input
  };
}

export function instIdCandidates(normalized) {
  if (!normalized || !normalized.symbol || normalized.assetClass === 'stock') return [];
  const out = [];
  if (normalized.marketHint === 'spot') {
    if (normalized.instIdSpot) out.push({ market: 'spot', instId: normalized.instIdSpot });
    if (normalized.instIdSwap) out.push({ market: 'swap', instId: normalized.instIdSwap });
    return out;
  }
  if (normalized.instIdSwap) out.push({ market: 'swap', instId: normalized.instIdSwap });
  if (normalized.instIdSpot) out.push({ market: 'spot', instId: normalized.instIdSpot });
  return out;
}

export function resolveOkxInstId(symbol, { instId = null, market = 'swap' } = {}) {
  if (instId) return instId;
  const parsed = normalizeTicker(symbol);
  if (market === 'spot') return parsed.instIdSpot || `${parsed.symbol || 'BTC'}-USDT`;
  return parsed.instIdSwap || `${parsed.symbol || 'BTC'}-USDT-SWAP`;
}

export function extractTickerQueries(text, { loose = false } = {}) {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  const found = [];
  const seen = new Set();
  const consider = (token, requireCaps) => {
    const original = String(token || '').replace(/^\$/, '');
    if (requireCaps && original !== original.toUpperCase()) return;
    const upper = original.toUpperCase();
    if (!upper || seen.has(upper) || TICKER_STOPWORDS.has(upper)) return;
    const crypto = KNOWN_CRYPTO.has(upper) || KNOWN_CRYPTO_EXTRAS.has(upper);
    const equity = KNOWN_STOCKS.has(upper) || looksLikeUsEquityTicker(upper);
    if (!crypto && !equity) return;
    seen.add(upper);
    found.push(upper);
  };
  for (const match of raw.matchAll(/\$([A-Za-z]{1,5})\b/g)) consider(match[1], false);
  for (const match of raw.matchAll(/\b([A-Za-z]{1,5})\b/g)) consider(match[1], !loose);
  return found;
}

function emptyResult(input, error) {
  return {
    symbol: '',
    assetClass: 'unknown',
    instIdSwap: null,
    instIdSpot: null,
    marketHint: null,
    error,
    input
  };
}
