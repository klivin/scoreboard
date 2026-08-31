const fs = require('fs');
const path = require('path');
const Series = require('../models/Series');
const Universe = require('../models/Universe');
const ErrorLog = require('../models/ErrorLog');

const DATA_PATHS = [
  path.join(__dirname, '../../data'),
  '/workspace/scoreboard'
];

const EXPECTED_FILES = {
  okxOI1h: 'okx_btc_oi_1h.json',
  okxOI1d: 'okx_btc_oi_1d.json',
  okxCandles1h: 'okx_btc_candles_1h.json',
  okxCandles1d: 'okx_btc_candles_1d.json',
  farsideBTC: 'farside_btc_etf.json',
  farsideETH: 'farside_eth_etf.json',
  top100: 'top100_freeze.json',
  indicators: 'indicators.json',
  altBTC: 'alt_btc_ratios.json',
  backtest: 'backtest_sketch.json',
  gaps: 'gaps.md'
};

function findFile(filename) {
  for (const basePath of DATA_PATHS) {
    const fullPath = path.join(basePath, filename);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function readJSONFile(filename, errorLog) {
  const filePath = findFile(filename);
  
  if (!filePath) {
    errorLog.warn(`Missing expected file: ${filename}`, { filename });
    return null;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    errorLog.error(`Failed to read or parse ${filename}`, { filename, error: error.message });
    return null;
  }
}

function createFixtureSeries(symbol, interval, length = 100) {
  const data = [];
  const now = Date.now();
  const intervalMs = interval === '1h' ? 3600000 : 86400000;
  
  let basePrice = symbol.includes('BTC') ? 60000 : 3000;
  
  for (let i = 0; i < length; i++) {
    const timestamp = new Date(now - (length - i) * intervalMs).toISOString();
    const volatility = basePrice * 0.02;
    const change = (Math.random() - 0.5) * volatility;
    
    const close = basePrice + change;
    const open = basePrice;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    const volume = Math.random() * 1000000000;
    
    data.push({ timestamp, open, high, low, close, volume });
    basePrice = close;
  }
  
  return data;
}

function ingestOKXData(errorLog) {
  const series = {};
  
  const oi1h = readJSONFile(EXPECTED_FILES.okxOI1h, errorLog);
  if (oi1h) {
    series.btcOI1h = new Series('BTC_OI', oi1h, { source: 'okx', interval: '1h' });
  } else {
    const fixtureData = Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(Date.now() - (100 - i) * 3600000).toISOString(),
      openInterest: 1000000000 + Math.random() * 100000000
    }));
    series.btcOI1h = new Series('BTC_OI', fixtureData, { source: 'fixture', interval: '1h', isFallback: true });
  }
  
  const oi1d = readJSONFile(EXPECTED_FILES.okxOI1d, errorLog);
  if (oi1d) {
    series.btcOI1d = new Series('BTC_OI', oi1d, { source: 'okx', interval: '1d' });
  } else {
    const fixtureData = Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(Date.now() - (100 - i) * 86400000).toISOString(),
      openInterest: 1000000000 + Math.random() * 100000000
    }));
    series.btcOI1d = new Series('BTC_OI', fixtureData, { source: 'fixture', interval: '1d', isFallback: true });
  }
  
  const candles1h = readJSONFile(EXPECTED_FILES.okxCandles1h, errorLog);
  if (candles1h) {
    series.btcCandles1h = new Series('BTC', candles1h, { source: 'okx', interval: '1h' });
  } else {
    series.btcCandles1h = new Series('BTC', createFixtureSeries('BTC', '1h'), { source: 'fixture', interval: '1h', isFallback: true });
  }
  
  const candles1d = readJSONFile(EXPECTED_FILES.okxCandles1d, errorLog);
  if (candles1d) {
    series.btcCandles1d = new Series('BTC', candles1d, { source: 'okx', interval: '1d' });
  } else {
    series.btcCandles1d = new Series('BTC', createFixtureSeries('BTC', '1d'), { source: 'fixture', interval: '1d', isFallback: true });
  }
  
  return series;
}

function ingestETFData(errorLog) {
  const series = {};
  
  const btcETF = readJSONFile(EXPECTED_FILES.farsideBTC, errorLog);
  if (btcETF) {
    series.btcETF = new Series('BTC_ETF', btcETF, { source: 'farside' });
  } else {
    const fixtureData = Array.from({ length: 60 }, (_, i) => ({
      timestamp: new Date(Date.now() - (60 - i) * 86400000).toISOString(),
      flow: (Math.random() - 0.5) * 100000000
    }));
    series.btcETF = new Series('BTC_ETF', fixtureData, { source: 'fixture', isFallback: true });
  }
  
  const ethETF = readJSONFile(EXPECTED_FILES.farsideETH, errorLog);
  if (ethETF) {
    series.ethETF = new Series('ETH_ETF', ethETF, { source: 'farside' });
  } else {
    const fixtureData = Array.from({ length: 60 }, (_, i) => ({
      timestamp: new Date(Date.now() - (60 - i) * 86400000).toISOString(),
      flow: (Math.random() - 0.5) * 50000000
    }));
    series.ethETF = new Series('ETH_ETF', fixtureData, { source: 'fixture', isFallback: true });
  }
  
  return series;
}

function ingestUniverse(errorLog) {
  const universe = new Universe();
  
  const top100Data = readJSONFile(EXPECTED_FILES.top100, errorLog);
  if (top100Data) {
    if (Array.isArray(top100Data)) {
      top100Data.forEach((asset, index) => {
        universe.addAsset(asset.symbol || asset.id, {
          rank: asset.rank || index + 1,
          marketCap: asset.marketCap || asset.market_cap,
          categories: asset.categories || []
        });
      });
    }
  } else {
    const fixtureAssets = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'MATIC'];
    fixtureAssets.forEach((symbol, index) => {
      universe.addAsset(symbol, {
        rank: index + 1,
        marketCap: 100000000000 / (index + 1),
        categories: []
      });
    });
  }
  
  universe.lastUpdate = new Date().toISOString();
  return universe;
}

function ingestAltRatios(errorLog) {
  const altRatios = readJSONFile(EXPECTED_FILES.altBTC, errorLog);
  if (altRatios) {
    return altRatios;
  }
  
  const fixtureRatios = {};
  ['ETH', 'BNB', 'SOL', 'XRP', 'ADA'].forEach(symbol => {
    fixtureRatios[symbol] = Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(Date.now() - (100 - i) * 86400000).toISOString(),
      ratio: 0.05 + Math.random() * 0.02
    }));
  });
  
  return fixtureRatios;
}

function ingestAll() {
  const errorLog = new ErrorLog();
  
  const okxSeries = ingestOKXData(errorLog);
  const etfSeries = ingestETFData(errorLog);
  const universe = ingestUniverse(errorLog);
  const altRatios = ingestAltRatios(errorLog);
  
  const gapsPath = findFile(EXPECTED_FILES.gaps);
  let gapsContent = '';
  if (gapsPath) {
    try {
      gapsContent = fs.readFileSync(gapsPath, 'utf8');
    } catch (error) {
      errorLog.warn('Failed to read gaps.md', { error: error.message });
    }
  }
  
  const backtestData = readJSONFile(EXPECTED_FILES.backtest, errorLog);
  
  return {
    series: { ...okxSeries, ...etfSeries },
    universe,
    altRatios,
    backtest: backtestData,
    gaps: gapsContent,
    errorLog
  };
}

module.exports = {
  ingestAll,
  ingestOKXData,
  ingestETFData,
  ingestUniverse,
  ingestAltRatios,
  findFile,
  EXPECTED_FILES
};
