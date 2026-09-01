import { lastKnownRow } from './chart-data.js';
import { ChartView } from './chart-view.js';

export { ChartView };

function formatPrice(price) {
  if (!Number.isFinite(price)) return 'N/A';
  const abs = Math.abs(price);
  if (abs >= 1000) return `$${price.toFixed(0)}`;
  if (abs >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(6)}`;
}

function changeBetween(later, earlier) {
  if (!Number.isFinite(later) || !Number.isFinite(earlier) || earlier === 0) return 'N/A';
  return `${(((later - earlier) / earlier) * 100).toFixed(2)}%`;
}

export class StatsView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  render(data) {
    if (!data || data.length === 0) {
      this.container.innerHTML = '<div class="empty-state"><h3>No statistics available</h3></div>';
      return;
    }

    const latest = lastKnownRow(data) || data[data.length - 1];
    const weekAgo = data.length > 7 ? lastKnownRow(data.slice(0, data.length - 7)) : data[0];
    const monthAgo = data.length > 30 ? lastKnownRow(data.slice(0, data.length - 30)) : data[0];

    const stats = [
      { label: 'Current Price', value: formatPrice(latest.close) },
      { label: '7-Day Change', value: changeBetween(latest.close, weekAgo && weekAgo.close) },
      { label: '30-Day Change', value: changeBetween(latest.close, monthAgo && monthAgo.close) },
      { label: 'MA20', value: formatPrice(latest.ma20) },
      { label: 'MA50', value: formatPrice(latest.ma50) },
      { label: 'Volume', value: Number.isFinite(latest.volume) ? `${(latest.volume / 1e6).toFixed(2)}M` : 'N/A' }
    ];

    this.container.innerHTML = stats.map((stat) => `
      <div class="stat-card">
        <h3>${stat.label}</h3>
        <div class="value">${stat.value}</div>
      </div>
    `).join('');
  }
}

export class SignalsView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  render(signals) {
    if (!signals || Object.keys(signals).length === 0) {
      this.container.innerHTML = '<div class="empty-state"><p>No signals available</p></div>';
      return;
    }

    const cards = [];

    if (signals.etf) {
      const millions = signals.etf.net_flow_usd_millions;
      cards.push({
        label: 'ETF Net Flow',
        value: Number.isFinite(millions) ? `$${millions.toFixed(1)}M` : 'missing',
        note: signals.etf.days ? `${signals.etf.days}d sum` : ''
      });
    }

    if (signals.oi) {
      const current = signals.oi.current;
      cards.push({
        label: 'Open Interest',
        value: Number.isFinite(current) ? `${(current / 1e6).toFixed(1)}M contracts` : 'missing',
        note: Number.isFinite(signals.oi.change) ? `${signals.oi.change > 0 ? '+' : ''}${signals.oi.change.toFixed(1)}%` : ''
      });
    }

    if (signals.alt_btc) {
      cards.push({
        label: 'ALT/BTC Ratio',
        value: signals.alt_btc.ratio ? signals.alt_btc.ratio.toFixed(4) : 'N/A',
        note: signals.alt_btc.trend || ''
      });
    }

    this.container.innerHTML = cards.map((card) => `
      <div class="stat-card">
        <h3>${card.label}</h3>
        <div class="value">${card.value}</div>
        ${card.note ? `<p style="font-size: 0.9rem; margin-top: 5px; opacity: 0.9;">${card.note}</p>` : ''}
      </div>
    `).join('');
  }
}

export class ForecastView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  render(forecasts) {
    if (!forecasts || forecasts.length === 0) {
      this.container.innerHTML = '<div class="empty-state"><h3>No forecasts generated yet</h3><p>Click "Generate Forecast" to create predictions</p></div>';
      return;
    }

    this.container.innerHTML = forecasts.map((fc) => {
      const card = fc.card || fc;
      const side = (card.side || 'NEUTRAL').toLowerCase();
      const changeSign = card.changePercent >= 0 ? '+' : '';

      return `
        <div class="forecast-card ${side}">
          <div class="forecast-header">
            <div class="forecast-side ${side}">${card.side || 'NEUTRAL'}</div>
            <div class="forecast-horizon">${card.horizonDays}D</div>
          </div>
          
          <div class="forecast-prediction">
            ${card.symbol}: $${card.prediction.toFixed(2)}
            <span style="font-size: 1rem; color: #666;">(${changeSign}${card.changePercent.toFixed(2)}%)</span>
          </div>
          
          <div class="forecast-range">
            Range: $${card.lower.toFixed(2)} - $${card.upper.toFixed(2)}
          </div>
          
          <div class="forecast-section">
            <h4>Bull Case</h4>
            <p>${card.proCase}</p>
          </div>
          
          <div class="forecast-section">
            <h4>Bear Case</h4>
            <p>${card.conCase}</p>
          </div>
          
          <div class="forecast-section">
            <h4>Recommendation</h4>
            <p><strong>${card.recommendation}</strong> (${card.confidence.toFixed(0)}% confidence)</p>
          </div>
          
          <div class="forecast-baseline">
            <strong>Naive Baseline:</strong> $${card.naive.toFixed(2)}<br>
            <strong>Model Prediction:</strong> $${card.prediction.toFixed(2)}<br>
            <strong>Difference:</strong> ${Math.abs(card.prediction - card.naive) > 1 ? 
              `$${Math.abs(card.prediction - card.naive).toFixed(2)} (${((Math.abs(card.prediction - card.naive) / card.naive) * 100).toFixed(2)}%)` : 
              'Minimal'
            }
            ${card.mae_comparison ? `<br><em>${card.mae_comparison}</em>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

export class UniverseView {
  constructor(infoId, listId) {
    this.infoContainer = document.getElementById(infoId);
    this.listContainer = document.getElementById(listId);
  }

  render(universe) {
    if (!universe) {
      this.infoContainer.innerHTML = '<p>No universe data available</p>';
      this.listContainer.innerHTML = '';
      return;
    }

    if (universe.note) {
      this.infoContainer.innerHTML = `
        <div class="alert">
          <strong>Note:</strong> ${universe.note}
        </div>
      `;
    } else {
      this.infoContainer.innerHTML = `
        <p><strong>Last Updated:</strong> ${new Date(universe.updated).toLocaleString()}</p>
        <p><strong>Total Coins:</strong> ${universe.coins ? universe.coins.length : 0}</p>
      `;
    }

    if (universe.coins && universe.coins.length > 0) {
      this.listContainer.innerHTML = universe.coins.slice(0, 50).map((coin) => `
        <div class="universe-card">
          <h4>${coin.symbol || coin.name}</h4>
          <p>${coin.name || ''}</p>
          ${coin.market_cap ? `<p>MCap: $${(coin.market_cap / 1e9).toFixed(2)}B</p>` : ''}
        </div>
      `).join('');
    } else {
      this.listContainer.innerHTML = '<div class="empty-state"><h3>No coins in universe</h3></div>';
    }
  }
}
