export const FORECAST_EXPORT_COLUMNS = [
  'symbol',
  'horizon',
  'asOfDateUtc',
  'asOfTimestamp',
  'predictedPoint',
  'predictedLower',
  'predictedUpper',
  'naivePoint',
  'confidence',
  'model',
  'modelVersion',
  'actualClose',
  'mae',
  'naiveMae',
  'direction',
  'naiveDirection',
  'maeVsNaive',
  'status'
];

function cell(value) {
  if (value == null || value === '') return '';
  return value;
}

export function forecastsToExportRows(forecasts) {
  return (forecasts || []).map((fc) => ({
    symbol: fc.symbol || '',
    horizon: fc.horizon || '',
    asOfDateUtc: fc.asOfDateUtc || '',
    asOfTimestamp: fc.asOfTimestamp == null ? '' : fc.asOfTimestamp,
    predictedPoint: fc.predicted && fc.predicted.point != null ? fc.predicted.point : '',
    predictedLower: fc.predicted && fc.predicted.lower != null ? fc.predicted.lower : '',
    predictedUpper: fc.predicted && fc.predicted.upper != null ? fc.predicted.upper : '',
    naivePoint: fc.naive && fc.naive.point != null ? fc.naive.point : '',
    confidence: fc.confidence == null ? '' : fc.confidence,
    model: fc.model || '',
    modelVersion: fc.modelVersion || '',
    actualClose: fc.actual && fc.actual.close != null ? fc.actual.close : '',
    mae: fc.score && fc.score.mae != null ? fc.score.mae : '',
    naiveMae: fc.score && fc.score.naiveMae != null ? fc.score.naiveMae : '',
    direction: fc.score && fc.score.direction || '',
    naiveDirection: fc.score && fc.score.naiveDirection || '',
    maeVsNaive: fc.score && fc.score.maeVsNaive || '',
    status: fc.status || ''
  }));
}

export function buildForecastExportJson(forecasts, extra = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    namespace: 'forecasts',
    exportedAt: new Date().toISOString(),
    disclaimer: 'Research/paper only. No trades. MAE is omitted (not 0) unless status is matured.',
    count: (forecasts || []).length,
    ...extra,
    forecasts
  }, null, 2);
}

export function buildForecastExportCsv(forecasts) {
  const rows = forecastsToExportRows(forecasts);
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  return [
    FORECAST_EXPORT_COLUMNS.join(','),
    ...rows.map((row) => FORECAST_EXPORT_COLUMNS.map((h) => escape(cell(row[h]))).join(','))
  ].join('\n');
}

export function downloadBlob(filename, text, mime) {
  if (typeof document === 'undefined') {
    return { filename, text, mime, transmitted: false };
  }
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { filename, transmitted: false };
}
