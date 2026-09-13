# SECURITY

## Implemented (deployed build)

- **Zero secrets.** The app uses only public market-data endpoints. No API keys exist
  anywhere in code, storage, or logs. Withdrawal permission is never requested (verified
  by test: no `withdraw` reference in order engines).
- **CSP / headers** (`public/.htaccess`): script/style/font/connect whitelists,
  `nosniff`, `X-Frame-Options SAMEORIGIN`, strict referrer policy. `connect-src` allows
  only the exchange/macro hosts used.
- **Input surface:** symbol list is a fixed allowlist in UI (`BTCUSDT`…); all exchange
  payloads are parsed defensively (try/catch, type coercion checks, no eval).
- **Live trading disabled by default** — no execution code path to an exchange exists in
  this build; the UI shows `LIVE TRADING: DISABLED` with activation requirements.
- **Kill switch** requires explicit confirmation and closes only PAPER positions.
- **No fabricated data**: failed feeds display `DATA UNAVAILABLE` / `STALE MARKET DATA`.

## VPS roadmap requirements (Phase 26/41/44)

- JWT access + refresh rotation, bcrypt/argon2 hashes, TOTP 2FA, RBAC
  (SUPER_ADMIN/ADMIN/ANALYST/TRADER/VIEWER) with granular permissions.
- Exchange credentials encrypted AES-256-GCM with KMS-held data keys; plaintext secrets
  never logged; `.gitignore`/CI secret-scanning blocks `.env`.
- Rate limiting, CSRF on cookie flows, parameterized Prisma queries (SQL-injection safe),
  withdrawal-capable keys rejected by policy, order placement behind Execution Validator:
  AI → Consensus → Risk → ExecutionValidator → OrderManager → Adapter → Exchange.
- Critical regression tests: ARES bypass impossible · live disabled by default ·
  duplicate order after timeout requires status verification first.
