import type { Candle } from '../api/binance';

export interface Swing {
  i: number; // index in candles
  price: number;
  type: 'HH' | 'HL' | 'LH' | 'LL' | 'H' | 'L';
  t: number;
}

export type Regime =
  | 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'BREAKOUT'
  | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'CAPITULATION' | 'ACCUMULATION' | 'DISTRIBUTION';

// Fractal swing detection (k-bar pivots), deterministic
export function findSwings(candles: Candle[], k = 2): Swing[] {
  const out: Swing[] = [];
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
    }
    if (isHigh) out.push({ i, price: candles[i].h, type: 'H', t: candles[i].t });
    if (isLow) out.push({ i, price: candles[i].l, type: 'L', t: candles[i].t });
  }
  // label HH/HL/LH/LL relative to previous same-type swing
  let lastH: Swing | null = null, lastL: Swing | null = null;
  for (const s of out) {
    if (s.type === 'H') {
      if (lastH) s.type = s.price > lastH.price ? 'HH' : 'LH';
      lastH = s;
    } else {
      if (lastL) s.type = s.price > lastL.price ? 'HL' : 'LL';
      lastL = s;
    }
  }
  return out;
}

export interface StructureResult {
  trend: 'BULL' | 'BEAR' | 'NEUTRAL';
  bos: { type: 'BULL_BOS' | 'BEAR_BOS'; at: number; price: number; idx: number }[];
  choch: { type: 'BULL_CHOCH' | 'BEAR_CHOCH'; at: number; price: number; idx: number }[];
  support: number[];
  resistance: number[];
  regime: Regime;
  swings: Swing[];
}

// Break of structure: close beyond last swing high/low; CHoCH = break against dominant trend
export function analyzeStructure(candles: Candle[]): StructureResult {
  const swings = findSwings(candles);
  const highs = swings.filter(s => s.type === 'H' || s.type === 'HH' || s.type === 'LH');
  const lows = swings.filter(s => s.type === 'L' || s.type === 'HL' || s.type === 'LL');

  const lastHighs = highs.slice(-2).map(s => s.type).join('');
  const lastLows = lows.slice(-2).map(s => s.type).join('');
  let trend: StructureResult['trend'] = 'NEUTRAL';
  if (lastHighs.includes('HH') && lastLows.includes('HL')) trend = 'BULL';
  else if (lastHighs.includes('LH') && lastLows.includes('LL')) trend = 'BEAR';

  const bos: StructureResult['bos'] = [];
  const choch: StructureResult['choch'] = [];
  let dir: 'UP' | 'DOWN' | null = null; // internal structure direction

  for (const c of candles) {
    const priorHighs = highs.filter(s => s.t < c.t);
    const priorLows = lows.filter(s => s.t < c.t);
    if (!priorHighs.length || !priorLows.length) continue;
    const lastH = priorHighs[priorHighs.length - 1];
    const lastL = priorLows[priorLows.length - 1];
    if (c.c > lastH.price) {
      if (dir !== 'UP') {
        const ev = { type: (dir === 'DOWN' ? 'BULL_CHOCH' : 'BULL_BOS') as any, at: c.t, price: lastH.price, idx: candles.indexOf(c) };
        dir === 'DOWN' ? choch.push(ev) : bos.push(ev);
        dir = 'UP';
      }
    } else if (c.c < lastL.price) {
      if (dir !== 'DOWN') {
        const ev = { type: (dir === 'UP' ? 'BEAR_CHOCH' : 'BEAR_BOS') as any, at: c.t, price: lastL.price, idx: candles.indexOf(c) };
        dir === 'UP' ? choch.push(ev) : bos.push(ev);
        dir = 'DOWN';
      }
    }
  }

  // S/R from clustered swing prices
  const cluster = (prices: number[]) => {
    const sorted = [...prices].sort((a, b) => a - b);
    const groups: number[][] = [];
    for (const p of sorted) {
      const g = groups.find(gr => Math.abs(gr[gr.length - 1] - p) / p < 0.004);
      if (g) g.push(p); else groups.push([p]);
    }
    return groups.sort((a, b) => b.length - a.length).slice(0, 4).map(g => g.reduce((a, b) => a + b, 0) / g.length);
  };
  const price = candles.length ? candles[candles.length - 1].c : 0;
  const res = cluster(highs.map(s => s.price)).filter(p => p > price).slice(0, 3);
  const sup = cluster(lows.map(s => s.price)).filter(p => p < price).slice(0, 3);

  // regime
  const closes = candles.map(c => c.c);
  const n = Math.min(closes.length, 100);
  const window = closes.slice(-n);
  const mean = window.reduce((a, b) => a + b, 0) / (window.length || 1);
  const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length || 1);
  const cv = Math.sqrt(variance) / (mean || 1);
  const change = window.length > 1 ? (window[window.length - 1] - window[0]) / window[0] : 0;
  const rangePct = window.length ? (Math.max(...window) - Math.min(...window)) / (Math.min(...window) || 1) : 0;

  let regime: Regime = 'RANGING';
  if (change > 0.04 && cv > 0.015) regime = 'TRENDING_UP';
  else if (change < -0.04 && cv > 0.015) regime = 'TRENDING_DOWN';
  else if (cv > 0.035) regime = 'HIGH_VOLATILITY';
  else if (cv < 0.006) regime = 'LOW_VOLATILITY';
  const tail = candles.slice(-24);
  if (tail.length >= 12) {
    const lows12 = tail.map(c => c.l);
    const recentMin = Math.min(...lows12.slice(-6));
    const oldMin = Math.min(...lows12.slice(0, 6));
    const lastC = tail[tail.length - 1];
    if (change < -0.08 && lastC.c > recentMin * 1.01 && recentMin < oldMin) regime = 'CAPITULATION';
    else if (rangePct < 0.05 && cv < 0.012) {
      const volFirst = tail.slice(0, 12).reduce((a, c) => a + c.v, 0);
      const volSecond = tail.slice(12).reduce((a, c) => a + c.v, 0);
      regime = volSecond > volFirst && change >= 0 ? 'ACCUMULATION' : volSecond > volFirst ? 'DISTRIBUTION' : 'RANGING';
    }
  }

  return { trend, bos: bos.slice(-8), choch: choch.slice(-8), support: sup, resistance: res, regime, swings: swings.slice(-30) };
}
