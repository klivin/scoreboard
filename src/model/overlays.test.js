import { test } from 'node:test';
import assert from 'node:assert';
import {
  pickVolume,
  pickOiContracts,
  pickEtfMillions,
  priceAutoscaleRange,
  attachFlowOverlays,
  NEVER_ON_PRICE_SCALE,
  PRICE_AUTOSCALE_FIELDS
} from './overlays.js';

const AUG28 = Date.parse('2026-08-28T00:00:00Z');

test('pickVolume prefers base/volume and never volume_quote or volCcy', () => {
  assert.strictEqual(pickVolume({ volume_base: 1e4, volume_quote: 1e9 }), 1e4);
  assert.strictEqual(pickVolume({ volume: 4.63e9, volCcy: 9e12, volume_quote: 1e9 }), 4.63e9);
  assert.strictEqual(pickVolume({ volCcy: 1e9, volume_quote: 2e9, oi_usd: 2e9 }), null);
});

test('pickOiContracts prefers oi / oi_ccy and never oi_usd', () => {
  assert.strictEqual(pickOiContracts({ oi: 2e6, oi_usd: 2e9 }), 2e6);
  assert.strictEqual(pickOiContracts({ oi_ccy: 1.5e6, oi_usd: 2e9 }), 1.5e6);
  assert.strictEqual(pickOiContracts({ oi_usd: 2e9, oiusd: 2e9 }), null);
});

test('pickEtfMillions uses net_flow_usd_millions; blanks stay null not 0', () => {
  assert.strictEqual(pickEtfMillions({ net_flow_usd_millions: 12.5, net_flow_usd: 1.25e7 }), 12.5);
  assert.strictEqual(pickEtfMillions({ net_flow_usd_millions: '', net_flow_usd: 1e7 }), null);
  assert.strictEqual(pickEtfMillions({ net_flow_usd: 1e7 }), null);
  assert.strictEqual(pickEtfMillions({ net_flow: 0 }), null);
});

test('price autoscale is OHLC + MAs + Ichimoku only (Kevin 9T y-axis bug)', () => {
  const rows = [{
    timestamp: AUG28,
    open: 77000,
    high: 79000,
    low: 76000,
    close: 77822,
    ma20: 70899,
    ma50: 66990,
    ma100: 66191,
    volume: 4.63099e9,
    volume_quote: 4.63099e9,
    oi: 2e6,
    oi_usd: 2e9,
    etf_net_flow_usd_millions: 12.4,
    net_flow_usd: 1e7
  }];
  const range = priceAutoscaleRange(rows);
  assert.ok(range);
  assert.ok(range.min > 60000, `min ${range.min}`);
  assert.ok(range.max < 100000, `max ${range.max} must stay tens of thousands, not trillions`);
  for (const field of NEVER_ON_PRICE_SCALE) {
    assert.ok(!PRICE_AUTOSCALE_FIELDS.includes(field), `${field} must not autoscale price`);
  }
});

test('attachFlowOverlays joins ETF/OI by UTC day and leaves gaps as gaps', () => {
  const series = [
    { timestamp: AUG28, open: 77000, high: 78000, low: 76000, close: 77822, volume: 1.2e4 },
    { timestamp: Date.parse('2026-08-29T00:00:00Z'), open: 78000, high: 79000, low: 77000, close: 78500, volume: 1.1e4 }
  ];
  const attached = attachFlowOverlays(series, {
    interval: '1d',
    etfRows: [
      { date_utc: '2026-08-28', net_flow_usd_millions: 12.4 },
      { date_utc: '2026-08-29', net_flow_usd_millions: '' }
    ],
    oiRows: [
      { date_utc: '2026-08-28', oi: 2.1e6, oi_usd: 2e9 }
    ]
  });

  assert.strictEqual(attached[0].etf_net_flow_usd_millions, 12.4);
  assert.strictEqual(attached[0].oi, 2.1e6);
  assert.strictEqual(attached[1].etf_net_flow_usd_millions, null);
  assert.strictEqual(attached[1].oi, null);
  assert.notStrictEqual(attached[1].etf_net_flow_usd_millions, 0);
  assert.notStrictEqual(attached[1].oi, 0);
});

test('1h OI joins by hour; ETF still uses that UTC day', () => {
  const hour = Date.parse('2026-08-28T15:00:00Z');
  const series = [{
    timestamp: hour,
    open: 77000,
    high: 78000,
    low: 76000,
    close: 77822,
    volume: 50
  }];
  const attached = attachFlowOverlays(series, {
    interval: '1h',
    etfRows: [{ date_utc: '2026-08-28', net_flow_usd_millions: 8.2 }],
    oiRows: [{ datetime_utc: '2026-08-28 15:00:00', oi: 2.2e6, oi_usd: 2e9 }]
  });
  assert.strictEqual(attached[0].etf_net_flow_usd_millions, 8.2);
  assert.strictEqual(attached[0].oi, 2.2e6);
});
