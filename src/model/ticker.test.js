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
  assert.strictEqual(normalizeTicker('CDNS').assetClass, 'unknown');
  assert.strictEqual(normalizeTicker('CDNS').equityHint, true);
  assert.strictEqual(normalizeTicker('HYPE').assetClass, 'unknown');
  assert.strictEqual(normalizeTicker('HYPE').equityHint, true);
  assert.strictEqual(normalizeTicker('ZZZ9').assetClass, 'unknown');
});

test('HYPE is not defaulted to Yahoo equity and still has OKX instIds', () => {
  const hype = normalizeTicker('HYPE');
  assert.strictEqual(hype.assetClass, 'unknown');
  assert.strictEqual(hype.instIdSpot, 'HYPE-USDT');
  assert.strictEqual(hype.instIdSwap, 'HYPE-USDT-SWAP');
  assert.deepStrictEqual(instIdCandidates(hype).map((row) => row.instId), ['HYPE-USDT-SWAP', 'HYPE-USDT']);
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

test('known stocks have no OKX instId candidates; unknown tickers do', () => {
  assert.deepStrictEqual(instIdCandidates(normalizeTicker('AAPL')), []);
  assert.strictEqual(classifyAssetClass('AAPL'), 'stock');
  assert.strictEqual(classifyAssetClass('CDNS'), 'unknown');
  assert.deepStrictEqual(instIdCandidates(normalizeTicker('CDNS')).map((row) => row.instId), [
    'CDNS-USDT-SWAP',
    'CDNS-USDT'
  ]);
  assert.strictEqual(classifyAssetClass('HYPE'), 'unknown');
});
