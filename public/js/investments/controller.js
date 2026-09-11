import { InvestmentsStore } from './store.js';
import { previewImport } from './validate.js';
import { computeLotsAndPnl } from './lots.js';
import { validatePaperTrade, startTrackingInput } from './tracking.js';
import { applyStartMarkFreeze, collectWatchSymbols } from './watch.js';
import { fetchMarksForSymbols, lastFiniteClose } from './marks.js';
import { buildExportCsv, buildExportJson, downloadBlob } from './export.js';
import { InvestmentsView } from './view.js';
import { parseOptionalNumber } from './parse.js';

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
    this.markStatus = '';
    this.fetchImpl = options.fetchImpl || null;
    this.refreshing = false;
  }

  importedHintMarks() {
    const hints = {};
    for (const event of this.store.collection('events') || []) {
      if (event && event.symbol && Number.isFinite(event.lastPrice) && hints[event.symbol] == null) {
        hints[event.symbol] = event.lastPrice;
      }
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
      markStatus: this.markStatus
    };
  }

  refresh() {
    this.view.render(this.model());
    this.bindWorkspace();
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
    if (last) this.setMark(symbol, last.close);
  }

  freezeStartMarks(marks, startCloses) {
    const tracking = this.store.collection('tracking') || [];
    for (const record of tracking) {
      if (!record || record.status === 'stopped') continue;
      const symbol = record.symbol;
      const next = applyStartMarkFreeze(record, {
        liveMark: marks && marks[symbol],
        seriesStartClose: startCloses && startCloses[symbol]
      });
      if (next !== record && Number.isFinite(next.startMark)) {
        this.store.updateTracking(record.id, {
          startMark: next.startMark,
          baselinePrice: next.baselinePrice
        });
      }
    }
  }

  async refreshMarks() {
    if (this.refreshing) return;
    const pnl = this.model().pnl;
    const symbols = collectWatchSymbols({
      tracking: this.store.collection('tracking'),
      realPositions: pnl.REAL.positions
    });
    if (!symbols.length) {
      this.markStatus = 'Add a watch row or import a REAL lot, then refresh.';
      this.refresh();
      return;
    }

    this.refreshing = true;
    this.markStatus = `Refreshing ${symbols.join(', ')} via Overview ingest (Yahoo / OKX)…`;
    this.refresh();

    const startDates = {};
    for (const record of this.store.collection('tracking') || []) {
      if (record && record.symbol && record.startDate && !startDates[record.symbol]) {
        startDates[record.symbol] = record.startDate;
      }
    }

    const nextMarks = { ...this.markPrices };
    const startCloses = {};
    const notes = [];
    try {
      for (const symbol of symbols) {
        const result = await fetchMarksForSymbols([symbol], {
          fetchImpl: this.fetchImpl || fetch,
          startDate: startDates[symbol] || null
        });
        if (Number.isFinite(result.marks[symbol])) {
          nextMarks[symbol] = result.marks[symbol];
          notes.push(`${symbol} ${result.marks[symbol].toFixed(2)}`);
        } else {
          notes.push(`${symbol} missing`);
        }
        if (Number.isFinite(result.startCloses[symbol])) {
          startCloses[symbol] = result.startCloses[symbol];
        }
      }
      this.markPrices = nextMarks;
      this.freezeStartMarks(nextMarks, startCloses);
      this.markStatus = `Marks: ${notes.join(' · ')}. Missing stays missing — prices are not invented.`;
    } catch (error) {
      this.markStatus = error && error.message ? error.message : 'Refresh failed';
    } finally {
      this.refreshing = false;
      this.refresh();
    }
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
    this.preview = null;
    this.view.hidePreview();
    this.refresh();
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
        const data = new FormData(watchForm);
        const checked = startTrackingInput({
          symbol: data.get('symbol'),
          startDate: data.get('startDate'),
          baselinePrice: parseOptionalNumber(data.get('baselinePrice')),
          targetPrice: parseOptionalNumber(data.get('targetPrice')),
          targetHigh: parseOptionalNumber(data.get('targetHigh')),
          direction: data.get('direction'),
          requireTarget: true
        });
        if (!checked.ok) {
          window.alert(checked.errors.join('\n'));
          return;
        }
        this.store.addTracking(checked.record);
        this.refresh();
      });
    }

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
          window.alert(checked.errors.join('\n'));
          return;
        }
        this.store.addPaperTrade(checked.trade);
        this.refresh();
      });
    }

    document.querySelectorAll('.inv-stop-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.trackId;
        const today = new Date().toISOString().slice(0, 10);
        const row = (this.store.collection('tracking') || []).find((r) => r.id === id);
        const stopPrice = row && Number.isFinite(this.markPrices[row.symbol])
          ? this.markPrices[row.symbol]
          : null;
        this.store.stopTracking(id, { stopDate: today, stopPrice });
        this.refresh();
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
          window.alert(error.message);
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
