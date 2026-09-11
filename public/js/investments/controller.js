import { InvestmentsStore } from './store.js';
import { previewImport } from './validate.js';
import { computeLotsAndPnl } from './lots.js';
import { validatePaperTrade, startTrackingInput, todayIsoDate } from './tracking.js';
import {
  applyStartMarkFreeze,
  collectWatchTargets,
  markSymbolFor
} from './watch.js';
import { fetchMarksForTargets, lastFiniteClose } from './marks.js';
import { buildExportCsv, buildExportJson, downloadBlob } from './export.js';
import { InvestmentsView } from './view.js';
import { parseOptionalNumber } from './parse.js';
import {
  defaultInstrumentClass,
  normalizeInstrumentClass,
  resolveWatchInstrument,
  suggestedEtfTickers
} from './instrument.js';

function readLocalFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read local file'));
    reader.readAsText(file);
  });
}

export class InvestmentsController {
  constructor(options = {}) {
    this.store = options.store || new InvestmentsStore();
    this.view = options.view || new InvestmentsView(options.rootId || 'investments');
    this.preview = null;
    this.onChange = options.onChange || null;
    this.markPrices = options.markPrices || {};
    this.markMeta = options.markMeta || {};
    this.markStatus = '';
    this.fetchImpl = options.fetchImpl || null;
    this.refreshing = false;
    this.confirmImpl = options.confirmImpl || ((message) => {
      if (typeof window !== 'undefined' && window.confirm) return window.confirm(message);
      return true;
    });
    this.promptImpl = options.promptImpl || ((message, fallback) => {
      if (typeof window !== 'undefined' && window.prompt) return window.prompt(message, fallback);
      return fallback;
    });
    this.alertImpl = options.alertImpl || ((message) => {
      if (typeof window !== 'undefined' && window.alert) window.alert(message);
    });
  }

  importedHintMarks() {
    const hints = {};
    for (const event of this.store.collection('events') || []) {
      if (!event || !event.symbol || !Number.isFinite(event.lastPrice)) continue;
      const cls = normalizeInstrumentClass(event.assetClass) || defaultInstrumentClass(event.symbol);
      const key = event.markSymbol || event.yahooTicker || event.symbol;
      if (cls === 'crypto' && hints[key] == null) hints[key] = event.lastPrice;
      if (cls !== 'crypto' && hints[key] == null) hints[key] = event.lastPrice;
    }
    return hints;
  }

  mergedMarks() {
    return { ...this.importedHintMarks(), ...this.markPrices };
  }

  model() {
    const storeState = this.store.getState();
    const events = this.store.allFillEvents();
    const markPrices = this.mergedMarks();
    const pnl = computeLotsAndPnl(events, {
      costMethod: this.store.getCostMethod(),
      markPrices
    });
    return {
      storeState,
      pnl,
      markPrices,
      markMeta: this.markMeta,
      markStatus: this.markStatus
    };
  }

  refresh() {
    this.view.render(this.model());
    if (typeof document !== 'undefined') this.bindWorkspace();
    if (typeof this.onChange === 'function') this.onChange(this.store);
  }

  setMark(symbol, price) {
    const upper = String(symbol || '').trim().toUpperCase();
    if (!upper || !Number.isFinite(price)) return;
    this.markPrices = { ...this.markPrices, [upper]: price };
    this.freezeStartMarks({ [upper]: price }, {});
    this.refresh();
  }

  setMarksFromSeries(symbol, series) {
    const last = lastFiniteClose(series);
    if (last) {
      this.markMeta = {
        ...this.markMeta,
        [String(symbol || '').toUpperCase()]: {
          dateUtc: last.dateUtc,
          timestamp: last.timestamp,
          asOf: last.dateUtc
        }
      };
      this.setMark(symbol, last.close);
    }
  }

  freezeStartMarks(marks, startCloses) {
    const tracking = this.store.collection('tracking') || [];
    for (const record of tracking) {
      if (!record || record.status === 'stopped') continue;
      const key = markSymbolFor(record) || record.symbol;
      const next = applyStartMarkFreeze(record, {
        liveMark: marks && marks[key],
        seriesStartClose: startCloses && startCloses[key]
      });
      if (next !== record && Number.isFinite(next.startMark)) {
        this.store.updateTracking(record.id, {
          startMark: next.startMark,
          baselinePrice: next.baselinePrice
        });
      }
    }
  }

  ensureImportedWatches() {
    const events = this.store.allFillEvents();
    const pnl = computeLotsAndPnl(events, {
      costMethod: this.store.getCostMethod(),
      markPrices: this.mergedMarks()
    });
    for (const position of (pnl.REAL && pnl.REAL.positions) || []) {
      if (!position || !position.symbol) continue;
      this.store.addOrMergeTracking({
        symbol: position.symbol,
        listedSymbol: position.listedSymbol || position.symbol,
        assetClass: position.needsInstrumentClass
          ? null
          : (position.assetClass || defaultInstrumentClass(position.symbol)),
        yahooTicker: position.yahooTicker,
        markSymbol: position.markSymbol || position.symbol,
        needsInstrumentClass: Boolean(position.needsInstrumentClass),
        startDate: todayIsoDate(),
        baselinePrice: Number.isFinite(position.averagePrice) ? position.averagePrice : null,
        source: 'import'
      });
    }
  }

  async refreshMarks() {
    if (this.refreshing) return;
    const pnl = this.model().pnl;
    const targets = collectWatchTargets({
      tracking: this.store.collection('tracking'),
      realPositions: pnl.REAL.positions
    });
    if (!targets.length) {
      const unresolved = (this.store.collection('tracking') || []).some((row) => row.needsInstrumentClass);
      this.markStatus = unresolved
        ? 'Pick coin vs ETF on unresolved BTC/ETH rows before refresh. Coin spot is not used until you choose.'
        : 'Add a watch row or import a REAL lot, then refresh.';
      this.refresh();
      return;
    }

    this.refreshing = true;
    this.markStatus = `Refreshing ${targets.map((t) => `${t.markSymbol} (${t.assetClass})`).join(', ')} via Overview ingest (Yahoo / OKX)…`;
    this.refresh();

    const nextMarks = { ...this.markPrices };
    const nextMeta = { ...this.markMeta };
    const startCloses = {};
    const notes = [];
    try {
      const result = await fetchMarksForTargets(targets, {
        fetchImpl: this.fetchImpl || fetch,
        interval: '1d'
      });
      for (const target of targets) {
        const key = target.markSymbol;
        if (Number.isFinite(result.marks[key])) {
          nextMarks[key] = result.marks[key];
          notes.push(`${key} ${result.marks[key].toFixed(2)}`);
        } else {
          notes.push(`${key} missing`);
        }
        if (Number.isFinite(result.startCloses[key])) {
          startCloses[key] = result.startCloses[key];
        }
        if (result.meta && result.meta[key]) {
          nextMeta[key] = result.meta[key];
        }
      }
      this.markPrices = nextMarks;
      this.markMeta = nextMeta;
      this.freezeStartMarks(nextMarks, startCloses);
      this.markStatus = `Marks: ${notes.join(' · ')}. Missing stays missing — prices are not invented.`;
    } catch (error) {
      this.markStatus = error && error.message ? error.message : 'Refresh failed';
    } finally {
      this.refreshing = false;
      this.refresh();
    }
  }

  addWatchFromForm(data) {
    const checked = startTrackingInput({
      symbol: data.get('symbol'),
      assetClass: data.get('assetClass'),
      yahooTicker: data.get('yahooTicker'),
      startDate: data.get('startDate'),
      baselinePrice: parseOptionalNumber(data.get('baselinePrice')),
      targetPrice: parseOptionalNumber(data.get('targetPrice')),
      targetHigh: parseOptionalNumber(data.get('targetHigh')),
      direction: data.get('direction'),
      requireTarget: true
    });
    if (!checked.ok) {
      this.alertImpl(checked.errors.join('\n'));
      return null;
    }
    const record = this.store.addOrMergeTracking(checked.record);
    this.refresh();
    const pending = this.refreshMarks();
    return { record, pending };
  }

  removeWatch(id, { dropFills = true } = {}) {
    const tracking = this.store.collection('tracking') || [];
    let record = tracking.find((row) => row.id === id);
    if (!record && String(id || '').startsWith('real_')) {
      const symbol = String(id).split('_').slice(2).join('_');
      record = {
        id,
        symbol,
        assetClass: String(id).split('_')[1],
        markSymbol: symbol
      };
    }
    if (!record) return false;
    const ok = this.confirmImpl(
      dropFills
        ? `Remove ${record.symbol || 'this'} watch row and its fills? This cannot be undone in this browser.`
        : `Remove ${record.symbol || 'this'} watch row? Fills stay in the store.`
    );
    if (!ok) return false;
    if (record.id && !String(record.id).startsWith('real_')) {
      this.store.removeTracking(record.id);
    }
    if (dropFills) this.store.removeInstrumentLots(record, { dropFills: true });
    this.refresh();
    return true;
  }

  editEntry(id) {
    const record = (this.store.collection('tracking') || []).find((row) => row.id === id);
    if (!record) return false;
    const current = record.entryOverride ?? record.baselinePrice ?? record.startMark ?? '';
    const raw = this.promptImpl('Entry / cost', current == null ? '' : String(current));
    if (raw == null) return false;
    const price = parseOptionalNumber(raw);
    if (!Number.isFinite(price)) {
      this.alertImpl('Entry / cost must be a number');
      return false;
    }
    this.store.updateTracking(id, {
      entryOverride: price,
      baselinePrice: price,
      startMark: record.startMark == null ? price : record.startMark
    });
    this.store.updateRealUnitCost(record, price);
    this.refresh();
    return true;
  }

  addFill(id, input = {}) {
    let record = (this.store.collection('tracking') || []).find((row) => row.id === id);
    if (!record && String(id || '').startsWith('real_')) {
      const parts = String(id).split('_');
      const assetClass = parts[1];
      const symbol = parts.slice(2).join('_');
      record = this.store.addOrMergeTracking({
        symbol,
        assetClass,
        markSymbol: symbol,
        startDate: todayIsoDate(),
        source: 'import'
      });
      id = record.id;
    }
    if (!record) return null;
    const markKey = markSymbolFor(record) || record.symbol;
    const price = Number.isFinite(input.price) ? input.price : this.markPrices[markKey];
    const fill = this.store.addWatchFill(id, {
      side: input.side,
      quantity: input.quantity,
      price,
      date: input.date || todayIsoDate()
    });
    if (!fill) {
      this.alertImpl('Fill needs a price (use Refresh if Price is missing) and a quantity greater than 0.');
      return null;
    }
    this.refresh();
    return fill;
  }

  applyRowInstrument(id, input = {}) {
    const resolved = resolveWatchInstrument({
      symbol: input.symbol,
      assetClass: input.assetClass,
      yahooTicker: input.yahooTicker
    });
    if (!resolved.ok) {
      this.alertImpl(resolved.errors.join('\n'));
      return null;
    }
    const updated = this.store.applyInstrumentClass(id, resolved);
    this.refresh();
    this.refreshMarks();
    return updated;
  }

  async handleFile(file) {
    if (!file) return;
    const text = await readLocalFile(file);
    this.preview = previewImport(text, {
      symbolMaps: this.store.collection('symbolMaps'),
      idPrefix: `imp_${Date.now()}`
    });
    this.preview.sourceFileName = file.name || 'local.csv';
    this.view.renderPreview(this.preview);
    this.bindPreview();
  }

  commitPreview() {
    if (!this.preview || !this.preview.canCommit) return;
    this.store.commitImport(this.preview, { sourceFileName: this.preview.sourceFileName });
    this.ensureImportedWatches();
    this.preview = null;
    this.view.hidePreview();
    this.refresh();
    this.refreshMarks();
  }

  bindPreview() {
    const commit = document.getElementById('inv-commit-btn');
    if (commit) commit.addEventListener('click', () => this.commitPreview());
    const cancel = document.getElementById('inv-cancel-preview-btn');
    if (cancel) {
      cancel.addEventListener('click', () => {
        this.preview = null;
        this.view.hidePreview();
      });
    }
  }

  bindWatchFormExtras() {
    const symbolInput = document.querySelector('#inv-watch-form [name="symbol"]');
    const classSelect = document.querySelector('#inv-watch-form [name="assetClass"]');
    const yahooWrap = document.getElementById('inv-yahoo-wrap');
    const yahooInput = document.querySelector('#inv-watch-form [name="yahooTicker"]');
    const yahooHelp = document.getElementById('inv-yahoo-help');
    const sync = (fromSymbol) => {
      if (!classSelect) return;
      if (fromSymbol && symbolInput) {
        classSelect.value = defaultInstrumentClass(symbolInput.value);
      }
      const cls = classSelect.value;
      if (yahooWrap) yahooWrap.classList.toggle('hidden', cls !== 'etf');
      if (yahooHelp && symbolInput) {
        const suggestions = suggestedEtfTickers(symbolInput.value).join(', ');
        yahooHelp.textContent = `Yahoo ticker required for ETF (e.g. ${suggestions}). Coin spot is not used.`;
      }
      if (cls === 'etf' && yahooInput && symbolInput && !yahooInput.value) {
        const upper = String(symbolInput.value || '').trim().toUpperCase();
        if (defaultInstrumentClass(upper) === 'etf') yahooInput.value = upper;
      }
    };
    if (symbolInput && !symbolInput.dataset.boundClass) {
      symbolInput.dataset.boundClass = '1';
      symbolInput.addEventListener('input', () => sync(true));
      symbolInput.addEventListener('change', () => sync(true));
    }
    if (classSelect && !classSelect.dataset.boundClass) {
      classSelect.dataset.boundClass = '1';
      classSelect.addEventListener('change', () => sync(false));
    }
    sync(false);
  }

  bindWorkspace() {
    const fileInput = document.getElementById('inv-file-input');
    if (fileInput && !fileInput.dataset.bound) {
      fileInput.dataset.bound = '1';
      fileInput.addEventListener('change', async (event) => {
        const file = event.target.files && event.target.files[0];
        try {
          await this.handleFile(file);
        } catch (error) {
          console.error(error);
        }
        event.target.value = '';
      });
    }

    const watchForm = document.getElementById('inv-watch-form');
    if (watchForm && !watchForm.dataset.bound) {
      watchForm.dataset.bound = '1';
      watchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        this.addWatchFromForm(new FormData(watchForm));
        watchForm.reset();
        const start = watchForm.querySelector('[name="startDate"]');
        if (start) start.value = todayIsoDate();
        this.bindWatchFormExtras();
      });
    }
    this.bindWatchFormExtras();

    const refreshMarks = document.getElementById('inv-refresh-marks-btn');
    if (refreshMarks && !refreshMarks.dataset.bound) {
      refreshMarks.dataset.bound = '1';
      refreshMarks.addEventListener('click', () => {
        this.refreshMarks();
      });
    }

    const cost = document.getElementById('inv-cost-method');
    if (cost && !cost.dataset.bound) {
      cost.dataset.bound = '1';
      cost.addEventListener('change', () => {
        this.store.setCostMethod(cost.value);
        this.refresh();
      });
    }

    const exportJson = document.getElementById('inv-export-json-btn');
    if (exportJson && !exportJson.dataset.bound) {
      exportJson.dataset.bound = '1';
      exportJson.addEventListener('click', () => {
        downloadBlob('scoreboard-investments.json', buildExportJson(this.store.getState()), 'application/json');
      });
    }
    const exportCsv = document.getElementById('inv-export-csv-btn');
    if (exportCsv && !exportCsv.dataset.bound) {
      exportCsv.dataset.bound = '1';
      exportCsv.addEventListener('click', () => {
        downloadBlob('scoreboard-investments.csv', buildExportCsv(this.store.allFillEvents()), 'text/csv');
      });
    }

    const paperForm = document.getElementById('inv-paper-form');
    if (paperForm && !paperForm.dataset.bound) {
      paperForm.dataset.bound = '1';
      paperForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const data = new FormData(paperForm);
        const checked = validatePaperTrade({
          side: data.get('side'),
          symbol: data.get('symbol'),
          date: data.get('date'),
          quantity: parseOptionalNumber(data.get('quantity')),
          price: parseOptionalNumber(data.get('price')),
          commission: parseOptionalNumber(data.get('commission')),
          note: data.get('note')
        });
        if (!checked.ok) {
          this.alertImpl(checked.errors.join('\n'));
          return;
        }
        this.store.addPaperTrade(checked.trade);
        this.refresh();
      });
    }

    document.querySelectorAll('.inv-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.removeWatch(btn.dataset.trackId, { dropFills: true });
      });
    });

    document.querySelectorAll('.inv-edit-entry-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.editEntry(btn.dataset.trackId);
      });
    });

    document.querySelectorAll('.inv-fill-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const editor = document.getElementById(`inv-fill-editor-${btn.dataset.trackId}`);
        if (!editor) return;
        editor.classList.remove('hidden');
        const side = editor.querySelector('[name="side"]');
        if (side) side.value = btn.dataset.side || 'BUY';
        const label = editor.querySelector('.inv-fill-side-label');
        if (label) label.textContent = (btn.dataset.side || 'BUY') === 'SELL' ? 'Sold' : 'Bought';
      });
    });

    document.querySelectorAll('.inv-row-fill-form').forEach((form) => {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const data = new FormData(form);
        this.addFill(form.dataset.trackId, {
          side: data.get('side'),
          quantity: parseOptionalNumber(data.get('quantity')),
          price: parseOptionalNumber(data.get('price')),
          date: data.get('date')
        });
      });
    });

    document.querySelectorAll('.inv-class-form').forEach((form) => {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const data = new FormData(form);
        this.applyRowInstrument(form.dataset.trackId, {
          symbol: data.get('symbol'),
          assetClass: data.get('assetClass'),
          yahooTicker: data.get('yahooTicker')
        });
      });
    });

    const mapForm = document.getElementById('inv-map-form');
    if (mapForm && !mapForm.dataset.bound) {
      mapForm.dataset.bound = '1';
      mapForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const data = new FormData(mapForm);
        try {
          this.store.addSymbolMap({
            fromSymbol: String(data.get('fromSymbol') || '').trim() || null,
            toSymbol: String(data.get('toSymbol') || '').trim() || null,
            fromCusip: String(data.get('fromCusip') || '').trim() || null,
            toCusip: String(data.get('toCusip') || '').trim() || null,
            reason: String(data.get('reason') || '').trim() || null
          });
          this.refresh();
        } catch (error) {
          this.alertImpl(error.message);
        }
      });
    }
  }

  init() {
    this.store.load();
    this.view.renderEmpty();
    this.refresh();
  }
}
