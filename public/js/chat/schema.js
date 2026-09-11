export const CHAT_SCHEMA_VERSION = 2;
export const CHAT_STORAGE_KEY = 'scoreboard.chat';
export const CHAT_NAMESPACE = 'chat';

export const CHAT_MODEL_OPTIONS = {
  xai: [
    { id: 'grok-4.6', label: 'Grok 4.6' },
    { id: 'grok-4.5', label: 'Grok 4.5' },
    { id: 'grok-4', label: 'Grok 4' }
  ],
  openai: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6', label: 'GPT-5.6 (alias → Sol)' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    { id: 'gpt-4o', label: 'gpt-4o' },
    { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' }
  ]
};

export function emptyChatSettings() {
  return {
    provider: null,
    model: null
  };
}

export function emptyChatCollections() {
  return {
    messages: [],
    settings: emptyChatSettings()
  };
}

export function emptyChatState() {
  return {
    schemaVersion: CHAT_SCHEMA_VERSION,
    namespace: CHAT_NAMESPACE,
    collections: emptyChatCollections()
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function looksLikeSecretValue(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^(sk-|xai-|Bearer\s)/i.test(text)) return true;
  if (/api[_-]?key/i.test(text)) return true;
  return false;
}

export function normalizeChatProviderId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (id === 'xai' || id === 'grok') return 'xai';
  if (id === 'openai') return 'openai';
  return null;
}

/**
 * Persist provider/model only. Drop any key-like fields so localStorage
 * never holds server secrets.
 */
export function normalizeChatSettings(raw) {
  const out = emptyChatSettings();
  if (!raw || typeof raw !== 'object') return out;
  out.provider = normalizeChatProviderId(raw.provider);
  if (typeof raw.model === 'string') {
    const model = raw.model.trim();
    if (model && !looksLikeSecretValue(model)) out.model = model;
  }
  return out;
}

function normalizeMessage(raw, index) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    return {
      id: `migrated_${index}`,
      role: 'assistant',
      createdAt: 0,
      content: [{ type: 'text', markdown: raw }]
    };
  }
  if (typeof raw !== 'object') return null;
  const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : 'assistant';
  let content = raw.content;
  if (typeof raw.text === 'string' && !content) {
    content = [{ type: 'text', markdown: raw.text }];
  }
  if (typeof content === 'string') {
    content = [{ type: 'text', markdown: content }];
  }
  if (!Array.isArray(content)) content = [];
  return {
    id: raw.id || `migrated_${index}`,
    role,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    content,
    provider: raw.provider || null
  };
}

function normalizeCollections(raw) {
  const base = emptyChatCollections();
  if (!raw || typeof raw !== 'object') return base;
  return {
    messages: asArray(raw.messages || raw.items || raw.history)
      .map((item, index) => normalizeMessage(item, index))
      .filter(Boolean),
    settings: normalizeChatSettings(raw.settings)
  };
}

/**
 * Migrate any persisted chat payload into the current schema.
 * Unversioned arrays and { messages } blobs are wrapped, never discarded.
 * Settings are stripped of key-like fields on every load.
 */
export function migrateChatState(raw) {
  if (raw == null) return emptyChatState();

  if (Array.isArray(raw)) {
    return {
      schemaVersion: CHAT_SCHEMA_VERSION,
      namespace: CHAT_NAMESPACE,
      collections: normalizeCollections({ messages: raw }),
      migratedFrom: 0
    };
  }

  if (typeof raw !== 'object') return emptyChatState();

  let version = Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0;
  let collections;

  if (version === 0) {
    if (raw.collections && typeof raw.collections === 'object') {
      collections = normalizeCollections(raw.collections);
    } else {
      collections = normalizeCollections({
        messages: raw.messages || raw.items || raw.history,
        settings: raw.settings
      });
    }
    version = CHAT_SCHEMA_VERSION;
  } else {
    collections = normalizeCollections(raw.collections);
    version = CHAT_SCHEMA_VERSION;
  }

  return {
    schemaVersion: CHAT_SCHEMA_VERSION,
    namespace: CHAT_NAMESPACE,
    collections,
    migratedFrom: raw.schemaVersion == null ? 0 : raw.schemaVersion
  };
}

export function modelsForProvider(provider, extraModel) {
  const id = normalizeChatProviderId(provider);
  const listed = id && CHAT_MODEL_OPTIONS[id]
    ? CHAT_MODEL_OPTIONS[id].slice()
    : [
      ...CHAT_MODEL_OPTIONS.xai,
      ...CHAT_MODEL_OPTIONS.openai
    ];
  const extra = typeof extraModel === 'string' ? extraModel.trim() : '';
  if (extra && !listed.some((row) => row.id === extra)) {
    listed.push({ id: extra, label: extra });
  }
  return listed;
}
