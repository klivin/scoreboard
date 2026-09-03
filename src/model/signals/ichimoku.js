/**
 * Ichimoku trend confirmation using pack tenkan/kijun/senkou fields.
 * Rules (all must align for full confidence):
 * 1. Price vs cloud: close above max(senkouA, senkouB) for bullish; below min for bearish
 * 2. Tenkan/Kijun cross: tenkan crosses above kijun (bull) or below (bear)
 * 3. Chikou confirmation: chikou above past price (bull) or below (bear) — uses chikou vs close 26 bars ago
 */
export const ichimokuStrategy = {
  id: 'ichimoku',
  name: 'Ichimoku Trend Confirmation',
  horizon: 'weekly',

  evaluate(series, options = {}) {
    const signals = [];
    const lag = 26;

    for (let i = 1; i < series.length; i++) {
      const row = series[i];
      const prev = series[i - 1];
      const ts = row.timestamp;
      const tenkan = row.tenkan;
      const kijun = row.kijun;
      const senkouA = row.senkouA;
      const senkouB = row.senkouB;
      const chikou = row.chikou;
      const close = row.close;

      if (!ts || !Number.isFinite(tenkan) || !Number.isFinite(kijun)
        || !Number.isFinite(senkouA) || !Number.isFinite(senkouB)
        || !Number.isFinite(close)) {
        continue;
      }

      const cloudTop = Math.max(senkouA, senkouB);
      const cloudBottom = Math.min(senkouA, senkouB);
      const aboveCloud = close > cloudTop;
      const belowCloud = close < cloudBottom;

      const tkCrossUp = Number.isFinite(prev.tenkan) && Number.isFinite(prev.kijun)
        && prev.tenkan <= prev.kijun && tenkan > kijun;
      const tkCrossDown = Number.isFinite(prev.tenkan) && Number.isFinite(prev.kijun)
        && prev.tenkan >= prev.kijun && tenkan < kijun;

      const pastIdx = i - lag;
      const pastClose = pastIdx >= 0 ? series[pastIdx].close : null;
      let chikouBull = false;
      let chikouBear = false;
      if (Number.isFinite(chikou) && Number.isFinite(pastClose)) {
        chikouBull = chikou > pastClose;
        chikouBear = chikou < pastClose;
      }

      const bullScore = (aboveCloud ? 1 : 0) + (tkCrossUp ? 1 : 0) + (chikouBull ? 1 : 0);
      const bearScore = (belowCloud ? 1 : 0) + (tkCrossDown ? 1 : 0) + (chikouBear ? 1 : 0);

      if (tkCrossUp && bullScore >= 2) {
        signals.push({
          timestamp: ts,
          signal: 'BUY',
          score: bullScore / 3,
          confidence: 50 + bullScore * 15,
          inputs: {
            tenkan, kijun, senkouA, senkouB, chikou, close,
            aboveCloud, chikouBull,
            confirmations: bullScore
          },
          invalidation: 'Invalid if price closes back below kijun or inside cloud'
        });
      } else if (tkCrossDown && bearScore >= 2) {
        signals.push({
          timestamp: ts,
          signal: 'SELL',
          score: -(bearScore / 3),
          confidence: 50 + bearScore * 15,
          inputs: {
            tenkan, kijun, senkouA, senkouB, chikou, close,
            belowCloud, chikouBear,
            confirmations: bearScore
          },
          invalidation: 'Invalid if price closes back above kijun or inside cloud'
        });
      } else if (tkCrossUp) {
        signals.push({
          timestamp: ts,
          signal: 'CLOSE',
          score: 0,
          confidence: 40,
          inputs: { tenkan, kijun, note: 'TK cross up but insufficient cloud/chikou confirmation' },
          invalidation: 'Wait for price above cloud + chikou confirmation'
        });
      } else if (tkCrossDown) {
        signals.push({
          timestamp: ts,
          signal: 'CLOSE',
          score: 0,
          confidence: 40,
          inputs: { tenkan, kijun, note: 'TK cross down but insufficient cloud/chikou confirmation' },
          invalidation: 'Wait for price below cloud + chikou confirmation'
        });
      }
    }

    return signals;
  }
};
