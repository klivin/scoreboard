import { ForecastsStore } from './store.js';
import { ForecastsView } from './view.js';
import { filterForecasts } from './filter.js';
import { buildForecastClickPayload } from './click.js';
import { buildForecastExportCsv, buildForecastExportJson, downloadBlob } from './export.js';

export class ForecastsController {
  constructor(options = {}) {
    this.store = options.store || new ForecastsStore();
    this.view = options.view || new ForecastsView(options.rootId || 'forecast');
    this.investmentsStore = options.investmentsStore || null;
    this.onJump = options.onJump || null;
    this.onGenerate = options.onGenerate || null;
    this.payload = null;
    this.selectedId = null;
    this.meta = { dataSource: null, note: null };
  }

  investmentsState() {
    if (!this.investmentsStore) return null;
    if (typeof this.investmentsStore.getState === 'function') {
      return this.investmentsStore.getState();
    }
    return this.investmentsStore;
  }

  filtered() {
    const settings = this.store.getSettings();
    return filterForecasts(this.store.listRecords(), {
      holdingsFilter: settings.holdingsFilter,
      horizonFilter: settings.horizonFilter,
      investmentsState: this.investmentsState()
    });
  }

  model() {
    const settings = this.store.getSettings();
    const filtered = this.filtered();
    const selected = filtered.rows.find((row) => row.id === this.selectedId) || null;
    return {
      rows: filtered.rows,
      settings,
      filterNote: filtered.note,
      dataNote: this.meta.note,
      dataSource: this.meta.dataSource,
      selectedId: this.selectedId,
      selected,
      emptyReason: filtered.rows.length
        ? null
        : (this.store.listRecords().length
          ? 'No forecasts match the current filters.'
          : null)
    };
  }

  refresh() {
    this.view.render(this.model());
    this.bind();
  }

  ingestPayload(payload) {
    this.payload = payload || {};
    const records = Array.isArray(this.payload.forecasts) ? this.payload.forecasts : [];
    this.store.replaceRecords(records);
    this.meta = {
      dataSource: this.payload.dataSource || null,
      note: this.payload.note || null
    };
    this.refresh();
    return records;
  }

  selectForecast(id) {
    const filtered = this.filtered();
    const record = filtered.rows.find((row) => row.id === id) || this.store.listRecords().find((row) => row.id === id);
    if (!record) return null;
    this.selectedId = id;
    const click = buildForecastClickPayload(record);
    this.refresh();
    if (typeof this.onJump === 'function') this.onJump(click);
    return click;
  }

  bind() {
    if (typeof document === 'undefined') return;
    const holdings = document.getElementById('fc-holdings-filter');
    if (holdings) {
      holdings.addEventListener('change', () => {
        this.store.setSettings({ holdingsFilter: holdings.value });
        this.refresh();
      });
    }
    const horizon = document.getElementById('fc-horizon-filter');
    if (horizon) {
      horizon.addEventListener('change', () => {
        this.store.setSettings({ horizonFilter: horizon.value });
        this.refresh();
      });
    }
    const generate = document.getElementById('generate-forecast-btn');
    if (generate && typeof this.onGenerate === 'function') {
      generate.addEventListener('click', () => this.onGenerate());
    }
    const jsonBtn = document.getElementById('fc-export-json');
    if (jsonBtn) {
      jsonBtn.addEventListener('click', () => {
        const { rows } = this.filtered();
        downloadBlob('scoreboard-forecasts.json', buildForecastExportJson(rows, {
          dataSource: this.meta.dataSource
        }), 'application/json');
      });
    }
    const csvBtn = document.getElementById('fc-export-csv');
    if (csvBtn) {
      csvBtn.addEventListener('click', () => {
        const { rows } = this.filtered();
        downloadBlob('scoreboard-forecasts.csv', buildForecastExportCsv(rows), 'text/csv');
      });
    }
    document.querySelectorAll('.fc-row[data-forecast-id]').forEach((row) => {
      row.addEventListener('click', () => this.selectForecast(row.dataset.forecastId));
    });
  }
}
