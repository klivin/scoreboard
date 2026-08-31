class Series {
  constructor(symbol, data = [], metadata = {}) {
    this.symbol = symbol;
    this.data = data;
    this.metadata = {
      source: metadata.source || 'unknown',
      interval: metadata.interval || '1d',
      isFallback: metadata.isFallback || false,
      lastUpdate: metadata.lastUpdate || new Date().toISOString(),
      ...metadata
    };
  }

  addPoint(point) {
    this.data.push(point);
  }

  getRange(from, to) {
    return this.data.filter(point => {
      const ts = new Date(point.timestamp).getTime();
      const fromTs = from ? new Date(from).getTime() : 0;
      const toTs = to ? new Date(to).getTime() : Infinity;
      return ts >= fromTs && ts <= toTs;
    });
  }

  getLatest(n = 1) {
    return this.data.slice(-n);
  }

  getFields(fields) {
    if (!fields || fields.length === 0) return this.data;
    return this.data.map(point => {
      const filtered = { timestamp: point.timestamp };
      fields.forEach(field => {
        if (point[field] !== undefined) {
          filtered[field] = point[field];
        }
      });
      return filtered;
    });
  }

  length() {
    return this.data.length;
  }

  toJSON() {
    return {
      symbol: this.symbol,
      metadata: this.metadata,
      dataLength: this.data.length,
      firstPoint: this.data[0] || null,
      lastPoint: this.data[this.data.length - 1] || null
    };
  }
}

module.exports = Series;
