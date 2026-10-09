import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./types.ts";
import { errorBody } from "./errors.ts";
import type { Logger } from "./log.ts";

export type RatePolicy = {
  name: string;
  limit: number;
  windowSeconds: number;
};

export const READ_POLICY: RatePolicy = { name: "read", limit: 120, windowSeconds: 60 };
export const WRITE_POLICY: RatePolicy = { name: "write", limit: 30, windowSeconds: 60 };
export const CLAIM_POLICY: RatePolicy = { name: "claim", limit: 5, windowSeconds: 60 };
export const USER_WRITE_POLICY: RatePolicy = { name: "write-user", limit: 20, windowSeconds: 60 };
export const USER_CLAIM_POLICY: RatePolicy = { name: "claim-user", limit: 3, windowSeconds: 60 };

export type RateDecision = { allowed: boolean; remaining: number; resetSeconds: number };

export type RateLimiter = {
  check(key: string, policy: RatePolicy): Promise<RateDecision>;
  readonly backend: "upstash" | "memory";
};

export function createRateLimiter(
  env: { UPSTASH_REDIS_REST_URL?: string; UPSTASH_REDIS_REST_TOKEN?: string },
  logger: Logger,
): RateLimiter {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const redis = new Redis({ url, token });
    const limiters = new Map<string, Ratelimit>();
    logger.info("rate limiter ready", { backend: "upstash" });
    return {
      backend: "upstash",
      async check(key, policy) {
        let limiter = limiters.get(policy.name);
        if (!limiter) {
          limiter = new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(policy.limit, `${policy.windowSeconds} s`),
            prefix: `wavvy-api:${policy.name}`,
          });
          limiters.set(policy.name, limiter);
        }
        const result = await limiter.limit(key);
        return {
          allowed: result.success,
          remaining: result.remaining,
          resetSeconds: Math.max(0, Math.ceil((result.reset - Date.now()) / 1000)),
        };
      },
    };
  }

  logger.warn("rate limiter falling back to per-process memory; set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for production");
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    backend: "memory",
    async check(key, policy) {
      const now = Date.now();
      const bucketKey = `${policy.name}:${key}`;
      const existing = windows.get(bucketKey);
      const bucket =
        existing && existing.resetAt > now
          ? existing
          : { count: 0, resetAt: now + policy.windowSeconds * 1000 };
      bucket.count += 1;
      windows.set(bucketKey, bucket);
      if (windows.size > 10_000) {
        windows.clear();
      }
      return {
        allowed: bucket.count <= policy.limit,
        remaining: Math.max(0, policy.limit - bucket.count),
        resetSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    },
  };
}

export function clientKey(header: string | undefined): string {
  const first = header?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "local";
}

function applyDecision(
  c: { header: (name: string, value: string) => void; json: (body: unknown, status: 429) => Response; get: (key: string) => unknown },
  policy: RatePolicy,
  decision: RateDecision,
): Response | undefined {
  c.header("X-RateLimit-Limit", String(policy.limit));
  c.header("X-RateLimit-Remaining", String(decision.remaining));
  if (decision.allowed) {
    return undefined;
  }
  c.header("Retry-After", String(decision.resetSeconds));
  return c.json(errorBody("rate_limited", `rate limit exceeded for ${policy.name}`, undefined), 429);
}

export function rateLimit(limiter: RateLimiter, policy: RatePolicy): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = clientKey(c.req.header("x-forwarded-for"));
    const decision = await limiter.check(key, policy);
    const blocked = applyDecision(c, policy, decision);
    if (blocked) {
      return blocked;
    }
    await next();
  };
}

export function rateLimitUser(limiter: RateLimiter, policy: RatePolicy): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("authUser") as { privyUserId?: string } | undefined;
    const key = `user:${user?.privyUserId ?? clientKey(c.req.header("x-forwarded-for"))}`;
    const decision = await limiter.check(key, policy);
    const blocked = applyDecision(c, policy, decision);
    if (blocked) {
      return blocked;
    }
    await next();
  };
}