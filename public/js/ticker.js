const RECENT_KEY = 'scoreboard.recentTickers';
const MAX_RECENT = 8;
export const DEFAULT_RECENT_TICKERS = ['BTC', 'ETH', 'SOL'];

const PACK_CRYPTO = new Set([
  'AVAX', 'BNB', 'BTC', 'DOGE', 'ETH', 'LINK', 'PEPE', 'SHIB', 'SOL', 'SUI', 'TRUMP', 'XRP',
  'ADA', 'DOT', 'MATIC', 'POL', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'LTC', 'BCH',
  'UNI', 'AAVE', 'FIL', 'ICP', 'ETC', 'HBAR', 'ALGO', 'VET', 'MKR', 'INJ', 'SEI',
  'TIA', 'TON', 'OKB'
]);

const KNOWN_STOCKS = new Set([
  'AAPL', 'MSFT', 'GOOG', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX', 'AMD',
  'INTC', 'IBM', 'ORCL', 'ADBE', 'CRM', 'AVGO',
  'JPM', 'BAC', 'V', 'MA',
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI'
]);

export function normalizeTickerInput(raw) {
  const input = raw == null ? '' : String(raw);
  let cleaned = input.trim().toUpperCase();
  if (!cleaned) {
    return { symbol: '', assetClass: 'unknown', error: 'empty', input };
  }

  cleaned = cleaned.replace(/^\$/, '').trim();
  cleaned = cleaned.replace(/[\/_\s]+/g, '-');

  let symbol = cleaned;
  let marketHint = null;

  if (/^[A-Z0-9]{2,15}-USDT-SWAP$/.test(cleaned)) {
    symbol = cleaned.split('-')[0];
    marketHint = 'swap';
  } else if (/^[A-Z0-9]{2,15}-USDT$/.test(cleaned)) {
    symbol = cleaned.split('-')[0];
    marketHint = 'spot';
  } else if (/^[A-Z0-9]{2,15}USDT$/.test(cleaned) && cleaned.length > 4) {
    symbol = cleaned.slice(0, -4);
    marketHint = 'crypto';
  } else if (/^[A-Z0-9]{1,10}\.[A-Z]{1,4}$/.test(cleaned)) {
    symbol = cleaned.split('.')[0];
  } else {
    symbol = cleaned.split('-')[0].split('.')[0];
  }

  symbol = symbol.replace(/[^A-Z0-9]/g, '');
  if (!symbol) {
    return { symbol: '', assetClass: 'unknown', error: 'invalid', input };
  }

  let assetClass = 'unknown';
  if (marketHint || PACK_CRYPTO.has(symbol)) assetClass = 'crypto';
  else if (KNOWN_STOCKS.has(symbol)) assetClass = 'stock';

  return { symbol, assetClass, error: null, input };
}

export function readRecentTickers(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  try {
    const raw = store && store.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) {
      return parsed
        .map((item) => normalizeTickerInput(item).symbol)
        .filter(Boolean)
        .filter((item, index, all) => all.indexOf(item) === index)
        .slice(0, MAX_RECENT);
    }
  } catch {
    // ignore broken localStorage
  }
  return DEFAULT_RECENT_TICKERS.slice();
}

export function rememberTicker(symbol, storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const upper = normalizeTickerInput(symbol).symbol;
  const current = readRecentTickers(store);
  if (!upper) return current;
  const next = [upper, ...current.filter((item) => item !== upper)].slice(0, MAX_RECENT);
  try {
    if (store) store.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  return next;
}

export function renderRecentTickerChips(container, {
  symbols = [],
  active = '',
  onSelect
} = {}) {
  if (!container) return;
  const list = symbols.length ? symbols : DEFAULT_RECENT_TICKERS;
  const current = String(active || '').toUpperCase();
  container.innerHTML = list.map((symbol) => (
    `<button type="button" class="ticker-chip${symbol === current ? ' active' : ''}" data-ticker="${symbol}">${symbol}</button>`
  )).join('');
  container.querySelectorAll('[data-ticker]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (typeof onSelect === 'function') onSelect(btn.dataset.ticker);
    });
  });
}
