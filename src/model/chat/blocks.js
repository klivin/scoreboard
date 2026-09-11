export const NFA_DISCLAIMER = 'Not financial advice (NFA). Research / paper only — no orders, no keys, no custody.';

export function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block) return '';
      if (block.type === 'text') return block.markdown || block.text || '';
      if (block.type === 'asset_card') return `${block.symbol || ''} ${block.name || ''}`.trim();
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

export function parseModelContent(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.content)) return raw.content;
  if (typeof raw !== 'string') return [];
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.content)) return parsed.content;
    } catch {
      // fall through to text block
    }
  }
  return [{ type: 'text', markdown: text }];
}

function resolvedKey(row) {
  if (!row || !row.ok) return null;
  return String(row.scoreboardId || `${row.assetClass}:${row.symbol}`).toUpperCase();
}

function cardKey(card) {
  if (!card) return null;
  if (card.scoreboardId) return String(card.scoreboardId).toUpperCase();
  if (card.symbol && card.assetClass) return `${card.assetClass}:${card.symbol}`.toUpperCase();
  if (card.symbol) return String(card.symbol).toUpperCase();
  return null;
}

export function sanitizeAssistantContent(content, resolvedRows = []) {
  const allowed = new Set();
  const byKey = new Map();
  for (const row of resolvedRows || []) {
    if (!row || !row.ok) continue;
    const key = resolvedKey(row);
    if (key) {
      allowed.add(key);
      allowed.add(String(row.symbol).toUpperCase());
      byKey.set(key, row);
    }
  }

  const blocks = parseModelContent(content);
  const out = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') {
      const markdown = String(block.markdown || block.text || '').trim();
      if (markdown) out.push({ type: 'text', markdown });
      continue;
    }
    if (block.type !== 'asset_card') continue;
    const key = cardKey(block);
    const symbol = block.symbol && String(block.symbol).toUpperCase();
    const allowedCard = key && (allowed.has(key) || (symbol && allowed.has(symbol)));
    if (!allowedCard) continue;
    const row = byKey.get(key) || byKey.get(`${block.assetClass}:${symbol}`.toUpperCase());
    const load = (block.load && block.load.symbol)
      ? {
        symbol: String(block.load.symbol).toUpperCase(),
        assetClass: block.load.assetClass || (row && row.assetClass) || 'other',
        intervalHint: block.load.intervalHint === '1h' ? '1h' : '1d'
      }
      : (row && row.load);
    if (!load || !load.symbol) continue;
    out.push({
      type: 'asset_card',
      symbol: String(block.symbol || load.symbol).toUpperCase(),
      name: block.name || (row && row.name) || load.symbol,
      assetClass: block.assetClass || load.assetClass || 'other',
      scoreboardId: block.scoreboardId || (row && row.scoreboardId) || `${load.assetClass}:${load.symbol}`,
      load,
      blurb: block.blurb || (row && row.blurb) || '',
      strategyConsiderations: Array.isArray(block.strategyConsiderations)
        ? block.strategyConsiderations.map(String)
        : ((row && row.strategyConsiderations) || [])
    });
  }

  if (!out.length) {
    return [{ type: 'text', markdown: 'No structured answer. Try asking again.' }];
  }
  return out;
}

export function cardsFromResolved(results, { summary } = {}) {
  const rows = Array.isArray(results) ? results : [];
  const ok = rows.filter((row) => row && row.ok);
  const bad = rows.filter((row) => row && !row.ok);
  const lines = [];
  if (summary) lines.push(summary);
  if (ok.length && !summary) {
    lines.push(`Research-only notes for ${ok.map((row) => row.symbol).join(', ')}. ${NFA_DISCLAIMER}`);
  }
  for (const row of bad) {
    const label = row.query || row.symbol || 'that symbol';
    lines.push(`Couldn't resolve ${label}.`);
  }
  if (!ok.length && !bad.length) {
    lines.push('No assets resolved.');
  }
  const content = [{ type: 'text', markdown: lines.filter(Boolean).join('\n\n') || NFA_DISCLAIMER }];
  for (const row of ok) {
    content.push({
      type: 'asset_card',
      symbol: row.symbol,
      name: row.name,
      assetClass: row.assetClass,
      scoreboardId: row.scoreboardId,
      load: row.load,
      blurb: row.blurb || `${row.name} (${row.symbol}).`,
      strategyConsiderations: row.strategyConsiderations || []
    });
  }
  return content;
}
