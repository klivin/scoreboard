import { SYSTEM_PROMPT } from './prompt.js';
import { createStubProvider } from './stub.js';
import { flattenContent, parseModelContent } from './blocks.js';

export const DEFAULT_XAI_MODEL = 'grok-4.6';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

function firstNonEmpty(env, names) {
  for (const name of names) {
    const value = env && env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function normalizeChatProviderId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (id === 'xai' || id === 'grok') return 'xai';
  if (id === 'openai') return 'openai';
  return null;
}

export function looksLikeSecretValue(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^(sk-|xai-|Bearer\s)/i.test(text)) return true;
  if (/api[_-]?key/i.test(text)) return true;
  return false;
}

export function sanitizeChatOverride(raw = {}) {
  const provider = normalizeChatProviderId(raw && raw.provider);
  let model = raw && typeof raw.model === 'string' ? raw.model.trim() : '';
  if (looksLikeSecretValue(model)) model = '';
  return {
    provider,
    model: model || null
  };
}

export function readChatSecrets(env = process.env) {
  return {
    xaiKey: firstNonEmpty(env, ['SCOREBOARD_XAI_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY']),
    openaiKey: firstNonEmpty(env, ['SCOREBOARD_OPENAI_API_KEY', 'OPENAI_API_KEY']),
    xaiBaseUrl: firstNonEmpty(env, ['SCOREBOARD_XAI_BASE_URL', 'XAI_BASE_URL']) || DEFAULT_XAI_BASE_URL,
    openaiBaseUrl: firstNonEmpty(env, ['SCOREBOARD_OPENAI_BASE_URL', 'OPENAI_BASE_URL']) || DEFAULT_OPENAI_BASE_URL,
    envProvider: normalizeChatProviderId(firstNonEmpty(env, ['SCOREBOARD_CHAT_PROVIDER'])),
    envModel: firstNonEmpty(env, ['SCOREBOARD_CHAT_MODEL', 'CHAT_MODEL'])
  };
}

export function availableChatProviders(env = process.env) {
  const secrets = readChatSecrets(env);
  const ids = [];
  if (secrets.xaiKey) ids.push('xai');
  if (secrets.openaiKey) ids.push('openai');
  return ids;
}

function pickProviderId(secrets, override) {
  const requested = override && override.provider;
  if (requested === 'xai' && secrets.xaiKey) return 'xai';
  if (requested === 'openai' && secrets.openaiKey) return 'openai';
  if (requested) return 'stub';
  if (secrets.envProvider === 'xai' && secrets.xaiKey) return 'xai';
  if (secrets.envProvider === 'openai' && secrets.openaiKey) return 'openai';
  if (secrets.xaiKey) return 'xai';
  if (secrets.openaiKey) return 'openai';
  return 'stub';
}

function pickModel(id, secrets, env, override) {
  if (override && override.model) return override.model;
  if (secrets.envModel) return secrets.envModel;
  if (id === 'xai') return firstNonEmpty(env, ['XAI_MODEL']) || DEFAULT_XAI_MODEL;
  if (id === 'openai') return firstNonEmpty(env, ['OPENAI_MODEL']) || DEFAULT_OPENAI_MODEL;
  return null;
}

export function detectChatProvider(env = process.env, override = {}) {
  const secrets = readChatSecrets(env);
  const clean = sanitizeChatOverride(override);
  const id = pickProviderId(secrets, clean);
  if (id === 'stub') {
    return { id: 'stub', model: clean.model || secrets.envModel || null };
  }
  const model = pickModel(id, secrets, env, clean);
  if (id === 'xai') {
    return {
      id,
      apiKey: secrets.xaiKey,
      baseUrl: secrets.xaiBaseUrl.replace(/\/$/, ''),
      model
    };
  }
  return {
    id,
    apiKey: secrets.openaiKey,
    baseUrl: secrets.openaiBaseUrl.replace(/\/$/, ''),
    model
  };
}

export function isGpt56Family(model) {
  const id = String(model || '').trim().toLowerCase();
  return id === 'gpt-5.6' || id.startsWith('gpt-5.6-');
}

/**
 * GPT-5.6* defaults reasoning_effort to medium on /v1/chat/completions and
 * rejects function tools there. OpenAI's documented fix is /v1/responses
 * (tools + reasoning) or reasoning_effort: 'none' on chat/completions.
 * Scoreboard uses Responses for OpenAI GPT-5.6 so the existing tool loop
 * still works. xAI Grok and other OpenAI models stay on chat/completions.
 */
export function usesOpenAiResponsesApi(config = {}) {
  return config.id === 'openai' && isGpt56Family(config.model);
}

function toOpenAiMessages(messages) {
  const out = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const msg of messages || []) {
    if (!msg) continue;
    if (msg.role === 'user') {
      out.push({ role: 'user', content: flattenContent(msg.content) });
      continue;
    }
    if (msg.role === 'assistant' && msg.toolCalls) {
      out.push({
        role: 'assistant',
        content: msg.content ? flattenContent(msg.content) : null,
        tool_calls: msg.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.args || {})
          }
        }))
      });
      continue;
    }
    if (msg.role === 'assistant') {
      out.push({ role: 'assistant', content: flattenContent(msg.content) });
      continue;
    }
    if (msg.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: msg.toolCallId || msg.id || 'tool',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.result || {})
      });
    }
  }
  return out;
}

export function toResponsesTools(toolDefs) {
  return (toolDefs || []).map((def) => {
    if (def && def.type === 'function' && def.function) {
      return {
        type: 'function',
        name: def.function.name,
        description: def.function.description,
        parameters: def.function.parameters
      };
    }
    return def;
  });
}

export function toResponsesInput(messages) {
  const input = [];
  for (const msg of messages || []) {
    if (!msg) continue;
    if (msg.role === 'user') {
      input.push({ role: 'user', content: flattenContent(msg.content) });
      continue;
    }
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const call of msg.toolCalls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.args || {})
        });
      }
      continue;
    }
    if (msg.role === 'assistant') {
      const text = flattenContent(msg.content);
      if (text) input.push({ role: 'assistant', content: text });
      continue;
    }
    if (msg.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: msg.toolCallId || msg.id || 'tool',
        output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.result || {})
      });
    }
  }
  return input;
}

function parseToolArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseProviderError(response, body, text) {
  const err = (body && (body.error && body.error.message)) || text || `HTTP ${response.status}`;
  return new Error(`Chat provider error: ${err}`);
}

function parseChatCompletionsBody(body) {
  const message = body && body.choices && body.choices[0] && body.choices[0].message;
  if (!message) {
    return { content: [{ type: 'text', markdown: 'Empty model response.' }] };
  }
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    return {
      toolCalls: message.tool_calls.map((call) => ({
        id: call.id,
        name: call.function && call.function.name,
        args: parseToolArgs(call.function && call.function.arguments)
      }))
    };
  }
  return { content: parseModelContent(message.content) };
}

export function parseResponsesBody(body) {
  const output = (body && Array.isArray(body.output)) ? body.output : [];
  const toolCalls = [];
  const textParts = [];
  for (const item of output) {
    if (!item) continue;
    if (item.type === 'function_call') {
      toolCalls.push({
        id: item.call_id || item.id,
        name: item.name,
        args: parseToolArgs(item.arguments)
      });
      continue;
    }
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        const text = part && (part.text || part.markdown);
        if (text && (part.type === 'output_text' || part.type === 'text')) {
          textParts.push(text);
        }
      }
    }
  }
  if (toolCalls.length) return { toolCalls };
  if (body && typeof body.output_text === 'string' && body.output_text.trim()) {
    return { content: parseModelContent(body.output_text) };
  }
  if (textParts.length) {
    return { content: parseModelContent(textParts.join('\n\n')) };
  }
  return { content: [{ type: 'text', markdown: 'Empty model response.' }] };
}

function buildProviderRequest(config, messages, toolDefs) {
  if (usesOpenAiResponsesApi(config)) {
    return {
      url: `${config.baseUrl}/responses`,
      body: {
        model: config.model,
        instructions: SYSTEM_PROMPT,
        input: toResponsesInput(messages),
        tools: toResponsesTools(toolDefs),
        tool_choice: 'auto',
        store: false
      }
    };
  }
  const body = {
    model: config.model,
    temperature: 0.2,
    messages: toOpenAiMessages(messages),
    tools: toolDefs,
    tool_choice: 'auto'
  };
  // Defensive: if a GPT-5.6 id is ever sent on chat/completions (custom
  // base URL, mis-detect), omit the default medium reasoning_effort so
  // function tools are not rejected.
  if (isGpt56Family(config.model)) {
    body.reasoning_effort = 'none';
    delete body.temperature;
  }
  return {
    url: `${config.baseUrl}/chat/completions`,
    body
  };
}

export function createOpenAiCompatibleProvider(config, { fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  const useResponses = usesOpenAiResponsesApi(config);
  return {
    id: config.id,
    model: config.model || null,
    api: useResponses ? 'responses' : 'chat_completions',
    async complete(messages, toolDefs) {
      if (typeof fetchFn !== 'function') {
        throw new Error('fetch is not available for the chat provider');
      }
      const request = buildProviderRequest(config, messages, toolDefs);
      const response = await fetchFn(request.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request.body)
      });
      const text = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      if (!response.ok) {
        throw parseProviderError(response, parsed, text);
      }
      return useResponses
        ? parseResponsesBody(parsed)
        : parseChatCompletionsBody(parsed);
    }
  };
}

export function createChatProvider(options = {}) {
  const env = options.env || process.env;
  const override = sanitizeChatOverride(options.override || {});
  const detected = options.config || detectChatProvider(env, override);
  if (detected.id === 'stub' || options.forceStub) {
    const stub = createStubProvider({ catalog: options.catalog });
    stub.model = detected.model || null;
    return stub;
  }
  return createOpenAiCompatibleProvider(detected, { fetchImpl: options.fetchImpl });
}
