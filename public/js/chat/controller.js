import { ChatStore } from './store.js';
import { ChatView } from './view.js';
import { loadPayloadFromCard } from '../load-asset.js';

export async function postChat(messages, { fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  const payload = {
    messages: (messages || []).map((msg) => ({
      role: msg.role,
      content: msg.content
    }))
  };
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

export async function fetchChatStatus({ fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  try {
    const response = await fetchFn('/api/chat/status');
    if (!response.ok) return { provider: 'stub', hasLiveLlm: false };
    return response.json();
  } catch {
    return { provider: 'stub', hasLiveLlm: false };
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
    this.busy = false;
    this.lastLoad = null;
  }

  model() {
    return {
      messages: this.store.listMessages(),
      provider: this.provider,
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

    root.querySelectorAll('[data-chat-example]').forEach((btn) => {
      btn.addEventListener('click', () => this.send(btn.dataset.chatExample));
    });

    root.querySelectorAll('.chat-asset-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.handleCardTap(cardFromDataset(btn.dataset));
      });
    });
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
    const status = await this.fetchStatus();
    this.provider = (status && status.provider) || 'stub';
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
      const result = await this.postChat(this.store.listMessages());
      this.provider = (result && result.provider) || this.provider;
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
