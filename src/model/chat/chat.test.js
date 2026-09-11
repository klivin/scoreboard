import { test } from 'node:test';
import assert from 'node:assert';
import { defaultCatalog, findCatalogMentions, lookupAsset } from './catalog.js';
import { resolveAssets, searchAssets, getChartContext, createToolRunner } from './tools.js';
import { sanitizeAssistantContent, cardsFromResolved } from './blocks.js';
import { createStubProvider, stubIntent } from './stub.js';
import { runChatTurn, chatStatus } from './loop.js';
import { detectChatProvider } from './provider.js';

const catalog = defaultCatalog();

test('resolve_assets: known query succeeds with load payload', () => {
  const [row] = resolveAssets(['bitcoin'], catalog);
  assert.strictEqual(row.ok, true);
  assert.strictEqual(row.symbol, 'BTC');
  assert.strictEqual(row.assetClass, 'crypto');
  assert.strictEqual(row.scoreboardId, 'crypto:BTC');
  assert.deepStrictEqual(row.load, { symbol: 'BTC', assetClass: 'crypto', intervalHint: '1d' });
});

test('resolve_assets: unknown is rejected', () => {
  const [row] = resolveAssets(['ZZQXNOTATICKER'], catalog);
  assert.strictEqual(row.ok, false);
  assert.strictEqual(row.load, null);
  assert.strictEqual(row.symbol, null);
});

test('resolve_assets: SKR and MSTR are cataloged', () => {
  assert.strictEqual(lookupAsset('SKR', catalog).symbol, 'SKR');
  assert.strictEqual(lookupAsset('microstrategy', catalog).symbol, 'MSTR');
  assert.strictEqual(lookupAsset('MSTR', catalog).assetClass, 'equity');
});

test('search_assets buybacks returns tagged coins then resolve succeeds', () => {
  const search = searchAssets('what are 5 crypto coins that are doing buybacks', catalog);
  assert.ok(search.hits.length >= 5);
  assert.match(search.note, /not a live/i);
  const symbols = search.hits.map((hit) => hit.symbol);
  assert.ok(symbols.includes('BNB'));
  const resolved = resolveAssets(symbols, catalog);
  assert.ok(resolved.every((row) => row.ok));
});

test('get_chart_context never invents OHLCV', () => {
  const missing = getChartContext('crypto:BTC', { getSeries: () => [] });
  assert.strictEqual(missing.ok, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(missing, 'open'));

  const cached = getChartContext('crypto:BTC', {
    getSeries: () => [{ timestamp: 1, date_utc: '2026-09-01', close: 100 }]
  });
  assert.strictEqual(cached.ok, true);
  assert.strictEqual(cached.last.close, 100);
  assert.strictEqual(cached.barCount, 1);
});

test('sanitize strips hallucinated cards without resolve', () => {
  const cleaned = sanitizeAssistantContent([
    { type: 'text', markdown: 'Hello' },
    {
      type: 'asset_card',
      symbol: 'FAKE',
      name: 'Fake',
      assetClass: 'crypto',
      scoreboardId: 'crypto:FAKE',
      load: { symbol: 'FAKE', assetClass: 'crypto', intervalHint: '1d' }
    }
  ], []);
  assert.strictEqual(cleaned.some((block) => block.type === 'asset_card'), false);
});

test('cardsFromResolved only emits successful rows', () => {
  const content = cardsFromResolved(resolveAssets(['BTC', 'NOPE'], catalog));
  const cards = content.filter((block) => block.type === 'asset_card');
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].symbol, 'BTC');
  assert.match(content[0].markdown, /couldn['’]t resolve NOPE/i);
});

test('tool loop: resolve success → cards', async () => {
  const result = await runChatTurn({
    messages: [{ role: 'user', content: 'load SKR' }],
    provider: createStubProvider({ catalog }),
    tools: createToolRunner({ catalog })
  });
  const cards = result.content.filter((block) => block.type === 'asset_card');
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].symbol, 'SKR');
  assert.deepStrictEqual(cards[0].load, { symbol: 'SKR', assetClass: 'crypto', intervalHint: '1d' });
  assert.ok(result.toolTrace.some((row) => row.name === 'resolve_assets'));
});

test('tool loop: unknown → no card', async () => {
  const result = await runChatTurn({
    messages: [{ role: 'user', content: 'load ZZQXNOTATICKER' }],
    provider: createStubProvider({ catalog }),
    tools: createToolRunner({ catalog })
  });
  assert.strictEqual(result.content.some((block) => block.type === 'asset_card'), false);
  assert.match(result.content.map((block) => block.markdown || '').join(' '), /couldn['’]t resolve/i);
});

test('tool loop: search_assets → resolve → cards', async () => {
  const result = await runChatTurn({
    messages: [{ role: 'user', content: 'what are 5 crypto coins that are doing buybacks' }],
    provider: createStubProvider({ catalog }),
    tools: createToolRunner({ catalog })
  });
  const names = result.toolTrace.map((row) => row.name);
  assert.ok(names.includes('search_assets'));
  assert.ok(names.includes('resolve_assets'));
  const cards = result.content.filter((block) => block.type === 'asset_card');
  assert.ok(cards.length >= 5);
  assert.ok(cards.every((card) => card.load && card.load.symbol));
});

test('tool loop: compare MSTR vs BTC via tools', async () => {
  const result = await runChatTurn({
    messages: [{ role: 'user', content: 'compare MSTR vs BTC' }],
    provider: createStubProvider({ catalog }),
    tools: createToolRunner({ catalog })
  });
  const cards = result.content.filter((block) => block.type === 'asset_card');
  assert.deepStrictEqual(cards.map((card) => card.symbol).sort(), ['BTC', 'MSTR']);
  assert.ok(result.toolTrace.some((row) => row.name === 'resolve_assets'));
});

test('stub intent does not treat random prose as tickers', () => {
  const intent = stubIntent('how does the naive baseline work?', catalog);
  assert.strictEqual(intent.search, false);
  assert.deepStrictEqual(intent.queries, []);
  assert.ok(findCatalogMentions('compare microstrategy versus bitcoin', catalog).includes('MSTR'));
});

test('chatStatus is stub without keys', () => {
  const status = chatStatus({});
  assert.strictEqual(status.provider, 'stub');
  assert.strictEqual(status.hasLiveLlm, false);
  assert.strictEqual(detectChatProvider({ OPENAI_API_KEY: 'sk-test' }).id, 'openai');
  assert.strictEqual(detectChatProvider({ XAI_API_KEY: 'xai-test' }).id, 'xai');
});
