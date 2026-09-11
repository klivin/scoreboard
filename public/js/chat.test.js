import { test } from 'node:test';
import assert from 'node:assert';
import {
  CHAT_SCHEMA_VERSION,
  CHAT_STORAGE_KEY,
  CHAT_MODEL_OPTIONS,
  migrateChatState,
  modelsForProvider,
  normalizeChatSettings
} from './chat/schema.js';
import { ChatStore, MemoryStorage } from './chat/store.js';
import { buildChatPaneHtml, providerNoteText } from './chat/view.js';
import { ChatController, cardFromDataset, postChat } from './chat/controller.js';
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
  const current = {
    schemaVersion: 1,
    namespace: 'chat',
    collections: {
      messages: [{
        id: 'm1',
        role: 'user',
        createdAt: 1,
        content: [{ type: 'text', markdown: 'load SKR' }]
      }],
      settings: { provider: 'xai', model: 'grok-4.6', apiKey: 'sk-should-drop' }
    }
  };
  const migrated = migrateChatState(current);
  assert.strictEqual(migrated.schemaVersion, CHAT_SCHEMA_VERSION);
  assert.strictEqual(CHAT_SCHEMA_VERSION, 2);
  assert.strictEqual(migrated.migratedFrom, 1);
  assert.strictEqual(migrated.collections.messages[0].id, 'm1');
  assert.deepStrictEqual(migrated.collections.settings, { provider: 'xai', model: 'grok-4.6' });
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

test('Chat pane chrome has no NFA banner or disclaimer spam', () => {
  const html = buildChatPaneHtml({ messages: [], provider: 'stub' });
  assert.doesNotMatch(html, /chat-nfa-banner/);
  assert.doesNotMatch(html, /not financial advice/i);
  assert.doesNotMatch(html, /\bNFA\b/);
  assert.match(html, /chat-provider-select/);
  assert.match(html, /chat-model-select/);
  const withMsgs = buildChatPaneHtml({
    messages: [{
      role: 'assistant',
      content: [{ type: 'text', markdown: 'hi' }]
    }],
    provider: 'xai',
    model: 'grok-4.6',
    hasLiveLlm: true
  });
  assert.doesNotMatch(withMsgs, /chat-nfa-banner/);
  assert.doesNotMatch(withMsgs, /not financial advice/i);
  assert.doesNotMatch(withMsgs, /\bNFA\b/);
  assert.match(withMsgs, /Live function-calling provider: xai · grok-4\.6/);
});

test('OpenAI chat picker lists GPT-5.6 family then existing 4o/4.1 options', () => {
  assert.deepStrictEqual(CHAT_MODEL_OPTIONS.openai.map((row) => row.id), [
    'gpt-5.6-sol',
    'gpt-5.6',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4.1-mini'
  ]);
  assert.deepStrictEqual(CHAT_MODEL_OPTIONS.xai.map((row) => row.id), [
    'grok-4.6',
    'grok-4.5',
    'grok-4'
  ]);
  assert.deepStrictEqual(modelsForProvider('openai').map((row) => row.label), [
    'GPT-5.6 Sol',
    'GPT-5.6 (alias → Sol)',
    'GPT-5.6 Terra',
    'GPT-5.6 Luna',
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4.1-mini'
  ]);
  const html = buildChatPaneHtml({
    messages: [],
    settings: { provider: 'openai', model: 'gpt-5.6-sol' }
  });
  assert.match(html, /value="gpt-5\.6-sol"/);
  assert.match(html, /GPT-5\.6 Sol/);
  assert.match(html, /GPT-5\.6 \(alias → Sol\)/);
  assert.match(html, /GPT-5\.6 Terra/);
  assert.match(html, /GPT-5\.6 Luna/);
  assert.match(html, /value="gpt-4o-mini"/);
  assert.doesNotMatch(html, /value="grok-4\.6"/);
  const xaiHtml = buildChatPaneHtml({
    messages: [],
    settings: { provider: 'xai', model: 'grok-4.6' }
  });
  assert.match(xaiHtml, /value="grok-4\.6"/);
  assert.match(xaiHtml, /value="grok-4\.5"/);
  assert.match(xaiHtml, /value="grok-4"/);
});

test('normalizeChatSettings drops key-like fields', () => {
  assert.deepStrictEqual(normalizeChatSettings({
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'sk-secret',
    SCOREBOARD_XAI_API_KEY: 'xai-secret'
  }), { provider: 'openai', model: 'gpt-4o-mini' });
  assert.strictEqual(normalizeChatSettings({ model: 'sk-proj-nope' }).model, null);
});

test('ChatStore persists provider/model override without keys', () => {
  const storage = new MemoryStorage();
  const store = new ChatStore({ storage });
  store.load();
  store.setSettings({
    provider: 'xai',
    model: 'grok-4.6',
    apiKey: 'sk-never-store'
  });
  store.appendMessage({ role: 'user', content: [{ type: 'text', markdown: 'hi' }] });
  store.clear();
  const again = new ChatStore({ storage });
  assert.deepStrictEqual(again.getSettings(), { provider: 'xai', model: 'grok-4.6' });
  assert.strictEqual(again.listMessages().length, 0);
  const raw = JSON.parse(storage.getItem(CHAT_STORAGE_KEY));
  assert.strictEqual(raw.schemaVersion, 2);
  assert.ok(!JSON.stringify(raw).includes('sk-never-store'));
  assert.ok(!Object.prototype.hasOwnProperty.call(raw.collections.settings, 'apiKey'));
});

test('provider note distinguishes stub vs live', () => {
  assert.match(providerNoteText({ provider: 'stub', hasLiveLlm: false }), /local demo provider/i);
  assert.match(providerNoteText({ provider: 'xai', model: 'grok-4.6', hasLiveLlm: true }), /Live function-calling provider: xai · grok-4\.6/);
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

test('ChatController applySettings persists override and refetches status', async () => {
  const storage = new MemoryStorage();
  const fetches = [];
  const controller = new ChatController({
    storage,
    view: { root: null, render() {} },
    fetchStatus: async (opts) => {
      fetches.push(opts);
      return {
        provider: (opts && opts.provider) || 'xai',
        model: (opts && opts.model) || 'grok-4.6',
        hasLiveLlm: true,
        envDefault: { provider: 'xai', model: 'grok-4.6' }
      };
    }
  });
  await controller.init();
  await controller.applySettings({ provider: 'openai', model: 'gpt-4o-mini' });
  assert.deepStrictEqual(controller.store.getSettings(), { provider: 'openai', model: 'gpt-4o-mini' });
  assert.strictEqual(controller.provider, 'openai');
  assert.strictEqual(controller.llmModel, 'gpt-4o-mini');
  assert.deepStrictEqual(fetches.at(-1), { provider: 'openai', model: 'gpt-4o-mini' });
});

test('postChat sends provider/model override and never a key', async () => {
  let body;
  await postChat(
    [{ role: 'user', content: [{ type: 'text', markdown: 'hi' }] }],
    {
      provider: 'xai',
      model: 'grok-4.6',
      fetchImpl: async (_url, opts) => {
        body = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ provider: 'xai', content: [] }) };
      }
    }
  );
  assert.strictEqual(body.provider, 'xai');
  assert.strictEqual(body.model, 'grok-4.6');
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'apiKey'));
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
