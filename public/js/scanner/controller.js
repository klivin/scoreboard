import { ScannerView } from './view.js';
import {
  filterScannerRows,
  sortScannerRows,
  mergeHoldingSymbols,
  freezeTrackingBaseline
} from './model.js';
import { ScannerTrackingStore } from './tracking-fallback.js';

export class ScannerController {
  constructor(options = {}) {
    this.app = options.app || null;
    this.investments = options.investments || null;
    this.view = options.view || new ScannerView(options.rootId || 'universe');
    this.fallback = options.fallbackStore || new ScannerTrackingStore();
    this.payload = { rows: [], note: null, disclaimer: null };
    this.filters = {
      flip: 'all',
      horizon: 7,
      minConfidence: null,
      assetClass: 'all',
      realHoldings: false,
      tracking: false,
      sortKey: 'symbol',
      sortDir: 'asc',
      now: Date.now()
    };
    this.selectedSymbol = null;
    this.evaluation = null;
  }

  investmentsState() {
    if (this.investments && this.investments.store) {
      return this.investments.store.getState();
    }
    return this.fallback.getState();
  }

  decoratedRows() {
    return mergeHoldingSymbols(this.payload.rows || [], this.investmentsState());
  }

  visibleRows() {
    const decorated = this.decoratedRows();
    const filtered = filterScannerRows(decorated, this.filters);
    return sortScannerRows(filtered, { key: this.filters.sortKey, horizon: this.filters.horizon }, this.filters.sortDir);
  }

  selectedRow() {
    return this.decoratedRows().find((row) => row.symbol === this.selectedSymbol) || null;
  }

  render() {
    const row = this.selectedRow();
    this.view.render({
      payload: this.payload,
      rows: this.visibleRows(),
      filters: this.filters,
      selectedSymbol: this.selectedSymbol,
      evaluation: this.evaluation,
      flipHistory: row && row.flipHistory ? row.flipHistory : []
    });
    this.bind();
  }

  bind() {
    const root = this.view.root;
    if (!root) return;

    const bindChange = (id, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', handler);
    };

    bindChange('scanner-filter-flip', (e) => { this.filters.flip = e.target.value; this.render(); });
    bindChange('scanner-filter-horizon', (e) => { this.filters.horizon = Number(e.target.value); this.render(); });
    bindChange('scanner-filter-confidence', (e) => {
      this.filters.minConfidence = e.target.value === '' ? null : Number(e.target.value);
      this.render();
    });
    bindChange('scanner-filter-class', (e) => { this.filters.assetClass = e.target.value; this.render(); });
    bindChange('scanner-filter-real', (e) => { this.filters.realHoldings = e.target.checked; this.render(); });
    bindChange('scanner-filter-tracking', (e) => { this.filters.tracking = e.target.checked; this.render(); });
    bindChange('scanner-sort-key', (e) => { this.filters.sortKey = e.target.value; this.render(); });
    bindChange('scanner-sort-dir', (e) => { this.filters.sortDir = e.target.value; this.render(); });

    root.querySelectorAll('tr.scanner-row').forEach((tr) => {
      tr.addEventListener('click', (event) => {
        if (event.target.closest('.scanner-track-btn')) return;
        this.selectSymbol(tr.dataset.symbol, { openOverview: true });
      });
      tr.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.selectSymbol(tr.dataset.symbol, { openOverview: true });
        }
      });
    });

    root.querySelectorAll('.scanner-track-btn').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const symbol = btn.dataset.symbol;
        if (btn.dataset.action === 'start') this.startTracking(symbol);
        else this.stopTracking(symbol, btn.dataset.trackId);
      });
    });
  }

  openOverview(symbol) {
    const select = document.getElementById('symbol-select');
    if (select) {
      const upper = String(symbol).toUpperCase();
      const has = [...select.options].some((opt) => opt.value === upper);
      if (!has) {
        const opt = document.createElement('option');
        opt.value = upper;
        opt.textContent = upper;
        select.appendChild(opt);
      }
      select.value = upper;
    }

    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    const overviewBtn = document.querySelector('.tab-btn[data-tab="overview"]');
    const overview = document.getElementById('overview');
    if (overviewBtn) overviewBtn.classList.add('active');
    if (overview) overview.classList.add('active');

    if (this.app) {
      this.app.currentSymbol = String(symbol).toUpperCase();
      this.app.reloadSelected();
    }
  }

  async selectSymbol(symbol, options = {}) {
    this.selectedSymbol = symbol;
    await this.loadEvaluation();
    this.render();
    if (options.openOverview) this.openOverview(symbol);
  }

  trackingRecord(symbol) {
    const upper = String(symbol).toUpperCase();
    if (this.investments && this.investments.store) {
      return (this.investments.store.collection('tracking') || [])
        .find((row) => row.symbol === upper && row.status === 'active') || null;
    }
    return this.fallback.activeFor(upper);
  }

  startTracking(symbol) {
    const row = this.decoratedRows().find((r) => r.symbol === symbol);
    const frozen = freezeTrackingBaseline({
      symbol,
      baselinePrice: row ? row.currentPrice : null,
      startedAt: row && row.priceTimestamp ? row.priceTimestamp : Date.now()
    });
    if (!frozen.ok) {
      window.alert(frozen.errors.join('\n'));
      return;
    }
    if (this.investments && this.investments.store) {
      this.investments.store.addTracking(frozen.record);
      if (typeof this.investments.refresh === 'function') this.investments.refresh();
    } else {
      this.fallback.addTracking(frozen.record);
    }
    this.selectedSymbol = symbol;
    this.loadEvaluation().then(() => this.render());
  }

  stopTracking(symbol, trackId) {
    const record = this.trackingRecord(symbol);
    const id = trackId || (record && record.id);
    const row = this.decoratedRows().find((r) => r.symbol === symbol);
    const stop = {
      stopDate: new Date().toISOString().slice(0, 10),
      stopPrice: row ? row.currentPrice : null
    };
    if (this.investments && this.investments.store && id) {
      this.investments.store.stopTracking(id, stop);
      if (typeof this.investments.refresh === 'function') this.investments.refresh();
    } else if (id) {
      this.fallback.stopTracking(id, stop);
    }
    this.selectedSymbol = symbol;
    this.loadEvaluation().then(() => this.render());
  }

  async loadEvaluation() {
    const row = this.selectedRow();
    const record = this.selectedSymbol ? this.trackingRecord(this.selectedSymbol) : null;
    const stopped = this.investments && this.investments.store && this.selectedSymbol
      ? (this.investments.store.collection('tracking') || [])
        .filter((item) => item.symbol === this.selectedSymbol)
        .slice(-1)[0]
      : null;
    const use = record || (stopped && stopped.status === 'stopped' ? stopped : null);
    if (!use) {
      this.evaluation = null;
      return;
    }
    const params = new URLSearchParams({
      symbol: use.symbol,
      startedAt: String(use.startedAt || ''),
      startDate: use.startDate || '',
      baselinePrice: String(use.baselinePrice),
      status: use.status || 'active'
    });
    if (use.stopPrice != null) params.set('stopPrice', String(use.stopPrice));
    try {
      const response = await fetch(`/api/scanner/evaluate?${params}`);
      if (!response.ok) {
        this.evaluation = null;
        return;
      }
      const result = await response.json();
      this.evaluation = result.evaluation || null;
    } catch {
      this.evaluation = null;
    }
    if (!this.evaluation && row) {
      this.evaluation = null;
    }
  }

  async refresh() {
    this.filters.now = Date.now();
    if (this.investments && this.investments.store && typeof this.investments.store.load === 'function') {
      this.investments.store.load();
    } else {
      this.fallback.load();
    }
    try {
      const extra = [];
      const state = this.investmentsState();
      for (const event of (state.collections && state.collections.events) || []) {
        if (event && event.symbol) extra.push(event.symbol);
      }
      for (const rec of (state.collections && state.collections.tracking) || []) {
        if (rec && rec.symbol) extra.push(rec.symbol);
      }
      const params = extra.length ? `?extra=${encodeURIComponent([...new Set(extra)].join(','))}` : '';
      const response = await fetch(`/api/scanner${params}`);
      if (!response.ok) throw new Error('Failed to load scanner');
      this.payload = await response.json();
    } catch (error) {
      console.error('Scanner load failed', error);
      this.payload = {
        rows: [],
        note: 'Scanner data missing — could not load /api/scanner. Cells stay missing.',
        disclaimer: 'Research / paper only.'
      };
    }
    await this.loadEvaluation();
    this.render();
  }
}
