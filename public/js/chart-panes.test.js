import { test } from 'node:test';
import assert from 'node:assert';
import {
  PRICE_PANE_INDEX,
  PRICE_SCALE_ID,
  OVERLAY_PANE_SCALES,
  overlayPaneCount,
  paneStretchFactor
} from './chart-panes.js';

test('volume / ETF / OI use overlay scales, never the price right scale', () => {
  assert.strictEqual(PRICE_PANE_INDEX, 0);
  assert.strictEqual(PRICE_SCALE_ID, 'right');
  assert.notStrictEqual(OVERLAY_PANE_SCALES.volume, PRICE_SCALE_ID);
  assert.notStrictEqual(OVERLAY_PANE_SCALES.etf, PRICE_SCALE_ID);
  assert.notStrictEqual(OVERLAY_PANE_SCALES.oi, PRICE_SCALE_ID);
});

test('each enabled overlay adds its own pane under the price pane', () => {
  assert.strictEqual(overlayPaneCount({ showVolume: true, showEtf: false, showOi: false }), 1);
  assert.strictEqual(overlayPaneCount({ showVolume: true, showEtf: true, showOi: true }), 3);
  assert.strictEqual(paneStretchFactor(0), 3);
  assert.strictEqual(paneStretchFactor(1), 1);
});
