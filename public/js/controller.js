export class AppController {
  constructor(views) {
    this.views = views;
    this.currentSymbol = 'BTC';
    this.currentInterval = '1d';
    this.currentHorizon = 7;
  }

  async loadData(symbol, interval = '1d') {
    try {
      const response = await fetch(`/api/indicators?symbol=${symbol}&interval=${interval}`);
      if (!response.ok) throw new Error('Failed to load data');
      
      const result = await response.json();
      return result.data;
    } catch (error) {
      console.error('Error loading data:', error);
      throw error;
    }
  }

  async downloadCSV(symbol, interval = '1d') {
    try {
      const url = `/api/series?symbol=${symbol}&interval=${interval}&format=csv`;
      window.open(url, '_blank');
    } catch (error) {
      console.error('Error downloading CSV:', error);
      alert('Failed to download CSV');
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
    try {
      const response = await fetch(`/api/forecast?symbol=${symbol}&horizon=${horizon}`);
      if (!response.ok) throw new Error('Failed to generate forecast');
      
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error generating forecast:', error);
      throw error;
    }
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
      
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error loading universe:', error);
      return null;
    }
  }

  async updateOverview(symbol, interval = '1d') {
    this.currentSymbol = symbol;
    this.currentInterval = interval;
    
    const data = await this.loadData(symbol, interval);
    
    this.views.chart.setData(data);
    
    try {
      const predictedData = await this.loadPredictedSeries(symbol, interval, 7);
      this.views.chart.setPredictedSeries(predictedData);
    } catch (error) {
      console.warn('Could not load predicted series:', error);
    }
    
    this.views.chart.render();
    
    this.views.stats.render(data);
    
    if (this.views.signals) {
      await this.updateSignals(symbol);
    }
  }

  async loadPredictedSeries(symbol, interval, horizon) {
    try {
      const response = await fetch(`/api/predicted-series?symbol=${symbol}&interval=${interval}&horizon=${horizon}`);
      if (!response.ok) throw new Error('Failed to load predicted series');
      
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error loading predicted series:', error);
      return null;
    }
  }

  async updateSignals(symbol) {
    try {
      const response = await fetch(`/api/signals?symbol=${symbol}`);
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

  setupEventListeners() {
    document.getElementById('load-btn').addEventListener('click', async () => {
      const symbol = document.getElementById('symbol-select').value || 'BTC';
      const interval = document.getElementById('interval-select').value || '1d';
      await this.updateOverview(symbol, interval);
    });

    document.getElementById('download-csv-btn').addEventListener('click', async () => {
      const symbol = document.getElementById('symbol-select').value || 'BTC';
      const interval = document.getElementById('interval-select').value || '1d';
      await this.downloadCSV(symbol, interval);
    });

    document.getElementById('generate-forecast-btn').addEventListener('click', async () => {
      const symbol = document.getElementById('symbol-select').value || 'BTC';
      const horizon = parseInt(document.getElementById('horizon-select').value, 10);
      await this.handleGenerateForecast(symbol, horizon);
    });

    ['toggle-ma20', 'toggle-ma50', 'toggle-ma100', 'toggle-ma200', 'toggle-ichimoku', 'toggle-volume', 'toggle-predicted', 'toggle-actual', 'toggle-naive'].forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener('change', () => {
          const option = id.replace('toggle-', 'show').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          this.views.chart.setOption(option, checkbox.checked);
          this.views.chart.render();
        });
      }
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tab = btn.dataset.tab;
        
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
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
    const missing = await this.checkMissing();
    
    if (missing.usingFixtures && missing.missing.length > 0) {
      const alert = document.getElementById('missing-alert');
      alert.innerHTML = `<strong>Warning:</strong> Missing data files: ${missing.missing.join(', ')}. Using fixture data.`;
      alert.classList.remove('hidden');
    }

    await this.updateOverview(this.currentSymbol);
    
    this.setupEventListeners();
  }
}
