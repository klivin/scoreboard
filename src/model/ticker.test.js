import { test } from 'node:test';
import assert from 'node:assert';
import {
  classifyAssetClass,
  extractTickerQueries,
  instIdCandidates,
  normalizeTicker,
  resolveOkxInstId
} from './ticker.js';

test('normalizeTicker uppercases and strips $ / pair suffixes', () => {
  assert.strictEqual(normalizeTicker('eth').symbol, 'ETH');
  assert.strictEqual(normalizeTicker(' $sol ').symbol, 'SOL');
  assert.strictEqual(normalizeTicker('BTCUSDT').symbol, 'BTC');
  assert.strictEqual(normalizeTicker('ETH-USDT').symbol, 'ETH');
  assert.strictEqual(normalizeTicker('ETH-USDT-SWAP').symbol, 'ETH');
  assert.strictEqual(normalizeTicker('btc/usdt').symbol, 'BTC');
  assert.strictEqual(normalizeTicker('AAPL.US').symbol, 'AAPL');
});

test('normalizeTicker classifies known crypto vs stock', () => {
  assert.strictEqual(normalizeTicker('ETH').assetClass, 'crypto');
  assert.strictEqual(normalizeTicker('SOL').assetClass, 'crypto');
  assert.strictEqual(normalizeTicker('AAPL').assetClass, 'stock');
  assert.strictEqual(normalizeTicker('MSFT').assetClass, 'stock');
  assert.strictEqual(normalizeTicker('CDNS').assetClass, 'stock');
  assert.strictEqual(normalizeTicker('ZZZ9').assetClass, 'unknown');
});

test('normalizeTicker rejects empty / junk', () => {
  assert.strictEqual(normalizeTicker('').error, 'empty');
  assert.strictEqual(normalizeTicker('   ').error, 'empty');
  assert.strictEqual(normalizeTicker('---').error, 'invalid');
  assert.strictEqual(normalizeTicker('$').symbol, '');
});

test('OKX instId candidates prefer swap then spot', () => {
  const eth = normalizeTicker('ETH');
  const ids = instIdCandidates(eth);
  assert.deepStrictEqual(ids.map((row) => row.instId), ['ETH-USDT-SWAP', 'ETH-USDT']);
  assert.strictEqual(resolveOkxInstId('SOL'), 'SOL-USDT-SWAP');
  assert.strictEqual(resolveOkxInstId('SOL', { market: 'spot' }), 'SOL-USDT');
  assert.strictEqual(resolveOkxInstId('BTC', { instId: 'BTC-USDT-SWAP' }), 'BTC-USDT-SWAP');
});

test('spot-hinted input tries spot first', () => {
  const ids = instIdCandidates(normalizeTicker('SOL-USDT'));
  assert.strictEqual(ids[0].instId, 'SOL-USDT');
  assert.strictEqual(ids[1].instId, 'SOL-USDT-SWAP');
});

test('extractTickerQueries keeps CDNS and drops prose', () => {
  assert.deepStrictEqual(extractTickerQueries('good entry for CDNS'), ['CDNS']);
  assert.deepStrictEqual(extractTickerQueries('thinking of buying more'), []);
});

test('stocks have no OKX instId candidates', () => {
  assert.deepStrictEqual(instIdCandidates(normalizeTicker('AAPL')), []);
  assert.strictEqual(classifyAssetClass('AAPL'), 'stock');
  assert.deepStrictEqual(instIdCandidates(normalizeTicker('CDNS')), []);
  assert.strictEqual(classifyAssetClass('CDNS'), 'stock');
});
