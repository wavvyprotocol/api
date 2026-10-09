import { createHmac } from "node:crypto";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createPrivyVerifier } from "./auth.ts";
import { createChainReader } from "./chain/reader.ts";
import { connect } from "./db/client.ts";
import { ensureUser } from "./db/queries.ts";
import { capabilities, parseEnv } from "./env.ts";
import { createLogger } from "./log.ts";
import { createRateLimiter } from "./rate-limit.ts";

const env = parseEnv(process.env);
const log = createLogger({ level: env.LOG_LEVEL ?? (env.DEBUG_LOGS === "true" ? "debug" : undefined) });

const report = capabilities(env);
log.info("wavvy-api starting", { nodeEnv: env.NODE_ENV, capabilities: report });
if (!report.database) {
  log.warn("DATABASE_URL is unset: endpoints that need persistence answer 503");
}
if (!report.privy) {
  log.warn("PRIVY_APP_ID/PRIVY_APP_SECRET are unset: write endpoints answer 503");
}
if (!report.rateLimitStore) {
  log.warn("Upstash is unset: rate limiting falls back to per-process memory");
}

const database = env.DATABASE_URL ? connect(env, log) : undefined;
const chain = createChainReader(env, log);
const verify = createPrivyVerifier(env, log);
const limiter = createRateLimiter(env, log);
const signState = env.FRAME_SIGNING_SECRET
  ? (payload: string): string => createHmac("sha256", env.FRAME_SIGNING_SECRET as string).update(payload).digest("hex")
  : undefined;

const app = createApp({
  ...(database ? { db: database.db } : {}),
  chain,
  log,
  ...(verify ? { verify } : {}),
  ...(database ? { ensureUser: (user) => ensureUser(database.db, user) } : {}),
  limiter,
  ...(signState ? { signState } : {}),
  ...(env.VERIFY_ADMIN_TOKEN ? { verifyAdminToken: env.VERIFY_ADMIN_TOKEN } : {}),
  ...(env.WAVVY_CREATOR_REWARDS_ADDRESS
    ? { claimTarget: env.WAVVY_CREATOR_REWARDS_ADDRESS as `0x${string}` }
    : {}),
  chainId: env.MONAD_CHAIN_ID,
  ...(env.PUBLIC_APP_URL ? { publicAppUrl: env.PUBLIC_APP_URL } : {}),
});

// Loopback by default; public exposure belongs behind TLS termination.
const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST });

server.on("listening", () => {
  log.success("wavvy-api listening", { port: env.PORT, bind: env.HOST });
});

server.on("error", (error: NodeJS.ErrnoException) => {
  log.error("wavvy-api failed to start", { port: env.PORT, bind: env.HOST, code: error.code, cause: error.message });
  process.exitCode = 1;
});

let stopping = false;
const shutdown = (signal: string): void => {
  if (stopping) {
    return;
  }
  stopping = true;
  log.info("wavvy-api stopping", { signal });
  server.close(() => {
    void (async () => {
      await database?.close();
      log.success("wavvy-api stopped");
      process.exit(0);
    })();
  });
  (server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));