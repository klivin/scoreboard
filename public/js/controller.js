import { optionKeyFromToggleId, TOGGLE_OPTION_MAP } from './toggles.js';

export class AppController {
  constructor(views) {
    this.views = views;
    this.currentSymbol = 'BTC';
    this.currentInterval = '1d';
    this.currentHorizon = 7;
  }

  showPageError(message) {
    const alert = document.getElementById('missing-alert');
    if (!alert) {
      window.alert(message);
      return;
    }
    alert.classList.remove('hidden');
    alert.classList.add('error');
    alert.innerHTML = `<strong>Error:</strong> ${message}`;
  }

  clearPageError() {
    const alert = document.getElementById('missing-alert');
    if (!alert) return;
    alert.classList.add('hidden');
    alert.classList.remove('error');
    alert.innerHTML = '';
  }

  async loadData(symbol, interval = '1d') {
    const response = await fetch(`/api/indicators?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`);
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.error) {
      throw new Error(result.error || `Failed to load ${symbol} ${interval}`);
    }

    if (!result.data || result.data.length === 0) {
      throw new Error(result.error || `No data for ${symbol} ${interval}`);
    }

    return result.data;
  }

  async downloadCSV(symbol, interval = '1d') {
    try {
      const url = `/api/series?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&format=csv`;
      window.open(url, '_blank');
    } catch (error) {
      console.error('Error downloading CSV:', error);
      this.showPageError('Failed to download CSV');
    }
  }

  async checkMissing() {
    try {
      const response = await fetch('/api/missing');
      if (!response.ok) return { missing: [], usingFixtures: false };

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error checking missing files:', error);
      return { missing: [], usingFixtures: false };
    }
  }

  async generateForecast(symbol, horizon) {
    const response = await fetch(`/api/forecast?symbol=${encodeURIComponent(symbol)}&horizon=${horizon}`);
    if (!response.ok) throw new Error('Failed to generate forecast');
    return response.json();
  }

  async loadForecasts() {
    try {
      const response = await fetch('/api/forecasts');
      if (!response.ok) throw new Error('Failed to load forecasts');
      const result = await response.json();
      return result.forecasts;
    } catch (error) {
      console.error('Error loading forecasts:', error);
      return [];
    }
  }

  async loadUniverse() {
    try {
      const response = await fetch('/api/universe');
      if (!response.ok) throw new Error('Failed to load universe');
      return response.json();
    } catch (error) {
      console.error('Error loading universe:', error);
      return null;
    }
  }

  async populateSymbols() {
    const select = document.getElementById('symbol-select');
    if (!select) return;

    try {
      const response = await fetch('/api/symbols');
      if (!response.ok) return;
      const result = await response.json();
      const symbols = result.symbols && result.symbols.length ? result.symbols : ['BTC'];
      const current = select.value || this.currentSymbol;
      select.innerHTML = symbols.map((symbol) => (
        `<option value="${symbol}"${symbol === current ? ' selected' : ''}>${symbol}</option>`
      )).join('');
      this.currentSymbol = select.value;
    } catch (error) {
      console.warn('Could not load symbol list:', error);
    }
  }

  syncChartOptionsFromCheckboxes() {
    Object.keys(TOGGLE_OPTION_MAP).forEach((id) => {
      const checkbox = document.getElementById(id);
      const option = optionKeyFromToggleId(id);
      if (checkbox && option) {
        this.views.chart.setOption(option, checkbox.checked);
      }
    });
  }

  getSelectedSymbol() {
    const select = document.getElementById('symbol-select');
    return (select && select.value) || this.currentSymbol || 'BTC';
  }

  getSelectedInterval() {
    const select = document.getElementById('interval-select');
    return (select && select.value) || this.currentInterval || '1d';
  }

  async updateOverview(symbol, interval = '1d') {
    this.currentSymbol = symbol;
    this.currentInterval = interval;
    this.clearPageError();

    const data = await this.loadData(symbol, interval);

    if (this.views.chart.setInterval) {
      this.views.chart.setInterval(interval);
    }
    this.views.chart.setData(data);
    this.views.chart.setPredictedSeries(null);

    try {
      const predictedData = await this.loadPredictedSeries(symbol, interval, 7);
      this.views.chart.setPredictedSeries(predictedData);
    } catch (error) {
      console.warn('Could not load predicted series:', error);
      this.views.chart.setPredictedSeries(null);
    }

    this.syncChartOptionsFromCheckboxes();
    this.views.chart.render();
    this.views.stats.render(data);

    if (this.views.signals) {
      await this.updateSignals(symbol);
    }
  }

  async loadPredictedSeries(symbol, interval, horizon) {
    const response = await fetch(`/api/predicted-series?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&horizon=${horizon}`);
    if (!response.ok) throw new Error('Failed to load predicted series');
    return response.json();
  }

  async updateSignals(symbol) {
    try {
      const response = await fetch(`/api/signals?symbol=${encodeURIComponent(symbol)}`);
      if (!response.ok) return;
      const signals = await response.json();
      this.views.signals.render(signals);
    } catch (error) {
      console.error('Error loading signals:', error);
    }
  }

  async updateForecasts() {
    const forecasts = await this.loadForecasts();
    this.views.forecast.render(forecasts);
  }

  async updateUniverse() {
    const universe = await this.loadUniverse();
    this.views.universe.render(universe);
  }

  async handleGenerateForecast(symbol, horizon) {
    const forecast = await this.generateForecast(symbol, horizon);
    await this.updateForecasts();
    return forecast;
  }

  async reloadSelected() {
    const symbol = this.getSelectedSymbol();
    const interval = this.getSelectedInterval();

    this.views.chart.setData(null);
    if (this.views.chart.setInterval) {
      this.views.chart.setInterval(interval);
    }
    this.views.chart.render();

    try {
      await this.updateOverview(symbol, interval);
    } catch (error) {
      const message = error.message || `No data for ${symbol} ${interval}`;
      this.showPageError(message);
      if (this.views.chart.showEmpty) {
        this.views.chart.showEmpty(message);
      }
      console.error(error);
    }
  }

  setupEventListeners() {
    const loadBtn = document.getElementById('load-btn');
    if (loadBtn) {
      loadBtn.addEventListener('click', () => this.reloadSelected());
    }

    const symbolSelect = document.getElementById('symbol-select');
    if (symbolSelect) {
      symbolSelect.addEventListener('change', () => this.reloadSelected());
    }

    const intervalSelect = document.getElementById('interval-select');
    if (intervalSelect) {
      intervalSelect.addEventListener('change', () => this.reloadSelected());
    }

    const csvBtn = document.getElementById('download-csv-btn');
    if (csvBtn) {
      csvBtn.addEventListener('click', async () => {
        await this.downloadCSV(this.getSelectedSymbol(), this.getSelectedInterval());
      });
    }

    const forecastBtn = document.getElementById('generate-forecast-btn');
    if (forecastBtn) {
      forecastBtn.addEventListener('click', async () => {
        const symbol = this.getSelectedSymbol();
        const horizon = parseInt(document.getElementById('horizon-select').value, 10);
        await this.handleGenerateForecast(symbol, horizon);
      });
    }

    Object.keys(TOGGLE_OPTION_MAP).forEach((id) => {
      const checkbox = document.getElementById(id);
      if (!checkbox) return;
      checkbox.addEventListener('change', () => {
        const option = optionKeyFromToggleId(id);
        if (!option) return;
        this.views.chart.setOption(option, checkbox.checked);
        if (typeof this.views.chart.refreshOverlays === 'function') {
          this.views.chart.refreshOverlays();
        } else {
          this.views.chart.render();
        }
      });
    });

    document.querySelectorAll('[data-draw-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.drawMode === 'cursor' ? 'none' : btn.dataset.drawMode;
        this.views.chart.setDrawMode(mode);
      });
    });

    const clearDraw = document.getElementById('clear-drawings-btn');
    if (clearDraw) {
      clearDraw.addEventListener('click', () => this.views.chart.clearDrawings());
    }

    const resetView = document.getElementById('reset-viewport-btn');
    if (resetView) {
      resetView.addEventListener('click', () => this.views.chart.resetViewport());
    }

    const fitAll = document.getElementById('fit-all-btn');
    if (fitAll) {
      fitAll.addEventListener('click', () => this.views.chart.fitAll());
    }

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tab = btn.dataset.tab;

        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(tab).classList.add('active');

        if (tab === 'forecast') {
          await this.updateForecasts();
        } else if (tab === 'universe') {
          await this.updateUniverse();
        }
      });
    });
  }

  async init() {
    this.setupEventListeners();
    this.syncChartOptionsFromCheckboxes();

    const missing = await this.checkMissing();

    if (missing.usingFixtures && missing.missing.length > 0) {
      const alert = document.getElementById('missing-alert');
      if (alert) {
        alert.innerHTML = `<strong>Warning:</strong> Missing data files: ${missing.missing.join(', ')}. Using fixture data only when a named file is absent.`;
        alert.classList.remove('hidden');
        alert.classList.remove('error');
      }
    }

    await this.populateSymbols();
    await this.reloadSelected();
  }
}
