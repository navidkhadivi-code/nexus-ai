import type { Candle } from '../api/binance';
import type { OrderBook, Trade } from '../api/binance';
import { findSwings } from './structure';
import { volumeProfile } from './indicators';

export interface LiquidityResult {
  equalHighs: number[];
  equalLows: number[];
  sweeps: { side: 'UP' | 'DOWN'; price: number; at: number }[];
  orderBlocks: { type: 'BULL' | 'BEAR'; top: number; bottom: number; at: number }[];
  fvgs: { type: 'BULL' | 'BEAR'; top: number; bottom: number; at: number }[];
  above: number[]; // resting liquidity above price
  below: number[]; // resting liquidity below price
  nearestAbove: number | null;
  nearestBelow: number | null;
  hvn: number[];
  lvn: number[];
  poc: number | null;
  // probabilities are estimates from historical behavior, never guarantees
  sweepProbAbove: number;
  sweepProbBelow: number;
}

export function analyzeLiquidity(candles: Candle[], book: OrderBook | null, trades: Trade[]): LiquidityResult {
  const swings = findSwings(candles, 3);
  const highs = swings.filter(s => s.type.startsWith('H') || s.type === 'H').map(s => s.price);
  const lows = swings.filter(s => s.type.startsWith('L') || s.type === 'L').map(s => s.price);

  const tol = 0.0015;
  const clusters = (prices: number[]) => {
    const used = new Set<number>();
    const out: number[] = [];
    const sorted = [...prices].sort((a, b) => b - a);
    for (let i = 0; i < sorted.length; i++) {
      if (used.has(i)) continue;
      const g = [sorted[i]];
      for (let j = i + 1; j < sorted.length; j++) {
        if (!used.has(j) && Math.abs(sorted[j] - sorted[i]) / sorted[i] < tol) { g.push(sorted[j]); used.add(j); }
      }
      if (g.length >= 2) out.push(g.reduce((a, b) => a + b, 0) / g.length);
    }
    return out.slice(0, 5);
  };
  const equalHighs = clusters(highs);
  const equalLows = clusters(lows);

  // sweeps: wick beyond cluster then close back
  const sweeps: LiquidityResult['sweeps'] = [];
  for (const c of candles.slice(-120)) {
    for (const eh of equalHighs) if (c.h > eh && c.c < eh && Math.abs(c.h - eh) / eh < 0.01) sweeps.push({ side: 'UP', price: eh, at: c.t });
    for (const el of equalLows) if (c.l < el && c.c > el && Math.abs(c.l - el) / el < 0.01) sweeps.push({ side: 'DOWN', price: el, at: c.t });
  }
  const recentSweeps = sweeps.slice(-10);

  // order blocks: last opposite candle before impulse
  const orderBlocks: LiquidityResult['orderBlocks'] = [];
  for (let i = 2; i < candles.length - 1; i++) {
    const a = candles[i - 1], b = candles[i], cc = candles[i + 1];
    const impulse = (cc.c - b.c) / b.c;
    if (Math.abs(impulse) > 0.008) {
      if (b.c < b.o && impulse > 0) orderBlocks.push({ type: 'BULL', top: Math.max(a.h, b.h), bottom: Math.min(a.l, b.l), at: b.t });
      if (b.c > b.o && impulse < 0) orderBlocks.push({ type: 'BEAR', top: Math.max(a.h, b.h), bottom: Math.min(a.l, b.l), at: b.t });
    }
  }
  const unmitigated = orderBlocks.slice(-60).filter((ob, _, arr) => {
    const idx = candles.findIndex(c => c.t === ob.at);
    for (let i = idx + 2; i < candles.length; i++) {
      if (candles[i].l <= ob.top && candles[i].h >= ob.bottom) return false;
    }
    return true;
  }).slice(-6);

  // fair value gaps
  const fvgs: LiquidityResult['fvgs'] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const a = candles[i - 1], c = candles[i + 1];
    if (a.h < c.l && (c.l - a.h) / a.h > 0.0012) fvgs.push({ type: 'BULL', top: c.l, bottom: a.h, at: c.t });
    if (a.l > c.h && (a.l - c.h) / a.l > 0.0012) fvgs.push({ type: 'BEAR', top: a.l, bottom: c.h, at: c.t });
  }
  const openFvgs = fvgs.slice(-40).filter(f => {
    const idx = candles.findIndex(c => c.t === f.at);
    for (let i = idx + 1; i < candles.length; i++) if (candles[i].l <= f.top && candles[i].h >= f.bottom) return false;
    return true;
  }).slice(-8);

  // resting liquidity from order book (top-20 snapshot → extrapolate levels)
  let above: number[] = [], below: number[] = [];
  let nearAbove: number | null = null, nearBelow: number | null = null;
  if (book && book.bids.length && book.asks.length) {
    const price = (book.bids[0].price + book.asks[0].price) / 2;
    const maxQty = Math.max(...book.asks.map(a => a.qty), ...book.bids.map(b => b.qty), 1e-9);
    above = book.asks.filter(a => a.qty > maxQty * 0.5).map(a => a.price).slice(0, 5);
    below = book.bids.filter(b => b.qty > maxQty * 0.5).map(b => b.price).slice(0, 5);
    nearAbove = book.asks.length ? book.asks[book.asks.length - 1].price : null;
    nearBelow = book.bids.length ? book.bids[book.bids.length - 1].price : null;
    // liquidity concentration walls
    above = [...new Set([...above, ...equalHighs.filter(p => p > price && p / price < 1.02)])];
    below = [...new Set([...below, ...equalLows.filter(p => p < price && price / p < 1.02)])];
  }

  const vp = volumeProfile(candles.slice(-168));
  // historical sweep frequency (per-candle probability estimate) — NOT a guarantee
  const lookback = Math.min(candles.length - 1, 500);
  let upHits = 0, dnHits = 0;
  for (let i = candles.length - lookback; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    if (!p) continue;
    if (c.h > p.h && c.c < p.h) upHits++;
    if (c.l < p.l && c.c > p.l) dnHits++;
  }
  return {
    equalHighs, equalLows, sweeps: recentSweeps, orderBlocks: unmitigated, fvgs: openFvgs,
    above, below, nearestAbove: nearAbove, nearestBelow: nearBelow,
    hvn: vp.hvn, lvn: vp.lvn, poc: vp.poc || null,
    sweepProbAbove: lookback ? upHits / lookback : 0,
    sweepProbBelow: lookback ? dnHits / lookback : 0,
  };
}
