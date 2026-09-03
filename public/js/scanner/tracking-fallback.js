import {
  SCANNER_TRACKING_KEY,
  emptyScannerTrackingState,
  migrateScannerTrackingState,
  freezeTrackingBaseline,
  stopTrackingRecord
} from './model.js';

function defaultStorage() {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return {
    map: new Map(),
    getItem(key) { return this.map.has(key) ? this.map.get(key) : null; },
    setItem(key, value) { this.map.set(key, String(value)); }
  };
}

/**
 * Schema-versioned local tracking when Investments store is absent.
 * Key: scoreboard.scanner.tracking (schemaVersion 1, namespace scanner).
 */
export class ScannerTrackingStore {
  constructor(options = {}) {
    this.storage = options.storage || defaultStorage();
    this.key = options.key || SCANNER_TRACKING_KEY;
    this.state = null;
  }

  load() {
    const raw = this.storage.getItem(this.key);
    if (!raw) {
      this.state = emptyScannerTrackingState();
      return this.state;
    }
    try {
      this.state = migrateScannerTrackingState(JSON.parse(raw));
    } catch {
      this.state = emptyScannerTrackingState();
    }
    return this.state;
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

  addTracking(input) {
    const frozen = freezeTrackingBaseline(input);
    if (!frozen.ok) return frozen;
    const state = this.getState();
    const record = {
      ...frozen.record,
      id: input.id || `scan_track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    };
    state.collections.tracking.push(record);
    this.save();
    return { ok: true, record };
  }

  stopTracking(id, stop = {}) {
    const state = this.getState();
    const idx = state.collections.tracking.findIndex((row) => row.id === id);
    if (idx === -1) return null;
    const stopped = stopTrackingRecord(state.collections.tracking[idx], stop);
    state.collections.tracking[idx] = stopped;
    this.save();
    return stopped;
  }

  activeFor(symbol) {
    const upper = String(symbol || '').toUpperCase();
    return this.getState().collections.tracking.find((row) => (
      row.symbol === upper && row.status === 'active'
    )) || null;
  }
}
