import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildScannerRow,
  emptyScannerRow,
  formatScannerCell,
  finiteOrNull,
  modelHorizonFromForecast,
  consensusFromEvent,
  detectDirectionFlip,
  collectFlipHistory,
  mergeFlipHistories,
  latestFlip,
  isNewFlip,
  appendFlipIfChanged,
  filterScannerRows,
  sortScannerRows,
  freezeTrackingBaseline,
  stopTrackingRecord,
  evaluateTrackingFromBaseline,
  applyHoldingsToRows,
  snapshotHoldings,
  pickCorrelation,
  backtestStatusFromResult,
  NEW_FLIP_MS
} from './scanner.js';
import { InvestmentsStore, MemoryStorage } from '../../public/js/investments/store.js';
import { startTrackingInput } from '../../public/js/investments/tracking.js';

function bar(ts, close, extras = {}) {
  return { timestamp: ts, close, volume: extras.volume, open: close, high: close, low: close };
}

const DAY = 86400000;

test('scanner row construction keeps missing fields missing (never 0)', () => {
  const empty = emptyScannerRow('XYZ');
  assert.strictEqual(empty.symbol, 'XYZ');
  assert.strictEqual(empty.currentPrice, null);
  assert.strictEqual(empty.liquidity.volume, null);
  assert.strictEqual(empty.liquidity.freshnessMs, null);
  assert.strictEqual(empty.horizons[1].direction, null);
  assert.strictEqual(empty.horizons[1].confidence, null);
  assert.strictEqual(empty.horizons[7].prediction, null);
  assert.strictEqual(empty.consensus.direction, null);
  assert.strictEqual(empty.consensus.scorePercent, null);
  assert.strictEqual(empty.consensus.missing, true);
  assert.strictEqual(empty.backtest.status, 'missing');
  assert.strictEqual(empty.backtest.beatsBuyHold, null);
  assert.strictEqual(empty.context.etfNetFlowUsdMillions, null);
  assert.strictEqual(empty.context.oiContracts, null);
  assert.strictEqual(empty.context.correlationVsBtc, null);
  assert.strictEqual(formatScannerCell(empty.currentPrice), 'missing');
  assert.strictEqual(formatScannerCell(empty.horizons[7].confidence), 'missing');
  assert.notStrictEqual(formatScannerCell(empty.currentPrice), '0');

  const row = buildScannerRow({
    symbol: 'AAA',
    series: [{ timestamp: 1, close: null, volume: null }],
    horizons: { 7: null },
    context: { etfNetFlowUsdMillions: null, oi: null, corr: null }
  });
  assert.strictEqual(row.currentPrice, null);
  assert.strictEqual(row.liquidity.volume, null);
  assert.strictEqual(row.horizons[7].direction, null);
  assert.strictEqual(row.horizons[7].confidence, null);
  assert.strictEqual(row.context.etfNetFlowUsdMillions, null);
  assert.strictEqual(row.context.oiContracts, null);
  assert.strictEqual(finiteOrNull(undefined), null);
  assert.strictEqual(finiteOrNull(''), null);
  assert.strictEqual(finiteOrNull('nope'), null);
  assert.strictEqual(finiteOrNull(0), 0);
});

test('scanner row uses real last close and does not invent consensus or ranking', () => {
  const ts = Date.UTC(2026, 0, 10);
  const row = buildScannerRow({
    symbol: 'btc',
    series: [bar(ts, 100, { volume: 12 })],
    horizons: {
      7: { prediction: 110, naive: 100, upper: 120, lower: 100 }
    },
    now: ts + 3600000
  });
  assert.strictEqual(row.currentPrice, 100);
  assert.strictEqual(row.assetClass, 'crypto');
  assert.strictEqual(row.horizons[7].direction, 'BULLISH');
  assert.ok(row.horizons[7].confidence != null);
  assert.strictEqual(row.consensus.missing, true);
  assert.strictEqual(row.consensus.direction, null);
  assert.strictEqual(row.consensus.scorePercent, null);
  assert.ok(!('rank' in row));
  assert.ok(!('sentiment' in row));
});

test('model horizon confidence is missing when bands are missing', () => {
  const noBands = modelHorizonFromForecast({ prediction: 105, naive: 100 }, 100);
  assert.strictEqual(noBands.direction, 'BULLISH');
  assert.strictEqual(noBands.confidence, null);
  const noPrice = modelHorizonFromForecast({ prediction: 105, upper: 110, lower: 90 }, null);
  assert.strictEqual(noPrice.direction, null);
  assert.strictEqual(noPrice.confidence, null);
  assert.strictEqual(noPrice.changePercent, null);
});

test('empty signal votes stay missing, not a fabricated 50/NEUTRAL', () => {
  const empty = consensusFromEvent({ consensus: { score: 0, scorePercent: 50, direction: 'NEUTRAL', confidence: 0, breakdown: [] } });
  assert.strictEqual(empty.missing, true);
  assert.strictEqual(empty.direction, null);
  assert.strictEqual(empty.scorePercent, null);

  const voted = consensusFromEvent({
    consensus: {
      direction: 'BUY',
      scorePercent: 72,
      confidence: 61,
      breakdown: [{ id: 'ema-crossover', signal: 'BUY' }]
    }
  });
  assert.strictEqual(voted.missing, false);
  assert.strictEqual(voted.direction, 'BUY');
  assert.strictEqual(voted.scorePercent, 72);
});

test('flip detection records timestamp and prior/new state', () => {
  assert.strictEqual(detectDirectionFlip('BULLISH', 'BULLISH', 1), null);
  assert.strictEqual(detectDirectionFlip('BUY', 'LONG', 1), null);
  assert.strictEqual(detectDirectionFlip(null, 'BULLISH', 1), null);

  const flip = detectDirectionFlip('BULLISH', 'BEARISH', 1700000000000, 'consensus');
  assert.ok(flip);
  assert.strictEqual(flip.prior, 'BULLISH');
  assert.strictEqual(flip.next, 'BEARISH');
  assert.strictEqual(flip.at, 1700000000000);
  assert.strictEqual(flip.family, 'bearish');
  assert.strictEqual(flip.source, 'consensus');

  const history = collectFlipHistory([
    { at: 1, direction: 'BUY' },
    { at: 2, direction: 'BUY' },
    { at: 3, direction: 'SELL' },
    { at: 4, direction: 'NEUTRAL' },
    { at: 5, direction: 'BUY' }
  ], 'consensus');
  assert.strictEqual(history.length, 3);
  assert.strictEqual(history[0].prior, 'BUY');
  assert.strictEqual(history[0].next, 'SELL');
  assert.strictEqual(history[1].next, 'NEUTRAL');
  assert.strictEqual(history[2].next, 'BUY');

  const merged = mergeFlipHistories(history, [
    { at: 3, source: 'consensus', prior: 'BUY', next: 'SELL' }
  ]);
  assert.strictEqual(merged.length, 3);
  assert.strictEqual(latestFlip(merged).next, 'BUY');

  const appended = appendFlipIfChanged(history, 'BUY', 'SELL', 99, 'direction');
  assert.strictEqual(appended[appended.length - 1].at, 99);
});

test('new flip window is 7 days; older flips stay in history but are not new', () => {
  const now = Date.UTC(2026, 5, 15);
  const fresh = { at: now - 2 * DAY, next: 'BULLISH' };
  const stale = { at: now - NEW_FLIP_MS - DAY, next: 'BEARISH' };
  assert.strictEqual(isNewFlip(fresh, now), true);
  assert.strictEqual(isNewFlip(stale, now), false);
  assert.strictEqual(isNewFlip({ at: null, next: 'BULLISH' }, now), false);
});

test('start/stop tracking freezes baseline and preserves history', () => {
  const startedAt = Date.UTC(2026, 0, 1);
  const started = freezeTrackingBaseline({
    symbol: 'eth',
    baselinePrice: 2000,
    startedAt
  });
  assert.strictEqual(started.ok, true);
  assert.strictEqual(started.record.baselinePrice, 2000);
  assert.strictEqual(started.record.startedAt, startedAt);
  assert.strictEqual(started.record.startDate, '2026-01-01');
  assert.strictEqual(started.record.status, 'active');
  assert.strictEqual(started.record.badge, 'TRACKING');
  assert.strictEqual(started.record.history.length, 1);

  const refused = freezeTrackingBaseline({ symbol: 'ETH', baselinePrice: null, startedAt });
  assert.strictEqual(refused.ok, false);
  assert.ok(refused.errors.some((e) => /missing/i.test(e)));

  const zero = freezeTrackingBaseline({ symbol: 'ETH', baselinePrice: 0, startedAt });
  assert.strictEqual(zero.ok, false);

  const stopped = stopTrackingRecord(started.record, {
    stoppedAt: Date.UTC(2026, 5, 1),
    stopPrice: 3000
  });
  assert.strictEqual(stopped.status, 'stopped');
  assert.strictEqual(stopped.baselinePrice, 2000);
  assert.strictEqual(stopped.startedAt, startedAt);
  assert.strictEqual(stopped.stopPrice, 3000);
  assert.strictEqual(stopped.history.length, 2);
  assert.strictEqual(stopped.history[0].action, 'start');
  assert.strictEqual(stopped.history[1].action, 'stop');
  assert.strictEqual(started.record.status, 'active');
});

test('start/stop via Investments store freezes baseline and keeps history', () => {
  const store = new InvestmentsStore({ storage: new MemoryStorage() });
  const checked = startTrackingInput({ symbol: 'btc', startDate: '2026-02-01', baselinePrice: 70000 });
  assert.strictEqual(checked.ok, true);
  const record = store.addTracking(checked.record);
  assert.strictEqual(record.baselinePrice, 70000);
  assert.strictEqual(record.startDate, '2026-02-01');
  assert.strictEqual(record.status, 'active');
  const stopped = store.stopTracking(record.id, { stopDate: '2026-03-01', stopPrice: 71000 });
  assert.strictEqual(stopped.status, 'stopped');
  assert.strictEqual(stopped.baselinePrice, 70000);
  assert.strictEqual(stopped.history.length, 2);
  assert.strictEqual(store.collection('tracking').length, 1);
});

test('evaluation from frozen baseline compares model vs naive without lookahead', () => {
  const start = Date.UTC(2026, 0, 10);
  const series = [];
  for (let i = 0; i < 40; i += 1) {
    series.push(bar(start + i * DAY, 100 + i));
  }
  const baselineTs = start + 20 * DAY;
  const baselinePrice = 120;
  const frozen = freezeTrackingBaseline({
    symbol: 'AAA',
    baselinePrice,
    startedAt: baselineTs
  }).record;

  const evaln = evaluateTrackingFromBaseline(frozen, series, { now: start + 39 * DAY });
  assert.strictEqual(evaln.badge, 'TRACKING');
  assert.strictEqual(evaln.baselinePrice, 120);
  assert.strictEqual(evaln.baselineTimestamp, baselineTs);
  assert.ok(evaln.actualReturnPct != null);
  assert.ok(evaln.horizons[1]);
  assert.ok(evaln.horizons[7]);
  assert.ok(evaln.horizons[30]);

  const h7 = evaln.horizons[7];
  assert.ok(h7.actualPrice != null);
  assert.ok(h7.modelPrediction != null || h7.modelPrediction === null);
  if (h7.modelPrediction == null) {
    assert.strictEqual(h7.modelError, null);
    assert.strictEqual(formatScannerCell(h7.modelError), 'missing');
  }
  if (h7.naivePrediction != null && h7.actualPrice != null) {
    assert.strictEqual(h7.naiveError, h7.actualPrice - h7.naivePrediction);
  }

  const missingEval = evaluateTrackingFromBaseline(frozen, [], {});
  assert.strictEqual(missingEval.horizons[7].actualPrice, null);
  assert.strictEqual(missingEval.horizons[7].modelError, null);
  assert.strictEqual(formatScannerCell(missingEval.horizons[7].modelError), 'missing');
});

test('filters and sorts: flip, confidence, horizon, asset class, REAL, TRACKING', () => {
  const now = Date.UTC(2026, 6, 1);
  const rows = [
    buildScannerRow({
      symbol: 'BTC',
      assetClass: 'crypto',
      series: [bar(now - DAY, 100, { volume: 10 })],
      horizons: { 7: { prediction: 110, naive: 100, upper: 112, lower: 108 } },
      flipHistory: [{ at: now - 2 * DAY, source: 'consensus', prior: 'BEARISH', next: 'BULLISH' }],
      holdings: { real: true, tracking: false, badge: 'REAL' },
      now
    }),
    buildScannerRow({
      symbol: 'ETH',
      assetClass: 'crypto',
      series: [bar(now - DAY, 50, { volume: 4 })],
      horizons: { 7: { prediction: 40, naive: 50, upper: 80, lower: 20 } },
      flipHistory: [{ at: now - 2 * DAY, source: 'direction', prior: 'BULLISH', next: 'BEARISH' }],
      holdings: { real: false, tracking: true, trackingId: 't1', trackingStatus: 'active', badge: 'TRACKING' },
      now
    }),
    buildScannerRow({
      symbol: 'ACME',
      assetClass: 'stock',
      series: [],
      holdings: { real: false, tracking: false },
      now
    })
  ];

  const bullish = filterScannerRows(rows, { flip: 'new-bullish', now });
  assert.deepStrictEqual(bullish.map((r) => r.symbol), ['BTC']);

  const bearish = filterScannerRows(rows, { flip: 'new-bearish', now });
  assert.deepStrictEqual(bearish.map((r) => r.symbol), ['ETH']);

  const staleNow = now + NEW_FLIP_MS + DAY;
  assert.deepStrictEqual(filterScannerRows(rows, { flip: 'new-bullish', now: staleNow }).map((r) => r.symbol), []);

  const crypto = filterScannerRows(rows, { assetClass: 'crypto' });
  assert.deepStrictEqual(crypto.map((r) => r.symbol), ['BTC', 'ETH']);

  const stocks = filterScannerRows(rows, { assetClass: 'stock' });
  assert.deepStrictEqual(stocks.map((r) => r.symbol), ['ACME']);

  const realOnly = filterScannerRows(rows, { realHoldings: true });
  assert.deepStrictEqual(realOnly.map((r) => r.symbol), ['BTC']);

  const trackingOnly = filterScannerRows(rows, { tracking: true });
  assert.deepStrictEqual(trackingOnly.map((r) => r.symbol), ['ETH']);

  const confident = filterScannerRows(rows, { minConfidence: 50, horizon: 7 });
  assert.ok(confident.every((r) => r.horizons[7].confidence != null && r.horizons[7].confidence >= 50));
  assert.ok(!confident.some((r) => r.symbol === 'ACME'));

  const byConf = sortScannerRows(rows, { key: 'confidence', horizon: 7 }, 'desc');
  assert.strictEqual(byConf[0].symbol, 'BTC');
  assert.strictEqual(byConf[byConf.length - 1].symbol, 'ACME');

  const byFlip = sortScannerRows(rows, 'flip', 'desc');
  assert.ok(byFlip[0].flip.lastFlipAt >= (byFlip[1].flip.lastFlipAt || 0));

  const byClass = sortScannerRows(rows, 'assetClass', 'asc');
  assert.ok(byClass[0].assetClass <= byClass[1].assetClass);

  const byReal = sortScannerRows(rows, 'real', 'desc');
  assert.strictEqual(byReal[0].symbol, 'BTC');

  const byTrack = sortScannerRows(rows, 'tracking', 'desc');
  assert.strictEqual(byTrack[0].symbol, 'ETH');
});

test('holdings snapshot applies REAL and TRACKING badges without mixing', () => {
  const state = {
    collections: {
      events: [{ symbol: 'BTC', badge: 'REAL' }],
      tracking: [{ id: 't1', symbol: 'ETH', status: 'active' }]
    }
  };
  const snap = snapshotHoldings(state);
  assert.strictEqual(snap.realSymbols.has('BTC'), true);
  assert.strictEqual(snap.realSymbols.has('ETH'), false);
  assert.strictEqual(snap.trackingBySymbol.get('ETH').id, 't1');

  const rows = applyHoldingsToRows([
    emptyScannerRow('BTC'),
    emptyScannerRow('ETH'),
    emptyScannerRow('SOL')
  ], state);
  assert.strictEqual(rows[0].holdings.real, true);
  assert.strictEqual(rows[0].holdings.badge, 'REAL');
  assert.strictEqual(rows[1].holdings.tracking, true);
  assert.strictEqual(rows[1].holdings.badge, 'TRACKING');
  assert.strictEqual(rows[2].holdings.real, false);
  assert.strictEqual(rows[2].holdings.tracking, false);
  assert.strictEqual(rows[2].holdings.badge, null);
});

test('correlation and backtest stay missing when sources are absent', () => {
  assert.deepStrictEqual(pickCorrelation([], 'BTC'), { value: null, category: null });
  const found = pickCorrelation([
    { symbol: 'ETH', corr: 0.42, category: 'L1' }
  ], 'ETH');
  assert.strictEqual(found.value, 0.42);
  assert.strictEqual(found.category, 'L1');

  const missingBt = backtestStatusFromResult(null);
  assert.strictEqual(missingBt.status, 'missing');
  assert.strictEqual(missingBt.beatsBuyHold, null);
  assert.strictEqual(missingBt.note, 'missing');

  const available = backtestStatusFromResult({
    dataSource: 'fixture',
    baselines: { buyAndHold: { totalReturn: 0.2 }, naive: { totalReturn: 0 } },
    strategies: { consensus: { totalReturn: 0.03 } }
  });
  assert.strictEqual(available.status, 'available');
  assert.strictEqual(available.beatsBuyHold, false);
  assert.strictEqual(available.beatsNaive, true);
});
