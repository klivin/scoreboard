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
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI'
]);

export function classifyAssetClass(symbol, marketHint = null) {
  const upper = String(symbol || '').toUpperCase();
  if (marketHint === 'swap' || marketHint === 'spot' || marketHint === 'crypto') return 'crypto';
  if (KNOWN_CRYPTO.has(upper)) return 'crypto';
  if (KNOWN_STOCKS.has(upper)) return 'stock';
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
