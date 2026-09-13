import type { Candle, OrderBook, Trade, Tick, FundingInfo, Timeframe } from './binance';

export interface WsEvents {
  tick?: Tick;
  book?: OrderBook;
  trade?: Trade;
  candle?: { c: Candle; final: boolean };
}

export interface ExchangeAdapter {
  id: string;
  name: string;
  probe(): Promise<boolean>;
  fetchCandles(symbol: string, tf: Timeframe, limit: number, until?: number): Promise<Candle[]>;
  fetchBookSnapshot(symbol: string, depth: number): Promise<OrderBook>;
  fetchRecentTrades(symbol: string, limit: number): Promise<Trade[]>;
  fetchFunding(symbol: string): Promise<FundingInfo>;
  /** WS endpoint + subscribe protocol */
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
