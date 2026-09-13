import { jget, type Candle, type ExchangeAdapter, type FundingInfo, type OrderBook, type Timeframe, type Trade, type WsEvents } from './types';

const REST = 'https://api.bybit.com';

const TF_MAP: Record<string, string> = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720', '1d': 'D', '1w': 'W' };

export class BybitAdapter implements ExchangeAdapter {
  id = 'BYBIT';
  name = 'Bybit spot';
  private bookState: { bids: Map<number, number>; asks: Map<number, number> } | null = null;

  async probe() {
    try { const r = await jget(`${REST}/v5/market/time`, 6000); return r.retCode === 0; } catch { return false; }
  }

  resetState() { this.bookState = null; }

  async fetchCandles(symbol: string, tf: Timeframe, limit = 1000, until?: number): Promise<Candle[]> {
    let url = `${REST}/v5/market/kline?category=spot&symbol=${symbol}&interval=${TF_MAP[tf]}&limit=${Math.min(limit, 1000)}`;
    if (until) url += `&end=${until}`;
    const raw = await jget(url);
    if (raw.retCode !== 0) throw new Error(`bybit ${raw.retMsg}`);
    return (raw.result.list as string[][]).map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], q: +k[6] })).sort((a, b) => a.t - b.t);
  }

  async fetchBookSnapshot(symbol: string, depth = 200): Promise<OrderBook> {
    const t0 = Date.now();
    const raw = await jget(`${REST}/v5/market/orderbook?category=spot&symbol=${symbol}&limit=${Math.min(depth, 500)}`);
    if (raw.retCode !== 0) throw new Error(`bybit ${raw.retMsg}`);
    this.bookState = {
      bids: new Map(raw.result.b.map((x: string[]) => [+x[0], +x[1]])),
      asks: new Map(raw.result.a.map((x: string[]) => [+x[0], +x[1]])),
    };
    return this.toBook(+raw.result.timestamp, Date.now(), t0);
  }

  private toBook(ts: number, recv: number, t0: number): OrderBook {
    const bs = this.bookState!;
    const bids = [...bs.bids.entries()].filter(([, q]) => q > 0).sort((a, b) => b[0] - a[0]).map(([price, qty]) => ({ price, qty }));
    const asks = [...bs.asks.entries()].filter(([, q]) => q > 0).sort((a, b) => a[0] - b[0]).map(([price, qty]) => ({ price, qty }));
    return { bids, asks, lastUpdateId: ts, ts, source: 'BYBIT', recv, latency: recv - t0 };
  }

  async fetchRecentTrades(symbol: string, limit = 600): Promise<Trade[]> {
    const raw = await jget(`${REST}/v5/market/recent-trade?category=spot&symbol=${symbol}&limit=${Math.min(limit, 1000)}`);
    if (raw.retCode !== 0) throw new Error(`bybit ${raw.retMsg}`);
    return (raw.result.list as any[]).map(t => ({ id: Number(String(t.execId).slice(-9)) || 0, price: +t.price, qty: +t.size, time: +t.time, isBuyerMaker: t.side !== 'Buy' })).sort((a, b) => a.time - b.time);
  }

  async fetchFunding(symbol: string): Promise<FundingInfo> {
    // spot has no funding — use the same-base linear perp ticker (clearly labeled, real data)
    try {
      const raw = await jget(`${REST}/v5/market/tickers?category=linear&symbol=${symbol}`);
      const d = raw.result?.list?.[0];
      if (!d) throw new Error('n/a');
      return { rate: +d.fundingRate, nextFundingTime: +d.nextFundingTime, openInterest: +d.openInterest, ts: Date.now() };
    } catch {
      return { rate: NaN, nextFundingTime: 0, openInterest: NaN, ts: Date.now() };
    }
  }

  wsSetup(symbol: string, tf: Timeframe) {
    const topics = [`orderbook.50.${symbol}`, `publicTrade.${symbol}`, `tickers.${symbol}`, `kline.${TF_MAP[tf]}.${symbol}`];
    return {
      url: 'wss://stream.bybit.com/v5/public/spot',
      subscribe: [JSON.stringify({ op: 'subscribe', args: topics })],
      pingIntervalMs: 20000,
      pingMsg: JSON.stringify({ op: 'ping' }),
    };
  }

  parseWs(raw: string): WsEvents | null {
    let m: any;
    try { m = JSON.parse(raw); } catch { return null; }
    if (!m.topic) return null;
    const topic: string = m.topic;
    const d = m.data;
    if (!d) return null;
    if (topic.startsWith('orderbook')) {
      if (!this.bookState) this.bookState = { bids: new Map(), asks: new Map() };
      if (m.type === 'snapshot') this.bookState = { bids: new Map(), asks: new Map() };
      for (const b of d.b ?? []) this.bookState.bids.set(+b[0], +b[1]);
      for (const a of d.a ?? []) this.bookState.asks.set(+a[0], +a[1]);
      return { book: this.toBook(d.ts ? +d.ts : Date.now(), Date.now(), Date.now()) };
    }
    if (topic.startsWith('publicTrade')) {
      const t = Array.isArray(d) ? d[0] : d;
      return { trade: { id: Number(String(t.i).slice(-9)) || 0, price: +t.p, qty: +t.v, time: +t.T, isBuyerMaker: t.S === 'Sell' } };
    }
    if (topic.startsWith('tickers')) {
      const bid = +d.bidPrice, ask = +d.askPrice;
      if (!bid || !ask) return null;
      return { tick: { price: +(d.lastPrice ?? (bid + ask) / 2), bid, ask, ts: Date.now(), recv: Date.now(), source: 'BYBIT', latency: 0 } };
    }
    if (topic.startsWith('kline')) {
      const arr = Array.isArray(d) ? d : [d];
      const k = arr[arr.length - 1];
      return { candle: { c: { t: +k.start, o: +k.open, h: +k.high, l: +k.low, c: +k.close, v: +k.volume, q: +(k.turnover ?? 0) }, final: !!k.confirm } };
    }
    return null;
  }
}

export const bybitAdapter = new BybitAdapter();
