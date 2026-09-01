export const PRICE_PANE_INDEX = 0;
export const PRICE_SCALE_ID = 'right';

export const OVERLAY_PANE_SCALES = {
  volume: 'volume',
  etf: 'etf',
  oi: 'oi'
};

export function overlayPaneCount(options) {
  if (!options) return 0;
  return [options.showVolume, options.showEtf, options.showOi].filter(Boolean).length;
}

export function chartWrapHeight(options, base = 420) {
  const extra = overlayPaneCount(options);
  return base + 100 + extra * 110;
}

export function paneStretchFactor(paneIndex) {
  return paneIndex === PRICE_PANE_INDEX ? 3 : 1;
}

export function overlaySeriesDefaults(scaleId) {
  return {
    priceScaleId: scaleId,
    lastValueVisible: true,
    priceLineVisible: false
  };
}
