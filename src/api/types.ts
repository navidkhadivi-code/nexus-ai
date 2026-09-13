export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; q: number; }
export interface Tick { price: number; bid: number; ask: number; ts: number; recv: number; source: string; latency: number; }
export interface BookLevel { price: number; qty: number; }
export interface OrderBook { bids: BookLevel[]; asks: BookLevel[]; lastUpdateId: number; ts: number; source: string; recv: number; latency: number; }
export interface Trade { id: number; price: number; qty: number; time: number; isBuyerMaker: boolean; liquidation?: boolean; }
export interface FundingInfo { rate: number; nextFundingTime: number; openInterest: number; ts: number; }
export type ConnState = 'CONNECTING' | 'LIVE' | 'STALE' | 'OFFLINE' | 'ERROR';

export const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TF_MS: Record<Timeframe, number> = {
  '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000,
  '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000, '12h': 43200000,
  '1d': 86400000, '1w': 604800000,
};

export interface WsEvents {
  tick?: Tick;
  book?: OrderBook;
  trade?: Trade;
  candle?: { c: Candle; final: boolean };
  liquidation?: Trade;
}

export interface ExchangeAdapter {
  id: string;
  name: string;
  probe(): Promise<boolean>;
  fetchCandles(symbol: string, tf: Timeframe, limit: number, until?: number): Promise<Candle[]>;
  fetchBookSnapshot(symbol: string, depth: number): Promise<OrderBook>;
  fetchRecentTrades(symbol: string, limit: number): Promise<Trade[]>;
  fetchFunding(symbol: string): Promise<FundingInfo>;
  wsSetup(symbol: string, tf: Timeframe): { url: string; subscribe?: string[]; pingIntervalMs?: number; pingMsg?: string };
  parseWs(raw: string): WsEvents | null;
  resetState(): void;
}

export function jget(url: string, timeout = 10000): Promise<any> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeout);
  return fetch(url, { signal: ac.signal }).then(async r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.json();
  }).finally(() => clearTimeout(to));
}
