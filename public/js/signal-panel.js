export const SIGNAL_STRATEGY_IDS = [
  'ema-crossover',
  'macd-cross',
  'rsi-recovery',
  'ichimoku'
];

export const SIGNAL_STRATEGY_LABELS = {
  'ema-crossover': 'EMA 20/50 cross (true EMA)',
  'macd-cross': 'MACD 12/26/9',
  'rsi-recovery': 'RSI recovery',
  'ichimoku': 'Ichimoku'
};

export function getEnabledSignalStrategies() {
  return SIGNAL_STRATEGY_IDS.filter((id) => {
    const el = document.getElementById(`toggle-signal-${id}`);
    return !el || el.checked;
  });
}

export function getSignalHorizon() {
  const select = document.getElementById('signal-horizon-select');
  return (select && select.value) || 'weekly';
}

export function formatSignalMarkerText(event) {
  const c = event.consensus;
  if (!c) return '?';
  return `${c.direction} ${c.scorePercent}`;
}

export function buildSignalTooltipHtml(event) {
  if (!event) return '';
  const c = event.consensus || {};
  const lines = [
    `<strong>${c.direction || 'NEUTRAL'}</strong> — consensus ${c.scorePercent ?? 50}/100 (conf ${c.confidence ?? 0}%)`,
    `<em>Research signage only — not a trade call.</em>`
  ];
  for (const vote of c.breakdown || []) {
    lines.push(`<div class="signal-vote"><b>${vote.name}</b>: ${vote.signal} — ${vote.reason || ''}</div>`);
    if (vote.invalidation) {
      lines.push(`<div class="signal-invalidation">Invalidation: ${vote.invalidation}</div>`);
    }
  }
  return lines.join('');
}
