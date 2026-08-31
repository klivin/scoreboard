class Forecast {
  constructor(symbol, horizon, prediction, actual = null) {
    this.symbol = symbol;
    this.horizon = horizon;
    this.prediction = {
      value: prediction.value,
      side: prediction.side || 'neutral',
      confidence: prediction.confidence || 0.5,
      timestamp: prediction.timestamp || new Date().toISOString(),
      band: prediction.band || null
    };
    this.actual = actual;
    this.steelman = {
      pro: prediction.steelman?.pro || [],
      con: prediction.steelman?.con || []
    };
    this.pick = prediction.pick || null;
    this.naive = null;
  }

  setNaive(naiveValue) {
    this.naive = naiveValue;
  }

  setActual(actualValue) {
    this.actual = actualValue;
  }

  getError() {
    if (this.actual === null) return null;
    return Math.abs(this.prediction.value - this.actual);
  }

  getNaiveError() {
    if (this.actual === null || this.naive === null) return null;
    return Math.abs(this.naive - this.actual);
  }

  getMeanAbsoluteError() {
    return this.getError();
  }

  getNaiveMeanAbsoluteError() {
    return this.getNaiveError();
  }

  isNaiveBetter() {
    const mae = this.getMeanAbsoluteError();
    const naiveMae = this.getNaiveMeanAbsoluteError();
    if (mae === null || naiveMae === null) return null;
    return naiveMae < mae;
  }

  toJSON() {
    return {
      symbol: this.symbol,
      horizon: this.horizon,
      prediction: this.prediction,
      actual: this.actual,
      naive: this.naive,
      steelman: this.steelman,
      pick: this.pick,
      error: this.getError(),
      naiveError: this.getNaiveError(),
      naiveBetter: this.isNaiveBetter()
    };
  }
}

module.exports = Forecast;
