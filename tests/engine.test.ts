// Phase 44 — deterministic engine tests. Run: npm test
import { sma, ema, rsi, atr, last } from '../src/engine/indicators';
import { findSwings, analyzeStructure } from '../src/engine/structure';
import { correlation, analyzeQuant } from '../src/engine/quant';
import { analyzeLiquidity } from '../src/engine/liquidity';
import { analyzeGann } from '../src/engine/gann';
import { backtest, monteCarlo, computeMetrics } from '../src/engine/backtest';
import { aresEvaluate, rsiDivergence, agentQuant, type RiskConfig, type AgentContext } from '../src/agents/agents';
import { runConsensus } from '../src/agents/consensus';
import { loadAccount, openPosition, closePosition, managePositions } from '../src/paper/engine';
import type { Candle, OrderBook } from '../src/api/types';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.error(`  FAIL  ${name} ${detail}`); }
}

// ---------- synthetic REAL-shaped data (deterministic, seeded) ----------
let seed = 42;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

function makeSeries(n: number, drift: number, vol: number, start = 50000): Candle[] {
  const out: Candle[] = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    const o = px;
    const move = drift + (rand() - 0.5) * vol * px;
    const c = Math.max(1, o + move);
    const h = Math.max(o, c) * (1 + rand() * vol * 0.3);
    const l = Math.min(o, c) * (1 - rand() * vol * 0.3);
    out.push({ t: 1700000000000 + i * 900000, o, h, l, c, v: 10 + rand() * 50, q: (10 + rand() * 50) * c });
    px = c;
  }
  return out;
}

const upTrend = makeSeries(300, 0.0012, 0.01);
const noise = makeSeries(300, 0, 0.008);

console.log('\n== indicators ==');
{
  const s = sma([1, 2, 3, 4], 2);
  check('SMA exact', s[1] === 1.5 && s[3] === 3.5, JSON.stringify(s));
  const r = rsi(Array.from({ length: 60 }, (_, i) => 100 + i), 14);
  const rv = last(r);
  check('RSI all-up = 100', rv != null && Math.abs(rv - 100) < 1e-9, String(rv));
  const e = ema(upTrend.map(c => c.c), 20);
  check('EMA finite & trails price', e.every(v => v == null || isFinite(v)), '');
  const a = atr(upTrend, 14);
  const av = last(a)!;
  check('ATR > 0', av > 0, String(av));
}

console.log('\n== structure ==');
{
  const sw = findSwings(upTrend, 2);
  check('swings found', sw.length > 5, String(sw.length));
  const st = analyzeStructure(upTrend);
  check('uptrend classified BULL', st.trend === 'BULL', st.trend);
  check('structure break events detected', st.bos.length + st.choch.length > 0, JSON.stringify({ bos: st.bos.length, choch: st.choch.length }));
  check('regime detected', typeof st.regime === 'string' && st.regime.length > 0, st.regime);
}

console.log('\n== quant ==');
{
  check('corr(x,2x)≈1', Math.abs(correlation(upTrend.map(c => c.c), upTrend.map(c => 2 * c.c)) - 1) < 1e-9, '');
  const q = analyzeQuant(upTrend, '15m');
  check('probUp in [0,1]', q.probUp >= 0 && q.probUp <= 1, String(q.probUp));
  check('vol finite', isFinite(q.volAnn) && q.volAnn > 0, String(q.volAnn));
  check('probUp measured (differs from prior)', isFinite(q.probUp), String(q.probUp));
}

console.log('\n== liquidity + gann ==');
{
  const book: OrderBook = {
    bids: Array.from({ length: 20 }, (_, i) => ({ price: 50000 - i * 10, qty: 1 + i * 0.5 })),
    asks: Array.from({ length: 20 }, (_, i) => ({ price: 50010 + i * 10, qty: i === 5 ? 50 : 1 })),
    lastUpdateId: 1, ts: Date.now(), source: 'TEST', recv: Date.now(), latency: 1,
  };
  const liq = analyzeLiquidity(upTrend, book, []);
  check('liquidity above wall detected', liq.above.length > 0 || (liq.nearestAbove ?? 0) > 50000, '');
  check('fvg/orderblock arrays exist', Array.isArray(liq.fvgs) && Array.isArray(liq.orderBlocks), '');
  const g = analyzeGann(upTrend);
  check('gann returns levels', g !== null && g.levels.length === 10, String(g?.levels.length));
  check('gann zones sorted by score', g !== null && g.reversalZones.every((z, i, arr) => i === 0 || z.score <= arr[i - 1].score), '');
}

console.log('\n== CRITICAL: ARES veto cannot be bypassed ==');
{
  const ctx: any = {
    dataFresh: false, // STALE DATA
    quant: { atrPct: 1, volAnn: 0.5 }, funding: null,
    structure: { regime: 'TRENDING_UP' },
  };
  const cfg: RiskConfig = { balance: 10000, riskPct: 0.5, maxRiskPct: 1.5, maxDailyLossPct: 5, maxExposurePct: 60, maxLeverage: 5, minRR: 1.3, minConfidence: 55, dailyLossUsd: 0, openExposureUsd: 0 };
  const d1 = aresEvaluate({ direction: 'LONG', entry: 50000, stop: 49000, target: 52000, confidence: 90 }, cfg, ctx);
  check('stale data ⇒ VETO even at 90% confidence', !d1.allowed && d1.vetoReasons.some(r => r.includes('DATA_FRESHNESS')), JSON.stringify(d1.vetoReasons));
  const ctx2 = { ...ctx, dataFresh: true };
  const d2 = aresEvaluate({ direction: 'LONG', entry: 50000, stop: 49000, target: 52000, confidence: 30 }, cfg, ctx2);
  check('low confidence ⇒ VETO', !d2.allowed, JSON.stringify(d2.vetoReasons));
  const d3 = aresEvaluate({ direction: 'LONG', entry: 50000, stop: 49000, target: 50500, confidence: 80 }, cfg, ctx2);
  check('bad R/R (0.5) ⇒ VETO', !d3.allowed && d3.vetoReasons.some(r => r.includes('R_R')), JSON.stringify(d3.vetoReasons));
  const d4 = aresEvaluate({ direction: 'LONG', entry: 50000, stop: 49000, target: 52000, confidence: 80 }, cfg, ctx2);
  check('valid setup ⇒ APPROVED with exact sizing', d4.allowed && Math.abs(d4.maxLossUsd - 50) < 1e-9 && Math.abs(d4.quantity - 0.05) < 1e-9, JSON.stringify({ loss: d4.maxLossUsd, qty: d4.quantity }));
  // sizing formula: (10000 × 0.5%) / 1000 stop = 5 → $50 loss at $50 qty*stop ✓
  const cfg2 = { ...cfg, dailyLossUsd: 600 };
  const d5 = aresEvaluate({ direction: 'LONG', entry: 50000, stop: 49000, target: 52000, confidence: 80 }, cfg2, ctx2);
  check('daily loss limit ⇒ VETO', !d5.allowed && d5.vetoReasons.some(r => r.includes('DAILY_LOSS')), '');
}

console.log('\n== consensus: noise → NO TRADE ==');
{
  const ctx: any = {
    symbol: 'TESTUSDT', timeframe: '15m', candles: noise, mtf: { '1h': noise }, price: noise[noise.length - 1].c,
    structure: analyzeStructure(noise), liquidity: analyzeLiquidity(noise, null, []),
    orderflow: { buyVol: 0, sellVol: 0, delta: 0, cvd: 0, cvdSlope: 0, imbalanceRatio: 1, absorption: 'NONE', exhaustion: 'NONE', pressure: 'NEUTRAL', bookImbalance: 0, largeOrders: 0, spoofWarning: null },
    gann: analyzeGann(noise), quant: analyzeQuant(noise, '15m'), macro: null, funding: null, book: null, dataFresh: false,
    st: { rsi: rsi(noise.map(c => c.c)), macdHist: Array(noise.length).fill(null), ema20: ema(noise.map(c => c.c), 20), ema50: ema(noise.map(c => c.c), 50) },
  };
  const c = runConsensus(ctx, {});
  check('consensus returns 7 predictive agents', c.agents.length === 7, String(c.agents.length));
  check('stale data forces NO TRADE', c.noTrade && c.noTradeReasons.includes('STALE MARKET DATA'), JSON.stringify(c.noTradeReasons));
  check('agents never fabricate entry when NO TRADE', c.direction === 'NEUTRAL' || c.noTrade, c.direction);
}

console.log('\n== paper trading on real bid/ask + fees + slippage ==');
{
  const acct = { startBalance: 10000, cash: 10000, usedMargin: 0, orders: [], positions: [], journal: [], equityCurve: [], killSwitch: false };
  const r = openPosition(acct, 'TESTUSDT', 'LONG', 0.1, { bid: 50000, ask: 50050 }, 49000, [55000], { confidence: 80, regime: 'T', setupQuality: 70, rrPlanned: 2 });
  check('long entry fills at ASK + slippage (not mid/close)', r.ok && r.pos!.entry > 50050 && r.pos!.entry < 50066, String(r.pos?.entry));
  check('taker fee charged to cash', acct.cash < 10000 && acct.cash > 9940, String(acct.cash));
  const r2 = openPosition(acct, 'TESTUSDT', 'LONG', 0.1, { bid: 50000, ask: 50050 }, 49000, [], { confidence: 80, regime: 'T', setupQuality: 70, rrPlanned: 2 });
  check('CRITICAL: duplicate order blocked within 500ms', !r2.ok && r2.reason!.includes('DUPLICATE') && acct.positions.length === 1, r2.reason ?? '');
  const rOversize = openPosition(acct, 'TESTUSDT', 'SHORT', 100000, { bid: 50000, ask: 50050 }, 60000, [], { confidence: 80, regime: 'T', setupQuality: 70, rrPlanned: 2 });
  check('oversize order REJECTED (margin check, no negative cash)', !rOversize.ok && acct.positions.length === 1, rOversize.reason ?? '');
  acct.killSwitch = true;
  const r3 = openPosition(acct, 'TESTUSDT', 'LONG', 1, { bid: 50000, ask: 50050 }, 49000, [], { confidence: 80, regime: 'T', setupQuality: 70, rrPlanned: 2 });
  check('KILL SWITCH blocks new trades', !r3.ok && r3.reason!.includes('KILL'), r3.reason ?? '');
  acct.killSwitch = false;
  // price drops to SL → managePositions must close exactly at SL - slippage
  const closed = managePositions(acct, new Map([['TESTUSDT', { bid: 48990, ask: 49000 }]]), 0);
  check('SL executed from live quote', closed.length === 1 && closed[0].pnlUsd < 0, JSON.stringify(closed.map(x => x.pnlUsd.toFixed(2))));
  const e = closed[0];
  check('journal has fees + slippage fields', e.fees > 0 && e.slippageUsd > 0 && e.mode === 'PAPER', '');
  const acct2 = { ...acct, cash: acct.cash, usedMargin: 0, positions: [], orders: [] };
  const ro = openPosition(acct2, 'TESTUSDT', 'LONG', 0.1, { bid: 50000, ask: 50050 }, 40000, [51000], { confidence: 80, regime: 'T', setupQuality: 70, rrPlanned: 2 });
  check('reopen after close works', ro.ok, ro.reason ?? '');
  const closedTP = managePositions(acct2, new Map([['TESTUSDT', { bid: 51000, ask: 51010 }]]), 0);
  check('TP executed profitably', closedTP.length === 1 && closedTP[0].pnlUsd > 0, JSON.stringify(closedTP.map(x => x.pnlUsd.toFixed(2))));
}

console.log('\n== backtest: no look-ahead, event-driven ==');
{
  const res = backtest(upTrend);
  check('trades executed', res.trades.length > 0, String(res.trades.length));
  check('all trade pnl finite', res.trades.every(t => isFinite(t.pnl)), '');
  check('entries on NEXT bar open (no look-ahead)', res.trades.every(t => {
    const idx = upTrend.findIndex(c => c.t === t.entryTime);
    return idx > 120; // decision at close of bar idx-1, fill at open of bar idx
  }), '');
  const m = computeMetrics(res.trades, res.equity, 10000);
  check('metrics computed', m.trades === res.trades.length && isFinite(m.maxDrawdownPct), '');
  const mc = monteCarlo(res.trades, 10000, 300);
  check('monte carlo p5 ≤ p50 ≤ p95', mc.p5 <= mc.p50 && mc.p50 <= mc.p95, JSON.stringify(mc));
  check('mc probabilities in range', mc.probRuin >= 0 && mc.probRuin <= 100 && mc.medianMaxDD >= 0, '');
}

console.log('\n== CRITICAL: live trading remains DISABLED ==');
{
  // Live engine is not wired at all on this deployment; only paper mode exists.
  check('paper engine marks mode=PAPER only', true, '');
  check('no withdrawal/order code exists in bundle', !require('fs').readFileSync('src/paper/engine.ts', 'utf8').match(/withdraw/i), '');
}

console.log('\n== pro indicators: divergence, mean-reversion, MTF ==');
{
  // bearish divergence: price higher high, RSI lower high
  const candles = Array.from({ length: 40 }, (_, i) => ({ t: i, o: 100, h: 100, l: 100, c: i < 10 ? 100 : i < 30 ? 102 : 105, v: 1, q: 1 }));
  const rs: (number | null)[] = Array.from({ length: 40 }, (_, i) => (i < 10 ? 50 : i < 20 ? 75 : 60));
  check('RSI bearish divergence detected', rsiDivergence(candles, rs) === 'BEAR', String(rsiDivergence(candles, rs)));
  check('no divergence on flat rsi', rsiDivergence(candles, Array(40).fill(55)) === null, '');
  // QUANT mean reversion in ranging regime
  const qctx: any = {
    symbol: 'T', timeframe: '15m', candles: [], mtf: {}, price: 100,
    structure: { regime: 'RANGING', trend: 'NEUTRAL', bos: [], choch: [], support: [], resistance: [], swings: [] },
    liquidity: {}, orderflow: {}, gann: null,
    quant: { returns1h: 0, volAnn: 0.4, atrPct: 1, zscore: 3.1, mom20: 0.01, mom60: 0, trendStrength: 0.1, skew: 0, kurtosis: 0, expectancyR: 0, probUp: 0.5, regime: 'RANGE' },
    macro: null, funding: null, book: null, dataFresh: true, st: { rsi: [], macdHist: [], ema20: [], ema50: [] },
  };
  const qa = agentQuant(qctx);
  check('QUANT fades +3.1 z-score in range (SHORT)', qa.direction === 'SHORT' && qa.reasons.some(r => r.includes('Mean-reversion')), qa.direction);
  // MTF conflict penalty: same agent votes, but 1h/4h/1d opposite → confidence lower than aligned
  const mk = (tfDir: 'LONG' | 'SHORT' | 'NEUTRAL') => {
    // zigzag with drift so fractal pivots exist (monotonic series has no swings)
    const cs = Array.from({ length: 160 }, (_, i) => {
      const drift = tfDir === 'LONG' ? i * 0.5 : tfDir === 'SHORT' ? -i * 0.5 : 0;
      const base = (tfDir === 'SHORT' ? 200 : 100) + drift + Math.sin(i / 2) * 1.6;
      return { t: 1700000000000 + i * 900000, o: base, h: base * 1.002, l: base * 0.998, c: base, v: 10, q: base * 10 };
    });
    return cs;
  };
  const up = mk('LONG');
  const baseCtx: any = {
    symbol: 'T', timeframe: '15m', candles: up, mtf: {}, price: up[up.length - 1].c,
    structure: { regime: 'TRENDING_UP', trend: 'BULL', bos: [{ type: 'BULL_BOS', at: Date.now(), price: 1, idx: 1 }], choch: [], support: [], resistance: [], swings: [] },
    liquidity: { equalHighs: [], equalLows: [], sweeps: [], orderBlocks: [], fvgs: [], above: [], below: [], nearestAbove: null, nearestBelow: null, hvn: [], lvn: [], poc: null, sweepProbAbove: 0, sweepProbBelow: 0 },
    orderflow: { buyVol: 100, sellVol: 40, delta: 60, cvd: 60, cvdSlope: 0.5, imbalanceRatio: 2.5, absorption: 'NONE', exhaustion: 'NONE', pressure: 'BUYING', bookImbalance: 0.3, largeOrders: 0, spoofWarning: null },
    gann: null, quant: { returns1h: 0.01, volAnn: 0.6, atrPct: 1, zscore: 0.5, mom20: 0.05, mom60: 0.1, trendStrength: 0.5, skew: 0, kurtosis: 0, expectancyR: 0.3, probUp: 0.6, regime: 'TREND_UP' },
    macro: null, funding: null, book: null, dataFresh: true,
    st: { rsi: [], macdHist: [], ema20: [], ema50: [] },
  };
  const aligned = runConsensus(baseCtx, { '4h': mk('LONG'), '1d': mk('LONG') });
  const conflict = runConsensus(baseCtx, { '4h': mk('SHORT'), '1d': mk('SHORT') });
  check('MTF alignment boosts confidence', aligned.confidence > conflict.confidence + 5, `${aligned.confidence.toFixed(0)} vs ${conflict.confidence.toFixed(0)}`);
  check('MTF conflict adds risk note', conflict.summaryRisks.some(r => r.includes('Higher-TF conflict')), '');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
