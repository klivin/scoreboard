import { loadAllData } from './ingest.js';
import { addIndicators } from './indicators.js';
import { parseUtcTimestamp } from './dates.js';

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

export function mapIndicatorRow(row) {
  return {
    date_utc: row.date_utc || row.date || null,
    timestamp: parseUtcTimestamp(row.date_utc || row.date, row.timestamp ?? row.ts ?? row.time),
    open: numeric(row.open, row.o) || 0,
    high: numeric(row.high, row.h) || 0,
    low: numeric(row.low, row.l) || 0,
    close: numeric(row.close, row.c) || 0,
    volume: numeric(row.volume, row.vol) || 0,
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
    date_utc: row.date_utc || row.date || null,
    timestamp: parseUtcTimestamp(row.date_utc || row.date, row.timestamp ?? row.ts ?? row.time ?? row.t),
    open: numeric(row.open, row.o, row.Open) || 0,
    high: numeric(row.high, row.h, row.High) || 0,
    low: numeric(row.low, row.l, row.Low) || 0,
    close: numeric(row.close, row.c, row.Close) || 0,
    volume: numeric(row.volume, row.vol, row.volCcy, row.Volume) || 0,
    oi: numeric(row.oi, row.open_interest, row.openInterest)
  };
}

function applyRangeAndFields(series, from, to, fields) {
  let filtered = series.filter((row) => row && row.timestamp);

  if (from) {
    const fromTs = Date.parse(from);
    if (!Number.isNaN(fromTs)) {
      filtered = filtered.filter((row) => row.timestamp >= fromTs);
    }
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
    const key = interval === '1h' ? 'oi_1h' : 'oi_1d';
    const candleKey = interval === '1h' ? 'candles_1h' : 'candles_1d';
    const primary = this.data[key] && this.data[key].data ? this.data[key].data : [];
    const fallback = this.data[candleKey] && this.data[candleKey].data ? this.data[candleKey].data : [];
    const rows = primary.length > 0 ? primary : fallback;
    return rows.map(normalizeCandleRow);
  }

  getSeries(symbol, interval = '1d', from = null, to = null, fields = null) {
    this.ensureLoaded();

    const intervalNorm = interval === '1h' ? '1h' : '1d';
    let series = [];

    if (intervalNorm === '1d') {
      series = this.getDailyFromIndicators(symbol);
    }

    if (series.length === 0 && isBtcSymbol(symbol)) {
      series = this.getBtcCandles(intervalNorm);
    }

    if (!series || series.length === 0) {
      throw new Error(`No data available for ${symbol} ${intervalNorm}`);
    }

    return applyRangeAndFields(series, from, to, fields);
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

    if (symbols.size === 0 && isBtcSymbol('BTC')) {
      const hasBtc = (
        (this.data.oi_1d && this.data.oi_1d.data && this.data.oi_1d.data.length > 0) ||
        (this.data.candles_1d && this.data.candles_1d.data && this.data.candles_1d.data.length > 0)
      );
      if (hasBtc) symbols.add('BTC');
    }

    return [...symbols].sort();
  }

  getSignals(symbol) {
    this.ensureLoaded();

    const signals = {};
    const symbolUpper = String(symbol || 'BTC').toUpperCase();

    const etfKey = symbolUpper === 'ETH' ? 'etf_eth' : 'etf_btc';
    if (this.data[etfKey] && this.data[etfKey].data && this.data[etfKey].data.length > 0) {
      const recent = this.data[etfKey].data.slice(-7);
      const totalFlow = recent.reduce((sum, row) => sum + (numeric(row.net_flow, row.netFlow, row.flow) || 0), 0);
      signals.etf = {
        net_flow: totalFlow,
        days: recent.length
      };
    }

    if (this.data.oi_1d && this.data.oi_1d.data && this.data.oi_1d.data.length > 0) {
      const latest = this.data.oi_1d.data[this.data.oi_1d.data.length - 1];
      const weekAgo = this.data.oi_1d.data[Math.max(0, this.data.oi_1d.data.length - 8)];
      const latestOi = numeric(latest.oi, latest.open_interest, latest.openInterest) || 0;
      const weekOi = weekAgo ? (numeric(weekAgo.oi, weekAgo.open_interest, weekAgo.openInterest) || 0) : 0;
      signals.oi = {
        current: latestOi,
        change: weekOi ? ((latestOi - weekOi) / weekOi * 100) : 0
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

    if (this.data.universe && !this.data.universe.missing && this.data.universe.data) {
      return this.data.universe.data;
    }

    return {
      updated: Date.now(),
      coins: [],
      note: 'Universe data missing - CoinGecko 429 left most categories blank'
    };
  }
}

export const seriesModel = new SeriesModel();
