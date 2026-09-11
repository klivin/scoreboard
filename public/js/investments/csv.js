import { classifyActivityType, parseOptionalDate } from './parse.js';

const CANONICAL_COLUMNS = [
  'Activity/Trade Date',
  'Transaction Date',
  'Settlement Date',
  'Activity Type',
  'Description',
  'Symbol',
  'Cusip',
  'Quantity',
  'Price',
  'Amount',
  'Commission',
  'Category',
  'Note'
];

const HEADER_ALIASES = {
  'activity/trade date': 'Activity/Trade Date',
  'activity date': 'Activity/Trade Date',
  'trade date': 'Activity/Trade Date',
  'transaction date': 'Transaction Date',
  'settlement date': 'Settlement Date',
  'activity type': 'Activity Type',
  'transaction type': 'Activity Type',
  'description': 'Description',
  'symbol': 'Symbol',
  'cusip': 'Cusip',
  'quantity': 'Quantity',
  'qty': 'Quantity',
  'shares': 'Quantity',
  'price': 'Price',
  'price per share': 'Price',
  'unit price': 'Price',
  'share price': 'Price',
  'amount': 'Amount',
  'commission': 'Commission',
  'category': 'Category',
  'note': 'Note',
  'notes': 'Note',
  'cost basis': 'CostBasis',
  'costbasis': 'CostBasis',
  'total cost': 'CostBasis',
  'cost': 'CostBasis',
  'average cost': 'AverageCost',
  'avg cost': 'AverageCost',
  'avg. cost': 'AverageCost',
  'average price': 'AverageCost',
  'avg price': 'AverageCost',
  'avg. price': 'AverageCost',
  'unit cost': 'AverageCost',
  'last price': 'LastPrice',
  'last': 'LastPrice',
  'current price': 'LastPrice',
  'mark': 'LastPrice',
  'market value': 'MarketValue',
  'marketvalue': 'MarketValue',
  'mkt value': 'MarketValue',
  'value': 'MarketValue',
  'as of': 'AsOfDate',
  'as of date': 'AsOfDate',
  'name': 'Description'
};

export { CANONICAL_COLUMNS };

export function normalizeHeader(name) {
  return String(name || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/[#\$]+/g, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapHeader(name) {
  return HEADER_ALIASES[normalizeHeader(name)] || null;
}

export function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export function splitCsvLines(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return raw.split('\n').filter((line, index, arr) => {
    if (line.trim() !== '') return true;
    return index < arr.length - 1 && arr.slice(index + 1).some((l) => l.trim() !== '');
  });
}

export function isActivityHeaderRow(cells) {
  const mapped = (cells || []).map((cell) => mapHeader(cell));
  if (mapped.includes('Activity/Trade Date')) return true;
  return mapped.includes('Activity Type') && mapped.includes('Symbol');
}

export function findActivityHeaderIndex(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    if (String(lines[i] || '').trim() === '') continue;
    if (isActivityHeaderRow(parseCsvLine(lines[i]))) return i;
  }
  return -1;
}

const POSITION_COST_HEADERS = new Set(['CostBasis', 'AverageCost', 'LastPrice', 'MarketValue', 'Price']);

export function isPositionsHeaderRow(cells) {
  const mapped = (cells || []).map((cell) => mapHeader(cell));
  if (mapped.includes('Activity/Trade Date') || mapped.includes('Activity Type')) return false;
  return mapped.includes('Symbol')
    && mapped.includes('Quantity')
    && mapped.some((name) => POSITION_COST_HEADERS.has(name));
}

export function findPositionsHeaderIndex(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    if (String(lines[i] || '').trim() === '') continue;
    if (isPositionsHeaderRow(parseCsvLine(lines[i]))) return i;
  }
  return -1;
}

const FOOTER_PROSE_RE = /morgan stanley|brokerage services are offered|member sipc|securities products are offered/i;

export function isFooterProseText(text) {
  return FOOTER_PROSE_RE.test(String(text || ''));
}

export function hasUsableActivityDate(record) {
  const activityDate = parseOptionalDate(record && record['Activity/Trade Date']);
  const transactionDate = parseOptionalDate(record && record['Transaction Date']);
  return Boolean((activityDate && activityDate.iso) || (transactionDate && transactionDate.iso));
}

export function isRecognizedActivityType(typeText) {
  return classifyActivityType(typeText) !== 'unsupported';
}

/**
 * Trailing E*TRADE disclaimer / legal paragraphs have no trade date and no
 * recognized activity type. Those must not become unsupported-trade rows.
 */
export function isNonDatedNonActivityRecord(record) {
  if (hasUsableActivityDate(record)) return false;
  return !isRecognizedActivityType(record && record['Activity Type']);
}

export function parseActivityCsv(text) {
  const lines = splitCsvLines(text);
  const nonEmpty = lines.filter((line) => line.trim() !== '');
  if (nonEmpty.length === 0) {
    return {
      headers: [],
      canonicalHeaders: [],
      rows: [],
      errors: ['CSV is empty'],
      headerLineNumber: null
    };
  }

  const headerIndex = findActivityHeaderIndex(lines);
  if (headerIndex === -1) {
    return {
      headers: parseCsvLine(nonEmpty[0]).map((h) => h.trim()),
      canonicalHeaders: [],
      rows: [],
      errors: ['No recognized Activity CSV columns'],
      headerLineNumber: null
    };
  }

  const rawHeaders = parseCsvLine(lines[headerIndex]).map((h) => h.trim());
  const canonicalHeaders = rawHeaders.map((h) => mapHeader(h));
  const errors = [];

  if (!canonicalHeaders.some(Boolean)) {
    errors.push('No recognized Activity CSV columns');
  }

  const rows = [];
  const pendingNonActivity = [];
  let acceptedActivity = false;
  let stoppedAtFooter = false;

  const flushPending = () => {
    for (const pending of pendingNonActivity) rows.push(pending);
    pendingNonActivity.length = 0;
  };

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') {
      if (acceptedActivity) {
        stoppedAtFooter = true;
        break;
      }
      continue;
    }
    if (isFooterProseText(lines[i])) {
      stoppedAtFooter = true;
      break;
    }

    const cells = parseCsvLine(lines[i]);
    const raw = {};
    const record = {};
    rawHeaders.forEach((header, idx) => {
      const value = cells[idx] == null ? '' : String(cells[idx]).trim();
      raw[header] = value;
      const canonical = canonicalHeaders[idx];
      if (canonical) record[canonical] = value;
    });
    const row = {
      lineNumber: i + 1,
      raw,
      record
    };

    if (isNonDatedNonActivityRecord(record)) {
      pendingNonActivity.push(row);
      if (acceptedActivity && pendingNonActivity.length >= 2) {
        pendingNonActivity.length = 0;
        stoppedAtFooter = true;
        break;
      }
      continue;
    }

    flushPending();
    rows.push(row);
    acceptedActivity = true;
  }

  if (!acceptedActivity) flushPending();

  return {
    headers: rawHeaders,
    canonicalHeaders,
    rows,
    errors,
    headerLineNumber: headerIndex + 1,
    stoppedAtFooter,
    kind: 'activity'
  };
}

/**
 * E*TRADE / Morgan Stanley Positions (holdings) snapshot.
 * Cost Basis / Average Cost become lot cost. Price / Last Price is mark only —
 * never used as cost (that was the import bug: mark landed in basis).
 */
export function parsePositionsCsv(text) {
  const lines = splitCsvLines(text);
  const nonEmpty = lines.filter((line) => line.trim() !== '');
  if (nonEmpty.length === 0) {
    return {
      headers: [],
      canonicalHeaders: [],
      rows: [],
      errors: ['CSV is empty'],
      headerLineNumber: null,
      kind: 'positions'
    };
  }

  const headerIndex = findPositionsHeaderIndex(lines);
  if (headerIndex === -1) {
    return {
      headers: parseCsvLine(nonEmpty[0]).map((h) => h.trim()),
      canonicalHeaders: [],
      rows: [],
      errors: ['No recognized Positions CSV columns'],
      headerLineNumber: null,
      kind: 'positions'
    };
  }

  const rawHeaders = parseCsvLine(lines[headerIndex]).map((h) => h.trim());
  const canonicalHeaders = rawHeaders.map((h) => mapHeader(h));
  const errors = [];
  const rows = [];
  let accepted = false;
  let stoppedAtFooter = false;

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') {
      if (accepted) {
        stoppedAtFooter = true;
        break;
      }
      continue;
    }
    if (isFooterProseText(lines[i])) {
      stoppedAtFooter = true;
      break;
    }

    const cells = parseCsvLine(lines[i]);
    const raw = {};
    const record = {};
    rawHeaders.forEach((header, idx) => {
      const value = cells[idx] == null ? '' : String(cells[idx]).trim();
      raw[header] = value;
      const canonical = canonicalHeaders[idx];
      if (canonical) record[canonical] = value;
    });
    rows.push({
      lineNumber: i + 1,
      raw,
      record
    });
    accepted = true;
  }

  return {
    headers: rawHeaders,
    canonicalHeaders,
    rows,
    errors,
    headerLineNumber: headerIndex + 1,
    stoppedAtFooter,
    kind: 'positions'
  };
}

export function parseBrokerageCsv(text) {
  const activity = parseActivityCsv(text);
  if (activity.headerLineNumber != null && !activity.errors.includes('No recognized Activity CSV columns')) {
    return activity;
  }
  const positions = parsePositionsCsv(text);
  if (positions.headerLineNumber != null && !positions.errors.includes('No recognized Positions CSV columns')) {
    return positions;
  }
  return {
    headers: activity.headers || [],
    canonicalHeaders: [],
    rows: [],
    errors: ['No recognized Activity or Positions CSV columns'],
    headerLineNumber: null,
    kind: null
  };
}

const ETRADE_EXPORT_COLUMNS = [
  'Activity/Trade Date',
  'Transaction Date',
  'Settlement Date',
  'Activity Type',
  'Description',
  'Symbol',
  'Cusip',
  'Quantity #',
  'Price $',
  'Amount $',
  'Commission',
  'Category',
  'Note'
];

export { ETRADE_EXPORT_COLUMNS };

export function buildSyntheticCsv(rows, headers = CANONICAL_COLUMNS) {
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => {
      const canonical = mapHeader(header);
      let value;
      if (Object.prototype.hasOwnProperty.call(row, header)) value = row[header];
      else if (canonical && Object.prototype.hasOwnProperty.call(row, canonical)) value = row[canonical];
      else value = undefined;
      return escape(value);
    }).join(','));
  }
  return lines.join('\n');
}

export const ETRADE_SYNTHETIC_FOOTER = [
  'Brokerage services are offered by Morgan Stanley Smith Barney LLC, Member SIPC.',
  '© 2026 Morgan Stanley Smith Barney LLC. Member SIPC.'
];

/**
 * Synthetic E*TRADE Activity export shape: title / account / Total: preamble,
 * then a header with Quantity # / Price $ / Amount $ suffixes.
 * Never include real account numbers or brokerage symbols.
 */
export function buildEtradePreambleCsv(rows, options = {}) {
  const accountLabel = options.accountLabel || 'Synthetic Account -0000';
  const from = options.from || '2025-01-01';
  const to = options.to || '2026-09-03';
  const total = options.total == null ? '20519.86' : options.total;
  const body = buildSyntheticCsv(rows, options.headers || ETRADE_EXPORT_COLUMNS);
  const parts = [
    'Investment Transactions Activity Types',
    '',
    `Account Activity for ${accountLabel} from ${from} to ${to}`,
    '',
    `Total:,${total}`,
    '',
    body
  ];
  if (options.footer) {
    const footerLines = Array.isArray(options.footer) ? options.footer : ETRADE_SYNTHETIC_FOOTER;
    if (options.footerGap !== false) parts.push('');
    parts.push(...footerLines);
  }
  return parts.join('\n');
}

export const ETRADE_POSITIONS_COLUMNS = [
  'Symbol',
  'Quantity',
  'Last Price $',
  'Cost Basis $',
  'Average Cost $',
  'Market Value $'
];

/**
 * Synthetic E*TRADE Positions snapshot. Price/Last Price is mark, not cost.
 * Never include real account numbers or brokerage symbols.
 */
export function buildEtradePositionsCsv(rows, options = {}) {
  const accountLabel = options.accountLabel || 'Synthetic Account -0000';
  const body = buildSyntheticCsv(rows, options.headers || ETRADE_POSITIONS_COLUMNS);
  const parts = [
    'Account Positions',
    '',
    `Positions for ${accountLabel}`,
    '',
    body
  ];
  if (options.footer) {
    const footerLines = Array.isArray(options.footer) ? options.footer : ETRADE_SYNTHETIC_FOOTER;
    if (options.footerGap !== false) parts.push('');
    parts.push(...footerLines);
  }
  return parts.join('\n');
}
