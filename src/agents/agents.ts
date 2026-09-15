import type { Candle } from '../api/binance';
import type { OrderBook, Trade } from '../api/binance';
import type { StructureResult } from '../engine/structure';
import type { LiquidityResult } from '../engine/liquidity';
import type { OrderFlowResult } from '../engine/orderflow';
import type { GannResult } from '../engine/gann';
import type { QuantResult } from '../engine/quant';
import type { MacroResult } from '../engine/macro';
import { last, rsi, macd, ema } from '../engine/indicators';

export type Direction = 'LONG' | 'SHORT' | 'NEUTRAL';

export interface AgentOutput {
  agent: string;
  symbol: string;
  timeframe: string;
  direction: Direction;
  confidence: number; // 0-100
  entry_zone: { min: number; max: number } | null;
  stop_loss: number | null;
  targets: number[];
  market_regime: string;
  reasons: string[];
  risks: string[];
  timestamp: string;
  data_source: string;
  model_version: string;
}

export interface AgentContext {
  symbol: string;
  timeframe: string;
  candles: Candle[];       // primary timeframe
  mtf: Record<string, Candle[]>; // other timeframes
  price: number;
  structure: StructureResult;
  liquidity: LiquidityResult;
  orderflow: OrderFlowResult;
  gann: GannResult | null;
  quant: QuantResult;
  macro: MacroResult | null;
  funding: { rate: number; openInterest: number } | null;
  book: OrderBook | null;
  dataFresh: boolean;
  minConfidence?: number; // user floor from Settings (caps the internal NO-TRADE floor)
  st: { rsi: (number | null)[]; macdHist: (number | null)[]; ema20: (number | null)[]; ema50: (number | null)[]; adx?: (number | null)[]; vwap?: (number | null)[] };
}

const MV = 'nexus-rules-v1.0';

function base(c: AgentContext): Omit<AgentOutput, 'agent' | 'direction' | 'confidence' | 'reasons' | 'risks'> {
  return {
    symbol: c.symbol, timeframe: c.timeframe, entry_zone: null, stop_loss: null, targets: [],
    market_regime: c.structure.regime, timestamp: new Date().toISOString(),
    data_source: 'BINANCE_SPOT_WS', model_version: MV,
  };
}

function clamp(v: number, a = 0, b = 100) { return Math.max(a, Math.min(b, v)); }

// Classic RSI divergence on a window: returns 'BEAR' | 'BULL' | null (deterministic pivot compare)
export function rsiDivergence(candles: { c: number }[], rsiArr: (number | null)[]): 'BEAR' | 'BULL' | null {
  if (candles.length < 20 || rsiArr.length < 20) return null;
  const half = Math.floor(candles.length / 2);
  const closes = candles.map(x => x.c);
  const rs = rsiArr.map(v => v ?? NaN);
  const maxClose = (a: number[]) => Math.max(...a);
  const minClose = (a: number[]) => Math.min(...a);
  const maxRsi = (a: (number | null)[]) => Math.max(...a.map(v => (v == null ? -Infinity : v)));
  const minRsi = (a: (number | null)[]) => Math.min(...a.map(v => (v == null ? Infinity : v)));
  const priceHH = maxClose(closes.slice(half)) > maxClose(closes.slice(0, half));
  const rsiLH = maxRsi(rs.slice(half)) < maxRsi(rs.slice(0, half)) - 2;
  const priceLL = minClose(closes.slice(half)) < minClose(closes.slice(0, half));
  const rsiHL = minRsi(rs.slice(half)) > minRsi(rs.slice(0, half)) + 2;
  if (priceHH && rsiLH) return 'BEAR';
  if (priceLL && rsiHL) return 'BULL';
  return null;
}

// NOVA — market structure
export function agentNova(c: AgentContext): AgentOutput {
  const reasons: string[] = [], risks: string[] = [];
  let score = 0;
  if (c.structure.trend === 'BULL') { score += 30; reasons.push(`${c.timeframe} bullish structure (HH/HL)`); }
  if (c.structure.trend === 'BEAR') { score -= 30; reasons.push(`${c.timeframe} bearish structure (LH/LL)`); }
  const bullBos = c.structure.bos.filter(b => b.type === 'BULL_BOS').slice(-1)[0];
  const bearBos = c.structure.bos.filter(b => b.type === 'BEAR_BOS').slice(-1)[0];
  if (bullBos && (!bearBos || bullBos.at > bearBos.at)) { score += 25; reasons.push(`Latest BOS bullish at ${bullBos.price.toLocaleString()}`); }
  if (bearBos && (!bullBos || bearBos.at > bullBos.at)) { score -= 25; reasons.push(`Latest BOS bearish at ${bearBos.price.toLocaleString()}`); }
  const bullCh = c.structure.choch.slice(-1)[0];
  if (bullCh?.type === 'BULL_CHOCH') { score += 15; reasons.push('Bullish CHoCH (trend-change signal)'); }
  if (bullCh?.type === 'BEAR_CHOCH') { score -= 15; reasons.push('Bearish CHoCH (trend-change signal)'); }
  if (c.structure.resistance[0]) risks.push(`Nearest resistance ${c.structure.resistance[0].toLocaleString()}`);
  if (c.structure.support[0]) risks.push(`Nearest support ${c.structure.support[0].toLocaleString()}`);
  const dir: Direction = score > 15 ? 'LONG' : score < -15 ? 'SHORT' : 'NEUTRAL';
  return { ...base(c), agent: 'NOVA', direction: dir, confidence: clamp(Math.abs(score)), reasons, risks };
}

// ORION — price action
export function agentOrion(c: AgentContext): AgentOutput {
  const reasons: string[] = [], risks: string[] = [];
  let score = 0;
  const cl = c.candles.slice(-3);
  const r = last(c.st.rsi);
  const mh = last(c.st.macdHist);
  if (r != null) {
    if (r > 55 && r < 75) { score += 15; reasons.push(`RSI ${r.toFixed(1)} supports upside`); }
    if (r < 45 && r > 25) { score -= 15; reasons.push(`RSI ${r.toFixed(1)} supports downside`); }
    if (r > 78) { score -= 10; risks.push(`RSI overbought (${r.toFixed(1)})`); }
    if (r < 22) { score += 10; risks.push(`RSI oversold (${r.toFixed(1)})`); }
  }
  if (mh != null) {
    if (mh > 0) { score += 12; reasons.push('MACD histogram positive (momentum up)'); }
    else { score -= 12; reasons.push('MACD histogram negative (momentum down)'); }
  }
  if (cl.length === 3) {
    const [a, b, d] = cl;
    const body = Math.abs(d.c - d.o) / (d.h - d.l || 1);
    if (d.c > d.o && body > 0.6 && d.c > b.h) { score += 18; reasons.push('Breakout candle closing above prior range'); }
    if (d.c < d.o && body > 0.6 && d.c < b.l) { score -= 18; reasons.push('Breakdown candle closing below prior range'); }
    const lower = Math.min(a.o, b.o, d.o) - Math.min(a.l, b.l, d.l);
    if (lower / (d.h - d.l || 1) > 0.5 && d.c > d.o) { score += 10; reasons.push('Rejection wick from lows (demand)'); }
    const upper = Math.max(a.h, b.h, d.h) - Math.max(a.o, b.o, d.o);
    if (upper / (d.h - d.l || 1) > 0.5 && d.c < d.o) { score -= 10; reasons.push('Rejection wick from highs (supply)'); }
  }
  const e20 = last(c.st.ema20), e50 = last(c.st.ema50);
  if (e20 && e50) {
    if (c.price > e20 && e20 > e50) { score += 10; reasons.push('Price above EMA20 > EMA50'); }
    if (c.price < e20 && e20 < e50) { score -= 10; reasons.push('Price below EMA20 < EMA50'); }
  }
  // ADX amplifies/damps the conviction (trend strength, non-directional)
  const av = last(c.st.adx ?? []);
  if (av != null && score !== 0) {
    if (av > 25) { score = Math.round(score * 1.15); reasons.push(`ADX ${av.toFixed(0)} confirms trending market`); }
    else if (av < 18) { score = Math.round(score * 0.7); risks.push(`ADX ${av.toFixed(0)} — weak trend, treat directional read cautiously`); }
  }
  // VWAP intraday bias
  const vw = last(c.st.vwap ?? []);
  if (vw) {
    if (c.price > vw * 1.0005) { score += 8; reasons.push('Price above session VWAP'); }
    else if (c.price < vw * 0.9995) { score -= 8; reasons.push('Price below session VWAP'); }
  }
  // MACD histogram slope (momentum acceleration)
  const mhArr = c.st.macdHist;
  if (mhArr.length >= 4) {
    const cur = mhArr[mhArr.length - 1], prev = mhArr[mhArr.length - 4];
    if (cur != null && prev != null) {
      if (cur > prev + 1e-9) { score += 6; reasons.push('MACD histogram rising'); }
      else if (cur < prev - 1e-9) { score -= 6; reasons.push('MACD histogram falling'); }
    }
  }
  // RSI divergence over last 40 bars
  const div = rsiDivergence(c.candles.slice(-40), (last(c.st.rsi) != null ? c.st.rsi.slice(-40) : []));
  if (div === 'BEAR') { score -= 12; risks.push('RSI bearish divergence (price higher high, RSI lower high)'); }
  if (div === 'BULL') { score += 12; reasons.push('RSI bullish divergence (price lower low, RSI higher low)'); }
  const dir: Direction = score > 12 ? 'LONG' : score < -12 ? 'SHORT' : 'NEUTRAL';
  return { ...base(c), agent: 'ORION', direction: dir, confidence: clamp(Math.abs(score) * 1.4), reasons, risks };
}

// LUMA — order flow
export function agentLuma(c: AgentContext): AgentOutput {
  const reasons: string[] = [], risks: string[] = [];
  if (!c.dataFresh) return { ...base(c), agent: 'LUMA', direction: 'NEUTRAL', confidence: 0, reasons: [], risks: ['Stale or missing live data'] };
  let score = 0;
  const of = c.orderflow;
  if (of.pressure === 'BUYING') { score += 25; reasons.push('Aggressive buying pressure (delta + CVD rising)'); }
  if (of.pressure === 'SELLING') { score -= 25; reasons.push('Aggressive selling pressure (delta + CVD falling)'); }
  if (of.bookImbalance > 0.15) { score += 15; reasons.push(`Bid/ask book imbalance ${(of.bookImbalance * 100).toFixed(0)}% bid`); }
  if (of.bookImbalance < -0.15) { score -= 15; reasons.push(`Book imbalance ${(of.bookImbalance * 100).toFixed(0)}% ask`); }
  if (of.absorption === 'BUY_ABSORPTION') { score += 12; reasons.push('Buy absorption at lows (passive demand)'); }
  if (of.absorption === 'SELL_ABSORPTION') { score -= 12; reasons.push('Sell absorption at highs (passive supply)'); }
  if (of.exhaustion === 'BUY_EXHAUSTION') { score -= 8; risks.push('Buy exhaustion — late stage rally'); }
  if (of.exhaustion === 'SELL_EXHAUSTION') { score += 8; risks.push('Sell exhaustion — late stage decline'); }
  // CVD vs price divergence: rally without buy support / drop without sell support
  if (c.candles.length >= 25) {
    const priceChg = c.price - c.candles[c.candles.length - 25].c;
    if (priceChg > 0 && of.cvdSlope < -0.2) { score -= 12; risks.push('CVD divergence: price up but cumulative delta falling'); }
    if (priceChg < 0 && of.cvdSlope > 0.2) { score += 12; reasons.push('CVD divergence: price down but cumulative delta rising'); }
  }
  if (of.spoofWarning) risks.push('POSSIBLE SPOOFING detected in book — treat depth signals with caution');
  const dir: Direction = score > 12 ? 'LONG' : score < -12 ? 'SHORT' : 'NEUTRAL';
  return { ...base(c), agent: 'LUMA', direction: dir, confidence: clamp(Math.abs(score) * 2), reasons, risks };
}

// ATLAS — liquidity
export function agentAtlas(c: AgentContext): AgentOutput {
  const reasons: string[] = [], risks: string[] = [];
  let score = 0;
  const liq = c.liquidity;
  const sw = liq.sweeps.slice(-1)[0];
  if (sw) {
    const age = Date.now() - sw.at;
    if (age < 3600_000 * 6) {
      if (sw.side === 'DOWN') { score += 25; reasons.push(`Recent downside liquidity sweep at ${sw.price.toLocaleString()} (stop hunt below)`); }
      else { score -= 25; reasons.push(`Recent upside liquidity sweep at ${sw.price.toLocaleString()} (stop hunt above)`); }
    }
  }
  const bullOb = liq.orderBlocks.filter(o => o.type === 'BULL').slice(-1)[0];
  const bearOb = liq.orderBlocks.filter(o => o.type === 'BEAR').slice(-1)[0];
  if (bullOb && c.price > 0 && bullOb.top > 0) {
    const d = (c.price - bullOb.top) / c.price;
    if (d < 0.01 && d > -0.005) { score += 15; reasons.push(`Price at unmitigated bull order block ${bullOb.bottom.toLocaleString()}-${bullOb.top.toLocaleString()}`); }
  }
  if (bearOb) {
    const d = (bearOb.bottom - c.price) / c.price;
    if (d < 0.01 && d > -0.005) { score -= 15; reasons.push(`Price at unmitigated bear order block ${bearOb.bottom.toLocaleString()}-${bearOb.top.toLocaleString()}`); }
  }
  const bullFvg = liq.fvgs.filter(f => f.type === 'BULL').slice(-1)[0];
  if (bullFvg && c.price < bullFvg.top) { score += 8; reasons.push(`Open bull FVG above acts as magnet (${bullFvg.bottom.toLocaleString()}-${bullFvg.top.toLocaleString()})`); }
  const bearFvg = liq.fvgs.filter(f => f.type === 'BEAR').slice(-1)[0];
  if (bearFvg && c.price > bearFvg.bottom) { score -= 8; reasons.push(`Open bear FVG below acts as magnet (${bearFvg.bottom.toLocaleString()}-${bearFvg.top.toLocaleString()})`); }
  if (liq.nearestAbove) risks.push(`Resting liquidity above at ${liq.nearestAbove.toLocaleString()} (prob. magnet ~${(liq.sweepProbAbove * 100).toFixed(0)}%/candle historically)`);
  if (liq.nearestBelow) risks.push(`Resting liquidity below at ${liq.nearestBelow.toLocaleString()}`);
  if (liq.poc) reasons.push(`Volume POC at ${liq.poc.toLocaleString()}`);
  const dir: Direction = score > 10 ? 'LONG' : score < -10 ? 'SHORT' : 'NEUTRAL';
  return { ...base(c), agent: 'ATLAS', direction: dir, confidence: clamp(Math.abs(score) * 2.2), reasons, risks };
}

// GANN — price/time
export function agentGann(c: AgentContext): AgentOutput {
  if (!c.gann) return { ...base(c), agent: 'GANN', direction: 'NEUTRAL', confidence: 0, reasons: ['Insufficient history for Gann geometry'], risks: [] };
  const reasons: string[] = [], risks: string[] = [];
  let score = 0;
  const g = c.gann;
  const near = g.levels.filter(l => Math.abs(c.price - l.price) / c.price < 0.005 && l.strength > 0.25);
  for (const l of near) {
    if (l.kind === 'SUPPORT') { score += 12 * l.strength; reasons.push(`Gann ${l.angle} support near ${l.price.toLocaleString()}`); }
    else { score -= 12 * l.strength; reasons.push(`Gann ${l.angle} resistance near ${l.price.toLocaleString()}`); }
  }
  const zone = g.reversalZones[0];
  if (zone && Math.abs(c.price - zone.price) / c.price < 0.01) reasons.push(`Gann confluence reversal zone at ${zone.price.toLocaleString()} (score ${(zone.score).toFixed(1)}, probability-weighted, not certainty)`);
  risks.push('Gann levels are geometric probabilities — never treat as guaranteed reversals');
  const dir: Direction = score > 8 ? 'LONG' : score < -8 ? 'SHORT' : 'NEUTRAL';
  return { ...base(c), agent: 'GANN', direction: dir, confidence: clamp(Math.abs(score) * 4), reasons, risks };
}

// MACRO agent
export function agentMacro(c: AgentContext): AgentOutput {
  const m = c.macro;
  if (!m || !m.available) return { ...base(c), agent: 'MACRO', direction: 'NEUTRAL', confidence: 0, reasons: ['DATA UNAVAILABLE — macro feeds unreachable'], risks: ['No macro overlay applied'] };
  const reasons: string[] = [], risks: string[] = [];
  let score = m.macroScore * 40;
  if (m.fearGreed != null) reasons.push(`Fear & Greed ${m.fearGreed} (${m.fearGreedLabel ?? ''})`);
  if (m.btcDominance != null) reasons.push(`BTC dominance ${m.btcDominance.toFixed(1)}%`);
  if (m.mcapChange24h != null) reasons.push(`Total crypto mcap 24h ${m.mcapChange24h >= 0 ? '+' : ''}${m.mcapChange24h.toFixed(1)}%`);
  risks.push('DXY/NASDAQ/SPX/GOLD: DATA UNAVAILABLE on this deployment (licensed feeds required)');
  if (c.funding && isFinite(c.funding.rate)) {
    if (c.funding.rate > 0.0004) { score -= 12; risks.push(`Elevated positive funding ${(c.funding.rate * 100).toFixed(3)}% — longs crowded`); }
    if (c.funding.rate < -0.0002) { score += 10; risks.push(`Negative funding ${(c.funding.rate * 100).toFixed(3)}% — shorts crowded`); }
  }
  const dir: Direction = score > 10 ? 'LONG' : score < -10 ? 'SHORT' : 'NEUTRAL';
  return { ...base(c), agent: 'MACRO', direction: dir, confidence: clamp(Math.abs(score) * 1.6), reasons, risks };
}

// QUANT agent — statistical, never LLM
export function agentQuant(c: AgentContext): AgentOutput {
  const reasons: string[] = [], risks: string[] = [];
  let score = 0;
  const q = c.quant;
  if (q.probUp > 0.55) { score += 25; reasons.push(`Quant: P(up 6 bars | current momentum regime) = ${(q.probUp * 100).toFixed(1)}% from historical frequency`); }
  if (q.probUp < 0.45) { score -= 25; reasons.push(`Quant: P(up 6 bars) = ${(q.probUp * 100).toFixed(1)}% — historically weak`); }
  if (q.zscore > 1.8) { score -= 15; risks.push(`Price z-score ${q.zscore.toFixed(2)} — extended above mean`); }
  if (q.zscore < -1.8) { score += 15; risks.push(`Price z-score ${q.zscore.toFixed(2)} — stretched below mean`); }
  if (q.expectancyR > 0.15) { score += 15; reasons.push(`Momentum-condition expectancy ${q.expectancyR.toFixed(2)}R over history`); }
  if (q.expectancyR < -0.15) { score -= 15; reasons.push(`Negative momentum-condition expectancy ${q.expectancyR.toFixed(2)}R`); }
  if (q.volAnn > 1.6) risks.push(`Annualized vol ${(q.volAnn * 100).toFixed(0)}% — elevated`);
  if (q.trendStrength > 0.4) reasons.push(`Trend efficiency ${q.trendStrength.toFixed(2)} (directional market)`);
  // regime-aware: in ranging/low-vol markets fade z-score extremes instead of chasing momentum
  const ranging = c.structure.regime === 'RANGING' || c.structure.regime === 'LOW_VOLATILITY';
  if (ranging && Math.abs(q.zscore) > 2.2) {
    if (q.zscore > 2.2) { score -= 18; reasons.push(`Mean-reversion: z-score +${q.zscore.toFixed(2)} in ranging market (historically reverts)`); }
    else { score += 18; reasons.push(`Mean-reversion: z-score ${q.zscore.toFixed(2)} in ranging market (historically reverts)`); }
  } else if (!ranging && Math.abs(q.zscore) > 2.8) {
    risks.push(`Extreme z-score ${q.zscore.toFixed(2)} even for trend — stretch risk`);
  }
  const dir: Direction = score > 12 ? 'LONG' : score < -12 ? 'SHORT' : 'NEUTRAL';
  return { ...base(c), agent: 'QUANT', direction: dir, confidence: clamp(Math.abs(score) * 1.8), reasons, risks };
}

// ARES — RISK MANAGER. Never predicts direction. Has VETO power.
export interface AresDecision {
  allowed: boolean;
  vetoReasons: string[];
  riskPct: number;
  maxLossUsd: number;
  quantity: number;
  positionSizeUsd: number;
  leverage: number;
  rr: number;
  checks: { name: string; passed: boolean; detail: string }[];
}

export interface RiskConfig {
  balance: number;
  riskPct: number;           // per trade risk, %
  maxRiskPct: number;        // hard cap
  maxDailyLossPct: number;
  maxExposurePct: number;
  maxLeverage: number;
  minRR: number;
  minConfidence: number;
  dailyLossUsd: number;      // realized today
  openExposureUsd: number;   // margin currently deployed
}

export function aresEvaluate(signal: { direction: Direction; entry: number; stop: number; target: number; confidence: number }, cfg: RiskConfig, ctx: AgentContext): AresDecision {
  const checks: AresDecision['checks'] = [];
  const veto: string[] = [];
  const add = (name: string, passed: boolean, detail: string) => { checks.push({ name, passed, detail }); if (!passed) veto.push(`${name}: ${detail}`); };

  add('DATA_FRESHNESS', ctx.dataFresh, ctx.dataFresh ? 'Live data OK' : 'STALE MARKET DATA — signals disabled');
  add('DIRECTION_REQUIRED', signal.direction !== 'NEUTRAL', `consensus direction = ${signal.direction}`);
  add('CONFIDENCE', signal.confidence >= cfg.minConfidence, `${signal.confidence.toFixed(0)}% vs required ${cfg.minConfidence}%`);

  const stopDist = Math.abs(signal.entry - signal.stop);
  const rr = stopDist > 0 ? Math.abs(signal.target - signal.entry) / stopDist : 0;
  add('R_R_MINIMUM', rr >= cfg.minRR, `R/R ${rr.toFixed(2)} vs required ${cfg.minRR}`);
  add('STOP_VALID', signal.stop > 0 && stopDist > 0 && (signal.direction === 'LONG' ? signal.stop < signal.entry : signal.stop > signal.entry), 'stop placement valid');

  const maxLoss = (cfg.balance * Math.min(cfg.riskPct, cfg.maxRiskPct)) / 100;
  const qty = stopDist > 0 ? maxLoss / stopDist : 0;
  const notional = qty * signal.entry;
  add('POSITION_SIZE', qty > 0 && isFinite(qty) && notional > 10, `size ${qty.toFixed(6)} ≈ $${notional.toFixed(0)}`);
  add('DAILY_LOSS_LIMIT', cfg.dailyLossUsd < (cfg.balance * cfg.maxDailyLossPct) / 100, `daily loss $${cfg.dailyLossUsd.toFixed(0)} vs cap $${((cfg.balance * cfg.maxDailyLossPct) / 100).toFixed(0)}`);
  add('EXPOSURE_LIMIT', cfg.openExposureUsd + notional <= (cfg.balance * cfg.maxExposurePct) / 100, `exposure ${(cfg.openExposureUsd + notional).toFixed(0)} vs cap $${((cfg.balance * cfg.maxExposurePct) / 100).toFixed(0)}`);
  const lev = cfg.balance > 0 ? notional / cfg.balance : 99;
  add('LEVERAGE_CAP', lev <= cfg.maxLeverage, `implied leverage ${lev.toFixed(2)}x vs cap ${cfg.maxLeverage}x`);
  add('VOLATILITY', ctx.quant.atrPct < 8, `ATR ${ctx.quant.atrPct.toFixed(2)}%`);
  if (ctx.funding && isFinite(ctx.funding.rate) && Math.abs(ctx.funding.rate) > 0.0012) add('FUNDING_EXTREME', false, `funding ${(ctx.funding.rate * 100).toFixed(3)}% extreme`);
  else add('FUNDING_EXTREME', true, 'funding normal');

  return {
    allowed: veto.length === 0,
    vetoReasons: veto,
    riskPct: Math.min(cfg.riskPct, cfg.maxRiskPct),
    maxLossUsd: maxLoss,
    quantity: qty,
    positionSizeUsd: notional,
    leverage: lev,
    rr,
    checks,
  };
}

export const AGENT_RUNNERS = { NOVA: agentNova, ORION: agentOrion, LUMA: agentLuma, ATLAS: agentAtlas, GANN: agentGann, MACRO: agentMacro, QUANT: agentQuant };
export const AGENT_WEIGHTS: Record<string, number> = { NOVA: 15, ORION: 15, LUMA: 20, ATLAS: 15, GANN: 5, MACRO: 10, QUANT: 20 };
