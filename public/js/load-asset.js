/**
 * Thin seam: chat cards (and later free-text ticker) load Overview
 * through the same symbol + Load Data path (`reloadSelected`).
 * PR #14 may add #ticker-input / setSelectedSymbol — we write both.
 */
export function normalizeLoadPayload(input) {
  const load = input && input.load ? input.load : input;
  if (!load || load.symbol == null || String(load.symbol).trim() === '') {
    return { ok: false, error: 'missing symbol' };
  }
  const symbol = String(load.symbol).trim().toUpperCase();
  const assetClass = load.assetClass || input.assetClass || 'other';
  const intervalHint = load.intervalHint === '1h' ? '1h' : '1d';
  return {
    ok: true,
    load: { symbol, assetClass, intervalHint },
    scoreboardId: input.scoreboardId || `${assetClass}:${symbol}`
  };
}

export function applyLoadAssetToDom(load, documentRef) {
  if (!documentRef || !load) return load;
  const symbol = load.symbol;

  const tickerInput = documentRef.getElementById('ticker-input');
  if (tickerInput) tickerInput.value = symbol;

  const select = documentRef.getElementById('symbol-select');
  if (select) {
    const options = select.options ? Array.from(select.options) : [];
    const has = options.some((opt) => opt.value === symbol);
    if (!has && typeof documentRef.createElement === 'function') {
      const opt = documentRef.createElement('option');
      opt.value = symbol;
      opt.textContent = symbol;
      select.appendChild(opt);
    }
    select.value = symbol;
  }

  const intervalSelect = documentRef.getElementById('interval-select');
  if (intervalSelect) intervalSelect.value = load.intervalHint || '1d';

  return load;
}

export async function loadAssetOnApp(app, payload, documentRef) {
  const normalized = normalizeLoadPayload(payload);
  if (!normalized.ok) return normalized;
  const { load } = normalized;
  const doc = documentRef || (typeof document !== 'undefined' ? document : null);

  if (app && typeof app.setSelectedSymbol === 'function') {
    app.setSelectedSymbol(load.symbol, { assetClass: load.assetClass });
  } else if (doc) {
    applyLoadAssetToDom(load, doc);
  }

  if (doc) {
    const intervalSelect = doc.getElementById('interval-select');
    if (intervalSelect) intervalSelect.value = load.intervalHint;
  }

  if (app) {
    app.currentSymbol = load.symbol;
    app.currentInterval = load.intervalHint;
    if (typeof app.switchTab === 'function') app.switchTab('overview');
    if (typeof app.reloadSelected === 'function') {
      await app.reloadSelected();
    }
  }

  return { ok: true, load, scoreboardId: normalized.scoreboardId };
}

export function loadPayloadFromCard(card) {
  const normalized = normalizeLoadPayload(card);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    symbol: normalized.load.symbol,
    name: card.name || normalized.load.symbol,
    assetClass: normalized.load.assetClass,
    scoreboardId: card.scoreboardId || normalized.scoreboardId,
    load: normalized.load
  };
}
