import { randomUUID } from "node:crypto";
import type { PgColumn } from "drizzle-orm/pg-core";
import { and, count, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import type { AuthUser } from "../auth.ts";
import type { Database } from "./client.ts";
import {
  copies,
  creatorAccruals,
  creators,
  curatorCalls,
  curatorStats,
  feedPosts,
  markets,
  positions,
  reactions,
  replies,
  traderStats,
  users,
  wallets,
} from "./schema.ts";

export type MarketRow = typeof markets.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;
export type FeedPostRow = typeof feedPosts.$inferSelect;
export type CreatorRow = typeof creators.$inferSelect;
export type CuratorCallRow = typeof curatorCalls.$inferSelect;

export async function ensureUser(db: Database, user: AuthUser): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({ id: randomUUID(), privyId: user.privyUserId })
      .onConflictDoUpdate({ target: users.privyId, set: { updatedAt: new Date() } })
      .returning({ id: users.id });
    if (!row) {
      throw new Error("user upsert returned no row");
    }
    if (user.walletAddress) {
      const address = user.walletAddress;
      await tx
        .update(wallets)
        .set({ isPrimary: false })
        .where(and(eq(wallets.userId, row.id), ne(wallets.address, address)));
      await tx
        .insert(wallets)
        .values({ address, userId: row.id, isPrimary: true, verifiedAt: new Date() })
        .onConflictDoUpdate({
          target: wallets.address,
          set: { userId: row.id, isPrimary: true, verifiedAt: new Date() },
        });
    }
    return row.id;
  });
}

export async function userIdFor(db: Database, privyUserId: string): Promise<string | null> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.privyId, privyUserId)).limit(1);
  return row?.id ?? null;
}

export async function walletForUser(db: Database, userId: string): Promise<`0x${string}` | null> {
  const [row] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .orderBy(desc(wallets.isPrimary), sql`${wallets.verifiedAt} desc nulls last`)
    .limit(1);
  return (row?.address as `0x${string}` | undefined) ?? null;
}

export async function listMarkets(db: Database): Promise<MarketRow[]> {
  return db.select().from(markets).orderBy(markets.id);
}

export async function getMarket(db: Database, marketId: number): Promise<MarketRow | null> {
  const [row] = await db.select().from(markets).where(eq(markets.id, marketId)).limit(1);
  return row ?? null;
}

export type PositionFilters = {
  owner?: string;
  marketId?: number;
  status?: PositionRow["status"];
  limit?: number;
  offset?: number;
};

export async function listPositions(db: Database, filters: PositionFilters = {}): Promise<PositionRow[]> {
  const conditions = [];
  if (filters.owner) {
    conditions.push(eq(positions.ownerAddress, filters.owner.toLowerCase()));
  }
  if (filters.marketId !== undefined) {
    conditions.push(eq(positions.marketId, filters.marketId));
  }
  if (filters.status) {
    conditions.push(eq(positions.status, filters.status));
  }
  const base = db.select().from(positions);
  const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return filtered
    .orderBy(desc(positions.openedAt))
    .limit(Math.min(filters.limit ?? 100, 200))
    .offset(filters.offset ?? 0);
}

export async function positionsByOwner(db: Database, owner: string, limit = 200): Promise<PositionRow[]> {
  return listPositions(db, { owner, limit });
}

export async function getPosition(db: Database, tokenId: string): Promise<PositionRow | null> {
  const [row] = await db.select().from(positions).where(eq(positions.tokenId, tokenId)).limit(1);
  return row ?? null;
}

export async function getFeedPost(db: Database, positionTokenId: string): Promise<FeedPostRow | null> {
  const [row] = await db.select().from(feedPosts).where(eq(feedPosts.positionTokenId, positionTokenId)).limit(1);
  return row ?? null;
}

export async function upsertFeedPost(db: Database, positionTokenId: string, thesis: string): Promise<FeedPostRow> {
  const [row] = await db
    .insert(feedPosts)
    .values({ positionTokenId, thesis })
    .onConflictDoUpdate({
      target: feedPosts.positionTokenId,
      set: { thesis, updatedAt: new Date() },
    })
    .returning();
  if (!row) {
    throw new Error("feed post upsert returned no row");
  }
  return row;
}

export async function feedPostsWithPositions(
  db: Database,
  limit = 100,
): Promise<Array<{ post: FeedPostRow; position: PositionRow; market: MarketRow | null }>> {
  const rows = await db
    .select({ post: feedPosts, position: positions, market: markets })
    .from(feedPosts)
    .innerJoin(positions, eq(feedPosts.positionTokenId, positions.tokenId))
    .leftJoin(markets, eq(positions.marketId, markets.id))
    .orderBy(desc(feedPosts.createdAt))
    .limit(limit);
  return rows;
}

export async function reactionCounts(
  db: Database,
  postIds: string[],
): Promise<Map<string, { like: number; wavvy: number }>> {
  const result = new Map<string, { like: number; wavvy: number }>();
  if (postIds.length === 0) {
    return result;
  }
  const rows = await db
    .select({ postId: reactions.postId, kind: reactions.kind, total: count() })
    .from(reactions)
    .where(inArray(reactions.postId, postIds))
    .groupBy(reactions.postId, reactions.kind);
  for (const row of rows) {
    const entry = result.get(row.postId) ?? { like: 0, wavvy: 0 };
    entry[row.kind] = Number(row.total);
    result.set(row.postId, entry);
  }
  return result;
}

export async function replyCounts(db: Database, postIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (postIds.length === 0) {
    return result;
  }
  const rows = await db
    .select({ postId: replies.postId, total: count() })
    .from(replies)
    .where(inArray(replies.postId, postIds))
    .groupBy(replies.postId);
  for (const row of rows) {
    result.set(row.postId, Number(row.total));
  }
  return result;
}

export async function addReaction(db: Database, postId: string, userId: string, kind: "like" | "wavvy"): Promise<{ created: boolean }> {
  const inserted = await db
    .insert(reactions)
    .values({ id: randomUUID(), postId, userId, kind })
    .onConflictDoNothing({ target: [reactions.postId, reactions.userId, reactions.kind] })
    .returning({ id: reactions.id });
  return { created: inserted.length > 0 };
}

export async function addReply(db: Database, postId: string, userId: string, body: string) {
  const [row] = await db
    .insert(replies)
    .values({ id: randomUUID(), postId, userId, body })
    .returning();
  return row;
}

export async function listReplies(db: Database, postId: string, limit = 50) {
  return db.select().from(replies).where(eq(replies.postId, postId)).orderBy(replies.createdAt).limit(limit);
}

export async function curatorCallForToken(db: Database, onchainCallId: string): Promise<CuratorCallRow | null> {
  if (onchainCallId === "0") {
    return null;
  }
  const [row] = await db.select().from(curatorCalls).where(eq(curatorCalls.onchainCallId, onchainCallId)).limit(1);
  return row ?? null;
}

const primaryWallet = (userIdColumn: PgColumn) =>
  sql<string | null>`(select w.address from wallets w where w.user_id = ${userIdColumn} order by w.is_primary desc, w.verified_at desc nulls last limit 1)`;

export async function listCuratorCalls(db: Database, limit = 50) {
  return db
    .select({ call: curatorCalls, stats: curatorStats, wallet: primaryWallet(curatorCalls.curatorUserId) })
    .from(curatorCalls)
    .leftJoin(curatorStats, eq(curatorStats.userId, curatorCalls.curatorUserId))
    .orderBy(desc(curatorCalls.createdAt))
    .limit(limit);
}

export async function insertCuratorCall(
  db: Database,
  values: {
    id: string;
    curatorUserId: string;
    targetTrader: string;
    marketId: number | null;
    thesis: string;
    stakeAmount: string;
    stakeTxHash: string | null;
    status: CuratorCallRow["status"];
    onchainCallId: string | null;
  },
): Promise<CuratorCallRow> {
  const [row] = await db.insert(curatorCalls).values(values).returning();
  if (!row) {
    throw new Error("curator call insert returned no row");
  }
  return row;
}

export async function insertCopy(db: Database, callId: string, copierUserId: string, positionTokenId: string) {
  await db.insert(copies).values({ id: randomUUID(), callId, copierUserId, positionTokenId });
}

export async function traderStatsFor(db: Database, address: string) {
  const [row] = await db
    .select()
    .from(traderStats)
    .where(eq(traderStats.address, address.toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function traderLeaderboard(db: Database, limit = 50) {
  return db.select().from(traderStats).orderBy(desc(traderStats.reputation)).limit(limit);
}

export async function curatorLeaderboard(db: Database, limit = 50) {
  return db
    .select({ stats: curatorStats, wallet: primaryWallet(curatorStats.userId), user: users })
    .from(curatorStats)
    .leftJoin(users, eq(users.id, curatorStats.userId))
    .orderBy(desc(curatorStats.reputation))
    .limit(limit);
}

export async function creatorByHandle(db: Database, platform: string, handle: string): Promise<CreatorRow | null> {
  const [row] = await db
    .select()
    .from(creators)
    .where(and(eq(creators.platform, platform as CreatorRow["platform"]), eq(creators.handle, handle)))
    .limit(1);
  return row ?? null;
}

export async function creatorById(db: Database, creatorId: string): Promise<CreatorRow | null> {
  const [row] = await db.select().from(creators).where(eq(creators.creatorId, creatorId)).limit(1);
  return row ?? null;
}

export async function insertCreator(
  db: Database,
  values: {
    id: string;
    creatorId: string;
    platform: CreatorRow["platform"];
    handle: string;
    verificationStatus: CreatorRow["verificationStatus"];
    verificationChallenge: string;
    challengeIssuedAt: Date;
    verificationUserId: string;
  },
): Promise<CreatorRow> {
  const [row] = await db.insert(creators).values(values).returning();
  if (!row) {
    throw new Error("creator insert returned no row");
  }
  return row;
}

export async function updateCreator(db: Database, creatorId: string, values: Partial<CreatorRow>): Promise<CreatorRow | null> {
  const [row] = await db
    .update(creators)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(creators.creatorId, creatorId))
    .returning();
  return row ?? null;
}

export async function unclaimedCreators(db: Database, limit = 100) {
  const rows = await db
    .select({
      creator: creators,
      accrued: sql<string>`coalesce(sum(case when ${creatorAccruals.claimedAt} is null then ${creatorAccruals.amount} else 0 end), 0)`,
      claimed: sql<string>`coalesce(sum(case when ${creatorAccruals.claimedAt} is not null then ${creatorAccruals.amount} else 0 end), 0)`,
    })
    .from(creators)
    .leftJoin(creatorAccruals, eq(creatorAccruals.creatorId, creators.creatorId))
    .groupBy(creators.id)
    .orderBy(desc(sql`coalesce(sum(case when ${creatorAccruals.claimedAt} is null then ${creatorAccruals.amount} else 0 end), 0)`))
    .limit(limit);
  return rows;
}

export async function accrualsForCreator(db: Database, creatorId: string) {
  return db
    .select()
    .from(creatorAccruals)
    .where(and(eq(creatorAccruals.creatorId, creatorId), isNull(creatorAccruals.claimedAt)))
    .orderBy(creatorAccruals.period);
}

export async function markAccrualsClaimed(db: Database, creatorId: string, claimTxHash: string): Promise<number> {
  const rows = await db
    .update(creatorAccruals)
    .set({ claimedAt: new Date(), claimTxHash })
    .where(and(eq(creatorAccruals.creatorId, creatorId), isNull(creatorAccruals.claimedAt)))
    .returning({ id: creatorAccruals.id });
  return rows.length;
}

export async function closedPositionsSince(db: Database, owner: string, since: Date) {
  return db
    .select()
    .from(positions)
    .where(and(eq(positions.ownerAddress, owner.toLowerCase()), gte(positions.closedAt, since)))
    .orderBy(positions.closedAt);
}