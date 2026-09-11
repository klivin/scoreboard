import { test } from 'node:test';
import assert from 'node:assert';
import {
  CHAT_SCHEMA_VERSION,
  CHAT_STORAGE_KEY,
  migrateChatState,
  emptyChatState
} from './chat/schema.js';
import { ChatStore, MemoryStorage } from './chat/store.js';
import { buildChatPaneHtml, NFA_BANNER_TEXT } from './chat/view.js';
import { ChatController, cardFromDataset } from './chat/controller.js';
import { loadPayloadFromCard, normalizeLoadPayload, applyLoadAssetToDom } from './load-asset.js';

test('chat history schema migration wraps unversioned arrays', () => {
  const migrated = migrateChatState([
    { role: 'user', text: 'hello' },
    { role: 'assistant', content: 'hi' }
  ]);
  assert.strictEqual(migrated.schemaVersion, CHAT_SCHEMA_VERSION);
  assert.strictEqual(migrated.namespace, 'chat');
  assert.strictEqual(migrated.migratedFrom, 0);
  assert.strictEqual(migrated.collections.messages.length, 2);
  assert.strictEqual(migrated.collections.messages[0].content[0].markdown, 'hello');
});

test('chat history schema migration keeps v1 messages', () => {
  const current = emptyChatState();
  current.collections.messages.push({
    id: 'm1',
    role: 'user',
    createdAt: 1,
    content: [{ type: 'text', markdown: 'load SKR' }]
  });
  const migrated = migrateChatState(current);
  assert.strictEqual(migrated.schemaVersion, 1);
  assert.strictEqual(migrated.collections.messages[0].id, 'm1');
});

test('ChatStore persists after migrate', () => {
  const storage = new MemoryStorage({
    [CHAT_STORAGE_KEY]: JSON.stringify({ messages: [{ role: 'user', text: 'old' }] })
  });
  const store = new ChatStore({ storage });
  store.load();
  assert.strictEqual(store.listMessages()[0].content[0].markdown, 'old');
  store.appendMessage({ role: 'assistant', content: [{ type: 'text', markdown: 'ok' }] });
  const again = new ChatStore({ storage });
  assert.strictEqual(again.listMessages().length, 2);
});

test('NFA banner is always in the chat pane chrome', () => {
  const html = buildChatPaneHtml({ messages: [], provider: 'stub' });
  assert.match(html, /chat-nfa-banner/);
  assert.ok(html.includes(NFA_BANNER_TEXT));
  const withMsgs = buildChatPaneHtml({
    messages: [{
      role: 'assistant',
      content: [{ type: 'text', markdown: 'hi' }]
    }],
    provider: 'xai'
  });
  assert.match(withMsgs, /chat-nfa-banner/);
  assert.ok(withMsgs.includes(NFA_BANNER_TEXT));
});

test('tap/load handler receives load payload', async () => {
  const loads = [];
  const storage = new MemoryStorage();
  const controller = new ChatController({
    storage,
    view: { root: null, render() {} },
    onLoadAsset: (payload) => { loads.push(payload); }
  });
  const payload = controller.handleCardTap({
    symbol: 'MSTR',
    name: 'Strategy',
    assetClass: 'equity',
    scoreboardId: 'equity:MSTR',
    load: { symbol: 'MSTR', assetClass: 'equity', intervalHint: '1d' }
  });
  assert.strictEqual(payload.ok, true);
  assert.deepStrictEqual(payload.load, { symbol: 'MSTR', assetClass: 'equity', intervalHint: '1d' });
  assert.deepStrictEqual(loads[0].load, payload.load);
});

test('card dataset tap builds the same load payload', () => {
  const card = cardFromDataset({
    symbol: 'BTC',
    name: 'Bitcoin',
    assetClass: 'crypto',
    scoreboardId: 'crypto:BTC',
    intervalHint: '1h'
  });
  const payload = loadPayloadFromCard(card);
  assert.deepStrictEqual(payload.load, { symbol: 'BTC', assetClass: 'crypto', intervalHint: '1h' });
});

test('loadAsset seam writes Overview symbol + interval', () => {
  const normalized = normalizeLoadPayload({
    symbol: 'eth',
    assetClass: 'crypto',
    intervalHint: '1d'
  });
  const calls = { options: [], appended: [] };
  const select = {
    options: [{ value: 'BTC' }],
    value: 'BTC',
    appendChild(opt) { calls.appended.push(opt.value); this.options.push(opt); }
  };
  const interval = { value: '1h' };
  const ticker = { value: '' };
  const documentRef = {
    getElementById(id) {
      if (id === 'symbol-select') return select;
      if (id === 'interval-select') return interval;
      if (id === 'ticker-input') return ticker;
      return null;
    },
    createElement() {
      return { value: '', textContent: '' };
    }
  };
  applyLoadAssetToDom(normalized.load, documentRef);
  assert.strictEqual(select.value, 'ETH');
  assert.strictEqual(interval.value, '1d');
  assert.strictEqual(ticker.value, 'ETH');
  assert.deepStrictEqual(calls.appended, ['ETH']);
});

test('ChatController send uses tool-loop response cards', async () => {
  const storage = new MemoryStorage();
  const controller = new ChatController({
    storage,
    view: { root: null, render() {} },
    fetchStatus: async () => ({ provider: 'stub' }),
    postChat: async () => ({
      provider: 'stub',
      content: [
        { type: 'text', markdown: 'Resolved SKR.' },
        {
          type: 'asset_card',
          symbol: 'SKR',
          name: 'SKR',
          assetClass: 'crypto',
          scoreboardId: 'crypto:SKR',
          load: { symbol: 'SKR', assetClass: 'crypto', intervalHint: '1d' }
        }
      ]
    })
  });
  await controller.send('load SKR');
  const msgs = controller.store.listMessages();
  assert.strictEqual(msgs[0].role, 'user');
  assert.strictEqual(msgs[1].content[1].type, 'asset_card');
  assert.strictEqual(msgs[1].content[1].load.symbol, 'SKR');
});
