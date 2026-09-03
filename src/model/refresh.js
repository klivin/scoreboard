import { httpGet } from './http.js';
import {
  buildWatermarkRecord,
  describeAdapter,
  maxTimestamp,
  overlapSince,
  validateMonotonicAndGaps,
  watermarkId
} from './source-adapter.js';
import { createOkxCandleAdapter, createOkxOiAdapter } from './okx-adapter.js';
import { createCoinGeckoAdapter, createEtfAdapter } from './fallback-adapters.js';
import { rowsForAdapter, toStoreRows, upsertSeriesPage } from './ingest-store.js';
import {
  errorLogStore as defaultErrorLogStore,
  ingestSeriesStore as defaultSeriesStore,
  ingestWatermarkStore as defaultWatermarkStore,
  universeStore as defaultUniverseStore
} from './store-adapter.js';

export function defaultAdapters(deps = {}) {
  return [
    createOkxCandleAdapter({ symbol: 'BTC', interval: '1h', ...deps }),
    createOkxCandleAdapter({ symbol: 'BTC', interval: '1d', ...deps }),
    createOkxOiAdapter({ symbol: 'BTC', interval: '1h', ...deps }),
    createOkxOiAdapter({ symbol: 'BTC', interval: '1d', ...deps }),
    createEtfAdapter({ symbol: 'BTC', ...deps }),
    createEtfAdapter({ symbol: 'ETH', ...deps }),
    createCoinGeckoAdapter(deps)
  ];
}

function matchesFilter(adapter, { source, symbol, interval } = {}) {
  if (source && adapter.id !== source) return false;
  if (symbol && String(adapter.symbol).toUpperCase() !== String(symbol).toUpperCase()) return false;
  if (interval && adapter.interval !== interval) return false;
  return true;
}

function ageMs(lastSuccessAt, now) {
  if (lastSuccessAt == null) return null;
  return Math.max(0, now - lastSuccessAt);
}

export function createRefreshRuntime({
  httpGet: http = httpGet,
  watermarkStore = defaultWatermarkStore,
  seriesStore = defaultSeriesStore,
  errorLogStore = defaultErrorLogStore,
  universeStore = defaultUniverseStore,
  adapters = null,
  now = () => Date.now()
} = {}) {
  const adapterList = adapters || defaultAdapters({ httpGet: http });
  const state = {
    running: false,
    lastRunAt: null,
    sources: adapterList.map((adapter) => ({
      ...describeAdapter(adapter),
      status: 'idle',
      lastSuccessAt: null,
      lastSuccessAgeMs: null,
      lastTimestamp: null,
      rowCount: 0,
      fetched: 0,
      upserted: 0,
      gaps: 0,
      error: null,
      requestUrls: [],
      requestedSince: null
    }))
  };

  function hydrateFromWatermarks(nowTs) {
    const marks = watermarkStore.getAll() || [];
    state.sources = state.sources.map((entry) => {
      const mark = marks.find((item) => item.id === watermarkId(entry.id, entry.symbol, entry.interval));
      if (!mark) return { ...entry, lastSuccessAgeMs: ageMs(entry.lastSuccessAt, nowTs) };
      return {
        ...entry,
        lastSuccessAt: mark.lastSuccessAt ?? entry.lastSuccessAt,
        lastTimestamp: mark.lastTimestamp ?? entry.lastTimestamp,
        rowCount: mark.rowCount ?? entry.rowCount,
        lastSuccessAgeMs: ageMs(mark.lastSuccessAt, nowTs)
      };
    });
    return getStatus();
  }

  function getStatus() {
    const nowTs = now();
    return {
      running: state.running,
      lastRunAt: state.lastRunAt,
      sources: state.sources.map((entry) => ({
        ...entry,
        lastSuccessAgeMs: ageMs(entry.lastSuccessAt, nowTs)
      }))
    };
  }

  function logIssues(issues) {
    for (const issue of issues || []) {
      errorLogStore.add({
        ...issue,
        createdAt: now()
      });
    }
  }

  async function refreshOne(adapter) {
    const started = {
      ...describeAdapter(adapter),
      status: 'running',
      fetched: 0,
      upserted: 0,
      gaps: 0,
      error: null,
      requestUrls: [],
      requestedSince: null
    };

    const markId = watermarkId(adapter.id, adapter.symbol, adapter.interval);
    const previous = watermarkStore.getById(markId);
    const since = previous ? overlapSince(previous.lastTimestamp, adapter.interval) : null;
    const cursor = adapter.mode === 'incremental'
      ? { lastTimestamp: previous && previous.lastTimestamp, since }
      : null;

    try {
      const fetched = await adapter.fetchSince(cursor);
      const incoming = toStoreRows(fetched.rows || [], {
        source: adapter.id,
        symbol: adapter.symbol,
        interval: adapter.interval
      });
      const { rows, issues } = validateMonotonicAndGaps(incoming, {
        source: adapter.id,
        symbol: adapter.symbol,
        interval: adapter.interval
      });
      logIssues(issues);

      let upserted = { inserted: 0, updated: 0, total: 0 };
      if (adapter.id === 'coingecko-top100' && fetched.snapshot) {
        const existing = (universeStore.getAll() || []).find((item) => item.id === 'coingecko-top100');
        const snapshot = { id: 'coingecko-top100', ...fetched.snapshot };
        if (existing && typeof universeStore.update === 'function') {
          universeStore.update('coingecko-top100', snapshot);
        } else if (typeof universeStore.upsert === 'function') {
          universeStore.upsert('coingecko-top100', snapshot);
        } else {
          universeStore.add(snapshot);
        }
        upserted = { inserted: existing ? 0 : 1, updated: existing ? 1 : 0, total: 1 };
      } else {
        upserted = upsertSeriesPage(seriesStore, rows);
      }

      const stored = adapter.id === 'coingecko-top100'
        ? [{ timestamp: fetched.snapshot && fetched.snapshot.timestamp }]
        : rowsForAdapter(seriesStore, adapter.id, adapter.symbol, adapter.interval);
      const lastTs = maxTimestamp(rows) ?? (previous && previous.lastTimestamp) ?? null;
      const record = buildWatermarkRecord({
        source: adapter.id,
        symbol: adapter.symbol,
        interval: adapter.interval,
        lastTimestamp: lastTs,
        lastSuccessAt: now(),
        rowCount: stored.length,
        previous
      });

      if (typeof watermarkStore.upsert === 'function') {
        watermarkStore.upsert(record.id, record);
      } else if (previous && typeof watermarkStore.update === 'function') {
        watermarkStore.update(record.id, record);
      } else {
        watermarkStore.add(record);
      }

      return {
        ...started,
        status: 'ok',
        fetched: incoming.length,
        upserted: upserted.inserted + upserted.updated,
        inserted: upserted.inserted,
        updated: upserted.updated,
        rowCount: record.rowCount,
        lastTimestamp: record.lastTimestamp,
        lastSuccessAt: record.lastSuccessAt,
        gaps: issues.filter((issue) => issue.type === 'gap').length,
        issues: issues.map((issue) => issue.type),
        requestUrls: fetched.requestUrls || [],
        requestedSince: fetched.requestedSince ?? since,
        nextCursor: fetched.nextCursor,
        mode: adapter.mode,
        note: fetched.note || null,
        fallback: fetched.fallback || null
      };
    } catch (error) {
      errorLogStore.add({
        type: 'refresh_error',
        source: adapter.id,
        symbol: adapter.symbol,
        interval: adapter.interval,
        message: error.message,
        createdAt: now()
      });
      return {
        ...started,
        status: 'error',
        error: error.message,
        lastTimestamp: previous && previous.lastTimestamp,
        lastSuccessAt: previous && previous.lastSuccessAt,
        rowCount: previous && previous.rowCount,
        requestedSince: since,
        mode: adapter.mode
      };
    }
  }

  async function runRefresh(filter = {}) {
    if (state.running) {
      return { ...getStatus(), error: 'Refresh already running' };
    }

    state.running = true;
    const selected = adapterList.filter((adapter) => matchesFilter(adapter, filter));
    const results = [];

    try {
      for (const adapter of selected) {
        const result = await refreshOne(adapter);
        results.push(result);
        const idx = state.sources.findIndex((entry) => (
          entry.id === result.id && entry.symbol === result.symbol && entry.interval === result.interval
        ));
        if (idx >= 0) {
          state.sources[idx] = { ...state.sources[idx], ...result };
        } else {
          state.sources.push(result);
        }
      }
      state.lastRunAt = now();
      hydrateFromWatermarks(state.lastRunAt);
      return {
        ...getStatus(),
        ran: results
      };
    } finally {
      state.running = false;
    }
  }

  hydrateFromWatermarks(now());

  return {
    adapters: adapterList,
    runRefresh,
    getStatus,
    hydrateFromWatermarks
  };
}

let defaultRuntime = null;

export function getRefreshRuntime() {
  if (!defaultRuntime) {
    defaultRuntime = createRefreshRuntime();
  }
  return defaultRuntime;
}

export function resetRefreshRuntime() {
  defaultRuntime = null;
}
