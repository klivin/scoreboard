import {
  INVESTMENTS_STORAGE_KEY,
  emptyState,
  migrateInvestmentsState
} from './schema.js';

export { INVESTMENTS_STORAGE_KEY };

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

export class InvestmentsStore {
  constructor(options = {}) {
    this.storage = options.storage || defaultStorage();
    this.key = options.key || INVESTMENTS_STORAGE_KEY;
    this.state = null;
  }

  load() {
    const rawText = this.storage.getItem(this.key);
    if (!rawText) {
      this.state = emptyState();
      return this.state;
    }
    try {
      const parsed = JSON.parse(rawText);
      this.state = migrateInvestmentsState(parsed);
      return this.state;
    } catch {
      this.state = emptyState();
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

  collection(name) {
    return this.getState().collections[name];
  }

  setCostMethod(method) {
    const state = this.getState();
    state.collections.settings.costMethod = method === 'average' ? 'average' : 'fifo';
    this.save();
    return state.collections.settings.costMethod;
  }

  getCostMethod() {
    return this.getState().collections.settings.costMethod || 'fifo';
  }

  addSymbolMap(map) {
    const state = this.getState();
    const item = {
      id: map.id || `map_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromSymbol: map.fromSymbol || null,
      toSymbol: map.toSymbol || null,
      fromCusip: map.fromCusip || null,
      toCusip: map.toCusip || null,
      reason: map.reason || null,
      createdAt: map.createdAt || Date.now()
    };
    if (!item.fromSymbol && !item.fromCusip) {
      throw new Error('Explicit mapping requires fromSymbol or fromCusip');
    }
    if (!item.toSymbol && !item.toCusip) {
      throw new Error('Explicit mapping requires toSymbol or toCusip');
    }
    state.collections.symbolMaps.push(item);
    this.save();
    return item;
  }

  commitImport(preview, meta = {}) {
    const state = this.getState();
    const existing = new Set(state.collections.events.map((event) => event.fingerprint));
    const importedAt = Date.now();
    const sourceFileName = meta.sourceFileName || null;
    let added = 0;

    for (let i = 0; i < preview.rawRows.length; i += 1) {
      const row = preview.rawRows[i];
      const event = preview.events[i];
      if (!event) continue;
      if (existing.has(event.fingerprint)) continue;
      state.collections.rawTransactions.push({
        id: `raw_${importedAt}_${i}`,
        importedAt,
        sourceFileName,
        lineNumber: row.lineNumber,
        raw: row.raw,
        record: row.record
      });
      state.collections.events.push({
        ...event,
        importedAt,
        sourceFileName,
        badge: 'REAL',
        source: 'import'
      });
      existing.add(event.fingerprint);
      added += 1;
    }

    this.save();
    return { added, totalEvents: state.collections.events.length };
  }

  addPaperTrade(trade) {
    const state = this.getState();
    const item = {
      id: trade.id || `paper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      badge: 'TRACKING',
      source: 'paper',
      side: trade.side,
      symbol: String(trade.symbol || '').toUpperCase(),
      date: trade.date,
      quantity: trade.quantity,
      price: trade.price,
      commission: trade.commission == null ? null : trade.commission,
      note: trade.note || null,
      createdAt: trade.createdAt || Date.now()
    };
    state.collections.paperTrades.push(item);
    this.save();
    return item;
  }

  addTracking(record) {
    const state = this.getState();
    const item = {
      id: record.id || `track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      badge: 'TRACKING',
      symbol: String(record.symbol || '').toUpperCase(),
      startDate: record.startDate,
      baselinePrice: record.baselinePrice,
      startedAt: record.startedAt || Date.now(),
      stoppedAt: null,
      stopDate: null,
      stopPrice: null,
      status: 'active',
      history: [{
        action: 'start',
        date: record.startDate,
        price: record.baselinePrice,
        at: record.startedAt || Date.now()
      }]
    };
    state.collections.tracking.push(item);
    this.save();
    return item;
  }

  stopTracking(id, stop = {}) {
    const state = this.getState();
    const item = state.collections.tracking.find((row) => row.id === id);
    if (!item) return null;
    item.status = 'stopped';
    item.stoppedAt = stop.stoppedAt || Date.now();
    item.stopDate = stop.stopDate || null;
    item.stopPrice = stop.stopPrice == null ? null : stop.stopPrice;
    item.history = Array.isArray(item.history) ? item.history.slice() : [];
    item.history.push({
      action: 'stop',
      date: item.stopDate,
      price: item.stopPrice,
      at: item.stoppedAt
    });
    this.save();
    return item;
  }

  allFillEvents() {
    const state = this.getState();
    const real = state.collections.events.map((event) => ({ ...event, badge: 'REAL' }));
    const paper = state.collections.paperTrades.map((trade) => ({
      id: trade.id,
      source: 'paper',
      badge: 'TRACKING',
      activityDate: trade.date,
      transactionDate: trade.date,
      settlementDate: null,
      activityType: String(trade.side || '').toLowerCase() === 'sell' ? 'sell' : 'buy',
      description: trade.note || `Paper ${trade.side}`,
      symbol: trade.symbol,
      cusip: null,
      quantity: trade.quantity,
      price: trade.price,
      amount: trade.quantity != null && trade.price != null
        ? trade.quantity * trade.price
        : null,
      commission: trade.commission,
      category: 'paper',
      note: trade.note || null,
      mapped: false,
      flags: {
        missingQuantity: trade.quantity == null,
        missingPrice: trade.price == null,
        unsupported: false,
        noFillInferred: trade.quantity == null || trade.price == null,
        needsExplicitMapping: false
      }
    }));
    return [...real, ...paper];
  }
}

export function createInvestmentsStore(options) {
  return new InvestmentsStore(options);
}
