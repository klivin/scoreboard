import { lastKnownRow, toCandleData, toLineData, toHistogramData, timeKey, predictedToLine } from './chart-data.js';
import { IchimokuCloudPrimitive } from './ichimoku-cloud.js';

const DEFAULT_VIEWPORT_DAYS = 5;

const OVERLAY_META = {
  ma20: { option: 'showMA20', color: '#10b981', label: 'MA20 (EMA)' },
  ma50: { option: 'showMA50', color: '#f59e0b', label: 'MA50 (SMA)' },
  ma100: { option: 'showMA100', color: '#ef4444', label: 'MA100 (SMA)' },
  ma200: { option: 'showMA200', color: '#8b5cf6', label: 'MA200 (SMA)' },
  tenkan: { option: 'showIchimoku', color: '#06b6d4', label: 'Tenkan' },
  kijun: { option: 'showIchimoku', color: '#ec4899', label: 'Kijun' },
  senkouA: { option: 'showIchimoku', color: '#10b981', label: 'Senkou A' },
  senkouB: { option: 'showIchimoku', color: '#ef4444', label: 'Senkou B' },
  chikou: { option: 'showIchimoku', color: '#64748b', label: 'Chikou' },
  volume: { option: 'showVolume', color: '#667eea', label: 'Volume' }
};

export class ChartView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.tooltip = document.getElementById('chart-tooltip');
    this.emptyEl = document.getElementById('chart-empty');
    this.data = null;
    this.predictedSeries = null;
    this.interval = '1d';
    this.chart = null;
    this.candleSeries = null;
    this.overlaySeries = {};
    this.volumeSeries = null;
    this.predictedLines = {};
    this.markersApi = null;
    this.cloud = null;
    this.drawMode = 'none';
    this.trendAnchor = null;
    this.priceLines = [];
    this.trendSeries = [];
    this.rowByTime = new Map();
    this.options = {
      showMA20: true,
      showMA50: true,
      showMA100: false,
      showMA200: false,
      showIchimoku: false,
      showVolume: true,
      showPredicted: false,
      showActual: false,
      showNaive: true
    };

    window.addEventListener('resize', () => this.resize());
  }

  lwc() {
    return window.LightweightCharts;
  }

  setData(data) {
    this.data = data;
    this.rowByTime = new Map();
    for (const row of data || []) {
      if (!row || !Number.isFinite(row.timestamp)) continue;
      this.rowByTime.set(Math.floor(row.timestamp / 1000), row);
    }
  }

  setPredictedSeries(series) {
    this.predictedSeries = series;
  }

  setInterval(interval) {
    this.interval = interval === '1h' ? '1h' : '1d';
  }

  setOption(key, value) {
    this.options[key] = value;
  }

  setDrawMode(mode) {
    this.drawMode = mode || 'none';
    this.trendAnchor = null;
    if (this.container) {
      this.container.classList.toggle('drawing', this.drawMode !== 'none');
    }
    this.syncDrawButtons();
  }

  syncDrawButtons() {
    document.querySelectorAll('[data-draw-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.drawMode === (this.drawMode === 'none' ? 'cursor' : this.drawMode));
    });
  }

  formatPrice(price) {
    if (!Number.isFinite(price)) return '';
    const abs = Math.abs(price);
    if (abs >= 1000) return price.toFixed(0);
    if (abs >= 1) return price.toFixed(2);
    return price.toFixed(6);
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return 'n/a';
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    if (this.interval === '1h') {
      const hh = String(date.getUTCHours()).padStart(2, '0');
      return `${y}-${m}-${d} ${hh}:00 UTC`;
    }
    return `${y}-${m}-${d}`;
  }

  resetSeriesHandles() {
    this.candleSeries = null;
    this.overlaySeries = {};
    this.volumeSeries = null;
    this.predictedLines = {};
    this.priceLines = [];
    this.trendSeries = [];
    this.trendAnchor = null;
    this.markersApi = null;
    this.cloud = null;
  }

  destroyChart() {
    if (this.chart) {
      try { this.chart.remove(); } catch { /* already removed */ }
      this.chart = null;
    }
    this.resetSeriesHandles();
  }

  showEmpty(message) {
    if (this.emptyEl) {
      this.emptyEl.textContent = message || 'No data to display';
      this.emptyEl.classList.remove('hidden');
    }
    this.destroyChart();
  }

  hideEmpty() {
    if (this.emptyEl) {
      this.emptyEl.classList.add('hidden');
      this.emptyEl.textContent = '';
    }
  }

  ensureChart() {
    const L = this.lwc();
    if (!L || !this.container) {
      throw new Error('Lightweight Charts failed to load');
    }
    if (this.chart) return;

    this.chart = L.createChart(this.container, {
      autoSize: true,
      layout: {
        background: { type: (L.ColorType && L.ColorType.Solid) || 'solid', color: '#ffffff' },
        textColor: '#444',
        fontSize: 12
      },
      grid: {
        vertLines: { color: '#eee' },
        horzLines: { color: '#eee' }
      },
      crosshair: {
        mode: L.CrosshairMode.Normal
      },
      rightPriceScale: {
        borderColor: '#ddd',
        scaleMargins: { top: 0.08, bottom: 0.08 }
      },
      timeScale: {
        borderColor: '#ddd',
        timeVisible: this.interval === '1h',
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: this.interval === '1h' ? 8 : 14,
        minBarSpacing: 2
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true
      }
    });

    this.candleSeries = this.chart.addSeries(L.CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: '#667eea',
      priceLineWidth: 1
    });

    this.cloud = new IchimokuCloudPrimitive();
    this.chart.subscribeCrosshairMove((param) => this.onCrosshair(param));
    this.chart.subscribeClick((param) => this.onClick(param));
  }

  addLine(id, color, width = 2, dashed = false) {
    const L = this.lwc();
      const options = { color, lineWidth: width };
      if (dashed && L.LineStyle && L.LineStyle.Dashed !== undefined) {
        options.lineStyle = L.LineStyle.Dashed;
      }
      const series = this.chart.addSeries(L.LineSeries, options);
    this.overlaySeries[id] = series;
    return series;
  }

  applyOverlays() {
    const L = this.lwc();
    this.overlaySeries = {};
    this.volumeSeries = null;
    this.predictedLines = {};

    const line = (id, field, color, dashed = false) => {
      const data = toLineData(this.data, field);
      if (!data.length) return;
      try {
        const series = this.addLine(id, color, 2, dashed);
        series.setData(data);
      } catch (error) {
        throw new Error(`${id}: ${error.message || error}`);
      }
    };

    if (this.options.showMA20) line('ma20', 'ma20', '#10b981');
    if (this.options.showMA50) line('ma50', 'ma50', '#f59e0b');
    if (this.options.showMA100) line('ma100', 'ma100', '#ef4444');
    if (this.options.showMA200) line('ma200', 'ma200', '#8b5cf6');

    if (this.options.showIchimoku) {
      line('tenkan', 'tenkan', '#06b6d4', false);
      line('kijun', 'kijun', '#ec4899', false);
      line('senkouA', 'senkouA', '#10b981', true);
      line('senkouB', 'senkouB', '#ef4444', true);
      line('chikou', 'chikou', '#64748b', true);
      if (this.cloud && this.candleSeries && this.candleSeries.attachPrimitive) {
        try {
          this.candleSeries.attachPrimitive(this.cloud);
          this.cloud.setSpans(toLineData(this.data, 'senkouA'), toLineData(this.data, 'senkouB'));
          this.cloud.updateAllViews();
        } catch (error) {
          console.warn('ichimoku cloud skipped', error);
        }
      }
    }

    if (this.options.showVolume) {
      const volData = toHistogramData(this.data, 'volume');
      if (volData.length) {
        try {
          this.volumeSeries = this.chart.addSeries(L.HistogramSeries, {
            color: 'rgba(102, 126, 234, 0.35)',
            priceFormat: { type: 'volume' },
            lastValueVisible: false,
            priceLineVisible: false
          });
          this.volumeSeries.setData(volData);
          const volScale = this.volumeSeries.priceScale && this.volumeSeries.priceScale();
          if (volScale) {
            volScale.applyOptions({
              scaleMargins: { top: 0.82, bottom: 0 }
            });
          }
        } catch (error) {
          throw new Error(`volume: ${error.message || error}`);
        }
      }
    }

    if (this.predictedSeries) {
      const addPred = (id, points, color, width, dashed) => {
        const data = predictedToLine(points);
        if (!data.length) return;
        const series = this.addLine(id, color, width, dashed);
        series.setData(data);
        this.predictedLines[id] = series;
      };
      try {
        if (this.options.showPredicted && this.predictedSeries.predicted) {
          addPred('predicted', this.predictedSeries.predicted, '#9333ea', 2, true);
        }
        if (this.options.showActual && this.predictedSeries.actual) {
          addPred('actual', this.predictedSeries.actual, '#10b981', 2, false);
        }
        if (this.options.showNaive && this.predictedSeries.naive) {
          addPred('naive', this.predictedSeries.naive, '#f59e0b', 1, true);
        }
      } catch (error) {
        console.warn('predicted overlays skipped', error);
      }
    }
  }

  applyLastPriceMarker() {
    const L = this.lwc();
    const last = lastKnownRow(this.data);
    if (!last || !this.candleSeries) return;

    const marker = {
      time: Math.floor(last.timestamp / 1000),
      position: 'inBar',
      color: '#667eea',
      shape: 'circle',
      text: this.formatPrice(last.close)
    };

    try {
      if (typeof L.createSeriesMarkers === 'function') {
        this.markersApi = L.createSeriesMarkers(this.candleSeries, [marker]);
      } else if (this.candleSeries.setMarkers) {
        this.candleSeries.setMarkers([marker]);
      }
    } catch (error) {
      console.warn('last-price marker skipped', error);
    }
  }

  applyDefaultViewport() {
    if (!this.chart || !this.data || this.data.length === 0) return;
    const last = lastKnownRow(this.data);
    if (!last) {
      this.chart.timeScale().fitContent();
      return;
    }
    const candles = toCandleData(this.data);
    if (!candles.length) {
      this.chart.timeScale().fitContent();
      return;
    }
    const lastTime = candles[candles.length - 1].time;
    const firstTime = candles[0].time;
    const from = Math.max(firstTime, lastTime - DEFAULT_VIEWPORT_DAYS * 86400);
    this.chart.timeScale().applyOptions({
      timeVisible: this.interval === '1h',
      secondsVisible: false
    });
    try {
      this.chart.timeScale().setVisibleRange({ from, to: lastTime });
    } catch (error) {
      console.warn('viewport range skipped', error);
      this.chart.timeScale().fitContent();
    }
  }

  fitAll() {
    if (this.chart) this.chart.timeScale().fitContent();
  }

  resetViewport() {
    this.applyDefaultViewport();
  }

  clearDrawings() {
    this.priceLines.forEach((line) => {
      try { this.candleSeries.removePriceLine(line); } catch { /* already gone */ }
    });
    this.trendSeries.forEach((series) => {
      try { this.chart.removeSeries(series); } catch { /* already gone */ }
    });
    this.priceLines = [];
    this.trendSeries = [];
    this.trendAnchor = null;
  }

  onClick(param) {
    if (this.drawMode === 'none' || !param || !param.point || !this.candleSeries) return;
    const L = this.lwc();
    const price = this.candleSeries.coordinateToPrice(param.point.y);
    const time = timeKey(param.time);
    if (!Number.isFinite(price)) return;

    if (this.drawMode === 'horizontal') {
      const line = this.candleSeries.createPriceLine({
        price,
        color: '#f59e0b',
        lineWidth: 2,
        lineStyle: L.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'H'
      });
      this.priceLines.push(line);
      this.setDrawMode('none');
      return;
    }

    if (this.drawMode === 'trend') {
      if (!this.trendAnchor) {
        if (time == null) return;
        this.trendAnchor = { time, price };
        return;
      }
      if (time == null) return;
      const series = this.chart.addSeries(L.LineSeries, {
        color: '#111827',
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false
      });
      const points = [
        { time: this.trendAnchor.time, value: this.trendAnchor.price },
        { time, value: price }
      ].sort((a, b) => a.time - b.time);
      series.setData(points);
      this.trendSeries.push(series);
      this.trendAnchor = null;
      this.setDrawMode('none');
    }
  }

  onCrosshair(param) {
    if (!this.tooltip) return;
    if (!param || !param.point || param.time == null) {
      this.tooltip.classList.add('hidden');
      return;
    }
    const key = timeKey(param.time);
    const row = this.rowByTime.get(key);
    if (!row) {
      this.tooltip.classList.add('hidden');
      return;
    }

    const lines = [`${this.formatTime(row.timestamp)}`];
    if (Number.isFinite(row.close)) lines.push(`Price: $${this.formatPrice(row.close)}`);
    else lines.push('Price: gap (no print)');

    for (const [field, meta] of Object.entries(OVERLAY_META)) {
      if (!this.options[meta.option]) continue;
      if (field === 'volume') {
        if (Number.isFinite(row.volume)) {
          lines.push(`${meta.label}: ${row.volume >= 1e6 ? `${(row.volume / 1e6).toFixed(2)}M` : row.volume.toFixed(2)}`);
        }
        continue;
      }
      if (Number.isFinite(row[field])) {
        lines.push(`${meta.label}: $${this.formatPrice(row[field])}`);
      }
    }

    this.tooltip.innerHTML = lines.map((line) => `<div>${line}</div>`).join('');
    this.tooltip.classList.remove('hidden');

    const wrap = this.container.parentElement || this.container;
    const rect = wrap.getBoundingClientRect();
    const x = param.point.x;
    const y = param.point.y;
    const tipW = this.tooltip.offsetWidth || 180;
    const tipH = this.tooltip.offsetHeight || 80;
    let left = x + 16;
    let top = y + 16;
    if (left + tipW > rect.width - 8) left = x - tipW - 16;
    if (top + tipH > rect.height - 8) top = y - tipH - 16;
    this.tooltip.style.left = `${Math.max(8, left)}px`;
    this.tooltip.style.top = `${Math.max(8, top)}px`;
  }

  resize() {
    if (!this.chart || !this.container) return;
    this.chart.applyOptions({
      width: this.container.clientWidth,
      height: this.container.clientHeight
    });
  }

  render() {
    if (!this.data || this.data.length === 0) {
      this.showEmpty('No data to display');
      return;
    }

    this.hideEmpty();
    this.clearDrawings();
    this.destroyChart();

    const candles = toCandleData(this.data);
    if (!candles.length) {
      this.showEmpty('No plotted candles (missing readings stay gaps, not zeros).');
      return;
    }

    const step = (name, fn) => {
      try {
        fn();
      } catch (error) {
        console.error('chart render failed at', name, error);
        this.showEmpty(`${name}: ${error && error.message ? error.message : 'failed'} (candles=${candles.length})`);
        throw error;
      }
    };

    try {
      step('ensureChart', () => this.ensureChart());
      step('candles', () => this.candleSeries.setData(candles));
      step('overlays', () => this.applyOverlays());
      step('marker', () => this.applyLastPriceMarker());
      step('viewport', () => this.applyDefaultViewport());
      step('resize', () => this.resize());
    } catch {
      /* labeled empty state already set */
    }
  }
}
