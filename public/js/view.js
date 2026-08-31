export class ChartView {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.data = null;
    this.predictedSeries = null;
    this.tooltip = null;
    this.mousePos = null;
    this.options = {
      showMA20: true,
      showMA50: true,
      showMA100: false,
      showMA200: false,
      showIchimoku: false,
      showVolume: false,
      showPredicted: false,
      showActual: false,
      showNaive: true
    };
    
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => this.handleMouseLeave());
  }

  setData(data) {
    this.data = data;
  }

  setPredictedSeries(series) {
    this.predictedSeries = series;
  }

  setOption(key, value) {
    this.options[key] = value;
  }

  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.mousePos = {
      x: (e.clientX - rect.left) * dpr,
      y: (e.clientY - rect.top) * dpr
    };
    this.render();
  }

  handleMouseLeave() {
    this.mousePos = null;
    this.render();
  }

  setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
    this.ctx.scale(dpr, dpr);
    
    return {
      width: rect.width,
      height: rect.height,
      dpr
    };
  }

  render() {
    if (!this.data || this.data.length === 0) {
      const { width, height } = this.setupCanvas();
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.fillStyle = '#999';
      this.ctx.font = '16px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('No data to display', width / 2, height / 2);
      return;
    }

    const { width, height } = this.setupCanvas();
    
    this.ctx.clearRect(0, 0, width, height);

    const volumeHeight = this.options.showVolume ? 80 : 0;
    const padding = { top: 20, right: 80, bottom: 40 + volumeHeight, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const mainChartHeight = height - padding.top - padding.bottom;

    const closes = this.data.map(d => d.close).filter(v => v !== null && !isNaN(v));
    const minPrice = Math.min(...closes) * 0.98;
    const maxPrice = Math.max(...closes) * 1.02;

    const xStep = chartWidth / Math.max(1, this.data.length - 1);

    const priceToY = (price) => {
      return padding.top + mainChartHeight - ((price - minPrice) / (maxPrice - minPrice)) * mainChartHeight;
    };

    this.ctx.strokeStyle = '#e0e0e0';
    this.ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (mainChartHeight / 5) * i;
      this.ctx.beginPath();
      this.ctx.moveTo(padding.left, y);
      this.ctx.lineTo(width - padding.right, y);
      this.ctx.stroke();

      const price = maxPrice - ((maxPrice - minPrice) / 5) * i;
      this.ctx.fillStyle = '#666';
      this.ctx.font = '12px sans-serif';
      this.ctx.textAlign = 'right';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(price.toFixed(0), padding.left - 10, y);
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
      this.drawIchimokuCloud(xStep, priceToY, padding.left);
    }

    if (this.options.showVolume && volumeHeight > 0) {
      this.drawVolume(padding, chartWidth, volumeHeight, xStep, height);
    }

    if (this.predictedSeries) {
      if (this.options.showPredicted && this.predictedSeries.predicted) {
        this.drawPredictedLine(this.predictedSeries.predicted, priceToY, padding.left, '#9333ea', 2, [5, 5]);
      }
      if (this.options.showActual && this.predictedSeries.actual) {
        this.drawPredictedLine(this.predictedSeries.actual, priceToY, padding.left, '#10b981', 2, []);
      }
      if (this.options.showNaive && this.predictedSeries.naive) {
        this.drawPredictedLine(this.predictedSeries.naive, priceToY, padding.left, '#f59e0b', 1.5, [10, 5]);
      }
    }

    this.ctx.fillStyle = '#333';
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    const dateStep = Math.max(1, Math.floor(this.data.length / 8));
    for (let i = 0; i < this.data.length; i += dateStep) {
      const x = padding.left + i * xStep;
      const ts = this.data[i].timestamp || this.data[i].time || 0;
      const date = new Date(ts);
      const month = date.getUTCMonth() + 1;
      const day = date.getUTCDate();
      const label = `${month}/${day}`;
      this.ctx.fillText(label, x, height - volumeHeight - 25);
    }

    if (this.mousePos) {
      this.drawCrosshair(padding, chartWidth, mainChartHeight, width, height, xStep, priceToY);
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

  drawIchimokuCloud(xStep, priceToY, offsetX) {
    const senkouA = this.data.map(d => d.senkouA);
    const senkouB = this.data.map(d => d.senkouB);
    
    this.ctx.beginPath();
    let started = false;
    for (let i = 0; i < this.data.length; i++) {
      if (senkouA[i] !== null && !isNaN(senkouA[i])) {
        const x = offsetX + i * xStep;
        const y = priceToY(senkouA[i]);
        if (!started) {
          this.ctx.moveTo(x, y);
          started = true;
        } else {
          this.ctx.lineTo(x, y);
        }
      }
    }
    
    for (let i = this.data.length - 1; i >= 0; i--) {
      if (senkouB[i] !== null && !isNaN(senkouB[i])) {
        const x = offsetX + i * xStep;
        const y = priceToY(senkouB[i]);
        this.ctx.lineTo(x, y);
      }
    }
    
    this.ctx.closePath();
    this.ctx.fillStyle = 'rgba(102, 126, 234, 0.1)';
    this.ctx.fill();
    
    this.drawLine(this.data.map(d => d.tenkan), xStep, priceToY, offsetX, '#06b6d4', 1.5);
    this.drawLine(this.data.map(d => d.kijun), xStep, priceToY, offsetX, '#ec4899', 1.5);
    this.drawLine(senkouA, xStep, priceToY, offsetX, '#10b981', 1);
    this.drawLine(senkouB, xStep, priceToY, offsetX, '#ef4444', 1);
  }

  drawPredictedLine(points, priceToY, offsetX, color, width, dash = []) {
    if (!points || points.length === 0) return;
    
    const dataTimestamps = this.data.map(d => d.timestamp || d.time || 0);
    const minTs = Math.min(...dataTimestamps);
    const maxTs = Math.max(...dataTimestamps);
    const timeRange = maxTs - minTs;
    const chartWidth = this.canvas.width / (window.devicePixelRatio || 1) - 150;
    
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.setLineDash(dash);
    this.ctx.beginPath();
    
    let started = false;
    points.forEach((point) => {
      if (point.value !== null && !isNaN(point.value)) {
        const relativePos = (point.timestamp - minTs) / timeRange;
        const x = offsetX + relativePos * chartWidth;
        const y = priceToY(point.value);
        
        if (!started) {
          this.ctx.moveTo(x, y);
          started = true;
        } else {
          this.ctx.lineTo(x, y);
        }
      }
    });
    
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  drawVolume(padding, chartWidth, volumeHeight, xStep, canvasHeight) {
    const volumeTop = canvasHeight - volumeHeight - 30;
    const volumes = this.data.map(d => d.volume || 0).filter(v => v > 0);
    const maxVolume = Math.max(...volumes, 1);

    this.data.forEach((point, i) => {
      const x = padding.left + i * xStep;
      const vol = point.volume || 0;
      const volHeight = (vol / maxVolume) * volumeHeight;
      
      this.ctx.fillStyle = 'rgba(102, 126, 234, 0.3)';
      this.ctx.fillRect(x - xStep / 3, volumeTop + volumeHeight - volHeight, xStep / 1.5, volHeight);
    });
  }

  drawCrosshair(padding, chartWidth, chartHeight, canvasWidth, canvasHeight, xStep, priceToY) {
    const x = this.mousePos.x;
    const y = this.mousePos.y;

    if (x < padding.left || x > padding.left + chartWidth || 
        y < padding.top || y > padding.top + chartHeight) {
      return;
    }

    const dataIndex = Math.round((x - padding.left) / xStep);
    if (dataIndex < 0 || dataIndex >= this.data.length) return;

    const point = this.data[dataIndex];
    if (!point) return;

    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([5, 5]);
    
    this.ctx.beginPath();
    this.ctx.moveTo(padding.left + dataIndex * xStep, padding.top);
    this.ctx.lineTo(padding.left + dataIndex * xStep, padding.top + chartHeight);
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.moveTo(padding.left, y);
    this.ctx.lineTo(padding.left + chartWidth, y);
    this.ctx.stroke();
    
    this.ctx.setLineDash([]);

    const ts = point.timestamp || point.time || 0;
    const date = new Date(ts);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
    
    let tooltipLines = [
      `Date: ${dateStr}`,
      `Close: $${point.close.toFixed(2)}`
    ];

    if (point.oi) tooltipLines.push(`OI: ${point.oi.toFixed(0)}`);
    if (point.volume) tooltipLines.push(`Volume: ${(point.volume / 1e6).toFixed(2)}M`);
    if (this.options.showMA20 && point.ma20) tooltipLines.push(`MA20: $${point.ma20.toFixed(2)}`);
    if (this.options.showMA50 && point.ma50) tooltipLines.push(`MA50: $${point.ma50.toFixed(2)}`);

    const tooltipWidth = 180;
    const lineHeight = 18;
    const tooltipHeight = tooltipLines.length * lineHeight + 10;
    
    let tooltipX = x + 15;
    let tooltipY = y - tooltipHeight / 2;
    
    if (tooltipX + tooltipWidth > canvasWidth - 10) {
      tooltipX = x - tooltipWidth - 15;
    }
    if (tooltipY < padding.top) tooltipY = padding.top;
    if (tooltipY + tooltipHeight > canvasHeight - 50) tooltipY = canvasHeight - tooltipHeight - 50;

    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    this.ctx.strokeStyle = '#666';
    this.ctx.lineWidth = 1;
    this.ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
    this.ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);

    this.ctx.fillStyle = '#333';
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    
    tooltipLines.forEach((line, i) => {
      this.ctx.fillText(line, tooltipX + 8, tooltipY + 5 + i * lineHeight);
    });
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
    const monthAgo = data.length > 30 ? data[data.length - 31] : data[0];
    const weekChange = ((latest.close - weekAgo.close) / weekAgo.close * 100).toFixed(2);
    const monthChange = ((latest.close - monthAgo.close) / monthAgo.close * 100).toFixed(2);

    const stats = [
      { label: 'Current Price', value: `$${latest.close.toFixed(2)}` },
      { label: '7-Day Change', value: `${weekChange}%` },
      { label: '30-Day Change', value: `${monthChange}%` },
      { label: 'MA20', value: latest.ma20 ? `$${latest.ma20.toFixed(2)}` : 'N/A' },
      { label: 'MA50', value: latest.ma50 ? `$${latest.ma50.toFixed(2)}` : 'N/A' },
      { label: 'Volume', value: latest.volume ? `${(latest.volume / 1e6).toFixed(2)}M` : 'N/A' }
    ];

    this.container.innerHTML = stats.map(stat => `
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
      cards.push({
        label: 'ETF Net Flow',
        value: signals.etf.net_flow ? `$${(signals.etf.net_flow / 1e6).toFixed(1)}M` : 'N/A',
        note: signals.etf.days ? `${signals.etf.days}d avg` : ''
      });
    }

    if (signals.oi) {
      cards.push({
        label: 'Open Interest',
        value: signals.oi.current ? `${(signals.oi.current / 1e6).toFixed(1)}M` : 'N/A',
        note: signals.oi.change ? `${signals.oi.change > 0 ? '+' : ''}${signals.oi.change.toFixed(1)}%` : ''
      });
    }

    if (signals.alt_btc) {
      cards.push({
        label: 'ALT/BTC Ratio',
        value: signals.alt_btc.ratio ? signals.alt_btc.ratio.toFixed(4) : 'N/A',
        note: signals.alt_btc.trend || ''
      });
    }

    this.container.innerHTML = cards.map(card => `
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
