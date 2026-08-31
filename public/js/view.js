export class ChartView {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.data = null;
    this.options = {
      showMA20: true,
      showMA50: true,
      showMA100: false,
      showMA200: false,
      showIchimoku: false,
      showVolume: false
    };
  }

  setData(data) {
    this.data = data;
  }

  setOption(key, value) {
    this.options[key] = value;
  }

  render() {
    if (!this.data || this.data.length === 0) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = '#999';
      this.ctx.font = '16px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('No data to display', this.canvas.width / 2, this.canvas.height / 2);
      return;
    }

    const width = this.canvas.width = this.canvas.offsetWidth;
    const height = this.canvas.height = this.canvas.offsetHeight;

    this.ctx.clearRect(0, 0, width, height);

    const padding = { top: 20, right: 60, bottom: 40, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const closes = this.data.map(d => d.close).filter(v => v !== null && !isNaN(v));
    const minPrice = Math.min(...closes) * 0.98;
    const maxPrice = Math.max(...closes) * 1.02;

    const xStep = chartWidth / (this.data.length - 1 || 1);

    const priceToY = (price) => {
      return padding.top + chartHeight - ((price - minPrice) / (maxPrice - minPrice)) * chartHeight;
    };

    this.ctx.strokeStyle = '#e0e0e0';
    this.ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (chartHeight / 5) * i;
      this.ctx.beginPath();
      this.ctx.moveTo(padding.left, y);
      this.ctx.lineTo(width - padding.right, y);
      this.ctx.stroke();

      const price = maxPrice - ((maxPrice - minPrice) / 5) * i;
      this.ctx.fillStyle = '#666';
      this.ctx.font = '12px sans-serif';
      this.ctx.textAlign = 'right';
      this.ctx.fillText(price.toFixed(0), padding.left - 10, y + 4);
    }

    this.ctx.strokeStyle = '#667eea';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.data.forEach((point, i) => {
      const x = padding.left + i * xStep;
      const y = priceToY(point.close);
      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    });
    this.ctx.stroke();

    if (this.options.showMA20) {
      this.drawLine(this.data.map(d => d.ma20), xStep, priceToY, padding.left, '#10b981', 2);
    }

    if (this.options.showMA50) {
      this.drawLine(this.data.map(d => d.ma50), xStep, priceToY, padding.left, '#f59e0b', 2);
    }

    if (this.options.showMA100) {
      this.drawLine(this.data.map(d => d.ma100), xStep, priceToY, padding.left, '#ef4444', 2);
    }

    if (this.options.showMA200) {
      this.drawLine(this.data.map(d => d.ma200), xStep, priceToY, padding.left, '#8b5cf6', 2);
    }

    if (this.options.showIchimoku) {
      this.drawLine(this.data.map(d => d.tenkan), xStep, priceToY, padding.left, '#06b6d4', 1.5);
      this.drawLine(this.data.map(d => d.kijun), xStep, priceToY, padding.left, '#ec4899', 1.5);
    }

    this.ctx.fillStyle = '#333';
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'center';
    const dateStep = Math.max(1, Math.floor(this.data.length / 8));
    for (let i = 0; i < this.data.length; i += dateStep) {
      const x = padding.left + i * xStep;
      const date = new Date(this.data[i].timestamp || this.data[i].time || 0);
      const label = `${date.getMonth() + 1}/${date.getDate()}`;
      this.ctx.fillText(label, x, height - 20);
    }
  }

  drawLine(values, xStep, priceToY, offsetX, color, width) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.beginPath();
    let started = false;
    values.forEach((value, i) => {
      if (value !== null && !isNaN(value)) {
        const x = offsetX + i * xStep;
        const y = priceToY(value);
        if (!started) {
          this.ctx.moveTo(x, y);
          started = true;
        } else {
          this.ctx.lineTo(x, y);
        }
      }
    });
    this.ctx.stroke();
  }
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

    const latest = data[data.length - 1];
    const weekAgo = data.length > 7 ? data[data.length - 8] : data[0];
    const weekChange = ((latest.close - weekAgo.close) / weekAgo.close * 100).toFixed(2);

    const stats = [
      { label: 'Current Price', value: `$${latest.close.toFixed(2)}` },
      { label: '7-Day Change', value: `${weekChange}%` },
      { label: 'MA20', value: latest.ma20 ? `$${latest.ma20.toFixed(2)}` : 'N/A' },
      { label: 'MA50', value: latest.ma50 ? `$${latest.ma50.toFixed(2)}` : 'N/A' }
    ];

    this.container.innerHTML = stats.map(stat => `
      <div class="stat-card">
        <h3>${stat.label}</h3>
        <div class="value">${stat.value}</div>
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

    this.container.innerHTML = forecasts.map(fc => {
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
            <strong>Naive Baseline:</strong> $${card.naive.toFixed(2)}
            ${Math.abs(card.prediction - card.naive) > 100 ? '<br><em>Trend model differs significantly from naive</em>' : ''}
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
      this.listContainer.innerHTML = universe.coins.slice(0, 50).map(coin => `
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
