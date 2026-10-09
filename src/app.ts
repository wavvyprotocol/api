import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { encodeFunctionData } from "viem";
import type { AuthVerifier } from "./auth.ts";
import { requireAuth } from "./auth.ts";
import type { AppEnv } from "./types.ts";
import type { ChainReader } from "./chain/reader.ts";
import type { Database } from "./db/client.ts";
import { errorBody, respondWithError } from "./errors.ts";
import { logger as defaultLogger, type Logger } from "./log.ts";
import {
  CLAIM_POLICY,
  READ_POLICY,
  USER_CLAIM_POLICY,
  USER_WRITE_POLICY,
  WRITE_POLICY,
  createRateLimiter,
  rateLimit,
  rateLimitUser,
  type RateLimiter,
} from "./rate-limit.ts";
import { feedRoutes } from "./routes/feed.ts";
import { framesRoutes } from "./routes/frames.ts";
import { marketsRoutes } from "./routes/markets.ts";
import { portfolioRoutes } from "./routes/portfolio.ts";
import { positionsRoutes } from "./routes/positions.ts";
import { socialRoutes } from "./routes/social.ts";
import type { RouteDeps } from "./routes/deps.ts";

const claimAbi = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "creatorId", type: "bytes32" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
] as const;

export type AppDeps = {
  db?: Database;
  chain: ChainReader;
  log?: Logger;
  verify?: AuthVerifier;
  ensureUser?: (user: { privyUserId: string; walletAddress?: `0x${string}` }) => Promise<unknown>;
  limiter?: RateLimiter;
  signState?: (payload: string) => string;
  verifyAdminToken?: string;
  claimTarget?: `0x${string}`;
  chainId?: number;
  now?: () => Date;
  publicAppUrl?: string;
};

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const log = deps.log ?? defaultLogger;
  const limiter = deps.limiter ?? createRateLimiter({}, log);
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const started = Date.now();
    await next();
    log.debug("request served", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  });

  app.use(
    "*",
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) =>
        c.json(
          errorBody("invalid_request", "request body exceeds 32 KB", c.get("requestId")),
          413 as never,
        ),
    }),
  );

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "wavvy-api",
      database: deps.db !== undefined,
      rateLimitBackend: limiter.backend,
      authConfigured: deps.verify !== undefined,
      framesConfigured: deps.signState !== undefined,
    }),
  );

  const auth = requireAuth({ logger: log, verify: deps.verify, ensureUser: deps.ensureUser });
  const limits = {
    read: rateLimit(limiter, READ_POLICY),
    write: rateLimit(limiter, WRITE_POLICY),
    claim: rateLimit(limiter, CLAIM_POLICY),
  };
  const userLimits = {
    write: rateLimitUser(limiter, USER_WRITE_POLICY),
    claim: rateLimitUser(limiter, USER_CLAIM_POLICY),
  };

  const routeDeps: RouteDeps = {
    ...(deps.db ? { db: deps.db } : {}),
    chain: deps.chain,
    log,
    auth,
    limits,
    userLimits,
    ...(deps.signState ? { signState: deps.signState } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.publicAppUrl ? { publicAppUrl: deps.publicAppUrl } : {}),
    ...(deps.verifyAdminToken ? { verifyAdminToken: deps.verifyAdminToken } : {}),
    ...(deps.claimTarget
      ? {
          buildClaimTransaction: (creatorId: `0x${string}`) => ({
            to: deps.claimTarget as string,
            data: encodeFunctionData({ abi: claimAbi, functionName: "claim", args: [creatorId] }),
            value: "0",
            chainId: deps.chainId ?? 10143,
          }),
        }
      : {}),
  };

  app.route("/markets", marketsRoutes(routeDeps));
  app.route("/positions", positionsRoutes(routeDeps));
  app.route("/feed", feedRoutes(routeDeps));
  app.route("/portfolio", portfolioRoutes(routeDeps));
  app.route("/", socialRoutes(routeDeps));
  app.route("/frames", framesRoutes(routeDeps));

  app.notFound((c) => c.json(errorBody("not_found", "route not found", c.get("requestId")), 404));

  app.onError((error, c) => {
    const requestId = c.get("requestId");
    if (error instanceof Error && (error as { status?: number }).status === 503) {
      log.error("request failed", { requestId, path: c.req.path, cause: error.message });
      return c.json(errorBody("unavailable", error.message, requestId), 503);
    }
    return respondWithError(c, error, log);
  });

  return app;
}