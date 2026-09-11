import { formatMissing } from './lots.js';
import { formatMarkerDetail } from './markers.js';
import { todayIsoDate } from './tracking.js';
import { buildWatchRows } from './watch.js';
import { defaultInstrumentClass, suggestedEtfTickers } from './instrument.js';

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
  if (event.needsInstrumentClass) flags.push('pick-venue');
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

function zoneCell(row) {
  if (row.zonePending || row.mark == null || row.target == null) {
    return '<span class="inv-muted" title="Need Price and target to compute zone">—</span>';
  }
  if (!row.inZone || !row.zoneBadge) {
    return '<span class="inv-muted">—</span>';
  }
  const cls = row.zone === 'buy' ? 'inv-zone-buy' : 'inv-zone-sell';
  return `<span class="inv-zone-badge ${cls}">${escapeHtml(row.zoneBadge)}</span>`;
}

function targetCell(row) {
  if (row.target == null) return 'missing';
  if (row.targetHigh != null) return `${escapeHtml(row.target)}–${escapeHtml(row.targetHigh)}`;
  return escapeHtml(row.target);
}

function priceCell(row) {
  if (row.mark == null) {
    return `<span class="inv-muted">missing</span>`;
  }
  const asOf = row.markAsOf ? `<div class="inv-asof">as of ${escapeHtml(row.markAsOf)}</div>` : '';
  return `<div>${money(row.mark)}</div>${asOf}`;
}

function venuePicker(row) {
  if (!row.needsInstrumentClass) return '';
  const suggestions = suggestedEtfTickers(row.symbol).join(', ');
  return `<form class="inv-class-form inv-inline-form" data-track-id="${escapeHtml(row.id)}">
    <input type="hidden" name="symbol" value="${escapeHtml(row.listedSymbol || row.symbol)}" />
    <label>Venue
      <select name="assetClass">
        <option value="crypto">coin (OKX)</option>
        <option value="etf" selected>ETF (Yahoo)</option>
        <option value="equity">equity</option>
      </select>
    </label>
    <label>Yahoo ticker
      <input name="yahooTicker" placeholder="${escapeHtml(suggestions)}" />
    </label>
    <button type="submit">Use this venue</button>
  </form>
  <p class="inv-muted">Do not silently use coin spot vs an ETF cost. Pick IBIT/FBTC/ETHA/… or coin.</p>`;
}

function fillSubRows(row) {
  const fills = row.fills || [];
  const editor = `<tr class="inv-fill-editor hidden" id="inv-fill-editor-${escapeHtml(row.id)}">
    <td colspan="8">
      <form class="inv-row-fill-form inv-inline-form" data-track-id="${escapeHtml(row.id)}">
        <strong class="inv-fill-side-label">Bought</strong>
        <input type="hidden" name="side" value="BUY" />
        <label>Qty <input name="quantity" type="number" step="any" placeholder="1" /></label>
        <label>Price <input name="price" type="number" step="any" value="${row.mark == null ? '' : escapeHtml(row.mark)}" /></label>
        <label>Date <input name="date" type="date" value="${escapeHtml(todayIsoDate())}" /></label>
        <button type="submit">Save fill</button>
      </form>
    </td>
  </tr>`;
  if (!fills.length) {
    return `${editor}`;
  }
  const body = fills.map((fill) => `<tr class="inv-fill-sub" data-parent-id="${escapeHtml(row.id)}" data-fill-id="${escapeHtml(fill.id || '')}">
    <td class="inv-fill-indent">${escapeHtml(fill.date || 'missing')}</td>
    <td>${escapeHtml(fill.side)}</td>
    <td>${fill.quantity == null ? 'missing' : escapeHtml(fill.quantity)}</td>
    <td>${money(fill.price)}</td>
    <td class="${signedClass(fill.vsDollar)}">${money(fill.vsDollar)}</td>
    <td class="${signedClass(fill.vsPct)}">${pct(fill.vsPct)}</td>
    <td colspan="2">
      <span class="inv-muted">${escapeHtml(fill.source || 'watch')}</span>
      ${fill.id ? `<button type="button" class="inv-edit-fill-btn" data-fill-id="${escapeHtml(fill.id)}" data-track-id="${escapeHtml(row.id)}">Edit cost</button>` : ''}
    </td>
  </tr>`).join('');
  return `${editor}
    <tr class="inv-fill-head" data-parent-id="${escapeHtml(row.id)}">
      <td colspan="8">
        <details class="inv-fill-details" open>
          <summary>${fills.length} fill${fills.length === 1 ? '' : 's'} for ${escapeHtml(row.label)}</summary>
        </details>
      </td>
    </tr>
    <tr class="inv-fill-cols" data-parent-id="${escapeHtml(row.id)}">
      <th class="inv-fill-indent">Date</th><th>Side</th><th>Qty</th><th>Fill price</th><th>$ vs Price</th><th>% vs Price</th><th colspan="2"></th>
    </tr>
    ${body}`;
}

function watchRowActions(row) {
  const id = escapeHtml(row.id || '');
  return `<div class="inv-row-actions">
    <button type="button" class="inv-fill-toggle" data-side="BUY" data-track-id="${id}">Bought</button>
    <button type="button" class="inv-fill-toggle" data-side="SELL" data-track-id="${id}">Sold</button>
    <button type="button" class="inv-edit-entry-btn" data-track-id="${id}">Edit cost</button>
    <button type="button" class="inv-remove-btn" data-track-id="${id}" data-real="${row.hasRealLot ? '1' : '0'}">Remove</button>
  </div>`;
}

function entryCell(row) {
  if (row.entry == null) return '<span class="inv-muted">missing</span>';
  if (row.entryKind === 'cost') {
    const basis = row.costBasis != null
      ? `<div class="inv-muted">remaining · ${money(row.costBasis)}</div>`
      : '<div class="inv-muted">remaining</div>';
    return `<div>${money(row.entry)}</div>${basis}`;
  }
  return `<div>${money(row.entry)}</div><div class="inv-muted">start mark</div>`;
}

function pctCell(row) {
  const unrealized = row.hasRealLot && row.unrealizedPnl != null
    ? `<div class="inv-muted">${money(row.unrealizedPnl)}</div>`
    : '';
  return `<div class="${signedClass(row.returnPct)}">${pct(row.returnPct)}</div>${unrealized}`;
}

function watchRowHtml(row) {
  const pin = row.inZone ? 'inv-row-inzone' : '';
  return `<tr class="${pin}" data-watch-id="${escapeHtml(row.id || '')}" data-in-zone="${row.inZone ? '1' : '0'}" data-asset-class="${escapeHtml(row.assetClass || '')}">
    <td>
      <div class="inv-instrument">${escapeHtml(row.label)}</div>
      ${venuePicker(row)}
    </td>
    <td>${escapeHtml(row.startDate || 'missing')}</td>
    <td>${entryCell(row)}</td>
    <td>${priceCell(row)}</td>
    <td>${pctCell(row)}</td>
    <td>${targetCell(row)}</td>
    <td>${zoneCell(row)}</td>
    <td>${watchRowActions(row)}</td>
  </tr>
  ${fillSubRows(row)}`;
}

function realPositionRow(position, zone) {
  const inZone = Boolean(zone && zone.inZone);
  const label = position.yahooTicker || position.symbol;
  const venue = position.assetClass === 'etf' ? 'ETF' : (position.assetClass === 'crypto' ? 'coin' : 'equity');
  return `<tr class="${inZone ? 'inv-row-inzone' : ''}" data-real-symbol="${escapeHtml(position.symbol)}">
    <td>${escapeHtml(label)} <span class="inv-muted">· ${escapeHtml(venue)}</span></td>
    <td>${position.quantity == null ? 'missing' : escapeHtml(position.quantity)}</td>
    <td>${money(position.costBasis)}</td>
    <td>${position.markPrice == null ? 'missing' : money(position.markPrice)}</td>
    <td class="${signedClass(position.unrealizedPnl)}">${money(position.unrealizedPnl)}</td>
    <td class="${signedClass(position.unrealizedPct)}">${pct(position.unrealizedPct)}</td>
    <td>${zone ? zoneCell(zone) : '<span class="inv-muted">—</span>'}</td>
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
  const markMeta = model.markMeta || {};
  const markStatus = model.markStatus || '';
  const realPositions = (pnl.REAL && pnl.REAL.positions) || [];
  const watchRows = buildWatchRows({
    tracking,
    realPositions,
    markPrices,
    markMeta,
    events,
    costMethod: settings.costMethod || 'fifo'
  });
  const zoneBySymbol = {};
  for (const row of watchRows) {
    if (row.markSymbol) zoneBySymbol[row.markSymbol] = row;
    if (row.symbol) zoneBySymbol[row.symbol] = row;
  }
  const today = todayIsoDate(now);
  const hasAnything = events.length + paper.length + tracking.length > 0;
  void hasAnything;

  return `
      <section class="inv-watch" id="inv-watch" data-primary-view="watchlist">
        <h2>Watch / Track</h2>
        <p class="inv-muted">Rows for deciding <strong>open vs close</strong>. Pick instrument class after the ticker (crypto / ETF / equity). Same ticker can exist twice if class differs. Refresh loads Price from Yahoo (etf/equity) or OKX (coin). Prices are never invented.</p>
        <form id="inv-watch-form" class="inv-form">
          <label>Symbol <input name="symbol" required placeholder="CDNS, IBIT, or BTC" autocomplete="off" spellcheck="false" /></label>
          <label>Class
            <select name="assetClass" id="inv-asset-class">
              <option value="crypto">crypto (OKX coin)</option>
              <option value="etf">ETF (Yahoo)</option>
              <option value="equity" selected>equity (Yahoo)</option>
            </select>
          </label>
          <label id="inv-yahoo-wrap" class="hidden">Yahoo ticker
            <input name="yahooTicker" list="inv-etf-suggestions" placeholder="IBIT, FBTC, ETHA, FETH…" />
            <datalist id="inv-etf-suggestions">
              <option value="IBIT"></option><option value="FBTC"></option><option value="BITB"></option>
              <option value="ARKB"></option><option value="GBTC"></option>
              <option value="ETHA"></option><option value="FETH"></option><option value="ETHE"></option>
            </datalist>
            <span class="inv-muted" id="inv-yahoo-help">Required for ETF. Coin spot is not used.</span>
          </label>
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
                <th>Entry</th>
                <th>Price</th>
                <th>%</th>
                <th>Target</th>
                <th>Zone</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${watchRows.length
              ? watchRows.map(watchRowHtml).join('')
              : '<tr><td colspan="8">No watch rows yet. Add a symbol + target above.</td></tr>'}</tbody>
          </table>
        </div>
      </section>

      <section class="inv-section inv-real" id="inv-real-positions">
        <h3>REAL positions ${badgeHtml('REAL')}</h3>
        <p class="inv-muted">Imported E*TRADE lots — distinct from paper / watch. Cost basis comes from fill Price or the Cost Basis column. Mark uses the live ingest Price, not the CSV last price as cost. Remove a lot from its watch row.</p>
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
              ? realPositions.map((p) => realPositionRow(p, zoneBySymbol[p.markSymbol || p.symbol])).join('')
              : '<tr><td colspan="8">No REAL lots. Import an Activity or Positions CSV below.</td></tr>'}</tbody>
          </table>
        </div>
      </section>

      <section class="inv-import-tools">
        <h3>Import REAL lots</h3>
        <p class="inv-muted">Browser FileReader only. Activity fills or Positions snapshots (Cost Basis / Average Cost). Never uploaded. Listed tickers (IBIT, ETHA, …) stay ETF/equity — they are not rewritten to OKX BTC/ETH.</p>
        <label class="inv-file-label">
          Import Activity / Positions CSV
          <input type="file" id="inv-file-input" accept=".csv,text/csv,text/plain" />
        </label>
      </section>

      <details class="inv-ledger" id="inv-ledger">
        <summary>Fills / ledger (hidden by default)</summary>
        <p class="inv-muted">Global dump — not the primary view. Per-symbol history lives under each watch row. REAL vs TRACKING stay separate.</p>
        <div class="inv-table-wrap">
          <table class="inv-table" id="inv-ledger-table">
            <thead><tr><th>Date</th><th>Type</th><th>Symbol</th><th>Qty</th><th>Price</th><th>Amount</th><th>Comm</th><th>Badge</th><th>Flags</th></tr></thead>
            <tbody>${events.length ? events.map(eventRow).join('') : '<tr><td colspan="9">No REAL transactions yet.</td></tr>'}</tbody>
          </table>
        </div>
      </details>

      <details class="inv-advanced" id="inv-paper-details">
        <summary>Paper BUY / SELL ${badgeHtml('TRACKING')}</summary>
        <p class="inv-muted">Prefer <strong>Bought / Sold</strong> on a watch row. This form stays as a fallback. Paper fills stay TRACKING.</p>
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
        <p class="inv-muted">Required for exchanges, ticker changes, and options. ETF lots keep their listed ticker even if a map points at BTC/ETH.</p>
        <form id="inv-map-form" class="inv-form">
          <label>From symbol <input name="fromSymbol" /></label>
          <label>To symbol <input name="toSymbol" /></label>
          <label>From CUSIP <input name="fromCusip" /></label>
          <label>To CUSIP <input name="toCusip" /></label>
          <label>Reason <input name="reason" /></label>
          <button type="submit">Add mapping</button>
        </form>
        <ul class="inv-maps">${maps.length ? maps.map((m) => `<li>${escapeHtml(m.fromSymbol || m.fromCusip)} → ${escapeHtml(m.toSymbol || m.toCusip)} ${badgeHtml('REAL')}</li>`).join('') : '<li>No maps yet.</li>'}</ul>
      </details>`;
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

export { PRIVACY_TEXT, defaultInstrumentClass };
