import { formatMissing } from './lots.js';
import { formatMarkerDetail } from './markers.js';
import { trackingForwardPerformance } from './tracking.js';

const PRIVACY_TEXT = 'This file stays in this browser / local store and is not transmitted. Scoreboard never uploads your brokerage CSV. The server does not receive the raw file.';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badgeHtml(kind) {
  const cls = kind === 'TRACKING' ? 'badge-tracking' : 'badge-real';
  return `<span class="inv-badge ${cls}">${kind}</span>`;
}

function money(value) {
  return formatMissing(value, (n) => {
    const sign = n < 0 ? '-' : '';
    return `${sign}$${Math.abs(n).toFixed(2)}`;
  });
}

function pct(value) {
  return formatMissing(value, (n) => `${(n * 100).toFixed(2)}%`);
}

function eventRow(event) {
  const flags = [];
  if (event.flags && event.flags.missingPrice) flags.push('missing-price');
  if (event.flags && event.flags.missingQuantity) flags.push('missing-qty');
  if (event.flags && event.flags.unsupported) flags.push('unsupported');
  if (event.flags && event.flags.needsExplicitMapping) flags.push('needs-mapping');
  if (event.flags && event.flags.noFillInferred && (event.activityType === 'buy' || event.activityType === 'sell')) {
    flags.push('no-fill');
  }
  return `<tr>
    <td>${escapeHtml(event.activityDate || 'missing')}</td>
    <td>${escapeHtml(event.activityType)}</td>
    <td>${escapeHtml(event.symbol || 'missing')}</td>
    <td>${event.quantity == null ? 'missing' : escapeHtml(event.quantity)}</td>
    <td>${event.price == null ? 'missing' : escapeHtml(event.price)}</td>
    <td>${event.amount == null ? 'missing' : escapeHtml(event.amount)}</td>
    <td>${event.commission == null ? 'missing' : escapeHtml(event.commission)}</td>
    <td>${badgeHtml(event.badge)}</td>
    <td>${flags.map((f) => `<span class="inv-flag">${escapeHtml(f)}</span>`).join(' ')}</td>
  </tr>`;
}

function pnlCard(title, badge, bucket) {
  return `<section class="inv-pnl">
    <h4>${escapeHtml(title)} ${badgeHtml(badge)}</h4>
    <dl>
      <div><dt>Realized P&amp;L</dt><dd>${money(bucket.realizedPnl)}</dd></div>
      <div><dt>Unrealized P&amp;L</dt><dd>${money(bucket.unrealizedPnl)}</dd></div>
      <div><dt>Cost basis</dt><dd>${money(bucket.costBasis)}</dd></div>
      <div><dt>Return</dt><dd>${pct(bucket.returnPct)}</dd></div>
      <div><dt>Dividends</dt><dd>${money(bucket.dividendsTotal)}</dd></div>
      <div><dt>Drawdown</dt><dd>${pct(bucket.drawdownPct)}</dd></div>
    </dl>
    ${bucket.positions.length ? `<table class="inv-table"><thead><tr><th>Symbol</th><th>Qty</th><th>Basis</th><th>Mark</th><th>Unrealized</th></tr></thead><tbody>
      ${bucket.positions.map((p) => `<tr>
        <td>${escapeHtml(p.symbol)}</td>
        <td>${p.quantity == null ? 'missing' : escapeHtml(p.quantity)}</td>
        <td>${money(p.costBasis)}</td>
        <td>${p.markPrice == null ? 'missing' : money(p.markPrice)}</td>
        <td>${money(p.unrealizedPnl)}</td>
      </tr>`).join('')}
    </tbody></table>` : '<p class="inv-muted">No open lots.</p>'}
    ${bucket.skipped.length ? `<details class="inv-skipped"><summary>${bucket.skipped.length} marked events (no fill inferred)</summary>
      <ul>${bucket.skipped.map((s) => `<li>${escapeHtml(s.event.activityDate || 'missing')} ${escapeHtml(s.event.activityType)} ${escapeHtml(s.event.symbol || 'missing')} — ${escapeHtml(s.reason)}</li>`).join('')}</ul>
    </details>` : ''}
  </section>`;
}

export class InvestmentsView {
  constructor(rootId = 'investments') {
    this.root = document.getElementById(rootId);
  }

  privacyBanner() {
    return `<aside class="inv-privacy" role="note">
      <strong>Privacy:</strong> ${escapeHtml(PRIVACY_TEXT)}
    </aside>`;
  }

  renderEmpty() {
    if (!this.root) return;
    this.root.innerHTML = `
      ${this.privacyBanner()}
      <section class="inv-empty" id="inv-empty-state">
        <h2>Investments</h2>
        <p>No imported holdings yet. Import history first — never overwrite REAL positions from a screenshot.</p>
        <label class="inv-file-label">
          Import Activity CSV
          <input type="file" id="inv-file-input" accept=".csv,text/csv,text/plain" />
        </label>
      </section>
      <div id="inv-preview" class="hidden"></div>
      <div id="inv-workspace"></div>
    `;
  }

  renderPreview(preview) {
    const el = document.getElementById('inv-preview');
    if (!el) return;
    const errorList = preview.errors.map((e) => `<li class="inv-error">${escapeHtml(e)}</li>`).join('');
    const warnList = preview.warnings.map((w) => `<li class="inv-warn">${escapeHtml(w)}</li>`).join('');
    el.classList.remove('hidden');
    el.innerHTML = `
      <h3>Import preview</h3>
      <p class="inv-muted">Nothing has been saved yet. Review validation, then commit. File stays local.</p>
      ${errorList ? `<ul class="inv-messages">${errorList}</ul>` : ''}
      ${warnList ? `<ul class="inv-messages">${warnList}</ul>` : ''}
      <div class="inv-table-wrap">
        <table class="inv-table">
          <thead><tr><th>Date</th><th>Type</th><th>Symbol</th><th>Qty</th><th>Price</th><th>Amount</th><th>Comm</th><th>Badge</th><th>Flags</th></tr></thead>
          <tbody>${preview.events.map(eventRow).join('')}</tbody>
        </table>
      </div>
      <div class="inv-actions">
        <button type="button" id="inv-commit-btn" ${preview.canCommit ? '' : 'disabled'}>Commit import</button>
        <button type="button" id="inv-cancel-preview-btn" class="inv-secondary">Cancel</button>
      </div>
    `;
  }

  hidePreview() {
    const el = document.getElementById('inv-preview');
    if (!el) return;
    el.classList.add('hidden');
    el.innerHTML = '';
  }

  renderWorkspace(model) {
    const el = document.getElementById('inv-workspace');
    if (!el) return;
    const { storeState, pnl, markPrices } = model;
    const events = storeState.collections.events;
    const paper = storeState.collections.paperTrades;
    const tracking = storeState.collections.tracking;
    const maps = storeState.collections.symbolMaps;
    const hasAnything = events.length + paper.length + tracking.length > 0;

    const emptyNote = document.getElementById('inv-empty-state');
    if (emptyNote) emptyNote.classList.toggle('hidden', hasAnything);

    const trackingRows = tracking.map((record) => {
      const perf = trackingForwardPerformance(record, markPrices && markPrices[record.symbol]);
      return `<tr>
        <td>${escapeHtml(record.symbol)}</td>
        <td>${escapeHtml(record.startDate)}</td>
        <td>${record.baselinePrice == null ? 'missing' : escapeHtml(record.baselinePrice)}</td>
        <td>${escapeHtml(record.status)}</td>
        <td>${record.stopDate || '—'}</td>
        <td>${pct(perf.returnPct)}</td>
        <td>${badgeHtml('TRACKING')}</td>
        <td>${record.status === 'active' ? `<button type="button" class="inv-stop-btn" data-track-id="${escapeHtml(record.id)}">Stop</button>` : 'history kept'}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <section class="inv-toolbar">
        <label>Cost method
          <select id="inv-cost-method">
            <option value="fifo" ${storeState.collections.settings.costMethod === 'fifo' ? 'selected' : ''}>FIFO</option>
            <option value="average" ${storeState.collections.settings.costMethod === 'average' ? 'selected' : ''}>Average cost</option>
          </select>
        </label>
        <button type="button" id="inv-export-json-btn">Export JSON</button>
        <button type="button" id="inv-export-csv-btn">Export CSV</button>
      </section>

      <section class="inv-section inv-real">
        <h3>REAL holdings ${badgeHtml('REAL')}</h3>
        <p class="inv-muted">Confirmed imported transactions. P&amp;L is not mixed with TRACKING.</p>
        ${pnlCard('REAL P&L', 'REAL', pnl.REAL)}
        <div class="inv-table-wrap">
          <table class="inv-table">
            <thead><tr><th>Date</th><th>Type</th><th>Symbol</th><th>Qty</th><th>Price</th><th>Amount</th><th>Comm</th><th>Badge</th><th>Flags</th></tr></thead>
            <tbody>${events.length ? events.map(eventRow).join('') : '<tr><td colspan="9">No REAL transactions yet.</td></tr>'}</tbody>
          </table>
        </div>
      </section>

      <section class="inv-section inv-tracking">
        <h3>TRACKING ${badgeHtml('TRACKING')}</h3>
        <p class="inv-muted">Watchlist / paper marks only. Never mixed into REAL P&amp;L.</p>
        ${pnlCard('TRACKING P&L', 'TRACKING', pnl.TRACKING)}

        <h4>Paper BUY / SELL</h4>
        <form id="inv-paper-form" class="inv-form">
          <label>Symbol <input name="symbol" required /></label>
          <label>Date <input name="date" type="date" required /></label>
          <label>Side
            <select name="side"><option value="BUY">BUY</option><option value="SELL">SELL</option></select>
          </label>
          <label>Qty <input name="quantity" type="number" step="any" required /></label>
          <label>Price <input name="price" type="number" step="any" required /></label>
          <label>Fee <input name="commission" type="number" step="any" /></label>
          <label>Note <input name="note" /></label>
          <button type="submit">Add paper trade</button>
        </form>
        <div class="inv-table-wrap">
          <table class="inv-table">
            <thead><tr><th>Date</th><th>Side</th><th>Symbol</th><th>Qty</th><th>Price</th><th>Badge</th></tr></thead>
            <tbody>${paper.length ? paper.map((t) => `<tr>
              <td>${escapeHtml(t.date)}</td>
              <td>${escapeHtml(t.side)}</td>
              <td>${escapeHtml(t.symbol)}</td>
              <td>${t.quantity == null ? 'missing' : escapeHtml(t.quantity)}</td>
              <td>${t.price == null ? 'missing' : escapeHtml(t.price)}</td>
              <td>${badgeHtml('TRACKING')}</td>
            </tr>`).join('') : '<tr><td colspan="6">No paper trades.</td></tr>'}</tbody>
          </table>
        </div>

        <h4>Start / stop tracking</h4>
        <form id="inv-track-form" class="inv-form">
          <label>Symbol <input name="symbol" required /></label>
          <label>Start date <input name="startDate" type="date" required /></label>
          <label>Baseline price <input name="baselinePrice" type="number" step="any" required /></label>
          <button type="submit">Start tracking</button>
        </form>
        <div class="inv-table-wrap">
          <table class="inv-table">
            <thead><tr><th>Symbol</th><th>Start</th><th>Baseline</th><th>Status</th><th>Stopped</th><th>Return</th><th>Badge</th><th></th></tr></thead>
            <tbody>${trackingRows || '<tr><td colspan="8">No tracking records.</td></tr>'}</tbody>
          </table>
        </div>
      </section>

      <section class="inv-section">
        <h3>Explicit symbol maps</h3>
        <p class="inv-muted">Required for exchanges, ticker changes, ETFs, and options. No automatic inference.</p>
        <form id="inv-map-form" class="inv-form">
          <label>From symbol <input name="fromSymbol" /></label>
          <label>To symbol <input name="toSymbol" /></label>
          <label>From CUSIP <input name="fromCusip" /></label>
          <label>To CUSIP <input name="toCusip" /></label>
          <label>Reason <input name="reason" /></label>
          <button type="submit">Add mapping</button>
        </form>
        <ul class="inv-maps">${maps.length ? maps.map((m) => `<li>${escapeHtml(m.fromSymbol || m.fromCusip)} → ${escapeHtml(m.toSymbol || m.toCusip)} ${badgeHtml('REAL')}</li>`).join('') : '<li>No maps yet.</li>'}</ul>
      </section>
    `;
  }

  render(model) {
    if (!this.root) return;
    if (!document.getElementById('inv-file-input')) {
      this.renderEmpty();
    }
    this.renderWorkspace(model);
  }
}

export function renderInvestmentDetail(marker) {
  const strip = document.getElementById('investment-detail-strip');
  if (!strip || !marker) return;
  const detail = formatMarkerDetail(marker);
  strip.innerHTML = `<div class="day-strip-title">${escapeHtml(detail.title)}</div>${
    detail.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')
  }`;
  strip.classList.remove('hidden');
}

export { PRIVACY_TEXT };
