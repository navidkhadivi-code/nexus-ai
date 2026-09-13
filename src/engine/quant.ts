import type { Candle } from '../api/binance';

// Quant engine: pure statistics on real data. NO LLM, NO look-ahead:
// every metric at index i uses only candles[0..i].

export interface QuantResult {
  returns1h: number;      // last-candle return
  volAnn: number;         // annualized vol estimate from bar returns
  atrPct: number;
  zscore: number;         // price z-score vs 100-bar mean
  mom20: number;
  mom60: number;
  trendStrength: number;  // 0..1
  skew: number;
  kurtosis: number;
  expectancyR: number;    // average edge of simple momentum condition over history
  probUp: number;         // historical probability price closes higher N bars later after current regime
  regime: string;
}

const BARS_PER_YEAR: Record<string, number> = {
  '1m': 525600, '3m': 175200, '5m': 105120, '15m': 35040, '30m': 17520,
  '1h': 8760, '2h': 4380, '4h': 2190, '6h': 1460, '12h': 730, '1d': 365, '1w': 52,
};

export function analyzeQuant(candles: Candle[], tf: string): QuantResult {
  const closes = candles.map(c => c.c);
  const n = closes.length;
  if (n < 30) {
    return { returns1h: 0, volAnn: 0, atrPct: 0, zscore: 0, mom20: 0, mom60: 0, trendStrength: 0, skew: 0, kurtosis: 0, expectancyR: 0, probUp: 0.5, regime: 'INSUFFICIENT_DATA' };
  }
  const rets: number[] = [];
  for (let i = 1; i < n; i++) rets.push(Math.log(closes[i] / closes[i - 1]));

  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  const perYear = BARS_PER_YEAR[tf] ?? 8760;
  const volAnn = sd * Math.sqrt(perYear);

  const m = Math.min(100, n);
  const window = closes.slice(-m);
  const wm = window.reduce((a, b) => a + b, 0) / m;
  const ws = Math.sqrt(window.reduce((a, b) => a + (b - wm) ** 2, 0) / m) || 1e-9;
  const zscore = (closes[n - 1] - wm) / ws;

  const mom20 = n > 20 ? (closes[n - 1] - closes[n - 21]) / closes[n - 21] : 0;
  const mom60 = n > 60 ? (closes[n - 1] - closes[n - 61]) / closes[n - 61] : 0;

  // trend strength: |net move| / sum of |moves| over 60 bars
  let net = 0, path = 0;
  for (let i = Math.max(1, n - 60); i < n; i++) { net += closes[i] - closes[i - 1]; path += Math.abs(closes[i] - closes[i - 1]); }
  const trendStrength = path ? Math.abs(net) / path : 0;

  const r3 = rets.map(r => ((r - mean) / (sd || 1e-9)) ** 3).reduce((a, b) => a + b, 0) / rets.length;
  const r4 = rets.map(r => ((r - mean) / (sd || 1e-9)) ** 4).reduce((a, b) => a + b, 0) / rets.length - 3;

  const atrVals: number[] = [];
  for (let i = 1; i < n; i++) atrVals.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - closes[i - 1]), Math.abs(candles[i].l - closes[i - 1])));
  const atr = atrVals.slice(-14).reduce((a, b) => a + b, 0) / Math.min(14, atrVals.length) || 0;
  const atrPct = (atr / closes[n - 1]) * 100;

  // Forward-conditioned probabilities WITHOUT look-ahead in *decision*:
  // history is only used to estimate P(up | current signal). horizon = 6 bars.
  const H = 6;
  let cond = 0, upAfter = 0;
  let wins = 0, losses = 0, winSum = 0, lossSum = 0;
  for (let i = 20; i < n - H; i++) {
    const zWin = closes.slice(i - 20, i);
    const mu = zWin.reduce((a, b) => a + b, 0) / zWin.length;
    const s = Math.sqrt(zWin.reduce((a, b) => a + (b - mu) ** 2, 0) / zWin.length) || 1e-9;
    const z = (closes[i] - mu) / s;
    const fwd = (closes[i + H] - closes[i]) / closes[i];
    const isUpMomentum = closes[i] > closes[i - 1] && closes[i - 1] > closes[i - 2];
    if (isUpMomentum) { cond++; if (fwd > 0) upAfter++; }
    if (isUpMomentum) { const r = fwd / (atr / closes[i] || 1e-9); if (r > 0) { wins++; winSum += r; } else { losses++; lossSum += -r; } }
  }
  const probUp = cond ? upAfter / cond : 0.5;
  const expectancyR = cond ? (wins * (winSum / Math.max(wins, 1)) - losses * (lossSum / Math.max(losses, 1))) / cond : 0;

  const regime = volAnn > 1.2 ? 'HIGH_VOL' : volAnn < 0.35 ? 'LOW_VOL' : trendStrength > 0.35 ? (mom20 > 0 ? 'TREND_UP' : 'TREND_DOWN') : 'RANGE';

  return { returns1h: closes[n - 1] / closes[n - 2] - 1, volAnn, atrPct, zscore, mom20, mom60, trendStrength, skew: r3, kurtosis: r4, expectancyR, probUp, regime };
}

// Pearson correlation between two close series (aligned by trailing length)
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 20) return 0;
  const av = a.slice(-n), bv = b.slice(-n);
  const ma = av.reduce((x, y) => x + y, 0) / n, mb = bv.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (av[i] - ma) * (bv[i] - mb); da += (av[i] - ma) ** 2; db += (bv[i] - mb) ** 2; }
  return (da && db) ? num / Math.sqrt(da * db) : 0;
}
