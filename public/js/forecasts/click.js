export function visibleRangeAroundTimestamp(timestampMs, { beforeDays = 5, afterDays = 2 } = {}) {
  if (!Number.isFinite(timestampMs)) return null;
  const sec = Math.floor(timestampMs / 1000);
  return {
    from: sec - beforeDays * 86400,
    to: sec + afterDays * 86400
  };
}

/**
 * Click payload for a scored forecast row.
 * chartJumpTimestamp is the as-of bar the Overview chart must focus.
 */
export function buildForecastClickPayload(record) {
  if (!record) return null;
  return {
    id: record.id || null,
    symbol: record.symbol || null,
    horizon: record.horizon || null,
    horizonDays: record.horizonDays || null,
    chartJumpTimestamp: record.asOfTimestamp,
    asOfDateUtc: record.asOfDateUtc || null,
    rationale: record.rationale || null,
    features: record.features || null,
    status: record.status || null,
    predicted: record.predicted || null,
    model: record.model || null,
    modelVersion: record.modelVersion || null
  };
}

export function formatRationaleHtml(payload) {
  if (!payload) return '';
  const rationale = payload.rationale || {};
  const features = payload.features || {};
  const featureBits = Object.entries(features)
    .filter(([, value]) => Number.isFinite(value))
    .map(([key, value]) => `${key}=${Number(value).toFixed(4)}`);
  const asOf = payload.asOfDateUtc || (Number.isFinite(payload.chartJumpTimestamp)
    ? new Date(payload.chartJumpTimestamp).toISOString().slice(0, 10)
    : 'n/a');

  return [
    `<div class="day-strip-title">Forecast as-of ${asOf} · ${payload.symbol || ''} ${payload.horizon || ''}</div>`,
    `<div><strong>Model:</strong> ${payload.model || 'n/a'} / ${payload.modelVersion || 'n/a'} · status ${payload.status || 'n/a'}</div>`,
    rationale.side ? `<div><strong>Side:</strong> ${rationale.side} · ${rationale.recommendation || ''}</div>` : '',
    rationale.proCase ? `<div><strong>Rationale (pro):</strong> ${rationale.proCase}</div>` : '',
    rationale.conCase ? `<div><strong>Rationale (con):</strong> ${rationale.conCase}</div>` : '',
    featureBits.length
      ? `<div><strong>Features used:</strong> ${featureBits.join(', ')}</div>`
      : '<div><strong>Features used:</strong> none recorded</div>'
  ].filter(Boolean).join('');
}
