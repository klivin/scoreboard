import { test, mock } from 'node:test';
import assert from 'node:assert';
import { ChartView } from './chart-view.js';

function sampleRow(dayOffset, close) {
  const ts = Date.parse('2026-08-01T00:00:00Z') + dayOffset * 86400000;
  return {
    timestamp: ts,
    open: close - 100,
    high: close + 100,
    low: close - 200,
    close,
    volume: 1e9,
    ma20: close - 50,
    ma50: close - 80,
    ma100: close - 120,
    ma200: close - 150,
    tenkan: close - 30,
    kijun: close - 40,
    senkouA: close - 60,
    senkouB: close - 70,
    chikou: close - 20,
    etf_net_flow_usd_millions: 12.4,
    oi: 2.1e6
  };
}

function makeMockChart(initialRange = { from: 40, to: 45 }) {
  let visibleLogicalRange = { ...initialRange };
  let fitContentCalls = 0;

  const timeScale = {
    getVisibleLogicalRange: () => ({ ...visibleLogicalRange }),
    setVisibleLogicalRange: (range) => {
      visibleLogicalRange = { from: range.from, to: range.to };
    },
    getVisibleRange: () => null,
    setVisibleRange: (range) => {
      visibleLogicalRange = { from: range.from, to: range.to };
    },
    fitContent: () => {
      fitContentCalls += 1;
      visibleLogicalRange = { from: 0, to: 100 };
    },
    applyOptions: () => {}
  };

  const panes = [{ setStretchFactor: () => {}, addSeries: null }];
  const seriesByPane = new Map();

  const chart = {
    timeScale: () => timeScale,
    panes: () => panes,
    addPane: () => {
      panes.push({ setStretchFactor: () => {}, addSeries: (definition, options) => {
        const series = { setData: () => {}, definition, options };
        return series;
      } });
    },
    removePane: (index) => {
      if (index >= 1 && index < panes.length) panes.splice(index, 1);
    },
    addSeries: (_definition, _options, paneIndex = 0) => {
      const series = {
        setData: () => {},
        attachPrimitive: () => {},
        detachPrimitive: () => {}
      };
      if (!seriesByPane.has(paneIndex)) seriesByPane.set(paneIndex, []);
      seriesByPane.get(paneIndex).push(series);
      return series;
    },
    removeSeries: (series) => {
      for (const [paneIndex, list] of seriesByPane.entries()) {
        const next = list.filter((item) => item !== series);
        if (next.length !== list.length) {
          seriesByPane.set(paneIndex, next);
          return;
        }
      }
    },
    applyOptions: () => {},
    subscribeCrosshairMove: () => {},
    subscribeClick: () => {},
    remove: () => {},
    _state: {
      get visibleLogicalRange() { return visibleLogicalRange; },
      get fitContentCalls() { return fitContentCalls; }
    }
  };

  return chart;
}

function installDomMocks() {
  const noop = () => {};
  const stubEl = () => ({
    classList: { toggle: noop, add: noop, remove: noop },
    addEventListener: noop,
    textContent: '',
    innerHTML: '',
    style: {},
    offsetWidth: 180,
    offsetHeight: 80,
    parentElement: null,
    clientWidth: 800,
    clientHeight: 420,
    getBoundingClientRect: () => ({ width: 800, height: 420 })
  });

  globalThis.document = {
    getElementById: (id) => {
      if (id === 'chart-wrap') return { style: {} };
      if (id === 'chart') return stubEl();
      return stubEl();
    },
    querySelectorAll: () => []
  };
  globalThis.window = globalThis.window || {};
  globalThis.window.addEventListener = noop;
}
function installMockLightweightCharts(chartFactory) {
  installDomMocks();
  const L = {
    ColorType: { Solid: 'solid' },
    CrosshairMode: { Normal: 0 },
    LineStyle: { Dashed: 1 },
    CandlestickSeries: 'candlestick',
    LineSeries: 'line',
    HistogramSeries: 'histogram',
    createChart: () => chartFactory(),
    createSeriesMarkers: () => ({})
  };
  globalThis.window = globalThis.window || {};
  globalThis.window.LightweightCharts = L;
  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 0;
  };
  return L;
}

function setupChartView(initialRange) {
  const mockChart = makeMockChart(initialRange);
  installMockLightweightCharts(() => mockChart);

  const container = {
    clientWidth: 800,
    clientHeight: 420,
    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    addEventListener: () => {},
    parentElement: { getBoundingClientRect: () => ({ width: 800, height: 420 }) }
  };

  const view = new ChartView('chart');
  view.container = container;
  view.chart = mockChart;
  view.candleSeries = {
    setData: () => {},
    attachPrimitive: () => {},
    detachPrimitive: () => {}
  };
  view.cloud = { setSpans: () => {}, updateAllViews: () => {} };
  view.data = Array.from({ length: 60 }, (_, i) => sampleRow(i, 70000 + i * 10));
  view.rowByTime = new Map(view.data.map((row) => [Math.floor(row.timestamp / 1000), row]));

  return { view, mockChart };
}

test('captureVisibleRange prefers logical range over time range', () => {
  const { view } = setupChartView({ from: 12, to: 18 });
  const captured = view.captureVisibleRange();
  assert.deepStrictEqual(captured, { kind: 'logical', range: { from: 12, to: 18 } });
});

test('overlay toggles preserve the visible logical range', () => {
  const manualRange = { from: 33.5, to: 36.2 };
  const { view, mockChart } = setupChartView(manualRange);
  mockChart.timeScale().setVisibleLogicalRange(manualRange);

  const toggles = [
    ['showMA200', true],
    ['showIchimoku', true],
    ['showVolume', false],
    ['showEtf', true],
    ['showOi', false],
    ['showMA20', false],
    ['showPredicted', true]
  ];

  for (const [option, value] of toggles) {
    view.setOption(option, value);
    view.refreshOverlays();
    const range = mockChart._state.visibleLogicalRange;
    assert.strictEqual(range.from, manualRange.from, `${option} changed range.from`);
    assert.strictEqual(range.to, manualRange.to, `${option} changed range.to`);
  }
});

test('fitAll and resetViewport change the visible range', () => {
  const manualRange = { from: 33.5, to: 36.2 };
  const { view, mockChart } = setupChartView(manualRange);
  mockChart.timeScale().setVisibleLogicalRange(manualRange);

  view.fitAll();
  assert.notStrictEqual(mockChart._state.visibleLogicalRange.from, manualRange.from);
  assert.notStrictEqual(mockChart._state.visibleLogicalRange.to, manualRange.to);
  assert.strictEqual(mockChart._state.fitContentCalls, 1);

  mockChart.timeScale().setVisibleLogicalRange(manualRange);
  view.resetViewport();
  assert.notStrictEqual(mockChart._state.visibleLogicalRange.from, manualRange.from);
  assert.notStrictEqual(mockChart._state.visibleLogicalRange.to, manualRange.to);
});

test('jumpToTimestamp sets visible range around the as-of bar', () => {
  const { view, mockChart } = setupChartView({ from: 0, to: 10 });
  const asOf = Date.parse('2026-08-10T00:00:00Z');
  const jumped = view.jumpToTimestamp(asOf);
  assert.ok(jumped);
  assert.strictEqual(jumped.timestamp, asOf);
  const expectedFrom = Math.floor(asOf / 1000) - 5 * 86400;
  const expectedTo = Math.floor(asOf / 1000) + 2 * 86400;
  assert.deepStrictEqual(jumped.range, { from: expectedFrom, to: expectedTo });
  assert.strictEqual(mockChart._state.visibleLogicalRange.from, expectedFrom);
  assert.strictEqual(mockChart._state.visibleLogicalRange.to, expectedTo);
});

test('restoreVisibleRange falls back to time range when logical range unavailable', () => {
  const { view } = setupChartView({ from: 0, to: 1 });
  const timeScale = {
    getVisibleLogicalRange: () => null,
    getVisibleRange: () => ({ from: 1700000000, to: 1700086400 }),
    setVisibleLogicalRange: () => {
      throw new Error('logical unsupported');
    },
    setVisibleRange: mock.fn((range) => {
      timeScale.lastSet = range;
    })
  };
  view.chart = { timeScale: () => timeScale };

  view.restoreVisibleRange(
    { kind: 'time', range: { from: 1700000000, to: 1700086400 } },
    { immediate: true }
  );

  assert.deepStrictEqual(timeScale.lastSet, { from: 1700000000, to: 1700086400 });
});
