/**
 * Assemble scanner rows from series / signal engine / stored backtests.
 * Never invent ranking or sentiment. Missing series stay missing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { lastKnownClose } from './viewport.js';
import { generateForecast, naiveBaseline } from './forecast.js';
import { evaluateWalkForward, DEFAULT_ENABLED } from './signals/index.js';
import {
  SCANNER_DISCLAIMER,
  SUPPORTED_PACK_SYMBOLS,
  SCANNER_HORIZONS,
  buildScannerRow,
  collectFlipHistory,
  mergeFlipHistories,
  pickCorrelation,
  finiteOrNull,
  classifyAssetClass
} from './scanner.js';
import { seriesModel } from './series.js';
import { pickEtfMillions, pickOiContracts } from './overlays.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_DIR = path.resolve(__dirname, '../../store');

function tryGetSeries(model, symbol) {
  try {
    const series = model.getIndicators(symbol, '1d');
    return Array.isArray(series) ? series : [];
  } catch {
    return [];
  }
}

function forecastsForSeries(series) {
  const lastPrice = lastKnownClose(series);
  const horizons = {};
  if (!Number.isFinite(lastPrice) || !series.length) return horizons;
  for (const h of SCANNER_HORIZONS) {
    try {
      const forecast = generateForecast(series, h);
      const naive = naiveBaseline(series, h);
      horizons[h] = {
        ...forecast,
        naive: forecast.naive != null ? forecast.naive : (naive && naive.prediction)
      };
    } catch {
      horizons[h] = null;
    }
  }
  return horizons;
}

function modelDirectionStates(series) {
  const states = [];
  if (!series || series.length < 8) return states;
  for (let i = 7; i < series.length; i += 1) {
    const slice = series.slice(0, i + 1);
    const last = lastKnownClose(slice);
    if (!Number.isFinite(last) || last === 0) continue;
    const prior = lastKnownClose(slice.slice(0, slice.length - 6));
    if (!Number.isFinite(prior) || prior === 0) continue;
    const trend = (last - prior) / prior;
    const prediction = last + last * trend * (7 / 7);
    let direction = 'NEUTRAL';
    if (prediction > last) direction = 'BULLISH';
    else if (prediction < last) direction = 'BEARISH';
    const ts = slice[slice.length - 1] && slice[slice.length - 1].timestamp;
    if (!Number.isFinite(ts)) continue;
    states.push({ at: ts, direction });
  }
  return states;
}

function consensusStates(events) {
  return (events || [])
    .filter((ev) => ev && ev.consensus && ev.consensus.direction && Number.isFinite(ev.timestamp))
    .map((ev) => ({ at: ev.timestamp, direction: ev.consensus.direction }));
}

function contextForSymbol(model, symbol, corrRows, category) {
  let etfNetFlowUsdMillions = null;
  let oiContracts = null;
  try {
    const signals = model.getSignals(symbol);
    if (signals && signals.etf) {
      etfNetFlowUsdMillions = finiteOrNull(signals.etf.net_flow_usd_millions);
    }
    if (signals && signals.oi) {
      oiContracts = finiteOrNull(signals.oi.current);
    }
  } catch {
    // keep missing
  }

  if (etfNetFlowUsdMillions == null) {
    try {
      const etfRows = model.getEtfRows(symbol);
      if (etfRows && etfRows.length) {
        etfNetFlowUsdMillions = pickEtfMillions(etfRows[etfRows.length - 1]);
      }
    } catch {
      // keep missing
    }
  }

  if (oiContracts == null && (symbol === 'BTC' || symbol === 'BTCUSDT')) {
    try {
      const oiRows = model.getOiRows('1d');
      if (oiRows && oiRows.length) {
        oiContracts = pickOiContracts(oiRows[oiRows.length - 1]);
      }
    } catch {
      // keep missing
    }
  }

  const corr = pickCorrelation(corrRows, symbol, category);
  return {
    etfNetFlowUsdMillions,
    oiContracts,
    correlationVsBtc: corr.value,
    correlationCategory: corr.category
  };
}

function loadStoredBacktest(symbol, horizon = 'weekly') {
  const file = path.join(STORE_DIR, `backtest_${String(symbol).toUpperCase()}_${horizon}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function corrRowsFromModel(model) {
  if (!model.data || !model.data.correlations || model.data.correlations.missing) return [];
  return model.data.correlations.data || [];
}

function universeCoins(model) {
  try {
    const universe = model.getUniverse();
    return universe && Array.isArray(universe.coins) ? universe.coins : [];
  } catch {
    return [];
  }
}

function coinMeta(coins, symbol) {
  const upper = String(symbol).toUpperCase();
  return (coins || []).find((coin) => {
    const sym = String(coin.symbol || coin.ticker || '').toUpperCase();
    return sym === upper;
  }) || null;
}

export function collectScannerSymbols(model, extras = {}) {
  const symbols = new Set();
  for (const sym of SUPPORTED_PACK_SYMBOLS) symbols.add(sym);

  try {
    for (const sym of model.getAvailableSymbols() || []) {
      if (sym) symbols.add(String(sym).toUpperCase());
    }
  } catch {
    // pack missing — keep supported list
  }

  for (const coin of extras.coins || []) {
    const sym = coin && (coin.symbol || coin.ticker);
    if (sym) symbols.add(String(sym).toUpperCase());
  }

  for (const extra of extras.extraSymbols || []) {
    if (extra) symbols.add(String(extra).toUpperCase());
  }

  return [...symbols].sort();
}

export function buildScannerRows(options = {}) {
  const model = options.model || seriesModel;
  if (typeof model.ensureLoaded === 'function') model.ensureLoaded();

  const now = options.now || Date.now();
  const coins = options.coins || universeCoins(model);
  const corrRows = options.corrRows || corrRowsFromModel(model);
  const extraSymbols = options.extraSymbols || [];
  const symbols = collectScannerSymbols(model, { coins, extraSymbols });
  const priorFlips = options.priorFlips || {};
  const enabled = options.strategies || DEFAULT_ENABLED;
  const loadBacktest = options.loadBacktest || loadStoredBacktest;

  const rows = [];
  const notes = [];

  if (!model.data) {
    notes.push('Series model has no data — every market cell is missing.');
  } else if (Array.isArray(model.data.missing) && model.data.missing.length) {
    notes.push(`Missing pack files: ${model.data.missing.join(', ')}. Those series stay missing.`);
  }

  for (const symbol of symbols) {
    const series = tryGetSeries(model, symbol);
    const meta = coinMeta(coins, symbol);
    const horizons = forecastsForSeries(series);

    let events = [];
    if (series.length) {
      try {
        events = evaluateWalkForward(series, enabled, { horizon: 'weekly' });
      } catch {
        events = [];
      }
    }

    const consensusEvent = events.length ? events[events.length - 1] : null;
    const directionFlips = collectFlipHistory(modelDirectionStates(series), 'direction');
    const consensusFlips = collectFlipHistory(consensusStates(events), 'consensus');
    const flipHistory = mergeFlipHistories(priorFlips[symbol], directionFlips, consensusFlips);

    const category = meta && (meta.category || meta.categories);
    const categoryName = Array.isArray(category) ? category[0] : category;

    const row = buildScannerRow({
      symbol,
      name: meta && (meta.name || meta.id) || null,
      assetClass: classifyAssetClass({
        symbol,
        fromCoinGecko: Boolean(meta),
        assetClass: meta && meta.assetClass
      }),
      series,
      horizons,
      consensusEvent,
      backtest: loadBacktest(symbol, 'weekly'),
      context: contextForSymbol(model, symbol, corrRows, categoryName),
      flipHistory,
      now,
      category: categoryName
    });

    rows.push(row);
  }

  return {
    disclaimer: SCANNER_DISCLAIMER,
    generatedAt: now,
    note: notes.length ? notes.join(' ') : null,
    count: rows.length,
    rows
  };
}

export function loadScannerPayload(options = {}) {
  const model = options.model || seriesModel;
  try {
    if (typeof model.load === 'function') model.load();
  } catch {
    // build with whatever is present
  }
  return buildScannerRows({ ...options, model });
}
