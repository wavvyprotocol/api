import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  privyId: text("privy_id").notNull().unique(),
  farcasterFid: integer("farcaster_fid"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wallets = pgTable(
  "wallets",
  {
    address: text("address").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (table) => [index("wallets_user_idx").on(table.userId)],
);

export const markets = pgTable("markets", {
  id: integer("id").primaryKey(),
  type: text("type", { enum: ["single_name", "index"] }).notNull(),
  metricId: text("metric_id"),
  creatorIds: jsonb("creator_ids").$type<string[]>().notNull().default([]),
  baselineValues: jsonb("baseline_values").$type<string[]>(),
  status: text("status", { enum: ["active", "paused", "closed"] })
    .notNull()
    .default("active"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const positions = pgTable(
  "positions",
  {
    tokenId: text("token_id").primaryKey(),
    marketId: integer("market_id").notNull(),
    ownerAddress: text("owner_address").notNull(),
    side: text("side", { enum: ["long", "short"] }).notNull(),
    leverage: numeric("leverage").notNull(),
    margin: numeric("margin").notNull(),
    entryPrice: numeric("entry_price").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    status: text("status", { enum: ["open", "closed", "liquidated"] })
      .notNull()
      .default("open"),
    realizedPnl: numeric("realized_pnl"),
    txHash: text("tx_hash"),
    blockNumber: bigint("block_number", { mode: "number" }),
  },
  (table) => [
    index("positions_owner_idx").on(table.ownerAddress),
    index("positions_market_idx").on(table.marketId),
  ],
);

export const feedPosts = pgTable("feed_posts", {
  positionTokenId: text("position_token_id")
    .primaryKey()
    .references(() => positions.tokenId, { onDelete: "cascade" }),
  thesis: varchar("thesis", { length: 280 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reactions = pgTable(
  "reactions",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => feedPosts.positionTokenId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["like", "wavvy"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("reactions_unique_idx").on(table.postId, table.userId, table.kind),
    index("reactions_post_idx").on(table.postId),
  ],
);

export const replies = pgTable(
  "replies",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => feedPosts.positionTokenId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: varchar("body", { length: 280 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("replies_post_idx").on(table.postId)],
);

export const creators = pgTable(
  "creators",
  {
    id: text("id").primaryKey(),
    creatorId: text("creator_id").notNull().unique(),
    platform: text("platform", { enum: ["youtube", "x", "tiktok", "instagram", "spotify"] }).notNull(),
    handle: text("handle").notNull(),
    walletAddress: text("wallet_address"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationStatus: text("verification_status", {
      enum: ["unclaimed", "challenge_issued", "proof_submitted", "verified", "rejected"],
    })
      .notNull()
      .default("unclaimed"),
    verificationChallenge: text("verification_challenge"),
    verificationUserId: text("verification_user_id"),
    challengeIssuedAt: timestamp("challenge_issued_at", { withTimezone: true }),
    proofUrl: text("proof_url"),
    proofSubmittedAt: timestamp("proof_submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("creators_platform_handle_idx").on(table.platform, table.handle)],
);

export const creatorAccruals = pgTable(
  "creator_accruals",
  {
    id: text("id").primaryKey(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => creators.creatorId, { onDelete: "cascade" }),
    amount: numeric("amount").notNull(),
    period: text("period").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimTxHash: text("claim_tx_hash"),
    txHash: text("tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("creator_accruals_event_idx").on(table.creatorId, table.period, table.txHash),
    uniqueIndex("creator_accruals_period_idx")
      .on(table.creatorId, table.period)
      .where(sql`${table.txHash} is null`),
  ],
);

export const curatorCalls = pgTable(
  "curator_calls",
  {
    id: text("id").primaryKey(),
    curatorUserId: text("curator_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetTrader: text("target_trader").notNull(),
    marketId: integer("market_id"),
    thesis: varchar("thesis", { length: 280 }).notNull(),
    stakeAmount: numeric("stake_amount").notNull(),
    stakeTxHash: text("stake_tx_hash"),
    onchainCallId: text("onchain_call_id"),
    status: text("status", { enum: ["pending", "active", "closed", "slashed"] })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("curator_calls_curator_idx").on(table.curatorUserId)],
);

export const copies = pgTable(
  "copies",
  {
    id: text("id").primaryKey(),
    callId: text("call_id")
      .notNull()
      .references(() => curatorCalls.id, { onDelete: "cascade" }),
    copierUserId: text("copier_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    positionTokenId: text("position_token_id").notNull(),
    attributedAt: timestamp("attributed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("copies_position_idx").on(table.positionTokenId)],
);

export const traderStats = pgTable("trader_stats", {
  address: text("address").primaryKey(),
  winRate: numeric("win_rate").notNull().default("0"),
  totalPnl: numeric("total_pnl").notNull().default("0"),
  closedPositions: integer("closed_positions").notNull().default(0),
  consistency: numeric("consistency").notNull().default("0"),
  copierCount: integer("copier_count").notNull().default(0),
  reputation: numeric("reputation").notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const curatorStats = pgTable("curator_stats", {
  userId: text("user_id").primaryKey(),
  activeCalls: integer("active_calls").notNull().default(0),
  totalStaked: numeric("total_staked").notNull().default("0"),
  copierCount: integer("copier_count").notNull().default(0),
  closedCalls: integer("closed_calls").notNull().default(0),
  profitableCalls: integer("profitable_calls").notNull().default(0),
  reputation: numeric("reputation").notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const indexerState = pgTable("indexer_state", {
  id: text("id").primaryKey(),
  lastBlock: bigint("last_block", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});