import { Hono } from "hono";
import type { AppEnv } from "../types.ts";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { currentUser } from "../auth.ts";
import { badRequest, forbidden, notFound } from "../errors.ts";
import { formatWad, positionEquity } from "../math.ts";
import * as queries from "../db/queries.ts";
import { invalidRequestHook, requireDb, type RouteDeps } from "./deps.ts";

const paramSchema = z.object({ id: z.string().regex(/^\d+$/, "feed id is a position token id") });
const thesisSchema = z.object({
  thesis: z.string().trim().min(1, "thesis cannot be empty").max(280, "thesis is capped at 280 characters"),
});
const reactSchema = z.object({ kind: z.enum(["like", "wavvy"]).default("like") });
const replySchema = z.object({ body: z.string().trim().min(1, "reply cannot be empty").max(280, "reply is capped at 280 characters") });

function recencyBucket(createdAtMs: number, now: Date): number {
  const ageSeconds = (now.getTime() - createdAtMs) / 1000;
  if (ageSeconds < 60 * 60) return 3;
  if (ageSeconds < 6 * 60 * 60) return 2;
  if (ageSeconds < 24 * 60 * 60) return 1;
  return 0;
}

type FeedCard = {
  positionTokenId: string;
  createdAtMs: number;
  staked: boolean;
  reputation: number;
  engagement: number;
  [key: string]: unknown;
};

function compareCards(a: FeedCard, b: FeedCard, now: Date): number {
  const bucketDelta = recencyBucket(b.createdAtMs, now) - recencyBucket(a.createdAtMs, now);
  if (bucketDelta !== 0) return bucketDelta;
  if (a.staked !== b.staked) return a.staked ? -1 : 1;
  if (a.reputation !== b.reputation) return b.reputation - a.reputation;
  if (a.engagement !== b.engagement) return b.engagement - a.engagement;
  return a.positionTokenId.localeCompare(b.positionTokenId);
}

export function feedRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const now = () => (deps.now ? deps.now() : new Date());

  app.get("/", deps.limits.read, async (c) => {
    const db = requireDb(deps);
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 100);
    const rows = await queries.feedPostsWithPositions(db, limit);
    const postIds = rows.map((row) => row.post.positionTokenId);
    const [reactionMap, replyMap] = await Promise.all([
      queries.reactionCounts(db, postIds),
      queries.replyCounts(db, postIds),
    ]);

    const cards = await Promise.all(
      rows.map(async (row): Promise<FeedCard> => {
        const marketId = row.position.marketId;
        let markPrice: bigint | null = null;
        let fundingGrowth = 0n;
        try {
          const info = await deps.chain.marketInfo(marketId);
          markPrice = info.markPrice;
          fundingGrowth = info.fundingGrowth;
        } catch (error) {
          deps.log.warn("feed mark price read failed", {
            marketId,
            cause: error instanceof Error ? error.message : String(error),
          });
        }
        const chainPosition = await deps.chain.position(row.position.tokenId);
        const equity =
          chainPosition && markPrice !== null
            ? positionEquity({
                isLong: chainPosition.isLong,
                size: chainPosition.size,
                entryPrice: chainPosition.entryPrice,
                markPrice,
                margin: chainPosition.margin,
                fundingGrowth,
                lastFundingGrowth: chainPosition.lastFundingGrowth,
              })
            : null;
        const attribution = chainPosition ? await queries.curatorCallForToken(db, chainPosition.callId) : null;
        const reactionsForPost = reactionMap.get(row.post.positionTokenId) ?? { like: 0, wavvy: 0 };
        const ownerStats = await queries.traderStatsFor(db, chainPosition?.owner ?? row.position.ownerAddress);
        const replyCount = replyMap.get(row.post.positionTokenId) ?? 0;

        return {
          positionTokenId: row.post.positionTokenId,
          marketId,
          marketStatus: row.market?.status ?? "active",
          owner: chainPosition?.owner ?? row.position.ownerAddress,
          side: (chainPosition?.isLong ?? row.position.side === "long") ? "long" : "short",
          entryPrice: formatWad(chainPosition?.entryPrice ?? 0n),
          markPrice: markPrice === null ? null : formatWad(markPrice),
          size: formatWad(chainPosition?.size ?? 0n),
          margin: formatWad(chainPosition?.margin ?? 0n),
          pnl: equity ? formatWad(equity.pnl) : null,
          fundingCost: equity ? formatWad(equity.fundingCost) : null,
          equity: equity ? formatWad(equity.equity) : null,
          thesis: row.post.thesis,
          reactions: reactionsForPost,
          replies: replyCount,
          curatorCall: attribution
            ? {
                id: attribution.id,
                curatorUserId: attribution.curatorUserId,
                stakeAmount: attribution.stakeAmount,
                status: attribution.status,
              }
            : null,
          marketPaused: (row.market?.status ?? "active") !== "active",
          createdAt: row.post.createdAt.toISOString(),
          createdAtMs: row.post.createdAt.getTime(),
          updatedAt: row.post.updatedAt.toISOString(),
          staked: attribution !== null && attribution.status === "active" && Number(attribution.stakeAmount) > 0,
          reputation: ownerStats ? Number(ownerStats.reputation) : 0,
          engagement: reactionsForPost.like + reactionsForPost.wavvy + replyCount,
        };
      }),
    );

    cards.sort((a, b) => compareCards(a, b, now()));
    const ranked = cards.slice(0, limit).map(({ createdAtMs, ...card }) => {
      void createdAtMs;
      return card;
    });
    return c.json({ feed: ranked, ranking: "recency, staked calls, reputation, engagement" });
  });

  app.post("/:id/thesis", deps.limits.write, deps.auth, deps.userLimits.write, zValidator("param", paramSchema, invalidRequestHook), zValidator("json", thesisSchema, invalidRequestHook), async (c) => {
    const db = requireDb(deps);
    const user = currentUser(c);
    const { id } = c.req.valid("param");
    const { thesis } = c.req.valid("json");

    const chainPosition = await deps.chain.position(id);
    const row = chainPosition ? null : await queries.getPosition(db, id);
    if (!chainPosition && !row) {
      throw notFound(`position ${id} does not exist`);
    }
    const owner = (chainPosition?.owner ?? row?.ownerAddress ?? "").toLowerCase();
    if (!user.walletAddress || user.walletAddress.toLowerCase() !== owner) {
      throw forbidden("only the position owner can set the thesis");
    }
    const post = await queries.upsertFeedPost(db, id, thesis.trim());
    return c.json({ positionTokenId: post.positionTokenId, thesis: post.thesis, updatedAt: post.updatedAt.toISOString() });
  });

  app.post("/:id/react", deps.limits.write, deps.auth, deps.userLimits.write, zValidator("param", paramSchema, invalidRequestHook), zValidator("json", reactSchema, invalidRequestHook), async (c) => {
    const db = requireDb(deps);
    const user = currentUser(c);
    const { id } = c.req.valid("param");
    const { kind } = c.req.valid("json");
    const post = await queries.getFeedPost(db, id);
    if (!post) {
      throw notFound(`feed card ${id} does not exist`);
    }
    const userId = await queries.userIdFor(db, user.privyUserId);
    if (!userId) {
      throw forbidden("the authenticated user has no profile row yet");
    }
    const result = await queries.addReaction(db, id, userId, kind);
    const counts = await queries.reactionCounts(db, [id]);
    return c.json({ positionTokenId: id, kind, created: result.created, reactions: counts.get(id) ?? { like: 0, wavvy: 0 } });
  });

  app.post("/:id/reply", deps.limits.write, deps.auth, deps.userLimits.write, zValidator("param", paramSchema, invalidRequestHook), zValidator("json", replySchema, invalidRequestHook), async (c) => {
    const db = requireDb(deps);
    const user = currentUser(c);
    const { id } = c.req.valid("param");
    const { body } = c.req.valid("json");
    const post = await queries.getFeedPost(db, id);
    if (!post) {
      throw notFound(`feed card ${id} does not exist`);
    }
    const userId = await queries.userIdFor(db, user.privyUserId);
    if (!userId) {
      throw forbidden("the authenticated user has no profile row yet");
    }
    const reply = await queries.addReply(db, id, userId, body.trim());
    return c.json(
      {
        id: reply?.id,
        positionTokenId: id,
        body: reply?.body,
        createdAt: reply?.createdAt.toISOString(),
      },
      201,
    );
  });

  return app;
}