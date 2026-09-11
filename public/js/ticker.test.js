import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RECENT_TICKERS,
  normalizeTickerInput,
  readRecentTickers,
  rememberTicker,
  renderRecentTickerChips
} from './ticker.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    dump: () => data
  };
}

test('UI ticker normalize matches ETH / SOL / AAPL entry', () => {
  assert.strictEqual(normalizeTickerInput('eth').symbol, 'ETH');
  assert.strictEqual(normalizeTickerInput('SOL').assetClass, 'crypto');
  assert.strictEqual(normalizeTickerInput('AAPL').assetClass, 'stock');
  assert.strictEqual(normalizeTickerInput('CDNS').assetClass, 'stock');
  assert.strictEqual(normalizeTickerInput('ETH-USDT-SWAP').symbol, 'ETH');
});

test('recent ticker list remembers newest first and stays short', () => {
  const storage = memoryStorage();
  rememberTicker('eth', storage);
  rememberTicker('SOL', storage);
  rememberTicker('ETH', storage);
  const recent = readRecentTickers(storage);
  assert.deepStrictEqual(recent.slice(0, 2), ['ETH', 'SOL']);
  assert.ok(recent.length <= 8);
});

test('empty storage falls back to default favorites', () => {
  assert.deepStrictEqual(readRecentTickers(memoryStorage()), DEFAULT_RECENT_TICKERS);
});

test('renderRecentTickerChips wires click handler', () => {
  const clicked = [];
  const container = {
    innerHTML: '',
    querySelectorAll(selector) {
      assert.strictEqual(selector, '[data-ticker]');
      const html = this.innerHTML;
      const symbols = [...html.matchAll(/data-ticker="([^"]+)"/g)].map((m) => m[1]);
      return symbols.map((symbol) => ({
        dataset: { ticker: symbol },
        addEventListener(event, handler) {
          if (event === 'click') handler();
        }
      }));
    }
  };
  renderRecentTickerChips(container, {
    symbols: ['BTC', 'ETH'],
    active: 'ETH',
    onSelect: (symbol) => clicked.push(symbol)
  });
  assert.match(container.innerHTML, /data-ticker="ETH"/);
  assert.match(container.innerHTML, /ticker-chip active/);
  assert.deepStrictEqual(clicked, ['BTC', 'ETH']);
});

test('Overview HTML uses ticker text field instead of a symbol combo box', () => {
  const html = readFileSync(join(root, 'public/index.html'), 'utf8');
  assert.match(html, /id="ticker-input"/);
  assert.match(html, /id="ticker-add-btn"/);
  assert.match(html, /id="ticker-recent"/);
  assert.doesNotMatch(html, /<select id="symbol-select">/);
  assert.match(html, /id="symbol-select"/);
});

test('controller wires ticker Add\/Load and refresh-by-symbol', () => {
  const src = readFileSync(join(root, 'public/js/controller.js'), 'utf8');
  assert.match(src, /ticker-add-btn/);
  assert.match(src, /addAndLoadTicker/);
  assert.match(src, /\/api\/refresh\?/);
  assert.match(src, /params\.set\('symbol'/);
  assert.match(src, /setSelectedSymbol/);
});
