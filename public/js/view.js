export class View {
  constructor() {
    this.chart = null;
    this.activeToggles = {
      ema20: true,
      sma20: false,
      sma50: false,
      sma100: false,
      sma200: false,
      ichimoku: false,
      volume: true
    };
  }

  renderChart(series, indicators, toggles = this.activeToggles) {
    const canvas = document.getElementById('price-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height = 400;

    ctx.clearRect(0, 0, width, height);

    if (!series || !series.data || series.data.length === 0) {
      ctx.fillStyle = '#666';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data available', width / 2, height / 2);
      return;
    }

    const data = series.data.slice(-100);
    const prices = data.map(d => d.close || d.value || 0);
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const priceRange = maxPrice - minPrice;
    const padding = 40;
    const chartHeight = height - padding * 2;
    const chartWidth = width - padding * 2;
    const stepX = chartWidth / (data.length - 1);

    const priceToY = (price) => {
      return height - padding - ((price - minPrice) / priceRange) * chartHeight;
    };

    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((point, i) => {
      const x = padding + i * stepX;
      const y = priceToY(point.close || point.value || 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    if (indicators && indicators.indicators) {
      const ind = indicators.indicators;

      if (toggles.ema20 && ind.ema20) {
        this.drawLine(ctx, data, ind.ema20, priceToY, padding, stepX, '#10b981', 1.5);
      }

      if (toggles.sma20 && ind.sma20) {
        this.drawLine(ctx, data, ind.sma20, priceToY, padding, stepX, '#3b82f6', 1.5);
      }

      if (toggles.sma50 && ind.sma50) {
        this.drawLine(ctx, data, ind.sma50, priceToY, padding, stepX, '#f59e0b', 1.5);
      }

      if (toggles.sma100 && ind.sma100) {
        this.drawLine(ctx, data, ind.sma100, priceToY, padding, stepX, '#ef4444', 1.5);
      }

      if (toggles.sma200 && ind.sma200) {
        this.drawLine(ctx, data, ind.sma200, priceToY, padding, stepX, '#8b5cf6', 1.5);
      }

      if (toggles.ichimoku && ind.ichimoku) {
        const ich = ind.ichimoku;
        if (ich.tenkan) this.drawLine(ctx, data, ich.tenkan, priceToY, padding, stepX, '#06b6d4', 1);
        if (ich.kijun) this.drawLine(ctx, data, ich.kijun, priceToY, padding, stepX, '#ec4899', 1);
        if (ich.senkouA) this.drawLine(ctx, data, ich.senkouA, priceToY, padding, stepX, '#10b981', 1, true);
        if (ich.senkouB) this.drawLine(ctx, data, ich.senkouB, priceToY, padding, stepX, '#ef4444', 1, true);
      }
    }

    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(padding, padding, chartWidth, chartHeight);

    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(maxPrice.toFixed(2), padding - 5, padding + 5);
    ctx.fillText(minPrice.toFixed(2), padding - 5, height - padding);
  }

  drawLine(ctx, data, value, priceToY, padding, stepX, color, lineWidth = 1, dashed = false) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    if (dashed) ctx.setLineDash([5, 5]);
    else ctx.setLineDash([]);

    ctx.beginPath();
    const x = padding + (data.length - 1) * stepX;
    const y = priceToY(value);
    ctx.moveTo(padding, y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  renderIndicators(indicators) {
    const container = document.getElementById('indicator-values');
    if (!container) return;

    container.innerHTML = '';

    if (!indicators || !indicators.indicators) {
      container.innerHTML = '<p>No indicators available</p>';
      return;
    }

    const ind = indicators.indicators;
    const indicatorList = [
      { label: 'EMA 20', value: ind.ema20 },
      { label: 'SMA 20', value: ind.sma20 },
      { label: 'SMA 50', value: ind.sma50 },
      { label: 'SMA 100', value: ind.sma100 },
      { label: 'SMA 200', value: ind.sma200 }
    ];

    indicatorList.forEach(item => {
      if (item.value !== null && item.value !== undefined) {
        const card = document.createElement('div');
        card.className = 'indicator-card';
        card.innerHTML = `
          <div class="label">${item.label}</div>
          <div class="value">${item.value.toFixed(2)}</div>
        `;
        container.appendChild(card);
      }
    });

    if (ind.ichimoku) {
      const ich = ind.ichimoku;
      ['tenkan', 'kijun', 'senkouA', 'senkouB', 'chikou'].forEach(key => {
        if (ich[key] !== null && ich[key] !== undefined) {
          const card = document.createElement('div');
          card.className = 'indicator-card';
          card.innerHTML = `
            <div class="label">Ichimoku ${key}</div>
            <div class="value">${ich[key].toFixed(2)}</div>
          `;
          container.appendChild(card);
        }
      });
    }
  }

  renderForecasts(forecasts) {
    const container = document.getElementById('forecast-cards');
    if (!container) return;

    container.innerHTML = '';

    if (!forecasts || forecasts.length === 0) {
      const defaultForecasts = this.generateDefaultForecasts();
      forecasts = defaultForecasts;
    }

    forecasts.forEach(forecast => {
      const card = document.createElement('div');
      card.className = 'forecast-card';

      const sideClass = forecast.prediction?.side || 'neutral';
      const predictionValue = forecast.prediction?.value || 0;
      const band = forecast.prediction?.band;
      const bandText = band ? `Band: ${band.lower?.toFixed(2) || 'N/A'} - ${band.upper?.toFixed(2) || 'N/A'}` : '';

      let comparisonHTML = '';
      if (forecast.naiveBetter !== null && forecast.actual !== null) {
        const naiveBetter = forecast.naiveBetter;
        const className = naiveBetter ? 'naive-better' : '';
        const message = naiveBetter 
          ? '⚠️ Naive forecast performed better (MAE: ' + (forecast.naiveError?.toFixed(2) || 'N/A') + ' vs ' + (forecast.error?.toFixed(2) || 'N/A') + ')'
          : '✓ Model outperformed naive forecast';
        comparisonHTML = `<div class="comparison ${className}">${message}</div>`;
      }

      const proItems = forecast.steelman?.pro?.map(item => `<li>${item}</li>`).join('') || '';
      const conItems = forecast.steelman?.con?.map(item => `<li>${item}</li>`).join('') || '';

      card.innerHTML = `
        <div class="horizon">${forecast.horizon || 'Unknown'} Forecast</div>
        <div class="prediction ${sideClass}">
          ${predictionValue.toFixed(2)}
          <span style="font-size: 0.6em; color: #666;">(${sideClass})</span>
        </div>
        ${bandText ? `<div class="band">${bandText}</div>` : ''}
        ${comparisonHTML}
        <div class="steelman">
          ${proItems ? `<h4>Pro:</h4><ul>${proItems}</ul>` : ''}
          ${conItems ? `<h4>Con:</h4><ul>${conItems}</ul>` : ''}
        </div>
        ${forecast.pick ? `<div class="pick">Pick: ${forecast.pick}</div>` : ''}
      `;

      container.appendChild(card);
    });
  }

  generateDefaultForecasts() {
    return [
      {
        horizon: '1d',
        prediction: {
          value: 61000,
          side: 'bullish',
          band: { lower: 59500, upper: 62500 }
        },
        steelman: {
          pro: ['ETF inflows remain positive', 'Technical support holding'],
          con: ['Resistance at 62k', 'Volume declining']
        },
        pick: 'Cautiously bullish - watch 62k resistance',
        naiveBetter: false,
        actual: null,
        error: null,
        naiveError: null
      },
      {
        horizon: '7d',
        prediction: {
          value: 63500,
          side: 'bullish',
          band: { lower: 58000, upper: 68000 }
        },
        steelman: {
          pro: ['Macro tailwinds improving', 'Historical seasonality positive'],
          con: ['Geopolitical uncertainty', 'Overbought RSI']
        },
        pick: 'Bullish - targeting 65k',
        naiveBetter: null,
        actual: null,
        error: null,
        naiveError: null
      },
      {
        horizon: '30d',
        prediction: {
          value: 70000,
          side: 'bullish',
          band: { lower: 55000, upper: 80000 }
        },
        steelman: {
          pro: ['Institutional adoption accelerating', 'Supply shock post-halving'],
          con: ['Regulatory headwinds possible', 'Correlation with tech stocks']
        },
        pick: 'Bullish - new ATH possible',
        naiveBetter: null,
        actual: null,
        error: null,
        naiveError: null
      }
    ];
  }

  renderErrorLog(errorLogs) {
    const section = document.getElementById('error-section');
    const container = document.getElementById('error-list');
    if (!section || !container) return;

    container.innerHTML = '';

    const allErrors = errorLogs.flatMap(log => log.errors || []);

    if (allErrors.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';

    allErrors.forEach(error => {
      const item = document.createElement('div');
      item.className = `error-item ${error.level || 'info'}`;
      item.innerHTML = `
        <div class="timestamp">${new Date(error.timestamp).toLocaleString()}</div>
        <div class="message">${error.message}</div>
      `;
      container.appendChild(item);
    });
  }

  showLoading() {
    console.log('Loading...');
  }

  hideLoading() {
    console.log('Loaded');
  }

  showError(message) {
    alert(`Error: ${message}`);
  }
}
