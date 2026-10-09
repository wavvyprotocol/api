import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { serve } from "@hono/node-server";
import { drizzle } from "drizzle-orm/pglite";
import { createApp } from "../src/app.ts";
import { createPrivyVerifier } from "../src/auth.ts";
import { createChainReader } from "../src/chain/reader.ts";
import type { Database } from "../src/db/client.ts";
import { parseEnv } from "../src/env.ts";
import { createLogger } from "../src/log.ts";
import { createRateLimiter } from "../src/rate-limit.ts";
import * as schema from "../src/db/schema.ts";
import { applyMigrations } from "../test/helpers.ts";
import { ensureUser, seedContractData } from "./lib/contract-data.ts";

const env = parseEnv(process.env);
const log = createLogger({ level: process.env.LOG_LEVEL ?? "info" });

const pglite = new PGlite();
await applyMigrations(pglite, "up");
const db = drizzle(pglite, { schema }) as unknown as Database;
await seedContractData(db, log);

const chain = createChainReader(env, log);
const verify = createPrivyVerifier(env, log);
const limiter = createRateLimiter({}, log);
const signState = env.FRAME_SIGNING_SECRET
  ? (payload: string): string => createHmac("sha256", env.FRAME_SIGNING_SECRET as string).update(payload).digest("hex")
  : undefined;

const app = createApp({
  db,
  chain,
  log,
  ...(verify ? { verify } : {}),
  ensureUser: (user) => ensureUser(db, user),
  limiter,
  ...(signState ? { signState } : {}),
  ...(env.VERIFY_ADMIN_TOKEN ? { verifyAdminToken: env.VERIFY_ADMIN_TOKEN } : {}),
  ...(env.WAVVY_CREATOR_REWARDS_ADDRESS
    ? { claimTarget: env.WAVVY_CREATOR_REWARDS_ADDRESS as `0x${string}` }
    : {}),
  chainId: env.MONAD_CHAIN_ID,
});

const port = Number(process.env.CONTRACT_PORT ?? 8787);
const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
server.on("listening", () => {
  log.success("contract server listening", { port });
});
server.on("error", (error: NodeJS.ErrnoException) => {
  log.error("contract server failed", { code: error.code, cause: error.message });
  process.exitCode = 1;
});

const shutdown = (): void => {
  server.close(() => {
    void pglite.close().then(() => process.exit(0));
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);