class Universe {
  constructor() {
    this.assets = new Map();
    this.lastUpdate = null;
  }

  addAsset(symbol, data) {
    this.assets.set(symbol, {
      symbol,
      rank: data.rank || null,
      marketCap: data.marketCap || null,
      categories: data.categories || [],
      ...data
    });
  }

  getAsset(symbol) {
    return this.assets.get(symbol);
  }

  getAll() {
    return Array.from(this.assets.values());
  }

  getTop(n) {
    return this.getAll()
      .filter(asset => asset.rank !== null)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, n);
  }

  hasCategories() {
    return this.getAll().some(asset => asset.categories && asset.categories.length > 0);
  }

  toJSON() {
    return {
      assetCount: this.assets.size,
      lastUpdate: this.lastUpdate,
      assets: this.getAll()
    };
  }
}

module.exports = Universe;
