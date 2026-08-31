export class AppController {
  constructor(views) {
    this.views = views;
    this.currentSymbol = 'BTC';
    this.currentHorizon = 7;
  }

  async loadData(symbol) {
    try {
      const response = await fetch(`/api/indicators?symbol=${symbol}`);
      if (!response.ok) throw new Error('Failed to load data');
      
      const result = await response.json();
      return result.data;
    } catch (error) {
      console.error('Error loading data:', error);
      throw error;
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

  async updateOverview(symbol) {
    this.currentSymbol = symbol;
    
    const data = await this.loadData(symbol);
    
    this.views.chart.setData(data);
    this.views.chart.render();
    
    this.views.stats.render(data);
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
      const symbol = document.getElementById('symbol-input').value.trim() || 'BTC';
      await this.updateOverview(symbol);
    });

    document.getElementById('generate-forecast-btn').addEventListener('click', async () => {
      const symbol = document.getElementById('symbol-input').value.trim() || 'BTC';
      const horizon = parseInt(document.getElementById('horizon-select').value, 10);
      await this.handleGenerateForecast(symbol, horizon);
    });

    ['toggle-ma20', 'toggle-ma50', 'toggle-ma100', 'toggle-ma200', 'toggle-ichimoku', 'toggle-volume'].forEach(id => {
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
