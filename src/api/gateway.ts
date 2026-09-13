import type { ConnState, ExchangeAdapter, Timeframe } from './types';
import type { Candle, OrderBook, Tick, Trade } from './types';

export interface GatewayHandlers {
  onStatus: (s: ConnState, detail?: string) => void;
  onTick: (t: Tick) => void;
  onBook: (b: OrderBook) => void;
  onTrade: (t: Trade) => void;
  onCandle: (c: Candle, final: boolean) => void;
}

// Market Data Gateway: adapter-driven WS with auto-reconnect, heartbeat and staleness detection.
export class MarketGateway {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private staleTimer: number | null = null;
  private pingTimer: number | null = null;
  private closed = false;
  lastMsgAt = 0;
  seq = 0;

  constructor(private adapter: ExchangeAdapter, private symbol: string, private tf: Timeframe, private h: GatewayHandlers) {}

  start() {
    this.closed = false;
    this.adapter.resetState();
    this.connect();
  }

  reconfigure(adapter: ExchangeAdapter, symbol: string, tf: Timeframe) {
    this.adapter = adapter; this.symbol = symbol; this.tf = tf;
    this.teardownSocket();
    this.start();
  }

  stop() {
    this.closed = true;
    this.teardownSocket();
    if (this.staleTimer) clearInterval(this.staleTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
  }

  private connect() {
    if (this.closed) return;
    this.h.onStatus('CONNECTING', this.adapter.id);
    const setup = this.adapter.wsSetup(this.symbol, this.tf);
    try {
      this.ws = new WebSocket(setup.url);
    } catch (e) {
      this.h.onStatus('ERROR', String(e));
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.lastMsgAt = Date.now();
      this.h.onStatus('LIVE', this.adapter.id);
      for (const sub of setup.subscribe ?? []) this.ws?.send(sub);
      if (setup.pingIntervalMs && setup.pingMsg) {
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => { try { this.ws?.send(setup.pingMsg!); } catch { /* noop */ } }, setup.pingIntervalMs);
      }
    };
    this.ws.onmessage = (ev) => {
      this.lastMsgAt = Date.now();
      this.seq++;
      const e = this.adapter.parseWs(String(ev.data));
      if (!e) return;
      if (e.tick) this.h.onTick(e.tick);
      if (e.book) this.h.onBook(e.book);
      if (e.trade) this.h.onTrade(e.trade);
      if (e.candle) this.h.onCandle(e.candle.c, e.candle.final);
    };
    this.ws.onclose = () => { if (!this.closed) { this.h.onStatus('OFFLINE'); this.scheduleReconnect(); } };
    this.ws.onerror = () => this.h.onStatus('ERROR');

    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && Date.now() - this.lastMsgAt > 15000) this.h.onStatus('STALE');
    }, 3000);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.closed) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000 + Math.random() * 2000);
  }

  private teardownSocket() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
  }
}
