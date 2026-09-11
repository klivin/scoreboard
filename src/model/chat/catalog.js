export const PACK_SYMBOLS = [
  'AVAX', 'BNB', 'BTC', 'DOGE', 'ETH', 'LINK', 'PEPE', 'SHIB', 'SOL', 'SUI', 'TRUMP', 'XRP'
];

const STATIC_ASSETS = [
  {
    symbol: 'BTC', name: 'Bitcoin', assetClass: 'crypto', venue: 'okx',
    aliases: ['bitcoin', 'xbt', 'btc-usdt'],
    blurb: 'Largest crypto by market cap. Scoreboard has Flow-pack + OKX BTC-USDT-SWAP series.',
    strategyConsiderations: [
      'Use Overview 1d and 1h (OKX swap) separately; do not interpolate.'
    ]
  },
  {
    symbol: 'ETH', name: 'Ethereum', assetClass: 'crypto', venue: 'okx',
    aliases: ['ethereum', 'ether'],
    blurb: 'Smart-contract platform. Pack has daily indicators; 1h may be missing until ingest exists.',
    strategyConsiderations: [
      'ETH 1h is not in the original Flow pack; missing stays missing.'
    ]
  },
  {
    symbol: 'SOL', name: 'Solana', assetClass: 'crypto', venue: 'flow-pack',
    aliases: ['solana'],
    blurb: 'High-throughput L1. Daily pack series when present.',
    strategyConsiderations: ['Daily pack series when present; missing stays missing.']
  },
  {
    symbol: 'AVAX', name: 'Avalanche', assetClass: 'crypto', venue: 'flow-pack',
    aliases: ['avalanche']
  },
  {
    symbol: 'DOGE', name: 'Dogecoin', assetClass: 'crypto', venue: 'flow-pack',
    aliases: ['dogecoin']
  },
  {
    symbol: 'LINK', name: 'Chainlink', assetClass: 'crypto', venue: 'flow-pack',
    aliases: ['chainlink']
  },
  {
    symbol: 'PEPE', name: 'Pepe', assetClass: 'crypto', venue: 'flow-pack',
    aliases: []
  },
  {
    symbol: 'SHIB', name: 'Shiba Inu', assetClass: 'crypto', venue: 'flow-pack',
    aliases: ['shiba']
  },
  {
    symbol: 'SUI', name: 'Sui', assetClass: 'crypto', venue: 'flow-pack',
    aliases: []
  },
  {
    symbol: 'TRUMP', name: 'Official Trump', assetClass: 'crypto', venue: 'flow-pack',
    aliases: []
  },
  {
    symbol: 'XRP', name: 'XRP', assetClass: 'crypto', venue: 'flow-pack',
    aliases: ['ripple']
  },
  {
    symbol: 'BNB', name: 'BNB', assetClass: 'crypto', venue: 'binance',
    aliases: ['binance coin', 'binance'],
    tags: ['buyback', 'burn'],
    blurb: 'Binance exchange token. Historically uses a quarterly burn / BNB Auto-Burn program (research catalog, not a live on-chain feed).',
    strategyConsiderations: [
      'Burn schedule and amount change; confirm on the issuer’s current disclosures.',
      'Exchange-token risk is tied to Binance venue and regulatory outcomes.'
    ]
  },
  {
    symbol: 'MKR', name: 'Maker', assetClass: 'crypto', venue: 'research',
    aliases: ['maker', 'makerdao'],
    tags: ['buyback', 'burn'],
    blurb: 'Maker / Sky surplus has historically bought and burned MKR (research catalog).',
    strategyConsiderations: [
      'Protocol buybacks depend on surplus and governance — not a guaranteed schedule.',
      'Ticker / rebrand risk (Sky / new tokens) — resolve the listing before charting.'
    ]
  },
  {
    symbol: 'OKB', name: 'OKB', assetClass: 'crypto', venue: 'okx',
    aliases: [],
    tags: ['buyback', 'burn'],
    blurb: 'OKX exchange token. Issuer has run buyback-and-burn programs (research catalog).',
    strategyConsiderations: [
      'Exchange-token supply changes with issuer policy, not a protocol fee switch.'
    ]
  },
  {
    symbol: 'LEO', name: 'UNUS SED LEO', assetClass: 'crypto', venue: 'research',
    aliases: ['unus sed leo', 'bitfinex leo'],
    tags: ['buyback', 'burn'],
    blurb: 'iFinex / Bitfinex utility token with a long-running repurchase program (research catalog).',
    strategyConsiderations: [
      'Repurchases are issuer-discretionary and venue-specific.'
    ]
  },
  {
    symbol: 'KCS', name: 'KuCoin Token', assetClass: 'crypto', venue: 'research',
    aliases: ['kucoin', 'kucoin token'],
    tags: ['buyback', 'burn'],
    blurb: 'KuCoin exchange token; historical daily buyback-and-burn (research catalog).',
    strategyConsiderations: [
      'Exchange-token burns can pause or change without on-chart warning.'
    ]
  },
  {
    symbol: 'SKR', name: 'SKR', assetClass: 'crypto', venue: 'research',
    aliases: [],
    blurb: 'SKR is in the research catalog so Chat can resolve “load SKR”. Confirm the venue; Overview series may be missing until free-text ticker ingest lands.',
    strategyConsiderations: [
      'If Load Data errors, the symbol resolved but no cached OHLC exists — that is not a fake chart.'
    ]
  },
  {
    symbol: 'MSTR', name: 'Strategy (MicroStrategy)', assetClass: 'equity', venue: 'nasdaq',
    aliases: ['microstrategy', 'strategy', 'mstr'],
    blurb: 'Public equity known for a large Bitcoin treasury. Not a coin — charting needs an equity adapter (PR #14).',
    strategyConsiderations: [
      'Equity path is not the OKX swap ingest. Missing series stay missing — no invented bars.',
      'BTC treasury correlation is not the same as holding BTC.'
    ]
  },
  {
    symbol: 'COIN', name: 'Coinbase', assetClass: 'equity', venue: 'nasdaq',
    aliases: ['coinbase']
  },
  {
    symbol: 'TSLA', name: 'Tesla', assetClass: 'equity', venue: 'nasdaq',
    aliases: ['tesla']
  },
  {
    symbol: 'AAPL', name: 'Apple', assetClass: 'equity', venue: 'nasdaq',
    aliases: ['apple']
  },
  {
    symbol: 'NVDA', name: 'NVIDIA', assetClass: 'equity', venue: 'nasdaq',
    aliases: ['nvidia']
  },
  {
    symbol: 'IBIT', name: 'iShares Bitcoin Trust', assetClass: 'etf', venue: 'research',
    aliases: ['ibit'],
    blurb: 'Spot Bitcoin ETF wrapper. Not interchangeable with OKX BTC-USDT-SWAP.'
  },
  {
    symbol: 'SPY', name: 'SPDR S&P 500 ETF', assetClass: 'etf', venue: 'research',
    aliases: ['s&p 500', 'spx']
  },
  {
    symbol: 'QQQ', name: 'Invesco QQQ', assetClass: 'etf', venue: 'research',
    aliases: ['nasdaq-100']
  }
];

function scoreboardIdFor(asset) {
  return `${asset.assetClass}:${asset.symbol}`;
}

function withDefaults(asset) {
  return {
    aliases: [],
    tags: [],
    blurb: asset.blurb || `${asset.name} (${asset.symbol}).`,
    strategyConsiderations: asset.strategyConsiderations || [
      'Confirm series on Overview; missing data stays missing.'
    ],
    ...asset,
    symbol: String(asset.symbol).toUpperCase(),
    scoreboardId: scoreboardIdFor(asset)
  };
}

export function buildCatalog({ extra = [] } = {}) {
  const byId = new Map();
  for (const raw of [...STATIC_ASSETS, ...extra]) {
    if (!raw || !raw.symbol) continue;
    const asset = withDefaults(raw);
    byId.set(asset.scoreboardId, asset);
  }
  return [...byId.values()];
}

export function defaultCatalog() {
  return buildCatalog();
}

function normalizeQueryToken(raw) {
  return String(raw || '')
    .trim()
    .replace(/^\$/, '')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

export function findCatalogMentions(text, catalog = defaultCatalog()) {
  const lower = ` ${String(text || '').toLowerCase()} `;
  const hits = [];
  for (const asset of catalog) {
    const needles = [asset.symbol.toLowerCase(), ...(asset.aliases || []).map((a) => a.toLowerCase())];
    const matched = needles.some((needle) => {
      if (!needle) return false;
      if (needle.includes(' ')) return lower.includes(` ${needle} `) || lower.includes(needle);
      const re = new RegExp(`(?:^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`, 'i');
      return re.test(String(text || ''));
    });
    if (matched && !hits.includes(asset.symbol)) hits.push(asset.symbol);
  }
  return hits;
}

export function lookupAsset(query, catalog = defaultCatalog()) {
  const token = normalizeQueryToken(query);
  if (!token) return null;
  const upper = token.toUpperCase();
  const lower = token.toLowerCase();
  return catalog.find((asset) => (
    asset.symbol === upper
    || (asset.aliases || []).some((alias) => alias.toLowerCase() === lower)
  )) || null;
}

export function parseScoreboardId(scoreboardId) {
  const raw = String(scoreboardId || '');
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const assetClass = raw.slice(0, idx);
  const symbol = raw.slice(idx + 1).toUpperCase();
  if (!symbol) return null;
  return { assetClass, symbol, scoreboardId: `${assetClass}:${symbol}` };
}
