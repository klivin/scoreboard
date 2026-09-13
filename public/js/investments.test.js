import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildSyntheticCsv,
  buildEtradePreambleCsv,
  buildEtradePositionsCsv,
  parseActivityCsv,
  parsePositionsCsv,
  parseBrokerageCsv,
  CANONICAL_COLUMNS,
  ETRADE_SYNTHETIC_FOOTER,
  normalizeHeader,
  mapHeader,
  isFooterProseText,
  isNonDatedNonActivityRecord
} from './investments/csv.js';
import { classifyActivityType, normalizeRows, parseOptionalNumber, resolveImportedUnitCost } from './investments/parse.js';
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
import { InvestmentsController } from './investments/controller.js';
import {
  classifyImportedInstrument,
  defaultInstrumentClass,
  formatInstrumentLabel,
  resolveWatchInstrument
} from './investments/instrument.js';
import { collectWatchTargets, fillLotState, resolveWatchEntry, scaleBuyFillPrices } from './investments/watch.js';
import { fetchSymbolMark } from './investments/marks.js';
import { buildExportCsv, buildExportJson } from './investments/export.js';
import {
  buildWatchRows,
  evaluateTargetZone,
  sortWatchRows,
  watchReturnPct
} from './investments/watch.js';
import { lastFiniteClose, closeOnOrBeforeDate, markFromIndicatorsPayload } from './investments/marks.js';
import { isPrimaryViewWatchlist, renderWorkspaceHtml } from './investments/view.js';

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
  assert.strictEqual(classifyActivityType('Bought To Open'), 'option');
  assert.strictEqual(classifyActivityType('Sold To Close'), 'option');
  assert.strictEqual(classifyActivityType('Exchange'), 'exchange');
  assert.strictEqual(classifyActivityType('Exchange Delivered Out'), 'exchange');
  assert.strictEqual(classifyActivityType('Exchange Received In'), 'exchange');
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

function etradePreambleRows() {
  return [
    {
      'Activity/Trade Date': '08/10/2026',
      'Transaction Date': '08/10/2026',
      'Settlement Date': '08/12/2026',
      'Activity Type': 'Bought',
      Description: 'SYNTHETIC BUY FAKE1',
      Symbol: 'FAKE1',
      Cusip: 'SYN-FAKE1',
      Quantity: '10',
      Price: '25',
      Amount: '-250',
      Commission: '1',
      Category: 'Trade',
      Note: 'synthetic-bought'
    },
    {
      'Activity/Trade Date': '08/12/2026',
      'Transaction Date': '08/12/2026',
      'Settlement Date': '08/14/2026',
      'Activity Type': 'Bought To Open',
      Description: 'SYNTHETIC OPEN FAKE1',
      Symbol: 'FAKE1',
      Cusip: 'SYN-FAKE1',
      Quantity: '2',
      Price: '20',
      Amount: '-40',
      Commission: '',
      Category: 'Trade',
      Note: 'synthetic-bought-to-open'
    },
    {
      'Activity/Trade Date': '08/20/2026',
      'Transaction Date': '08/20/2026',
      'Settlement Date': '08/22/2026',
      'Activity Type': 'Sold',
      Description: 'SYNTHETIC SELL FAKE1',
      Symbol: 'FAKE1',
      Cusip: 'SYN-FAKE1',
      Quantity: '4',
      Price: '40',
      Amount: '160',
      Commission: '',
      Category: 'Trade',
      Note: 'synthetic-sold'
    },
    {
      'Activity/Trade Date': '06/01/2026',
      'Transaction Date': '06/01/2026',
      'Settlement Date': '06/01/2026',
      'Activity Type': 'Qualified Dividend',
      Description: 'SYNTHETIC DIVIDEND FAKE1',
      Symbol: 'FAKE1',
      Cusip: 'SYN-FAKE1',
      Quantity: '',
      Price: '',
      Amount: '12.5',
      Commission: '',
      Category: 'Dividend',
      Note: 'synthetic-dividend'
    },
    {
      'Activity/Trade Date': '05/01/2026',
      'Transaction Date': '05/01/2026',
      'Settlement Date': '05/01/2026',
      'Activity Type': 'Option Expired',
      Description: 'SYNTHETIC OPTION EXPIRED',
      Symbol: 'FAKE3',
      Cusip: '',
      Quantity: '1',
      Price: '0',
      Amount: '0',
      Commission: '',
      Category: 'Option',
      Note: 'synthetic-option-expired'
    },
    {
      'Activity/Trade Date': '04/01/2026',
      'Transaction Date': '04/01/2026',
      'Settlement Date': '04/01/2026',
      'Activity Type': 'Exchange Delivered Out',
      Description: 'SYNTHETIC EXCHANGE OUT',
      Symbol: 'FAKE4',
      Cusip: 'SYN-FAKE4',
      Quantity: '3',
      Price: '',
      Amount: '',
      Commission: '',
      Category: 'Exchange',
      Note: 'synthetic-exchange-out'
    },
    {
      'Activity/Trade Date': '04/01/2026',
      'Transaction Date': '04/01/2026',
      'Settlement Date': '04/01/2026',
      'Activity Type': 'Exchange Received In',
      Description: 'SYNTHETIC EXCHANGE IN',
      Symbol: 'FAKE5',
      Cusip: 'SYN-FAKE5',
      Quantity: '3',
      Price: '',
      Amount: '',
      Commission: '',
      Category: 'Exchange',
      Note: 'synthetic-exchange-in'
    }
  ];
}

test('parseActivityCsv still rejects files with no Activity header row', () => {
  const parsed = parseActivityCsv('Investment Transactions Activity Types\n\nTotal:,1\n');
  assert.deepStrictEqual(parsed.errors, ['No recognized Activity CSV columns']);
  assert.strictEqual(parsed.rows.length, 0);
  assert.strictEqual(parsed.headerLineNumber, null);
});

test('normalizeHeader strips trailing # / $ suffixes used by E*TRADE exports', () => {
  assert.strictEqual(normalizeHeader('Quantity #'), 'quantity');
  assert.strictEqual(normalizeHeader('Price $'), 'price');
  assert.strictEqual(normalizeHeader('Amount $'), 'amount');
  assert.strictEqual(mapHeader('Quantity #'), 'Quantity');
  assert.strictEqual(mapHeader('Price $'), 'Price');
  assert.strictEqual(mapHeader('Amount $'), 'Amount');
  assert.strictEqual(mapHeader('Activity/Trade Date'), 'Activity/Trade Date');
});

test('E*TRADE preamble + #/$ headers: parse finds columns and maps fills vs non-fills', () => {
  const csv = buildEtradePreambleCsv(etradePreambleRows());
  assert.ok(csv.startsWith('Investment Transactions Activity Types'));
  assert.ok(csv.includes('Total:,20519.86'));
  assert.ok(csv.includes('Quantity #,Price $,Amount $'));
  assert.ok(!csv.includes('Wise Decisions'));
  assert.ok(!/FAKE\d{4,}/.test(csv));

  const parsed = parseActivityCsv(csv);
  assert.ok(!parsed.errors.includes('No recognized Activity CSV columns'));
  assert.strictEqual(parsed.errors.length, 0);
  assert.ok(parsed.headerLineNumber >= 5);
  assert.ok(parsed.canonicalHeaders.includes('Activity/Trade Date'));
  assert.ok(parsed.canonicalHeaders.includes('Quantity'));
  assert.ok(parsed.canonicalHeaders.includes('Price'));
  assert.ok(parsed.canonicalHeaders.includes('Amount'));
  assert.strictEqual(parsed.rows.length, etradePreambleRows().length);
  assert.strictEqual(parsed.rows[0].record.Symbol, 'FAKE1');
  assert.strictEqual(parsed.rows[0].record.Quantity, '10');
  assert.strictEqual(parsed.rows[0].record.Price, '25');
  assert.ok(parsed.rows[0].lineNumber > parsed.headerLineNumber);

  const preview = previewImport(csv, { idPrefix: 'etrade_syn' });
  assert.strictEqual(preview.privacy.serverReceivesCsv, false);
  assert.strictEqual(preview.privacy.transmitted, false);
  assert.ok(!preview.errors.includes('No recognized Activity CSV columns'));
  assert.strictEqual(preview.errors.length, 0);
  assert.strictEqual(preview.canCommit, true);
  assert.ok(preview.events.every((event) => event.badge === 'REAL'));
  assert.ok(!preview.warnings.some((w) => w.includes('no usable Activity/Trade or Transaction Date')));
  assert.ok(!preview.warnings.some((w) => w.includes('unsupported activity type')));

  const bought = preview.events.find((e) => e.note === 'synthetic-bought');
  const sold = preview.events.find((e) => e.note === 'synthetic-sold');
  const opened = preview.events.find((e) => e.note === 'synthetic-bought-to-open');
  const dividend = preview.events.find((e) => e.note === 'synthetic-dividend');
  const expired = preview.events.find((e) => e.note === 'synthetic-option-expired');
  const exchangeOut = preview.events.find((e) => e.note === 'synthetic-exchange-out');
  const exchangeIn = preview.events.find((e) => e.note === 'synthetic-exchange-in');

  assert.strictEqual(bought.activityType, 'buy');
  assert.strictEqual(bought.flags.noFillInferred, false);
  assert.strictEqual(sold.activityType, 'sell');
  assert.strictEqual(sold.flags.noFillInferred, false);
  assert.strictEqual(opened.activityType, 'option');
  assert.strictEqual(opened.flags.noFillInferred, true);
  assert.strictEqual(dividend.activityType, 'dividend');
  assert.strictEqual(dividend.flags.noFillInferred, true);
  assert.strictEqual(expired.activityType, 'expired');
  assert.strictEqual(expired.flags.noFillInferred, true);
  assert.strictEqual(exchangeOut.activityType, 'exchange');
  assert.strictEqual(exchangeOut.flags.noFillInferred, true);
  assert.strictEqual(exchangeIn.activityType, 'exchange');
  assert.strictEqual(exchangeIn.flags.noFillInferred, true);

  const pnl = computeLotsAndPnl(preview.events, { costMethod: 'fifo' });
  const fake1 = pnl.REAL.positions.find((p) => p.symbol === 'FAKE1');
  assert.ok(fake1);
  assert.strictEqual(fake1.quantity, 6);
  assert.strictEqual(fake1.costBasis, 150);
  assert.ok(Math.abs(pnl.REAL.realizedPnl - 59.6) < 1e-9);
  assert.strictEqual(pnl.REAL.dividendsTotal, 12.5);
  assert.ok(pnl.REAL.closedLots.some((lot) => lot.qty === 4 && lot.sellPrice === 40));
  assert.ok(pnl.REAL.skipped.some((s) => s.event.note === 'synthetic-bought-to-open'));
  assert.ok(pnl.REAL.skipped.some((s) => s.event.note === 'synthetic-option-expired'));
  assert.ok(pnl.REAL.skipped.some((s) => s.event.note === 'synthetic-exchange-out'));
  assert.ok(pnl.REAL.skipped.some((s) => s.event.note === 'synthetic-exchange-in'));
  assert.ok(pnl.REAL.skipped.every((s) => s.noFillInferred === true));
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

function etradeFollowUpRows() {
  return [
    {
      'Activity/Trade Date': '08/10/2026',
      'Transaction Date': '08/10/2026',
      'Settlement Date': '08/12/2026',
      'Activity Type': 'Bought',
      Description: 'SYNTHETIC BUY FAKE1',
      Symbol: 'FAKE1',
      Cusip: 'SYN-FAKE1',
      Quantity: '10',
      Price: '25',
      Amount: '-250',
      Commission: '1',
      Category: 'Trade',
      Note: 'synthetic-bought'
    },
    {
      'Activity/Trade Date': '08/12/2026',
      'Transaction Date': '08/12/2026',
      'Settlement Date': '08/14/2026',
      'Activity Type': 'Bought To Open',
      Description: 'SYNTHETIC OPEN FAKE1',
      Symbol: 'FAKE1',
      Cusip: 'SYN-FAKE1',
      Quantity: '2',
      Price: '20',
      Amount: '-40',
      Commission: '',
      Category: 'Trade',
      Note: 'synthetic-bought-to-open'
    },
    {
      'Activity/Trade Date': '08/20/2026',
      'Transaction Date': '08/20/2026',
      'Settlement Date': '08/22/2026',
      'Activity Type': 'Sold',
      Description: 'SYNTHETIC SELL FAKE1',
      Symbol: 'FAKE1',
      Cusip: 'SYN-FAKE1',
      Quantity: '4',
      Price: '40',
      Amount: '160',
      Commission: '',
      Category: 'Trade',
      Note: 'synthetic-sold'
    },
    {
      'Activity/Trade Date': '06/01/2026',
      'Transaction Date': '06/01/2026',
      'Settlement Date': '06/01/2026',
      'Activity Type': 'Qualified Dividend',
      Description: 'SYNTHETIC DIVIDEND FAKE1',
      Symbol: 'FAKE1',
      Cusip: 'SYN-FAKE1',
      Quantity: '',
      Price: '',
      Amount: '12.5',
      Commission: '',
      Category: 'Dividend',
      Note: 'synthetic-dividend'
    },
    {
      'Activity/Trade Date': '05/01/2026',
      'Transaction Date': '05/01/2026',
      'Settlement Date': '05/01/2026',
      'Activity Type': 'Option Expired',
      Description: 'SYNTHETIC OPTION EXPIRED',
      Symbol: 'FAKE3',
      Cusip: '',
      Quantity: '1',
      Price: '',
      Amount: '',
      Commission: '',
      Category: 'Option',
      Note: 'synthetic-option-expired'
    },
    {
      'Activity/Trade Date': '04/01/2026',
      'Transaction Date': '04/01/2026',
      'Settlement Date': '04/01/2026',
      'Activity Type': 'Exchange Delivered Out',
      Description: 'SYNTHETIC EXCHANGE OUT NO SYMBOL',
      Symbol: '--',
      Cusip: '',
      Quantity: '3',
      Price: '',
      Amount: '',
      Commission: '',
      Category: 'Exchange',
      Note: 'synthetic-exchange-out-dash'
    },
    {
      'Activity/Trade Date': '04/01/2026',
      'Transaction Date': '04/01/2026',
      'Settlement Date': '04/01/2026',
      'Activity Type': 'Exchange Received In',
      Description: 'SYNTHETIC EXCHANGE IN',
      Symbol: 'FAKE5',
      Cusip: 'SYN-FAKE5',
      Quantity: '3',
      Price: '',
      Amount: '',
      Commission: '',
      Category: 'Exchange',
      Note: 'synthetic-exchange-in'
    }
  ];
}

test('footer helpers recognize disclaimer prose and non-dated non-activity rows', () => {
  assert.strictEqual(isFooterProseText('Brokerage services are offered by Morgan Stanley Smith Barney LLC.'), true);
  assert.strictEqual(isFooterProseText('Member SIPC.'), true);
  assert.strictEqual(isFooterProseText('08/10/2026,Bought,FAKE1'), false);
  assert.strictEqual(isNonDatedNonActivityRecord({
    'Activity/Trade Date': '',
    'Transaction Date': '',
    'Activity Type': ''
  }), true);
  assert.strictEqual(isNonDatedNonActivityRecord({
    'Activity/Trade Date': '08/10/2026',
    'Activity Type': 'Bought'
  }), false);
});

test('E*TRADE footer prose after a blank gap is ignored, not listed as unsupported trades', () => {
  const csv = buildEtradePreambleCsv(etradeFollowUpRows(), { footer: true });
  assert.ok(csv.includes('Brokerage services are offered'));
  assert.ok(csv.includes('Morgan Stanley'));
  assert.ok(!/FAKE\d{4,}/.test(csv));

  const parsed = parseActivityCsv(csv);
  assert.strictEqual(parsed.stoppedAtFooter, true);
  assert.strictEqual(parsed.rows.length, etradeFollowUpRows().length);
  assert.ok(parsed.rows.every((row) => !isFooterProseText(Object.values(row.raw).join(' '))));
  assert.ok(!parsed.rows.some((row) => /morgan stanley|brokerage services/i.test(JSON.stringify(row))));

  const preview = previewImport(csv, { idPrefix: 'etrade_footer' });
  assert.strictEqual(preview.canCommit, true);
  assert.strictEqual(preview.events.length, etradeFollowUpRows().length);
  assert.ok(!preview.warnings.some((w) => w.includes('unsupported activity type')));
  assert.ok(!preview.events.some((e) => e.flags.unsupported));
  assert.ok(!preview.events.some((e) => /morgan stanley|brokerage services/i.test(e.description || '')));
});

test('consecutive non-dated non-activity rows stop parsing without a blank gap', () => {
  const csv = buildEtradePreambleCsv(etradeFollowUpRows(), {
    footer: [
      'This paragraph is trailing legal copy without a trade date.',
      'Another non-dated disclaimer sentence that is not an activity row.'
    ],
    footerGap: false
  });
  assert.ok(!csv.includes(ETRADE_SYNTHETIC_FOOTER[0]));
  const parsed = parseActivityCsv(csv);
  assert.strictEqual(parsed.stoppedAtFooter, true);
  assert.strictEqual(parsed.rows.length, etradeFollowUpRows().length);
  const preview = previewImport(csv, { idPrefix: 'etrade_consec' });
  assert.ok(!preview.warnings.some((w) => w.includes('unsupported activity type')));
  assert.ok(!preview.events.some((e) => e.flags.unsupported));
});

test('E*TRADE follow-up: options stay off share lots; empty option price missing; exchange -- unmapped', () => {
  const csv = buildEtradePreambleCsv(etradeFollowUpRows(), { footer: true });
  const preview = previewImport(csv, { idPrefix: 'etrade_followup' });
  assert.strictEqual(preview.privacy.serverReceivesCsv, false);
  assert.strictEqual(preview.privacy.transmitted, false);
  assert.ok(!preview.errors.includes('No recognized Activity CSV columns'));

  const bought = preview.events.find((e) => e.note === 'synthetic-bought');
  const sold = preview.events.find((e) => e.note === 'synthetic-sold');
  const opened = preview.events.find((e) => e.note === 'synthetic-bought-to-open');
  const dividend = preview.events.find((e) => e.note === 'synthetic-dividend');
  const expired = preview.events.find((e) => e.note === 'synthetic-option-expired');
  const exchangeDash = preview.events.find((e) => e.note === 'synthetic-exchange-out-dash');
  const exchangeIn = preview.events.find((e) => e.note === 'synthetic-exchange-in');

  assert.strictEqual(bought.activityType, 'buy');
  assert.strictEqual(bought.flags.noFillInferred, false);
  assert.strictEqual(sold.activityType, 'sell');
  assert.strictEqual(sold.flags.noFillInferred, false);

  assert.strictEqual(opened.activityType, 'option');
  assert.strictEqual(opened.flags.noFillInferred, true);
  assert.strictEqual(opened.flags.needsExplicitMapping, true);
  assert.strictEqual(opened.symbol, 'FAKE1');

  assert.strictEqual(expired.activityType, 'expired');
  assert.strictEqual(expired.price, null);
  assert.strictEqual(expired.flags.missingPrice, true);
  assert.notStrictEqual(expired.price, 0);
  assert.strictEqual(expired.flags.noFillInferred, true);
  assert.strictEqual(expired.flags.needsExplicitMapping, true);

  assert.strictEqual(exchangeDash.activityType, 'exchange');
  assert.strictEqual(exchangeDash.symbol, null);
  assert.strictEqual(exchangeDash.symbolRaw, null);
  assert.strictEqual(exchangeDash.raw.Symbol, '--');
  assert.strictEqual(exchangeDash.flags.needsExplicitMapping, true);
  assert.strictEqual(exchangeDash.price, null);
  assert.ok(preview.warnings.some((w) => w.includes('no automatic inference')));

  assert.strictEqual(exchangeIn.activityType, 'exchange');
  assert.strictEqual(exchangeIn.symbol, 'FAKE5');
  assert.strictEqual(exchangeIn.price, null);
  assert.strictEqual(exchangeIn.flags.missingPrice, true);
  assert.strictEqual(exchangeIn.flags.needsExplicitMapping, true);
  assert.notStrictEqual(exchangeIn.price, 0);
  assert.strictEqual(exchangeIn.raw.Symbol, 'FAKE5');

  assert.strictEqual(dividend.activityType, 'dividend');
  assert.strictEqual(dividend.quantity, null);
  assert.strictEqual(dividend.price, null);
  assert.strictEqual(dividend.amount, 12.5);
  assert.strictEqual(dividend.flags.noFillInferred, true);

  const shareOnly = preview.events.filter((e) => e.note === 'synthetic-bought' || e.note === 'synthetic-sold');
  const sharePnl = computeLotsAndPnl(shareOnly, { costMethod: 'fifo' });
  const allPnl = computeLotsAndPnl(preview.events, { costMethod: 'fifo' });
  const sharePos = sharePnl.REAL.positions.find((p) => p.symbol === 'FAKE1');
  const allPos = allPnl.REAL.positions.find((p) => p.symbol === 'FAKE1');
  assert.ok(sharePos);
  assert.ok(allPos);
  assert.strictEqual(allPos.quantity, sharePos.quantity);
  assert.strictEqual(allPos.costBasis, sharePos.costBasis);
  assert.strictEqual(allPos.quantity, 6);
  assert.strictEqual(allPos.costBasis, 150);
  assert.ok(Math.abs(allPnl.REAL.realizedPnl - sharePnl.REAL.realizedPnl) < 1e-9);
  assert.ok(Math.abs(allPnl.REAL.realizedPnl - 59.6) < 1e-9);
  assert.strictEqual(allPnl.REAL.dividendsTotal, 12.5);
  assert.strictEqual(allPnl.REAL.positions.find((p) => p.symbol === 'FAKE3'), undefined);
  assert.strictEqual(allPnl.REAL.positions.find((p) => p.symbol === 'FAKE5'), undefined);

  assert.ok(allPnl.REAL.skipped.some((s) => s.event.note === 'synthetic-bought-to-open'));
  assert.ok(allPnl.REAL.skipped.some((s) => s.event.note === 'synthetic-option-expired'));
  assert.ok(allPnl.REAL.skipped.some((s) => s.event.note === 'synthetic-exchange-out-dash' && s.reason === 'needs_explicit_mapping'));
  assert.ok(allPnl.REAL.skipped.some((s) => s.event.note === 'synthetic-exchange-in' && s.reason === 'needs_explicit_mapping'));
  assert.ok(allPnl.REAL.dividends.some((d) => d.amount === 12.5 && d.symbol === 'FAKE1'));

  const mappedOpen = previewImport(csv, {
    idPrefix: 'etrade_mapped_opt',
    symbolMaps: [{ id: 'opt1', fromSymbol: 'FAKE1', toSymbol: 'FAKE1' }]
  });
  const mappedPnl = computeLotsAndPnl(mappedOpen.events, { costMethod: 'fifo' });
  const mappedPos = mappedPnl.REAL.positions.find((p) => p.symbol === 'FAKE1');
  assert.strictEqual(mappedPos.quantity, 6);
  assert.strictEqual(mappedPos.costBasis, 150);
  assert.ok(mappedPnl.REAL.skipped.some((s) => (
    s.event.note === 'synthetic-bought-to-open' && s.reason === 'option_not_share_lot'
  )));
});

test('watch row % uses start mark; short inverts; missing stays missing', () => {
  assert.ok(Math.abs(watchReturnPct({ startMark: 100, mark: 110, direction: 'long' }) - 0.1) < 1e-9);
  assert.ok(Math.abs(watchReturnPct({ startMark: 100, mark: 110, direction: 'put' }) + 0.1) < 1e-9);
  assert.strictEqual(watchReturnPct({ startMark: 100, mark: null }), null);
  assert.strictEqual(watchReturnPct({ startMark: 0, mark: 10 }), null);
  assert.strictEqual(watchReturnPct({ startMark: null, mark: 10 }), null);
});

test('in-zone: long open is buy-at-or-below; long with lot is sell-at-or-above', () => {
  const buy = evaluateTargetZone({ mark: 95, target: 100, direction: 'long', hasRealLot: false });
  assert.strictEqual(buy.inZone, true);
  assert.strictEqual(buy.zone, 'buy');
  assert.strictEqual(buy.badge, 'buy zone');

  const notBuy = evaluateTargetZone({ mark: 120, target: 100, direction: 'long', hasRealLot: false });
  assert.strictEqual(notBuy.inZone, false);
  assert.strictEqual(notBuy.badge, null);

  const sell = evaluateTargetZone({ mark: 120, target: 100, direction: 'long', hasRealLot: true });
  assert.strictEqual(sell.inZone, true);
  assert.strictEqual(sell.zone, 'sell');

  const range = evaluateTargetZone({
    mark: 105,
    target: 100,
    targetHigh: 110,
    direction: 'long',
    hasRealLot: false
  });
  assert.strictEqual(range.inZone, true);
  assert.strictEqual(range.zone, 'buy');

  const shortOpen = evaluateTargetZone({ mark: 130, target: 120, direction: 'short', hasRealLot: false });
  assert.strictEqual(shortOpen.inZone, true);
  assert.strictEqual(shortOpen.zone, 'sell');

  assert.strictEqual(evaluateTargetZone({ mark: null, target: 100 }).inZone, false);
});

test('in-zone watch rows pin above others', () => {
  const rows = buildWatchRows({
    tracking: [
      { id: 'a', symbol: 'ZZZ', startDate: '2026-09-11', baselinePrice: 10, targetPrice: 5, direction: 'long', status: 'active' },
      { id: 'b', symbol: 'AAA', startDate: '2026-09-11', baselinePrice: 10, targetPrice: 20, direction: 'long', status: 'active' }
    ],
    markPrices: { ZZZ: 12, AAA: 8 }
  });
  assert.strictEqual(rows[0].symbol, 'AAA');
  assert.strictEqual(rows[0].inZone, true);
  assert.strictEqual(rows[0].zoneBadge, 'buy zone');
  assert.ok(Math.abs(rows[0].returnPct - ((8 - 10) / 10)) < 1e-9);
  assert.strictEqual(rows[1].symbol, 'ZZZ');
  assert.strictEqual(rows[1].inZone, false);
  const sorted = sortWatchRows([{ symbol: 'M', inZone: false }, { symbol: 'B', inZone: true }]);
  assert.strictEqual(sorted[0].symbol, 'B');
});

test('watch row uses real cost/entry when a REAL lot exists', () => {
  const rows = buildWatchRows({
    tracking: [
      { id: 't', symbol: 'FAKE1', startDate: '2026-09-11', baselinePrice: 99, targetPrice: 40, direction: 'long', status: 'active' }
    ],
    realPositions: [{ symbol: 'FAKE1', quantity: 6, costBasis: 150, averagePrice: 25 }],
    markPrices: { FAKE1: 40 }
  });
  assert.strictEqual(rows[0].entry, 25);
  assert.strictEqual(rows[0].entryKind, 'cost');
  assert.strictEqual(rows[0].hasRealLot, true);
  assert.strictEqual(rows[0].inZone, true);
  assert.strictEqual(rows[0].zone, 'sell');
});

test('normalizeHeader maps E*TRADE Cost Basis / Last Price columns', () => {
  assert.strictEqual(normalizeHeader('Cost Basis $'), 'cost basis');
  assert.strictEqual(normalizeHeader('Cost Basis ($)'), 'cost basis');
  assert.strictEqual(mapHeader('Cost Basis $'), 'CostBasis');
  assert.strictEqual(mapHeader('Average Cost $'), 'AverageCost');
  assert.strictEqual(mapHeader('Last Price $'), 'LastPrice');
  assert.strictEqual(mapHeader('Market Value $'), 'MarketValue');
  assert.strictEqual(mapHeader('Quantity #'), 'Quantity');
});

function etradePositionsRows() {
  return [
    {
      Symbol: 'FAKE1',
      Quantity: '6',
      LastPrice: '40',
      CostBasis: '150',
      AverageCost: '25',
      MarketValue: '240'
    },
    {
      Symbol: 'FAKE2',
      Quantity: '2',
      LastPrice: '10',
      CostBasis: '',
      AverageCost: '5',
      MarketValue: '20'
    },
    {
      Symbol: 'FAKE3',
      Quantity: '1',
      LastPrice: '99',
      CostBasis: '',
      AverageCost: '',
      MarketValue: '99'
    }
  ];
}

test('E*TRADE Positions: Cost Basis is lot cost; Last Price is mark not basis', () => {
  const csv = buildEtradePositionsCsv(etradePositionsRows(), { footer: true });
  assert.ok(csv.includes('Last Price $,Cost Basis $,Average Cost $'));
  assert.ok(!/FAKE\d{4,}/.test(csv));

  const parsed = parsePositionsCsv(csv);
  assert.strictEqual(parsed.kind, 'positions');
  assert.ok(parsed.canonicalHeaders.includes('CostBasis'));
  assert.ok(parsed.canonicalHeaders.includes('LastPrice'));
  assert.ok(parsed.canonicalHeaders.includes('AverageCost'));
  assert.strictEqual(parsed.rows.length, 3);

  const viaBroker = parseBrokerageCsv(csv);
  assert.strictEqual(viaBroker.kind, 'positions');

  const cost = resolveImportedUnitCost(parsed.rows[0].record, { kind: 'positions' });
  assert.strictEqual(cost.price, 25);
  assert.strictEqual(cost.lastPrice, 40);
  assert.notStrictEqual(cost.price, cost.lastPrice);

  const preview = previewImport(csv, { idPrefix: 'pos_syn' });
  assert.strictEqual(preview.kind, 'positions');
  assert.strictEqual(preview.privacy.serverReceivesCsv, false);
  assert.strictEqual(preview.canCommit, true);

  const fake1Event = preview.events.find((e) => e.symbol === 'FAKE1');
  assert.strictEqual(fake1Event.price, 25);
  assert.strictEqual(fake1Event.lastPrice, 40);
  assert.strictEqual(fake1Event.costBasis, 150);
  assert.strictEqual(fake1Event.activityType, 'buy');
  assert.strictEqual(fake1Event.badge, 'REAL');

  const fake3 = preview.events.find((e) => e.symbol === 'FAKE3');
  assert.strictEqual(fake3.price, null);
  assert.strictEqual(fake3.lastPrice, 99);
  assert.strictEqual(fake3.flags.missingPrice, true);
  assert.strictEqual(fake3.flags.noFillInferred, true);

  const pnl = computeLotsAndPnl(preview.events, {
    costMethod: 'fifo',
    markPrices: { FAKE1: 40, FAKE2: 10 }
  });
  const fake1 = pnl.REAL.positions.find((p) => p.symbol === 'FAKE1');
  assert.ok(fake1);
  assert.strictEqual(fake1.quantity, 6);
  assert.strictEqual(fake1.costBasis, 150);
  assert.strictEqual(fake1.averagePrice, 25);
  assert.strictEqual(fake1.markPrice, 40);
  assert.strictEqual(fake1.unrealizedPnl, 90);
  assert.ok(Math.abs(fake1.unrealizedPct - 0.6) < 1e-9);
  assert.notStrictEqual(fake1.costBasis, 240);

  const fake2 = pnl.REAL.positions.find((p) => p.symbol === 'FAKE2');
  assert.strictEqual(fake2.costBasis, 10);
  assert.strictEqual(fake2.unrealizedPnl, 10);
  assert.strictEqual(pnl.REAL.positions.find((p) => p.symbol === 'FAKE3'), undefined);
});

test('Activity CSV still uses fill Price; Cost Basis fills only when Price is missing', () => {
  const withPrice = resolveImportedUnitCost({
    Quantity: '10',
    Price: '25',
    CostBasis: '999'
  }, { kind: 'activity' });
  assert.strictEqual(withPrice.price, 25);

  const noPrice = resolveImportedUnitCost({
    Quantity: '10',
    Price: '',
    CostBasis: '250'
  }, { kind: 'activity' });
  assert.strictEqual(noPrice.price, 25);
  assert.strictEqual(noPrice.usedCostBasisColumn, true);
});

test('lastFiniteClose and start-date close never invent prices', () => {
  const series = [
    { date_utc: '2026-09-09', close: 10, timestamp: 1 },
    { date_utc: '2026-09-10', close: null, timestamp: 2 },
    { date_utc: '2026-09-11', close: 12, timestamp: 3 }
  ];
  assert.strictEqual(lastFiniteClose(series).close, 12);
  assert.strictEqual(closeOnOrBeforeDate(series, '2026-09-10').close, 10);
  assert.strictEqual(closeOnOrBeforeDate([
    { date_utc: '2026-09-10', close: 10 },
    { date_utc: '2026-09-11 13:30:00', close: 12 }
  ], '2026-09-11').close, 12);
  assert.strictEqual(markFromIndicatorsPayload({ error: 'missing' }), null);
  assert.strictEqual(lastFiniteClose([]), null);
  assert.strictEqual(lastFiniteClose([{ close: null }]), null);
});

test('primary Investments workspace is the watchlist, not the ledger', () => {
  const state = emptyState();
  state.collections.tracking.push({
    id: 'w1',
    symbol: 'CDNS',
    startDate: '2026-09-11',
    baselinePrice: 280,
    targetPrice: 300,
    direction: 'long',
    status: 'active'
  });
  state.collections.events.push({
    activityDate: '2026-08-10',
    activityType: 'buy',
    symbol: 'FAKE1',
    quantity: 6,
    price: 25,
    badge: 'REAL',
    source: 'import'
  });
  const pnl = computeLotsAndPnl(state.collections.events, {
    costMethod: 'fifo',
    markPrices: { FAKE1: 40, CDNS: 290 }
  });
  const html = renderWorkspaceHtml({
    storeState: state,
    pnl,
    markPrices: { FAKE1: 40, CDNS: 290 }
  });
  assert.strictEqual(isPrimaryViewWatchlist(html), true);
  assert.ok(html.indexOf('id="inv-watch-table"') < html.indexOf('id="inv-ledger"'));
  assert.match(html, /<details[^>]*id="inv-ledger"/);
  assert.ok(html.includes('inv-watch-form'));
  assert.ok(html.includes('inv-real-table'));
  assert.ok(html.includes('CDNS'));
  assert.ok(html.includes('buy zone') || html.includes('FAKE1'));
  assert.ok(!html.includes('Confirmed imported transactions. P&amp;L is not mixed with TRACKING.'));
  assert.ok(html.includes('>Price<'));
  assert.ok(!html.includes('Live mark'));
  assert.ok(html.includes('inv-remove-btn'));
  assert.ok(!html.includes('history kept'));
  assert.doesNotMatch(html, /id="inv-watch-table"[\s\S]*badge-tracking[\s\S]*id="inv-real-table"/);
});

test('instrument class: OKX coins vs Yahoo ETFs vs equity', () => {
  assert.strictEqual(defaultInstrumentClass('BTC'), 'crypto');
  assert.strictEqual(defaultInstrumentClass('ETH'), 'crypto');
  assert.strictEqual(defaultInstrumentClass('IBIT'), 'etf');
  assert.strictEqual(defaultInstrumentClass('ETHA'), 'etf');
  assert.strictEqual(defaultInstrumentClass('CDNS'), 'equity');
  assert.strictEqual(defaultInstrumentClass('HYPE'), 'crypto');
  assert.strictEqual(formatInstrumentLabel({ symbol: 'BTC', assetClass: 'crypto' }), 'BTC · coin');
  assert.strictEqual(formatInstrumentLabel({ symbol: 'IBIT', assetClass: 'etf', yahooTicker: 'IBIT' }), 'IBIT · ETF');
  assert.strictEqual(formatInstrumentLabel({ symbol: 'CDNS', assetClass: 'equity' }), 'CDNS · equity');

  const etfBtc = resolveWatchInstrument({ symbol: 'BTC', assetClass: 'etf' });
  assert.strictEqual(etfBtc.ok, false);
  assert.ok(etfBtc.errors.some((e) => /Yahoo ticker/i.test(e)));

  const ibit = resolveWatchInstrument({ symbol: 'BTC', assetClass: 'etf', yahooTicker: 'IBIT' });
  assert.strictEqual(ibit.ok, true);
  assert.strictEqual(ibit.markSymbol, 'IBIT');
  assert.strictEqual(ibit.assetClass, 'etf');

  const imported = classifyImportedInstrument({ listedSymbol: 'FBTC', symbol: 'BTC' });
  assert.strictEqual(imported.symbol, 'FBTC');
  assert.strictEqual(imported.assetClass, 'etf');
  assert.strictEqual(imported.needsInstrumentClass, false);

  const ambiguous = classifyImportedInstrument({ listedSymbol: 'BTC' });
  assert.strictEqual(ambiguous.needsInstrumentClass, true);
  assert.ok(ambiguous.blockedCryptoCollapse);
});

test('imported IBIT/ETHA stay listed tickers even if a map points at BTC/ETH', () => {
  const csv = buildEtradePositionsCsv([
    { Symbol: 'IBIT', Quantity: '2', LastPrice: '32', CostBasis: '56.06', AverageCost: '28.03', MarketValue: '64' },
    { Symbol: 'ETHA', Quantity: '1', LastPrice: '20', CostBasis: '18', AverageCost: '18', MarketValue: '20' }
  ]);
  const preview = previewImport(csv, {
    idPrefix: 'etf_keep',
    symbolMaps: [
      { id: 'm1', fromSymbol: 'IBIT', toSymbol: 'BTC' },
      { id: 'm2', fromSymbol: 'ETHA', toSymbol: 'ETH' }
    ]
  });
  const ibit = preview.events.find((e) => e.listedSymbol === 'IBIT' || e.symbol === 'IBIT');
  const etha = preview.events.find((e) => e.listedSymbol === 'ETHA' || e.symbol === 'ETHA');
  assert.strictEqual(ibit.symbol, 'IBIT');
  assert.strictEqual(ibit.assetClass, 'etf');
  assert.strictEqual(etha.symbol, 'ETHA');
  assert.strictEqual(etha.assetClass, 'etf');
  assert.notStrictEqual(ibit.symbol, 'BTC');
  assert.notStrictEqual(etha.symbol, 'ETH');
});

test('BTC ETF watch uses IBIT mark, not OKX coin spot; coin row can coexist', () => {
  const rows = buildWatchRows({
    tracking: [
      {
        id: 'etf',
        symbol: 'IBIT',
        assetClass: 'etf',
        yahooTicker: 'IBIT',
        markSymbol: 'IBIT',
        startDate: '2026-08-31',
        targetPrice: 40,
        direction: 'long',
        status: 'active'
      },
      {
        id: 'coin',
        symbol: 'BTC',
        assetClass: 'crypto',
        markSymbol: 'BTC',
        startDate: '2026-08-31',
        baselinePrice: 70000,
        targetPrice: 100000,
        direction: 'long',
        status: 'active'
      }
    ],
    realPositions: [{
      symbol: 'IBIT',
      assetClass: 'etf',
      markSymbol: 'IBIT',
      quantity: 1,
      costBasis: 28.03,
      averagePrice: 28.03
    }],
    markPrices: { BTC: 77128.70, IBIT: 32.5 }
  });
  const etf = rows.find((r) => r.id === 'etf');
  const coin = rows.find((r) => r.id === 'coin');
  assert.strictEqual(etf.mark, 32.5);
  assert.strictEqual(etf.entry, 28.03);
  assert.ok(Math.abs(etf.returnPct - ((32.5 - 28.03) / 28.03)) < 1e-9);
  assert.ok(etf.returnPct < 1);
  assert.strictEqual(etf.label, 'IBIT · ETF');
  assert.strictEqual(coin.mark, 77128.70);
  assert.strictEqual(coin.label, 'BTC · coin');
  const targets = collectWatchTargets({
    tracking: [
      { symbol: 'IBIT', assetClass: 'etf', yahooTicker: 'IBIT', markSymbol: 'IBIT' },
      { symbol: 'BTC', assetClass: 'crypto', markSymbol: 'BTC' },
      { symbol: 'BTC', assetClass: 'etf', needsInstrumentClass: true }
    ]
  });
  assert.deepStrictEqual(targets.map((t) => `${t.assetClass}:${t.markSymbol}`).sort(), [
    'crypto:BTC',
    'etf:IBIT'
  ]);
});

test('target persists on add/merge; second add of same equity updates the same row', () => {
  const store = new InvestmentsStore({ storage: new MemoryStorage() });
  const first = startTrackingInput({
    symbol: 'CDNS',
    assetClass: 'equity',
    startDate: '2026-09-11',
    targetPrice: 280,
    requireTarget: true
  });
  assert.strictEqual(first.ok, true);
  store.addOrMergeTracking(first.record);
  const again = startTrackingInput({
    symbol: 'CDNS',
    assetClass: 'equity',
    startDate: '2026-09-11',
    targetPrice: 280,
    requireTarget: true
  });
  store.addOrMergeTracking(again.record);
  assert.strictEqual(store.collection('tracking').length, 1);
  assert.strictEqual(store.collection('tracking')[0].targetPrice, 280);
  assert.strictEqual(store.collection('tracking')[0].assetClass, 'equity');
});

test('Bought leftover is a lot (sell zone); full Sold returns to buy zone', () => {
  const afterBuy = fillLotState([
    { side: 'BUY', date: '2026-09-11', quantity: 2, price: 100 }
  ]);
  assert.strictEqual(afterBuy.hasLot, true);
  assert.strictEqual(afterBuy.quantity, 2);

  const rows = buildWatchRows({
    tracking: [{
      id: 'w',
      symbol: 'CDNS',
      assetClass: 'equity',
      markSymbol: 'CDNS',
      targetPrice: 280,
      direction: 'long',
      status: 'active',
      fills: [{ side: 'BUY', date: '2026-09-11', quantity: 1, price: 270 }]
    }],
    markPrices: { CDNS: 290 }
  });
  assert.strictEqual(rows[0].hasRealLot, true);
  assert.strictEqual(rows[0].inZone, true);
  assert.strictEqual(rows[0].zone, 'sell');

  const sold = buildWatchRows({
    tracking: [{
      id: 'w',
      symbol: 'CDNS',
      assetClass: 'equity',
      markSymbol: 'CDNS',
      targetPrice: 280,
      direction: 'long',
      status: 'active',
      fills: [
        { side: 'BUY', date: '2026-09-11', quantity: 1, price: 270 },
        { side: 'SELL', date: '2026-09-12', quantity: 1, price: 300 }
      ]
    }],
    markPrices: { CDNS: 270 }
  });
  assert.strictEqual(sold[0].hasRealLot, false);
  assert.strictEqual(sold[0].inZone, true);
  assert.strictEqual(sold[0].zone, 'buy');
});

test('every watch row can be removed, including imported lots; no history-kept dead end', () => {
  const store = new InvestmentsStore({ storage: new MemoryStorage() });
  const added = store.addTracking(startTrackingInput({
    symbol: 'CDNS',
    assetClass: 'equity',
    startDate: '2026-09-11',
    targetPrice: 280,
    requireTarget: true
  }).record);
  store.addWatchFill(added.id, { side: 'BUY', quantity: 1, price: 270, date: '2026-09-11' });
  const html = renderWorkspaceHtml({
    storeState: store.getState(),
    pnl: { REAL: { positions: [{ symbol: 'IBIT', assetClass: 'etf', markSymbol: 'IBIT', quantity: 1, costBasis: 28, averagePrice: 28 }] }, TRACKING: { positions: [] } },
    markPrices: { CDNS: 289.37, IBIT: 32 },
    markMeta: { CDNS: { dateUtc: '2026-09-11', asOf: '2026-09-11' } }
  });
  assert.ok(!html.includes('history kept'));
  assert.ok((html.match(/inv-remove-btn/g) || []).length >= 2);
  assert.ok(html.includes('Bought'));
  assert.ok(html.includes('Sold'));
  assert.ok(html.includes('as of 2026-09-11'));
  assert.ok(html.includes('CDNS · equity') || html.includes('IBIT · ETF'));

  const controller = new InvestmentsController({
    store,
    view: { render() {}, renderEmpty() {}, renderPreview() {}, hidePreview() {} },
    confirmImpl: () => true
  });
  assert.strictEqual(controller.removeWatch(added.id), true);
  assert.strictEqual(store.collection('tracking').length, 0);
});

test('Add watch auto-refreshes Yahoo/OKX marks with assetClass; ETF never fetches BTC spot', async () => {
  const urls = [];
  const store = new InvestmentsStore({ storage: new MemoryStorage() });
  const controller = new InvestmentsController({
    store,
    view: { render() {}, renderEmpty() {}, renderPreview() {}, hidePreview() {} },
    fetchImpl: async (url) => {
      urls.push(String(url));
      const text = String(url);
      if (text.includes('/api/refresh')) return { ok: true, json: async () => ({}) };
      const symbol = new URL(text, 'http://local').searchParams.get('symbol');
      const close = symbol === 'CDNS' ? 289.37 : (symbol === 'IBIT' ? 32.5 : null);
      return {
        ok: Boolean(close),
        json: async () => (close
          ? { data: [{ date_utc: '2026-09-11', close, timestamp: 1 }] }
          : { error: 'missing' })
      };
    }
  });

  const form = {
    get(name) {
      return ({
        symbol: 'CDNS',
        assetClass: 'equity',
        startDate: '2026-09-11',
        targetPrice: '280',
        direction: 'long'
      })[name];
    }
  };
  await controller.addWatchFromForm(form).pending;
  assert.strictEqual(store.collection('tracking')[0].targetPrice, 280);
  assert.strictEqual(controller.markPrices.CDNS, 289.37);
  assert.ok(urls.some((u) => u.includes('/api/refresh?') && u.includes('symbol=CDNS') && u.includes('assetClass=equity')));

  urls.length = 0;
  store.addTracking(startTrackingInput({
    symbol: 'BTC',
    assetClass: 'etf',
    yahooTicker: 'IBIT',
    startDate: '2026-09-11',
    targetPrice: 40,
    requireTarget: true
  }).record);
  await controller.refreshMarks();
  assert.strictEqual(controller.markPrices.IBIT, 32.5);
  assert.ok(urls.some((u) => u.includes('symbol=IBIT') && u.includes('assetClass=etf')));
  assert.ok(!urls.some((u) => /symbol=BTC/.test(u)));
});

test('Entry is remaining lot cost basis after Bought/Sold, not frozen start mark', () => {
  const frozenStart = 289.37;
  const bought = buildWatchRows({
    tracking: [{
      id: 'w',
      symbol: 'CDNS',
      assetClass: 'equity',
      markSymbol: 'CDNS',
      startDate: '2026-09-11',
      baselinePrice: frozenStart,
      startMark: frozenStart,
      entryOverride: frozenStart,
      targetPrice: 280,
      direction: 'long',
      status: 'active',
      fills: [{ id: 'f1', side: 'BUY', date: '2026-09-11', quantity: 2, price: 270 }]
    }],
    markPrices: { CDNS: 290 }
  });
  assert.strictEqual(bought[0].entry, 270);
  assert.strictEqual(bought[0].entryKind, 'cost');
  assert.strictEqual(bought[0].costBasis, 540);
  assert.ok(Math.abs(bought[0].returnPct - ((290 - 270) / 270)) < 1e-9);
  assert.ok(Math.abs(bought[0].unrealizedPnl - ((290 - 270) * 2)) < 1e-9);

  const fifoRemaining = fillLotState([
    { id: 'a', side: 'BUY', date: '2026-09-01', quantity: 10, price: 20 },
    { id: 'b', side: 'BUY', date: '2026-09-02', quantity: 10, price: 30 },
    { id: 'c', side: 'SELL', date: '2026-09-03', quantity: 10, price: 40 }
  ], { costMethod: 'fifo' });
  assert.strictEqual(fifoRemaining.quantity, 10);
  assert.strictEqual(fifoRemaining.costBasis, 300);
  assert.strictEqual(fifoRemaining.averagePrice, 30);

  const afterSell = buildWatchRows({
    tracking: [{
      id: 'w',
      symbol: 'CDNS',
      assetClass: 'equity',
      markSymbol: 'CDNS',
      startMark: frozenStart,
      entryOverride: frozenStart,
      targetPrice: 280,
      direction: 'long',
      status: 'active',
      fills: [
        { id: 'a', side: 'BUY', date: '2026-09-01', quantity: 10, price: 20 },
        { id: 'b', side: 'BUY', date: '2026-09-02', quantity: 10, price: 30 },
        { id: 'c', side: 'SELL', date: '2026-09-03', quantity: 10, price: 40 }
      ]
    }],
    markPrices: { CDNS: 33 },
    costMethod: 'fifo'
  });
  assert.strictEqual(afterSell[0].entry, 30);
  assert.strictEqual(afterSell[0].costBasis, 300);
  assert.ok(Math.abs(afterSell[0].returnPct - ((33 - 30) / 30)) < 1e-9);
  assert.ok(Math.abs(afterSell[0].unrealizedPnl - 30) < 1e-9);
});

test('imported E*TRADE lot Entry is remaining cost, not start mark', () => {
  const rows = buildWatchRows({
    tracking: [{
      id: 'imp',
      symbol: 'FAKE1',
      assetClass: 'equity',
      markSymbol: 'FAKE1',
      startDate: '2026-09-11',
      baselinePrice: 99,
      startMark: 99,
      targetPrice: 40,
      direction: 'long',
      status: 'active',
      fills: []
    }],
    events: [{
      id: 'evt_buy',
      activityType: 'buy',
      symbol: 'FAKE1',
      assetClass: 'equity',
      markSymbol: 'FAKE1',
      quantity: 6,
      price: 25,
      costBasis: 150,
      source: 'import'
    }],
    markPrices: { FAKE1: 40 }
  });
  assert.strictEqual(rows[0].entry, 25);
  assert.strictEqual(rows[0].costBasis, 150);
  assert.strictEqual(rows[0].entryKind, 'cost');
  assert.ok(Math.abs(rows[0].returnPct - 0.6) < 1e-9);
  assert.ok(Math.abs(rows[0].unrealizedPnl - 90) < 1e-9);
});

test('parent remaining basis and each fill price are editable (imported too)', () => {
  const store = new InvestmentsStore({ storage: new MemoryStorage() });
  const added = store.addTracking(startTrackingInput({
    symbol: 'CDNS',
    assetClass: 'equity',
    startDate: '2026-09-11',
    baselinePrice: 289.37,
    targetPrice: 280,
    requireTarget: true
  }).record);
  store.addWatchFill(added.id, { id: 'buy1', side: 'BUY', quantity: 2, price: 270, date: '2026-09-11' });
  store.commitImport({
    canCommit: true,
    rawRows: [{ lineNumber: 1, raw: {}, record: {} }],
    events: [{
      id: 'imp_ibit',
      fingerprint: 'imp_ibit_fp',
      activityType: 'buy',
      symbol: 'IBIT',
      assetClass: 'etf',
      markSymbol: 'IBIT',
      yahooTicker: 'IBIT',
      quantity: 1,
      price: 28,
      costBasis: 28
    }]
  }, { sourceFileName: 'synthetic.csv' });

  const controller = new InvestmentsController({
    store,
    view: { render() {}, renderEmpty() {}, renderPreview() {}, hidePreview() {} },
    promptImpl: (message, fallback) => {
      if (String(message).includes('Fill')) return '275';
      if (String(message).includes('Remaining')) return '280';
      return fallback;
    },
    alertImpl: () => {}
  });

  assert.strictEqual(controller.editFill('buy1'), true);
  assert.strictEqual(store.collection('tracking').find((r) => r.id === added.id).fills[0].price, 275);
  let row = buildWatchRows({
    tracking: store.collection('tracking'),
    events: store.collection('events'),
    markPrices: { CDNS: 290 }
  }).find((r) => r.symbol === 'CDNS');
  assert.strictEqual(row.entry, 275);

  assert.strictEqual(controller.editEntry(added.id), true);
  row = buildWatchRows({
    tracking: store.collection('tracking'),
    events: store.collection('events'),
    markPrices: { CDNS: 290 }
  }).find((r) => r.symbol === 'CDNS');
  assert.ok(Math.abs(row.entry - 280) < 1e-9);
  assert.strictEqual(store.collection('tracking').find((r) => r.id === added.id).entryOverride, null);

  assert.strictEqual(controller.editFill('imp_ibit'), true);
  const imported = store.collection('events').find((e) => e.id === 'imp_ibit');
  assert.strictEqual(imported.price, 275);
  assert.strictEqual(imported.costBasis, 275);

  const html = renderWorkspaceHtml({
    storeState: store.getState(),
    pnl: computeLotsAndPnl(store.allFillEvents(), { costMethod: 'fifo', markPrices: { CDNS: 290, IBIT: 32 } }),
    markPrices: { CDNS: 290, IBIT: 32 }
  });
  assert.ok(html.includes('inv-edit-fill-btn'));
  assert.ok(html.includes('data-fill-id="buy1"'));
  assert.ok(html.includes('data-fill-id="imp_ibit"'));
  assert.ok(html.includes('remaining'));
});

test('scaleBuyFillPrices retargets remaining average without locking later fills', () => {
  const fills = [
    { id: 'a', side: 'BUY', date: '2026-09-01', quantity: 2, price: 100 },
    { id: 'b', side: 'BUY', date: '2026-09-02', quantity: 2, price: 200 }
  ];
  const scaled = scaleBuyFillPrices(fills, 160, { costMethod: 'fifo' });
  assert.strictEqual(scaled.ok, true);
  const lot = fillLotState(scaled.fills, { costMethod: 'fifo' });
  assert.ok(Math.abs(lot.averagePrice - 160) < 1e-9);
  const locked = resolveWatchEntry({
    record: { entryOverride: 50, startMark: 50 },
    lot
  });
  assert.strictEqual(locked.entryKind, 'cost');
  assert.ok(Math.abs(locked.entry - 160) < 1e-9);
});

test('fetchSymbolMark skips unresolved BTC ETF (no silent $77k coin)', async () => {
  const urls = [];
  const result = await fetchSymbolMark('BTC', {
    assetClass: 'etf',
    needsInstrumentClass: true,
    fetchImpl: async (url) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ data: [{ close: 77128 }] }) };
    }
  });
  assert.strictEqual(result.mark, null);
  assert.ok(result.error);
  assert.deepStrictEqual(urls, []);
});

