import { ChatStore } from './store.js';
import { ChatView } from './view.js';
import { loadPayloadFromCard } from '../load-asset.js';

function overridePayload(settings) {
  const out = {};
  if (settings && settings.provider) out.provider = settings.provider;
  if (settings && settings.model) out.model = settings.model;
  return out;
}

export async function postChat(messages, { fetchImpl, provider, model } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  const payload = {
    messages: (messages || []).map((msg) => ({
      role: msg.role,
      content: msg.content
    }))
  };
  if (provider) payload.provider = provider;
  if (model) payload.model = model;
  const response = await fetchFn('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || 'Chat request failed');
  }
  return result;
}

export async function fetchChatStatus({ fetchImpl, provider, model } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  try {
    const params = new URLSearchParams();
    if (provider) params.set('provider', provider);
    if (model) params.set('model', model);
    const qs = params.toString();
    const response = await fetchFn(qs ? `/api/chat/status?${qs}` : '/api/chat/status');
    if (!response.ok) return { provider: 'stub', hasLiveLlm: false, model: null };
    return response.json();
  } catch {
    return { provider: 'stub', hasLiveLlm: false, model: null };
  }
}

export function cardFromDataset(dataset) {
  if (!dataset || !dataset.symbol) return null;
  return {
    type: 'asset_card',
    symbol: dataset.symbol,
    name: dataset.name,
    assetClass: dataset.assetClass,
    scoreboardId: dataset.scoreboardId,
    load: {
      symbol: dataset.symbol,
      assetClass: dataset.assetClass,
      intervalHint: dataset.intervalHint || '1d'
    }
  };
}

export class ChatController {
  constructor(options = {}) {
    this.store = options.store || new ChatStore({ storage: options.storage });
    this.view = options.view || new ChatView(options.rootId || 'chat');
    this.onLoadAsset = options.onLoadAsset || null;
    this.postChat = options.postChat || postChat;
    this.fetchStatus = options.fetchStatus || fetchChatStatus;
    this.provider = options.provider || 'stub';
    this.llmModel = options.model || options.llmModel || null;
    this.hasLiveLlm = Boolean(options.hasLiveLlm);
    this.envDefault = options.envDefault || null;
    this.availableProviders = options.availableProviders || [];
    this.busy = false;
    this.lastLoad = null;
  }

  model() {
    return {
      messages: this.store.listMessages(),
      provider: this.provider,
      model: this.llmModel,
      hasLiveLlm: this.hasLiveLlm,
      envDefault: this.envDefault,
      availableProviders: this.availableProviders,
      settings: this.store.getSettings(),
      busy: this.busy
    };
  }

  refresh() {
    this.view.render(this.model());
    this.bind();
  }

  bind() {
    const root = this.view.root;
    if (!root) return;

    const form = root.querySelector('#chat-form');
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = root.querySelector('#chat-input');
        const text = input ? input.value : '';
        this.send(text);
      });
    }

    const clearBtn = root.querySelector('#chat-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clear());
    }

    const providerSelect = root.querySelector('#chat-provider-select');
    if (providerSelect) {
      providerSelect.addEventListener('change', () => {
        this.applySettings({
          provider: providerSelect.value || null,
          model: null
        });
      });
    }

    const modelSelect = root.querySelector('#chat-model-select');
    if (modelSelect) {
      modelSelect.addEventListener('change', () => {
        this.applySettings({
          model: modelSelect.value || null
        });
      });
    }

    root.querySelectorAll('[data-chat-example]').forEach((btn) => {
      btn.addEventListener('click', () => this.send(btn.dataset.chatExample));
    });

    root.querySelectorAll('.chat-asset-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.handleCardTap(cardFromDataset(btn.dataset));
      });
    });
  }

  applyStatus(status) {
    this.provider = (status && status.provider) || 'stub';
    this.llmModel = (status && status.model) || null;
    this.hasLiveLlm = Boolean(status && status.hasLiveLlm);
    this.envDefault = (status && status.envDefault) || this.envDefault;
    this.availableProviders = (status && status.availableProviders) || [];
  }

  async applySettings(partial) {
    this.store.setSettings(partial);
    const settings = this.store.getSettings();
    const status = await this.fetchStatus(overridePayload(settings));
    this.applyStatus(status);
    this.refresh();
    return settings;
  }

  handleCardTap(card) {
    const payload = loadPayloadFromCard(card);
    this.lastLoad = payload;
    if (payload.ok && typeof this.onLoadAsset === 'function') {
      this.onLoadAsset(payload);
    }
    return payload;
  }

  clear() {
    this.store.clear();
    this.refresh();
  }

  async init() {
    this.store.load();
    const status = await this.fetchStatus(overridePayload(this.store.getSettings()));
    this.applyStatus(status);
    this.refresh();
  }

  async send(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed || this.busy) return null;
    this.store.appendMessage({
      role: 'user',
      content: [{ type: 'text', markdown: trimmed }]
    });
    this.busy = true;
    this.refresh();
    try {
      const result = await this.postChat(this.store.listMessages(), overridePayload(this.store.getSettings()));
      this.provider = (result && result.provider) || this.provider;
      this.llmModel = (result && result.model) || this.llmModel;
      this.store.appendMessage({
        role: 'assistant',
        content: (result && result.content) || [{ type: 'text', markdown: "Couldn't complete that turn." }],
        provider: this.provider
      });
      return result;
    } catch (error) {
      this.store.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', markdown: error.message || 'Chat failed.' }]
      });
      return null;
    } finally {
      this.busy = false;
      this.refresh();
    }
  }
}
