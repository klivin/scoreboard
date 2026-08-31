export function calculateSMA(data, period, field = 'close') {
  const result = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j][field];
    }
    result.push(sum / period);
  }
  
  return result;
}

export function calculateEMA(data, period, field = 'close') {
  const result = [];
  const multiplier = 2 / (period + 1);
  
  let ema = null;
  for (let i = 0; i < data.length; i++) {
    if (ema === null) {
      if (i >= period - 1) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += data[i - j][field];
        }
        ema = sum / period;
      } else {
        result.push(null);
        continue;
      }
    } else {
      ema = (data[i][field] - ema) * multiplier + ema;
    }
    result.push(ema);
  }
  
  return result;
}

export function calculateIchimoku(data) {
  const tenkanPeriod = 9;
  const kijunPeriod = 26;
  const senkouBPeriod = 52;
  const displacement = 26;
  
  const highLow = (start, end) => {
    let high = -Infinity;
    let low = Infinity;
    for (let i = start; i <= end; i++) {
      if (i < 0 || i >= data.length) continue;
      high = Math.max(high, data[i].high);
      low = Math.min(low, data[i].low);
    }
    return (high + low) / 2;
  };
  
  const result = [];
  
  for (let i = 0; i < data.length; i++) {
    const tenkan = i >= tenkanPeriod - 1 ? highLow(i - tenkanPeriod + 1, i) : null;
    const kijun = i >= kijunPeriod - 1 ? highLow(i - kijunPeriod + 1, i) : null;
    const senkouB = i >= senkouBPeriod - 1 ? highLow(i - senkouBPeriod + 1, i) : null;
    
    let senkouA = null;
    if (tenkan !== null && kijun !== null) {
      senkouA = (tenkan + kijun) / 2;
    }
    
    const chikou = data[i].close;
    
    result.push({
      tenkan,
      kijun,
      senkouA,
      senkouB,
      chikou
    });
  }
  
  return result;
}

export function addIndicators(candles) {
  if (!candles || candles.length === 0) return [];
  
  const ma20 = calculateEMA(candles, 20);
  const ma50 = calculateSMA(candles, 50);
  const ma100 = calculateSMA(candles, 100);
  const ma200 = calculateSMA(candles, 200);
  const ichimoku = calculateIchimoku(candles);
  
  return candles.map((candle, i) => ({
    ...candle,
    ma20: ma20[i],
    ma50: ma50[i],
    ma100: ma100[i],
    ma200: ma200[i],
    ...ichimoku[i]
  }));
}
