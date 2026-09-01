export function firstRowTimestamp(row) {
  if (!row || typeof row !== 'object') return null;
  const lower = {};
  for (const [key, value] of Object.entries(row)) {
    lower[String(key).toLowerCase()] = value;
  }
  const datetime = lower.datetime_utc ?? lower.date_utc ?? lower.datetime ?? lower.date;
  const numeric = lower.ts_ms ?? lower.timestamp ?? lower.ts ?? lower.time ?? lower.t;
  const fromMs = parseUtcTimestamp(null, numeric);
  if (fromMs != null) return fromMs;
  return parseUtcTimestamp(datetime, null);
}

export function parseUtcTimestamp(dateUtc, fallback = null) {
  if (dateUtc !== undefined && dateUtc !== null && dateUtc !== '') {
    if (typeof dateUtc === 'number' && Number.isFinite(dateUtc)) {
      if (dateUtc > 1e12) return dateUtc;
      if (dateUtc > 1e9) return dateUtc * 1000;
    }

    const text = String(dateUtc).trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const ms = Date.parse(`${text}T00:00:00Z`);
      if (!Number.isNaN(ms)) return ms;
    }

    if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(text)) {
      const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(text)
        ? text.replace(' ', 'T')
        : `${text.replace(' ', 'T')}Z`;
      const ms = Date.parse(normalized);
      if (!Number.isNaN(ms)) return ms;
    }

    const monthName = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
    if (monthName) {
      const months = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
      };
      const month = months[monthName[2].slice(0, 3).toLowerCase()];
      if (month != null) {
        return Date.UTC(Number(monthName[3]), month, Number(monthName[1]));
      }
    }

    if (/^\d+(\.\d+)?$/.test(text)) {
      const n = Number(text);
      if (n > 1e12) return n;
      if (n > 1e9) return n * 1000;
    }
  }

  if (fallback !== undefined && fallback !== null && fallback !== '') {
    if (typeof fallback === 'number' && Number.isFinite(fallback)) {
      if (fallback > 1e12) return fallback;
      if (fallback > 1e9) return fallback * 1000;
    }
    const n = Number(fallback);
    if (Number.isFinite(n) && n > 1e9) {
      return n > 1e12 ? n : n * 1000;
    }
  }

  return null;
}

export function formatUtcTick(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

export function formatPriceLabel(price) {
  if (!Number.isFinite(price)) return '';
  const abs = Math.abs(price);
  if (abs >= 1000) return price.toFixed(0);
  if (abs >= 1) return price.toFixed(2);
  return price.toFixed(6);
}
