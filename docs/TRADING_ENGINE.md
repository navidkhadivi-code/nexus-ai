# TRADING ENGINE

## Signal pipeline (enforced order)

```
agents (7 predictive) → weighted consensus → NO-TRADE gate → ARES veto →
execution validator (paper) → paper ledger → journal
```

AI never touches orders directly. `openPaperTrade()` returns rejected unless
`consensus.noTrade === false && ares.allowed === true`.

## Consensus (Phase 15) — weights

NOVA 15% · ORION 15% · LUMA 20% · ATLAS 15% · GANN 5% · MACRO 10% · QUANT 20%.
Directional score = Σ(w·signed-confidence)/Σw. |score|<18 ⇒ NEUTRAL. Agreement must
be ≥55% of directional agents. ARES is separate (veto, not vote).

## NO TRADE (Phase 16) — triggers

stale data · direction split · confidence <45% · agreement <55% · R/R <1.3 ·
vol ann >240% · regime HIGH_VOLATILITY/CAPITULATION · missing levels.

## Risk (Phase 19) — math, not vibes

- Size: `qty = (balance × risk%) / |entry − stop|` (test-verified: $10k×0.5% ÷ $1000 = 0.05).
- Caps enforced by ARES checks (each visible in UI): DATA_FRESHNESS · CONFIDENCE ·
  R_R_MINIMUM · POSITION_SIZE · DAILY_LOSS_LIMIT · EXPOSURE_LIMIT · LEVERAGE_CAP ·
  VOLATILITY · FUNDING_EXTREME · STOP_VALID · DIRECTION_REQUIRED.

## Paper trading (Phase 20) — realistic execution

LONG entry fills at **real ask + 3 bps slippage**, exits at **real bid − 3 bps**; SHORT
mirrored. Taker fee 10 bps both sides, charged to cash. SL/TP evaluated on live quotes
each tick (never on fabricated closes). Margin model: 5× cap, usedMargin tracked.
Duplicate-order guard rejects same-side fills within 500 ms (Phase 28). Kill switch
closes all open paper positions at live quotes.

## Backtesting (Phase 22) — event-driven, no look-ahead

- Structure recomputed every 10 bars on `candles[0..i]` only.
- Signal at bar close → fill at **next bar open** ± slippage → SL/TP checked against
  subsequent bars' real high/low. Fees both sides.
- Metrics: NetProfit, ROI, WinRate, PF, Expectancy, AvgR, Sharpe, Sortino, MaxDD,
  trade count, win/lose streaks.
- **Monte Carlo** (2000 resamples): P5/25/50/75/95 terminal equity, P(ruin@25%),
  P(negative), median MaxDD.
- **Walk-Forward** (Phase 23): optimize stop/target on in-sample windows only,
  score exclusively on the untouched out-of-sample window.

## Live trading (Phase 26-28) — roadmap only

Disabled. VPS path requires: encrypted exchange accounts, READ+TRADE keys (withdraw
blocked), ExecutionValidator (balance, tick/lot size, min notional, leverage, exchange
status), idempotency keys, order-status verification before any resubmission after
timeout, and per-user LIVE_TRADE permission + 2FA + explicit warning.
