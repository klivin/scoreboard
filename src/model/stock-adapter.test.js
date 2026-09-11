import { test } from 'node:test';
import assert from 'node:assert';
import { createStockAdapter, STOCK_ADAPTER_ID, STOCK_MISSING_NOTE } from './stock-adapter.js';
import { createRefreshRuntime } from './refresh.js';

function memoryStore(seed = []) {
  const items = seed.map((item) => ({ ...item }));
  return {
    getAll: () => items.slice(),
    getById: (id) => items.find((item) => item.id === id) || null,
    add: (item) => {
      const row = { ...item, id: item.id || `auto_${items.length}` };
      items.push(row);
      return row;
    },
    update: (id, updates) => {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return null;
      items[index] = { ...items[index], ...updates };
      return items[index];
    },
    upsert: (id, item) => {
      const index = items.findIndex((row) => row.id === id);
      if (index < 0) {
        items.push({ ...item, id });
        return { item: items[items.length - 1], inserted: true };
      }
      items[index] = { ...items[index], ...item, id };
      return { item: items[index], inserted: false };
    },
    upsertMany: (rows) => {
      let inserted = 0;
      let updated = 0;
      for (const row of rows || []) {
        const index = items.findIndex((item) => item.id === row.id);
        if (index < 0) {
          items.push({ ...row });
          inserted += 1;
        } else {
          items[index] = { ...items[index], ...row };
          updated += 1;
        }
      }
      return { inserted, updated, total: items.length };
    }
  };
}

test('stock adapter never invents rows and reports needsAdapter', async () => {
  const adapter = createStockAdapter({ symbol: 'AAPL', interval: '1d' });
  assert.strictEqual(adapter.id, STOCK_ADAPTER_ID);
  assert.strictEqual(adapter.mode, 'unconfigured');
  const result = await adapter.fetchSince({ lastTimestamp: 1, since: 1 });
  assert.deepStrictEqual(result.rows, []);
  assert.strictEqual(result.nextCursor, null);
  assert.strictEqual(result.needsAdapter, true);
  assert.match(result.note, /configured adapter/);
  assert.match(STOCK_MISSING_NOTE, /not invented/i);
});

test('refresh for AAPL does not upsert fake equity series', async () => {
  const seriesStore = memoryStore();
  const runtime = createRefreshRuntime({
    httpGet: async () => {
      throw new Error('stock path must not call HTTP');
    },
    watermarkStore: memoryStore(),
    seriesStore,
    errorLogStore: memoryStore(),
    universeStore: memoryStore(),
    adapters: []
  });
  const result = await runtime.runRefresh({ symbol: 'AAPL' });
  assert.ok(result.ran.length >= 1);
  assert.ok(result.ran.every((row) => row.status === 'missing' && row.needsAdapter));
  assert.strictEqual(seriesStore.getAll().length, 0);
});
