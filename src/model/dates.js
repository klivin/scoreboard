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
