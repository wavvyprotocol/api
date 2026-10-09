import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NOW,
  buildApp,
  fakeChain,
  seedFeedPost,
  seedMarket,
  seedPosition,
  testDb,
  TEST_USER,
  schema,
} from "./helpers.ts";

describe("public read endpoints", () => {
  it("serves health with capability flags", async () => {
    const app = buildApp();
    const response = await app.request("/health");
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string; service: string; database: boolean; authConfigured: boolean };
    assert.equal(body.status, "ok");
    assert.equal(body.service, "wavvy-api");
    assert.equal(body.database, false);
    assert.equal(body.authConfigured, false);
  });

  it("lists markets with mark price and 24h change", async () => {
    const { db } = await testDb();
    await seedMarket(db, { id: 6 });
    const app = buildApp({ db });

    const response = await app.request("/markets");
    assert.equal(response.status, 200);
    const body = (await response.json()) as { markets: Array<Record<string, unknown>> };
    assert.equal(body.markets.length, 1);
    const market = body.markets[0] ?? {};
    assert.equal(market.marketId, 6);
    assert.equal(market.markPrice, "1");
    assert.equal(market.change24hBps, 400);
    assert.equal(market.oracleState, "fresh");
  });

  it("serves market detail with index value and oracle status", async () => {
    const { db } = await testDb();
    await seedMarket(db, { id: 100, type: "index", metricId: `0x${"11".repeat(32)}` });
    const app = buildApp({ db });

    const response = await app.request("/markets/100");
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.type, "index");
    assert.equal(body.indexValue, "1.05");
    assert.equal(body.indexValid, true);
    const oracle = body.oracle as Record<string, unknown>;
    assert.equal(oracle.state, "fresh");
    assert.equal(oracle.fresh, true);
  });

  it("rejects a malformed market id and 404s an unknown one", async () => {
    const { db } = await testDb();
    const app = buildApp({ db });

    const malformed = await app.request("/markets/abc");
    assert.equal(malformed.status, 400);
    const malformedBody = (await malformed.json()) as { error: { code: string; requestId: string } };
    assert.equal(malformedBody.error.code, "invalid_request");
    assert.ok(malformedBody.error.requestId.length > 0, "errors carry the request id");

    const unknown = buildApp({ db, chain: fakeChain({ markets: { 999: { exists: false } } }) });
    const missing = await unknown.request("/markets/999", {});
    assert.equal(missing.status, 404);
    const missingBody = (await missing.json()) as { error: { code: string } };
    assert.equal(missingBody.error.code, "not_found");
  });

  it("merges chain and indexer state for positions", async () => {
    const { db } = await testDb();
    await seedPosition(db, { tokenId: "1", marketId: 6 });
    const app = buildApp({ db, chain: fakeChain() });

    const response = await app.request("/positions?owner=" + (TEST_USER.walletAddress ?? ""));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { positions: Array<Record<string, unknown>>; count: number };
    assert.equal(body.count, 1);
    const position = body.positions[0] ?? {};
    assert.equal(position.source, "chain+indexer");
    assert.equal(position.size, "10");
    assert.equal(position.markPrice, "1");
    assert.equal(position.pnl, "0");
    assert.equal(position.equity, "2");
  });

  it("404s a position that exists nowhere", async () => {
    const { db } = await testDb();
    const app = buildApp({ db, chain: fakeChain({ positions: { "42": null } }) });
    const response = await app.request("/positions/42");
    assert.equal(response.status, 404);
  });

  it("ranks the feed by recency, then staked calls, then reputation, then engagement", async () => {
    const { db } = await testDb();
    await seedMarket(db, { id: 6 });
    const twoHoursAgo = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    await seedPosition(db, { tokenId: "1", marketId: 6 });
    await seedPosition(db, { tokenId: "2", marketId: 6, owner: `0x${"ee".repeat(20)}` });
    await seedFeedPost(db, "1", "plain post", twoHoursAgo);
    await seedFeedPost(db, "2", "staked call post", twoHoursAgo);
    await db.insert(schema.curatorCalls).values({
      id: "call-1",
      curatorUserId: await (async () => {
        await db.insert(schema.users).values({ id: "curator-1", privyId: "did:privy:curator" });
        return "curator-1";
      })(),
      targetTrader: `0x${"ee".repeat(20)}`,
      thesis: "copy this",
      stakeAmount: "100000000",
      onchainCallId: "7",
      status: "active",
    });
    const app = buildApp({
      db,
      chain: fakeChain({ positions: { "2": { tokenId: "2", marketId: 6, isLong: true, size: 0n, entryPrice: 1_000_000_000_000_000_000n, margin: 0n, lastFundingGrowth: 0n, openedAt: 1, callId: "7", owner: `0x${"ee".repeat(20)}` } } }),
    });

    const response = await app.request("/feed");
    assert.equal(response.status, 200);
    const body = (await response.json()) as { feed: Array<Record<string, unknown>>; ranking: string };
    assert.equal(body.feed.length, 2);
    assert.equal(body.feed[0]?.positionTokenId, "2", "the staked call wins inside the same recency bucket");
    assert.equal((body.feed[0]?.curatorCall as { stakeAmount: string }).stakeAmount, "100000000");
    assert.match(body.ranking, /recency/);
  });

  it("reports portfolio totals and a PnL series", async () => {
    const { db } = await testDb();
    await seedPosition(db, { tokenId: "1", marketId: 6 });
    await seedPosition(db, {
      tokenId: "2",
      marketId: 6,
      status: "closed",
      realizedPnl: "500000000000000000",
      closedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    });
    const app = buildApp({ db });

    const response = await app.request(`/portfolio/${TEST_USER.walletAddress}`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      totals: { realizedPnl: string; closedPositions: number };
      pnlSeries: Array<{ date: string; cumulativePnl: string }>;
      history: unknown[];
    };
    assert.equal(body.totals.realizedPnl, "0.5");
    assert.equal(body.totals.closedPositions, 1);
    assert.equal(body.history.length, 1);
    assert.ok(body.pnlSeries.length >= 1);
    assert.equal(body.pnlSeries[0]?.cumulativePnl, "0.5");
  });

  it("sums open PnL without parsing formatted strings", async () => {
    const { db } = await testDb();
    await seedPosition(db, { tokenId: "1", marketId: 6 });
    const app = buildApp({
      db,
      chain: fakeChain({
        markets: { 6: { markPrice: 1_200_000_000_000_000_000n } },
        positions: {
          "1": {
            tokenId: "1",
            marketId: 6,
            isLong: true,
            size: 1_000_000_000_000_000_000n,
            entryPrice: 1_000_000_000_000_000_000n,
            margin: 2_000_000_000_000_000_000n,
            lastFundingGrowth: 0n,
            openedAt: Math.floor(NOW.getTime() / 1000) - 3600,
            callId: "0",
            owner: TEST_USER.walletAddress ?? `0x${"ab".repeat(20)}`,
          },
        },
      }),
    });

    const response = await app.request(`/portfolio/${TEST_USER.walletAddress}`);
    assert.equal(response.status, 200, "a decimal PnL must not crash the handler");
    const body = (await response.json()) as {
      totals: { unrealizedPnl: string; realizedPnl: string };
      openPositions: Array<{ pnl: string; equity: string }>;
    };
    assert.equal(body.openPositions[0]?.pnl, "0.2");
    assert.equal(body.openPositions[0]?.equity, "2.2");
    assert.equal(body.totals.unrealizedPnl, "0.2");
  });

  it("filters positions in SQL so a status filter cannot be starved by the limit", async () => {
    const { db } = await testDb();
    for (const tokenId of ["1", "2", "3", "4", "5"]) {
      await seedPosition(db, { tokenId, marketId: 6 });
    }
    await seedPosition(db, { tokenId: "6", marketId: 6, status: "closed", realizedPnl: "1000000000000000000" });
    await seedPosition(db, { tokenId: "7", marketId: 6, status: "closed", realizedPnl: "1000000000000000000" });
    const app = buildApp({ db });

    const response = await app.request("/positions?status=closed&limit=2");
    assert.equal(response.status, 200);
    const body = (await response.json()) as { positions: Array<{ tokenId: string; status: string }>; count: number };
    assert.equal(body.count, 2, "the closed rows are found even though open rows are newer");
    assert.ok(body.positions.every((position) => position.status === "closed"));
  });

  it("serves leaderboard, curators, and the unclaimed board", async () => {
    const { db } = await testDb();
    await db.insert(schema.users).values({ id: "u1", privyId: "did:privy:u1", displayName: "scout" });
    await db.insert(schema.traderStats).values({ address: `0x${"ee".repeat(20)}`, winRate: "0.6", totalPnl: "10", closedPositions: 8, consistency: "0.5", copierCount: 3, reputation: "42" });
    await db.insert(schema.curatorStats).values({ userId: "u1", activeCalls: 1, totalStaked: "100000000", copierCount: 2, closedCalls: 4, profitableCalls: 3, reputation: "30" });
    await db.insert(schema.creators).values({
      id: "c1",
      creatorId: `0x${"22".repeat(32)}`,
      platform: "youtube",
      handle: "@MrBeast",
      verificationStatus: "verified",
      walletAddress: `0x${"bb".repeat(20)}`,
    });
    await db.insert(schema.creatorAccruals).values({ id: "a1", creatorId: `0x${"22".repeat(32)}`, amount: "12500000000000000000", period: "2026-10" });
    const app = buildApp({ db, chain: fakeChain({ creators: { [`0x${"22".repeat(32)}`]: { wallet: `0x${"bb".repeat(20)}`, balance: 12_500_000_000_000_000_000n } } }) });

    const leaderboard = (await (await app.request("/leaderboard")).json()) as { traders: unknown[]; curators: Array<Record<string, unknown>> };
    assert.equal(leaderboard.traders.length, 1);
    assert.equal(leaderboard.curators.length, 1);
    assert.equal(leaderboard.curators[0]?.sampleSize, 4, "sample size is always shown");

    const curators = (await (await app.request("/curators")).json()) as { calls: unknown[] };
    assert.equal(curators.calls.length, 0);

    const unclaimed = (await (await app.request("/creators/unclaimed")).json()) as { creators: Array<Record<string, unknown>> };
    assert.equal(unclaimed.creators.length, 1);
    assert.equal(unclaimed.creators[0]?.accrued, "12.5");
    assert.equal(unclaimed.creators[0]?.escrowBalance, "12.5");
    assert.equal(unclaimed.creators[0]?.linkedWallet, `0x${"bb".repeat(20)}`);
  });

  it("renders a Farcaster frame with signed state", async () => {
    const { db } = await testDb();
    const app = buildApp({ db, signState: (payload) => `sig:${payload.length}` });

    const response = await app.request("/frames/position/1", { method: "POST" });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /fc:frame" content="vNext"/);
    assert.match(html, /fc:frame:button:1" content="Copy on Wavvy"/);
    assert.match(html, /fc:frame:button:2" content="Open Wavvy"/);

    // The state is base64url JSON: decode it and check the signed payload.
    const stateMatch = /fc:frame:state" content="([^"]+)"/.exec(html);
    assert.ok(stateMatch, "the frame carries state");
    const state = JSON.parse(Buffer.from(stateMatch[1] ?? "", "base64url").toString("utf8")) as {
      payload: { status: string; entryPrice: string; expiresAt: number; positionId: string };
      signature: string;
    };
    assert.equal(state.payload.positionId, "1");
    assert.equal(state.payload.status, "open");
    assert.ok(state.payload.expiresAt > Math.floor(NOW.getTime() / 1000));
    assert.match(state.signature, /^sig:/);
  });

  it("disables frames and databases when they are not configured", async () => {
    const withoutFrames = buildApp();
    const frames = await withoutFrames.request("/frames/position/1", { method: "POST" });
    assert.equal(frames.status, 503);
    const framesBody = (await frames.json()) as { error: { code: string } };
    assert.equal(framesBody.error.code, "unavailable");

    const markets = await withoutFrames.request("/markets");
    assert.equal(markets.status, 503, "a read endpoint that needs persistence fails closed");
  });

  it("returns the shared not-found shape for unknown routes", async () => {
    const app = buildApp();
    const response = await app.request("/nope");
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: { code: string; message: string; requestId: string } };
    assert.equal(body.error.code, "not_found");
    assert.ok(body.error.requestId.length > 0);
  });
});