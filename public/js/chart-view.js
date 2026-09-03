import { lastKnownRow, toCandleData, toLineData, toHistogramData, timeKey, predictedToLine } from './chart-data.js';
import { IchimokuCloudPrimitive } from './ichimoku-cloud.js';
import {
  PRICE_PANE_INDEX,
  chartWrapHeight,
  paneStretchFactor
} from './chart-panes.js';
import { buildTooltipLines, formatPrice as formatPriceLabel } from './chart-tooltip.js';

const DEFAULT_VIEWPORT_DAYS = 5;

export class ChartView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.tooltip = document.getElementById('chart-tooltip');
    this.emptyEl = document.getElementById('chart-empty');
    this.dayStrip = document.getElementById('chart-day-strip');
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
    this.lastHoverRow = null;
    this.options = {
      showMA20: true,
      showMA50: true,
      showMA100: false,
      showMA200: false,
      showIchimoku: false,
      showVolume: true,
      showEtf: false,
      showOi: false,
      showPredicted: false,
      showActual: false,
      showNaive: true
    };

    window.addEventListener('resize', () => this.resize());
    if (this.container) {
      this.container.addEventListener('click', () => {
        if (this.lastHoverRow) this.updateDayStrip(this.lastHoverRow);
      });
    }
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
    return formatPriceLabel(price);
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
    this.etfSeries = null;
    this.oiSeries = null;
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
        autoScale: true,
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
      priceLineWidth: 1,
      priceScaleId: 'right'
    }, PRICE_PANE_INDEX);

    this.cloud = new IchimokuCloudPrimitive();
    this.chart.subscribeCrosshairMove((param) => this.onCrosshair(param));
    this.chart.subscribeClick((param) => this.onClick(param));
  }

  addLine(id, color, width = 2, dashed = false, paneIndex = PRICE_PANE_INDEX) {
    const L = this.lwc();
    const options = { color, lineWidth: width };
    if (dashed && L.LineStyle && L.LineStyle.Dashed !== undefined) {
      options.lineStyle = L.LineStyle.Dashed;
    }
    const series = this.chart.addSeries(L.LineSeries, options, paneIndex);
    this.overlaySeries[id] = series;
    return series;
  }

  applyChartHeight() {
    const wrap = document.getElementById('chart-wrap');
    if (wrap) {
      wrap.style.height = `${chartWrapHeight(this.options)}px`;
    }
  }

  applyPaneStretch() {
    if (!this.chart || typeof this.chart.panes !== 'function') return;
    const panes = this.chart.panes();
    panes.forEach((pane, index) => {
      if (pane && typeof pane.setStretchFactor === 'function') {
        pane.setStretchFactor(paneStretchFactor(index));
      }
    });
  }

  captureVisibleRange() {
    if (!this.chart) return null;
    const ts = this.chart.timeScale();
    try {
      if (typeof ts.getVisibleLogicalRange === 'function') {
        const logical = ts.getVisibleLogicalRange();
        if (logical && Number.isFinite(logical.from) && Number.isFinite(logical.to)) {
          return { kind: 'logical', range: { from: logical.from, to: logical.to } };
        }
      }
    } catch {
      /* fall through to time range */
    }
    try {
      if (typeof ts.getVisibleRange === 'function') {
        const time = ts.getVisibleRange();
        if (time && time.from != null && time.to != null) {
          return { kind: 'time', range: { from: time.from, to: time.to } };
        }
      }
    } catch {
      /* no visible range available */
    }
    return null;
  }

  restoreVisibleRange(captured, { immediate = false } = {}) {
    if (!this.chart || !captured) return;
    const apply = () => {
      const ts = this.chart.timeScale();
      try {
        if (captured.kind === 'logical' && typeof ts.setVisibleLogicalRange === 'function') {
          ts.setVisibleLogicalRange(captured.range);
          return;
        }
        if (captured.kind === 'time' && typeof ts.setVisibleRange === 'function') {
          ts.setVisibleRange(captured.range);
        }
      } catch (error) {
        console.warn('viewport restore skipped', error);
      }
    };
    if (immediate) {
      apply();
      return;
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(apply));
      return;
    }
    apply();
  }

  detachIchimokuCloud() {
    if (this.cloud && this.candleSeries && typeof this.candleSeries.detachPrimitive === 'function') {
      try {
        this.candleSeries.detachPrimitive(this.cloud);
      } catch {
        /* already detached */
      }
    }
  }

  removeOverlaySeries() {
    if (!this.chart) return;
    this.detachIchimokuCloud();
    const seriesToRemove = new Set([
      ...Object.values(this.overlaySeries),
      ...Object.values(this.predictedLines),
      this.volumeSeries,
      this.etfSeries,
      this.oiSeries
    ].filter(Boolean));
    for (const series of seriesToRemove) {
      try {
        this.chart.removeSeries(series);
      } catch {
        /* already removed */
      }
    }
    this.overlaySeries = {};
    this.predictedLines = {};
    this.volumeSeries = null;
    this.etfSeries = null;
    this.oiSeries = null;
  }

  trimOverlayPanes() {
    if (!this.chart || typeof this.chart.panes !== 'function') return;
    if (typeof this.chart.removePane !== 'function') return;
    while (this.chart.panes().length > 1) {
      try {
        this.chart.removePane(this.chart.panes().length - 1);
      } catch {
        break;
      }
    }
  }

  refreshOverlays() {
    if (!this.chart || !this.data || this.data.length === 0) return;

    const captured = this.captureVisibleRange();
    this.removeOverlaySeries();
    this.trimOverlayPanes();
    this.applyChartHeight();

    try {
      this.applyOverlays();
    } catch (error) {
      console.error('overlay refresh failed', error);
      throw error;
    }

    this.restoreVisibleRange(captured);
    this.resize();
  }

  ensureOverlayPane(paneIndex) {
    if (!this.chart || typeof this.chart.addPane !== 'function') return paneIndex;
    while (this.chart.panes().length <= paneIndex) {
      this.chart.addPane();
    }
    return paneIndex;
  }

  addSeriesToPane(definition, options, paneIndex) {
    this.ensureOverlayPane(paneIndex);
    const panes = this.chart.panes && this.chart.panes();
    const pane = panes && panes[paneIndex];
    if (pane && typeof pane.addSeries === 'function') {
      return pane.addSeries(definition, options);
    }
    return this.chart.addSeries(definition, options, paneIndex);
  }

  addOverlayHistogram(id, field, paneIndex, colorForRow, priceFormat) {
    const L = this.lwc();
    const data = toHistogramData(this.data, field, colorForRow);
    if (!data.length) return null;
    const series = this.addSeriesToPane(L.HistogramSeries, {
      color: 'rgba(102, 126, 234, 0.45)',
      priceFormat,
      lastValueVisible: true,
      priceLineVisible: false
    }, paneIndex);
    series.setData(data);
    this.overlaySeries[id] = series;
    return series;
  }

  applyOverlays() {
    const L = this.lwc();
    this.overlaySeries = {};
    this.volumeSeries = null;
    this.etfSeries = null;
    this.oiSeries = null;
    this.predictedLines = {};

    const line = (id, field, color, dashed = false) => {
      const data = toLineData(this.data, field);
      if (!data.length) return;
      try {
        const series = this.addLine(id, color, 2, dashed, PRICE_PANE_INDEX);
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

    if (this.predictedSeries) {
      const addPred = (id, points, color, width, dashed) => {
        const data = predictedToLine(points);
        if (!data.length) return;
        const series = this.addLine(id, color, width, dashed, PRICE_PANE_INDEX);
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

    let paneIndex = 1;

    if (this.options.showVolume) {
      try {
        this.volumeSeries = this.addOverlayHistogram(
          'volume',
          'volume',
          paneIndex,
          (row) => (
            Number.isFinite(row.close) && Number.isFinite(row.open) && row.close >= row.open
              ? 'rgba(16, 185, 129, 0.5)'
              : 'rgba(239, 68, 68, 0.5)'
          ),
          { type: 'volume' }
        );
        if (this.volumeSeries) paneIndex += 1;
      } catch (error) {
        throw new Error(`volume: ${error.message || error}`);
      }
    }

    if (this.options.showEtf) {
      try {
        this.etfSeries = this.addOverlayHistogram(
          'etf',
          'etf_net_flow_usd_millions',
          paneIndex,
          (_row, value) => (
            value >= 0 ? 'rgba(16, 185, 129, 0.55)' : 'rgba(239, 68, 68, 0.55)'
          ),
          {
            type: 'custom',
            minMove: 0.1,
            formatter: (value) => `${Number(value).toFixed(1)}M`
          }
        );
        if (this.etfSeries) paneIndex += 1;
      } catch (error) {
        throw new Error(`etf: ${error.message || error}`);
      }
    }

    if (this.options.showOi) {
      const oiData = toLineData(this.data, 'oi');
      if (oiData.length) {
        try {
          this.oiSeries = this.addSeriesToPane(L.LineSeries, {
            color: '#0ea5e9',
            lineWidth: 2,
            lastValueVisible: true,
            priceLineVisible: false,
            priceFormat: { type: 'volume' }
          }, paneIndex);
          this.oiSeries.setData(oiData);
          paneIndex += 1;
        } catch (error) {
          throw new Error(`oi: ${error.message || error}`);
        }
      }
    }

    this.applyPaneStretch();
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

  rowFromParam(param) {
    if (!param || param.time == null) return null;
    const key = timeKey(param.time);
    if (key == null) return null;
    return this.rowByTime.get(key) || null;
  }

  updateDayStrip(row) {
    if (!this.dayStrip) return;
    if (!row) {
      this.dayStrip.classList.add('hidden');
      this.dayStrip.innerHTML = '';
      return;
    }
    const lines = buildTooltipLines(row, this.options, this.interval);
    this.dayStrip.innerHTML = `<div class="day-strip-title">Day detail</div>${
      lines.map((line) => `<div>${line}</div>`).join('')
    }`;
    this.dayStrip.classList.remove('hidden');
  }

  onClick(param) {
    const row = this.rowFromParam(param) || this.lastHoverRow;
    if (row) this.updateDayStrip(row);

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
    const row = this.rowFromParam(param);
    this.lastHoverRow = row;
    if (!row) {
      this.tooltip.classList.add('hidden');
      return;
    }

    const lines = buildTooltipLines(row, this.options, this.interval);
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
    this.applyChartHeight();

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
