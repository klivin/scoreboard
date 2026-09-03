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
  'price': 'Price',
  'amount': 'Amount',
  'commission': 'Commission',
  'category': 'Category',
  'note': 'Note',
  'notes': 'Note'
};

export { CANONICAL_COLUMNS };

export function normalizeHeader(name) {
  return String(name || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ');
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

export function parseActivityCsv(text) {
  const lines = splitCsvLines(text).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    return { headers: [], canonicalHeaders: [], rows: [], errors: ['CSV is empty'] };
  }

  const rawHeaders = parseCsvLine(lines[0]).map((h) => h.trim());
  const canonicalHeaders = rawHeaders.map((h) => mapHeader(h));
  const errors = [];

  if (!canonicalHeaders.some(Boolean)) {
    errors.push('No recognized Activity CSV columns');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
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
  }

  return { headers: rawHeaders, canonicalHeaders, rows, errors };
}

export function buildSyntheticCsv(rows, headers = CANONICAL_COLUMNS) {
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(','));
  }
  return lines.join('\n');
}
