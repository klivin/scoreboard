export class Model {
  constructor() {
    this.series = null;
    this.indicators = null;
    this.forecasts = [];
    this.universe = null;
    this.errorLog = [];
    this.currentSymbol = 'BTC';
    this.currentInterval = '1d';
  }

  async fetchSeries(symbol, interval) {
    const response = await fetch(`/api/series?symbol=${symbol}&interval=${interval}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch series: ${response.statusText}`);
    }
    this.series = await response.json();
    this.currentSymbol = symbol;
    this.currentInterval = interval;
    return this.series;
  }

  async fetchIndicators(symbol, interval) {
    const response = await fetch(`/api/indicators?symbol=${symbol}&interval=${interval}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch indicators: ${response.statusText}`);
    }
    this.indicators = await response.json();
    return this.indicators;
  }

  async fetchForecasts() {
    const response = await fetch('/api/forecasts');
    if (!response.ok) {
      throw new Error(`Failed to fetch forecasts: ${response.statusText}`);
    }
    const data = await response.json();
    this.forecasts = data.forecasts || [];
    return this.forecasts;
  }

  async fetchUniverse() {
    const response = await fetch('/api/universe');
    if (!response.ok) {
      throw new Error(`Failed to fetch universe: ${response.statusText}`);
    }
    this.universe = await response.json();
    return this.universe;
  }

  async fetchErrorLog() {
    const response = await fetch('/api/error-log');
    if (!response.ok) {
      throw new Error(`Failed to fetch error log: ${response.statusText}`);
    }
    const data = await response.json();
    this.errorLog = data.logs || [];
    return this.errorLog;
  }

  async loadAll(symbol = 'BTC', interval = '1d') {
    await Promise.all([
      this.fetchSeries(symbol, interval),
      this.fetchIndicators(symbol, interval),
      this.fetchForecasts(),
      this.fetchUniverse(),
      this.fetchErrorLog()
    ]);
  }

  getSeries() {
    return this.series;
  }

  getIndicators() {
    return this.indicators;
  }

  getForecasts() {
    return this.forecasts;
  }

  getUniverse() {
    return this.universe;
  }

  getErrorLog() {
    return this.errorLog;
  }
}
