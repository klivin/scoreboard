import { seriesModel } from '../series.js';
import {
  defaultCatalog,
  lookupAsset,
  parseScoreboardId
} from './catalog.js';

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'resolve_assets',
      description: 'Resolve investment names or tickers to Scoreboard assets. Reject unknowns. Required before any asset_card.',
      parameters: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: { type: 'string' },
            description: 'Names or symbols to resolve (e.g. Bitcoin, MSTR, SKR).'
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
      description: 'Search the research catalog for a natural-language list (e.g. coins doing buybacks). Then call resolve_assets on the hit symbols.',
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
      name: 'get_chart_context',
      description: 'Return cached series metadata for a scoreboardId. Never invent OHLCV. Missing series return ok:false.',
      parameters: {
        type: 'object',
        properties: {
          scoreboardId: { type: 'string' }
        },
        required: ['scoreboardId']
      }
    }
  }
];

function intervalHintFor(asset, query) {
  const text = String(query || '').toLowerCase();
  if (/\b(1h|hourly|hour)\b/.test(text)) return '1h';
  return '1d';
}

export function resolveOne(query, catalog = defaultCatalog()) {
  const q = query == null ? '' : String(query);
  const asset = lookupAsset(q, catalog);
  if (!asset) {
    return {
      ok: false,
      query: q,
      symbol: null,
      name: null,
      assetClass: null,
      venue: null,
      scoreboardId: null,
      load: null,
      reason: 'unknown'
    };
  }
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
    load: {
      symbol: asset.symbol,
      assetClass: asset.assetClass,
      intervalHint: intervalHintFor(asset, q)
    }
  };
}

export function resolveAssets(queries, catalog = defaultCatalog()) {
  const list = Array.isArray(queries) ? queries : [];
  return list.map((query) => resolveOne(query, catalog));
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
    note: scored.length ? null : 'No catalog hits.'
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

export function createToolRunner({ catalog, getSeries } = {}) {
  const cat = catalog || defaultCatalog();
  return {
    definitions: TOOL_DEFINITIONS,
    execute(name, args = {}) {
      if (name === 'resolve_assets') {
        return { results: resolveAssets(args.queries || [], cat) };
      }
      if (name === 'search_assets') {
        return searchAssets(args.naturalQuery || '', cat);
      }
      if (name === 'get_chart_context') {
        return getChartContext(args.scoreboardId, { getSeries: getSeries || defaultGetSeries });
      }
      return { error: `unknown tool: ${name}` };
    }
  };
}
