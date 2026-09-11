import {
  INVESTMENTS_STORAGE_KEY,
  emptyState,
  migrateInvestmentsState
} from './schema.js';
import {
  defaultInstrumentClass,
  markSymbolFor,
  sameInstrument
} from './instrument.js';

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

  trackingIdentity(record) {
    return {
      symbol: record && record.symbol,
      assetClass: record && (record.assetClass || defaultInstrumentClass(record.symbol)),
      markSymbol: markSymbolFor(record),
      yahooTicker: record && record.yahooTicker
    };
  }

  findActiveTracking(record) {
    const rows = this.collection('tracking') || [];
    return rows.find((row) => row && row.status === 'active' && sameInstrument(row, record)) || null;
  }

  addTracking(record) {
    const state = this.getState();
    const assetClass = record.assetClass || defaultInstrumentClass(record.symbol);
    const markSymbol = markSymbolFor({ ...record, assetClass });
    const item = {
      id: record.id || `track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      badge: 'TRACKING',
      symbol: String(record.symbol || '').toUpperCase(),
      listedSymbol: record.listedSymbol ? String(record.listedSymbol).toUpperCase() : String(record.symbol || '').toUpperCase(),
      assetClass,
      yahooTicker: record.yahooTicker ? String(record.yahooTicker).toUpperCase() : (assetClass === 'etf' ? markSymbol : null),
      markSymbol,
      needsInstrumentClass: Boolean(record.needsInstrumentClass),
      startDate: record.startDate,
      baselinePrice: record.baselinePrice == null ? null : record.baselinePrice,
      startMark: record.startMark == null
        ? (record.baselinePrice == null ? null : record.baselinePrice)
        : record.startMark,
      entryOverride: record.entryOverride == null ? null : record.entryOverride,
      targetPrice: record.targetPrice == null ? null : record.targetPrice,
      targetHigh: record.targetHigh == null ? null : record.targetHigh,
      direction: record.direction === 'short' ? 'short' : 'long',
      fills: Array.isArray(record.fills) ? record.fills.slice() : [],
      source: record.source || 'watch',
      startedAt: record.startedAt || Date.now(),
      stoppedAt: null,
      stopDate: null,
      stopPrice: null,
      status: record.status || 'active',
      history: [{
        action: 'start',
        date: record.startDate,
        price: record.baselinePrice == null ? record.startMark : record.baselinePrice,
        at: record.startedAt || Date.now()
      }]
    };
    state.collections.tracking.push(item);
    this.save();
    return item;
  }

  /**
   * Same instrument + active row → merge (keeps existing target unless a new one is provided).
   * BTC crypto and IBIT etf stay distinct rows.
   */
  addOrMergeTracking(record) {
    const existing = this.findActiveTracking(record);
    if (!existing) return this.addTracking(record);
    const patch = {};
    if (record.targetPrice != null) patch.targetPrice = record.targetPrice;
    if (record.targetHigh != null) patch.targetHigh = record.targetHigh;
    if (record.direction) patch.direction = record.direction;
    if (record.startDate) patch.startDate = record.startDate;
    if (record.baselinePrice != null) {
      patch.baselinePrice = record.baselinePrice;
      if (existing.startMark == null) patch.startMark = record.baselinePrice;
    }
    if (record.startMark != null && existing.startMark == null) patch.startMark = record.startMark;
    if (record.assetClass) patch.assetClass = record.assetClass;
    if (record.yahooTicker) patch.yahooTicker = record.yahooTicker;
    if (record.markSymbol) patch.markSymbol = record.markSymbol;
    if (record.listedSymbol) patch.listedSymbol = record.listedSymbol;
    if (record.needsInstrumentClass != null && existing.needsInstrumentClass) {
      patch.needsInstrumentClass = record.needsInstrumentClass;
    }
    if (record.entryOverride != null) patch.entryOverride = record.entryOverride;
    return this.updateTracking(existing.id, patch);
  }

  updateTracking(id, patch = {}) {
    const state = this.getState();
    const item = state.collections.tracking.find((row) => row.id === id);
    if (!item) return null;
    const next = { ...item, ...patch, id: item.id, badge: 'TRACKING' };
    Object.assign(item, next);
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

  removeTracking(id) {
    const state = this.getState();
    const before = state.collections.tracking.length;
    state.collections.tracking = state.collections.tracking.filter((row) => row.id !== id);
    if (state.collections.tracking.length === before) return false;
    this.save();
    return true;
  }

  matchesInstrumentEvent(event, record) {
    if (!event || !record) return false;
    return sameInstrument({
      symbol: event.symbol,
      assetClass: event.assetClass || record.assetClass,
      markSymbol: event.markSymbol || event.yahooTicker || event.symbol,
      yahooTicker: event.yahooTicker
    }, record);
  }

  removeInstrumentLots(record, { dropFills = true } = {}) {
    if (!record || !dropFills) return { events: 0, paper: 0 };
    const state = this.getState();
    const eventsBefore = state.collections.events.length;
    const paperBefore = state.collections.paperTrades.length;
    state.collections.events = state.collections.events.filter((event) => (
      !this.matchesInstrumentEvent(event, record)
    ));
    state.collections.paperTrades = state.collections.paperTrades.filter((trade) => (
      !this.matchesInstrumentEvent(trade, record)
    ));
    this.save();
    return {
      events: eventsBefore - state.collections.events.length,
      paper: paperBefore - state.collections.paperTrades.length
    };
  }

  addWatchFill(id, fill = {}) {
    const state = this.getState();
    const item = state.collections.tracking.find((row) => row.id === id);
    if (!item) return null;
    const side = String(fill.side || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const quantity = fill.quantity == null || fill.quantity === '' ? 1 : Number(fill.quantity);
    const price = fill.price == null || fill.price === '' ? null : Number(fill.price);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    if (!Number.isFinite(price)) return null;
    const entry = {
      id: fill.id || `fill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      side,
      date: fill.date || null,
      quantity,
      price,
      createdAt: fill.createdAt || Date.now(),
      source: fill.source || 'watch'
    };
    item.fills = Array.isArray(item.fills) ? item.fills.slice() : [];
    item.fills.push(entry);
    item.history = Array.isArray(item.history) ? item.history.slice() : [];
    item.history.push({
      action: side === 'SELL' ? 'sold' : 'bought',
      date: entry.date,
      price: entry.price,
      quantity: entry.quantity,
      at: entry.createdAt
    });
    if (item.status === 'stopped') item.status = 'active';
    this.save();
    return entry;
  }

  updateRealUnitCost(record, unitCost) {
    if (!record || !Number.isFinite(unitCost)) return 0;
    const state = this.getState();
    let updated = 0;
    for (const event of state.collections.events) {
      if (!this.matchesInstrumentEvent(event, record)) continue;
      if (event.activityType !== 'buy') continue;
      event.price = unitCost;
      if (Number.isFinite(event.quantity)) {
        event.costBasis = unitCost * Math.abs(event.quantity);
      }
      updated += 1;
    }
    this.save();
    return updated;
  }

  applyInstrumentClass(id, patch = {}) {
    const item = this.collection('tracking').find((row) => row.id === id);
    if (!item) return null;
    const next = {
      assetClass: patch.assetClass || item.assetClass,
      yahooTicker: patch.yahooTicker || item.yahooTicker,
      symbol: patch.symbol || item.symbol,
      listedSymbol: item.listedSymbol || item.symbol
    };
    const markSymbol = markSymbolFor(next);
    return this.updateTracking(id, {
      ...next,
      markSymbol,
      needsInstrumentClass: false
    });
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
