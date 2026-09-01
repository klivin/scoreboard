import { test } from 'node:test';
import assert from 'node:assert';
import { optionKeyFromToggleId, TOGGLE_OPTION_MAP } from './toggles.js';

test('toggle ids map to ChartView option keys (not showma20)', () => {
  assert.strictEqual(optionKeyFromToggleId('toggle-ma20'), 'showMA20');
  assert.strictEqual(optionKeyFromToggleId('toggle-ma50'), 'showMA50');
  assert.strictEqual(optionKeyFromToggleId('toggle-ma100'), 'showMA100');
  assert.strictEqual(optionKeyFromToggleId('toggle-ma200'), 'showMA200');
  assert.strictEqual(optionKeyFromToggleId('toggle-ichimoku'), 'showIchimoku');
  assert.strictEqual(optionKeyFromToggleId('toggle-volume'), 'showVolume');
  assert.strictEqual(optionKeyFromToggleId('toggle-etf'), 'showEtf');
  assert.strictEqual(optionKeyFromToggleId('toggle-oi'), 'showOi');
  assert.strictEqual(optionKeyFromToggleId('toggle-predicted'), 'showPredicted');
  assert.strictEqual(optionKeyFromToggleId('toggle-actual'), 'showActual');
  assert.strictEqual(optionKeyFromToggleId('toggle-naive'), 'showNaive');
});

test('broken hyphen-collapse mapping is not used', () => {
  const broken = (id) => id.replace('toggle-', 'show').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  assert.strictEqual(broken('toggle-ma20'), 'showma20');
  assert.notStrictEqual(broken('toggle-ma20'), TOGGLE_OPTION_MAP['toggle-ma20']);
});
