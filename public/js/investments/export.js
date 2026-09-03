import { CANONICAL_COLUMNS } from './csv.js';

export function eventsToExportRows(events) {
  return (events || []).map((event) => ({
    'Activity/Trade Date': event.activityDate || '',
    'Transaction Date': event.transactionDate || '',
    'Settlement Date': event.settlementDate || '',
    'Activity Type': event.activityType || '',
    Description: event.description || '',
    Symbol: event.symbol || '',
    Cusip: event.cusip || '',
    Quantity: event.quantity == null ? '' : event.quantity,
    Price: event.price == null ? '' : event.price,
    Amount: event.amount == null ? '' : event.amount,
    Commission: event.commission == null ? '' : event.commission,
    Category: event.category || '',
    Note: event.note || '',
    Badge: event.badge || '',
    Source: event.source || ''
  }));
}

export function buildExportJson(state) {
  return JSON.stringify({
    schemaVersion: state.schemaVersion,
    namespace: state.namespace,
    exportedAt: new Date().toISOString(),
    privacy: {
      transmitted: false,
      note: 'Local download only. This file was not uploaded.'
    },
    collections: state.collections
  }, null, 2);
}

export function buildExportCsv(events) {
  const rows = eventsToExportRows(events);
  const headers = [...CANONICAL_COLUMNS, 'Badge', 'Source'];
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n');
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
