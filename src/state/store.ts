import { create } from 'zustand';
import type { Candle, ConnState, OrderBook, Tick, Timeframe, Trade, ExchangeAdapter } from '../api/types';
import { TF_MS } from '../api/types';
import { MarketGateway } from '../api/gateway';
import { binanceAdapter } from '../api/binance';
import { bybitAdapter } from '../api/bybit';
import { okxAdapter } from '../api/okx';
import { adminApi } from '../api/adminClient';
import { OrderFlowEngine, orderBookMetrics } from '../engine/orderflow';
import { analyzeStructure } from '../engine/structure';
import { analyzeLiquidity } from '../engine/liquidity';
import { analyzeGann } from '../engine/gann';
import { analyzeQuant } from '../engine/quant';
import { fetchMacro, type MacroResult } from '../engine/macro';
import { ema, rsi, macd } from '../engine/indicators';
import { aresEvaluate, type AresDecision, type RiskConfig, type AgentContext } from '../agents/agents';
import { runConsensus, type ConsensusResult } from '../agents/consensus';
import { loadAccount, saveAccount, openPosition, closePosition, managePositions, uid, type PaperAccount } from '../paper/engine';
import { backtest, monteCarlo, walkForward, DEFAULT_BT, type BtConfig, type BtMetrics, type McResult } from '../engine/backtest';
import type { LiquidityResult } from '../engine/liquidity';
import type { GannResult } from '../engine/gann';
import type { Direction } from '../agents/agents';

export type ExchangePref = 'AUTO' | 'BINANCE' | 'BYBIT' | 'OKX';

export interface LiveSignal {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  direction: Direction;
  entry: number;
  stop: number;
  targets: number[];
  rr: number;
  confidence: number;
  setupQuality: number;
  status: 'WAITING' | 'ACTIVE' | 'TP1' | 'TP2' | 'TP3' | 'STOP' | 'CANCELLED' | 'EXPIRED';
  reason: string[];
  risks: string[];
  createdAt: number;
  activatedAt?: number;
  closedAt?: number;
  dataSource: string;
  agentDirs?: Record<string, Direction>;
}

export interface AgentPerf { agent: string; preds: number; hits: number; accuracy: number }

export interface AuthState {
  checked: boolean;
  authenticated: boolean;
  role: 'ADMIN' | 'USER' | '';
  user: string;
  plan: string;
  expires: number | null;
  reason: 'expired' | 'disabled' | '';
  error: string;
  setupRequired: boolean;
}

function isAdminRole(r: any): boolean { return r === 'ADMIN' || r === 'SUPER_ADMIN'; }

function authFromSession(r: any): AuthState {
  const locked = !r.authenticated;
  return {
    checked: true,
    authenticated: !locked,
    role: !locked ? (isAdminRole(r.role) ? 'ADMIN' : 'USER') : '',
    user: !locked ? (r.user ?? '') : '',
    plan: !locked ? (r.plan ?? '') : '',
    expires: !locked ? (r.expires ?? null) : null,
    reason: locked ? (r.reason ?? '') : '',
    error: r.error === 'backend-unavailable' ? 'backend-unavailable' : '',
    setupRequired: locked && !!r.setupRequired,
  };
}

export interface HealthState {
  ws: ConnState;
  wsDetail: string;
  marketLatencyMs: number;
  engineMs: number;
  macroOk: boolean;
  storage: 'LOCAL';
  liveTrading: 'DISABLED_BY_DEFAULT';
  uptimeSec: number;
}

interface State {
  auth: AuthState;
  authInit: () => void;
  authSetup: (u: string, p: string) => Promise<{ ok: boolean; error?: string; message?: string }>;
  authLogin: (u: string, p: string) => Promise<{ ok: boolean; error?: string; message?: string }>;
  authLogout: () => Promise<void>;
  symbol: string;
  timeframe: Timeframe;
  exchange: ExchangePref;
  activeSource: string;
  locale: 'en' | 'fa';
  candles: Candle[];
  tick: Tick | null;
  book: OrderBook | null;
  bookMetrics: ReturnType<typeof orderBookMetrics>;
  funding: { rate: number; openInterest: number; nextFundingTime: number } | null;
  macro: MacroResult | null;
  conn: ConnState;
  connDetail: string;
  consensus: ConsensusResult | null;
  ares: AresDecision | null;
  liquidity: LiquidityResult | null;
  gann: GannResult | null;
  signal: LiveSignal | null;
  signalHistory: LiveSignal[];
  agentPerf: AgentPerf[];
  paper: PaperAccount;
  risk: RiskConfig;
  health: HealthState;
  bt: { metrics: BtMetrics | null; equity: { t: number; v: number }[]; trades: number; mc: McResult | null; wf: ReturnType<typeof walkForward>; running: boolean } | null;
  error: string | null;

  init: () => void;
  setSymbol: (s: string) => void;
  setTimeframe: (t: Timeframe) => void;
  setExchange: (e: ExchangePref) => void;
  setLocale: (l: 'en' | 'fa') => void;
  setRisk: (r: Partial<RiskConfig>) => void;
  saveRisk: (r: Partial<RiskConfig>) => void;
  openPaperTrade: () => { ok: boolean; reason?: string };
  openManualTrade: (side: 'LONG' | 'SHORT', qty: number, sl: number, tp: number[]) => { ok: boolean; reason?: string };
  closePaperTrade: (id: string) => void;
  killSwitch: (on: boolean) => void;
  runBacktest: (cfg?: Partial<BtConfig>) => Promise<void>;
  resetPaper: () => void;
}

type SetPartial = (p: Partial<State> | ((st: State) => Partial<State>)) => void;

const ADAPTERS: Record<string, ExchangeAdapter> = { BINANCE: binanceAdapter, BYBIT: bybitAdapter, OKX: okxAdapter };
const savedLocale: 'en' | 'fa' = (() => { try { return (localStorage.getItem('nexus_locale') === 'en' ? 'en' : 'fa'); } catch { return 'fa'; } })();
try { document.documentElement.lang = savedLocale; document.documentElement.dir = savedLocale === 'fa' ? 'rtl' : 'ltr'; } catch { /* pre-DOM */ }

const DEFAULT_RISK: RiskConfig = { balance: 10000, riskPct: 0.5, maxRiskPct: 1.5, maxDailyLossPct: 5, maxExposurePct: 60, maxLeverage: 5, minRR: 1.3, minConfidence: 55, dailyLossUsd: 0, openExposureUsd: 0 };
function loadRisk(): RiskConfig {
  try { const s = JSON.parse(localStorage.getItem('nexus_risk_v1') || 'null'); if (s && typeof s === 'object') return { ...DEFAULT_RISK, ...s }; } catch { /* fresh */ }
  return { ...DEFAULT_RISK };
}
function loadExchange(): ExchangePref {
  try { const e = localStorage.getItem('nexus_exchange'); if (e === 'BINANCE' || e === 'BYBIT' || e === 'OKX' || e === 'AUTO') return e; } catch { /* default */ }
  return 'AUTO';
}
const ofEngine = new OrderFlowEngine();
let gateway: MarketGateway | null = null;
let currentAdapter: ExchangeAdapter = binanceAdapter;
let refreshing = false;
let lastRefresh = 0;
let started = false;
let authPolling = false;
const mtfCache: Record<string, Candle[]> = {};

async function pickAdapter(pref: ExchangePref): Promise<ExchangeAdapter> {
  const order = pref === 'AUTO' ? [binanceAdapter, bybitAdapter, okxAdapter] : [ADAPTERS[pref]];
  for (const a of order) {
    if (await a.probe()) return a;
  }
  throw new Error('All market data sources are unreachable (Binance / Bybit / OKX). Check network â€” data is NEVER fabricated.');
}

export const useStore = create<State>((set, get) => ({
  auth: { checked: false, authenticated: false, role: '', user: '', plan: '', expires: null, reason: '', error: '', setupRequired: false },
  authInit: () => {
    const poll = async () => {
      const r = await adminApi.session();
      const next = authFromSession(r);
      const was = get().auth.authenticated;
      set({ auth: next });
      if (was && !next.authenticated) {
        // entitlement lost mid-session: stop all live data + signals (server + client double-lock)
        gateway?.stop(); gateway = null; started = false;
      }
    };
    void poll();
    if (!authPolling) { authPolling = true; window.setInterval(() => void poll(), 60000); }
  },
  authLogin: async (u, p) => {
    const r = await adminApi.login(u, p);
    if (r.ok) {
      set({ auth: { checked: true, authenticated: true, role: isAdminRole(r.role) ? 'ADMIN' : 'USER', user: r.user, plan: r.plan ?? '', expires: r.expires ?? null, reason: '', error: '', setupRequired: false } });
      if (!started) get().init();
      return { ok: true };
    }
    if (r.setupRequired) set(st => ({ auth: { ...st.auth, checked: true, setupRequired: true } }));
    return { ok: false, error: r.error, message: r.message };
  },
  authSetup: async (u, p) => {
    const r = await adminApi.setup(u, p);
    if (r.ok) {
      set({ auth: { checked: true, authenticated: true, role: 'ADMIN', user: r.user, plan: 'ADMIN', expires: null, reason: '', error: '', setupRequired: false } });
      if (!started) get().init();
      return { ok: true };
    }
    return { ok: false, error: r.error, message: r.message };
  },
  authLogout: async () => {
    await adminApi.logout();
    gateway?.stop(); gateway = null; started = false;
    set({ auth: { checked: true, authenticated: false, role: '', user: '', plan: '', expires: null, reason: '', error: '', setupRequired: false } });
  },

  symbol: 'BTCUSDT',
  timeframe: '15m',
  exchange: loadExchange(),
  activeSource: 'â€”',
  locale: savedLocale,
  candles: [],
  tick: null,
  book: null,
  bookMetrics: null,
  funding: null,
  macro: null,
  conn: 'CONNECTING',
  connDetail: '',
  consensus: null,
  ares: null,
  liquidity: null,
  gann: null,
  signal: null,
  signalHistory: [],
  agentPerf: [],
  paper: loadAccount(),
  risk: loadRisk(),
  health: { ws: 'CONNECTING', wsDetail: '', marketLatencyMs: 0, engineMs: 0, macroOk: false, storage: 'LOCAL', liveTrading: 'DISABLED_BY_DEFAULT', uptimeSec: 0 },
  bt: null,
  error: null,

  init: () => {
    if (started) return;
    started = true;
    const boot = async () => {
      try {
        currentAdapter = await pickAdapter(get().exchange);
        set({ activeSource: currentAdapter.id });
        await loadSymbolData(set, get);
        gateway = new MarketGateway(currentAdapter, get().symbol, get().timeframe, makeHandlers(set, get));
        gateway.start();
        fetchMacro().then(m => set(st => ({ macro: m, health: { ...st.health, macroOk: m.available } }))).catch(() => undefined);
        setInterval(() => set(st => ({ health: { ...st.health, uptimeSec: st.health.uptimeSec + 1 } })), 1000);
        setInterval(() => pollOtherSymbols(get), 2500);
      } catch (e) {
        set({ error: String(e) });
      }
    };
    void boot();
  },

  setSymbol: (s) => {
    const sym = s.toUpperCase();
    set({ symbol: sym, candles: [], consensus: null, ares: null, signal: null, error: null });
    gateway?.reconfigure(currentAdapter, sym, get().timeframe);
    void loadSymbolData(set, get);
  },

  setTimeframe: (t) => {
    set({ timeframe: t, candles: [] });
    gateway?.reconfigure(currentAdapter, get().symbol, t);
    void loadSymbolData(set, get);
  },

  setExchange: (pref) => {
    set({ exchange: pref, error: null });
    try { localStorage.setItem('nexus_exchange', pref); } catch { /* noop */ }
    void (async () => {
      try {
        currentAdapter = await pickAdapter(pref);
        set({ activeSource: currentAdapter.id, candles: [], book: null, tick: null });
        ofEngine.reset();
        await loadSymbolData(set, get);
        gateway?.reconfigure(currentAdapter, get().symbol, get().timeframe);
      } catch (e) { set({ error: String(e) }); }
    })();
  },

  setLocale: (l) => {
    set({ locale: l });
    try { localStorage.setItem('nexus_locale', l); } catch { /* noop */ }
    document.documentElement.dir = l === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = l;
  },

  setRisk: (r) => set(st => ({ risk: { ...st.risk, ...r } })),
  saveRisk: (r) => {
    const next = { ...get().risk, ...r };
    set({ risk: next });
    try { localStorage.setItem('nexus_risk_v1', JSON.stringify(next)); } catch { /* quota */ }
  },

  openPaperTrade: () => {
    const { paper, tick, consensus, ares, symbol } = get();
    if (!tick || !consensus || !ares) return { ok: false, reason: 'No live quote / analysis yet' };
    if (paper.killSwitch) return { ok: false, reason: 'KILL SWITCH ACTIVE â€” no new trades' };
    if (consensus.noTrade || consensus.direction === 'NEUTRAL') return { ok: false, reason: 'NO TRADE state â€” consensus does not authorize' };
    if (!ares.allowed) return { ok: false, reason: `ARES VETO: ${ares.vetoReasons.join(' | ')}` };
    const q = { bid: tick.bid, ask: tick.ask };
    const res = openPosition(paper, symbol, consensus.direction === 'LONG' ? 'LONG' : 'SHORT', ares.quantity, q, consensus.stop ?? 0, consensus.targets, {
      confidence: consensus.confidence, regime: consensus.agents[0]?.market_regime ?? '', setupQuality: consensus.setupQuality, rrPlanned: ares.rr,
    });
    saveAccount(paper);
    set({ paper: { ...paper } });
    return res;
  },

  openManualTrade: (side, qty, sl, tp) => {
    const { paper, tick, symbol } = get();
    if (!tick) return { ok: false, reason: 'No live quote yet' };
    if (paper.killSwitch) return { ok: false, reason: 'KILL SWITCH ACTIVE — no new trades' };
    if (!(qty > 0) || !isFinite(qty)) return { ok: false, reason: 'Quantity must be > 0' };
    const q = { bid: tick.bid, ask: tick.ask };
    const entry = side === 'LONG' ? q.ask : q.bid;
    if (sl > 0 && !(side === 'LONG' ? sl < entry : sl > entry)) return { ok: false, reason: side === 'LONG' ? 'Stop must be BELOW entry for LONG' : 'Stop must be ABOVE entry for SHORT' };
    const tps = tp.filter(t => t > 0 && (side === 'LONG' ? t > entry : t < entry));
    const res = openPosition(paper, symbol, side, qty, q, sl > 0 ? sl : entry * (side === 'LONG' ? 0.98 : 1.02), tps.length ? tps : [entry * (side === 'LONG' ? 1.02 : 0.98)], {
      confidence: 0, regime: 'MANUAL', setupQuality: 0, rrPlanned: 0,
    });
    saveAccount(paper);
    set({ paper: { ...paper } });
    return res;
  },

  closePaperTrade: (id) => {
    const { paper, tick } = get();
    if (!tick) return;
    closePositionSafe(paper, id, tick.bid, tick.ask);
    saveAccount(paper);
    set({ paper: { ...paper } });
  },

  killSwitch: (on) => {
    const { paper, tick, symbol } = get();
    paper.killSwitch = on;
    if (on && tick) {
      for (const p of [...paper.positions]) {
        if (p.symbol === symbol) closePositionSafe(paper, p.id, tick.bid, tick.ask);
      }
    }
    saveAccount(paper);
    set({ paper: { ...paper } });
  },

  resetPaper: () => {
    localStorage.removeItem('nexus_paper_v1');
    set({ paper: loadAccount() });
  },

  runBacktest: async (cfg) => {
    set({ bt: { metrics: null, equity: [], trades: 0, mc: null, wf: [], running: true } });
    await new Promise(r => setTimeout(r, 30));
    try {
      const { symbol, timeframe } = get();
      const history = await currentAdapter.fetchCandles(symbol, timeframe, 1000);
      const older = await currentAdapter.fetchCandles(symbol, timeframe, 1000, history[0]?.t).catch(() => [] as Candle[]);
      const full = mergeCandles([...older, ...history], get().candles);
      const res = backtest(full, { ...DEFAULT_BT, ...cfg });
      const mc = monteCarlo(res.trades, DEFAULT_BT.initialBalance);
      const wf = walkForward(full);
      try { localStorage.setItem('nexus_bt_last', String(Date.now())); } catch { /* noop */ }
      set({ bt: { metrics: res.metrics, equity: res.equity, trades: res.trades.length, mc, wf, running: false } });
    } catch (e) {
      set({ bt: null, error: String(e) });
    }
  },
}));

function closePositionSafe(paper: PaperAccount, id: string, bid: number, ask: number) {
  // single source of truth: the paper engine's close path (fills at real bid/ask + slippage + fees)
  managePositions(paper, new Map([[paper.positions.find(p => p.id === id)?.symbol ?? '', { bid, ask }]]), 0);
  if (paper.positions.find(p => p.id === id)) closePosition(paper, id, { bid, ask });
}

async function loadSymbolData(set: SetPartial, get: () => State) {
  const { symbol, timeframe } = get();
  try {
    const [candles, book, trades, funding] = await Promise.all([
      currentAdapter.fetchCandles(symbol, timeframe, 500),
      currentAdapter.fetchBookSnapshot(symbol, 200),
      currentAdapter.fetchRecentTrades(symbol, 600),
      currentAdapter.fetchFunding(symbol),
    ]);
    ofEngine.reset();
    for (const t of trades) ofEngine.pushTrade(t);
    mtfCache[timeframe] = candles;
    set({
      candles, book, bookMetrics: orderBookMetrics(book),
      funding: { rate: funding.rate, openInterest: funding.openInterest, nextFundingTime: funding.nextFundingTime },
      error: null,
    });
    for (const tf of ['5m', '1h', '4h', '1d'] as Timeframe[]) {
      if (tf !== timeframe) currentAdapter.fetchCandles(symbol, tf, 300).then(cs => { mtfCache[tf] = cs; }).catch(() => undefined);
    }
    void refreshAnalysis(set, get);
  } catch (e) {
    set({ error: String(e) });
  }
}

function makeHandlers(set: SetPartial, get: () => State) {
  return {
    onStatus: (s: ConnState, d?: string) => set(st => ({ conn: s, connDetail: d ?? '', health: { ...st.health, ws: s, wsDetail: d ?? '' } })),
    onTick: (t: Tick) => {
      set(st => ({ tick: t, health: { ...st.health, marketLatencyMs: Math.max(0, t.recv - t.ts) } }));
      tickSignal(get, set);
      markPaper(get, set);
    },
    onBook: (b: OrderBook) => set({ book: b, bookMetrics: orderBookMetrics(b) }),
    onTrade: (t: Trade) => ofEngine.pushTrade(t),
    onCandle: (c: Candle, final: boolean) => {
      const tfMs = TF_MS[get().timeframe];
      if (tfMs && c.t % tfMs !== 0) return; // deterministic guard: drop stale-TF frames after a switch
      set(st => {
        const arr = [...st.candles];
        if (arr.length && arr[arr.length - 1].t === c.t) arr[arr.length - 1] = c;
        else if (c.t > (arr[arr.length - 1]?.t ?? 0)) arr.push(c);
        return { candles: arr };
      });
      if (final) void refreshAnalysis(set, get);
      else throttleRefresh(set, get);
    },
  };
}

function pollOtherSymbols(get: () => State) {
  const st = get();
  const others = [...new Set(st.paper.positions.filter(p => p.symbol !== st.symbol).map(p => p.symbol))];
  for (const s of others) {
    currentAdapter.fetchBookSnapshot(s, 5).then(b => {
      const cur = useStore.getState();
      const q = new Map([[s, { bid: b.bids[0].price, ask: b.asks[0].price }]]);
      for (const p of cur.paper.positions.filter(pp => pp.symbol === s)) p.mark = q.get(s)!.bid;
      const closed = managePositions(cur.paper, q, 0);
      if (closed.length) { saveAccount(cur.paper); useStore.setState({ paper: { ...cur.paper } }); }
    }).catch(() => undefined);
  }
}

function markPaper(get: () => State, set: SetPartial) {
  const st = get();
  if (!st.tick || !st.paper.positions.length) return;
  const q = new Map([[st.symbol, { bid: st.tick.bid, ask: st.tick.ask }]]);
  const closed = managePositions(st.paper, q, st.funding?.rate ?? 0);
  if (closed.length) {
    saveAccount(st.paper);
    set({ paper: { ...st.paper } });
  }
}

function mergeCandles(a: Candle[], b: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of a) map.set(c.t, c);
  for (const c of b) map.set(c.t, c);
  return [...map.values()].sort((x, y) => x.t - y.t);
}

let sigSeq = 0;

function tickSignal(get: () => State, set: SetPartial) {
  const st = get();
  const sig = st.signal;
  if (!sig || !st.tick) return;
  const px = st.tick.price;
  let changed = false;
  const s = { ...sig };
  if (s.status === 'WAITING' && px >= s.entry * 0.9995 && px <= s.entry * 1.0005) { s.status = 'ACTIVE'; s.activatedAt = Date.now(); changed = true; }
  if (s.status === 'ACTIVE' || s.status === 'TP1' || s.status === 'TP2') {
    const hitSl = s.direction === 'LONG' ? px <= s.stop : px >= s.stop;
    if (hitSl) { s.status = 'STOP'; s.closedAt = Date.now(); changed = true; }
    else {
      const tpIdx = s.targets.findIndex(tt => (s.direction === 'LONG' ? px >= tt : px <= tt));
      const cur = s.status === 'TP1' ? 1 : s.status === 'TP2' ? 2 : 0;
      if (tpIdx >= cur) {
        s.status = (['TP1', 'TP2', 'TP3'] as const)[Math.min(tpIdx, 2)];
        if (tpIdx >= s.targets.length - 1) s.closedAt = Date.now();
        changed = true;
      }
    }
  }
  if (changed) {
    set({ signal: s.status === 'STOP' || s.status === 'TP3' ? null : s });
    if (s.status === 'STOP' || s.status === 'TP3') {
      set(st2 => {
        const hist = [s, ...st2.signalHistory].slice(0, 50);
        return { signalHistory: hist, agentPerf: computePerf(hist) };
      });
    }
    notify(s);
  }
}

// Phase 49 â€” prediction accuracy: per agent, correct if its direction matched the winning signal direction
function computePerf(hist: LiveSignal[]): AgentPerf[] {
  const map = new Map<string, AgentPerf>();
  for (const sig of hist) {
    const won = sig.status === 'TP1' || sig.status === 'TP2' || sig.status === 'TP3';
    for (const [agent, dir] of Object.entries(sig.agentDirs ?? {})) {
      if (dir === 'NEUTRAL') continue;
      const rec = map.get(agent) ?? { agent, preds: 0, hits: 0, accuracy: 0 };
      rec.preds++;
      if (won && dir === sig.direction) rec.hits++;
      rec.accuracy = (rec.hits / rec.preds) * 100;
      map.set(agent, rec);
    }
  }
  return [...map.values()];
}

function notify(sig: LiveSignal) {
  if ('Notification' in window && Notification.permission === 'granted' && (sig.status === 'STOP' || sig.status === 'TP1' || sig.status === 'TP2' || sig.status === 'TP3' || sig.status === 'ACTIVE')) {
    try { new Notification(`Persian Trade â€” ${sig.symbol}`, { body: `${sig.direction} ${sig.status}` }); } catch { /* denied */ }
  }
}

function throttleRefresh(set: SetPartial, get: () => State) {
  if (Date.now() - lastRefresh > 12000) void refreshAnalysis(set, get);
}

async function refreshAnalysis(set: SetPartial, get: () => State) {
  if (refreshing) return;
  refreshing = true;
  lastRefresh = Date.now();
  const t0 = performance.now();
  try {
    const st = get();
    if (st.candles.length < 60 || !st.tick) { refreshing = false; return; }
    const closes = st.candles.map(c => c.c);
    const structure = analyzeStructure(st.candles);
    const liquidity = analyzeLiquidity(st.candles, st.book, []);
    const orderflow = ofEngine.snapshot(st.candles, st.book);
    const gann = analyzeGann(st.candles);
    const quant = analyzeQuant(st.candles, st.timeframe);
    const ctx: AgentContext = {
      symbol: st.symbol, timeframe: st.timeframe, candles: st.candles, mtf: mtfCache, price: st.tick.price,
      structure, liquidity, orderflow, gann, quant, macro: st.macro,
      funding: st.funding ? { rate: st.funding.rate, openInterest: st.funding.openInterest } : null,
      book: st.book, dataFresh: st.conn === 'LIVE',
      minConfidence: st.risk.minConfidence,
      st: { rsi: rsi(closes), macdHist: macd(closes).hist, ema20: ema(closes, 20), ema50: ema(closes, 50) },
    };
    const consensus = runConsensus(ctx, mtfCache);
    const risk: RiskConfig = {
      ...st.risk,
      balance: st.paper.cash + st.paper.positions.reduce((a, p) => a + p.entry * p.qty, 0),
      dailyLossUsd: dailyLoss(st.paper),
      openExposureUsd: st.paper.positions.reduce((a, p) => a + p.mark * p.qty, 0),
    };
    const ares = consensus.stop && consensus.targets.length
      ? aresEvaluate({ direction: consensus.direction, entry: st.tick.price, stop: consensus.stop, target: consensus.targets[0], confidence: consensus.confidence }, risk, ctx)
      : null;
    set({ consensus, ares, liquidity, gann, health: { ...get().health, engineMs: Math.round(performance.now() - t0) } });

    if (!st.signal && !consensus.noTrade && ares?.allowed && consensus.direction !== 'NEUTRAL' && consensus.entryZone) {
      const sig: LiveSignal = {
        id: `sig${++sigSeq}_${uid()}`, symbol: st.symbol, timeframe: st.timeframe, direction: consensus.direction,
        entry: (consensus.entryZone.min + consensus.entryZone.max) / 2, stop: consensus.stop!, targets: consensus.targets,
        rr: ares.rr, confidence: consensus.confidence, setupQuality: consensus.setupQuality,
        status: st.tick.price >= consensus.entryZone.min && st.tick.price <= consensus.entryZone.max ? 'ACTIVE' : 'WAITING',
        reason: consensus.summaryReasons.slice(0, 8), risks: consensus.summaryRisks.slice(0, 6),
        createdAt: Date.now(), dataSource: `${st.activeSource} LIVE`,
        agentDirs: Object.fromEntries(consensus.agents.map(a => [a.agent, a.direction])),
      };
      set({ signal: sig });
    }
  } finally {
    refreshing = false;
  }
}

function dailyLoss(acc: PaperAccount): number {
  const day = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  return -acc.journal.filter(j => j.closedAt >= day).reduce((a, j) => a + Math.min(0, j.pnlUsd), 0);
}
