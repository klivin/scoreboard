export const CHAT_SCHEMA_VERSION = 1;
export const CHAT_STORAGE_KEY = 'scoreboard.chat';
export const CHAT_NAMESPACE = 'chat';

export function emptyChatCollections() {
  return {
    messages: [],
    settings: {}
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
    settings: raw.settings && typeof raw.settings === 'object' ? { ...raw.settings } : {}
  };
}

/**
 * Migrate any persisted chat payload into schemaVersion 1.
 * Unversioned arrays and { messages } blobs are wrapped, never discarded.
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
    version = 1;
  } else {
    collections = normalizeCollections(raw.collections);
  }

  return {
    schemaVersion: CHAT_SCHEMA_VERSION,
    namespace: CHAT_NAMESPACE,
    collections,
    migratedFrom: raw.schemaVersion == null ? 0 : raw.schemaVersion
  };
}
