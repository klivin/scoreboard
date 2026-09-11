export const STOCK_ADAPTER_ID = 'stock-public';

export const STOCK_MISSING_NOTE = [
  'Stocks need a configured adapter.',
  'No no-key public equity candle source is wired in this repo.',
  'The Flow pack has no stock series.',
  'Prices are not invented and no fake equity OHLC is stored.'
].join(' ');

export function createStockAdapter({
  symbol = '',
  interval = '1d'
} = {}) {
  const upper = String(symbol || '').toUpperCase();
  return {
    id: STOCK_ADAPTER_ID,
    symbol: upper,
    interval,
    mode: 'unconfigured',
    async fetchSince() {
      return {
        rows: [],
        nextCursor: null,
        requestUrls: [],
        requestedSince: null,
        missing: true,
        needsAdapter: true,
        note: STOCK_MISSING_NOTE
      };
    }
  };
}
