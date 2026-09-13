# API

## Public data APIs consumed (client → exchange)

| Purpose | Binance | Bybit | OKX |
|---|---|---|---|
| Candles | `/api/v3/klines` (vision mirror) | `/v5/market/kline` | `/api/v5/market/candles` |
| Book snapshot | `/api/v3/depth` | `/v5/market/orderbook` | `/api/v5/market/books` |
| Trades | `/api/v3/trades` | `/v5/market/recent-trade` | `/api/v5/market/trades` |
| Funding/OI | `/fapi/v1/premiumIndex`, `/fapi/v1/openInterest` | `/v5/market/tickers?category=linear` | `/api/v5/public/funding-rate` |
| WS | `stream.binance.com:9443` bookTicker/depth20@100ms/trade/kline | `stream.bybit.com/v5/public/spot` orderbook.50/publicTrade/tickers/kline | `ws.okx.com:8443/ws/v5/public` bbo-tbt/books/trades/candle |
| Macro | — | — | CoinGecko `/global`, alternative.me `/fng` |

All endpoints are PUBLIC market-data endpoints. **No API keys are required or used.**
Withdrawal-capable credentials are never requested anywhere in the codebase.

## Internal service interfaces (frontend)

```ts
interface ExchangeAdapter {
  probe(): Promise<boolean>;
  fetchCandles(symbol, tf, limit, until?): Promise<Candle[]>;
  fetchBookSnapshot(symbol, depth): Promise<OrderBook>;
  fetchRecentTrades(symbol, limit): Promise<Trade[]>;
  fetchFunding(symbol): Promise<FundingInfo>;
  wsSetup(symbol, tf): { url; subscribe?; pingIntervalMs?; pingMsg? };
  parseWs(raw): WsEvents | null;
  resetState(): void;
}
```

`MarketGateway` consumes an adapter, emits `{onTick,onBook,onTrade,onCandle,onStatus}`.

## Agent output (Phase 14 contract — enforced by TypeScript)

```json
{
  "agent": "NOVA", "symbol": "BTCUSDT", "timeframe": "15m",
  "direction": "LONG", "confidence": 82,
  "entry_zone": { "min": 0, "max": 0 }, "stop_loss": 0, "targets": [0,0,0],
  "market_regime": "TRENDING_UP", "reasons": [], "risks": [],
  "timestamp": "…", "data_source": "BINANCE", "model_version": "nexus-rules-v1.0"
}
```

## VPS roadmap REST surface (design only)

`/auth` (register, login, refresh, 2FA) · `/markets` · `/orderbook` · `/technical` ·
`/liquidity` · `/orderflow` · `/gann` · `/quant` · `/macro` · `/agents` · `/consensus` ·
`/signals` · `/risk` · `/paper-trading` · `/backtesting` · `/portfolio` · `/journal` ·
`/alerts` · `/admin` · `/system-health` — NestJS modules per Phase 2.

## Database entities (Prisma design for VPS)

users/roles/permissions · exchanges/exchange_accounts (encrypted creds) · markets ·
candles/trades_market/orderbook_snapshots/funding_rates/open_interest/liquidations ·
agents/agent_versions/agent_predictions · consensus_signals/signal_events · risk_decisions ·
orders/order_fills/positions · paper_accounts/paper_orders/paper_positions ·
portfolio_snapshots · backtests/backtest_trades/walk_forward_tests/monte_carlo_tests ·
trade_journal · alerts/notifications · audit_logs/system_logs/error_logs/system_health —
all with UUID pk, created_at/updated_at, indexes and FKs.
