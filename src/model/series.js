import { loadAllData } from './ingest.js';
import { addIndicators } from './indicators.js';
import { firstRowTimestamp } from './dates.js';
import {
  attachFlowOverlays,
  pickEtfMillions,
  pickOiContracts,
  pickVolume
} from './overlays.js';
import { applySeriesStoreToPack, overlayByTimestamp } from './ingest-store.js';
import { ingestSeriesStore, ingestWatermarkStore, universeStore } from './store-adapter.js';

function isBtcSymbol(symbol) {
  const upper = String(symbol || '').toUpperCase();
  return upper === 'BTC' || upper === 'BTCUSDT';
}

function numeric(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function filterRowsBySymbol(rows, symbol) {
  const symbolUpper = String(symbol || '').toUpperCase();
  return (rows || []).filter((row) => (
    row && row.symbol && String(row.symbol).toUpperCase() === symbolUpper
  ));
}

export function missingSeriesMessage(symbol, interval) {
  const intervalNorm = interval === '1h' ? '1h' : '1d';
  const sym = String(symbol || '').toUpperCase();
  if (intervalNorm === '1h' && !isBtcSymbol(sym)) {
    return `No 1h series for ${sym}. Hourly OKX candles are ingested for BTC and ETH on Load Data; the Flow pack only includes hourly OKX BTC (okx_btc_usdt_swap_candles_1h.csv). Alt 1h is not interpolated from indicators_daily.csv. Missing readings are not plotted as 0.`;
  }
  if (intervalNorm === '1h' && isBtcSymbol(sym)) {
    return `No 1h series for BTC. Place okx_btc_usdt_swap_candles_1h.csv in /workspace/scoreboard/ or ./data/.`;
  }
  return `No data available for ${sym} ${intervalNorm}`;
}

export function mapIndicatorRow(row) {
  return {
    date_utc: row.datetime_utc || row.date_utc || row.date || null,
    timestamp: firstRowTimestamp(row),
    open: numeric(row.open, row.o),
    high: numeric(row.high, row.h),
    low: numeric(row.low, row.l),
    close: numeric(row.close, row.c),
    volume: pickVolume(row),
    ma20: numeric(row.ma20),
    ma50: numeric(row.ma50),
    ma100: numeric(row.ma100),
    ma200: numeric(row.ma200),
    tenkan: numeric(row.tenkan),
    kijun: numeric(row.kijun),
    senkouA: numeric(row.senkouA, row.senkou_a),
    senkouB: numeric(row.senkouB, row.senkou_b),
    chikou: numeric(row.chikou)
  };
}

export function normalizeCandleRow(row) {
  return {
    date_utc: row.datetime_utc || row.date_utc || row.date || null,
    timestamp: firstRowTimestamp(row),
    open: numeric(row.open, row.o, row.Open),
    high: numeric(row.high, row.h, row.High),
    low: numeric(row.low, row.l, row.Low),
    close: numeric(row.close, row.c, row.Close),
    volume: pickVolume(row),
    oi: pickOiContracts(row)
  };
}

export function calendarDateKey(row) {
  if (!row) return null;
  for (const value of [row.date_utc, row.datetime_utc]) {
    if (value == null || value === '') continue;
    const iso = String(value).trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }
  if (Number.isFinite(row.timestamp)) {
    return new Date(row.timestamp).toISOString().slice(0, 10);
  }
  return null;
}

export function hasFiniteClose(row) {
  return Boolean(row) && Number.isFinite(row.close);
}

export function trimTrailingNonFiniteCloses(rows) {
  const out = Array.isArray(rows) ? rows.slice() : [];
  while (out.length && !hasFiniteClose(out[out.length - 1])) {
    out.pop();
  }
  return out;
}

export function mergeDailyPreferLive(packRows, liveRows) {
  const pack = Array.isArray(packRows) ? packRows : [];
  const live = Array.isArray(liveRows) ? liveRows : [];
  if (pack.length === 0 && live.length === 0) return [];

  const map = new Map();
  for (const row of pack) {
    const key = calendarDateKey(row);
    if (!key) continue;
    // Pack probe rows often extend past the last live day with close:null.
    // Those stubs must not become the chart's last bar. Do not invent closes.
    if (!hasFiniteClose(row)) continue;
    map.set(key, row);
  }
  for (const row of live) {
    const key = calendarDateKey(row);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    map.set(key, {
      ...existing,
      ...row,
      date_utc: row.date_utc || existing.date_utc,
      timestamp: Number.isFinite(row.timestamp) ? row.timestamp : existing.timestamp
    });
  }
  return trimTrailingNonFiniteCloses(
    [...map.values()].sort((a, b) => a.timestamp - b.timestamp)
  );
}

function parseSinceExclusive(since) {
  if (since == null || since === '') return null;
  if (typeof since === 'number' && Number.isFinite(since)) return since;
  const asNumber = Number(since);
  if (Number.isFinite(asNumber) && String(since).trim() !== '') {
    if (asNumber > 1e11) return asNumber;
    if (asNumber > 1e9) return asNumber * 1000;
    if (/^\d+$/.test(String(since).trim()) && asNumber > 0) return asNumber;
  }
  const parsed = Date.parse(since);
  return Number.isNaN(parsed) ? null : parsed;
}

export function resolveSinceCursor(sinceCursor, watermarkItems = []) {
  if (!sinceCursor) return null;
  const items = watermarkItems || [];
  const exact = items.find((item) => item.id === sinceCursor);
  if (exact && Number.isFinite(exact.lastTimestamp)) return exact.lastTimestamp;
  const prefix = items.find((item) => item.id && item.id.startsWith(String(sinceCursor)));
  if (prefix && Number.isFinite(prefix.lastTimestamp)) return prefix.lastTimestamp;
  return null;
}

function applyRangeAndFields(series, from, to, fields, sinceExclusive = null) {
  let filtered = series.filter((row) => row && row.timestamp);

  if (from) {
    const fromTs = Date.parse(from);
    if (!Number.isNaN(fromTs)) {
      filtered = filtered.filter((row) => row.timestamp >= fromTs);
    }
  }

  if (sinceExclusive != null && Number.isFinite(sinceExclusive)) {
    filtered = filtered.filter((row) => row.timestamp > sinceExclusive);
  }

  if (to) {
    const toTs = Date.parse(to);
    if (!Number.isNaN(toTs)) {
      filtered = filtered.filter((row) => row.timestamp <= toTs);
    }
  }

  filtered.sort((a, b) => a.timestamp - b.timestamp);

  if (fields) {
    const fieldList = fields.split(',').map((field) => field.trim()).filter(Boolean);
    filtered = filtered.map((row) => {
      const result = {};
      fieldList.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(row, field)) {
          result[field] = row[field];
        }
      });
      return result;
    });
  }

  return filtered;
}

export class SeriesModel {
  constructor() {
    this.data = null;
    this.lastLoaded = null;
  }

  load() {
    this.data = loadAllData();
    applySeriesStoreToPack(this.data, ingestSeriesStore.getAll());
    this.lastLoaded = Date.now();
    return this.data;
  }

  replaceData(data) {
    this.data = data;
    this.lastLoaded = Date.now();
    return this.data;
  }

  ensureLoaded() {
    if (!this.data) {
      this.load();
    }
  }

  getDailyFromIndicators(symbol) {
    if (!this.data.indicators || !this.data.indicators.data || this.data.indicators.data.length === 0) {
      return [];
    }
    return filterRowsBySymbol(this.data.indicators.data, symbol).map(mapIndicatorRow);
  }

  getBtcCandles(interval) {
    const candleKey = interval === '1h' ? 'candles_1h' : 'candles_1d';
    const candles = this.data[candleKey] && this.data[candleKey].data ? this.data[candleKey].data : [];
    return candles
      .filter((row) => {
        if (!row) return false;
        if (row.symbol == null || row.symbol === '') return true;
        return isBtcSymbol(row.symbol);
      })
      .map(normalizeCandleRow)
      .filter((row) => row && row.timestamp);
  }

  getLiveCandles(symbol, interval) {
    const intervalNorm = interval === '1h' ? '1h' : '1d';
    const upper = String(symbol || '').toUpperCase();
    const live = (this.data.live_candles || [])
      .filter((row) => (
        row
        && (row.source == null || row.source === 'okx-candles')
        && String(row.symbol || '').toUpperCase() === upper
        && (row.interval == null || row.interval === intervalNorm)
      ))
      .map(normalizeCandleRow)
      .filter((row) => row && row.timestamp);
    const packFile = isBtcSymbol(upper) ? this.getBtcCandles(intervalNorm) : [];
    return overlayByTimestamp(packFile, live);
  }

  getSeries(symbol, interval = '1d', from = null, to = null, fields = null, options = {}) {
    this.ensureLoaded();

    const intervalNorm = interval === '1h' ? '1h' : '1d';
    const sinceExclusive = options.sinceExclusive != null
      ? options.sinceExclusive
      : parseSinceExclusive(options.since);
    let series = [];

    if (intervalNorm === '1h') {
      series = this.getLiveCandles(symbol, '1h');
    } else {
      series = mergeDailyPreferLive(
        this.getDailyFromIndicators(symbol),
        this.getLiveCandles(symbol, '1d')
      );
    }

    if (!series || series.length === 0) {
      throw new Error(missingSeriesMessage(symbol, intervalNorm));
    }

    const ranged = applyRangeAndFields(series, from, to, null, sinceExclusive);
    const withOverlays = attachFlowOverlays(ranged, {
      etfRows: this.getEtfRows(symbol),
      oiRows: isBtcSymbol(symbol) ? this.getOiRows(intervalNorm) : [],
      interval: intervalNorm
    });
    return applyRangeAndFields(withOverlays, null, null, fields, sinceExclusive);
  }

  getIndicators(symbol, interval = '1d') {
    const series = this.getSeries(symbol, interval);
    if (series.length === 0) return [];

    if (series[0] && series[0].ma20 !== undefined) {
      return series;
    }

    return addIndicators(series);
  }

  getAvailableSymbols() {
    this.ensureLoaded();
    const symbols = new Set();

    if (this.data.indicators && this.data.indicators.data) {
      for (const row of this.data.indicators.data) {
        if (row.symbol) {
          symbols.add(String(row.symbol).toUpperCase());
        }
      }
    }

    const hasBtcCandles = (
      (this.data.candles_1h && this.data.candles_1h.data && this.data.candles_1h.data.length > 0) ||
      (this.data.candles_1d && this.data.candles_1d.data && this.data.candles_1d.data.length > 0)
    );
    if (hasBtcCandles) symbols.add('BTC');

    for (const row of this.data.live_candles || []) {
      if (row && row.symbol) {
        symbols.add(String(row.symbol).toUpperCase());
      }
    }

    return [...symbols].sort();
  }

  getEtfRows(symbol) {
    this.ensureLoaded();
    const upper = String(symbol || '').toUpperCase();
    const key = upper === 'ETH' ? 'etf_eth' : (isBtcSymbol(upper) ? 'etf_btc' : null);
    if (!key) return [];
    const pack = this.data[key];
    return pack && pack.data && pack.data.length ? pack.data : [];
  }

  getOiRows(interval = '1d') {
    this.ensureLoaded();
    const swapKey = interval === '1h' ? 'oi_swap_1h' : 'oi_swap_1d';
    const joinedKey = interval === '1h' ? 'oi_1h' : 'oi_1d';
    const primary = this.data[swapKey];
    if (primary && primary.data && primary.data.length) return primary.data;
    const fallback = this.data[joinedKey];
    if (fallback && fallback.data && fallback.data.length) return fallback.data;
    return [];
  }

  getSignals(symbol) {
    this.ensureLoaded();

    const signals = {};
    const symbolUpper = String(symbol || 'BTC').toUpperCase();

    const etfRows = this.getEtfRows(symbolUpper);
    if (etfRows.length > 0) {
      const recent = etfRows.slice(-7);
      const millions = recent.map(pickEtfMillions).filter((value) => Number.isFinite(value));
      signals.etf = {
        net_flow_usd_millions: millions.length ? millions.reduce((sum, value) => sum + value, 0) : null,
        days: millions.length
      };
    }

    const oiRows = isBtcSymbol(symbolUpper) ? this.getOiRows('1d') : [];
    if (oiRows.length > 0) {
      const latest = oiRows[oiRows.length - 1];
      const weekAgo = oiRows[Math.max(0, oiRows.length - 8)];
      const latestOi = pickOiContracts(latest);
      const weekOi = pickOiContracts(weekAgo);
      signals.oi = {
        current: Number.isFinite(latestOi) ? latestOi : null,
        change: Number.isFinite(latestOi) && Number.isFinite(weekOi) && weekOi !== 0
          ? ((latestOi - weekOi) / weekOi * 100)
          : null
      };
    }

    if (this.data.ratios && this.data.ratios.data && this.data.ratios.data.length > 0) {
      const latest = this.data.ratios.data[this.data.ratios.data.length - 1];
      signals.alt_btc = {
        ratio: numeric(latest.alt_btc_ratio, latest.ratio) || 0,
        trend: latest.trend || 'neutral'
      };
    }

    return signals;
  }

  getMissingFiles() {
    this.ensureLoaded();
    return this.data.missing || [];
  }

  getUniverse() {
    this.ensureLoaded();

    const stored = (universeStore.getAll() || [])
      .filter((item) => item && (item.coins || item.data))
      .sort((a, b) => (b.updated || b.lastSuccessAt || 0) - (a.updated || a.lastSuccessAt || 0));
    if (stored[0]) {
      const latest = stored[0];
      return {
        updated: latest.updated || latest.timestamp || Date.now(),
        coins: latest.coins || latest.data || [],
        note: latest.note || null,
        source: latest.source || 'coingecko-top100'
      };
    }

    if (this.data.universe && !this.data.universe.missing && this.data.universe.data) {
      return this.data.universe.data;
    }

    return {
      updated: Date.now(),
      coins: [],
      note: 'Universe data missing - CoinGecko 429 left most categories blank'
    };
  }

  resolveExportSince({ since, sinceCursor } = {}) {
    if (sinceCursor) {
      const fromCursor = resolveSinceCursor(sinceCursor, ingestWatermarkStore.getAll());
      if (fromCursor != null) return fromCursor;
    }
    return parseSinceExclusive(since);
  }
}

export const seriesModel = new SeriesModel();
