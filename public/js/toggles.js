export const TOGGLE_OPTION_MAP = {
  'toggle-ma20': 'showMA20',
  'toggle-ma50': 'showMA50',
  'toggle-ma100': 'showMA100',
  'toggle-ma200': 'showMA200',
  'toggle-ichimoku': 'showIchimoku',
  'toggle-volume': 'showVolume',
  'toggle-predicted': 'showPredicted',
  'toggle-actual': 'showActual',
  'toggle-naive': 'showNaive'
};

export function optionKeyFromToggleId(id) {
  return TOGGLE_OPTION_MAP[id] || null;
}
