import { modelsForProvider } from './schema.js';

const EXAMPLES = [
  { label: '5 buyback coins', text: 'what are 5 crypto coins that are doing buybacks' },
  { label: 'Load SKR', text: 'load SKR' },
  { label: 'Compare MSTR vs BTC', text: 'compare MSTR vs BTC' }
];

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(markdown) {
  const escaped = escapeHtml(markdown).replace(/\n/g, '<br>');
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function renderCard(card) {
  const load = card.load || {};
  return `<button type="button" class="chat-asset-card" data-symbol="${escapeHtml(card.symbol)}" data-name="${escapeHtml(card.name || card.symbol)}" data-asset-class="${escapeHtml(card.assetClass || '')}" data-scoreboard-id="${escapeHtml(card.scoreboardId || '')}" data-interval-hint="${escapeHtml(load.intervalHint || '1d')}">
    <span class="chat-asset-symbol">${escapeHtml(card.symbol)}</span>
    <span class="chat-asset-name">${escapeHtml(card.name || '')}</span>
    <span class="chat-asset-class">${escapeHtml(card.assetClass || '')}</span>
    ${card.blurb ? `<span class="chat-asset-blurb">${escapeHtml(card.blurb)}</span>` : ''}
    ${Array.isArray(card.strategyConsiderations) && card.strategyConsiderations.length
      ? `<ul class="chat-asset-notes">${card.strategyConsiderations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : ''}
    <span class="chat-asset-hint">Tap to load ${escapeHtml(load.intervalHint || '1d')} chart</span>
  </button>`;
}

function renderBlocks(content) {
  return (content || []).map((block) => {
    if (block.type === 'asset_card') return renderCard(block);
    if (block.type === 'text') return `<div class="chat-md">${renderMarkdown(block.markdown || '')}</div>`;
    return '';
  }).join('');
}

function renderMessage(message) {
  const role = message.role === 'user' ? 'user' : 'assistant';
  return `<article class="chat-msg chat-msg-${role}">
    <div class="chat-msg-role">${role === 'user' ? 'You' : 'Scoreboard'}</div>
    <div class="chat-msg-body">${renderBlocks(message.content)}</div>
  </article>`;
}

function optionHtml(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

export function providerNoteText(model = {}) {
  const provider = model.provider || 'stub';
  const liveModel = model.model || null;
  const hasLive = Boolean(model.hasLiveLlm);
  if (!hasLive || provider === 'stub') {
    return 'Using the local demo provider (stub — no usable LLM key for this selection). Add SCOREBOARD_XAI_API_KEY or SCOREBOARD_OPENAI_API_KEY to the server .env (gitignored). Never put keys in the repo or browser.';
  }
  const label = liveModel ? `${provider} · ${liveModel}` : provider;
  return `Live function-calling provider: ${label} (server-side key only). In-app provider/model override is stored in this browser — keys stay on the server.`;
}

function renderSettings(model = {}) {
  const settings = model.settings || {};
  const selectedProvider = settings.provider || '';
  const selectedModel = settings.model || '';
  const extra = selectedModel || (model.envDefault && model.envDefault.model) || '';
  const models = modelsForProvider(selectedProvider || (model.envDefault && model.envDefault.provider), extra);
  return `<fieldset class="chat-settings" id="chat-settings">
    <legend>Chat model</legend>
    <label class="chat-setting">
      <span>Provider</span>
      <select id="chat-provider-select" ${model.busy ? 'disabled' : ''}>
        ${optionHtml('', 'Server default', !selectedProvider)}
        ${optionHtml('xai', 'xAI (Grok)', selectedProvider === 'xai')}
        ${optionHtml('openai', 'OpenAI', selectedProvider === 'openai')}
      </select>
    </label>
    <label class="chat-setting">
      <span>Model</span>
      <select id="chat-model-select" ${model.busy ? 'disabled' : ''}>
        ${optionHtml('', 'Server default', !selectedModel)}
        ${models.map((row) => optionHtml(row.id, row.label, selectedModel === row.id)).join('')}
      </select>
    </label>
  </fieldset>`;
}

export function buildChatPaneHtml(model = {}) {
  const messages = model.messages || [];
  const busy = Boolean(model.busy);
  const providerNote = providerNoteText(model);

  const log = messages.length
    ? messages.map(renderMessage).join('')
    : '<p class="chat-empty">Ask about any catalog investment. Example: coins doing buybacks, load SKR, compare MSTR vs BTC.</p>';

  return `<div class="chat-pane">
    <div class="chat-toolbar">
      ${renderSettings(model)}
      <button type="button" id="chat-clear-btn">Clear history</button>
    </div>
    <p class="chat-provider" id="chat-provider-note">${escapeHtml(providerNote)}</p>
    <div id="chat-log" class="chat-log">${log}${busy ? '<p class="chat-busy">Researching…</p>' : ''}</div>
    <form id="chat-form" class="chat-form">
      <label class="chat-input-label" for="chat-input">Ask</label>
      <textarea id="chat-input" rows="3" placeholder="Ask about an investment…" ${busy ? 'disabled' : ''}></textarea>
      <button type="submit" id="chat-send-btn" ${busy ? 'disabled' : ''}>Ask</button>
    </form>
    <div class="chat-examples">
      ${EXAMPLES.map((ex) => `<button type="button" class="chat-example" data-chat-example="${escapeHtml(ex.text)}">${escapeHtml(ex.label)}</button>`).join('')}
    </div>
  </div>`;
}

export class ChatView {
  constructor(rootId = 'chat') {
    this.root = typeof document !== 'undefined' ? document.getElementById(rootId) : null;
  }

  render(model) {
    if (!this.root) return;
    this.root.innerHTML = buildChatPaneHtml(model);
    const log = this.root.querySelector('#chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }
}
