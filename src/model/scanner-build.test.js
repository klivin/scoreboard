import { test } from 'node:test';
import assert from 'node:assert';
import { buildScannerRows, collectScannerSymbols } from './scanner-build.js';
import { formatScannerCell } from './scanner.js';

function stubModel(options = {}) {
  const seriesBySymbol = options.seriesBySymbol || {};
  return {
    data: {
      missing: options.missing || [],
      correlations: { missing: !options.corrRows, data: options.corrRows || [] }
    },
    ensureLoaded() {},
    getAvailableSymbols() { return options.symbols || []; },
    getUniverse() { return { coins: options.coins || [], note: options.universeNote || null }; },
    getIndicators(symbol) {
      if (seriesBySymbol[symbol]) return seriesBySymbol[symbol];
      throw new Error(`No data available for ${symbol} 1d`);
    },
    getSignals() { return {}; },
    getEtfRows() { return []; },
    getOiRows() { return []; }
  };
}

test('buildScannerRows lists supported symbols and keeps missing cells missing', () => {
  const payload = buildScannerRows({
    model: stubModel(),
    now: Date.UTC(2026, 0, 1),
    loadBacktest: () => null
  });
  assert.ok(payload.disclaimer.toLowerCase().includes('research'));
  assert.ok(payload.rows.length >= 12);
  const btc = payload.rows.find((r) => r.symbol === 'BTC');
  assert.ok(btc);
  assert.strictEqual(btc.currentPrice, null);
  assert.strictEqual(btc.horizons[7].direction, null);
  assert.strictEqual(btc.consensus.missing, true);
  assert.strictEqual(btc.backtest.status, 'missing');
  assert.strictEqual(formatScannerCell(btc.currentPrice), 'missing');
  assert.notStrictEqual(btc.currentPrice, 0);
  assert.ok(!('rank' in btc));
});

test('collectScannerSymbols unions pack, available, coins, and extras without inventing ranks', () => {
  const symbols = collectScannerSymbols(stubModel({ symbols: ['BTC'] }), {
    coins: [{ symbol: 'ada', name: 'Cardano' }],
    extraSymbols: ['AAPL']
  });
  assert.ok(symbols.includes('BTC'));
  assert.ok(symbols.includes('ADA'));
  assert.ok(symbols.includes('AAPL'));
  assert.ok(symbols.includes('ETH'));
});

test('buildScannerRows attaches real last close when series exists', () => {
  const ts = Date.UTC(2026, 0, 20);
  const series = [];
  for (let i = 0; i < 20; i += 1) {
    series.push({
      timestamp: ts - (19 - i) * 86400000,
      close: 100 + i,
      volume: 5 + i,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i
    });
  }
  const payload = buildScannerRows({
    model: stubModel({ seriesBySymbol: { BTC: series } }),
    now: ts + 3600000,
    loadBacktest: () => null,
    extraSymbols: []
  });
  const btc = payload.rows.find((r) => r.symbol === 'BTC');
  assert.strictEqual(btc.currentPrice, 119);
  assert.ok(btc.horizons[7].direction === 'BULLISH' || btc.horizons[7].direction === 'BEARISH' || btc.horizons[7].direction === 'NEUTRAL');
  const eth = payload.rows.find((r) => r.symbol === 'ETH');
  assert.strictEqual(eth.currentPrice, null);
});
