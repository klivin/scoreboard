import {
  FORECASTS_STORAGE_KEY,
  emptyForecastsState,
  migrateForecastsState
} from './schema.js';

export { FORECASTS_STORAGE_KEY };

export class MemoryStorage {
  constructor(initial = {}) {
    this.map = new Map();
    for (const [key, value] of Object.entries(initial)) {
      this.map.set(key, String(value));
    }
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

function defaultStorage() {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return new MemoryStorage();
}

export class ForecastsStore {
  constructor(options = {}) {
    this.storage = options.storage || defaultStorage();
    this.key = options.key || FORECASTS_STORAGE_KEY;
    this.state = null;
  }

  load() {
    const rawText = this.storage.getItem(this.key);
    if (!rawText) {
      this.state = emptyForecastsState();
      return this.state;
    }
    try {
      this.state = migrateForecastsState(JSON.parse(rawText));
      return this.state;
    } catch {
      this.state = emptyForecastsState();
      return this.state;
    }
  }

  save() {
    if (!this.state) this.load();
    this.storage.setItem(this.key, JSON.stringify(this.state));
    return this.state;
  }

  getState() {
    if (!this.state) this.load();
    return this.state;
  }

  getSettings() {
    return this.getState().collections.settings;
  }

  setSettings(partial) {
    const state = this.getState();
    state.collections.settings = {
      ...state.collections.settings,
      ...partial
    };
    this.save();
    return state.collections.settings;
  }

  replaceRecords(records) {
    const state = this.getState();
    state.collections.records = Array.isArray(records) ? records.slice() : [];
    this.save();
    return state.collections.records;
  }

  listRecords() {
    return this.getState().collections.records.slice();
  }
}

export function createForecastsStore(options) {
  return new ForecastsStore(options);
}
