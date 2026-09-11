import { httpGet, parseJsonBody } from '../http.js';

export const WEB_SEARCH_NOTE = [
  'Keyless public search: Yahoo Finance search (quotes + news),',
  'DuckDuckGo HTML, and Wikipedia opensearch.',
  'Snippets are source excerpts, not invented prices.'
].join(' ');

const SEARCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Scoreboard/1.0; public research; no keys)',
  Accept: 'application/json,text/html;q=0.9,*/*;q=0.8'
};

function decodeEntities(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeDuckDuckGoHref(href) {
  const raw = String(href || '');
  const match = raw.match(/[?&]uddg=([^&]+)/);
  if (!match) {
    if (raw.startsWith('http')) return raw;
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function parseDuckDuckGoHtml(html) {
  const text = String(html || '');
  const results = [];
  const blockRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match = blockRe.exec(text);
  while (match && results.length < 8) {
    const url = decodeDuckDuckGoHref(match[1]);
    const title = decodeEntities(match[2]);
    const snippet = decodeEntities(match[3]);
    if (title && url) {
      results.push({ title, url, snippet, source: 'duckduckgo' });
    }
    match = blockRe.exec(text);
  }
  return results;
}

export function parseYahooSearchBody(body) {
  const quotes = (body && body.quotes) || [];
  const news = (body && body.news) || [];
  const results = [];
  for (const quote of quotes.slice(0, 6)) {
    if (!quote || !quote.symbol) continue;
    results.push({
      title: `${quote.symbol} — ${quote.shortname || quote.longname || quote.quoteType || 'quote'}`,
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(quote.symbol)}`,
      snippet: [quote.quoteType, quote.exchDisp || quote.exchange, quote.shortname || quote.longname]
        .filter(Boolean)
        .join(' · '),
      source: 'yahoo-quote',
      symbol: String(quote.symbol).toUpperCase(),
      quoteType: quote.quoteType || null
    });
  }
  for (const item of news.slice(0, 8)) {
    if (!item || !item.title) continue;
    results.push({
      title: item.title,
      url: item.link || null,
      snippet: [item.publisher, item.relatedTickers && item.relatedTickers.join(', ')]
        .filter(Boolean)
        .join(' · '),
      source: 'yahoo-news',
      publishedAt: item.providerPublishTime
        ? new Date(Number(item.providerPublishTime) * 1000).toISOString()
        : null
    });
  }
  return results;
}

export function parseWikipediaOpensearch(body) {
  if (!Array.isArray(body) || body.length < 4) return [];
  const titles = body[1] || [];
  const descriptions = body[2] || [];
  const urls = body[3] || [];
  const results = [];
  for (let i = 0; i < titles.length && results.length < 3; i += 1) {
    if (!titles[i] || !urls[i]) continue;
    results.push({
      title: titles[i],
      url: urls[i],
      snippet: descriptions[i] || '',
      source: 'wikipedia'
    });
  }
  return results;
}

async function safeGet(http, url) {
  const response = await http(url, { headers: SEARCH_HEADERS });
  return response;
}

export async function webSearch(query, { httpGet: http = httpGet } = {}) {
  const q = String(query || '').trim();
  if (!q) return { query: q, results: [], note: 'empty query' };

  const results = [];
  const errors = [];
  const requestUrls = [];

  const yahooUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=8`;
  requestUrls.push(yahooUrl);
  try {
    const response = await safeGet(http, yahooUrl);
    const body = parseJsonBody(response.text);
    if (response.ok && body) {
      results.push(...parseYahooSearchBody(body));
    } else {
      errors.push(`Yahoo search HTTP ${response.status}`);
    }
  } catch (error) {
    errors.push(error.message || 'Yahoo search failed');
  }

  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  requestUrls.push(ddgUrl);
  try {
    const response = await safeGet(http, ddgUrl);
    if (response.ok) {
      results.push(...parseDuckDuckGoHtml(response.text));
    } else {
      errors.push(`DuckDuckGo HTTP ${response.status}`);
    }
  } catch (error) {
    errors.push(error.message || 'DuckDuckGo search failed');
  }

  const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=3&namespace=0&format=json`;
  requestUrls.push(wikiUrl);
  try {
    const response = await safeGet(http, wikiUrl);
    const body = parseJsonBody(response.text);
    if (response.ok && body) {
      results.push(...parseWikipediaOpensearch(body));
    }
  } catch (error) {
    errors.push(error.message || 'Wikipedia search failed');
  }

  const seen = new Set();
  const unique = [];
  for (const row of results) {
    const key = `${row.source}|${row.url || row.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  return {
    query: q,
    results: unique.slice(0, 12),
    requestUrls,
    note: unique.length
      ? WEB_SEARCH_NOTE
      : `${WEB_SEARCH_NOTE} No snippets returned.${errors.length ? ` ${errors.join('; ')}` : ''}`
  };
}
