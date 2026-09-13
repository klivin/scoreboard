import { seriesModel } from '../series.js';
import { getRefreshRuntime } from '../refresh.js';
import {
  classifyAssetClass,
  normalizeTicker
} from '../ticker.js';
import { resolveTicker } from '../resolve.js';
import {
  defaultCatalog,
  lookupAsset,
  parseScoreboardId
} from './catalog.js';
import { webSearch as defaultWebSearch } from './web-search.js';

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'resolve_assets',
      description: 'Resolve investment names or tickers to Scoreboard assets. Catalog is hints/tags only. Well-formed US tickers (e.g. CDNS) resolve as equity without an allowlist. Required before any asset_card.',
      parameters: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: { type: 'string' },
            description: 'Names or symbols to resolve (e.g. Bitcoin, CDNS, Cadence, SKR).'
          }
        },
        required: ['queries']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_assets',
      description: 'Search the research catalog for a natural-language list (e.g. coins doing buybacks). Then call resolve_assets on the hit symbols. Catalog tags only — not a live chain feed.',
      parameters: {
        type: 'object',
        properties: {
          naturalQuery: { type: 'string' }
        },
        required: ['naturalQuery']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'refresh_series',
      description: 'Load/refresh cached OHLC for a resolved symbol using the same Overview ticker path (OKX crypto or Yahoo equity). Call after resolve_assets and before get_chart_context.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Ticker such as CDNS or BTC' },
          scoreboardId: { type: 'string', description: 'Optional equity:CDNS / crypto:BTC' },
          interval: { type: 'string', description: 'Optional 1d or 1h filter; omit to refresh both like Overview Load Data' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_chart_context',
      description: 'Return cached series metadata for a scoreboardId after refresh_series. Never invent OHLCV. Missing series return ok:false.',
      parameters: {
        type: 'object',
        properties: {
          scoreboardId: { type: 'string' }
        },
        required: ['scoreboardId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Keyless public web/news search for valuation, levels, and recent headlines. Call after chart context for named-ticker questions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      }
    }
  }
];

function intervalHintFor(asset, query) {
  const text = String(query || '').toLowerCase();
  if (/\b(1h|hourly|hour)\b/.test(text)) return '1h';
  return '1d';
}

function chatAssetClass(className) {
  if (className === 'stock' || className === 'equity') return 'equity';
  if (className === 'etf') return 'etf';
  if (className === 'crypto') return 'crypto';
  return className || 'other';
}

function dynamicEquityAsset(symbol, query) {
  const upper = String(symbol).toUpperCase();
  return {
    symbol: upper,
    name: upper,
    assetClass: 'equity',
    venue: 'yahoo',
    scoreboardId: `equity:${upper}`,
    blurb: `${upper} US equity. Catalog is hints only — this ticker resolved dynamically. Charting uses Yahoo Finance public candles.`,
    strategyConsiderations: [
      'Confirm the daily series on Overview after Load Data; missing bars stay missing.',
      'Entry notes must use get_chart_context plus web/news — never invented OHLC.'
    ],
    aliases: [],
    tags: [],
    catalogHint: false,
    query
  };
}

function dynamicCryptoAsset(symbol, query) {
  const upper = String(symbol).toUpperCase();
  return {
    symbol: upper,
    name: upper,
    assetClass: 'crypto',
    venue: 'okx',
    scoreboardId: `crypto:${upper}`,
    blurb: `${upper} crypto. Resolved from ticker classification (not catalog-only). OKX public candles when the instrument exists.`,
    strategyConsiderations: [
      'Confirm series on Overview; missing data stays missing.'
    ],
    aliases: [],
    tags: [],
    catalogHint: false,
    query
  };
}

export function resolveOne(query, catalog = defaultCatalog()) {
  const q = query == null ? '' : String(query);
  const catalogAsset = lookupAsset(q, catalog);
  if (catalogAsset) {
    return {
      ok: true,
      query: q,
      symbol: catalogAsset.symbol,
      name: catalogAsset.name,
      assetClass: catalogAsset.assetClass,
      venue: catalogAsset.venue,
      scoreboardId: catalogAsset.scoreboardId,
      blurb: catalogAsset.blurb,
      strategyConsiderations: catalogAsset.strategyConsiderations,
      catalogHint: true,
      load: {
        symbol: catalogAsset.symbol,
        assetClass: catalogAsset.assetClass,
        intervalHint: intervalHintFor(catalogAsset, q)
      }
    };
  }

  const parsed = normalizeTicker(q);
  if (parsed.symbol && !parsed.error) {
    const classified = parsed.assetClass !== 'unknown'
      ? parsed.assetClass
      : classifyAssetClass(parsed.symbol, parsed.marketHint);
    if (classified === 'crypto') {
      const asset = dynamicCryptoAsset(parsed.symbol, q);
      return {
        ok: true,
        query: q,
        symbol: asset.symbol,
        name: asset.name,
        assetClass: asset.assetClass,
        venue: asset.venue,
        scoreboardId: asset.scoreboardId,
        blurb: asset.blurb,
        strategyConsiderations: asset.strategyConsiderations,
        catalogHint: false,
        load: {
          symbol: asset.symbol,
          assetClass: asset.assetClass,
          intervalHint: intervalHintFor(asset, q)
        }
      };
    }
    if (classified === 'stock') {
      const asset = dynamicEquityAsset(parsed.symbol, q);
      return {
        ok: true,
        query: q,
        symbol: asset.symbol,
        name: asset.name,
        assetClass: chatAssetClass('equity'),
        venue: asset.venue,
        scoreboardId: asset.scoreboardId,
        blurb: asset.blurb,
        strategyConsiderations: asset.strategyConsiderations,
        catalogHint: false,
        load: {
          symbol: asset.symbol,
          assetClass: 'equity',
          intervalHint: intervalHintFor(asset, q)
        }
      };
    }
    if (classified === 'unknown' && parsed.symbol && (parsed.equityHint || parsed.marketHint)) {
      return {
        ok: true,
        query: q,
        symbol: parsed.symbol,
        name: parsed.symbol,
        assetClass: 'unknown',
        venue: null,
        scoreboardId: `unknown:${parsed.symbol}`,
        blurb: `${parsed.symbol} is not in the catalog. Overview probes crypto (OKX/CoinGecko/Binance) before Yahoo equity.`,
        strategyConsiderations: ['Load Data resolves coin vs equity; prices are not invented.'],
        catalogHint: false,
        needsResolve: true,
        load: {
          symbol: parsed.symbol,
          assetClass: 'unknown',
          intervalHint: intervalHintFor({ symbol: parsed.symbol }, q)
        }
      };
    }
  }

  return {
    ok: false,
    query: q,
    symbol: null,
    name: null,
    assetClass: null,
    venue: null,
    scoreboardId: null,
    load: null,
    reason: parsed.error || 'not a well-formed ticker'
  };
}

export function resolveAssets(queries, catalog = defaultCatalog()) {
  const list = Array.isArray(queries) ? queries : [];
  return list.map((query) => resolveOne(query, catalog));
}

export async function resolveAssetsAsync(queries, catalog = defaultCatalog(), { httpGet, resolveTicker: resolveFn = resolveTicker } = {}) {
  const list = Array.isArray(queries) ? queries : [];
  const out = [];
  for (const query of list) {
    const sync = resolveOne(query, catalog);
    if (sync.ok && !sync.needsResolve) {
      out.push(sync);
      continue;
    }
    if (!sync.symbol && !sync.ok) {
      out.push(sync);
      continue;
    }
    const resolved = await resolveFn(sync.symbol || query, { httpGet });
    if (!resolved || !resolved.ok || !resolved.symbol) {
      out.push(sync.ok ? sync : {
        ok: false,
        query,
        symbol: null,
        load: null,
        reason: (resolved && resolved.error) || 'could not resolve ticker'
      });
      continue;
    }
    const asset = resolved.assetClass === 'crypto'
      ? dynamicCryptoAsset(resolved.symbol, query)
      : dynamicEquityAsset(resolved.symbol, query);
    if (resolved.assetClass === 'crypto') {
      asset.venue = resolved.crypto && resolved.crypto.source || 'okx';
      asset.blurb = `${resolved.symbol} crypto · coin (${asset.venue}). Resolved crypto-first — not defaulted to Yahoo equity.`;
    } else {
      asset.assetClass = resolved.assetClass === 'etf' ? 'etf' : 'equity';
      asset.scoreboardId = `${asset.assetClass}:${resolved.symbol}`;
    }
    out.push({
      ok: true,
      query,
      symbol: resolved.symbol,
      name: asset.name,
      assetClass: asset.assetClass,
      venue: asset.venue,
      scoreboardId: asset.scoreboardId,
      blurb: asset.blurb,
      strategyConsiderations: asset.strategyConsiderations,
      catalogHint: false,
      needsPicker: Boolean(resolved.needsPicker),
      candidates: resolved.candidates || [],
      load: {
        symbol: resolved.symbol,
        assetClass: asset.assetClass,
        intervalHint: intervalHintFor(asset, query)
      }
    });
  }
  return out;
}

function toHit(asset) {
  return {
    query: asset.symbol,
    symbol: asset.symbol,
    name: asset.name,
    assetClass: asset.assetClass,
    why: asset.blurb || asset.name
  };
}

function scoreCatalogMatch(asset, lowerQuery) {
  let score = 0;
  if (lowerQuery.includes(asset.symbol.toLowerCase())) score += 5;
  if ((asset.name || '').toLowerCase() && lowerQuery.includes(asset.name.toLowerCase())) score += 4;
  for (const alias of asset.aliases || []) {
    if (alias && lowerQuery.includes(alias.toLowerCase())) score += 3;
  }
  for (const tag of asset.tags || []) {
    if (tag && lowerQuery.includes(tag)) score += 2;
  }
  return score;
}

export function searchAssets(naturalQuery, catalog = defaultCatalog()) {
  const q = String(naturalQuery || '').trim();
  if (!q) return { hits: [], note: 'empty query' };
  const lower = q.toLowerCase();

  if (/\b(buyback|buybacks|burn|burns|repurchase)\b/.test(lower)) {
    const hits = catalog.filter((asset) => (asset.tags || []).includes('buyback')).slice(0, 5);
    return {
      hits: hits.map(toHit),
      note: 'Static research catalog (token burns / buybacks). Not a live on-chain feed.'
    };
  }

  const scored = catalog
    .map((asset) => ({ asset, score: scoreCatalogMatch(asset, lower) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return {
    hits: scored.map((row) => toHit(row.asset)),
    note: scored.length ? 'Catalog hints only — not the sole resolve source.' : 'No catalog hits. Try resolve_assets on a ticker, then refresh_series.'
  };
}

export function defaultGetSeries(symbol, interval = '1d') {
  try {
    seriesModel.load();
    return seriesModel.getSeries(symbol, interval);
  } catch {
    return [];
  }
}

export function getChartContext(scoreboardId, { getSeries = defaultGetSeries } = {}) {
  const parsed = parseScoreboardId(scoreboardId);
  if (!parsed) {
    return { ok: false, scoreboardId: scoreboardId || null, reason: 'invalid scoreboardId' };
  }
  let series = [];
  try {
    series = getSeries(parsed.symbol, '1d') || [];
  } catch {
    series = [];
  }
  if (!series.length) {
    return {
      ok: false,
      scoreboardId: parsed.scoreboardId,
      symbol: parsed.symbol,
      reason: 'no cached series'
    };
  }
  const last = series[series.length - 1] || {};
  const close = Number(last.close);
  return {
    ok: true,
    scoreboardId: parsed.scoreboardId,
    symbol: parsed.symbol,
    interval: '1d',
    barCount: series.length,
    last: {
      timestamp: last.timestamp == null ? null : last.timestamp,
      dateUtc: last.date_utc || last.dateUtc || null,
      close: Number.isFinite(close) ? close : null
    }
  };
}

function summarizeRefreshRan(ran) {
  return (ran || []).map((row) => ({
    id: row.id,
    symbol: row.symbol,
    interval: row.interval,
    status: row.status,
    rowCount: row.rowCount,
    lastTimestamp: row.lastTimestamp,
    note: row.note || null,
    error: row.error || null
  }));
}

export async function defaultRefreshSeries({ symbol, scoreboardId, interval } = {}) {
  let ticker = symbol;
  if (!ticker && scoreboardId) {
    const parsed = parseScoreboardId(scoreboardId);
    ticker = parsed && parsed.symbol;
  }
  ticker = String(ticker || '').toUpperCase();
  if (!ticker) {
    return { ok: false, reason: 'missing symbol', ran: [] };
  }
  const runtime = getRefreshRuntime();
  const result = await runtime.runRefresh({
    symbol: ticker,
    ...(interval ? { interval } : {})
  });
  try {
    seriesModel.load();
  } catch {
    // pack may be absent; ingest store still applies on next getSeries
  }
  const ran = summarizeRefreshRan(result.ran);
  const loaded = ran.some((row) => row.status === 'ok' && Number(row.rowCount) > 0);
  return {
    ok: loaded,
    symbol: ticker,
    interval: interval || null,
    ran,
    note: loaded
      ? 'Refreshed via the same Overview ticker / Load Data path.'
      : 'Refresh ran; no cached bars yet. Public source may have returned empty — prices were not invented.'
  };
}

export function createToolRunner({
  catalog,
  getSeries,
  refreshSeries,
  webSearch
} = {}) {
  const cat = catalog || defaultCatalog();
  const refresh = refreshSeries || defaultRefreshSeries;
  const searchWeb = webSearch || defaultWebSearch;
  return {
    definitions: TOOL_DEFINITIONS,
    execute(name, args = {}) {
      if (name === 'resolve_assets') {
        return resolveAssetsAsync(args.queries || [], cat).then((results) => ({ results }));
      }
      if (name === 'search_assets') {
        return searchAssets(args.naturalQuery || '', cat);
      }
      if (name === 'refresh_series') {
        return refresh({
          symbol: args.symbol,
          scoreboardId: args.scoreboardId,
          interval: args.interval
        });
      }
      if (name === 'get_chart_context') {
        return getChartContext(args.scoreboardId, { getSeries: getSeries || defaultGetSeries });
      }
      if (name === 'web_search') {
        return searchWeb(args.query || args.naturalQuery || '');
      }
      return { error: `unknown tool: ${name}` };
    }
  };
}
