import { test } from 'node:test';
import assert from 'node:assert';
import { filterForecasts, holdingsSymbolsFromInvestments, investmentsStoreIsEmpty } from './forecasts/filter.js';
import { buildForecastClickPayload, visibleRangeAroundTimestamp } from './forecasts/click.js';
import {
  FORECASTS_SCHEMA_VERSION,
  FORECASTS_STORAGE_KEY,
  migrateForecastsState,
  emptyForecastsState
} from './forecasts/schema.js';
import { ForecastsStore, MemoryStorage } from './forecasts/store.js';
import { ForecastsController } from './forecasts/controller.js';
import { buildForecastExportCsv, forecastsToExportRows } from './forecasts/export.js';
import { INVESTMENTS_STORAGE_KEY, emptyState as emptyInvestments } from './investments/schema.js';
import { InvestmentsStore } from './investments/store.js';

function sampleForecast(overrides = {}) {
  return {
    id: overrides.id || 'fc_BTC_weekly_1',
    symbol: 'BTC',
    horizon: 'weekly',
    horizonDays: 7,
    asOfTimestamp: Date.parse('2026-06-01T00:00:00Z'),
    asOfDateUtc: '2026-06-01',
    asOfPrice: 100,
    model: 'trend',
    modelVersion: 'trend-v1',
    predicted: { point: 110, lower: 105, upper: 115 },
    naive: { point: 100 },
    confidence: 72,
    features: { lastPrice: 100, trendPct: 2, ma20: 98 },
    rationale: {
      side: 'LONG',
      recommendation: 'LONG',
      changePercent: 10,
      proCase: 'Trend up',
      conCase: 'Volatility'
    },
    actual: { close: 108, timestamp: Date.parse('2026-06-08T00:00:00Z'), dateUtc: '2026-06-08' },
    score: { mae: 2, naiveMae: 8, direction: 'hit', naiveDirection: 'miss', maeVsNaive: 'better' },
    status: 'matured',
    ...overrides
  };
}

function investmentsWithHoldings() {
  const state = emptyInvestments();
  state.collections.events.push({
    id: 'e1',
    symbol: 'BTC',
    activityType: 'buy',
    badge: 'REAL'
  });
  state.collections.paperTrades.push({
    id: 'p1',
    symbol: 'ETH',
    side: 'BUY',
    badge: 'TRACKING'
  });
  state.collections.tracking.push({
    id: 't1',
    symbol: 'SOL',
    badge: 'TRACKING'
  });
  return state;
}

test('holdings symbols: REAL from events, TRACKING from paper + tracking', () => {
  const holdings = holdingsSymbolsFromInvestments(investmentsWithHoldings());
  assert.deepStrictEqual(holdings.real, ['BTC']);
  assert.ok(holdings.tracking.includes('ETH'));
  assert.ok(holdings.tracking.includes('SOL'));
  assert.strictEqual(holdings.active, true);
});

test('empty investments store leaves holdings filter inactive', () => {
  const empty = emptyInvestments();
  assert.strictEqual(investmentsStoreIsEmpty(empty), true);
  assert.strictEqual(holdingsSymbolsFromInvestments(empty).active, false);
  assert.strictEqual(holdingsSymbolsFromInvestments(null).active, false);
});

test('filter by REAL holdings vs TRACKING assets', () => {
  const forecasts = [
    sampleForecast({ id: 'btc', symbol: 'BTC' }),
    sampleForecast({ id: 'eth', symbol: 'ETH' }),
    sampleForecast({ id: 'sol', symbol: 'SOL' }),
    sampleForecast({ id: 'xrp', symbol: 'XRP' })
  ];
  const investmentsState = investmentsWithHoldings();

  const real = filterForecasts(forecasts, { holdingsFilter: 'REAL', investmentsState });
  assert.deepStrictEqual(real.rows.map((r) => r.symbol), ['BTC']);
  assert.strictEqual(real.filterInactive, false);

  const tracking = filterForecasts(forecasts, { holdingsFilter: 'TRACKING', investmentsState });
  assert.deepStrictEqual(tracking.rows.map((r) => r.symbol).sort(), ['ETH', 'SOL']);
  assert.ok(!tracking.rows.some((r) => r.symbol === 'BTC'));
});

test('empty investments store: REAL/TRACKING filter inactive, show all + note', () => {
  const forecasts = [
    sampleForecast({ id: 'btc', symbol: 'BTC' }),
    sampleForecast({ id: 'eth', symbol: 'ETH' })
  ];
  const result = filterForecasts(forecasts, {
    holdingsFilter: 'REAL',
    investmentsState: emptyInvestments()
  });
  assert.strictEqual(result.filterInactive, true);
  assert.strictEqual(result.rows.length, 2);
  assert.match(result.note, /filter inactive/i);
  assert.match(result.note, /scoreboard\.investments/);
});

test('weekly / monthly horizon filters', () => {
  const forecasts = [
    sampleForecast({ id: 'w', horizon: 'weekly' }),
    sampleForecast({ id: 'm', horizon: 'monthly', horizonDays: 30 })
  ];
  const weekly = filterForecasts(forecasts, { horizonFilter: 'weekly' });
  assert.strictEqual(weekly.rows.length, 1);
  assert.strictEqual(weekly.rows[0].horizon, 'weekly');
  const monthly = filterForecasts(forecasts, { horizonFilter: 'monthly' });
  assert.strictEqual(monthly.rows[0].horizon, 'monthly');
});

test('click payload includes chart jump timestamp + rationale', () => {
  const record = sampleForecast();
  const payload = buildForecastClickPayload(record);
  assert.strictEqual(payload.chartJumpTimestamp, record.asOfTimestamp);
  assert.ok(payload.rationale);
  assert.strictEqual(payload.rationale.proCase, 'Trend up');
  assert.strictEqual(payload.rationale.conCase, 'Volatility');
  assert.ok(payload.features);
  assert.strictEqual(payload.features.lastPrice, 100);
  assert.strictEqual(payload.symbol, 'BTC');
  assert.strictEqual(payload.horizon, 'weekly');

  const range = visibleRangeAroundTimestamp(payload.chartJumpTimestamp);
  assert.ok(range.from < range.to);
  assert.strictEqual(range.from, Math.floor(record.asOfTimestamp / 1000) - 5 * 86400);
});

test('ForecastsController selectForecast returns jump payload', () => {
  const storage = new MemoryStorage();
  const controller = new ForecastsController({
    store: new ForecastsStore({ storage }),
    view: { render() {}, root: null },
    onJump: null
  });
  const record = sampleForecast();
  controller.ingestPayload({ forecasts: [record], dataSource: 'fixture' });
  const click = controller.selectForecast(record.id);
  assert.strictEqual(click.chartJumpTimestamp, record.asOfTimestamp);
  assert.ok(click.rationale);
  assert.strictEqual(click.rationale.side, 'LONG');
});

test('client store migrates unversioned blobs and uses scoreboard.forecasts', () => {
  assert.strictEqual(FORECASTS_STORAGE_KEY, 'scoreboard.forecasts');
  assert.notStrictEqual(FORECASTS_STORAGE_KEY, INVESTMENTS_STORAGE_KEY);

  const migrated = migrateForecastsState({
    records: [sampleForecast()],
    settings: { holdingsFilter: 'REAL' }
  });
  assert.strictEqual(migrated.schemaVersion, FORECASTS_SCHEMA_VERSION);
  assert.strictEqual(migrated.namespace, 'forecasts');
  assert.strictEqual(migrated.collections.records.length, 1);
  assert.strictEqual(migrated.collections.settings.holdingsFilter, 'REAL');
  assert.strictEqual(migrated.migratedFrom, 0);

  const storage = new MemoryStorage({
    [FORECASTS_STORAGE_KEY]: JSON.stringify({ items: [sampleForecast()] })
  });
  const store = new ForecastsStore({ storage });
  const state = store.load();
  assert.strictEqual(state.schemaVersion, 1);
  assert.strictEqual(state.collections.records.length, 1);
});

test('export CSV leaves MAE blank when not matured — never writes 0', () => {
  const early = sampleForecast({
    id: 'early',
    status: 'too-early',
    actual: null,
    score: { mae: null, naiveMae: null, direction: null, naiveDirection: null, maeVsNaive: null }
  });
  const rows = forecastsToExportRows([early]);
  assert.strictEqual(rows[0].mae, '');
  assert.strictEqual(rows[0].naiveMae, '');
  const csv = buildForecastExportCsv([early]);
  assert.match(csv, /too-early/);
  assert.ok(!csv.split('\n')[1].includes(',0,'));
});

test('emptyForecastsState starts with all-filters', () => {
  const empty = emptyForecastsState();
  assert.strictEqual(empty.collections.settings.holdingsFilter, 'all');
  assert.strictEqual(empty.collections.settings.horizonFilter, 'all');
});

test('InvestmentsStore namespace is readable by the forecast filter', () => {
  const inv = new InvestmentsStore({ storage: new MemoryStorage() });
  inv.load();
  inv.commitImport({
    rawRows: [{ lineNumber: 1, raw: {}, record: {} }],
    events: [{
      fingerprint: 'fp1',
      symbol: 'BTC',
      activityType: 'buy',
      activityDate: '2024-01-01'
    }]
  });
  const forecasts = [sampleForecast({ symbol: 'BTC' }), sampleForecast({ id: 'eth', symbol: 'ETH' })];
  const filtered = filterForecasts(forecasts, {
    holdingsFilter: 'REAL',
    investmentsState: inv.getState()
  });
  assert.deepStrictEqual(filtered.rows.map((r) => r.symbol), ['BTC']);
});
