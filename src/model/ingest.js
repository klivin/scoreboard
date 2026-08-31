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

export function findDataFile(filename) {
  if (fs.existsSync(OVERLAY_DATA_DIR)) {
    const overlayPath = path.join(OVERLAY_DATA_DIR, filename);
    if (fs.existsSync(overlayPath)) {
      return overlayPath;
    }
  }
  
  const repoPath = path.join(REPO_DATA_DIR, filename);
  if (fs.existsSync(repoPath)) {
    return repoPath;
  }
  
  return null;
}

export function parseCSV(content) {
  const lines = content.trim().split('\n');
  if (lines.length === 0) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length !== headers.length) continue;
    
    const row = {};
    headers.forEach((header, idx) => {
      const value = values[idx].trim();
      row[header] = isNaN(value) ? value : parseFloat(value);
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
    return { data, missing: false, filename };
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
    return { data, missing: false, filename };
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

export function getFixtureData(type) {
  const now = Date.now();
  const day = 86400000;
  
  switch(type) {
    case 'candles':
      return Array.from({ length: 30 }, (_, i) => ({
        timestamp: now - (29 - i) * day,
        open: 40000 + Math.random() * 2000,
        high: 41000 + Math.random() * 2000,
        low: 39000 + Math.random() * 2000,
        close: 40000 + Math.random() * 2000,
        volume: 1000000 + Math.random() * 500000
      }));
    
    case 'oi':
      return Array.from({ length: 30 }, (_, i) => ({
        timestamp: now - (29 - i) * day,
        oi: 10000 + Math.random() * 1000
      }));
    
    case 'indicators':
      return Array.from({ length: 30 }, (_, i) => ({
        timestamp: now - (29 - i) * day,
        ma20: 40000 + Math.random() * 1000,
        ma50: 39500 + Math.random() * 1000,
        ma100: 39000 + Math.random() * 1000,
        ma200: 38500 + Math.random() * 1000
      }));
    
    default:
      return [];
  }
}
