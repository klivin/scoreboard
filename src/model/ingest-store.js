import { firstRowTimestamp } from './dates.js';
import { seriesRowId, upsertByNaturalKey } from './source-adapter.js';

export function toStoreRows(rows, { source, symbol, interval }) {
  return (rows || []).map((row) => {
    const timestamp = row.timestamp != null ? row.timestamp : firstRowTimestamp(row);
    return {
      ...row,
      source,
      symbol: String(symbol || row.symbol || '').toUpperCase(),
      interval,
      timestamp,
      id: seriesRowId(source, symbol || row.symbol, interval, timestamp)
    };
  }).filter((row) => Number.isFinite(row.timestamp));
}

export function upsertSeriesPage(store, rows) {
  if (typeof store.upsertMany === 'function') {
    return store.upsertMany(rows);
  }

  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = store.getById(row.id);
    if (existing && typeof store.update === 'function') {
      store.update(row.id, row);
      updated += 1;
    } else if (typeof store.upsert === 'function') {
      const result = store.upsert(row.id, row);
      if (result && result.inserted === false) updated += 1;
      else inserted += 1;
    } else {
      store.add(row);
      inserted += 1;
    }
  }
  const all = store.getAll();
  return { inserted, updated, total: all.length };
}

export function rowsForAdapter(store, source, symbol, interval) {
  const items = store.getAll() || [];
  const upper = String(symbol || '').toUpperCase();
  return items.filter((item) => (
    item.source === source
    && String(item.symbol || '').toUpperCase() === upper
    && item.interval === interval
  ));
}

export function overlayByTimestamp(packRows, storeRows) {
  const map = new Map();
  for (const row of packRows || []) {
    const timestamp = firstRowTimestamp(row);
    if (!Number.isFinite(timestamp)) continue;
    map.set(timestamp, { ...row, timestamp });
  }
  for (const row of storeRows || []) {
    if (!row || !Number.isFinite(row.timestamp)) continue;
    map.set(row.timestamp, { ...row });
  }
  return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function setPackRows(pack, key, filename, rows, missingIfEmpty = false) {
  if (!pack[key]) {
    pack[key] = { data: rows, missing: missingIfEmpty && rows.length === 0, filename };
    return;
  }
  pack[key] = {
    ...pack[key],
    data: rows,
    missing: missingIfEmpty ? rows.length === 0 : (pack[key].missing && rows.length === 0)
  };
}

export function applySeriesStoreToPack(pack, seriesItems) {
  if (!pack) return pack;
  const items = seriesItems || [];

  const candles1h = items.filter((row) => row.source === 'okx-candles' && row.interval === '1h');
  const candles1d = items.filter((row) => row.source === 'okx-candles' && row.interval === '1d');
  const oi1h = items.filter((row) => row.source === 'okx-oi' && row.interval === '1h');
  const oi1d = items.filter((row) => row.source === 'okx-oi' && row.interval === '1d');
  const etfBtc = items.filter((row) => row.source === 'etf-farside' && String(row.symbol).toUpperCase() === 'BTC');
  const etfEth = items.filter((row) => row.source === 'etf-farside' && String(row.symbol).toUpperCase() === 'ETH');

  if (candles1h.length) {
    setPackRows(pack, 'candles_1h', 'okx_btc_usdt_swap_candles_1h.csv', overlayByTimestamp(pack.candles_1h && pack.candles_1h.data, candles1h));
  }
  if (candles1d.length) {
    setPackRows(pack, 'candles_1d', 'okx_btc_usdt_swap_candles_1d.csv', overlayByTimestamp(pack.candles_1d && pack.candles_1d.data, candles1d));
  }
  if (oi1h.length) {
    setPackRows(pack, 'oi_swap_1h', 'okx_btc_usdt_swap_oi_1h.csv', overlayByTimestamp(pack.oi_swap_1h && pack.oi_swap_1h.data, oi1h));
  }
  if (oi1d.length) {
    setPackRows(pack, 'oi_swap_1d', 'okx_btc_usdt_swap_oi_1d.csv', overlayByTimestamp(pack.oi_swap_1d && pack.oi_swap_1d.data, oi1d));
  }
  if (etfBtc.length) {
    setPackRows(pack, 'etf_btc', 'etf_btc_daily_net_flows.csv', overlayByTimestamp(pack.etf_btc && pack.etf_btc.data, etfBtc));
  }
  if (etfEth.length) {
    setPackRows(pack, 'etf_eth', 'etf_eth_daily_net_flows.csv', overlayByTimestamp(pack.etf_eth && pack.etf_eth.data, etfEth));
  }

  return pack;
}

export { upsertByNaturalKey };
