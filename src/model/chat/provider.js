import { SYSTEM_PROMPT } from './prompt.js';
import { createStubProvider } from './stub.js';
import { flattenContent, parseModelContent } from './blocks.js';

export function detectChatProvider(env = process.env) {
  const xai = env.XAI_API_KEY || env.GROK_API_KEY;
  if (xai) {
    return {
      id: 'xai',
      apiKey: xai,
      baseUrl: String(env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, ''),
      model: env.CHAT_MODEL || env.XAI_MODEL || 'grok-4'
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      id: 'openai',
      apiKey: env.OPENAI_API_KEY,
      baseUrl: String(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: env.CHAT_MODEL || env.OPENAI_MODEL || 'gpt-4o-mini'
    };
  }
  return { id: 'stub' };
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

function parseToolArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function createOpenAiCompatibleProvider(config, { fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  return {
    id: config.id,
    async complete(messages, toolDefs) {
      if (typeof fetchFn !== 'function') {
        throw new Error('fetch is not available for the chat provider');
      }
      const response = await fetchFn(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          messages: toOpenAiMessages(messages),
          tools: toolDefs,
          tool_choice: 'auto'
        })
      });
      const text = await response.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      if (!response.ok) {
        const err = (body && (body.error && body.error.message)) || text || `HTTP ${response.status}`;
        throw new Error(`Chat provider error: ${err}`);
      }
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
  };
}

export function createChatProvider(options = {}) {
  const env = options.env || process.env;
  const detected = options.config || detectChatProvider(env);
  if (detected.id === 'stub' || options.forceStub) {
    return createStubProvider({ catalog: options.catalog });
  }
  return createOpenAiCompatibleProvider(detected, { fetchImpl: options.fetchImpl });
}
