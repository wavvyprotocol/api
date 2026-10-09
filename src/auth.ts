import { PrivyClient } from "@privy-io/server-auth";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "./types.ts";
import { unauthorized, unavailable } from "./errors.ts";
import type { Logger } from "./log.ts";

export type AuthUser = {
  privyUserId: string;
  walletAddress?: `0x${string}`;
};

export type AuthVerifier = (token: string) => Promise<AuthUser>;

export type AuthDeps = {
  logger: Logger;
  verify?: AuthVerifier;
  ensureUser?: (user: AuthUser) => Promise<unknown>;
};

export function createPrivyVerifier(
  env: { PRIVY_APP_ID?: string; PRIVY_APP_SECRET?: string },
  logger: Logger,
): AuthVerifier | undefined {
  const appId = env.PRIVY_APP_ID;
  const appSecret = env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    return undefined;
  }
  const client = new PrivyClient(appId, appSecret);
  return async (token: string): Promise<AuthUser> => {
    const claims = await client.verifyAuthToken(token);
    let walletAddress: `0x${string}` | undefined;
    try {
      const user = await client.getUser(claims.userId);
      const wallet = user.linkedAccounts.find((account) => account.type === "wallet");
      if (wallet && "address" in wallet) {
        walletAddress = wallet.address.toLowerCase() as `0x${string}`;
      }
    } catch (error) {
      logger.warn("privy user lookup failed", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    return { privyUserId: claims.userId, ...(walletAddress ? { walletAddress } : {}) };
  };
}

export type AuthenticatedContext = {
  authUser: AuthUser;
};

export function requireAuth(deps: AuthDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!deps.verify) {
      throw unavailable("authentication is not configured on this deployment");
    }
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) {
      throw unauthorized("a Privy access token is required");
    }
    let user: AuthUser;
    try {
      user = await deps.verify(token);
    } catch (error) {
      deps.logger.debug("privileged request rejected", {
        path: c.req.path,
        cause: error instanceof Error ? error.message : String(error),
      });
      throw unauthorized("the access token is invalid or expired");
    }
    if (deps.ensureUser) {
      await deps.ensureUser(user);
    }
    c.set("authUser", user);
    await next();
  };
}

export function currentUser(c: Context<AppEnv>): AuthUser {
  const user = c.get("authUser");
  if (!user) {
    throw unauthorized("authentication required");
  }
  return user;
}