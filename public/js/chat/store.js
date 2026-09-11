import {
  CHAT_STORAGE_KEY,
  emptyChatState,
  migrateChatState
} from './schema.js';

export { CHAT_STORAGE_KEY };

export class MemoryStorage {
  constructor(initial = {}) {
    this.map = new Map();
    for (const [key, value] of Object.entries(initial)) {
      this.map.set(key, String(value));
    }
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

function defaultStorage() {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return new MemoryStorage();
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class ChatStore {
  constructor(options = {}) {
    this.storage = options.storage || defaultStorage();
    this.key = options.key || CHAT_STORAGE_KEY;
    this.state = null;
  }

  load() {
    const rawText = this.storage.getItem(this.key);
    if (!rawText) {
      this.state = emptyChatState();
      return this.state;
    }
    try {
      this.state = migrateChatState(JSON.parse(rawText));
      return this.state;
    } catch {
      this.state = emptyChatState();
      return this.state;
    }
  }

  save() {
    if (!this.state) this.load();
    this.storage.setItem(this.key, JSON.stringify(this.state));
    return this.state;
  }

  getState() {
    if (!this.state) this.load();
    return this.state;
  }

  listMessages() {
    return this.getState().collections.messages.slice();
  }

  appendMessage(partial) {
    const state = this.getState();
    const message = {
      id: partial.id || newId(partial.role || 'msg'),
      role: partial.role,
      createdAt: partial.createdAt || Date.now(),
      content: Array.isArray(partial.content) ? partial.content : [],
      provider: partial.provider || null
    };
    state.collections.messages.push(message);
    this.save();
    return message;
  }

  clear() {
    this.state = emptyChatState();
    this.save();
    return this.state;
  }
}
