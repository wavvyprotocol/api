import { Hono } from "hono";
import type { AppEnv } from "../types.ts";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { timingSafeEqual, createHash } from "node:crypto";
import { currentUser } from "../auth.ts";
import { badRequest, conflict, forbidden, notFound, unavailable } from "../errors.ts";
import { formatWad } from "../math.ts";
import * as queries from "../db/queries.ts";
import { DEFAULT_APP_URL, invalidRequestHook, requireDb, type RouteDeps } from "./deps.ts";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const metricIdSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const callSchema = z.object({
  marketId: z.number().int().positive(),
  targetTrader: addressSchema,
  thesis: z.string().trim().min(1).max(280),
  stakeAmount: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n, "the stake must be positive"),
  stakeTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "stakeTxHash is required to verify the stake"),
});

const verifySchema = z.union([
  z.object({ platform: z.enum(["youtube", "x", "tiktok", "instagram", "spotify"]), handle: z.string().trim().min(1).max(128) }),
  z.object({ creatorId: metricIdSchema, proofUrl: z.string().url().max(500) }),
]);

const approveSchema = z.object({ creatorId: metricIdSchema, walletAddress: addressSchema });
const claimSchema = z.object({ creatorId: metricIdSchema });

function challengeCode(): string {
  return `wavvy-${createHash("sha256").update(crypto.randomUUID()).digest("hex").slice(0, 10)}`;
}

function adminTokenMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function socialRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/leaderboard", deps.limits.read, async (c) => {
    const db = requireDb(deps);
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 100);
    const [traders, curators] = await Promise.all([
      queries.traderLeaderboard(db, limit),
      queries.curatorLeaderboard(db, limit),
    ]);
    return c.json({
      traders: traders.map((row) => ({
        address: row.address,
        winRate: row.winRate,
        totalPnl: row.totalPnl,
        closedPositions: row.closedPositions,
        consistency: row.consistency,
        copierCount: row.copierCount,
        reputation: row.reputation,
        sampleSize: row.closedPositions,
        updatedAt: row.updatedAt.toISOString(),
      })),
      curators: curators.map((row) => ({
        userId: row.stats.userId,
        displayName: row.user?.displayName ?? null,
        wallet: row.wallet,
        activeCalls: row.stats.activeCalls,
        totalStaked: row.stats.totalStaked,
        copierCount: row.stats.copierCount,
        closedCalls: row.stats.closedCalls,
        profitableCalls: row.stats.profitableCalls,
        reputation: row.stats.reputation,
        sampleSize: row.stats.closedCalls,
        updatedAt: row.stats.updatedAt.toISOString(),
      })),
    });
  });

  app.get("/curators", deps.limits.read, async (c) => {
    const db = requireDb(deps);
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 100);
    const rows = await queries.listCuratorCalls(db, limit);
    return c.json({
      calls: rows.map((row) => ({
        id: row.call.id,
        curatorUserId: row.call.curatorUserId,
        curatorWallet: row.wallet,
        targetTrader: row.call.targetTrader,
        marketId: row.call.marketId,
        thesis: row.call.thesis,
        stakeAmount: row.call.stakeAmount,
        stakeTxHash: row.call.stakeTxHash,
        onchainCallId: row.call.onchainCallId,
        status: row.call.status,
        curatorReputation: row.stats?.reputation ?? "0",
        copierCount: row.stats?.copierCount ?? 0,
        createdAt: row.call.createdAt.toISOString(),
      })),
    });
  });

  app.post("/curators/calls", deps.limits.write, deps.auth, deps.userLimits.write, zValidator("json", callSchema, invalidRequestHook), async (c) => {
    const db = requireDb(deps);
    const user = currentUser(c);
    const body = c.req.valid("json");

    const userId = await queries.userIdFor(db, user.privyUserId);
    if (!userId) {
      throw forbidden("the authenticated user has no profile row yet");
    }
    const market = await deps.chain.marketInfo(body.marketId);
    if (!market.exists) {
      throw badRequest(`market ${body.marketId} does not exist`);
    }
    if (!user.walletAddress) {
      throw forbidden("link a wallet before publishing a call");
    }
    const verification = await deps.chain.verifyStake({
      txHash: body.stakeTxHash as `0x${string}`,
      curator: user.walletAddress,
      marketId: body.marketId,
      stakeAmount: BigInt(body.stakeAmount),
    });
    if (verification.status === "rejected") {
      deps.log.warn("curator call rejected", { marketId: body.marketId, cause: verification.reason });
      throw badRequest(`the stake transaction could not be verified: ${verification.reason}`);
    }
    const call = await queries.insertCuratorCall(db, {
      id: crypto.randomUUID(),
      curatorUserId: userId,
      targetTrader: body.targetTrader.toLowerCase(),
      marketId: body.marketId,
      thesis: body.thesis,
      stakeAmount: body.stakeAmount,
      stakeTxHash: body.stakeTxHash,
      status: verification.status === "verified" ? "active" : "pending",
      onchainCallId: verification.status === "verified" ? verification.callId : null,
    });
    deps.log.success("curator call published", {
      callId: call.id,
      marketId: body.marketId,
      stake: body.stakeAmount,
      status: call.status,
    });
    return c.json(
      { id: call.id, status: call.status, stakeAmount: call.stakeAmount, onchainCallId: call.onchainCallId, createdAt: call.createdAt.toISOString() },
      201,
    );
  });

  app.get("/creators/unclaimed", deps.limits.read, async (c) => {
    const db = requireDb(deps);
    const rows = await queries.unclaimedCreators(db);
    const board = await Promise.all(
      rows.map(async (row) => {
        let escrowBalance: string | null = null;
        let linkedWallet: string | null = row.creator.walletAddress;
        try {
          const info = await deps.chain.creatorInfo(row.creator.creatorId as `0x${string}`);
          escrowBalance = formatWad(info.balance);
          linkedWallet = info.wallet === "0x0000000000000000000000000000000000000000" ? row.creator.walletAddress : info.wallet;
        } catch (error) {
          deps.log.warn("creator escrow read failed", {
            creatorId: row.creator.creatorId,
            cause: error instanceof Error ? error.message : String(error),
          });
        }
        return {
          creatorId: row.creator.creatorId,
          platform: row.creator.platform,
          handle: row.creator.handle,
          verificationStatus: row.creator.verificationStatus,
          linkedWallet,
          accrued: formatWad(BigInt(row.accrued ?? "0")),
          claimed: formatWad(BigInt(row.claimed ?? "0")),
          escrowBalance,
          profileUrl: `${DEFAULT_APP_URL}/creator/${row.creator.platform}/${row.creator.handle}`,
        };
      }),
    );
    return c.json({ creators: board });
  });

  app.post("/creator/verify", deps.limits.write, deps.auth, deps.userLimits.write, zValidator("json", verifySchema, invalidRequestHook), async (c) => {
    const db = requireDb(deps);
    const body = c.req.valid("json");

    const userId = await queries.userIdFor(db, currentUser(c).privyUserId);
    if (!userId) {
      throw forbidden("the authenticated user has no profile row yet");
    }

    if ("platform" in body) {
      const existing = await queries.creatorByHandle(db, body.platform, body.handle);
      if (existing?.verificationStatus === "verified") {
        throw conflict("this creator is already verified");
      }
      const code = challengeCode();
      const nowIso = new Date();
      if (existing) {
        const updated = await queries.updateCreator(db, existing.creatorId, {
          verificationStatus: "challenge_issued",
          verificationChallenge: code,
          challengeIssuedAt: nowIso,
          verificationUserId: userId,
          proofUrl: null,
          proofSubmittedAt: null,
        });
        return c.json({
          creatorId: updated?.creatorId,
          step: "challenge_issued",
          challenge: code,
          instructions: `Post "${code}" in the bio of ${body.platform}/${body.handle}, then submit the profile URL with creatorId.`,
        });
      }
      const creatorId = `0x${createHash("sha256").update(`${body.platform}:${body.handle}`).digest("hex")}`;
      const inserted = await queries.insertCreator(db, {
        id: crypto.randomUUID(),
        creatorId,
        platform: body.platform,
        handle: body.handle,
        verificationStatus: "challenge_issued",
        verificationChallenge: code,
        challengeIssuedAt: nowIso,
        verificationUserId: userId,
      });
      return c.json(
        {
          creatorId: inserted.creatorId,
          step: "challenge_issued",
          challenge: code,
          instructions: `Post "${code}" in the bio of ${body.platform}/${body.handle}, then submit the profile URL with creatorId.`,
        },
        201,
      );
    }

    const creator = await queries.creatorById(db, body.creatorId);
    if (!creator) {
      throw notFound("unknown creatorId; request a challenge first");
    }
    if (creator.verificationStatus === "verified") {
      throw conflict("this creator is already verified");
    }
    if (creator.verificationStatus !== "challenge_issued") {
      throw conflict(`the verification flow is in state ${creator.verificationStatus}; request a new challenge`);
    }
    if (creator.verificationUserId !== null && creator.verificationUserId !== userId) {
      throw forbidden("only the account that requested the challenge can submit the proof");
    }
    const updated = await queries.updateCreator(db, body.creatorId, {
      verificationStatus: "proof_submitted",
      proofUrl: body.proofUrl,
      proofSubmittedAt: new Date(),
    });
    return c.json({
      creatorId: updated?.creatorId,
      step: "proof_submitted",
      proofUrl: updated?.proofUrl,
      next: "await review; large accounts go through the manual verification path",
    });
  });

  app.post("/creator/verify/approve", deps.limits.claim, zValidator("json", approveSchema, invalidRequestHook), async (c) => {
    const db = requireDb(deps);
    if (!deps.verifyAdminToken) {
      throw unavailable("manual verification is disabled: set VERIFY_ADMIN_TOKEN");
    }
    const provided = c.req.header("x-admin-token") ?? "";
    if (!adminTokenMatches(provided, deps.verifyAdminToken)) {
      throw forbidden("invalid admin token");
    }
    const body = c.req.valid("json");
    const creator = await queries.creatorById(db, body.creatorId);
    if (!creator) {
      throw notFound("unknown creatorId");
    }
    if (creator.verificationStatus !== "proof_submitted") {
      throw conflict(`cannot approve from state ${creator.verificationStatus}`);
    }
    const updated = await queries.updateCreator(db, body.creatorId, {
      verificationStatus: "verified",
      walletAddress: body.walletAddress.toLowerCase(),
      verifiedAt: new Date(),
    });
    deps.log.success("creator verified", { creatorId: body.creatorId, wallet: body.walletAddress });
    return c.json({
      creatorId: updated?.creatorId,
      step: "verified",
      walletAddress: updated?.walletAddress,
      verifiedAt: updated?.verifiedAt?.toISOString(),
    });
  });

  app.post("/creator/claim", deps.limits.claim, deps.auth, deps.userLimits.claim, zValidator("json", claimSchema, invalidRequestHook), async (c) => {
    const db = requireDb(deps);
    const user = currentUser(c);
    const body = c.req.valid("json");

    if (!user.walletAddress) {
      throw forbidden("link a wallet before claiming");
    }
    const [creator, info] = await Promise.all([
      queries.creatorById(db, body.creatorId),
      deps.chain.creatorInfo(body.creatorId as `0x${string}`),
    ]);
    if (!creator || creator.verificationStatus !== "verified") {
      throw forbidden("the creator must be verified before claiming");
    }
    if (info.wallet === "0x0000000000000000000000000000000000000000") {
      throw conflict("no wallet is linked onchain yet");
    }
    if (info.wallet.toLowerCase() !== user.walletAddress.toLowerCase()) {
      throw forbidden("only the linked wallet can claim");
    }
    if (info.balance === 0n) {
      throw conflict("nothing to claim right now");
    }
    const tx = deps.buildClaimTransaction
      ? deps.buildClaimTransaction(body.creatorId as `0x${string}`)
      : null;
    if (!tx) {
      throw unavailable("claim transactions are not configured on this deployment");
    }
    deps.log.success("creator claim prepared", {
      creatorId: body.creatorId,
      amount: info.balance.toString(),
      wallet: user.walletAddress,
    });
    return c.json({
      creatorId: body.creatorId,
      amount: formatWad(info.balance),
      transaction: tx,
      note: "sign and send this transaction with the linked wallet; the contract pays only that wallet",
    });
  });

  return app;
}