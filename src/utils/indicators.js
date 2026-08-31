function calculateSMA(data, period, field = 'close') {
  if (data.length < period) return null;
  
  const sum = data.slice(-period).reduce((acc, point) => acc + (point[field] || 0), 0);
  return sum / period;
}

function calculateEMA(data, period, field = 'close') {
  if (data.length < period) return null;
  
  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(data.slice(0, period), period, field);
  
  for (let i = period; i < data.length; i++) {
    const value = data[i][field] || 0;
    ema = (value - ema) * multiplier + ema;
  }
  
  return ema;
}

function calculateMovingAverages(data, field = 'close') {
  const result = {};
  
  if (data.length >= 20) {
    result.ema20 = calculateEMA(data, 20, field);
    result.sma20 = calculateSMA(data, 20, field);
  }
  
  if (data.length >= 50) {
    result.sma50 = calculateSMA(data, 50, field);
  }
  
  if (data.length >= 100) {
    result.sma100 = calculateSMA(data, 100, field);
  }
  
  if (data.length >= 200) {
    result.sma200 = calculateSMA(data, 200, field);
  }
  
  return result;
}

function calculateIchimoku(data, tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52) {
  if (data.length < kijunPeriod) return null;
  
  function getHighLow(slice) {
    const highs = slice.map(p => p.high || p.close || 0);
    const lows = slice.map(p => p.low || p.close || 0);
    return {
      high: Math.max(...highs),
      low: Math.min(...lows)
    };
  }
  
  const tenkanSlice = data.slice(-tenkanPeriod);
  const tenkanHL = getHighLow(tenkanSlice);
  const tenkan = (tenkanHL.high + tenkanHL.low) / 2;
  
  const kijunSlice = data.slice(-kijunPeriod);
  const kijunHL = getHighLow(kijunSlice);
  const kijun = (kijunHL.high + kijunHL.low) / 2;
  
  const senkouA = (tenkan + kijun) / 2;
  
  let senkouB = null;
  if (data.length >= senkouBPeriod) {
    const senkouBSlice = data.slice(-senkouBPeriod);
    const senkouBHL = getHighLow(senkouBSlice);
    senkouB = (senkouBHL.high + senkouBHL.low) / 2;
  }
  
  const currentClose = data[data.length - 1].close || 0;
  const chikou = currentClose;
  
  return {
    tenkan,
    kijun,
    senkouA,
    senkouB,
    chikou
  };
}

function calculateAllIndicators(series) {
  const data = series.data;
  if (!data || data.length === 0) return {};
  
  const indicators = {
    ...calculateMovingAverages(data),
    ichimoku: calculateIchimoku(data)
  };
  
  return indicators;
}

function calculateNaiveForecast(data, horizon = 1) {
  if (!data || data.length === 0) return null;
  const latest = data[data.length - 1];
  return latest.close || latest.value || 0;
}

module.exports = {
  calculateSMA,
  calculateEMA,
  calculateMovingAverages,
  calculateIchimoku,
  calculateAllIndicators,
  calculateNaiveForecast
};
