function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 1000) return `$${value.toFixed(0)}`;
  if (abs >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(6)}`;
}

function formatMae(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return formatMoney(value);
}

function formatPct(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(1)}%`;
}

function statusClass(status) {
  if (status === 'matured') return 'fc-status-matured';
  if (status === 'missing-actual') return 'fc-status-missing';
  return 'fc-status-early';
}

export class ForecastsView {
  constructor(rootId = 'forecast') {
    this.root = typeof document !== 'undefined' ? document.getElementById(rootId) : null;
  }

  render(model) {
    if (!this.root) return;
    const {
      rows = [],
      settings = { holdingsFilter: 'all', horizonFilter: 'all' },
      filterNote = null,
      dataNote = null,
      dataSource = null,
      selectedId = null,
      selected = null,
      emptyReason = null
    } = model || {};

    this.root.innerHTML = `
      <div class="fc-workspace">
        <div class="forecast-controls fc-toolbar">
          <label>
            Holdings:
            <select id="fc-holdings-filter">
              <option value="all"${settings.holdingsFilter === 'all' ? ' selected' : ''}>All</option>
              <option value="REAL"${settings.holdingsFilter === 'REAL' ? ' selected' : ''}>REAL holdings</option>
              <option value="TRACKING"${settings.holdingsFilter === 'TRACKING' ? ' selected' : ''}>TRACKING assets</option>
            </select>
          </label>
          <label>
            Horizon:
            <select id="fc-horizon-filter">
              <option value="all"${settings.horizonFilter === 'all' ? ' selected' : ''}>All</option>
              <option value="weekly"${settings.horizonFilter === 'weekly' ? ' selected' : ''}>Weekly</option>
              <option value="monthly"${settings.horizonFilter === 'monthly' ? ' selected' : ''}>Monthly</option>
            </select>
          </label>
          <label>
            Generate:
            <select id="horizon-select">
              <option value="weekly" selected>Weekly (7d)</option>
              <option value="monthly">Monthly (30d)</option>
            </select>
          </label>
          <button type="button" id="generate-forecast-btn">Generate Forecast</button>
          <button type="button" id="fc-export-json" class="inv-secondary">Export JSON</button>
          <button type="button" id="fc-export-csv" class="inv-secondary">Export CSV</button>
        </div>
        ${filterNote ? `<div class="alert fc-filter-note" id="fc-filter-note">${escapeHtml(filterNote)}</div>` : ''}
        ${dataNote ? `<div class="alert fc-data-note">${escapeHtml(dataNote)}</div>` : ''}
        ${dataSource === 'fixture' ? '<p class="inv-muted">Research/paper only. Fixture outcomes are not live market claims.</p>' : ''}
        ${rows.length === 0 ? this.emptyHtml(emptyReason) : this.tableHtml(rows, selectedId)}
        <section id="fc-detail" class="fc-detail${selected ? '' : ' hidden'}">
          ${selected ? this.detailHtml(selected) : ''}
        </section>
      </div>
    `;
  }

  emptyHtml(reason) {
    return `<div class="empty-state" id="fc-empty">
      <h3>No scored forecasts</h3>
      <p>${escapeHtml(reason || 'Nothing to list. Load Data on Overview so a series exists, or click Generate Forecast. Empty is honest — Scoreboard does not invent prices or 0 MAE.')}</p>
    </div>`;
  }

  tableHtml(rows, selectedId) {
    return `<div class="inv-table-wrap">
      <table class="inv-table fc-table" id="fc-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Horizon</th>
            <th>As-of</th>
            <th>Predicted</th>
            <th>Range</th>
            <th>Conf.</th>
            <th>Model</th>
            <th>Actual</th>
            <th>MAE / naive</th>
            <th>Direction</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => this.rowHtml(row, selectedId)).join('')}
        </tbody>
      </table>
    </div>
    <p class="inv-muted">${rows.length} forecast${rows.length === 1 ? '' : 's'}. Click a row to jump the Overview chart to that as-of bar.</p>`;
  }

  rowHtml(row, selectedId) {
    const pred = row.predicted || {};
    const score = row.score || {};
    const selected = row.id && row.id === selectedId ? ' fc-row-selected' : '';
    const maeCell = row.status === 'matured'
      ? `${formatMae(score.mae)} / ${formatMae(score.naiveMae)}${score.maeVsNaive ? ` (${score.maeVsNaive})` : ''}`
      : 'n/a';
    const dirCell = row.status === 'matured'
      ? `${score.direction || 'n/a'} vs naive ${score.naiveDirection || 'n/a'}`
      : 'n/a';
    return `<tr class="fc-row${selected}" data-forecast-id="${escapeHtml(row.id || '')}">
      <td>${escapeHtml(row.symbol || 'n/a')}${row.dataSource === 'fixture' ? ' <span class="fc-fixture">fixture</span>' : ''}</td>
      <td>${escapeHtml(row.horizon || 'n/a')}</td>
      <td>${escapeHtml(row.asOfDateUtc || 'n/a')}</td>
      <td>${formatMoney(pred.point)}</td>
      <td>${formatMoney(pred.lower)} – ${formatMoney(pred.upper)}</td>
      <td>${formatPct(row.confidence)}</td>
      <td>${escapeHtml(row.model || 'n/a')} / ${escapeHtml(row.modelVersion || 'n/a')}</td>
      <td>${row.actual && Number.isFinite(row.actual.close) ? formatMoney(row.actual.close) : 'n/a'}</td>
      <td>${maeCell}</td>
      <td>${dirCell}</td>
      <td><span class="fc-status ${statusClass(row.status)}">${escapeHtml(row.status || 'n/a')}</span></td>
    </tr>`;
  }

  detailHtml(row) {
    const rationale = row.rationale || {};
    const features = row.features || {};
    const featureBits = Object.entries(features)
      .filter(([, value]) => Number.isFinite(value))
      .map(([key, value]) => `<li><code>${escapeHtml(key)}</code> ${escapeHtml(Number(value).toFixed(4))}</li>`);
    return `
      <h3>Selected ${escapeHtml(row.symbol || '')} ${escapeHtml(row.horizon || '')} as-of ${escapeHtml(row.asOfDateUtc || '')}</h3>
      <p><strong>Jump timestamp:</strong> ${escapeHtml(row.asOfTimestamp)}</p>
      <p><strong>Side / rec:</strong> ${escapeHtml(rationale.side || 'n/a')} · ${escapeHtml(rationale.recommendation || 'n/a')}</p>
      <p><strong>Pro:</strong> ${escapeHtml(rationale.proCase || 'n/a')}</p>
      <p><strong>Con:</strong> ${escapeHtml(rationale.conCase || 'n/a')}</p>
      <p><strong>Features used</strong></p>
      <ul>${featureBits.length ? featureBits.join('') : '<li>none recorded</li>'}</ul>
    `;
  }
}
