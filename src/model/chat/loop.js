import { sanitizeAssistantContent, NFA_DISCLAIMER } from './blocks.js';
import { createToolRunner } from './tools.js';
import { createChatProvider, detectChatProvider } from './provider.js';

export function incomingToLoopMessages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant'))
    .map((msg) => ({
      role: msg.role,
      content: msg.content
    }));
}

export async function runChatTurn({
  messages = [],
  provider,
  tools,
  maxSteps = 6
} = {}) {
  const runner = tools || createToolRunner();
  const convo = incomingToLoopMessages(messages);
  const resolved = [];
  const toolTrace = [];
  const used = provider || createChatProvider();

  try {
    for (let step = 0; step < maxSteps; step += 1) {
      const decision = await used.complete(convo, runner.definitions);
      if (decision && Array.isArray(decision.toolCalls) && decision.toolCalls.length) {
        convo.push({
          role: 'assistant',
          content: null,
          toolCalls: decision.toolCalls
        });
        for (const call of decision.toolCalls) {
          let result;
          try {
            result = runner.execute(call.name, call.args || {});
            if (result && typeof result.then === 'function') result = await result;
          } catch (error) {
            result = { error: error.message || 'tool failed' };
          }
          toolTrace.push({ name: call.name, args: call.args || {}, result });
          if (call.name === 'resolve_assets') {
            for (const row of result.results || []) {
              if (row && row.ok) resolved.push(row);
            }
          }
          convo.push({
            role: 'tool',
            name: call.name,
            toolCallId: call.id,
            content: JSON.stringify(result),
            result
          });
        }
        continue;
      }

      const content = sanitizeAssistantContent(decision && decision.content, resolved);
      return {
        content,
        toolTrace,
        resolved,
        provider: used.id,
        disclaimer: NFA_DISCLAIMER
      };
    }
  } catch (error) {
    const fallback = resolved.length
      ? sanitizeAssistantContent([], resolved)
      : [{
        type: 'text',
        markdown: `${error.message || 'Chat provider failed'}. ${NFA_DISCLAIMER}`
      }];
    return {
      content: fallback,
      toolTrace,
      resolved,
      provider: used.id,
      disclaimer: NFA_DISCLAIMER,
      error: error.message
    };
  }

  return {
    content: [{
      type: 'text',
      markdown: `Tool loop stopped before a final answer. ${NFA_DISCLAIMER}`
    }],
    toolTrace,
    resolved,
    provider: used.id,
    disclaimer: NFA_DISCLAIMER
  };
}

export function chatStatus(env = process.env) {
  const detected = detectChatProvider(env);
  return {
    provider: detected.id,
    hasLiveLlm: detected.id !== 'stub',
    model: detected.model || null,
    disclaimer: NFA_DISCLAIMER
  };
}
