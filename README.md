# Wavvy APIs

Primary HTTP API for Wavvy: markets, positions, the positions-as-posts feed, portfolio, leaderboards, creator claims, and curator calls.

Hono and TypeScript strict, Drizzle ORM over Postgres, Zod on every input. Privy auth on all write endpoints.

## Toolchain

- Node.js v24.21.0, npm 11.19.0
- Hono 4, Drizzle ORM 0.45, Zod 4, viem 2, pino 10

## Install and run

```bash
npm install
cp .env.example .env        # fill in real values
npm run db:migrate          # apply migrations (drizzle/)
npm run dev                 # tsx watch, loops back by default
```

| Script | Purpose |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | endpoint, auth, rate-limit, and migration tests (in-process PGlite, no external services) |
| `npm run test:contract` | newman against `postman/wavvy-api.json` (start `npm run contract:server` first) |
| `npm run contract:server` | boots the API with in-process Postgres and live Monad RPC reads for the contract suite |
| `npm run db:generate` | generate a new migration from `src/db/schema.ts` |
| `npm run db:migrate` | apply pending migrations; `npm run db:migrate -- down` rolls the newest back |
| `npm start` | run once, no watch (production entry) |

## Endpoints, auth, and rate limits

Rates are per client address per rolling minute, and the write and claim tiers
also carry a second bucket keyed by the authenticated Privy user (20 writes and
3 claims per minute), because `x-forwarded-for` is spoofable on its own. Reads
are public; writes need a Privy access token (`Authorization: Bearer <token>`).
Without `PRIVY_APP_ID`/`PRIVY_APP_SECRET` every write endpoint answers 503, so
a half-configured deployment cannot accept unverified writes. Bodies are capped
at 32 KB before parsing (413 above that).

| Method | Path | Auth | Rate limit | Notes |
| --- | --- | --- | --- | --- |
| GET | `/health` | public | read | capability flags: database, Upstash, Privy, frames |
| GET | `/markets` | public | read (120/min) | mark price, 24h metric change (oracle TWAP), oracle state |
| GET | `/markets/:id` | public | read | index value, oracle fresh/stale/suspended/frozen, open interest, funding |
| GET | `/positions` | public | read | chain + indexer merged; filters: owner, marketId, status, limit |
| GET | `/positions/:tokenId` | public | read | live PnL, equity, funding cost from chain math |
| GET | `/feed` | public | read | ranked cards: recency, staked calls, reputation, engagement |
| POST | `/feed/:id/thesis` | Privy | write (30/min) | author only, 280-char cap |
| POST | `/feed/:id/react` | Privy | write | `kind`: like, wavvy; idempotent per user |
| POST | `/feed/:id/reply` | Privy | write | one level, 1-280 chars |
| GET | `/portfolio/:wallet` | public | read | open positions, history, 30-day PnL series, totals |
| GET | `/leaderboard` | public | read | traders and curators with reputation and sample size |
| GET | `/creators/unclaimed` | public | read | escrow balance read from the contract, accrued from the indexer |
| POST | `/creator/verify` | Privy | write | state machine: challenge issued, then proof submitted |
| POST | `/creator/verify/approve` | admin token | claim (5/min) | manual path for large accounts; disabled without `VERIFY_ADMIN_TOKEN` |
| POST | `/creator/claim` | Privy | claim | prepares the unsigned claim tx; only the linked wallet can send it |
| GET | `/curators` | public | read | calls with stake, target trader, curator reputation, copier count |
| POST | `/curators/calls` | Privy | write + user 20/min | the stake transaction is read back and verified (success, target contract, sender, market, amount); unverified calls are rejected, unmined ones stay `pending` and add no feed boost |
| POST | `/frames/position/:id` | public | read | Farcaster frame HTML with HMAC-signed state (5 minute expiry) |

Every error uses one shape: `{ "error": { "code", "message", "requestId" } }`
with codes `invalid_request`, `unauthorized`, `forbidden`, `not_found`,
`conflict`, `rate_limited`, `unavailable`, `internal_error`. Every response
carries `x-request-id`; every 5xx logs at Error with that id.

Auth rejection drill, recorded on 2026-10-08 against the contract server:

| Request | Result |
| --- | --- |
| `POST /feed/1/reply` with no token, Privy configured | `401 {"error":{"code":"unauthorized","message":"a Privy access token is required","requestId":"..."}}` |
| same with `Authorization: Bearer not-a-privy-token` | `401 {"error":{"code":"unauthorized","message":"the access token is invalid or expired",...}}` |
| same with no Privy configured | `503 {"error":{"code":"unavailable","message":"authentication is not configured on this deployment"}}` |
| `GET /leaderboard` (public read) | `200` |
| `GET /markets/abc` | `400 {"error":{"code":"invalid_request","message":"id: market id must be a number"}}` |

Every response carries `x-request-id` and `x-ratelimit-*` headers.

## Database

Drizzle schema in `src/db/schema.ts`, migrations in `drizzle/`. Tables: `users`,
`wallets`, `markets`, `positions`, `feed_posts`, `reactions`, `replies`,
`creators`, `creator_accruals`, `curator_calls`, `copies`, `trader_stats`,
`curator_stats`, `indexer_state`. The indexer (Phase 4) is the only writer for
`positions`, `trader_stats`, `curator_stats`, `creator_accruals`, and
`indexer_state`; the API writes `users`, `wallets`, `feed_posts`, `reactions`,
`replies`, `curator_calls`, `copies`, and the creator verification columns.

Amounts are WAD (1e18) decimal strings end to end, never floats. PnL, equity,
and funding mirror the contract math in `WavvyHouse` (see `src/math.ts`).

## Environment variables

Copy `.env.example` to `.env` and fill in real values.

| Variable | Purpose |
| --- | --- |
| `PORT`, `HOST` | listen port and bind address (loopback by default) |
| `NODE_ENV`, `LOG_LEVEL`, `DEBUG_LOGS` | runtime mode and pino level |
| `DATABASE_URL` | Supabase Postgres pooler connection string (port 6543) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | rate limiting; unset falls back to per-process memory |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Privy token verification; unset disables writes with 503 |
| `MONAD_TESTNET_RPC_URL`, `MONAD_CHAIN_ID` | chain reads |
| `MULTICALL3_ADDRESS` | batched view reads (canonical multicall3 by default; falls back to single reads) |
| `CHAIN_CACHE_TTL_MS` | per-process chain read cache, default 5000 |
| `WAVVY_ORACLE_ADDRESS`, `WAVVY_INDEX_ORACLE_ADDRESS`, `WAVVY_AMM_ADDRESS`, `WAVVY_FACTORY_ADDRESS`, `WAVVY_POSITION_ADDRESS`, `WAVVY_CREATOR_REWARDS_ADDRESS`, `WAVVY_CURATOR_ADDRESS` | deployed contracts, from `wavvy-contracts/deployments/monadTestnet.json` |
| `VERIFY_ADMIN_TOKEN` | manual creator verification; unset disables the approve endpoint |
| `FRAME_SIGNING_SECRET` | HMAC key for frame state; unset disables frames |
| `PUBLIC_APP_URL` | links and frame image URLs |

## Contract suite (Postman + newman)

`postman/wavvy-api.json` covers every endpoint: public reads, validation,
auth-rejection, and authenticated writes. The headless run asserts the read and
rejection paths so it needs no credentials; set `privyToken` to a real Privy
token to exercise the happy paths by hand.

```bash
npm run contract:server      # terminal 1: in-process Postgres, live chain reads
npm run test:contract       # terminal 2: 28 requests, 56 assertions
```