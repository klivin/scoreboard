export const PRICE_PANE_INDEX = 0;
export const FIRST_OVERLAY_PANE_INDEX = 1;
export const PRICE_SCALE_ID = 'right';

export function overlayPaneCount(options) {
  if (!options) return 0;
  return [options.showVolume, options.showEtf, options.showOi].filter(Boolean).length;
}

export function chartWrapHeight(options, base = 420) {
  const extra = overlayPaneCount(options);
  return base + 120 + extra * 120;
}

export function paneStretchFactor(paneIndex) {
  return paneIndex === PRICE_PANE_INDEX ? 3 : 1;
}
