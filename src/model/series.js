import { loadAllData, getFixtureData } from './ingest.js';
import { addIndicators } from './indicators.js';

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
  
  getSeries(symbol, interval = '1d', from = null, to = null, fields = null) {
    if (!this.data) {
      this.load();
    }
    
    let series = null;
    
    if (this.data.indicators && this.data.indicators.data.length > 0) {
      const symbolUpper = symbol.toUpperCase();
      const indicators = this.data.indicators.data;
      
      const symbolData = indicators.filter(row => 
        row.symbol && row.symbol.toUpperCase() === symbolUpper
      );
      
      if (symbolData.length > 0) {
        series = symbolData.map(row => ({
          date_utc: row.date_utc,
          timestamp: row.date_utc ? new Date(row.date_utc + 'T00:00:00Z').getTime() : Date.now(),
          open: row.open || 0,
          high: row.high || 0,
          low: row.low || 0,
          close: row.close || 0,
          volume: row.volume || 0,
          ma20: row.ma20,
          ma50: row.ma50,
          ma100: row.ma100,
          ma200: row.ma200,
          tenkan: row.tenkan,
          kijun: row.kijun,
          senkouA: row.senkou_a,
          senkouB: row.senkou_b,
          chikou: row.chikou
        }));
      }
    }
    
    if (!series || series.length === 0) {
      if (symbol === 'BTC' || symbol === 'BTCUSDT') {
        const key = interval === '1h' ? 'oi_1h' : 'oi_1d';
        series = this.data[key].data;
        
        if (series.length === 0 && this.data[key].missing) {
          const candleKey = interval === '1h' ? 'candles_1h' : 'candles_1d';
          series = this.data[candleKey].data;
          
          if (series.length === 0) {
            throw new Error(`No data available for ${symbol} ${interval}`);
          }
        }
      } else {
        throw new Error(`No data available for ${symbol} ${interval}`);
      }
    }

    let filtered = series;
    
    if (from) {
      const fromTs = new Date(from).getTime();
      filtered = filtered.filter(row => {
        const ts = row.timestamp || row.time || 0;
        return ts >= fromTs;
      });
    }
    
    if (to) {
      const toTs = new Date(to).getTime();
      filtered = filtered.filter(row => {
        const ts = row.timestamp || row.time || 0;
        return ts <= toTs;
      });
    }
    
    if (fields) {
      const fieldList = fields.split(',');
      filtered = filtered.map(row => {
        const result = {};
        fieldList.forEach(field => {
          if (row.hasOwnProperty(field.trim())) {
            result[field.trim()] = row[field.trim()];
          }
        });
        return result;
      });
    }
    
    return filtered;
  }
  
  getIndicators(symbol, interval = '1d') {
    const series = this.getSeries(symbol, interval);
    if (series.length === 0) return [];
    
    if (series[0] && series[0].ma20 !== undefined) {
      return series;
    }
    
    return addIndicators(series);
  }
  
  getSignals(symbol) {
    if (!this.data) {
      this.load();
    }
    
    const signals = {};
    
    if (this.data.etf_btc && this.data.etf_btc.data.length > 0) {
      const recent = this.data.etf_btc.data.slice(-7);
      const totalFlow = recent.reduce((sum, row) => sum + (row.net_flow || 0), 0);
      signals.etf = {
        net_flow: totalFlow,
        days: recent.length
      };
    }
    
    if (this.data.oi_1d && this.data.oi_1d.data.length > 0) {
      const latest = this.data.oi_1d.data[this.data.oi_1d.data.length - 1];
      const weekAgo = this.data.oi_1d.data[Math.max(0, this.data.oi_1d.data.length - 8)];
      signals.oi = {
        current: latest.oi || latest.open_interest || 0,
        change: weekAgo && weekAgo.oi ? ((latest.oi - weekAgo.oi) / weekAgo.oi * 100) : 0
      };
    }
    
    if (this.data.ratios && this.data.ratios.data.length > 0) {
      const latest = this.data.ratios.data[this.data.ratios.data.length - 1];
      signals.alt_btc = {
        ratio: latest.alt_btc_ratio || 0,
        trend: latest.trend || 'neutral'
      };
    }
    
    return signals;
  }
  
  getMissingFiles() {
    if (!this.data) {
      this.load();
    }
    return this.data.missing || [];
  }
  
  getUniverse() {
    if (!this.data) {
      this.load();
    }
    
    if (!this.data.universe.missing) {
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
