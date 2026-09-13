import type { Candle, OrderBook, Trade } from '../api/binance';

export interface OrderFlowResult {
  buyVol: number;
  sellVol: number;
  delta: number;
  cvd: number;          // cumulative over retained trade window
  cvdSlope: number;     // normalized recent trend of CVD
  imbalanceRatio: number;
  absorption: 'BUY_ABSORPTION' | 'SELL_ABSORPTION' | 'NONE';
  exhaustion: 'BUY_EXHAUSTION' | 'SELL_EXHAUSTION' | 'NONE';
  pressure: 'BUYING' | 'SELLING' | 'NEUTRAL';
  bookImbalance: number;
  largeOrders: number;
  spoofWarning: 'POSSIBLE_SPOOFING' | null;
}

export class OrderFlowEngine {
  trades: Trade[] = [];
  cvdSeries: { t: number; v: number }[] = [];
  private cvd = 0;

  pushTrade(t: Trade) {
    const signed = t.isBuyerMaker ? -t.qty : t.qty;
    this.cvd += signed;
    this.trades.push(t);
    this.cvdSeries.push({ t: t.time, v: this.cvd });
    if (this.trades.length > 4000) this.trades.splice(0, this.trades.length - 4000);
    if (this.cvdSeries.length > 4000) this.cvdSeries.splice(0, this.cvdSeries.length - 4000);
  }

  reset() { this.trades = []; this.cvdSeries = []; this.cvd = 0; }

  snapshot(candles: Candle[], book: OrderBook | null): OrderFlowResult {
    const recent = this.trades.slice(-600);
    let buyVol = 0, sellVol = 0;
    for (const t of recent) { if (t.isBuyerMaker) sellVol += t.qty; else buyVol += t.qty; }
    const delta = buyVol - sellVol;
    const total = buyVol + sellVol || 1;

    const cs = this.cvdSeries.slice(-60);
    let cvdSlope = 0;
    if (cs.length >= 10) {
      const n = cs.length;
      const half = Math.floor(n / 2);
      const first = cs.slice(0, half).map(p => p.v), second = cs.slice(half).map(p => p.v);
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      const scale = Math.max(Math.abs(avg(first)), Math.abs(avg(second)), 1e-9);
      cvdSlope = Math.max(-1, Math.min(1, (avg(second) - avg(first)) / scale));
    }

    // absorption: heavy volume without price progress in last candles
    let absorption: OrderFlowResult['absorption'] = 'NONE';
    const lastCandles = candles.slice(-6);
    if (lastCandles.length >= 4 && recent.length >= 100) {
      const upVol = recent.filter(t => !t.isBuyerMaker && t.time >= lastCandles[0].t).reduce((a, t) => a + t.qty, 0);
      const dnVol = recent.filter(t => t.isBuyerMaker && t.time >= lastCandles[0].t).reduce((a, t) => a + t.qty, 0);
      const priceRange = (Math.max(...lastCandles.map(c => c.h)) - Math.min(...lastCandles.map(c => c.l))) / (lastCandles[0].c || 1);
      if (upVol > dnVol * 1.4 && priceRange < 0.004) absorption = 'BUY_ABSORPTION';
      else if (dnVol > upVol * 1.4 && priceRange < 0.004) absorption = 'SELL_ABSORPTION';
    }

    // exhaustion: large volume spike with reversal candle
    let exhaustion: OrderFlowResult['exhaustion'] = 'NONE';
    const cl = candles.slice(-8);
    if (cl.length >= 8) {
      const vols = cl.map(c => c.v);
      const avgV = vols.slice(0, 7).reduce((a, b) => a + b, 0) / 7 || 1;
      const last = cl[7], prev = cl[6];
      if (last.v > avgV * 2.2) {
        if (prev.c > prev.o && last.c < last.o && last.c < prev.o) exhaustion = 'BUY_EXHAUSTION';
        if (prev.c < prev.o && last.c > last.o && last.c > prev.o) exhaustion = 'SELL_EXHAUSTION';
      }
    }

    // book imbalance (depth-weighted over displayed levels)
    let bookImbalance = 0;
    if (book && book.bids.length && book.asks.length) {
      const bv = book.bids.slice(0, 20).reduce((a, l) => a + l.price * l.qty, 0);
      const av = book.asks.slice(0, 20).reduce((a, l) => a + l.price * l.qty, 0);
      bookImbalance = (bv - av) / (bv + av || 1);
    }

    // aggressive large orders
    const avgQty = recent.length ? recent.reduce((a, t) => a + t.qty, 0) / recent.length : 0;
    const largeOrders = recent.filter(t => t.qty > avgQty * 5).length;

    // possible spoofing: large repeated orders far from mid (heuristic, flagged ONLY as possible)
    let spoofWarning: OrderFlowResult['spoofWarning'] = null;
    if (book && book.asks.length >= 10 && book.bids.length >= 10) {
      const mid = (book.bids[0].price + book.asks[0].price) / 2;
      const maxQty = Math.max(...book.asks.map(a => a.qty), 1e-9);
      const farBigAsks = book.asks.filter(a => a.price > mid * 1.002 && a.qty > maxQty * 0.85).length;
      if (farBigAsks >= 2) spoofWarning = 'POSSIBLE_SPOOFING';
    }

    const pressure = delta > total * 0.06 || cvdSlope > 0.25 ? 'BUYING' : delta < -total * 0.06 || cvdSlope < -0.25 ? 'SELLING' : 'NEUTRAL';

    return {
      buyVol, sellVol, delta, cvd: this.cvd, cvdSlope,
      imbalanceRatio: buyVol / (sellVol || 1e-9),
      absorption, exhaustion, pressure, bookImbalance, largeOrders, spoofWarning,
    };
  }
}

export function orderBookMetrics(book: OrderBook | null) {
  if (!book || !book.bids.length || !book.asks.length) return null;
  const bid = book.bids[0].price, ask = book.asks[0].price;
  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  const bidDepth = book.bids.reduce((a, l) => a + l.qty, 0);
  const askDepth = book.asks.reduce((a, l) => a + l.qty, 0);
  const cumBid: number[] = []; let cb = 0;
  for (const l of book.bids) { cb += l.qty; cumBid.push(cb); }
  const cumAsk: number[] = []; let ca = 0;
  for (const l of book.asks) { ca += l.qty; cumAsk.push(ca); }
  return { bid, ask, mid, spread, spreadPct: (spread / mid) * 100, bidDepth, askDepth, depthImbalance: (bidDepth - askDepth) / (bidDepth + askDepth || 1), cumBid, cumAsk };
}
