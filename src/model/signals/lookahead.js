/**
 * Slice series to index `t` inclusive — no future bars visible to strategies at time t.
 */
export function sliceAt(series, index) {
  return series.slice(0, index + 1);
}

/**
 * Assert that evaluate() only reads indices <= endIndex when given a sliced series.
 * Wraps array access to detect lookahead in tests.
 */
export function guardSeriesAccess(series, maxIndex) {
  return new Proxy(series, {
    get(target, prop) {
      if (prop === 'length') return Math.min(target.length, maxIndex + 1);
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        const idx = Number(prop);
        if (idx > maxIndex) {
          throw new Error(`Lookahead violation: read index ${idx} at time ${maxIndex}`);
        }
      }
      if (prop === 'slice') {
        return (start, end) => {
          const cappedEnd = end === undefined ? maxIndex + 1 : Math.min(end, maxIndex + 1);
          return target.slice(start, cappedEnd);
        };
      }
      return target[prop];
    }
  });
}
