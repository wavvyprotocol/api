import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { AuthVerifier } from "../src/auth.ts";
import { createApp, type AppDeps } from "../src/app.ts";
import type {
  ChainPosition,
  ChainReader,
  MarketInfo,
  OracleStatus,
  OracleStatusBatchEntry,
  StakeVerification,
} from "../src/chain/reader.ts";
import type { Database } from "../src/db/client.ts";
import { ensureUser } from "../src/db/queries.ts";
import * as schema from "../src/db/schema.ts";
import { createLogger, type Logger } from "../src/log.ts";
import { createRateLimiter, type RateLimiter } from "../src/rate-limit.ts";

export const NOW = new Date("2026-10-06T12:00:00.000Z");

export function silentLogger(): Logger {
  const noop = (): void => {};
  return { error: noop, warn: noop, success: noop, info: noop, debug: noop };
}

function migrationFiles(direction: "up" | "down"): string[] {
  const files = readdirSync("drizzle")
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => (direction === "up" ? !name.endsWith(".down.sql") : name.endsWith(".down.sql")))
    .sort();
  return direction === "up" ? files : files.reverse();
}

/// Applies the SQL that drizzle-kit generated, statement by statement.
export async function applyMigrations(pglite: PGlite, direction: "up" | "down"): Promise<void> {
  for (const file of migrationFiles(direction)) {
    const contents = readFileSync(`drizzle/${file}`, "utf8");
    for (const statement of contents.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        await pglite.exec(trimmed);
      }
    }
  }
}

export async function testDb(): Promise<{ db: Database; pglite: PGlite }> {
  const pglite = new PGlite();
  await applyMigrations(pglite, "up");
  // PGlite and postgres-js expose the same drizzle query surface (drizzle-orm
  // core over the pg dialect); only the driver result HKT differs, so the
  // cast is confined to the test harness and production keeps postgres-js.
  return { db: drizzle(pglite, { schema }) as unknown as Database, pglite };
}

type FakeChainOptions = {
  markets?: Record<number, Partial<MarketInfo> & { exists?: boolean }>;
  oracle?: Record<string, Partial<OracleStatus>>;
  positions?: Record<string, ChainPosition | null>;
  creators?: Record<string, { wallet: `0x${string}`; pendingWallet?: `0x${string}`; balance: bigint; lastAccrualAt?: number }>;
  twaps?: Record<string, bigint | null>;
  stakes?: Record<string, StakeVerification>;
  markPrice?: bigint;
  fundingGrowth?: bigint;
};

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/// In-memory chain: no network, deterministic values, per-test overrides.
export function fakeChain(options: FakeChainOptions = {}): ChainReader {
  const marketDefaults = {
    exists: true,
    type: "single_name" as const,
    metricId: `0x${"11".repeat(32)}` as `0x${string}`,
    creatorIds: [`0x${"22".repeat(32)}` as `0x${string}`],
    markPrice: options.markPrice ?? 1_000_000_000_000_000_000n,
    fundingGrowth: options.fundingGrowth ?? 0n,
    openInterestLong: 5_000_000_000_000_000_000n,
    openInterestShort: 2_000_000_000_000_000_000n,
  };

  const chain: ChainReader = {
    async marketInfo(marketId: number): Promise<MarketInfo> {
      const override = options.markets?.[marketId];
      if (override?.exists === false) {
        return { marketId, exists: false, type: "unknown", metricId: null, creatorIds: [], markPrice: null, fundingGrowth: 0n, openInterestLong: 0n, openInterestShort: 0n };
      }
      return { marketId, ...marketDefaults, ...override, exists: true } as MarketInfo;
    },
    async marketInfoBatch(marketIds: readonly number[]): Promise<Map<number, MarketInfo>> {
      const result = new Map<number, MarketInfo>();
      for (const marketId of new Set(marketIds)) {
        result.set(marketId, await chain.marketInfo(marketId));
      }
      return result;
    },
    async oracleStatusBatch(
      metricIds: readonly `0x${string}`[],
    ): Promise<Map<`0x${string}`, OracleStatusBatchEntry>> {
      const result = new Map<`0x${string}`, OracleStatusBatchEntry>();
      for (const metricId of new Set(metricIds)) {
        const status = await chain.oracleStatus(metricId);
        result.set(metricId, { ...status, twap24h: options.twaps?.[metricId] ?? 500_000_000n });
      }
      return result;
    },
    async oracleStatus(metricId: `0x${string}`): Promise<OracleStatus> {
      const override = options.oracle?.[metricId] ?? {};
      const registered = override.registered ?? true;
      const fresh = override.fresh ?? true;
      const suspended = override.suspended ?? false;
      const frozen = override.frozen ?? false;
      const state = !registered ? "not_registered" : frozen ? "frozen" : suspended ? "suspended" : fresh ? "fresh" : "stale";
      return {
        metricId,
        value: override.value ?? 520_000_000n,
        twap: override.twap ?? 500_000_000n,
        lastUpdateAt: override.lastUpdateAt ?? Math.floor(NOW.getTime() / 1000) - 60,
        fresh,
        suspended,
        frozen,
        registered,
        state,
      };
    },
    async indexValue(marketId: number) {
      return { value: 1_050_000_000_000_000_000n, valid: marketId === 100 };
    },
    async twap(metricId: `0x${string}`) {
      return options.twaps?.[metricId] ?? 500_000_000n;
    },
    async position(tokenId: string) {
      if (tokenId in (options.positions ?? {})) {
        return options.positions?.[tokenId] ?? null;
      }
      return {
        tokenId,
        marketId: 6,
        isLong: true,
        size: 10_000_000_000_000_000_000n,
        entryPrice: 1_000_000_000_000_000_000n,
        margin: 2_000_000_000_000_000_000n,
        lastFundingGrowth: 0n,
        openedAt: Math.floor(NOW.getTime() / 1000) - 3600,
        callId: "0",
        owner: `0x${"ab".repeat(20)}`,
      };
    },
    async creatorEscrow(creatorId: `0x${string}`) {
      return options.creators?.[creatorId]?.balance ?? 0n;
    },
    async creatorInfo(creatorId: `0x${string}`) {
      const entry = options.creators?.[creatorId];
      return {
        wallet: entry?.wallet ?? ZERO,
        pendingWallet: entry?.pendingWallet ?? ZERO,
        balance: entry?.balance ?? 0n,
        lastAccrualAt: entry?.lastAccrualAt ?? 0,
      };
    },
    async curatorClaimable() {
      return 0n;
    },
    async latestBlockNumber() {
      return 68_600_000;
    },
    async verifyStake(args) {
      const override = options.stakes?.[args.txHash];
      if (override) {
        return override;
      }
      return { status: "verified", callId: "7", stake: args.stakeAmount };
    },
  };

  return chain;
}

export type TestAppOptions = {
  db?: Database;
  chain?: ChainReader;
  verify?: AuthVerifier;
  limiter?: RateLimiter;
  signState?: (payload: string) => string;
  verifyAdminToken?: string;
  claimTarget?: `0x${string}`;
};

export function buildApp(options: TestAppOptions = {}) {
  const log = silentLogger();
  const deps: AppDeps = {
    ...(options.db ? { db: options.db } : {}),
    chain: options.chain ?? fakeChain(),
    log,
    limiter: options.limiter ?? createRateLimiter({}, log),
    now: () => NOW,
    ...(options.verify ? { verify: options.verify } : {}),
    ...(options.db ? { ensureUser: (user) => ensureUser(options.db as Database, user) } : {}),
    ...(options.signState ? { signState: options.signState } : {}),
    ...(options.verifyAdminToken ? { verifyAdminToken: options.verifyAdminToken } : {}),
    ...(options.claimTarget ? { claimTarget: options.claimTarget } : {}),
  };
  return createApp(deps);
}

export const TEST_USER = {
  privyUserId: "did:privy:test-user",
  walletAddress: `0x${"ab".repeat(20)}` as `0x${string}`,
};

export const OTHER_USER = {
  privyUserId: "did:privy:other-user",
  walletAddress: `0x${"cd".repeat(20)}` as `0x${string}`,
};

export const authVerifierFor = (user: { privyUserId: string; walletAddress?: `0x${string}` }): AuthVerifier => {
  return async (token: string) => {
    if (token !== "good-token") {
      throw new Error("bad token");
    }
    return user;
  };
};

export function jsonHeaders(): Record<string, string> {
  return { "content-type": "application/json" };
}

export function authHeaders(token = "good-token"): Record<string, string> {
  return { ...jsonHeaders(), authorization: `Bearer ${token}` };
}

export async function seedMarket(
  db: Database,
  values: { id: number; type?: "single_name" | "index"; metricId?: string; status?: "active" | "paused" | "closed" },
): Promise<void> {
  await db.insert(schema.markets).values({
    id: values.id,
    type: values.type ?? "single_name",
    metricId: values.metricId ?? `0x${"11".repeat(32)}`,
    creatorIds: [],
    status: values.status ?? "active",
  });
}

export async function seedPosition(
  db: Database,
  values: {
    tokenId: string;
    marketId: number;
    owner?: string;
    status?: "open" | "closed" | "liquidated";
    realizedPnl?: string;
    closedAt?: Date;
  },
): Promise<void> {
  await db.insert(schema.positions).values({
    tokenId: values.tokenId,
    marketId: values.marketId,
    ownerAddress: (values.owner ?? TEST_USER.walletAddress ?? "").toLowerCase(),
    side: "long",
    leverage: "5",
    margin: "2000000000000000000",
    entryPrice: "1000000000000000000",
    openedAt: new Date(NOW.getTime() - 3600_000),
    status: values.status ?? "open",
    ...(values.realizedPnl ? { realizedPnl: values.realizedPnl } : {}),
    ...(values.closedAt ? { closedAt: values.closedAt } : {}),
  });
}

export async function seedFeedPost(db: Database, positionTokenId: string, thesis: string, createdAt?: Date): Promise<void> {
  await db.insert(schema.feedPosts).values({ positionTokenId, thesis, ...(createdAt ? { createdAt } : {}) });
}

export { schema };