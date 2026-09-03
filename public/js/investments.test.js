import { test } from 'node:test';
import assert from 'node:assert';
import { buildSyntheticCsv, parseActivityCsv, CANONICAL_COLUMNS } from './investments/csv.js';
import { classifyActivityType, normalizeRows, parseOptionalNumber } from './investments/parse.js';
import { previewImport, validateEvents } from './investments/validate.js';
import {
  INVESTMENTS_SCHEMA_VERSION,
  INVESTMENTS_STORAGE_KEY,
  migrateInvestmentsState,
  emptyState
} from './investments/schema.js';
import { InvestmentsStore, MemoryStorage } from './investments/store.js';
import { computeLotsAndPnl, formatMissing } from './investments/lots.js';
import { buildTransactionMarker, buildTransactionMarkers, formatMarkerDetail } from './investments/markers.js';
import { startTrackingInput, trackingForwardPerformance, validatePaperTrade } from './investments/tracking.js';
import { buildExportCsv, buildExportJson } from './investments/export.js';

const SYNTHETIC_HEADERS = CANONICAL_COLUMNS;

function syntheticRows() {
  return [
    {
      'Activity/Trade Date': '2024-01-10',
      'Transaction Date': '2024-01-10',
      'Settlement Date': '2024-01-12',
      'Activity Type': 'Bought',
      Description: 'SYNTHETIC BUY BTC',
      Symbol: 'BTC',
      Cusip: 'SYN-BTC',
      Quantity: '10',
      Price: '100',
      Amount: '-1000',
      Commission: '1',
      Category: 'Trade',
      Note: 'synthetic'
    },
    {
      'Activity/Trade Date': '2024-02-10',
      'Transaction Date': '2024-02-10',
      'Settlement Date': '2024-02-12',
      'Activity Type': 'Bought',
      Description: 'SYNTHETIC BUY BTC',
      Symbol: 'BTC',
      Cusip: 'SYN-BTC',
      Quantity: '5',
      Price: '120',
      Amount: '-600',
      Commission: '',
      Category: 'Trade',
      Note: 'synthetic'
    },
    {
      'Activity/Trade Date': '2024-03-10',
      'Transaction Date': '2024-03-10',
      'Settlement Date': '2024-03-12',
      'Activity Type': 'Sold',
      Description: 'SYNTHETIC SELL BTC',
      Symbol: 'BTC',
      Cusip: 'SYN-BTC',
      Quantity: '12',
      Price: '150',
      Amount: '1800',
      Commission: '',
      Category: 'Trade',
      Note: 'synthetic'
    },
    {
      'Activity/Trade Date': '2024-03-15',
      'Transaction Date': '2024-03-15',
      'Settlement Date': '2024-03-15',
      'Activity Type': 'Qualified Dividend',
      Description: 'SYNTHETIC DIVIDEND',
      Symbol: 'BTC',
      Cusip: 'SYN-BTC',
      Quantity: '',
      Price: '',
      Amount: '25',
      Commission: '',
      Category: 'Dividend',
      Note: 'synthetic'
    },
    {
      'Activity/Trade Date': '2024-04-01',
      'Transaction Date': '2024-04-01',
      'Settlement Date': '2024-04-01',
      'Activity Type': 'Bought',
      Description: 'MISSING PRICE — must not become a fill',
      Symbol: 'ETH',
      Cusip: '',
      Quantity: '3',
      Price: '',
      Amount: '-900',
      Commission: '',
      Category: 'Trade',
      Note: 'synthetic-missing-price'
    },
    {
      'Activity/Trade Date': '2024-04-02',
      'Transaction Date': '2024-04-02',
      'Settlement Date': '2024-04-02',
      'Activity Type': 'Sold',
      Description: 'MISSING QTY — must not become a fill',
      Symbol: 'ETH',
      Cusip: '',
      Quantity: '',
      Price: '50',
      Amount: '200',
      Commission: '',
      Category: 'Trade',
      Note: 'synthetic-missing-qty'
    },
    {
      'Activity/Trade Date': '2024-05-01',
      'Transaction Date': '2024-05-01',
      'Settlement Date': '2024-05-01',
      'Activity Type': 'Exchange',
      Description: 'SYNTHETIC EXCHANGE',
      Symbol: 'FBTC',
      Cusip: 'SYN-ETF',
      Quantity: '2',
      Price: '40',
      Amount: '',
      Commission: '',
      Category: 'Exchange',
      Note: 'needs-map'
    },
    {
      'Activity/Trade Date': '2024-05-02',
      'Transaction Date': '2024-05-02',
      'Settlement Date': '2024-05-02',
      'Activity Type': 'Expired',
      Description: 'SYNTHETIC OPTION EXPIRED',
      Symbol: 'XYZ 01/17/2025 10 C',
      Cusip: '',
      Quantity: '1',
      Price: '0',
      Amount: '0',
      Commission: '',
      Category: 'Option',
      Note: 'synthetic-option'
    },
    {
      'Activity/Trade Date': '2024-05-03',
      'Transaction Date': '2024-05-03',
      'Settlement Date': '2024-05-03',
      'Activity Type': 'Fee',
      Description: 'SYNTHETIC FEE',
      Symbol: '',
      Cusip: '',
      Quantity: '',
      Price: '',
      Amount: '-4.5',
      Commission: '4.5',
      Category: 'Fee',
      Note: 'synthetic-fee'
    }
  ];
}

function previewFromSynthetic(maps = []) {
  const csv = buildSyntheticCsv(syntheticRows(), SYNTHETIC_HEADERS);
  return previewImport(csv, { symbolMaps: maps, idPrefix: 'syn' });
}

test('parseActivityCsv reads canonical synthetic columns', () => {
  const csv = buildSyntheticCsv(syntheticRows());
  const parsed = parseActivityCsv(csv);
  assert.strictEqual(parsed.errors.length, 0);
  assert.strictEqual(parsed.rows.length, syntheticRows().length);
  assert.strictEqual(parsed.rows[0].record.Symbol, 'BTC');
  assert.strictEqual(parsed.rows[0].record['Activity Type'], 'Bought');
  assert.ok(parsed.canonicalHeaders.includes('Activity/Trade Date'));
});

test('previewImport validates and does not treat empty numbers as zero', () => {
  const preview = previewFromSynthetic();
  assert.strictEqual(preview.privacy.serverReceivesCsv, false);
  assert.strictEqual(preview.privacy.transmitted, false);
  assert.strictEqual(preview.canCommit, true);
  const missingPrice = preview.events.find((e) => e.note === 'synthetic-missing-price');
  assert.strictEqual(missingPrice.price, null);
  assert.strictEqual(missingPrice.flags.missingPrice, true);
  assert.strictEqual(missingPrice.flags.noFillInferred, true);
  assert.notStrictEqual(missingPrice.price, 0);
  const missingQty = preview.events.find((e) => e.note === 'synthetic-missing-qty');
  assert.strictEqual(missingQty.quantity, null);
  assert.strictEqual(missingQty.flags.missingQuantity, true);
  assert.ok(preview.warnings.some((w) => w.includes('no fill inferred')));
});

test('classifyActivityType covers supported kinds and leaves unknown unsupported', () => {
  assert.strictEqual(classifyActivityType('Bought'), 'buy');
  assert.strictEqual(classifyActivityType('Sold'), 'sell');
  assert.strictEqual(classifyActivityType('Qualified Dividend'), 'dividend');
  assert.strictEqual(classifyActivityType('Exchange'), 'exchange');
  assert.strictEqual(classifyActivityType('Option Expired'), 'expired');
  assert.strictEqual(classifyActivityType('Fee'), 'fee');
  assert.strictEqual(classifyActivityType('Wire Out'), 'unsupported');
  assert.strictEqual(classifyActivityType(''), 'unsupported');
});

test('parseOptionalNumber keeps blanks missing and keeps explicit zero', () => {
  assert.strictEqual(parseOptionalNumber(''), null);
  assert.strictEqual(parseOptionalNumber('--'), null);
  assert.strictEqual(parseOptionalNumber('0'), 0);
  assert.strictEqual(parseOptionalNumber('$(1,234.50)'), -1234.5);
});

test('missing quantity or price never opens or closes a lot', () => {
  const preview = previewFromSynthetic();
  const pnl = computeLotsAndPnl(preview.events, { costMethod: 'fifo' });
  const eth = pnl.REAL.positions.find((p) => p.symbol === 'ETH');
  assert.strictEqual(eth, undefined);
  assert.ok(pnl.REAL.skipped.some((s) => s.reason === 'missing_quantity_or_price'));
  assert.ok(pnl.REAL.skipped.every((s) => s.noFillInferred === true));
});

test('FIFO realized P&L, remaining basis, and dividends stay separate from missing marks', () => {
  const preview = previewFromSynthetic();
  const pnl = computeLotsAndPnl(preview.events, { costMethod: 'fifo' });
  const btc = pnl.REAL.positions.find((p) => p.symbol === 'BTC');
  assert.ok(btc);
  assert.strictEqual(btc.quantity, 3);
  assert.strictEqual(btc.costBasis, 360);
  assert.strictEqual(btc.unrealizedPnl, null);
  assert.strictEqual(btc.markPrice, null);
  assert.ok(Math.abs(pnl.REAL.realizedPnl - (10 * 50 + 2 * 30 - 1)) < 1e-9);
  assert.strictEqual(pnl.REAL.dividendsTotal, 25);
  assert.strictEqual(formatMissing(pnl.REAL.unrealizedPnl), 'missing');
});

test('average-cost method is selectable and distinct from FIFO', () => {
  const events = [
    { id: 'a', badge: 'REAL', activityType: 'buy', symbol: 'BTC', activityDate: '2024-01-01', quantity: 10, price: 100, commission: null, flags: {} },
    { id: 'b', badge: 'REAL', activityType: 'buy', symbol: 'BTC', activityDate: '2024-02-01', quantity: 10, price: 200, commission: null, flags: {} },
    { id: 'c', badge: 'REAL', activityType: 'sell', symbol: 'BTC', activityDate: '2024-03-01', quantity: 10, price: 180, commission: null, flags: {} }
  ];
  const fifo = computeLotsAndPnl(events, { costMethod: 'fifo' });
  const avg = computeLotsAndPnl(events, { costMethod: 'average' });
  assert.strictEqual(fifo.REAL.realizedPnl, 800);
  assert.strictEqual(avg.REAL.realizedPnl, 300);
  assert.strictEqual(avg.REAL.positions[0].quantity, 10);
  assert.strictEqual(avg.REAL.positions[0].costBasis, 1500);
});

test('REAL and TRACKING lots and P&L are never mixed', () => {
  const events = [
    { id: 'r', badge: 'REAL', source: 'import', activityType: 'buy', symbol: 'BTC', activityDate: '2024-01-01', quantity: 10, price: 100, commission: null, flags: {} },
    { id: 't', badge: 'TRACKING', source: 'paper', activityType: 'buy', symbol: 'BTC', activityDate: '2024-01-01', quantity: 10, price: 200, commission: null, flags: {} }
  ];
  const pnl = computeLotsAndPnl(events, { costMethod: 'fifo', markPrices: { BTC: 150 } });
  assert.strictEqual(pnl.REAL.positions[0].costBasis, 1000);
  assert.strictEqual(pnl.TRACKING.positions[0].costBasis, 2000);
  assert.strictEqual(pnl.REAL.unrealizedPnl, 500);
  assert.strictEqual(pnl.TRACKING.unrealizedPnl, -500);
  assert.notStrictEqual(pnl.REAL.costBasis, pnl.TRACKING.costBasis);
  assert.strictEqual((pnl.REAL.costBasis || 0) + (pnl.TRACKING.costBasis || 0), 3000);
});

test('transaction marker data keeps exact date, qty, price, fees, source; missing stays missing', () => {
  const event = {
    id: 'm1',
    badge: 'REAL',
    source: 'import',
    activityType: 'buy',
    symbol: 'BTC',
    activityDate: '2024-01-10',
    quantity: 10,
    price: 100,
    commission: 1.25,
    flags: { noFillInferred: false }
  };
  const marker = buildTransactionMarker(event);
  assert.strictEqual(marker.date, '2024-01-10');
  assert.strictEqual(marker.quantity, 10);
  assert.strictEqual(marker.price, 100);
  assert.strictEqual(marker.fees, 1.25);
  assert.strictEqual(marker.source, 'import');
  assert.strictEqual(marker.badge, 'REAL');
  assert.ok(Number.isFinite(marker.time));

  const incomplete = buildTransactionMarker({
    ...event,
    id: 'm2',
    quantity: null,
    price: null,
    commission: null,
    flags: { missingQuantity: true, missingPrice: true, noFillInferred: true }
  });
  assert.strictEqual(incomplete.quantity, null);
  assert.strictEqual(incomplete.price, null);
  assert.strictEqual(incomplete.fees, null);
  const detail = formatMarkerDetail(incomplete);
  assert.ok(detail.lines.some((line) => line === 'Qty: missing'));
  assert.ok(detail.lines.some((line) => line === 'Price: missing'));
  assert.ok(detail.lines.some((line) => line === 'Fees: missing'));

  const markers = buildTransactionMarkers([event, { ...event, symbol: 'ETH', id: 'other' }], 'BTC');
  assert.strictEqual(markers.length, 1);
  assert.strictEqual(markers[0].symbol, 'BTC');
});

test('start/stop tracking preserves history and stays TRACKING', () => {
  const store = new InvestmentsStore({ storage: new MemoryStorage() });
  const started = startTrackingInput({ symbol: 'eth', startDate: '2024-01-01', baselinePrice: 2000 });
  assert.strictEqual(started.ok, true);
  const record = store.addTracking(started.record);
  assert.strictEqual(record.badge, 'TRACKING');
  assert.strictEqual(record.status, 'active');
  const stopped = store.stopTracking(record.id, { stopDate: '2024-06-01', stopPrice: 3000 });
  assert.strictEqual(stopped.status, 'stopped');
  assert.strictEqual(stopped.startDate, '2024-01-01');
  assert.strictEqual(stopped.baselinePrice, 2000);
  assert.strictEqual(stopped.history.length, 2);
  assert.strictEqual(stopped.history[0].action, 'start');
  assert.strictEqual(stopped.history[1].action, 'stop');
  assert.strictEqual(store.collection('tracking').length, 1);
  const perf = trackingForwardPerformance(stopped);
  assert.ok(Math.abs(perf.returnPct - 0.5) < 1e-9);
  assert.strictEqual(perf.badge, 'TRACKING');
});

test('schema migration wraps unversioned blobs into namespaced v1 collections', () => {
  const migrated = migrateInvestmentsState({
    rawTransactions: [{ id: 'raw1', raw: { Symbol: 'BTC' } }],
    events: [{ id: 'e1', badge: 'REAL', symbol: 'BTC' }],
    paper: [{ id: 'p1', side: 'BUY' }]
  });
  assert.strictEqual(migrated.schemaVersion, INVESTMENTS_SCHEMA_VERSION);
  assert.strictEqual(migrated.namespace, 'investments');
  assert.strictEqual(migrated.collections.rawTransactions[0].id, 'raw1');
  assert.strictEqual(migrated.collections.events[0].id, 'e1');
  assert.strictEqual(migrated.collections.paperTrades[0].id, 'p1');
  assert.strictEqual(migrated.collections.settings.costMethod, 'fifo');
  assert.strictEqual(migrated.migratedFrom, 0);

  const empty = migrateInvestmentsState(null);
  assert.deepStrictEqual(empty.collections.events, []);
  assert.notStrictEqual(INVESTMENTS_STORAGE_KEY, 'forecasts');
  assert.strictEqual(INVESTMENTS_STORAGE_KEY, 'scoreboard.investments');
});

test('commitImport stores raw rows and events under investments namespace only', () => {
  const memory = new MemoryStorage();
  const store = new InvestmentsStore({ storage: memory });
  const preview = previewFromSynthetic();
  const result = store.commitImport(preview, { sourceFileName: 'synthetic-activity.csv' });
  assert.ok(result.added > 0);
  assert.strictEqual(store.collection('rawTransactions').length, preview.rawRows.length);
  assert.strictEqual(store.collection('events').every((e) => e.badge === 'REAL'), true);
  const persisted = JSON.parse(memory.getItem(INVESTMENTS_STORAGE_KEY));
  assert.strictEqual(persisted.namespace, 'investments');
  assert.ok(persisted.collections.rawTransactions.length);
  assert.strictEqual(memory.getItem('forecasts'), null);

  const again = store.commitImport(preview, { sourceFileName: 'synthetic-activity.csv' });
  assert.strictEqual(again.added, 0);
});

test('paper BUY/SELL is always TRACKING and rejected without qty/price', () => {
  const store = new InvestmentsStore({ storage: new MemoryStorage() });
  const bad = validatePaperTrade({ side: 'BUY', symbol: 'SOL', date: '2024-07-01' });
  assert.strictEqual(bad.ok, false);
  const good = validatePaperTrade({
    side: 'BUY',
    symbol: 'sol',
    date: '2024-07-01',
    quantity: 2,
    price: 140
  });
  assert.strictEqual(good.ok, true);
  const trade = store.addPaperTrade(good.trade);
  assert.strictEqual(trade.badge, 'TRACKING');
  const events = store.allFillEvents();
  assert.strictEqual(events.some((e) => e.badge === 'TRACKING' && e.activityType === 'buy'), true);
});

test('exchange and options require explicit mapping and do not infer symbols', () => {
  const preview = previewFromSynthetic();
  const exchange = preview.events.find((e) => e.activityType === 'exchange');
  assert.strictEqual(exchange.flags.needsExplicitMapping, true);
  assert.strictEqual(exchange.symbol, 'FBTC');
  const pnl = computeLotsAndPnl(preview.events);
  assert.ok(pnl.REAL.skipped.some((s) => s.reason === 'needs_explicit_mapping'));

  const mappedPreview = previewFromSynthetic([
    { id: 'map1', fromSymbol: 'FBTC', toSymbol: 'BTC' }
  ]);
  const mapped = mappedPreview.events.find((e) => e.activityType === 'exchange');
  assert.strictEqual(mapped.mapped, true);
  assert.strictEqual(mapped.symbol, 'BTC');
});

test('local export JSON/CSV include badges and do not claim transmission', () => {
  const state = emptyState();
  state.collections.events.push({
    activityDate: '2024-01-10',
    activityType: 'buy',
    symbol: 'BTC',
    quantity: 1,
    price: 100,
    badge: 'REAL',
    source: 'import'
  });
  const json = JSON.parse(buildExportJson(state));
  assert.strictEqual(json.privacy.transmitted, false);
  assert.strictEqual(json.namespace, 'investments');
  const csv = buildExportCsv(state.collections.events);
  assert.ok(csv.includes('Badge'));
  assert.ok(csv.includes('REAL'));
});

test('validateEvents flags unsupported and mapping-required rows', () => {
  const events = normalizeRows([
    {
      lineNumber: 2,
      raw: {},
      record: {
        'Activity/Trade Date': '2024-01-01',
        'Activity Type': 'Journal',
        Symbol: 'ABC'
      }
    }
  ]);
  const { warnings } = validateEvents(events);
  assert.ok(warnings.some((w) => w.includes('unsupported')));
});
