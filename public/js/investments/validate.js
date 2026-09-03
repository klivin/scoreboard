import { parseActivityCsv } from './csv.js';
import { normalizeRows } from './parse.js';

export function missingLabel(value) {
  return value == null || value === '' ? 'missing' : value;
}

export function validateEvents(events) {
  const errors = [];
  const warnings = [];

  (events || []).forEach((event, index) => {
    const label = `Row ${event.lineNumber || index + 1}`;
    if (event.flags && event.flags.unparsedDate) {
      warnings.push(`${label}: activity date could not be parsed; chart marker date is missing`);
    }
    if (!event.activityDate && !event.transactionDate) {
      warnings.push(`${label}: no usable Activity/Trade or Transaction Date`);
    }
    if (event.flags && event.flags.unsupported) {
      warnings.push(`${label}: unsupported activity type — not treated as a fill`);
    }
    if ((event.activityType === 'buy' || event.activityType === 'sell')
      && event.flags
      && (event.flags.missingQuantity || event.flags.missingPrice)) {
      warnings.push(
        `${label}: ${event.activityType} is missing ${[
          event.flags.missingQuantity ? 'quantity' : null,
          event.flags.missingPrice ? 'price' : null
        ].filter(Boolean).join(' and ')} — no fill inferred`
      );
    }
    if (event.flags && event.flags.needsExplicitMapping) {
      warnings.push(`${label}: ${event.activityType} requires an explicit symbol/CUSIP mapping`);
    }
    if (!event.symbol && event.activityType !== 'fee' && event.activityType !== 'unsupported') {
      warnings.push(`${label}: symbol is missing — no automatic inference`);
    }
  });

  return { errors, warnings };
}

export function previewImport(csvText, options = {}) {
  const parsed = parseActivityCsv(csvText);
  const events = normalizeRows(parsed.rows, {
    badge: 'REAL',
    source: 'import',
    symbolMaps: options.symbolMaps || [],
    idPrefix: options.idPrefix || `imp_${Date.now()}`
  });
  const { errors, warnings } = validateEvents(events);
  const allErrors = [...parsed.errors, ...errors];

  return {
    headers: parsed.headers,
    canonicalHeaders: parsed.canonicalHeaders,
    rawRows: parsed.rows,
    events,
    errors: allErrors,
    warnings,
    canCommit: parsed.rows.length > 0 && allErrors.length === 0,
    privacy: {
      transmitted: false,
      destination: 'browser local store only',
      serverReceivesCsv: false
    }
  };
}
