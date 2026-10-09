import type { MiddlewareHandler } from "hono";
import type { Context } from "hono";
import { errorBody, unavailable } from "../errors.ts";
import type { AppEnv } from "../types.ts";
import type { ChainReader } from "../chain/reader.ts";
import type { Database } from "../db/client.ts";
import type { Logger } from "../log.ts";

export type RouteDeps = {
  db?: Database;
  chain: ChainReader;
  log: Logger;
  auth: MiddlewareHandler<AppEnv>;
  limits: { read: MiddlewareHandler<AppEnv>; write: MiddlewareHandler<AppEnv>; claim: MiddlewareHandler<AppEnv> };
  userLimits: { write: MiddlewareHandler<AppEnv>; claim: MiddlewareHandler<AppEnv> };
  signState?: (payload: string) => string;
  now?: () => Date;
  publicAppUrl?: string;
  verifyAdminToken?: string;
  buildClaimTransaction?: (creatorId: `0x${string}`) => { to: string; data: string; value: string; chainId: number } | null;
};

export function requireDb(deps: RouteDeps): Database {
  if (!deps.db) {
    throw unavailable("database is not configured on this deployment");
  }
  return deps.db;
}

export const DEFAULT_APP_URL = "https://wavvy-metropolis.vercel.app";

type ValidationError = {
  issues: Array<{ path: Array<string | number | symbol>; message: string }>;
};

export function invalidRequestHook(
  result: { success: boolean; error?: ValidationError },
  c: Context,
): Response | undefined {
  if (result.success) {
    return undefined;
  }
  const message = (result.error?.issues ?? [])
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  return c.json(errorBody("invalid_request", message || "invalid request", c.get("requestId")), 400);
}

export function asMetricId(value: string | null | undefined): `0x${string}` | null {
  if (value && /^0x[0-9a-fA-F]{64}$/.test(value)) {
    return value as `0x${string}`;
  }
  return null;
}