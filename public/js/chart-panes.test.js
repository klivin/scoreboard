import { test } from 'node:test';
import assert from 'node:assert';
import {
  PRICE_PANE_INDEX,
  FIRST_OVERLAY_PANE_INDEX,
  overlayPaneCount,
  paneStretchFactor
} from './chart-panes.js';

test('volume / ETF / OI are never the price pane', () => {
  assert.strictEqual(PRICE_PANE_INDEX, 0);
  assert.strictEqual(FIRST_OVERLAY_PANE_INDEX, 1);
  assert.ok(FIRST_OVERLAY_PANE_INDEX > PRICE_PANE_INDEX);
});

test('each enabled overlay adds its own pane under the price pane', () => {
  assert.strictEqual(overlayPaneCount({ showVolume: true, showEtf: false, showOi: false }), 1);
  assert.strictEqual(overlayPaneCount({ showVolume: true, showEtf: true, showOi: true }), 3);
  assert.strictEqual(paneStretchFactor(0), 3);
  assert.strictEqual(paneStretchFactor(1), 1);
});
