import { SCANNER_DISCLAIMER, formatScannerCell, directionFamily } from './model.js';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return formatScannerCell(value, (n) => {
    const abs = Math.abs(n);
    const digits = abs >= 1000 ? 2 : (abs >= 1 ? 2 : 6);
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
  });
}

function pct(value) {
  return formatScannerCell(value, (n) => `${n.toFixed(1)}%`);
}

function signedPct(value) {
  return formatScannerCell(value, (n) => `${(n * 100).toFixed(2)}%`);
}

function when(ts) {
  return formatScannerCell(ts, (n) => new Date(n).toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
}

function badgeHtml(kind) {
  if (kind !== 'REAL' && kind !== 'TRACKING') return '';
  const cls = kind === 'TRACKING' ? 'badge-tracking' : 'badge-real';
  return `<span class="inv-badge ${cls}">${kind}</span>`;
}

function dirCell(slot) {
  if (!slot || !slot.direction) {
    return `<span class="scanner-missing">missing</span>`;
  }
  const fam = directionFamily(slot.direction) || '';
  const conf = formatScannerCell(slot.confidence, (n) => `${n.toFixed(0)}%`);
  return `<span class="scanner-dir scanner-dir-${fam}">${escapeHtml(slot.direction)}</span> <span class="scanner-conf">${escapeHtml(conf)}</span>`;
}

function consensusCell(consensus) {
  if (!consensus || consensus.missing || !consensus.direction) {
    return `<span class="scanner-missing">missing</span>`;
  }
  const fam = directionFamily(consensus.direction) || '';
  const score = formatScannerCell(consensus.scorePercent, (n) => `${n}`);
  return `<span class="scanner-dir scanner-dir-${fam}">${escapeHtml(consensus.direction)}</span> <span class="scanner-conf">${escapeHtml(score)}</span>`;
}

function backtestCell(bt) {
  if (!bt || bt.status !== 'available') {
    return `<span class="scanner-missing">missing</span>`;
  }
  const bh = bt.beatsBuyHold == null ? 'missing' : (bt.beatsBuyHold ? 'yes' : 'no');
  const nv = bt.beatsNaive == null ? 'missing' : (bt.beatsNaive ? 'yes' : 'no');
  return `stored · B&amp;H ${bh} · naive ${nv}`;
}

function contextCell(ctx) {
  if (!ctx) return `<span class="scanner-missing">missing</span>`;
  const etf = formatScannerCell(ctx.etfNetFlowUsdMillions, (n) => `${n.toFixed(1)}M ETF`);
  const oi = formatScannerCell(ctx.oiContracts, (n) => `${n.toLocaleString()} OI`);
  const corr = formatScannerCell(ctx.correlationVsBtc, (n) => `ρ ${n.toFixed(2)}`);
  return `${escapeHtml(etf)} · ${escapeHtml(oi)} · ${escapeHtml(corr)}`;
}

function freshnessCell(liq) {
  if (!liq) return `<span class="scanner-missing">missing</span>`;
  const vol = formatScannerCell(liq.volume, (n) => n.toLocaleString());
  const age = liq.freshnessLabel || 'missing';
  return `vol ${escapeHtml(vol)} · ${escapeHtml(age)}`;
}

export class ScannerView {
  constructor(rootId = 'universe') {
    this.root = document.getElementById(rootId);
  }

  selectedSymbol() {
    const row = this.root && this.root.querySelector('tr.scanner-row.selected');
    return row ? row.dataset.symbol : null;
  }

  render(model) {
    if (!this.root) return;
    const payload = model.payload || {};
    const rows = model.rows || [];
    const filters = model.filters || {};
    const selected = model.selectedSymbol || null;
    const evaluation = model.evaluation || null;
    const flipHistory = model.flipHistory || [];
    const note = payload.note || null;

    this.root.innerHTML = `
      <div class="scanner-banner" role="status">
        <strong>Research only.</strong> ${escapeHtml(SCANNER_DISCLAIMER)}
        This board does not rank assets or invent sentiment. Missing data stays <em>missing</em>.
      </div>
      ${note ? `<div class="alert"><strong>Note:</strong> ${escapeHtml(note)}</div>` : ''}
      <div class="scanner-toolbar">
        <label>Flip
          <select id="scanner-filter-flip">
            <option value="all">All</option>
            <option value="new-bullish">New bullish</option>
            <option value="new-bearish">New bearish</option>
          </select>
        </label>
        <label>Horizon
          <select id="scanner-filter-horizon">
            <option value="1">1d</option>
            <option value="7" selected>7d</option>
            <option value="30">30d</option>
          </select>
        </label>
        <label>Min confidence
          <select id="scanner-filter-confidence">
            <option value="">Any</option>
            <option value="50">≥ 50</option>
            <option value="70">≥ 70</option>
          </select>
        </label>
        <label>Asset class
          <select id="scanner-filter-class">
            <option value="all">All</option>
            <option value="crypto">Crypto</option>
            <option value="stock">Stock</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label class="scanner-check"><input type="checkbox" id="scanner-filter-real"> REAL holdings</label>
        <label class="scanner-check"><input type="checkbox" id="scanner-filter-tracking"> TRACKING</label>
        <label>Sort
          <select id="scanner-sort-key">
            <option value="symbol">Symbol</option>
            <option value="flip">Flip time</option>
            <option value="confidence">Confidence</option>
            <option value="horizon">Horizon dir</option>
            <option value="assetClass">Asset class</option>
            <option value="real">REAL</option>
            <option value="tracking">TRACKING</option>
            <option value="price">Price</option>
          </select>
        </label>
        <label>Dir
          <select id="scanner-sort-dir">
            <option value="asc">Asc</option>
            <option value="desc">Desc</option>
          </select>
        </label>
      </div>
      <div class="scanner-table-wrap">
        ${this.tableHtml(rows, selected)}
      </div>
      <div id="scanner-eval" class="scanner-panel">${this.evalHtml(evaluation, selected)}</div>
      <div id="scanner-flips" class="scanner-panel">${this.flipsHtml(flipHistory, selected)}</div>
    `;

    this.syncFilters(filters);
  }

  syncFilters(filters) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (!el || value == null) return;
      if (el.type === 'checkbox') el.checked = Boolean(value);
      else el.value = String(value);
    };
    set('scanner-filter-flip', filters.flip || 'all');
    set('scanner-filter-horizon', filters.horizon || 7);
    set('scanner-filter-confidence', filters.minConfidence == null ? '' : filters.minConfidence);
    set('scanner-filter-class', filters.assetClass || 'all');
    set('scanner-filter-real', filters.realHoldings);
    set('scanner-filter-tracking', filters.tracking);
    set('scanner-sort-key', filters.sortKey || 'symbol');
    set('scanner-sort-dir', filters.sortDir || 'asc');
  }

  tableHtml(rows, selected) {
    if (!rows.length) {
      return `<div class="empty-state"><h3>No scanner rows match</h3><p>Empty or missing — not a fabricated empty ranking.</p></div>`;
    }
    const body = rows.map((row) => {
      const symbol = escapeHtml(row.symbol);
      const sel = row.symbol === selected ? ' selected' : '';
      const badges = [
        row.holdings && row.holdings.real ? badgeHtml('REAL') : '',
        row.holdings && row.holdings.tracking ? badgeHtml('TRACKING') : ''
      ].filter(Boolean).join(' ');
      const tracking = row.holdings && row.holdings.tracking;
      const trackBtn = tracking
        ? `<button type="button" class="scanner-track-btn" data-action="stop" data-symbol="${symbol}" data-track-id="${escapeHtml(row.holdings.trackingId || '')}">Remove Tracking</button>`
        : `<button type="button" class="scanner-track-btn" data-action="start" data-symbol="${symbol}">Add to Tracking</button>`;
      const flip = row.flip && row.flip.lastFlipAt
        ? `${escapeHtml(row.flip.next || '')} ${escapeHtml(when(row.flip.lastFlipAt))}`
        : '<span class="scanner-missing">missing</span>';
      return `<tr class="scanner-row${sel}" data-symbol="${symbol}" tabindex="0">
        <td><strong>${symbol}</strong> ${badges}<div class="scanner-name">${escapeHtml(row.name || '')}</div></td>
        <td>${escapeHtml(row.assetClass || 'unknown')}</td>
        <td>${escapeHtml(money(row.currentPrice))}</td>
        <td>${freshnessCell(row.liquidity)}</td>
        <td>${dirCell(row.horizons && row.horizons[1])}</td>
        <td>${dirCell(row.horizons && row.horizons[7])}</td>
        <td>${dirCell(row.horizons && row.horizons[30])}</td>
        <td>${flip}</td>
        <td>${consensusCell(row.consensus)}</td>
        <td>${backtestCell(row.backtest)}</td>
        <td>${contextCell(row.context)}</td>
        <td>${trackBtn}</td>
      </tr>`;
    }).join('');

    return `<table class="scanner-table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Class</th>
          <th>Price</th>
          <th>Liquidity / freshness</th>
          <th>1d</th>
          <th>7d</th>
          <th>30d</th>
          <th>Last flip</th>
          <th>Consensus</th>
          <th>Backtest</th>
          <th>ETF / OI / corr</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  evalHtml(evaluation, symbol) {
    if (!symbol) {
      return `<h3>Evaluation</h3><p class="scanner-muted">Select a tracked row to compare forecast vs actual from the frozen baseline.</p>`;
    }
    if (!evaluation) {
      return `<h3>Evaluation — ${escapeHtml(symbol)}</h3><p class="scanner-muted">Start tracking to freeze a baseline. Without a baseline, evaluation is missing.</p>`;
    }
    const rows = [1, 7, 30].map((h) => {
      const slot = evaluation.horizons && evaluation.horizons[h];
      return `<tr>
        <td>${h}d</td>
        <td>${escapeHtml(slot && slot.modelDirection ? slot.modelDirection : 'missing')}</td>
        <td>${escapeHtml(money(slot && slot.modelPrediction))}</td>
        <td>${escapeHtml(money(slot && slot.naivePrediction))}</td>
        <td>${escapeHtml(money(slot && slot.actualPrice))}</td>
        <td>${escapeHtml(money(slot && slot.modelError))}</td>
        <td>${escapeHtml(money(slot && slot.naiveError))}</td>
      </tr>`;
    }).join('');
    return `
      <h3>Evaluation — ${escapeHtml(symbol)} ${badgeHtml('TRACKING')}</h3>
      <p>Baseline ${escapeHtml(money(evaluation.baselinePrice))} at ${escapeHtml(evaluation.startDate || when(evaluation.baselineTimestamp))}
      · mark ${escapeHtml(money(evaluation.markPrice))}
      · actual forward P&amp;L ${escapeHtml(signedPct(evaluation.actualReturnPct))}
      · status ${escapeHtml(evaluation.status || 'missing')}</p>
      <table class="scanner-eval-table">
        <thead><tr><th>Horizon</th><th>Model dir</th><th>Model</th><th>Naive</th><th>Actual</th><th>Model err</th><th>Naive err</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="scanner-muted">Forecasts are made at the frozen baseline bar (no lookahead). Research only.</p>
    `;
  }

  flipsHtml(history, symbol) {
    if (!symbol) {
      return `<h3>Flip history</h3><p class="scanner-muted">Select a row to see consensus/direction flips.</p>`;
    }
    if (!history || !history.length) {
      return `<h3>Flip history — ${escapeHtml(symbol)}</h3><p class="scanner-muted">No flips recorded. Missing, not a fabricated flat line.</p>`;
    }
    const items = history.slice().reverse().map((flip) => (
      `<li><strong>${escapeHtml(when(flip.at))}</strong> ${escapeHtml(flip.source || '')}: ${escapeHtml(flip.prior)} → ${escapeHtml(flip.next)}</li>`
    )).join('');
    return `<h3>Flip history — ${escapeHtml(symbol)}</h3><ul class="scanner-flip-list">${items}</ul>`;
  }
}
