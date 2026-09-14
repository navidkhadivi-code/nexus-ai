import type { Candle } from '../api/binance';

// Gann analysis: geometric price/time relationships.
// Outputs are analytical probabilities/zones â€” never certainty.

export interface GannLevel {
  price: number;
  angle: string; // 1x1, 1x2 ...
  kind: 'SUPPORT' | 'RESISTANCE';
  strength: number; // 0..1 from touch count
}

export interface GannResult {
  origin: { t: number; price: number };
  levels: GannLevel[];
  squareOf9: number[];
  timeCycles: number[]; // upcoming time windows (ms)
  fib: { price: number; label: string }[];
  reversalZones: { price: number; score: number }[];
}

const ANGLES: [string, number][] = [['1x1', 1], ['1x2', 2], ['1x4', 4], ['2x1', 0.5], ['4x1', 0.25]];

export function analyzeGann(candles: Candle[]): GannResult | null {
  if (candles.length < 60) return null;

  // origin = most significant swing low in the RECENT window (last 150 bars) so angles stay relevant
  const start = Math.max(0, candles.length - 150);
  let originIdx = start;
  for (let i = start; i < candles.length; i++) {
    if (i === start || candles[i].l < candles[originIdx].l) originIdx = i;
  }
  // prefer a fractal low
  const swingsIdx = candles.map((_, i) => i).filter(i =>
    i > Math.max(2, start) && i < candles.length - 2 &&
    candles[i].l <= Math.min(candles[i - 1].l, candles[i - 2].l, candles[i + 1].l, candles[i + 2].l));
  if (swingsIdx.length) originIdx = swingsIdx.reduce((best, i) => (candles[i].l < candles[best].l ? i : best), swingsIdx[0]);

  const origin = candles[originIdx];
  // unit calibrated so the 1x1 angle connects origin swing to CURRENT price (classic Gann fan);
  // other angles (1x2, 1x4, 2x1, 4x1) fan proportionally around it.
  const barsSince = Math.max(1, candles.length - 1 - originIdx);
  const vr = candles.slice(-60);
  const avgRange = vr.length ? vr.reduce((a, c) => a + (c.h - c.l), 0) / vr.length : origin.l * 0.002;
  const cur = candles[candles.length - 1].c;
  const unit = Math.max((cur - origin.l) / barsSince, avgRange * 0.25, origin.l * 0.0004);

  const levels: GannLevel[] = [];
  for (const [name, slope] of ANGLES) {
    for (const dir of [1, -1] as const) {
      const p = origin.l + dir * slope * unit * (candles.length - 1 - originIdx);
      if (p <= 0) continue;
      const kind = dir > 0 ? 'RESISTANCE' : 'SUPPORT';
      // touch strength: bars that came within 0.3% of this line after origin
      let touches = 0;
      for (let i = originIdx + 5; i < candles.length; i++) {
        const line = origin.l + dir * slope * unit * (i - originIdx);
        const near = Math.min(Math.abs(candles[i].h - line), Math.abs(candles[i].l - line));
        if (near / (line || 1) < 0.003) touches++;
      }
      levels.push({ price: p, angle: name, kind, strength: Math.min(1, touches / 8) });
    }
  }

  // Square of Nine from origin price
  const root = Math.sqrt(origin.l);
  const sq: number[] = [];
  for (const mult of [0.5, 1, 1.25, 1.5, 1.875, 2, 2.25, 2.5]) {
    sq.push((root + mult) ** 2);
    sq.push((root - mult) ** 2);
  }

  // time cycles: bars since origin + natural cycles (7,14,21,28,33,42,49,52,60,90)
  const elapsed = candles.length - 1 - originIdx;
  const barsPerDay = candles.length > 2 ? Math.round(86400000 / (candles[1].t - candles[0].t)) : 24;
  const cycles = [7, 14, 21, 28, 33, 42, 49, 52, 60, 90, 120, 144, 180]
    .filter(c => c > elapsed * 0.3)
    .map(c => origin.t + c * (barsPerDay ? 86400000 / barsPerDay : 3600000));

  // Fibonacci retracement from origin swing to current
  const last = candles[candles.length - 1];
  let hi = origin.l, lo = origin.l, hiIdx = originIdx, loIdx = originIdx;
  for (let i = originIdx; i < candles.length; i++) {
    if (candles[i].h > hi) { hi = candles[i].h; hiIdx = i; }
    if (candles[i].l < lo) { lo = candles[i].l; loIdx = i; }
  }
  const up = hiIdx >= loIdx;
  const range = hi - lo;
  const fib = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map(r => ({
    price: up ? hi - range * r : lo + range * r,
    label: r === 0 ? '0' : r === 1 ? '1' : String(r),
  }));

  // reversal zones: confluence of gann angles + square9 + fib levels
  const allLevels = [
    ...levels.map(l => ({ p: l.price, s: l.strength * 0.8 })),
    ...sq.map(p => ({ p, s: 0.4 })),
    ...fib.map(f => ({ p: f.price, s: 0.5 })),
  ].filter(x => x.p > 0);
  const zones: { price: number; score: number }[] = [];
  for (const a of allLevels) {
    const near = zones.find(z => Math.abs(z.price - a.p) / a.p < 0.004);
    if (near) { near.score += a.s; near.price = (near.price + a.p) / 2; }
    else zones.push({ price: a.p, score: a.s });
  }
  zones.sort((a, b) => b.score - a.score);

  return { origin: { t: origin.t, price: origin.l }, levels, squareOf9: sq, timeCycles: cycles.slice(0, 6), fib, reversalZones: zones.slice(0, 6) };
}
