import { httpGet, parseJsonBody } from './http.js';
import { venueLabel } from './source-adapter.js';
import {
  classifyAssetClass,
  isKnownCrypto,
  isKnownStock,
  looksLikeUsEquityTicker,
  normalizeTicker
} from './ticker.js';
import { OKX_BASE, isOkxInstrumentError } from './okx-adapter.js';
import {
  COINGECKO_ID_HINTS,
  buildBinanceKlinesUrl,
  buildCoinGeckoSearchUrl,
  pickCoinGeckoId
} from './crypto-adapter.js';
import { buildYahooChartUrl, parseYahooChartBody } from './stock-adapter.js';

export const CRYPTO_ETF_TICKERS = new Set([
  'IBIT', 'FBTC', 'BITB', 'ARKB', 'BRRR', 'HODL', 'BTCO', 'EZBC', 'BTCW', 'GBTC', 'BITO',
  'ETHA', 'FETH', 'ETHW', 'CETH', 'QETH', 'ETHV', 'ETHE', 'EZET'
]);

function forcedClass(assetClass) {
  const text = String(assetClass || '').trim().toLowerCase();
  if (text === 'crypto' || text === 'coin' || text === 'spot' || text === 'swap') return 'crypto';
  if (text === 'etf') return 'etf';
  if (text === 'equity' || text === 'stock' || text === 'share') return 'equity';
  return null;
}

export function isKnownCryptoEtf(symbol) {
  return CRYPTO_ETF_TICKERS.has(String(symbol || '').toUpperCase());
}

export async function probeOkxListed(symbol, http = httpGet) {
  const parsed = normalizeTicker(symbol);
  const upper = parsed.symbol || String(symbol || '').toUpperCase();
  const instIds = [
    parsed.instIdSpot || `${upper}-USDT`,
    parsed.instIdSwap || `${upper}-USDT-SWAP`
  ];
  const errors = [];
  for (const instId of instIds) {
    const instType = instId.endsWith('-SWAP') ? 'SWAP' : 'SPOT';
    const url = `${OKX_BASE}/api/v5/public/instruments?instType=${instType}&instId=${encodeURIComponent(instId)}`;
    try {
      const response = await http(url);
      const body = parseJsonBody(response.text);
      if (response.ok && body && String(body.code) === '0' && Array.isArray(body.data) && body.data.length) {
        return {
          exists: true,
          source: 'okx',
          instId,
          market: instType === 'SWAP' ? 'swap' : 'spot',
          url
        };
      }
      const msg = (body && (body.msg || body.error_message)) || `HTTP ${response.status}`;
      if (isOkxInstrumentError({ message: msg })) {
        errors.push(`${instId}: ${msg}`);
        continue;
      }
      errors.push(`${instId}: ${msg}`);
    } catch (error) {
      errors.push(`${instId}: ${error.message || error}`);
    }
  }
  return { exists: false, source: 'okx', instId: null, market: null, error: errors.join(' · ') };
}

export async function probeCoinGeckoListed(symbol, http = httpGet) {
  const upper = String(symbol || '').toUpperCase();
  const url = buildCoinGeckoSearchUrl(upper);
  try {
    const response = await http(url);
    if (response.status === 429) {
      if (COINGECKO_ID_HINTS[upper]) {
        return { exists: true, source: 'coingecko', coinId: COINGECKO_ID_HINTS[upper], hint: true };
      }
      return { exists: false, source: 'coingecko', error: 'CoinGecko 429' };
    }
    if (!response.ok) {
      if (COINGECKO_ID_HINTS[upper]) {
        return { exists: true, source: 'coingecko', coinId: COINGECKO_ID_HINTS[upper], hint: true };
      }
      return { exists: false, source: 'coingecko', error: `HTTP ${response.status}` };
    }
    const id = pickCoinGeckoId(parseJsonBody(response.text), upper);
    if (id) return { exists: true, source: 'coingecko', coinId: id, url };
    return { exists: false, source: 'coingecko', coinId: null, url };
  } catch (error) {
    if (COINGECKO_ID_HINTS[upper]) {
      return { exists: true, source: 'coingecko', coinId: COINGECKO_ID_HINTS[upper], hint: true };
    }
    return { exists: false, source: 'coingecko', error: error.message || String(error) };
  }
}

export async function probeBinanceListed(symbol, http = httpGet) {
  const url = buildBinanceKlinesUrl({ symbol, interval: '1d', limit: 1 });
  try {
    const response = await http(url);
    const body = parseJsonBody(response.text);
    if (response.ok && Array.isArray(body) && body.length) {
      return { exists: true, source: 'binance', url };
    }
    return { exists: false, source: 'binance', error: (body && body.msg) || `HTTP ${response.status}` };
  } catch (error) {
    return { exists: false, source: 'binance', error: error.message || String(error) };
  }
}

export async function probeYahooListed(symbol, http = httpGet) {
  const url = buildYahooChartUrl({ symbol, interval: '1d', range: '5d' });
  try {
    const response = await http(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Scoreboard/1.0; public market data; no keys)',
        Accept: 'application/json'
      }
    });
    const body = parseJsonBody(response.text);
    if (!response.ok) {
      return { exists: false, source: 'yahoo', error: `HTTP ${response.status}` };
    }
    const parsed = parseYahooChartBody(body, { symbol, interval: '1d' });
    if (parsed.rows && parsed.rows.length) {
      return {
        exists: true,
        source: 'yahoo',
        name: parsed.meta && (parsed.meta.shortName || parsed.meta.longName),
        exchange: parsed.meta && parsed.meta.exchangeName,
        url
      };
    }
    return { exists: false, source: 'yahoo', error: parsed.error || 'Yahoo chart empty' };
  } catch (error) {
    return { exists: false, source: 'yahoo', error: error.message || String(error) };
  }
}

export async function probeCryptoVenues(symbol, http = httpGet) {
  const [okx, cg, binance] = await Promise.all([
    probeOkxListed(symbol, http),
    probeCoinGeckoListed(symbol, http),
    probeBinanceListed(symbol, http)
  ]);
  const hits = [okx, cg, binance].filter((row) => row && row.exists);
  return {
    exists: hits.length > 0,
    okx,
    coingecko: cg,
    binance,
    source: (okx.exists && 'okx') || (cg.exists && 'coingecko') || (binance.exists && 'binance') || null
  };
}

function candidate(assetClass, venue, source, extra = {}) {
  return {
    assetClass,
    venue,
    source,
    label: assetClass === 'crypto'
      ? `${extra.symbol} · coin`
      : (assetClass === 'etf' ? `${extra.symbol} · ETF` : `${extra.symbol} · equity`),
    ...extra
  };
}

/**
 * Crypto-first resolve. Unknown tickers are not defaulted to Yahoo equity.
 * If OKX/CG/Binance lists the symbol, class is crypto · coin.
 * If both crypto and equity exist, needsPicker is true.
 */
export async function resolveTicker(symbol, {
  httpGet: http = httpGet,
  assetClass = null,
  probeEquity = true
} = {}) {
  const parsed = normalizeTicker(symbol);
  if (!parsed.symbol) {
    return {
      ok: false,
      symbol: '',
      assetClass: 'unknown',
      venue: null,
      needsPicker: false,
      candidates: [],
      error: parsed.error || 'empty',
      input: parsed.input
    };
  }

  const upper = parsed.symbol;
  const forced = forcedClass(assetClass);
  if (forced === 'etf' || forced === 'equity') {
    return {
      ok: true,
      symbol: upper,
      assetClass: forced,
      venue: forced === 'etf' ? 'ETF' : 'equity',
      needsPicker: false,
      candidates: [candidate(forced, forced === 'etf' ? 'ETF' : 'equity', 'yahoo', { symbol: upper })],
      forced: true,
      input: parsed.input
    };
  }
  if (forced === 'crypto') {
    return {
      ok: true,
      symbol: upper,
      assetClass: 'crypto',
      venue: 'coin',
      needsPicker: false,
      candidates: [candidate('crypto', 'coin', 'okx', { symbol: upper })],
      forced: true,
      input: parsed.input
    };
  }

  if (isKnownCryptoEtf(upper)) {
    return {
      ok: true,
      symbol: upper,
      assetClass: 'etf',
      venue: 'ETF',
      needsPicker: false,
      candidates: [candidate('etf', 'ETF', 'yahoo', { symbol: upper })],
      input: parsed.input
    };
  }

  const localClass = classifyAssetClass(upper, parsed.marketHint);
  const cryptoKnown = localClass === 'crypto' || isKnownCrypto(upper);
  const stockKnown = localClass === 'stock' || isKnownStock(upper);
  const equityHint = parsed.equityHint || looksLikeUsEquityTicker(upper);

  if (cryptoKnown && !stockKnown) {
    return {
      ok: true,
      symbol: upper,
      assetClass: 'crypto',
      venue: 'coin',
      needsPicker: false,
      candidates: [candidate('crypto', 'coin', 'okx', { symbol: upper })],
      input: parsed.input
    };
  }

  if (stockKnown && !cryptoKnown) {
    return {
      ok: true,
      symbol: upper,
      assetClass: isKnownCryptoEtf(upper) ? 'etf' : 'equity',
      venue: isKnownCryptoEtf(upper) ? 'ETF' : 'equity',
      needsPicker: false,
      candidates: [candidate(
        isKnownCryptoEtf(upper) ? 'etf' : 'equity',
        isKnownCryptoEtf(upper) ? 'ETF' : 'equity',
        'yahoo',
        { symbol: upper }
      )],
      input: parsed.input
    };
  }

  const cryptoProbe = await probeCryptoVenues(upper, http);
  const shouldProbeYahoo = probeEquity && (equityHint || cryptoProbe.exists);
  const yahoo = shouldProbeYahoo
    ? await probeYahooListed(upper, http)
    : { exists: false, source: 'yahoo' };

  const cryptoExists = Boolean(cryptoProbe && cryptoProbe.exists);
  const equityExists = Boolean(yahoo && yahoo.exists);
  const both = cryptoExists && equityExists;

  if (both) {
    return {
      ok: true,
      symbol: upper,
      assetClass: 'crypto',
      venue: 'coin',
      needsPicker: true,
      defaultClass: 'crypto',
      candidates: [
        candidate('crypto', 'coin', cryptoProbe.source || 'okx', { symbol: upper }),
        candidate('equity', 'equity', 'yahoo', { symbol: upper })
      ],
      crypto: cryptoProbe,
      equity: yahoo,
      label: venueLabel('crypto'),
      input: parsed.input
    };
  }

  if (cryptoExists) {
    return {
      ok: true,
      symbol: upper,
      assetClass: 'crypto',
      venue: 'coin',
      needsPicker: false,
      candidates: [candidate('crypto', 'coin', cryptoProbe.source || 'okx', { symbol: upper })],
      crypto: cryptoProbe,
      equity: yahoo,
      label: venueLabel('crypto'),
      input: parsed.input
    };
  }

  if (equityExists || stockKnown || equityHint) {
    const cls = isKnownCryptoEtf(upper) ? 'etf' : 'equity';
    return {
      ok: true,
      symbol: upper,
      assetClass: cls,
      venue: cls === 'etf' ? 'ETF' : 'equity',
      needsPicker: false,
      candidates: [candidate(cls, cls === 'etf' ? 'ETF' : 'equity', 'yahoo', { symbol: upper })],
      crypto: cryptoProbe,
      equity: yahoo,
      label: venueLabel(cls),
      input: parsed.input
    };
  }

  return {
    ok: true,
    symbol: upper,
    assetClass: 'unknown',
    venue: null,
    needsPicker: false,
    candidates: [
      candidate('crypto', 'coin', 'okx', { symbol: upper }),
      candidate('equity', 'equity', 'yahoo', { symbol: upper })
    ],
    crypto: cryptoProbe,
    equity: yahoo,
    tryCryptoFirst: true,
    input: parsed.input
  };
}

export function refreshAssetClassFromResolve(resolved) {
  if (!resolved) return null;
  if (resolved.assetClass === 'crypto') return 'crypto';
  if (resolved.assetClass === 'etf') return 'etf';
  if (resolved.assetClass === 'equity' || resolved.assetClass === 'stock') return 'equity';
  return null;
}
