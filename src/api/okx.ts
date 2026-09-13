import { jget, type Candle, type ExchangeAdapter, type FundingInfo, type OrderBook, type Timeframe, type Trade, type WsEvents } from './types';

const REST = 'https://www.okx.com';

// Binance-style symbol → OKX instId
function inst(symbol: string): string {
  const m = symbol.match(/^(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|LTC|AVAX|DOT)(USDT|USDC|USD)$/i);
  return m ? `${m[1].toUpperCase()}-${m[2].toUpperCase()}` : symbol;
}

const TF_MAP: Record<Timeframe, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H',
  '4h': '4H', '6h': '6H', '12h': '12H', '1d': '1Dutc', '1w': '1Wutc',
};

export class OkxAdapter implements ExchangeAdapter {
  id = 'OKX';
  name = 'OKX spot';
  private bookState: { bids: Map<number, number>; asks: Map<number, number> } | null = null;

  async probe() {
    try { const r = await jget(`${REST}/api/v5/public/time`, 6000); return r.code === '0'; } catch { return false; }
  }

  resetState() { this.bookState = null; }

  async fetchCandles(symbol: string, tf: Timeframe, limit = 300, until?: number): Promise<Candle[]> {
    let url = `${REST}/api/v5/market/candles?instId=${inst(symbol)}&bar=${TF_MAP[tf]}&limit=${Math.min(limit, 300)}`;
    if (until) url += `&after=${until}`;
    const raw = await jget(url);
    if (raw.code !== '0') throw new Error(`okx ${raw.msg}`);
    return (raw.data as string[][]).map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], q: +(k[7] ?? 0) })).sort((a, b) => a.t - b.t);
  }

  async fetchBookSnapshot(symbol: string, depth = 400): Promise<OrderBook> {
    const t0 = Date.now();
    const raw = await jget(`${REST}/api/v5/market/books?instId=${inst(symbol)}&sz=${Math.min(depth, 400)}`);
    if (raw.code !== '0') throw new Error(`okx ${raw.msg}`);
    const d = raw.data[0];
    this.bookState = {
      bids: new Map(d.bids.map((x: string[]) => [+x[0], +x[1]])),
      asks: new Map(d.asks.map((x: string[]) => [+x[0], +x[1]])),
    };
    return this.toBook(+d.ts, Date.now(), t0);
  }

  private toBook(ts: number, recv: number, t0: number): OrderBook {
    const bs = this.bookState!;
    const bids = [...bs.bids.entries()].filter(([, q]) => q > 0).sort((a, b) => b[0] - a[0]).map(([price, qty]) => ({ price, qty }));
    const asks = [...bs.asks.entries()].filter(([, q]) => q > 0).sort((a, b) => a[0] - b[0]).map(([price, qty]) => ({ price, qty }));
    return { bids, asks, lastUpdateId: ts, ts, source: 'OKX', recv, latency: recv - t0 };
  }

  async fetchRecentTrades(symbol: string, limit = 300): Promise<Trade[]> {
    const raw = await jget(`${REST}/api/v5/market/trades?instId=${inst(symbol)}&limit=${Math.min(limit, 300)}`);
    if (raw.code !== '0') throw new Error(`okx ${raw.msg}`);
    return (raw.data as any[]).map(t => ({ id: +t.tradeId, price: +t.px, qty: +t.sz, time: +t.ts, isBuyerMaker: t.side === 'sell' })).sort((a, b) => a.time - b.time);
  }

  async fetchFunding(symbol: string): Promise<FundingInfo> {
    try {
      const raw = await jget(`${REST}/api/v5/public/funding-rate?instId=${inst(symbol)}-SWAP`);
      const d = raw.data?.[0];
      let oi = NaN;
      try {
        const s = await jget(`${REST}/api/v5/market/tickers?instType=SWAP`);
        const row = s.data.find((x: any) => x.instId === `${inst(symbol)}-SWAP`);
        oi = row ? +row.openInterest * +(row?.openInterestCt ?? 1) : NaN;
      } catch { oi = NaN; }
      return { rate: +d.fundingRate, nextFundingTime: +d.nextFundingTime, openInterest: oi, ts: Date.now() };
    } catch {
      return { rate: NaN, nextFundingTime: 0, openInterest: NaN, ts: Date.now() };
    }
  }

  wsSetup(symbol: string, tf: Timeframe) {
    const i = inst(symbol);
    return {
      url: 'wss://ws.okx.com:8443/ws/v5/public',
      subscribe: [JSON.stringify({
        op: 'subscribe',
        args: [
          { channel: 'bbo-tbt', instId: i },
          { channel: 'books', instId: i },
          { channel: 'trades', instId: i },
          { channel: `candle${TF_MAP[tf]}`, instId: i },
        ],
      })],
      pingIntervalMs: 20000,
      pingMsg: 'ping',
    };
  }

  parseWs(raw: string): WsEvents | null {
    if (raw === 'pong') return null;
    let m: any;
    try { m = JSON.parse(raw); } catch { return null; }
    if (!m.arg?.channel || !m.data) return null;
    const ch: string = m.arg.channel;
    const d = Array.isArray(m.data) ? m.data[0] : m.data;
    if (ch === 'bbo-tbt') {
      const bid = +d.bids[0]?.[0], ask = +d.asks[0]?.[0];
      if (!bid || !ask) return null;
      return { tick: { price: (bid + ask) / 2, bid, ask, ts: +d.ts, recv: Date.now(), source: 'OKX', latency: Math.max(0, Date.now() - +d.ts) } };
    }
    if (ch === 'books') {
      if (m.action === 'snapshot' || !this.bookState) this.bookState = { bids: new Map(), asks: new Map() };
      for (const b of d.bids ?? []) this.bookState.bids.set(+b[0], +b[1]);
      for (const a of d.asks ?? []) this.bookState.asks.set(+a[0], +a[1]);
      return { book: this.toBook(+d.ts, Date.now(), Date.now()) };
    }
    if (ch === 'trades') {
      return { trade: { id: +d.tradeId, price: +d.px, qty: +d.sz, time: +d.ts, isBuyerMaker: d.side === 'sell' } };
    }
    if (ch.startsWith('candle')) {
      return { candle: { c: { t: +d[0], o: +d[1], h: +d[2], l: +d[3], c: +d[4], v: +d[5], q: +(d[7] ?? 0) }, final: d[8] === '1' } };
    }
    return null;
  }
}

export const okxAdapter = new OkxAdapter();
