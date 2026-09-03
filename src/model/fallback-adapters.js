import { loadCSV, loadJSON, parseCSV } from './ingest.js';
import { httpGet, parseJsonBody } from './http.js';
import { firstRowTimestamp } from './dates.js';
import { pickEtfMillions } from './overlays.js';

export const FARSIDE_URLS = {
  BTC: [
    'https://farside.co.uk/btc/',
    'https://farside.co.uk/bitcoin-etf-flow-all-data/'
  ],
  ETH: [
    'https://farside.co.uk/eth/',
    'https://farside.co.uk/ethereum-etf-flow-all-data/'
  ]
};

export const COINGECKO_TOP100_URL = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false';

const ETF_PACK = {
  BTC: 'etf_btc_daily_net_flows.csv',
  ETH: 'etf_eth_daily_net_flows.csv'
};

function parseFlowNumber(value) {
  const text = String(value ?? '').trim().replace(/,/g, '').replace(/\$/g, '');
  if (!text || text === '-' || text === '–' || text === '—') return null;
  const paren = text.match(/^\((.+)\)$/);
  if (paren) {
    const n = Number(paren[1]);
    return Number.isFinite(n) ? -n : null;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function parseFarsideHtml(html) {
  const tables = String(html || '').match(/<table[\s\S]*?<\/table>/gi) || [];
  const rows = [];

  for (const table of tables) {
    const trs = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    if (trs.length < 2) continue;
    const headers = (trs[0].match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || [])
      .map((cell) => stripTags(cell).toLowerCase());
    if (!headers.some((h) => h.includes('date'))) continue;

    let totalIdx = headers.findIndex((h) => h === 'total' || h.includes('total'));
    if (totalIdx < 0) totalIdx = headers.length - 1;

    for (let i = 1; i < trs.length; i++) {
      const cells = (trs[i].match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(stripTags);
      if (!cells.length) continue;
      const dateText = cells[0];
      const timestamp = firstRowTimestamp({ date_utc: dateText, date: dateText });
      if (!timestamp) continue;
      const flow = parseFlowNumber(cells[totalIdx] ?? cells[cells.length - 1]);
      rows.push({
        date_utc: new Date(timestamp).toISOString().slice(0, 10),
        timestamp,
        net_flow_usd_millions: flow
      });
    }
    if (rows.length) break;
  }

  return rows;
}

export function normalizeEtfRow(row, { symbol, source = 'etf-farside' } = {}) {
  const timestamp = firstRowTimestamp(row);
  if (!Number.isFinite(timestamp)) return null;
  const millions = pickEtfMillions(row);
  const fallback = parseFlowNumber(row.total ?? row.net_flow ?? row.flow);
  return {
    source,
    symbol,
    interval: '1d',
    timestamp,
    date_utc: row.date_utc || new Date(timestamp).toISOString().slice(0, 10),
    net_flow_usd_millions: millions != null ? millions : fallback
  };
}

function packEtfRows(symbol) {
  const loaded = loadCSV(ETF_PACK[symbol]);
  if (loaded.missing || !loaded.data) return [];
  return loaded.data;
}

export function createEtfAdapter({
  symbol = 'BTC',
  httpGet: http = httpGet
} = {}) {
  const upper = String(symbol || 'BTC').toUpperCase();
  return {
    id: 'etf-farside',
    symbol: upper,
    interval: '1d',
    mode: 'bounded-overlap',
    async fetchSince() {
      const requestUrls = FARSIDE_URLS[upper] || FARSIDE_URLS.BTC;
      let scraped = [];
      let used = 'pack';

      for (const url of requestUrls) {
        try {
          const response = await http(url);
          if (!response.ok) continue;
          if (response.text.includes('<table')) {
            scraped = parseFarsideHtml(response.text);
          } else if (/,/.test(response.text) && /date/i.test(response.text.slice(0, 200))) {
            scraped = parseCSV(response.text);
          }
          if (scraped.length) {
            used = url;
            break;
          }
        } catch {
          continue;
        }
      }

      const raw = scraped.length ? scraped : packEtfRows(upper);
      const rows = raw
        .map((row) => normalizeEtfRow(row, { symbol: upper }))
        .filter(Boolean);

      return {
        rows,
        nextCursor: null,
        requestUrls,
        requestedSince: null,
        fallback: used === 'pack' ? 'pack-or-empty' : 'html',
        note: 'Bounded-overlap fallback: cursor is ignored. Re-fetches/re-parses the whole small table or pack CSV and dedupes by date. Not a true incremental cursor.'
      };
    }
  };
}

export function normalizeCoinGeckoMarkets(payload) {
  const list = Array.isArray(payload)
    ? payload
    : (payload && (payload.coins || payload.data || payload.markets)) || [];

  return list.map((coin) => ({
    id: coin.id || coin.asset_id || null,
    symbol: coin.symbol ? String(coin.symbol).toUpperCase() : null,
    name: coin.name || null,
    market_cap: Number.isFinite(Number(coin.market_cap)) ? Number(coin.market_cap) : null,
    category: coin.category || coin.categories || null
  })).filter((coin) => coin.symbol || coin.id);
}

export function createCoinGeckoAdapter({
  httpGet: http = httpGet
} = {}) {
  return {
    id: 'coingecko-top100',
    symbol: 'TOP100',
    interval: '1d',
    mode: 'bounded-overlap',
    async fetchSince() {
      let coins = [];
      let used = 'pack';
      let error = null;

      try {
        const response = await http(COINGECKO_TOP100_URL);
        if (response.status === 429) {
          error = 'CoinGecko 429 rate limit';
        } else if (response.ok) {
          const body = parseJsonBody(response.text);
          coins = normalizeCoinGeckoMarkets(body);
          if (coins.length) used = 'coingecko';
        } else {
          error = `CoinGecko HTTP ${response.status}`;
        }
      } catch (err) {
        error = err.message;
      }

      if (!coins.length) {
        const pack = loadJSON('cg_top100_universe.json');
        if (!pack.missing && pack.data) {
          coins = normalizeCoinGeckoMarkets(pack.data);
        }
      }

      const updated = Date.now();
      const snapshot = {
        source: 'coingecko-top100',
        symbol: 'TOP100',
        interval: '1d',
        timestamp: updated,
        updated,
        coins,
        note: coins.some((c) => c.category) ? null : (error || 'Universe categories stay blank when CoinGecko 429s. Not invented.')
      };

      return {
        rows: coins.length ? [{ ...snapshot }] : [],
        nextCursor: null,
        requestUrls: [COINGECKO_TOP100_URL],
        requestedSince: null,
        snapshot,
        fallback: used,
        note: 'Bounded-overlap fallback: cursor is ignored. Re-fetches the whole top100 page (or re-parses the pack JSON on 429) and replaces the snapshot. Not a true incremental cursor.'
      };
    }
  };
}
