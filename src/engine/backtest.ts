import type { Candle } from '../api/binance';
import { analyzeStructure } from './structure';
import { ema, rsi, atr, last } from './indicators';

// Event-driven backtester. Decision on bar i CLOSE → execution on bar i+1 OPEN.
// No look-ahead: signal only sees candles[0..i]. Fees + slippage + spread included.

export interface BtConfig {
  feeRate: number;      // per side
  slippageBps: number;  // per side
  riskPct: number;      // per trade
  initialBalance: number;
  stopAtrMult: number;
  targetAtrMult: number;
  warmupBars: number;   // bars used only to prime indicators — never scored
}

export interface BtTrade {
  entryTime: number; exitTime: number; side: 'LONG' | 'SHORT';
  entry: number; exit: number; qty: number; pnl: number; r: number; reason: 'SL' | 'TP' | 'EOD';
}

export interface BtMetrics {
  netProfit: number; roiPct: number; winRate: number; profitFactor: number;
  expectancy: number; avgR: number; sharpe: number; sortino: number;
  maxDrawdownPct: number; trades: number; losingStreak: number; winningStreak: number;
}

export const DEFAULT_BT: BtConfig = { feeRate: 0.001, slippageBps: 3, riskPct: 0.5, initialBalance: 10000, stopAtrMult: 1.5, targetAtrMult: 3, warmupBars: 120 };

// Strategy: structure-trend + EMA filter + RSI guard. Deterministic.
export function backtest(candles: Candle[], cfg: BtConfig = DEFAULT_BT): { trades: BtTrade[]; equity: { t: number; v: number }[]; metrics: BtMetrics; evalFrom: number; evalTo: number } {
  const closes = candles.map(c => c.c);
  const e20 = ema(closes, 20), e50 = ema(closes, 50);
  const r = rsi(closes, 14);
  const a = atr(candles, 14);
  const struct: ReturnType<typeof analyzeStructure>[] = [];
  const STRIDE = 10;
  const WARMUP = Math.max(60, cfg.warmupBars || 120);
  let structCurrent = analyzeStructure(candles.slice(0, Math.min(candles.length, WARMUP)));
  const trades: BtTrade[] = [];
  let balance = cfg.initialBalance;
  const equity: { t: number; v: number }[] = [];
  let pos: { side: 'LONG' | 'SHORT'; entry: number; qty: number; sl: number; tp: number; openTime: number } | null = null;

  for (let i = WARMUP; i < candles.length - 1; i++) {
    if (i % STRIDE === 0) structCurrent = analyzeStructure(candles.slice(Math.max(0, i - 400), i + 1));
    const c = candles[i];
    const atrV = a[i] ?? (c.c * 0.005);
    const e20v = e20[i], e50v = e50[i], rv = r[i];

    // manage open position (realistic: check bar extremes)
    if (pos) {
      let exitPx: number | null = null, why: 'SL' | 'TP' = 'SL';
      if (pos.side === 'LONG') {
        if (c.l <= pos.sl) { exitPx = pos.sl; why = 'SL'; }
        else if (c.h >= pos.tp) { exitPx = pos.tp; why = 'TP'; }
      } else {
        if (c.h >= pos.sl) { exitPx = pos.sl; why = 'SL'; }
        else if (c.l <= pos.tp) { exitPx = pos.tp; why = 'TP'; }
      }
      if (exitPx != null) {
        const slip = exitPx * cfg.slippageBps / 10000 * (pos.side === 'LONG' ? -1 : 1);
        const px = exitPx + slip;
        const gross = pos.side === 'LONG' ? (px - pos.entry) * pos.qty : (pos.entry - px) * pos.qty;
        const fees = (pos.entry + px) * pos.qty * cfg.feeRate;
        const pnl = gross - fees;
        balance += pnl;
        const risk = Math.abs(pos.entry - pos.sl) * pos.qty;
        trades.push({ entryTime: pos.openTime, exitTime: c.t, side: pos.side, entry: pos.entry, exit: px, qty: pos.qty, pnl, r: risk ? pnl / risk : 0, reason: why });
        pos = null;
      }
    }

    // entry decision at close → next bar open execution
    if (!pos && e20v && e50v && rv != null && structCurrent) {
      let side: 'LONG' | 'SHORT' | null = null;
      if (structCurrent.trend === 'BULL' && c.c > e20v && e20v > e50v && rv > 50 && rv < 72) side = 'LONG';
      else if (structCurrent.trend === 'BEAR' && c.c < e20v && e20v < e50v && rv < 50 && rv > 28) side = 'SHORT';
      if (side) {
        const nextOpen = candles[i + 1].o;
        const slip = nextOpen * cfg.slippageBps / 10000 * (side === 'LONG' ? 1 : -1);
        const entry = nextOpen + slip;
        const stopDist = atrV * cfg.stopAtrMult;
        const riskUsd = balance * cfg.riskPct / 100;
        const qty = riskUsd / stopDist;
        if (qty * entry >= 10 && isFinite(qty)) {
          pos = {
            side, entry, qty, openTime: candles[i + 1].t,
            sl: side === 'LONG' ? entry - stopDist : entry + stopDist,
            tp: side === 'LONG' ? entry + atrV * cfg.targetAtrMult : entry - atrV * cfg.targetAtrMult,
          };
        }
      }
    }
    equity.push({ t: c.t, v: balance + (pos ? (pos.side === 'LONG' ? c.c - pos.entry : pos.entry - c.c) * pos.qty : 0) });
  }
  // force close at end
  if (pos) {
    const lastC = candles[candles.length - 1];
    const gross = pos.side === 'LONG' ? (lastC.c - pos.entry) * pos.qty : (pos.entry - lastC.c) * pos.qty;
    const fees = (pos.entry + lastC.c) * pos.qty * cfg.feeRate;
    const pnl = gross - fees;
    balance += pnl;
    trades.push({ entryTime: pos.openTime, exitTime: lastC.t, side: pos.side, entry: pos.entry, exit: lastC.c, qty: pos.qty, pnl, r: 0, reason: 'EOD' });
  }
  return {
    trades, equity,
    metrics: computeMetrics(trades, equity, cfg.initialBalance),
    evalFrom: candles[WARMUP]?.t ?? 0,
    evalTo: candles[candles.length - 1]?.t ?? 0,
  };
}

export function computeMetrics(trades: BtTrade[], equity: { t: number; v: number }[], initial: number): BtMetrics {
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const net = grossWin - grossLoss;
  let peak = initial, maxDD = 0;
  for (const e of equity) { peak = Math.max(peak, e.v); maxDD = Math.max(maxDD, (peak - e.v) / (peak || 1)); }
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) rets.push((equity[i].v - equity[i - 1].v) / (equity[i - 1].v || 1));
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1)) || 1e-9;
  const downside = rets.filter(r => r < 0);
  const dsd = Math.sqrt(downside.reduce((a, b) => a + b * b, 0) / (downside.length || 1)) || 1e-9;
  let ws = 0, ls = 0, cw = 0, cl = 0;
  for (const t of trades) { if (t.pnl > 0) { cw++; cl = 0; ws = Math.max(ws, cw); } else { cl++; cw = 0; ls = Math.max(ls, cl); } }
  return {
    netProfit: net, roiPct: (net / initial) * 100,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancy: trades.length ? net / trades.length : 0,
    avgR: trades.length ? trades.reduce((a, t) => a + t.r, 0) / trades.length : 0,
    sharpe: (mean / sd) * Math.sqrt(252), sortino: (mean / dsd) * Math.sqrt(252),
    maxDrawdownPct: maxDD * 100, trades: trades.length, losingStreak: ls, winningStreak: ws,
  };
}

// Monte Carlo resampling of trade sequence → ruin / drawdown distributions
export interface McResult { p5: number; p25: number; p50: number; p75: number; p95: number; probRuin: number; medianMaxDD: number; probNegative: number }

export function monteCarlo(trades: BtTrade[], initial: number, runs = 2000, ruinPct = 25): McResult {
  if (!trades.length) return { p5: initial, p25: initial, p50: initial, p75: initial, p95: initial, probRuin: 0, medianMaxDD: 0, probNegative: 0 };
  const finals: number[] = [], dds: number[] = [];
  let ruin = 0, neg = 0;
  const n = trades.length;
  for (let r = 0; r < runs; r++) {
    let bal = initial, peak = initial, mdd = 0;
    for (let i = 0; i < n; i++) {
      const t = trades[Math.floor(Math.random() * n)];
      bal += t.pnl;
      peak = Math.max(peak, bal);
      mdd = Math.max(mdd, (peak - bal) / (peak || 1));
      if (bal <= initial * (1 - ruinPct / 100)) { ruin++; break; }
    }
    finals.push(bal); dds.push(mdd);
    if (bal < initial) neg++;
  }
  finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.floor(arr.length * p)] ?? 0;
  return { p5: q(finals, 0.05), p25: q(finals, 0.25), p50: q(finals, 0.5), p75: q(finals, 0.75), p95: q(finals, 0.95), probRuin: (ruin / runs) * 100, medianMaxDD: q(dds, 0.5) * 100, probNegative: (neg / runs) * 100 };
}

// Walk-forward: optimize (stop/target multipliers) on in-sample, measure ONLY on out-of-sample.
export function walkForward(candles: Candle[], windows = 4, cfg: BtConfig = DEFAULT_BT) {
  const results: { window: number; isRoi: number; oosRoi: number; oosTrades: number; params: { stop: number; target: number } }[] = [];
  const size = Math.floor(candles.length / (windows + 2));
  for (let w = 0; w < windows; w++) {
    const is = candles.slice(w * size, (w + 3) * size);
    const oos = candles.slice((w + 3) * size, (w + 4) * size);
    if (oos.length < 60 || is.length < 150) break;
    let best = { roi: -Infinity, params: { stop: 1.5, target: 3 } };
    for (const stop of [1.0, 1.5, 2.0]) {
      for (const target of [2.0, 3.0, 4.0]) {
        const r = backtest(is, { ...cfg, stopAtrMult: stop, targetAtrMult: target });
        if (r.metrics.netProfit > best.roi) best = { roi: r.metrics.netProfit, params: { stop, target } };
      }
    }
    const oosRes = backtest(oos, { ...cfg, stopAtrMult: best.params.stop, targetAtrMult: best.params.target });
    results.push({ window: w + 1, isRoi: (best.roi / cfg.initialBalance) * 100, oosRoi: oosRes.metrics.roiPct, oosTrades: oosRes.metrics.trades, params: best.params });
  }
  return results;
}
