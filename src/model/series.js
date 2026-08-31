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
  
  getSeries(symbol, from = null, to = null, fields = null) {
    if (!this.data) {
      this.load();
    }
    
    let series = null;
    
    if (symbol === 'BTC' || symbol === 'BTCUSDT') {
      series = this.data.candles_1d.data;
      if (series.length === 0 && this.data.candles_1d.missing) {
        series = getFixtureData('candles');
      }
    }
    
    if (!series || series.length === 0) {
      return [];
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
  
  getIndicators(symbol) {
    const series = this.getSeries(symbol);
    if (series.length === 0) return [];
    
    return addIndicators(series);
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
