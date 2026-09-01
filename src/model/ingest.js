import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_DATA_DIR = path.resolve(__dirname, '../../data');
const OVERLAY_DATA_DIR = '/workspace/scoreboard';

const EXPECTED_FILES = [
  'okx_btc_usdt_swap_oi_1h.csv',
  'okx_btc_usdt_swap_oi_1d.csv',
  'okx_btc_usdt_swap_candles_1h.csv',
  'okx_btc_usdt_swap_candles_1d.csv',
  'okx_btc_oi_candles_1h_joined.csv',
  'okx_btc_oi_candles_1d_joined.csv',
  'etf_btc_daily_net_flows.csv',
  'etf_eth_daily_net_flows.csv',
  'cg_top100_universe.json',
  'cg_top100_snapshot.json',
  'indicators_daily.csv',
  'ratios_daily.csv',
  'corr_30d_vs_btc.csv',
  'backtest_sketch.json',
  'gaps.md',
  'manifest.json'
];

function searchRoots() {
  const roots = [
    OVERLAY_DATA_DIR,
    path.join(OVERLAY_DATA_DIR, 'data'),
    REPO_DATA_DIR,
    path.resolve(process.cwd(), 'data'),
    process.cwd()
  ];
  return [...new Set(roots)];
}

function walkForFile(dir, filename, depth = 0) {
  if (!dir || depth > 3 || !fs.existsSync(dir)) return null;
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  const direct = path.join(dir, filename);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return direct;
  }

  if (depth >= 3) return null;

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'store') continue;
    const found = walkForFile(path.join(dir, entry.name), filename, depth + 1);
    if (found) return found;
  }
  return null;
}

export function findDataFile(filename) {
  for (const root of searchRoots()) {
    const found = walkForFile(root, filename, 0);
    if (found) return found;
  }
  return null;
}

function parseCsvCell(value) {
  const text = String(value ?? '').trim().replace(/^"|"$/g, '');
  if (text === '') return null;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) {
    return parseFloat(text);
  }
  return text;
}

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values;
}

export function parseCSV(content) {
  const lines = String(content || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length === 0 || !lines[0]) return [];

  const rawHeaders = splitCsvLine(lines[0]).map((h) => String(h || '').replace(/^\uFEFF/, '').trim());
  const headers = rawHeaders.map((h) => h.toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      row[header] = parseCsvCell(values[idx]);
    });
    rows.push(row);
  }

  return rows;
}

export function loadCSV(filename) {
  const filepath = findDataFile(filename);

  if (!filepath) {
    return { data: [], missing: true, filename };
  }

  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const data = parseCSV(content);
    return { data, missing: false, filename, path: filepath };
  } catch (error) {
    console.error(`Error loading CSV ${filename}:`, error.message);
    return { data: [], missing: true, filename, error: error.message };
  }
}

export function loadJSON(filename) {
  const filepath = findDataFile(filename);

  if (!filepath) {
    return { data: null, missing: true, filename };
  }

  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const data = JSON.parse(content);
    return { data, missing: false, filename, path: filepath };
  } catch (error) {
    console.error(`Error loading JSON ${filename}:`, error.message);
    return { data: null, missing: true, filename, error: error.message };
  }
}

export function loadAllData() {
  const result = {
    oi_1h: loadCSV('okx_btc_oi_candles_1h_joined.csv'),
    oi_1d: loadCSV('okx_btc_oi_candles_1d_joined.csv'),
    candles_1h: loadCSV('okx_btc_usdt_swap_candles_1h.csv'),
    candles_1d: loadCSV('okx_btc_usdt_swap_candles_1d.csv'),
    etf_btc: loadCSV('etf_btc_daily_net_flows.csv'),
    etf_eth: loadCSV('etf_eth_daily_net_flows.csv'),
    indicators: loadCSV('indicators_daily.csv'),
    ratios: loadCSV('ratios_daily.csv'),
    correlations: loadCSV('corr_30d_vs_btc.csv'),
    universe: loadJSON('cg_top100_universe.json'),
    snapshot: loadJSON('cg_top100_snapshot.json'),
    backtest: loadJSON('backtest_sketch.json'),
    manifest: loadJSON('manifest.json')
  };

  const missing = [];
  for (const [key, value] of Object.entries(result)) {
    if (value.missing) {
      missing.push(value.filename);
    }
  }

  return { ...result, missing };
}

export { EXPECTED_FILES };
