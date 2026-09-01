export function formatPrice(price) {
  if (!Number.isFinite(price)) return 'missing';
  const abs = Math.abs(price);
  if (abs >= 1000) return price.toFixed(0);
  if (abs >= 1) return price.toFixed(2);
  return price.toFixed(6);
}

export function formatCompact(value) {
  if (!Number.isFinite(value)) return 'missing';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

export function formatMissingOr(value, formatter) {
  if (!Number.isFinite(value)) return 'missing';
  return formatter(value);
}

export function formatUtcStamp(timestamp, interval = '1d') {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'missing';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  if (interval === '1h') {
    const hh = String(date.getUTCHours()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:00 UTC`;
  }
  return `${y}-${m}-${d}`;
}

const MA_FIELDS = [
  { field: 'ma20', option: 'showMA20', label: 'MA20 (EMA)' },
  { field: 'ma50', option: 'showMA50', label: 'MA50 (SMA)' },
  { field: 'ma100', option: 'showMA100', label: 'MA100 (SMA)' },
  { field: 'ma200', option: 'showMA200', label: 'MA200 (SMA)' }
];

const ICHIMOKU_FIELDS = [
  { field: 'tenkan', label: 'Tenkan' },
  { field: 'kijun', label: 'Kijun' },
  { field: 'senkouA', label: 'Senkou A' },
  { field: 'senkouB', label: 'Senkou B' },
  { field: 'chikou', label: 'Chikou' }
];

export function buildTooltipLines(row, options = {}, interval = '1d') {
  if (!row) return ['missing'];
  const lines = [formatUtcStamp(row.timestamp, interval)];
  lines.push(`Price: ${formatMissingOr(row.close, (v) => `$${formatPrice(v)}`)}`);

  for (const meta of MA_FIELDS) {
    if (!options[meta.option]) continue;
    lines.push(`${meta.label}: ${formatMissingOr(row[meta.field], (v) => `$${formatPrice(v)}`)}`);
  }

  if (options.showIchimoku) {
    for (const meta of ICHIMOKU_FIELDS) {
      lines.push(`${meta.label}: ${formatMissingOr(row[meta.field], (v) => `$${formatPrice(v)}`)}`);
    }
  }

  if (options.showVolume) {
    lines.push(`Volume: ${formatMissingOr(row.volume, formatCompact)}`);
  }

  if (options.showEtf) {
    lines.push(`ETF net flow: ${formatMissingOr(row.etf_net_flow_usd_millions, (v) => `${v.toFixed(1)}M USD`)}`);
  }

  if (options.showOi) {
    lines.push(`Open Interest: ${formatMissingOr(row.oi, (v) => `${formatCompact(v)} contracts`)}`);
  }

  return lines;
}
