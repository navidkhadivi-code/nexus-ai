import { TF_MS, jget, type Candle, type ConnState, type ExchangeAdapter, type FundingInfo, type OrderBook, type Tick, type Timeframe, type Trade, type WsEvents } from './types';

export type { Candle, ConnState, FundingInfo, OrderBook, Tick, Timeframe, Trade, WsEvents };
export { TIMEFRAMES, TF_MS } from './types';
export type { ExchangeAdapter } from './types';

const SPOT = 'https://api.binance.com';
const VISION = 'https://data-api.binance.vision';
const FUT = 'https://fapi.binance.com';

export async function fetchCandles(symbol: string, tf: Timeframe, limit = 1000, market: 'spot' | 'futures' = 'spot', until?: number): Promise<Candle[]> {
  const base = market === 'spot' ? VISION : FUT;
  const path = market === 'spot' ? '/api/v3/klines' : '/fapi/v1/klines';
  let url = `${base}${path}?symbol=${symbol}&interval=${tf}&limit=${limit}`;
  if (until) url += `&endTime=${until}`;
  const raw = await jget(url);
  return raw.map((k: any[]) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], q: +k[7] }));
}

export async function fetchBookSnapshot(symbol: string, market: 'spot' | 'futures' = 'spot', depth = 500): Promise<OrderBook> {
  const recv = Date.now();
  const url = market === 'spot'
    ? `${VISION}/api/v3/depth?symbol=${symbol}&limit=${Math.min(depth, 1000)}`
    : `${FUT}/fapi/v1/depth?symbol=${symbol}&limit=${Math.min(depth, 1000)}`;
  const raw = await jget(url);
  const t = Date.now();
  return {
    bids: raw.bids.map((b: string[]) => ({ price: +b[0], qty: +b[1] })),
    asks: raw.asks.map((a: string[]) => ({ price: +a[0], qty: +a[1] })),
    lastUpdateId: raw.lastUpdateId ?? 0, ts: t, source: 'BINANCE', recv: t, latency: t - recv,
  };
}

export async function fetchRecentTrades(symbol: string, market: 'spot' | 'futures' = 'spot', limit = 1000): Promise<Trade[]> {
  const url = market === 'spot'
    ? `${VISION}/api/v3/trades?symbol=${symbol}&limit=${Math.min(limit, 1000)}`
    : `${FUT}/fapi/v1/trades?symbol=${symbol}&limit=${Math.min(limit, 1000)}`;
  const raw = await jget(url);
  return raw.map((t: any) => ({ id: +t.id, price: +t.price, qty: +t.qty, time: +t.time, isBuyerMaker: !!t.isBuyerMaker }));
}

export async function fetchFunding(symbol: string): Promise<FundingInfo> {
  try {
    const pr = await jget(`${FUT}/fapi/v1/premiumIndex?symbol=${symbol}`);
    let oi = 0;
    try { oi = +(await jget(`${FUT}/fapi/v1/openInterest?symbol=${symbol}`)).openInterest; } catch { /* optional */ }
    return { rate: +pr.lastFundingRate, nextFundingTime: +pr.nextFundingTime, openInterest: oi, ts: Date.now() };
  } catch {
    return { rate: NaN, nextFundingTime: 0, openInterest: NaN, ts: Date.now() };
  }
}

export async function fetchServerTime(): Promise<number> {
  return (await jget(`${VISION}/api/v3/time`)).serverTime;
}

// ---------- BinanceAdapter (ExchangeAdapter) ----------

export class BinanceAdapter implements ExchangeAdapter {
  id = 'BINANCE';
  name = 'Binance (spot + futures funding)';

  async probe() {
    try { const r = await jget(`${VISION}/api/v3/time`, 6000); return !!r.serverTime; } catch { return false; }
  }
  fetchCandles = (s: string, tf: Timeframe, limit = 1000, until?: number) => fetchCandles(s, tf, limit, 'spot', until);
  fetchBookSnapshot = (s: string, depth = 500) => fetchBookSnapshot(s, 'spot', depth);
  fetchRecentTrades = (s: string, limit = 1000) => fetchRecentTrades(s, 'spot', limit);
  fetchFunding = (s: string) => fetchFunding(s);
  resetState() { /* stateless */ }

  wsSetup(symbol: string, tf: Timeframe) {
    const s = symbol.toLowerCase();
    return {
      url: `wss://stream.binance.com:9443/stream?streams=${[`${s}@bookTicker`, `${s}@depth20@100ms`, `${s}@trade`, `${s}@kline_${tf}`].join('/')}`,
    };
  }

  parseWs(raw: string): WsEvents | null {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return null; }
    const d = msg.data ?? msg;
    const stream: string = msg.stream ?? '';
    if (!d) return null;
    if (stream.includes('@bookTicker')) {
      const bid = +d.b, ask = +d.a;
      return { tick: { price: (bid + ask) / 2, bid, ask, ts: Date.now(), recv: Date.now(), source: 'BINANCE', latency: 0 } };
    }
    if (stream.includes('@depth')) {
      return { book: {
        bids: d.bids.map((b: string[]) => ({ price: +b[0], qty: +b[1] })),
        asks: d.asks.map((a: string[]) => ({ price: +a[0], qty: +a[1] })),
        lastUpdateId: d.lastUpdateId ?? 0, ts: Date.now(), source: 'BINANCE', recv: Date.now(), latency: 0,
      } };
    }
    if (stream.includes('@trade')) {
      return { trade: { id: d.a ?? 0, price: +d.p, qty: +d.q, time: +d.T, isBuyerMaker: !!d.m } };
    }
    if (stream.includes('@kline')) {
      const k = d.k ?? d;
      return { candle: { c: { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, q: +k.q }, final: !!k.x } };
    }
    return null;
  }
}

export const binanceAdapter = new BinanceAdapter();
