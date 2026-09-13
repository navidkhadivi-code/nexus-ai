# AI AGENTS

Eight agents consume the deterministic engines and emit the Phase-14 JSON contract.
**Agents never invent raw market values** — every number traces to an engine output on
real exchange data. Model version is stamped on every output (`nexus-rules-v1.0`) and
stored with signals (Phase 48).

| Agent | Role | Inputs | Method |
|---|---|---|---|
| NOVA | Market structure | swings, BOS/CHOCH, regime | structure engine scoring |
| ORION | Price action | candles, RSI, MACD, EMAs | pattern + momentum rules |
| LUMA | Order flow | trades tape, book, CVD | delta/absorption/exhaustion (spoof = "POSSIBLE" only) |
| ATLAS | Liquidity | EQH/EQL, sweeps, OB, FVG, POC, book walls | sweep-probability language, never guarantees |
| GANN | Price/time | gann angles, square-of-9, cycles, fib | confluence zones with touch strength |
| MACRO | Macro/sentiment | mcap, BTC.D, fear&greed, funding | risk-tilt score; DXY/SPX/NDX/GOLD shown DATA UNAVAILABLE (no licensed feed on shared host) |
| QUANT | Statistics | vol, z-score, expectancy, P(up) | **pure math — no LLM anywhere** (Phase 11 requirement) |
| ARES | Risk manager | everything + account | **veto only — never predicts direction** |

LLM layer (Phase 47): an `AIProvider` abstraction is planned for the VPS build (OpenAI /
Anthropic / local). It is deliberately absent in this deployment so that no signal on
ai.ipeset.com can ever be text-generated — all outputs are reproducible math.

## Consensus + NO TRADE + performance

Weighted vote → entry/SL/targets from real levels (equal highs/lows, S/R, POC, ATR floors)
→ NO-TRADE gate. Every published signal stores the 7 agent directions; when the signal
closes (TP/STOP) each agent's prediction is scored — accuracy + sample size appear on the
AI screen (Phase 49). Accuracy shown as `—` until real outcomes exist.
