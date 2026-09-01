import { firstRowTimestamp } from './dates.js';

export const PRICE_AUTOSCALE_FIELDS = [
  'open',
  'high',
  'low',
  'close',
  'ma20',
  'ma50',
  'ma100',
  'ma200',
  'tenkan',
  'kijun',
  'senkouA',
  'senkouB',
  'chikou'
];

export const NEVER_ON_PRICE_SCALE = [
  'volume',
  'volume_base',
  'volume_quote',
  'volccy',
  'vol_ccy',
  'oi',
  'oi_usd',
  'oi_ccy',
  'oiusd',
  'etf_net_flow_usd_millions',
  'net_flow_usd',
  'net_flow_usd_millions'
];

function numeric(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function utcDayKey(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function hourKey(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  return Math.floor(timestamp / 3600000) * 3600000;
}

export function pickVolume(row) {
  if (!row) return null;
  return numeric(
    row.volume_base,
    row.vol_base,
    row.volume,
    row.vol,
    row.Volume
  );
}

export function pickOiContracts(row) {
  if (!row) return null;
  return numeric(
    row.oi,
    row.open_interest,
    row.openinterest,
    row.oi_ccy,
    row.oiccy
  );
}

export function pickEtfMillions(row) {
  if (!row) return null;
  return numeric(row.net_flow_usd_millions, row.net_flow_usd_million);
}

export function priceAutoscaleValues(row) {
  if (!row) return [];
  return PRICE_AUTOSCALE_FIELDS
    .map((field) => row[field])
    .filter((value) => Number.isFinite(value));
}

export function priceAutoscaleRange(rows) {
  const values = [];
  for (const row of rows || []) {
    values.push(...priceAutoscaleValues(row));
  }
  if (!values.length) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

export function mapEtfRow(row) {
  return {
    timestamp: firstRowTimestamp(row),
    net_flow_usd_millions: pickEtfMillions(row)
  };
}

export function mapOiRow(row) {
  return {
    timestamp: firstRowTimestamp(row),
    oi: pickOiContracts(row)
  };
}

export function attachFlowOverlays(series, { etfRows = [], oiRows = [], interval = '1d' } = {}) {
  const etfByDay = new Map();
  for (const raw of etfRows || []) {
    const mapped = mapEtfRow(raw);
    if (!mapped.timestamp) continue;
    const key = utcDayKey(mapped.timestamp);
    if (!key) continue;
    etfByDay.set(key, mapped);
  }

  const oiByKey = new Map();
  for (const raw of oiRows || []) {
    const mapped = mapOiRow(raw);
    if (!mapped.timestamp) continue;
    const key = interval === '1h' ? hourKey(mapped.timestamp) : utcDayKey(mapped.timestamp);
    if (key == null) continue;
    oiByKey.set(key, mapped);
  }

  return (series || []).map((row) => {
    const day = row && Number.isFinite(row.timestamp) ? utcDayKey(row.timestamp) : null;
    const oiKey = interval === '1h' ? hourKey(row && row.timestamp) : day;
    const etf = day ? etfByDay.get(day) : null;
    const oi = oiKey != null ? oiByKey.get(oiKey) : null;
    const oiValue = oi && Number.isFinite(oi.oi)
      ? oi.oi
      : pickOiContracts(row);

    return {
      ...row,
      volume: pickVolume(row),
      etf_net_flow_usd_millions: etf && Number.isFinite(etf.net_flow_usd_millions)
        ? etf.net_flow_usd_millions
        : null,
      oi: Number.isFinite(oiValue) ? oiValue : null
    };
  });
}
