# ARCHITECTURE

## Deployed build (shared cPanel — static)

Frontend-only SPA. All computation happens in the browser from real public market data.

```
src/api/types.ts        — shared data contracts (Candle, OrderBook, Tick, Trade, …)
src/api/adapter.ts      — ExchangeAdapter interface (add new exchanges without rewrites)
src/api/binance.ts      — BinanceAdapter (REST vision mirror + WS streams + futures funding)
src/api/bybit.ts        — BybitAdapter (v5 REST/WS, snapshot+delta orderbook state)
src/api/okx.ts          — OkxAdapter (v5 REST/WS, bbo/books/trades/candles channels)
src/api/gateway.ts      — MarketGateway: connect, subscribe, heartbeat, reconnect,
                          staleness detection (>15s ⇒ STALE ⇒ signals stop)
src/engine/indicators.ts— SMA EMA RSI MACD ATR ADX Bollinger VWAP VolumeProfile (deterministic)
src/engine/structure.ts — swings HH/HL/LH/LL, BOS/CHOCH, S/R clusters, regimes
src/engine/liquidity.ts — EQH/EQL, sweeps, order blocks, FVG, POC/HVN/LVN, book walls
src/engine/orderflow.ts — delta, CVD, imbalance, absorption, exhaustion, spoof warning
src/engine/gann.ts      — angles (1x1…4x1), square-of-9, time cycles, fib, confluence zones
src/engine/quant.ts     — returns, vol, z-score, correlation, expectancy, conditioned P(up)
src/engine/macro.ts     — mcap/BTC-d/fear-greed (real), DXY/NASDAQ/SPX: DATA UNAVAILABLE
src/engine/backtest.ts  — event-driven bt + metrics + Monte Carlo + walk-forward
src/agents/agents.ts    — 8 agents → structured JSON (entry/SL/TP/confidence/reasons/risks)
src/agents/consensus.ts — weighted consensus (15/15/20/15/5/10/20) + MTF + NO-TRADE engine
src/state/store.ts      — zustand store, pipeline wiring, signal lifecycle, agent accuracy
src/paper/engine.ts     — paper account: bid/ask fills, slippage, fees, margin, kill switch
src/components/Chart.tsx— lightweight-charts: 12 TFs, indicators, BOS/CHOCH/liquidity/Gann overlays
```

**Persistence (shared host):** localStorage only (`nexus_paper_v1`). No credentials,
no secrets, no server DB — appropriate for the host class.

## VPS roadmap build (documented, not deployed here)

The master spec targets: NestJS modular API + PostgreSQL/Prisma + Redis + workers +
Next.js SSR + Docker. On a VPS the same engine code moves server-side unchanged
(pure TypeScript), adding: multi-user auth (JWT/2FA/RBAC), candle/trade time-series
persistence, encrypted exchange credentials (AES-256-GCM, envelope), execution service,
webhook/Telegram alerts, and rate-limited REST/WS fan-out.

Entity model (Phase 1) is specified in `docs/API.md`.

## Data flow (as specified, Phase 4)

```
Exchange WS/REST → MarketGateway → validation → normalization → in-memory state
   → engines → agents → consensus → ARES → execution validator → paper ledger
   → UI (WebSocket-driven, no page refresh)
```

Redis in the shared build is replaced by the browser runtime state layer; this is
displayed honestly in the System Health panel (`N/A (static)`).
