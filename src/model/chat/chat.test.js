import { test } from 'node:test';
import assert from 'node:assert';
import { defaultCatalog, findCatalogMentions, lookupAsset } from './catalog.js';
import { resolveAssets, searchAssets, getChartContext, createToolRunner, TOOL_DEFINITIONS } from './tools.js';
import { sanitizeAssistantContent, cardsFromResolved } from './blocks.js';
import { createStubProvider, stubIntent } from './stub.js';
import { runChatTurn, chatStatus } from './loop.js';
import { createChatProvider } from './provider.js';
import { extractTickerQueries } from '../ticker.js';
import {
  detectChatProvider,
  sanitizeChatOverride,
  isGpt56Family,
  usesOpenAiResponsesApi,
  toResponsesTools,
  toResponsesInput,
  parseResponsesBody,
  DEFAULT_XAI_MODEL,
  DEFAULT_OPENAI_MODEL
} from './provider.js';
import { SYSTEM_PROMPT } from './prompt.js';

const catalog = defaultCatalog();

function offlineTools(extra = {}) {
  return createToolRunner({
    catalog,
    refreshSeries: async ({ symbol }) => ({
      ok: false,
      symbol,
      ran: [],
      note: 'offline test refresh — no network'
    }),
    webSearch: async (query) => ({
      query,
      results: [],
      note: 'offline test search — no network'
    }),
    ...extra
  });
}

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

test('resolve_assets: CDNS-like equity resolves without catalog allowlist', () => {
  assert.strictEqual(lookupAsset('CDNS', catalog), null);
  const [row] = resolveAssets(['CDNS'], catalog);
  assert.strictEqual(row.ok, true);
  assert.strictEqual(row.symbol, 'CDNS');
  assert.strictEqual(row.assetClass, 'equity');
  assert.strictEqual(row.scoreboardId, 'equity:CDNS');
  assert.strictEqual(row.catalogHint, false);
  assert.deepStrictEqual(row.load, { symbol: 'CDNS', assetClass: 'equity', intervalHint: '1d' });
  assert.ok(!catalog.some((asset) => asset.symbol === 'CDNS'), 'CDNS must not be a hardcoded catalog row');
});

test('extractTickerQueries finds CDNS in an entry question', () => {
  assert.deepStrictEqual(extractTickerQueries('good entry for CDNS / thinking of buying more'), ['CDNS']);
  assert.deepStrictEqual(stubIntent('good entry for CDNS (Cadence)', catalog).queries, ['CDNS']);
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
  const content = cardsFromResolved(resolveAssets(['BTC', 'ZZQXNOTATICKER'], catalog));
  const cards = content.filter((block) => block.type === 'asset_card');
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].symbol, 'BTC');
  assert.match(content[0].markdown, /couldn['’]t resolve ZZQXNOTATICKER/i);
});

test('tool loop: resolve success → cards', async () => {
  const result = await runChatTurn({
    messages: [{ role: 'user', content: 'load SKR' }],
    provider: createStubProvider({ catalog }),
    tools: offlineTools()
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
    tools: offlineTools()
  });
  assert.strictEqual(result.content.some((block) => block.type === 'asset_card'), false);
  assert.match(result.content.map((block) => block.markdown || '').join(' '), /couldn['’]t resolve/i);
});

test('named-ticker tool order: resolve → refresh → chart → web_search → card', async () => {
  const chartSeries = [{
    timestamp: Date.parse('2026-09-11T13:30:00Z'),
    date_utc: '2026-09-11',
    close: 289.37
  }];
  const result = await runChatTurn({
    messages: [{ role: 'user', content: 'good entry for CDNS / thinking of buying more' }],
    provider: createStubProvider({ catalog }),
    tools: createToolRunner({
      catalog,
      getSeries: (symbol) => (symbol === 'CDNS' ? chartSeries : []),
      refreshSeries: async ({ symbol }) => ({
        ok: true,
        symbol,
        ran: [{ id: 'stock-public', symbol, interval: '1d', status: 'ok', rowCount: 5 }]
      }),
      webSearch: async (query) => ({
        query,
        results: [{
          title: 'Why Cadence Design Systems (CDNS) Dipped More Than Broader Market Today',
          url: 'https://example.test/cdns-news',
          snippet: 'Recorded-style headline fixture for tool-order tests. Not a live feed.',
          source: 'yahoo-news'
        }],
        note: 'test search'
      })
    })
  });
  const names = result.toolTrace.map((row) => row.name);
  assert.deepStrictEqual(names, [
    'resolve_assets',
    'refresh_series',
    'get_chart_context',
    'web_search'
  ]);
  const cards = result.content.filter((block) => block.type === 'asset_card');
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].symbol, 'CDNS');
  assert.strictEqual(cards[0].scoreboardId, 'equity:CDNS');
  const text = result.content.map((block) => block.markdown || '').join(' ');
  assert.doesNotMatch(text, /couldn['’]t resolve/i);
  assert.match(text, /289\.37|2026-09-11/);
  assert.match(text, /Dipped More Than Broader Market|Recent:/i);
});

test('TOOL_DEFINITIONS include refresh_series and web_search', () => {
  const names = TOOL_DEFINITIONS.map((def) => def.function.name);
  assert.ok(names.includes('resolve_assets'));
  assert.ok(names.includes('refresh_series'));
  assert.ok(names.includes('get_chart_context'));
  assert.ok(names.includes('web_search'));
});

test('prompt requires load-then-research and forbids catalog-only resolve language', () => {
  assert.match(SYSTEM_PROMPT, /refresh_series/);
  assert.match(SYSTEM_PROMPT, /web_search/);
  assert.match(SYSTEM_PROMPT, /catalog is hints/i);
  assert.match(SYSTEM_PROMPT, /Never reply that you could not resolve a real listed ticker/i);
  assert.doesNotMatch(SYSTEM_PROMPT, /Reject unknowns/);
  assert.doesNotMatch(SYSTEM_PROMPT, /not financial advice/i);
});

test('tool loop: search_assets → resolve → cards', async () => {
  const result = await runChatTurn({
    messages: [{ role: 'user', content: 'what are 5 crypto coins that are doing buybacks' }],
    provider: createStubProvider({ catalog }),
    tools: offlineTools()
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
    tools: offlineTools()
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
  assert.strictEqual(status.model, null);
  assert.deepStrictEqual(status.availableProviders, []);
  assert.ok(!Object.prototype.hasOwnProperty.call(status, 'apiKey'));
  assert.strictEqual(detectChatProvider({ OPENAI_API_KEY: 'sk-test' }).id, 'openai');
  assert.strictEqual(detectChatProvider({ XAI_API_KEY: 'xai-test' }).id, 'xai');
});

test('detectChatProvider prefers SCOREBOARD_XAI_API_KEY and defaults grok-4.6', () => {
  const detected = detectChatProvider({
    SCOREBOARD_XAI_API_KEY: 'test-xai',
    SCOREBOARD_OPENAI_API_KEY: 'test-openai'
  });
  assert.strictEqual(detected.id, 'xai');
  assert.strictEqual(detected.model, DEFAULT_XAI_MODEL);
  assert.strictEqual(DEFAULT_XAI_MODEL, 'grok-4.6');
  assert.strictEqual(detected.baseUrl, 'https://api.x.ai/v1');
});

test('detectChatProvider accepts legacy XAI/GROK/OPENAI aliases', () => {
  assert.strictEqual(detectChatProvider({ GROK_API_KEY: 'test-grok' }).id, 'xai');
  assert.strictEqual(detectChatProvider({ XAI_API_KEY: 'test-xai' }).model, 'grok-4.6');
  const openai = detectChatProvider({ OPENAI_API_KEY: 'test-openai' });
  assert.strictEqual(openai.id, 'openai');
  assert.strictEqual(openai.model, DEFAULT_OPENAI_MODEL);
  assert.strictEqual(DEFAULT_OPENAI_MODEL, 'gpt-4o-mini');
});

test('SCOREBOARD_CHAT_PROVIDER and SCOREBOARD_CHAT_MODEL override defaults', () => {
  const detected = detectChatProvider({
    SCOREBOARD_XAI_API_KEY: 'test-xai',
    SCOREBOARD_OPENAI_API_KEY: 'test-openai',
    SCOREBOARD_CHAT_PROVIDER: 'openai',
    SCOREBOARD_CHAT_MODEL: 'gpt-4o'
  });
  assert.strictEqual(detected.id, 'openai');
  assert.strictEqual(detected.model, 'gpt-4o');
});

test('request provider/model beat env; request keys are ignored', () => {
  const env = {
    SCOREBOARD_XAI_API_KEY: 'test-xai',
    SCOREBOARD_OPENAI_API_KEY: 'test-openai',
    SCOREBOARD_CHAT_PROVIDER: 'xai',
    SCOREBOARD_CHAT_MODEL: 'grok-4.6'
  };
  const detected = detectChatProvider(env, {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'should-never-be-used'
  });
  assert.strictEqual(detected.id, 'openai');
  assert.strictEqual(detected.model, 'gpt-4o-mini');
  assert.strictEqual(detected.apiKey, 'test-openai');
  const ignored = sanitizeChatOverride({
    provider: 'openai',
    model: 'sk-proj-fake',
    apiKey: 'sk-proj-fake'
  });
  assert.deepStrictEqual(ignored, { provider: 'openai', model: null });
});

test('request for a provider without a usable key stays stub', () => {
  const status = chatStatus({ SCOREBOARD_XAI_API_KEY: 'test-xai' }, { provider: 'openai' });
  assert.strictEqual(status.provider, 'stub');
  assert.strictEqual(status.hasLiveLlm, false);
  assert.deepStrictEqual(status.availableProviders, ['xai']);
  assert.strictEqual(status.envDefault.provider, 'xai');
  assert.strictEqual(status.envDefault.model, 'grok-4.6');
});

test('custom SCOREBOARD base URLs win over legacy aliases', () => {
  const xai = detectChatProvider({
    SCOREBOARD_XAI_API_KEY: 'test-xai',
    SCOREBOARD_XAI_BASE_URL: 'https://example.test/xai/',
    XAI_BASE_URL: 'https://ignored.example/xai'
  });
  assert.strictEqual(xai.baseUrl, 'https://example.test/xai');
  const openai = detectChatProvider({
    SCOREBOARD_OPENAI_API_KEY: 'test-openai',
    SCOREBOARD_OPENAI_BASE_URL: 'https://example.test/openai/'
  });
  assert.strictEqual(openai.baseUrl, 'https://example.test/openai');
});

test('chatStatus never serializes key material', () => {
  const status = chatStatus({
    SCOREBOARD_XAI_API_KEY: 'super-secret-xai',
    SCOREBOARD_OPENAI_API_KEY: 'super-secret-openai'
  });
  const json = JSON.stringify(status);
  assert.ok(!json.includes('super-secret'));
  assert.ok(!json.includes('apiKey'));
  assert.strictEqual(status.provider, 'xai');
  assert.strictEqual(status.hasLiveLlm, true);
  assert.strictEqual(status.model, 'grok-4.6');
});

test('live provider posts OpenAI-compatible tools to the selected model', async () => {
  const calls = [];
  const provider = createChatProvider({
    env: { SCOREBOARD_XAI_API_KEY: 'test-xai' },
    override: { model: 'grok-4.6' },
    fetchImpl: async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return {
        ok: true,
        text: async () => JSON.stringify({
          choices: [{ message: { content: '{"content":[{"type":"text","markdown":"ok"}]}' } }]
        })
      };
    }
  });
  assert.strictEqual(provider.id, 'xai');
  assert.strictEqual(provider.api, 'chat_completions');
  await provider.complete([{ role: 'user', content: 'hello' }], [{ type: 'function', function: { name: 'resolve_assets' } }]);
  assert.strictEqual(calls[0].url, 'https://api.x.ai/v1/chat/completions');
  assert.strictEqual(calls[0].body.model, 'grok-4.6');
  assert.strictEqual(calls[0].body.tool_choice, 'auto');
  assert.ok(Array.isArray(calls[0].body.tools));
  assert.ok(!Object.prototype.hasOwnProperty.call(calls[0].body, 'reasoning_effort'));
});

test('isGpt56Family covers Sol/Terra/Luna and the gpt-5.6 alias', () => {
  assert.strictEqual(isGpt56Family('gpt-5.6-sol'), true);
  assert.strictEqual(isGpt56Family('gpt-5.6'), true);
  assert.strictEqual(isGpt56Family('gpt-5.6-terra'), true);
  assert.strictEqual(isGpt56Family('gpt-5.6-luna'), true);
  assert.strictEqual(isGpt56Family('gpt-5.6-sol-2026-02-16'), true);
  assert.strictEqual(isGpt56Family('gpt-4o-mini'), false);
  assert.strictEqual(isGpt56Family('grok-4.6'), false);
  assert.strictEqual(usesOpenAiResponsesApi({ id: 'openai', model: 'gpt-5.6-sol' }), true);
  assert.strictEqual(usesOpenAiResponsesApi({ id: 'openai', model: 'gpt-4o-mini' }), false);
  assert.strictEqual(usesOpenAiResponsesApi({ id: 'xai', model: 'gpt-5.6-sol' }), false);
});

test('OpenAI GPT-5.6 family posts function tools to /v1/responses', async () => {
  for (const model of ['gpt-5.6-sol', 'gpt-5.6', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    const calls = [];
    const tools = [{
      type: 'function',
      function: { name: 'resolve_assets', description: 'Resolve', parameters: { type: 'object' } }
    }];
    const provider = createChatProvider({
      env: { SCOREBOARD_OPENAI_API_KEY: 'test-openai' },
      override: { provider: 'openai', model },
      fetchImpl: async (url, opts) => {
        calls.push({ url, body: JSON.parse(opts.body) });
        return {
          ok: true,
          text: async () => JSON.stringify({
            output: [{
              type: 'message',
              content: [{ type: 'output_text', text: '{"content":[{"type":"text","markdown":"ok"}]}' }]
            }]
          })
        };
      }
    });
    assert.strictEqual(provider.id, 'openai');
    assert.strictEqual(provider.api, 'responses');
    const result = await provider.complete([{ role: 'user', content: 'hello' }], tools);
    assert.strictEqual(calls[0].url, 'https://api.openai.com/v1/responses');
    assert.strictEqual(calls[0].body.model, model);
    assert.strictEqual(calls[0].body.tool_choice, 'auto');
    assert.strictEqual(calls[0].body.instructions, SYSTEM_PROMPT);
    assert.strictEqual(calls[0].body.store, false);
    assert.ok(!Object.prototype.hasOwnProperty.call(calls[0].body, 'temperature'));
    assert.ok(!Object.prototype.hasOwnProperty.call(calls[0].body, 'reasoning_effort'));
    assert.deepStrictEqual(calls[0].body.tools, [{
      type: 'function',
      name: 'resolve_assets',
      description: 'Resolve',
      parameters: { type: 'object' }
    }]);
    assert.deepStrictEqual(calls[0].body.input[0], { role: 'user', content: 'hello' });
    assert.strictEqual(result.content[0].markdown.includes('ok') || result.content[0].type === 'text', true);
  }
});

test('OpenAI gpt-4o-mini stays on chat/completions', async () => {
  const calls = [];
  const provider = createChatProvider({
    env: { SCOREBOARD_OPENAI_API_KEY: 'test-openai' },
    override: { provider: 'openai', model: 'gpt-4o-mini' },
    fetchImpl: async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return {
        ok: true,
        text: async () => JSON.stringify({
          choices: [{ message: { content: '{"content":[{"type":"text","markdown":"ok"}]}' } }]
        })
      };
    }
  });
  assert.strictEqual(provider.api, 'chat_completions');
  await provider.complete([{ role: 'user', content: 'hello' }], [{ type: 'function', function: { name: 'resolve_assets' } }]);
  assert.strictEqual(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.strictEqual(calls[0].body.temperature, 0.2);
  assert.ok(!Object.prototype.hasOwnProperty.call(calls[0].body, 'reasoning_effort'));
});

test('Responses adapter maps tool_calls into the existing loop shape', async () => {
  const calls = [];
  const provider = createChatProvider({
    env: { SCOREBOARD_OPENAI_API_KEY: 'test-openai' },
    override: { provider: 'openai', model: 'gpt-5.6-sol' },
    fetchImpl: async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url, body });
      const hasToolOutput = (body.input || []).some((item) => item.type === 'function_call_output');
      if (!hasToolOutput) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            output: [{
              type: 'function_call',
              id: 'fc_1',
              call_id: 'call_skr',
              name: 'resolve_assets',
              arguments: '{"queries":["SKR"]}'
            }]
          })
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({
          output: [{
            type: 'message',
            content: [{
              type: 'output_text',
              text: JSON.stringify({
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
            }]
          }]
        })
      };
    }
  });
  const result = await runChatTurn({
    messages: [{ role: 'user', content: 'load SKR' }],
    provider,
    tools: createToolRunner({ catalog })
  });
  assert.strictEqual(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.ok(calls[1].body.input.some((item) => item.type === 'function_call' && item.name === 'resolve_assets'));
  assert.ok(calls[1].body.input.some((item) => item.type === 'function_call_output' && item.call_id === 'call_skr'));
  const cards = result.content.filter((block) => block.type === 'asset_card');
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].symbol, 'SKR');
  assert.ok(result.toolTrace.some((row) => row.name === 'resolve_assets'));
  assert.ok(!Object.prototype.hasOwnProperty.call(result, 'disclaimer'));
});

test('toResponsesTools / toResponsesInput / parseResponsesBody stay DRY', () => {
  assert.deepStrictEqual(toResponsesTools([{
    type: 'function',
    function: { name: 'search_assets', description: 'Search', parameters: { type: 'object' } }
  }]), [{
    type: 'function',
    name: 'search_assets',
    description: 'Search',
    parameters: { type: 'object' }
  }]);
  const input = toResponsesInput([
    { role: 'user', content: 'load SKR' },
    { role: 'assistant', content: null, toolCalls: [{ id: 'call_1', name: 'resolve_assets', args: { queries: ['SKR'] } }] },
    { role: 'tool', toolCallId: 'call_1', content: '{"ok":true}' }
  ]);
  assert.deepStrictEqual(input, [
    { role: 'user', content: 'load SKR' },
    { type: 'function_call', call_id: 'call_1', name: 'resolve_assets', arguments: '{"queries":["SKR"]}' },
    { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' }
  ]);
  const parsed = parseResponsesBody({
    output: [{ type: 'function_call', call_id: 'c1', name: 'resolve_assets', arguments: '{"queries":["BTC"]}' }]
  });
  assert.deepStrictEqual(parsed.toolCalls, [{ id: 'c1', name: 'resolve_assets', args: { queries: ['BTC'] } }]);
});

test('stub and live replies do not append NFA disclaimer spam', async () => {
  const result = await runChatTurn({
    messages: [{ role: 'user', content: 'load SKR' }],
    provider: createStubProvider({ catalog }),
    tools: offlineTools()
  });
  const text = result.content.map((block) => block.markdown || '').join(' ');
  assert.doesNotMatch(text, /not financial advice/i);
  assert.doesNotMatch(text, /\bNFA\b/);
  assert.ok(!Object.prototype.hasOwnProperty.call(result, 'disclaimer'));
  const status = chatStatus({});
  assert.ok(!Object.prototype.hasOwnProperty.call(status, 'disclaimer'));
  assert.doesNotMatch(SYSTEM_PROMPT, /not financial advice/i);
  assert.doesNotMatch(SYSTEM_PROMPT, /\bNFA\b/);
  const empty = await createStubProvider({ catalog }).complete([{ role: 'user', content: 'how does the naive baseline work?' }]);
  assert.doesNotMatch(empty.content[0].markdown, /not financial advice/i);
  assert.doesNotMatch(empty.content[0].markdown, /\bNFA\b/);
  const notes = result.content
    .filter((block) => block.type === 'asset_card')
    .flatMap((card) => card.strategyConsiderations || []);
  assert.ok(notes.every((note) => !/not a recommendation to buy or sell/i.test(note)));
});
