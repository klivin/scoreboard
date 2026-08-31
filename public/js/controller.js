export class Controller {
  constructor(model, view) {
    this.model = model;
    this.view = view;
  }

  async init() {
    this.bindEvents();
    await this.loadData();
  }

  bindEvents() {
    const symbolSelect = document.getElementById('symbol-select');
    const intervalSelect = document.getElementById('interval-select');
    const refreshBtn = document.getElementById('refresh-btn');

    if (symbolSelect) {
      symbolSelect.addEventListener('change', () => this.handleSymbolChange());
    }

    if (intervalSelect) {
      intervalSelect.addEventListener('change', () => this.handleIntervalChange());
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.handleRefresh());
    }

    const toggles = [
      'ema20', 'sma20', 'sma50', 'sma100', 'sma200', 'ichimoku', 'volume'
    ];

    toggles.forEach(toggle => {
      const checkbox = document.getElementById(`toggle-${toggle}`);
      if (checkbox) {
        checkbox.addEventListener('change', (e) => {
          this.view.activeToggles[toggle] = e.target.checked;
          this.updateChart();
        });
      }
    });
  }

  async loadData() {
    try {
      this.view.showLoading();
      
      const symbolSelect = document.getElementById('symbol-select');
      const intervalSelect = document.getElementById('interval-select');
      
      const symbol = symbolSelect?.value || 'BTC';
      const interval = intervalSelect?.value || '1d';

      await this.model.loadAll(symbol, interval);
      
      this.updateView();
      this.view.hideLoading();
    } catch (error) {
      this.view.hideLoading();
      this.view.showError(error.message);
      console.error('Failed to load data:', error);
    }
  }

  updateView() {
    const series = this.model.getSeries();
    const indicators = this.model.getIndicators();
    const forecasts = this.model.getForecasts();
    const errorLog = this.model.getErrorLog();

    this.view.renderChart(series, indicators);
    this.view.renderIndicators(indicators);
    this.view.renderForecasts(forecasts);
    this.view.renderErrorLog(errorLog);
  }

  updateChart() {
    const series = this.model.getSeries();
    const indicators = this.model.getIndicators();
    this.view.renderChart(series, indicators, this.view.activeToggles);
  }

  async handleSymbolChange() {
    await this.loadData();
  }

  async handleIntervalChange() {
    await this.loadData();
  }

  async handleRefresh() {
    await this.loadData();
  }
}
