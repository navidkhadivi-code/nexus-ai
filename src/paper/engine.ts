// Paper trading on REAL market prices. Fills at actual bid/ask + slippage + fees.
// NEVER uses arbitrary candle-close execution.

export interface PaperOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  qty: number;
  limitPrice?: number;
  status: 'NEW' | 'FILLED' | 'CANCELLED' | 'PARTIAL';
  createdAt: number;
  filledAt?: number;
  fillPrice?: number;
  feePaid: number;
  mode: 'PAPER';
}

export interface PaperPosition {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  entry: number;
  mark: number;
  sl: number;
  tp: number[];
  margin: number;
  openedAt: number;
  fundingAccrued: number;
  mode: 'PAPER';
}

export interface JournalEntry {
  tradeId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  exit: number;
  qty: number;
  sl: number;
  tp: number;
  fees: number;
  funding: number;
  slippageUsd: number;
  pnlUsd: number;
  pnlPct: number;
  rMultiple: number;
  riskUsd: number;
  rrPlanned: number;
  confidence: number;
  consensusDir: string;
  marketRegime: string;
  setupQuality: number;
  openedAt: number;
  closedAt: number;
  mode: 'PAPER';
}

export interface PaperAccount {
  startBalance: number;
  cash: number;         // equity: realized P&L + fees (full-notional buying model, leverage applies)
  usedMargin: number;   // margin currently locked in open positions
  orders: PaperOrder[];
  positions: PaperPosition[];
  journal: JournalEntry[];
  equityCurve: { t: number; v: number }[];
  killSwitch: boolean;
}

const KEY = 'nexus_paper_v1';
export const FEE_RATE = 0.001; // 10 bps taker
export const SLIPPAGE_BPS = 3;
export const MAX_LEVERAGE = 5; // paper margin cap (matches default risk config)

export function loadAccount(): PaperAccount {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const a = JSON.parse(raw); if (!a.usedMargin) a.usedMargin = 0; return a; }
  } catch { /* corrupted storage → fresh account */ }
  return { startBalance: 10000, cash: 10000, usedMargin: 0, orders: [], positions: [], journal: [], equityCurve: [], killSwitch: false };
}

export function saveAccount(a: PaperAccount) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* quota */ }
}

export function uid(): string {
  return 'nxs' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function slip(side: 'BUY' | 'SELL', px: number) {
  return side === 'BUY' ? px * (1 + SLIPPAGE_BPS / 10000) : px * (1 - SLIPPAGE_BPS / 10000);
}

export interface Quote { bid: number; ask: number }

export function openPosition(a: PaperAccount, symbol: string, side: 'LONG' | 'SHORT', qty: number, q: Quote, sl: number, tp: number[], meta: { confidence: number; regime: string; setupQuality: number; rrPlanned: number }): { ok: boolean; reason?: string; pos?: PaperPosition } {
  if (a.killSwitch) return { ok: false, reason: 'KILL SWITCH ACTIVE — no new trades' };
  if (!(qty > 0) || !isFinite(qty)) return { ok: false, reason: 'Invalid quantity' };
  // idempotency guard (Phase 28): never stack a new fill within 500ms of same-direction order
  const dup = a.orders.find(o => o.symbol === symbol && o.side === (side === 'LONG' ? 'BUY' : 'SELL') && Date.now() - o.createdAt < 500);
  if (dup) return { ok: false, reason: 'DUPLICATE ORDER BLOCKED — verify order status before resubmitting' };
  const entry = side === 'LONG' ? slip('BUY', q.ask) : slip('SELL', q.bid); // aggressive fills at real bid/ask + slippage
  const notional = qty * entry;
  const fee = notional * FEE_RATE;
  const margin = notional / MAX_LEVERAGE;
  if (a.cash - a.usedMargin < margin + fee) return { ok: false, reason: `Insufficient paper margin: need $${(margin + fee).toFixed(2)}, have $${(a.cash - a.usedMargin).toFixed(2)}` };
  const pos: PaperPosition = {
    id: uid(), symbol, side, qty, entry, mark: side === 'LONG' ? q.bid : q.ask,
    sl, tp, margin, openedAt: Date.now(), fundingAccrued: 0, mode: 'PAPER',
  };
  a.cash -= fee;
  a.usedMargin += margin;
  const ord: PaperOrder = { id: uid(), symbol, side: side === 'LONG' ? 'BUY' : 'SELL', type: 'MARKET', qty, status: 'FILLED', createdAt: Date.now(), filledAt: Date.now(), fillPrice: entry, feePaid: fee, mode: 'PAPER' };
  a.orders.unshift(ord);
  a.positions.push(pos);
  return { ok: true, pos };
}

export function closePosition(a: PaperAccount, posId: string, q: Quote, reason = 'MANUAL'): JournalEntry | null {
  const idx = a.positions.findIndex(p => p.id === posId);
  if (idx === -1) return null;
  const pos = a.positions[idx];
  const exitPx = pos.side === 'LONG' ? slip('SELL', q.bid) : slip('BUY', q.ask);
  const gross = pos.side === 'LONG' ? (exitPx - pos.entry) * pos.qty : (pos.entry - exitPx) * pos.qty;
  const entryFee = pos.entry * pos.qty * FEE_RATE;
  const exitFee = exitPx * pos.qty * FEE_RATE;
  const fees = entryFee + exitFee;
  const pnl = gross - fees - pos.fundingAccrued;
  a.cash += pnl;
  a.usedMargin = Math.max(0, a.usedMargin - (pos.margin ?? (pos.entry * pos.qty) / MAX_LEVERAGE));
  const risk = Math.abs(pos.entry - pos.sl) * pos.qty || Math.abs(pos.entry * pos.qty * 0.01);
  const entry: JournalEntry = {
    tradeId: pos.id, symbol: pos.symbol, side: pos.side, entry: pos.entry, exit: exitPx, qty: pos.qty,
    sl: pos.sl, tp: pos.tp[pos.tp.length - 1] ?? pos.tp[0] ?? pos.entry, fees, funding: pos.fundingAccrued,
    slippageUsd: (SLIPPAGE_BPS / 10000) * pos.entry * pos.qty * 2,
    pnlUsd: pnl, pnlPct: (pnl / (pos.entry * pos.qty || 1)) * 100,
    rMultiple: risk ? pnl / risk : 0, riskUsd: risk, rrPlanned: 0,
    confidence: 0, consensusDir: '', marketRegime: '', setupQuality: 0,
    openedAt: pos.openedAt, closedAt: Date.now(), mode: 'PAPER',
  };
  a.positions.splice(idx, 1);
  a.journal.unshift(entry);
  const ord: PaperOrder = { id: uid(), symbol: pos.symbol, side: pos.side === 'LONG' ? 'SELL' : 'BUY', type: 'MARKET', qty: pos.qty, status: 'FILLED', createdAt: Date.now(), filledAt: Date.now(), fillPrice: exitPx, feePaid: exitFee, mode: 'PAPER' };
  a.orders.unshift(ord);
  return entry;
}

// Manage SL/TP against REAL bid/ask each tick. Returns closed entries.
export function managePositions(a: PaperAccount, quotes: Map<string, Quote>, fundingRate: number): JournalEntry[] {
  const closed: JournalEntry[] = [];
  for (const pos of [...a.positions]) {
    const q = quotes.get(pos.symbol);
    if (!q) continue;
    pos.mark = pos.side === 'LONG' ? q.bid : q.ask;
    // funding accrual estimate per mark pass (8h rate applied pro-rata is handled by caller cadence)
    const hitSl = pos.side === 'LONG' ? q.bid <= pos.sl : q.ask >= pos.sl;
    if (hitSl) { const e = closePosition(a, pos.id, q, 'SL'); if (e) { e.consensusDir = 'SL'; closed.push(e); } continue; }
    const tpHit = pos.tp.find(t => (pos.side === 'LONG' ? q.bid >= t : q.ask <= t));
    if (tpHit != null) {
      // partial close 1/3 per TP would complicate accounting; close at final TP hit
      if (tpHit === pos.tp[pos.tp.length - 1]) { const e = closePosition(a, pos.id, q, 'TP'); if (e) { e.consensusDir = 'TP'; closed.push(e); } }
    }
  }
  return closed;
}

export function portfolioStats(a: PaperAccount) {
  const unreal = a.positions.reduce((acc, p) => acc + (p.side === 'LONG' ? (p.mark - p.entry) : (p.entry - p.mark)) * p.qty, 0);
  const exposure = a.positions.reduce((acc, p) => acc + p.mark * p.qty, 0);
  const realized = a.journal.reduce((x, j) => x + j.pnlUsd, 0);
  const equity = a.startBalance + realized + unreal;
  let peak = a.startBalance, maxDD = 0;
  for (const pt of a.equityCurve) { peak = Math.max(peak, pt.v); maxDD = Math.max(maxDD, (peak - pt.v) / (peak || 1)); }
  return { equity, cash: a.cash, unrealized: unreal, realized, exposure, maxDrawdownPct: maxDD * 100, usedMargin: exposure, availableMargin: a.cash };
}

export function exportCsv(a: PaperAccount): string {
  const head = 'trade_id,symbol,side,entry,exit,qty,sl,tp,fees,funding,slippage_usd,pnl_usd,pnl_pct,r_multiple,opened_utc,closed_utc,mode';
  const rows = a.journal.map(j => [j.tradeId, j.symbol, j.side, j.entry, j.exit, j.qty, j.sl, j.tp, j.fees.toFixed(4), j.funding.toFixed(4), j.slippageUsd.toFixed(4), j.pnlUsd.toFixed(2), j.pnlPct.toFixed(3), j.rMultiple.toFixed(3), new Date(j.openedAt).toISOString(), new Date(j.closedAt).toISOString(), j.mode].join(','));
  return [head, ...rows].join('\n');
}
