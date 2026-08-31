export function naiveBaseline(data, horizonDays) {
  if (!data || data.length === 0) return null;
  
  const lastPrice = data[data.length - 1].close;
  
  return {
    method: 'naive',
    horizonDays,
    prediction: lastPrice,
    timestamp: Date.now()
  };
}

export function calculateMAE(predictions, actuals) {
  if (!predictions || !actuals || predictions.length === 0) {
    return null;
  }
  
  let sum = 0;
  let count = 0;
  
  for (let i = 0; i < Math.min(predictions.length, actuals.length); i++) {
    if (predictions[i] !== null && actuals[i] !== null) {
      sum += Math.abs(predictions[i] - actuals[i]);
      count++;
    }
  }
  
  return count > 0 ? sum / count : null;
}

export function calculateMAPE(predictions, actuals) {
  if (!predictions || !actuals || predictions.length === 0) {
    return null;
  }
  
  let sum = 0;
  let count = 0;
  
  for (let i = 0; i < Math.min(predictions.length, actuals.length); i++) {
    if (predictions[i] !== null && actuals[i] !== null && actuals[i] !== 0) {
      sum += Math.abs((actuals[i] - predictions[i]) / actuals[i]);
      count++;
    }
  }
  
  return count > 0 ? (sum / count) * 100 : null;
}

export function generateForecast(data, horizonDays) {
  const naive = naiveBaseline(data, horizonDays);
  
  const lastPrice = data[data.length - 1].close;
  const ma20 = data[data.length - 1].ma20;
  
  let trend = 0;
  if (data.length >= 7) {
    const priceSevenDaysAgo = data[data.length - 7].close;
    trend = (lastPrice - priceSevenDaysAgo) / priceSevenDaysAgo;
  }
  
  const trendAdjustment = lastPrice * trend * (horizonDays / 7);
  const prediction = lastPrice + trendAdjustment;
  
  const volatility = calculateVolatility(data.slice(-30));
  const bandWidth = volatility * Math.sqrt(horizonDays) * lastPrice;
  
  return {
    method: 'trend',
    horizonDays,
    prediction,
    upper: prediction + bandWidth,
    lower: prediction - bandWidth,
    naive: naive.prediction,
    timestamp: Date.now(),
    metadata: {
      lastPrice,
      trend: trend * 100,
      volatility: volatility * 100
    }
  };
}

function calculateVolatility(data) {
  if (!data || data.length < 2) return 0.02;
  
  const returns = [];
  for (let i = 1; i < data.length; i++) {
    const ret = Math.log(data[i].close / data[i - 1].close);
    returns.push(ret);
  }
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
  
  return Math.sqrt(variance);
}

export function createForecastCard(symbol, data, horizonDays) {
  const forecast = generateForecast(data, horizonDays);
  const naive = naiveBaseline(data, horizonDays);
  
  const lastPrice = data[data.length - 1].close;
  const side = forecast.prediction > lastPrice ? 'LONG' : 'SHORT';
  const changePercent = ((forecast.prediction - lastPrice) / lastPrice) * 100;
  
  const proCase = side === 'LONG' 
    ? `Trend shows ${forecast.metadata.trend.toFixed(2)}% weekly momentum. MA20 support at ${forecast.metadata.lastPrice.toFixed(0)}.`
    : `Downward pressure with ${Math.abs(forecast.metadata.trend).toFixed(2)}% weekly decline. Breaking key levels.`;
  
  const conCase = side === 'LONG'
    ? `High volatility ${forecast.metadata.volatility.toFixed(2)}% may reverse gains. Resistance overhead.`
    : `Oversold conditions may trigger bounce. Support levels nearby.`;
  
  return {
    symbol,
    horizonDays,
    side,
    prediction: forecast.prediction,
    upper: forecast.upper,
    lower: forecast.lower,
    naive: naive.prediction,
    changePercent,
    confidence: Math.min(95, Math.max(60, 80 - forecast.metadata.volatility * 2)),
    proCase,
    conCase,
    recommendation: Math.abs(changePercent) > 3 ? side : 'NEUTRAL',
    timestamp: forecast.timestamp
  };
}
