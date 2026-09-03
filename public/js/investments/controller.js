import { InvestmentsStore } from './store.js';
import { previewImport } from './validate.js';
import { computeLotsAndPnl } from './lots.js';
import { validatePaperTrade, startTrackingInput } from './tracking.js';
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
  }

  model() {
    const storeState = this.store.getState();
    const events = this.store.allFillEvents();
    const pnl = computeLotsAndPnl(events, {
      costMethod: this.store.getCostMethod(),
      markPrices: this.markPrices
    });
    return { storeState, pnl, markPrices: this.markPrices };
  }

  refresh() {
    this.view.render(this.model());
    this.bindWorkspace();
    if (typeof this.onChange === 'function') this.onChange(this.store);
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

    const cost = document.getElementById('inv-cost-method');
    if (cost) {
      cost.addEventListener('change', () => {
        this.store.setCostMethod(cost.value);
        this.refresh();
      });
    }

    const exportJson = document.getElementById('inv-export-json-btn');
    if (exportJson) {
      exportJson.addEventListener('click', () => {
        downloadBlob('scoreboard-investments.json', buildExportJson(this.store.getState()), 'application/json');
      });
    }
    const exportCsv = document.getElementById('inv-export-csv-btn');
    if (exportCsv) {
      exportCsv.addEventListener('click', () => {
        downloadBlob('scoreboard-investments.csv', buildExportCsv(this.store.allFillEvents()), 'text/csv');
      });
    }

    const paperForm = document.getElementById('inv-paper-form');
    if (paperForm) {
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

    const trackForm = document.getElementById('inv-track-form');
    if (trackForm) {
      trackForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const data = new FormData(trackForm);
        const checked = startTrackingInput({
          symbol: data.get('symbol'),
          startDate: data.get('startDate'),
          baselinePrice: parseOptionalNumber(data.get('baselinePrice'))
        });
        if (!checked.ok) {
          window.alert(checked.errors.join('\n'));
          return;
        }
        this.store.addTracking(checked.record);
        this.refresh();
      });
    }

    document.querySelectorAll('.inv-stop-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.trackId;
        const today = new Date().toISOString().slice(0, 10);
        this.store.stopTracking(id, { stopDate: today, stopPrice: null });
        this.refresh();
      });
    });

    const mapForm = document.getElementById('inv-map-form');
    if (mapForm) {
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
