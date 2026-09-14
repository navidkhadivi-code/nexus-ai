import { AGENT_RUNNERS, AGENT_WEIGHTS, type AgentContext, type AgentOutput, type Direction } from './agents';
import { analyzeStructure } from '../engine/structure';
import { last, ema } from '../engine/indicators';

export interface ConsensusResult {
  direction: Direction;
  confidence: number;        // 0-100 weighted agreement-strength
  agreement: number;         // % of directional agents agreeing
  directionalScore: number;  // -100..100
  setupQuality: number;      // 0-100
  noTrade: boolean;
  noTradeReasons: string[];
  agents: AgentOutput[];
  entryZone: { min: number; max: number } | null;
  stop: number | null;
  targets: number[];
  summaryReasons: string[];
  summaryRisks: string[];
  mtf: Record<string, { trend: string; direction: Direction; confidence: number }>;
}

// Weighted directional voting. ARES is NOT here — it sits downstream as veto.
export function runConsensus(ctx: AgentContext, mtfCandles: Record<string, AgentContext['candles']>): ConsensusResult {
  const agents = Object.values(AGENT_RUNNERS).map(fn => fn(ctx));
  let score = 0, weightSum = 0, dirCount = 0, agreeDir = 0;
  const reasons: string[] = [], risks: string[] = [];

  for (const a of agents) {
    const w = AGENT_WEIGHTS[a.agent] ?? 10;
    weightSum += w;
    if (a.direction === 'LONG') score += w * (a.confidence / 100);
    else if (a.direction === 'SHORT') score -= w * (a.confidence / 100);
    if (a.direction !== 'NEUTRAL') {
      dirCount++;
      const d: Direction = score >= 0 ? 'LONG' : 'SHORT';
      if (a.direction === d) agreeDir++;
    }
    reasons.push(...a.reasons.map(r => `[${a.agent}] ${r}`));
    risks.push(...a.risks.map(r => `[${a.agent}] ${r}`));
  }

  const directionalScore = (score / (weightSum || 1)) * 100;
  const direction: Direction = directionalScore > 18 ? 'LONG' : directionalScore < -18 ? 'SHORT' : 'NEUTRAL';
  const agreePct = dirCount ? (agreeDir / dirCount) * 100 : 0;
  const confidence = Math.min(100, Math.abs(directionalScore) * (0.5 + 0.5 * (agreePct / 100)));

  // multi-timeframe analysis
  const mtf: ConsensusResult['mtf'] = {};
  for (const [tf, candles] of Object.entries(mtfCandles)) {
    if (!candles.length) continue;
    const st = analyzeStructure(candles);
    const e20 = last(ema(candles.map(c => c.c), 20));
    const e50 = last(ema(candles.map(c => c.c), 50));
    const px = candles[candles.length - 1].c;
    let d: Direction = 'NEUTRAL';
    if (st.trend === 'BULL' && e20 && e50 && px > e20) d = 'LONG';
    else if (st.trend === 'BEAR' && e20 && e50 && px < e20) d = 'SHORT';
    mtf[tf] = { trend: st.regime, direction: d, confidence: d === 'NEUTRAL' ? 50 : 60 + Math.min(30, Math.abs(directionalScore) / 3) };
  }

  // NO TRADE engine — first-class state
  const noTradeReasons: string[] = [];
  const confFloor = Math.min(45, ctx.minConfidence ?? 45); // user setting can lower (never raise past ARES)
  if (!ctx.dataFresh) noTradeReasons.push('STALE MARKET DATA');
  if (direction === 'NEUTRAL') noTradeReasons.push('No directional edge — agents split');
  if (confidence < confFloor) noTradeReasons.push(`Confidence ${confidence.toFixed(0)}% below ${confFloor}% floor`);
  if (agreePct < 55 && direction !== 'NEUTRAL') noTradeReasons.push(`Agent agreement ${agreePct.toFixed(0)}% too weak`);
  if (ctx.quant.volAnn > 2.4) noTradeReasons.push('Extreme volatility regime');
  if (ctx.structure.regime === 'HIGH_VOLATILITY' || ctx.structure.regime === 'CAPITULATION') noTradeReasons.push(`Hostile regime: ${ctx.structure.regime}`);

  // entry / stop / targets from real levels
  let entryZone: ConsensusResult['entryZone'] = null, stop: number | null = null, targets: number[] = [];
  const p = ctx.price;
  if (p && direction !== 'NEUTRAL') {
    const atr = (ctx.quant.atrPct / 100) * p;
    if (direction === 'LONG') {
      entryZone = { min: Math.max(ctx.liquidity.poc ?? 0, p - atr * 0.35) || p - atr * 0.35, max: p };
      stop = ctx.liquidity.equalLows.filter(l => l < p).slice(-1)[0] ?? (ctx.structure.support[0] ?? p - atr * 1.5);
      stop = Math.min(stop, p - atr * 0.8);
      const t1 = ctx.liquidity.equalHighs.find(h => h > p) ?? ctx.structure.resistance[0] ?? p + atr * 2;
      targets = [t1, p + (p - stop) * 2, p + (p - stop) * 3.5].sort((a, b) => a - b);
    } else {
      entryZone = { min: p, max: Math.min(p + atr * 0.35, ctx.liquidity.equalHighs.find(h => h > p) ?? p + atr * 0.35) };
      stop = ctx.liquidity.equalHighs.filter(h => h > p)[0] ?? (ctx.structure.resistance[0] ?? p + atr * 1.5);
      stop = Math.max(stop, p + atr * 0.8);
      const t1 = ctx.liquidity.equalLows.find(l => l < p) ?? ctx.structure.support[0] ?? p - atr * 2;
      targets = [t1, p - (stop - p) * 2, p - (stop - p) * 3.5].sort((a, b) => b - a);
    }
    if (stop && !(stop > 0)) { stop = null; noTradeReasons.push('Invalid stop level'); }
    // R/R floor
    if (stop && targets.length) {
      const rr = Math.abs(targets[0] - p) / Math.abs(p - stop);
      if (rr < 1.3) noTradeReasons.push(`R/R ${rr.toFixed(2)} below 1.3 minimum`);
    }
  }

  const setupQuality = Math.max(0, Math.min(100,
    confidence * 0.5 + (agreePct || 0) * 0.3 + (ctx.orderflow.pressure !== 'NEUTRAL' ? 10 : 0) + (ctx.quant.trendStrength * 10)));

  return {
    direction, confidence, agreement: agreePct, directionalScore, setupQuality,
    noTrade: noTradeReasons.length > 0, noTradeReasons,
    agents, entryZone, stop, targets, summaryReasons: reasons, summaryRisks: risks, mtf,
  };
}
