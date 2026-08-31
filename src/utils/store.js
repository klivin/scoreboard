const fs = require('fs');
const path = require('path');

class LocalStore {
  constructor(baseDir = path.join(__dirname, '../../store')) {
    this.baseDir = baseDir;
    this.collections = ['series', 'forecasts', 'universe', 'error_logs', 'indicators'];
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    
    this.collections.forEach(collection => {
      const collectionPath = path.join(this.baseDir, collection);
      if (!fs.existsSync(collectionPath)) {
        fs.mkdirSync(collectionPath, { recursive: true });
      }
    });
  }

  getPath(collection, id) {
    return path.join(this.baseDir, collection, `${id}.json`);
  }

  save(collection, id, data) {
    const filePath = this.getPath(collection, id);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return { success: true, path: filePath };
  }

  load(collection, id) {
    const filePath = this.getPath(collection, id);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to load ${collection}/${id}: ${error.message}`);
    }
  }

  list(collection) {
    const collectionPath = path.join(this.baseDir, collection);
    if (!fs.existsSync(collectionPath)) {
      return [];
    }
    
    return fs.readdirSync(collectionPath)
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''));
  }

  delete(collection, id) {
    const filePath = this.getPath(collection, id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { success: false, error: 'Not found' };
  }

  saveSeries(series) {
    const id = `${series.symbol}_${series.metadata.interval}`;
    return this.save('series', id, {
      symbol: series.symbol,
      metadata: series.metadata,
      data: series.data
    });
  }

  loadSeries(symbol, interval = '1d') {
    const id = `${symbol}_${interval}`;
    return this.load('series', id);
  }

  saveForecast(forecast) {
    const id = `${forecast.symbol}_${forecast.horizon}_${Date.now()}`;
    return this.save('forecasts', id, forecast.toJSON ? forecast.toJSON() : forecast);
  }

  saveUniverse(universe) {
    return this.save('universe', 'current', universe.toJSON ? universe.toJSON() : universe);
  }

  loadUniverse() {
    return this.load('universe', 'current');
  }

  saveErrorLog(errorLog) {
    const id = new Date().toISOString().split('T')[0];
    return this.save('error_logs', id, errorLog.toJSON ? errorLog.toJSON() : errorLog);
  }

  saveIndicators(symbol, interval, indicators) {
    const id = `${symbol}_${interval}`;
    return this.save('indicators', id, {
      symbol,
      interval,
      indicators,
      timestamp: new Date().toISOString()
    });
  }

  loadIndicators(symbol, interval = '1d') {
    const id = `${symbol}_${interval}`;
    return this.load('indicators', id);
  }
}

module.exports = LocalStore;
