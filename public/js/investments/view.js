import { formatMissing } from './lots.js';
import { formatMarkerDetail } from './markers.js';
import { todayIsoDate } from './tracking.js';
import { buildWatchRows } from './watch.js';

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

function signedClass(value) {
  if (!Number.isFinite(value) || value === 0) return '';
  return value > 0 ? 'inv-gain' : 'inv-loss';
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

function zoneBadge(row) {
  if (!row.inZone || !row.zoneBadge) return '<span class="inv-muted">—</span>';
  const cls = row.zone === 'buy' ? 'inv-zone-buy' : 'inv-zone-sell';
  return `<span class="inv-zone-badge ${cls}">${escapeHtml(row.zoneBadge)}</span>`;
}

function targetCell(row) {
  if (row.target == null) return 'missing';
  if (row.targetHigh != null) return `${escapeHtml(row.target)}–${escapeHtml(row.targetHigh)}`;
  return escapeHtml(row.target);
}

function watchRowHtml(row) {
  const pin = row.inZone ? 'inv-row-inzone' : '';
  const entryLabel = row.entryKind === 'cost' ? 'cost' : 'start mark';
  return `<tr class="${pin}" data-watch-id="${escapeHtml(row.id || '')}" data-in-zone="${row.inZone ? '1' : '0'}">
    <td>${escapeHtml(row.symbol || 'missing')}</td>
    <td>${escapeHtml(row.startDate || 'missing')}</td>
    <td>${row.entry == null ? 'missing' : `${money(row.entry)} <span class="inv-muted">(${escapeHtml(entryLabel)})</span>`}</td>
    <td>${row.mark == null ? 'missing' : money(row.mark)}</td>
    <td class="${signedClass(row.returnPct)}">${pct(row.returnPct)}</td>
    <td>${targetCell(row)}</td>
    <td>${zoneBadge(row)}</td>
    <td>${badgeHtml('TRACKING')}</td>
    <td>${row.status === 'active'
      ? `<button type="button" class="inv-stop-btn" data-track-id="${escapeHtml(row.id)}">Stop</button>`
      : 'history kept'}</td>
  </tr>`;
}

function realPositionRow(position, zone) {
  const inZone = Boolean(zone && zone.inZone);
  return `<tr class="${inZone ? 'inv-row-inzone' : ''}" data-real-symbol="${escapeHtml(position.symbol)}">
    <td>${escapeHtml(position.symbol)}</td>
    <td>${position.quantity == null ? 'missing' : escapeHtml(position.quantity)}</td>
    <td>${money(position.costBasis)}</td>
    <td>${position.markPrice == null ? 'missing' : money(position.markPrice)}</td>
    <td class="${signedClass(position.unrealizedPnl)}">${money(position.unrealizedPnl)}</td>
    <td class="${signedClass(position.unrealizedPct)}">${pct(position.unrealizedPct)}</td>
    <td>${zone ? zoneBadge(zone) : '<span class="inv-muted">—</span>'}</td>
    <td>${badgeHtml('REAL')}</td>
  </tr>`;
}

export function renderWorkspaceHtml(model = {}, now = new Date()) {
  const storeState = model.storeState || { collections: {} };
  const collections = storeState.collections || {};
  const events = collections.events || [];
  const paper = collections.paperTrades || [];
  const tracking = collections.tracking || [];
  const maps = collections.symbolMaps || [];
  const settings = collections.settings || { costMethod: 'fifo' };
  const pnl = model.pnl || { REAL: { positions: [] }, TRACKING: { positions: [] } };
  const markPrices = model.markPrices || {};
  const markStatus = model.markStatus || '';
  const realPositions = (pnl.REAL && pnl.REAL.positions) || [];
  const watchRows = buildWatchRows({
    tracking,
    realPositions,
    markPrices
  });
  const zoneBySymbol = {};
  for (const row of watchRows) {
    if (row.symbol) zoneBySymbol[row.symbol] = row;
  }
  const today = todayIsoDate(now);
  const hasAnything = events.length + paper.length + tracking.length > 0;

  return `
      <section class="inv-watch" id="inv-watch" data-primary-view="watchlist">
        <h2>Watch / Track ${badgeHtml('TRACKING')}</h2>
        <p class="inv-muted">Rows for deciding <strong>open vs close</strong>. Add a symbol + target. Refresh loads the live mark from the same Yahoo / OKX ingest as Overview. Prices are never invented.</p>
        <form id="inv-watch-form" class="inv-form">
          <label>Symbol <input name="symbol" required placeholder="CDNS or BTC" autocomplete="off" spellcheck="false" /></label>
          <label>Target <input name="targetPrice" type="number" step="any" required /></label>
          <label>Target to <span class="inv-muted">(optional range)</span>
            <input name="targetHigh" type="number" step="any" />
          </label>
          <label>Direction
            <select name="direction">
              <option value="long" selected>Long / call / buy</option>
              <option value="short">Short / put / sell</option>
            </select>
          </label>
          <label>Start date <input name="startDate" type="date" value="${escapeHtml(today)}" required /></label>
          <label>Entry / start mark <span class="inv-muted">(optional)</span>
            <input name="baselinePrice" type="number" step="any" placeholder="freeze on refresh" />
          </label>
          <button type="submit">Add to watch</button>
        </form>
        <div class="inv-toolbar">
          <button type="button" id="inv-refresh-marks-btn">Refresh prices</button>
          <p class="inv-muted" id="inv-mark-status">${escapeHtml(markStatus)}</p>
        </div>
        <div class="inv-table-wrap">
          <table class="inv-table" id="inv-watch-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Start</th>
                <th>Entry / start mark</th>
                <th>Live mark</th>
                <th>%</th>
                <th>Target</th>
                <th>Zone</th>
                <th>Badge</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${watchRows.length
              ? watchRows.map(watchRowHtml).join('')
              : '<tr><td colspan="9">No watch rows yet. Add a symbol + target above.</td></tr>'}</tbody>
          </table>
        </div>
      </section>

      <section class="inv-section inv-real" id="inv-real-positions">
        <h3>REAL positions ${badgeHtml('REAL')}</h3>
        <p class="inv-muted">Imported E*TRADE lots — distinct from paper / watch. Cost basis comes from fill Price or the Cost Basis column. Mark and unrealized use the live ingest mark, not the CSV last price as cost.</p>
        <div class="inv-table-wrap">
          <table class="inv-table" id="inv-real-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Qty</th>
                <th>Cost</th>
                <th>Mark</th>
                <th>Unrealized $</th>
                <th>%</th>
                <th>Zone</th>
                <th>Badge</th>
              </tr>
            </thead>
            <tbody>${realPositions.length
              ? realPositions.map((p) => realPositionRow(p, zoneBySymbol[p.symbol])).join('')
              : '<tr><td colspan="8">No REAL lots. Import an Activity or Positions CSV below.</td></tr>'}</tbody>
          </table>
        </div>
      </section>

      <section class="inv-import-tools">
        <h3>Import REAL lots</h3>
        <p class="inv-muted">Browser FileReader only. Activity fills or Positions snapshots (Cost Basis / Average Cost). Never uploaded.</p>
        <label class="inv-file-label">
          Import Activity / Positions CSV
          <input type="file" id="inv-file-input" accept=".csv,text/csv,text/plain" />
        </label>
      </section>

      <details class="inv-ledger" id="inv-ledger">
        <summary>Fills / ledger (hidden by default)</summary>
        <p class="inv-muted">Transaction dump — not the primary view. REAL vs TRACKING stay separate.</p>
        <div class="inv-table-wrap">
          <table class="inv-table" id="inv-ledger-table">
            <thead><tr><th>Date</th><th>Type</th><th>Symbol</th><th>Qty</th><th>Price</th><th>Amount</th><th>Comm</th><th>Badge</th><th>Flags</th></tr></thead>
            <tbody>${events.length ? events.map(eventRow).join('') : '<tr><td colspan="9">No REAL transactions yet.</td></tr>'}</tbody>
          </table>
        </div>
      </details>

      <details class="inv-advanced" id="inv-paper-details">
        <summary>Paper BUY / SELL ${badgeHtml('TRACKING')}</summary>
        <p class="inv-muted">Paper fills stay TRACKING. Never mixed into REAL P&amp;L.</p>
        <form id="inv-paper-form" class="inv-form">
          <label>Symbol <input name="symbol" required /></label>
          <label>Date <input name="date" type="text" placeholder="YYYY-MM-DD" required /></label>
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
      </details>

      <details class="inv-advanced" id="inv-tools-details">
        <summary>Cost method, maps, export</summary>
        <section class="inv-toolbar">
          <label>Cost method
            <select id="inv-cost-method">
              <option value="fifo" ${settings.costMethod === 'fifo' ? 'selected' : ''}>FIFO</option>
              <option value="average" ${settings.costMethod === 'average' ? 'selected' : ''}>Average cost</option>
            </select>
          </label>
          <button type="button" id="inv-export-json-btn">Export JSON</button>
          <button type="button" id="inv-export-csv-btn">Export CSV</button>
        </section>
        <h4>Explicit symbol maps</h4>
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
      </details>
      ${hasAnything ? '' : ''}`;
}

export function isPrimaryViewWatchlist(html) {
  const text = String(html || '');
  const watchIdx = text.indexOf('id="inv-watch-table"');
  const ledgerIdx = text.indexOf('id="inv-ledger"');
  const hasDetailsLedger = /<details[^>]*id="inv-ledger"/.test(text)
    || /<details[^>]*class="[^"]*inv-ledger/.test(text);
  const realTable = text.indexOf('id="inv-real-table"');
  return watchIdx >= 0
    && ledgerIdx >= 0
    && watchIdx < ledgerIdx
    && hasDetailsLedger
    && /data-primary-view="watchlist"/.test(text)
    && realTable > watchIdx
    && text.includes('Unrealized $');
}

export class InvestmentsView {
  constructor(rootId = 'investments') {
    this.root = typeof document !== 'undefined' ? document.getElementById(rootId) : null;
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
        <h2>Watch / Track</h2>
        <p>Add a symbol + target to watch for an open or close. Import REAL lots from an E*TRADE Activity or Positions CSV — the file stays in this browser.</p>
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
      <p class="inv-muted">Nothing has been saved yet. Review validation, then commit. File stays local.${
        preview.kind ? ` Detected: ${escapeHtml(preview.kind)}.` : ''
      }</p>
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
    el.innerHTML = renderWorkspaceHtml(model);
    const storeState = model.storeState || { collections: {} };
    const collections = storeState.collections || {};
    const hasAnything = (collections.events || []).length
      + (collections.paperTrades || []).length
      + (collections.tracking || []).length > 0;
    const emptyNote = document.getElementById('inv-empty-state');
    if (emptyNote) emptyNote.classList.toggle('hidden', hasAnything);
  }

  render(model) {
    if (!this.root) return;
    if (!document.getElementById('inv-workspace')) {
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
