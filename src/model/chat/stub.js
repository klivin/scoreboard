import { defaultCatalog, findCatalogMentions } from './catalog.js';
import { cardsFromResolved, flattenContent, NFA_DISCLAIMER } from './blocks.js';

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg && msg.role === 'user') return flattenContent(msg.content);
  }
  return '';
}

function trailingToolResults(messages) {
  const out = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== 'tool') break;
    let parsed = msg.result;
    if (parsed == null && typeof msg.content === 'string') {
      try {
        parsed = JSON.parse(msg.content);
      } catch {
        parsed = {};
      }
    }
    out.unshift({ name: msg.name, result: parsed || {} });
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
    return { search: false, queries: splitCompareParts(loadMatch[1]) };
  }

  if (/\bcompare\b/i.test(raw) || /\bvs\.?\b/i.test(raw)) {
    const mentions = findCatalogMentions(raw, catalog);
    if (mentions.length) return { search: false, queries: mentions };
    return { search: false, queries: splitCompareParts(raw) };
  }

  const mentions = findCatalogMentions(raw, catalog);
  if (mentions.length) return { search: false, queries: mentions };
  return { search: false, queries: [] };
}

function stubSummary(userText, results) {
  const ok = (results || []).filter((row) => row && row.ok);
  const lower = String(userText || '').toLowerCase();
  if (/\b(buyback|buybacks|burn|burns)\b/.test(lower) && ok.length) {
    return [
      `Five catalog names often discussed for token burns / buybacks: ${ok.map((row) => row.symbol).join(', ')}.`,
      'This is a static research list, not a live on-chain scan.',
      NFA_DISCLAIMER
    ].join(' ');
  }
  if (/\bcompare\b/i.test(userText) && ok.length >= 2) {
    return `Side-by-side research notes for ${ok.map((row) => row.symbol).join(' vs ')}. Tap a card to load that asset on Overview (daily/hourly via Load Data). ${NFA_DISCLAIMER}`;
  }
  if (/^\s*load\s+/i.test(userText) && ok.length) {
    return `Resolved ${ok.map((row) => row.symbol).join(', ')}. Tap the card to load the Scoreboard chart. ${NFA_DISCLAIMER}`;
  }
  if (ok.length) {
    return `Research-only notes for ${ok.map((row) => row.symbol).join(', ')}. ${NFA_DISCLAIMER}`;
  }
  return null;
}

export function createStubProvider({ catalog } = {}) {
  const cat = catalog || defaultCatalog();
  return {
    id: 'stub',
    model: null,
    async complete(messages) {
      const tools = trailingToolResults(messages);
      const userText = lastUserText(messages);
      const search = [...tools].reverse().find((row) => row.name === 'search_assets');
      const resolve = [...tools].reverse().find((row) => row.name === 'resolve_assets');

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
        return {
          content: cardsFromResolved(resolve.result.results || [], {
            summary: stubSummary(userText, resolve.result.results || [])
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
            'I can research catalog assets (crypto, a few equities/ETFs) and attach tappable cards after tools resolve them.',
            'Examples: “what are 5 crypto coins that are doing buybacks”, “load SKR”, “compare MSTR vs BTC”.',
            NFA_DISCLAIMER
          ].join(' ')
        }]
      };
    }
  };
}
