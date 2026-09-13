# Persian Trade — Institutional Crypto Intelligence Terminal

> Real market data · deterministic quant engines · 8-agent consensus · ARES risk veto ·
> paper trading on live bid/ask · event-driven backtesting · English + فارسی (RTL)

**Live:** https://ai.ipeset.com

## What this is (and is NOT)

- **IS**: a working trading-intelligence terminal. All prices, candles, order books,
  trades come from REAL public exchange APIs (Binance / Bybit / OKX) over REST + WebSocket.
  All indicators, structure, liquidity, order-flow, Gann and quant values are computed
  deterministically from that real data.
- **IS NOT**: a guaranteed-profit machine. It never fabricates signals, P&L, win rates or
  AI accuracy. `NO TRADE` is a first-class state. Live trading is **disabled by default**
  and not enabled on this deployment.

## Architecture (this deployment)

`ai.ipeset.com` runs on shared cPanel hosting → the app is a **fully static SPA**:

```
Browser
  ├── Vite/React/TS bundle (nexus.js)  — terminal UI, state (zustand)
  ├── Market Gateway                   — WebSocket + REST adapters (Binance/Bybit/OKX)
  │     data → validation → staleness → orderflow engine → analysis engines
  ├── Engines (deterministic, TypeScript)
  │     indicators · structure · liquidity · orderflow · gann · quant · macro
  ├── AI Agent layer (NOVA ORION LUMA ATLAS GANN MACRO QUANT) → weighted consensus
  ├── ARES risk manager (VETO) → NO-TRADE gate → execution validator
  ├── Paper trading (fills at real bid/ask + spread + slippage + taker fees)
  ├── Backtester / Monte Carlo / Walk-Forward (event-driven, no look-ahead)
  └── Persistence: localStorage (paper account, settings) — no server DB on shared host
```

The repo also contains the `docker-compose` / Postgres / Redis / NestJS **roadmap layout**
for the VPS build (see `docs/ARCHITECTURE.md`). The shared host physically cannot run
persistent Node/Postgres/Redis processes — this is documented honestly, not faked.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle → dist/
npm test           # 41 deterministic engine tests
```

## Deploy to cPanel (this site)

```bash
npm run build
# upload dist/index.html, dist/nexus.js, dist/nexus.css, dist/.htaccess
# to /home3/<user>/ai.ipeset.com/  (FTP works with cPanel credentials)
```

## Data sources & transparency

- **BINANCE** — spot: data-api.binance.vision + stream.binance.com WS; funding/OI: fapi.
- **BYBIT** — v5 public spot REST + spot WS; funding from linear perp ticker (labeled).
- **OKX** — v5 public spot REST + WS.
- **CoinGecko** (global mcap, BTC dominance), **alternative.me** (Fear & Greed) for macro.
- Any source that fails → `DATA UNAVAILABLE` shown in UI. Stale WS (>15s) → `STALE MARKET
  DATA` and **new signals stop**.

## Honesty rules enforced in code

- No mock data in production paths. `SIMULATION` is visible for anything non-real.
- Signals store model/agent version + data source + timestamps (Phase 48/49 tracking).
- Paper fills never use candle-close approximation: real bid/ask ± slippage, taker fee 10 bps.
- ARES veto cannot be bypassed — `openPaperTrade()` refuses unless ARES allows.
- Kill switch: stop new trades + cancel/close positions (audit-logged in journal/orders).
- Live trading: not wired to any order endpoint; activation requires the VPS execution
  service (see `docs/SECURITY.md`). Withdrawal permission is never requested anywhere.

## Docs

`docs/ARCHITECTURE.md` · `docs/API.md` · `docs/SECURITY.md` · `docs/TRADING_ENGINE.md` · `docs/AI_AGENTS.md`

## License / disclaimer

Educational and analytical software. Trading cryptocurrencies involves substantial risk of
loss. Nothing here is financial advice; nothing here guarantees profit.
