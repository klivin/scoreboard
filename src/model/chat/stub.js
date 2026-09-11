import { defaultCatalog, findCatalogMentions } from './catalog.js';
import { extractTickerQueries } from '../ticker.js';
import { cardsFromResolved, flattenContent } from './blocks.js';

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg && msg.role === 'user') return flattenContent(msg.content);
  }
  return '';
}

function parseToolResult(msg) {
  if (!msg) return {};
  if (msg.result != null) return msg.result;
  if (typeof msg.content === 'string') {
    try {
      return JSON.parse(msg.content);
    } catch {
      return {};
    }
  }
  return {};
}

function allToolResults(messages) {
  const out = [];
  for (const msg of messages || []) {
    if (!msg || msg.role !== 'tool') continue;
    out.push({ name: msg.name, result: parseToolResult(msg) });
  }
  return out;
}

function splitCompareParts(text) {
  return String(text || '')
    .replace(/^\s*compare\s+/i, '')
    .split(/\s+(?:vs\.?|versus|and)\s+/i)
    .map((part) => part.replace(/[?.!]+$/g, '').trim())
    .filter(Boolean);
}

export function stubIntent(text, catalog = defaultCatalog()) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  if (!raw) return { search: false, queries: [] };

  if (/\b(buyback|buybacks|burn|burns|repurchase)\b/.test(lower)) {
    return { search: true, queries: [] };
  }

  const loadMatch = raw.match(/^\s*load\s+(.+)$/i);
  if (loadMatch) {
    const parts = splitCompareParts(loadMatch[1]);
    const extracted = extractTickerQueries(loadMatch[1]);
    return { search: false, queries: extracted.length ? extracted : parts };
  }

  if (/\bcompare\b/i.test(raw) || /\bvs\.?\b/i.test(raw)) {
    const mentions = findCatalogMentions(raw, catalog);
    if (mentions.length) return { search: false, queries: mentions };
    const extracted = extractTickerQueries(raw);
    if (extracted.length) return { search: false, queries: extracted };
    return { search: false, queries: splitCompareParts(raw) };
  }

  const mentions = findCatalogMentions(raw, catalog);
  if (mentions.length) return { search: false, queries: mentions };
  const extracted = extractTickerQueries(raw);
  if (extracted.length) return { search: false, queries: extracted };
  return { search: false, queries: [] };
}

function latestTool(tools, name) {
  return [...tools].reverse().find((row) => row.name === name) || null;
}

function namedTickerResearch(userText, resolveRows) {
  const ok = (resolveRows || []).filter((row) => row && row.ok);
  if (!ok.length) return false;
  if (/\b(buyback|buybacks|burn|burns|repurchase)\b/i.test(userText)) return false;
  return true;
}

function stubSummary(userText, results, { chart, search } = {}) {
  const ok = (results || []).filter((row) => row && row.ok);
  const lower = String(userText || '').toLowerCase();
  if (/\b(buyback|buybacks|burn|burns)\b/.test(lower) && ok.length) {
    return [
      `Five catalog names often discussed for token burns / buybacks: ${ok.map((row) => row.symbol).join(', ')}.`,
      'This is a static research list, not a live on-chain scan.'
    ].join(' ');
  }
  if (/\bcompare\b/i.test(userText) && ok.length >= 2) {
    return `Side-by-side research notes for ${ok.map((row) => row.symbol).join(' vs ')}. Tap a card to load that asset on Overview (daily/hourly via Load Data).`;
  }
  if (/^\s*load\s+/i.test(userText) && ok.length) {
    return `Resolved ${ok.map((row) => row.symbol).join(', ')}. Tap the card to load the Scoreboard chart.`;
  }
  if (ok.length) {
    const parts = [`Research notes for ${ok.map((row) => row.symbol).join(', ')}.`];
    if (chart && chart.ok && Number.isFinite(chart.last && chart.last.close)) {
      parts.push(
        `Cached ${chart.symbol} ${chart.interval} last bar ${chart.last.dateUtc || chart.last.timestamp} close ${chart.last.close} (${chart.barCount} bars).`
      );
    } else if (chart && chart.ok === false) {
      parts.push('Chart cache is empty after refresh — no invented prices.');
    }
    const headlines = (search && search.results) || [];
    const news = headlines.filter((row) => row.source === 'yahoo-news' || row.source === 'duckduckgo').slice(0, 2);
    if (news.length) {
      parts.push(`Recent: ${news.map((row) => row.title).join('; ')}.`);
    }
    parts.push('Entry thoughts are research-only and tied to the chart plus those headlines.');
    return parts.join(' ');
  }
  return null;
}

export function createStubProvider({ catalog } = {}) {
  const cat = catalog || defaultCatalog();
  return {
    id: 'stub',
    model: null,
    async complete(messages) {
      const tools = allToolResults(messages);
      const userText = lastUserText(messages);
      const search = latestTool(tools, 'search_assets');
      const resolve = latestTool(tools, 'resolve_assets');
      const refresh = latestTool(tools, 'refresh_series');
      const chart = latestTool(tools, 'get_chart_context');
      const web = latestTool(tools, 'web_search');

      if (search && !resolve) {
        const queries = (search.result.hits || []).map((hit) => hit.query || hit.symbol).filter(Boolean);
        return {
          toolCalls: [{
            id: 'stub_resolve',
            name: 'resolve_assets',
            args: { queries: queries.length ? queries : ['__none__'] }
          }]
        };
      }

      if (resolve) {
        const rows = resolve.result.results || [];
        const ok = rows.filter((row) => row && row.ok);
        if (namedTickerResearch(userText, rows)) {
          if (!refresh) {
            return {
              toolCalls: ok.map((row, index) => ({
                id: `stub_refresh_${index}`,
                name: 'refresh_series',
                args: { symbol: row.symbol, scoreboardId: row.scoreboardId }
              }))
            };
          }
          if (!chart) {
            return {
              toolCalls: ok.map((row, index) => ({
                id: `stub_chart_${index}`,
                name: 'get_chart_context',
                args: { scoreboardId: row.scoreboardId }
              }))
            };
          }
          if (!web) {
            const symbols = ok.map((row) => row.symbol).join(' ');
            return {
              toolCalls: [{
                id: 'stub_web',
                name: 'web_search',
                args: { query: `${symbols} ${userText}`.trim() }
              }]
            };
          }
        }
        return {
          content: cardsFromResolved(rows, {
            summary: stubSummary(userText, rows, {
              chart: chart && chart.result,
              search: web && web.result
            })
          })
        };
      }

      const intent = stubIntent(userText, cat);
      if (intent.search) {
        return {
          toolCalls: [{
            id: 'stub_search',
            name: 'search_assets',
            args: { naturalQuery: userText }
          }]
        };
      }
      if (intent.queries.length) {
        return {
          toolCalls: [{
            id: 'stub_resolve',
            name: 'resolve_assets',
            args: { queries: intent.queries }
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          markdown: [
            'I can research listed US tickers and catalog crypto, then attach tappable cards after tools resolve them.',
            'Ask about a ticker (CDNS, MSTR, BTC), or try “what are 5 crypto coins that are doing buybacks”, “load SKR”, “compare MSTR vs BTC”.'
          ].join(' ')
        }]
      };
    }
  };
}
