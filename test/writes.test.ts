import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ensureUser } from "../src/db/queries.ts";
import { createRateLimiter, type RateLimiter } from "../src/rate-limit.ts";
import {
  OTHER_USER,
  TEST_USER,
  authVerifierFor,
  authHeaders,
  buildApp,
  fakeChain,
  jsonHeaders,
  seedFeedPost,
  seedMarket,
  seedPosition,
  silentLogger,
  testDb,
  schema,
} from "./helpers.ts";

const CREATOR_ID = `0x${"22".repeat(32)}`;
const CREATOR_WALLET = `0x${"bb".repeat(20)}` as `0x${string}`;

function writesApp(db: Awaited<ReturnType<typeof testDb>>["db"], options: Parameters<typeof buildApp>[0] = {}) {
  return buildApp({
    db,
    verify: authVerifierFor(TEST_USER),
    verifyAdminToken: "admin-token-32-chars-minimum",
    claimTarget: `0x${"cc".repeat(20)}` as `0x${string}`,
    ...options,
  });
}

describe("write endpoints", () => {
  it("rejects unauthenticated writes with 401 and the shared shape", async () => {
    const { db } = await testDb();
    await seedPosition(db, { tokenId: "1", marketId: 6 });
    await seedFeedPost(db, "1", "seed");
    const app = writesApp(db);

    for (const [method, path, body] of [
      ["POST", "/feed/1/thesis", { thesis: "hi" }],
      ["POST", "/feed/1/react", { kind: "like" }],
      ["POST", "/feed/1/reply", { body: "hi" }],
      ["POST", "/curators/calls", { marketId: 6, targetTrader: TEST_USER.walletAddress, thesis: "t", stakeAmount: "1" }],
      ["POST", "/creator/verify", { platform: "youtube", handle: "x" }],
      ["POST", "/creator/claim", { creatorId: CREATOR_ID }],
    ] as const) {
      const response = await app.request(path, { method, headers: jsonHeaders(), body: JSON.stringify(body) });
      assert.equal(response.status, 401, `${path} must reject unauthenticated writes`);
      const parsed = (await response.json()) as { error: { code: string } };
      assert.equal(parsed.error.code, "unauthorized");
    }
  });

  it("rejects a bad token and accepts a good one", async () => {
    const { db } = await testDb();
    await seedPosition(db, { tokenId: "1", marketId: 6 });
    await seedFeedPost(db, "1", "seed");
    const app = writesApp(db);

    const bad = await app.request("/feed/1/thesis", {
      method: "POST",
      headers: authHeaders("wrong-token"),
      body: JSON.stringify({ thesis: "hello" }),
    });
    assert.equal(bad.status, 401);

    const good = await app.request("/feed/1/thesis", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ thesis: "hello" }),
    });
    assert.equal(good.status, 200);
    const body = (await good.json()) as { thesis: string };
    assert.equal(body.thesis, "hello");
  });

  it("refuses when authentication is not configured", async () => {
    const { db } = await testDb();
    const app = buildApp({ db });
    const response = await app.request("/feed/1/thesis", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ thesis: "hello" }),
    });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "unavailable");
  });

  it("enforces authorship on the thesis", async () => {
    const { db } = await testDb();
    await seedPosition(db, { tokenId: "1", marketId: 6 });
    await seedFeedPost(db, "1", "seed");
    const app = buildApp({ db, verify: authVerifierFor(OTHER_USER) });

    const response = await app.request("/feed/1/thesis", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ thesis: "not mine" }),
    });
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "forbidden");
  });

  it("caps the thesis and the reply at 280 characters", async () => {
    const { db } = await testDb();
    await seedPosition(db, { tokenId: "1", marketId: 6 });
    await seedFeedPost(db, "1", "seed");
    const app = writesApp(db);

    const longThesis = await app.request("/feed/1/thesis", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ thesis: "x".repeat(281) }),
    });
    assert.equal(longThesis.status, 400);

    const emptyReply = await app.request("/feed/1/reply", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ body: "   " }),
    });
    assert.equal(emptyReply.status, 400);

    const longReply = await app.request("/feed/1/reply", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ body: "x".repeat(281) }),
    });
    assert.equal(longReply.status, 400);
  });

  it("records reactions and replies and counts them", async () => {
    const { db } = await testDb();
    await seedPosition(db, { tokenId: "1", marketId: 6 });
    await seedFeedPost(db, "1", "seed");
    const app = writesApp(db);

    const reaction = await app.request("/feed/1/react", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ kind: "like" }),
    });
    assert.equal(reaction.status, 200);
    const reactionBody = (await reaction.json()) as { created: boolean; reactions: { like: number } };
    assert.equal(reactionBody.created, true);
    assert.equal(reactionBody.reactions.like, 1);

    const again = await app.request("/feed/1/react", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ kind: "like" }),
    });
    const againBody = (await again.json()) as { created: boolean; reactions: { like: number } };
    assert.equal(againBody.created, false, "a repeated reaction is idempotent");
    assert.equal(againBody.reactions.like, 1);

    const reply = await app.request("/feed/1/reply", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ body: "nice trade" }),
    });
    assert.equal(reply.status, 201);
    const replyBody = (await reply.json()) as { body: string };
    assert.equal(replyBody.body, "nice trade");
  });

  it("publishes a staked call only on a real market with a positive stake", async () => {
    const { db } = await testDb();
    await seedMarket(db, { id: 6 });
    const app = writesApp(db, { chain: fakeChain({ markets: { 999: { exists: false } } }) });

    const unknownMarket = await app.request("/curators/calls", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ marketId: 999, targetTrader: TEST_USER.walletAddress, thesis: "t", stakeAmount: "1" }),
    });
    assert.equal(unknownMarket.status, 400);

    const zeroStake = await app.request("/curators/calls", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ marketId: 6, targetTrader: TEST_USER.walletAddress, thesis: "t", stakeAmount: "0" }),
    });
    assert.equal(zeroStake.status, 400);

    const created = await app.request("/curators/calls", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        marketId: 6,
        targetTrader: TEST_USER.walletAddress,
        thesis: "long MrBeast",
        stakeAmount: "100000000",
        stakeTxHash: `0x${"7b".repeat(32)}`,
      }),
    });
    assert.equal(created.status, 201);
    const body = (await created.json()) as { id: string; stakeAmount: string };
    assert.equal(body.stakeAmount, "100000000");

    const list = (await (await app.request("/curators")).json()) as { calls: Array<Record<string, unknown>> };
    assert.equal(list.calls.length, 1);
    assert.equal(list.calls[0]?.targetTrader, (TEST_USER.walletAddress ?? "").toLowerCase());
  });

  it("verifies the stake transaction before a call becomes active", async () => {
    const { db } = await testDb();
    await seedMarket(db, { id: 6 });
    const stakeTxHash = `0x${"5a".repeat(32)}`;
    const body = {
      marketId: 6,
      targetTrader: TEST_USER.walletAddress,
      thesis: "long MrBeast",
      stakeAmount: "1000000000000000000",
      stakeTxHash,
    };

    const rejected = writesApp(db, {
      chain: fakeChain({ stakes: { [stakeTxHash]: { status: "rejected", reason: "the staked amount does not match the transaction" } } }),
    });
    const rejectedResponse = await rejected.request("/curators/calls", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    assert.equal(rejectedResponse.status, 400);
    const rejectedBody = (await rejectedResponse.json()) as { error: { message: string } };
    assert.match(rejectedBody.error.message, /could not be verified/);

    const pending = writesApp(db, { chain: fakeChain({ stakes: { [stakeTxHash]: { status: "pending" } } }) });
    const pendingResponse = await pending.request("/curators/calls", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    assert.equal(pendingResponse.status, 201);
    const pendingBody = (await pendingResponse.json()) as { status: string; onchainCallId: string | null };
    assert.equal(pendingBody.status, "pending", "an unmined stake never becomes active");
    assert.equal(pendingBody.onchainCallId, null);

    const verified = writesApp(db, { chain: fakeChain({ stakes: { [stakeTxHash]: { status: "verified", callId: "9", stake: 1_000_000_000_000_000_000n } } }) });
    const verifiedResponse = await verified.request("/curators/calls", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    assert.equal(verifiedResponse.status, 201);
    const verifiedBody = (await verifiedResponse.json()) as { status: string; onchainCallId: string };
    assert.equal(verifiedBody.status, "active");
    assert.equal(verifiedBody.onchainCallId, "9");

    const missingHash = await verified.request("/curators/calls", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ marketId: 6, targetTrader: TEST_USER.walletAddress, thesis: "t", stakeAmount: "1" }),
    });
    assert.equal(missingHash.status, 400, "a stake without a transaction hash cannot be verified");
  });

  it("keeps the feed boost away from a pending call", async () => {
    const { db } = await testDb();
    await seedMarket(db, { id: 6 });
    await seedPosition(db, { tokenId: "1", marketId: 6 });
    await seedFeedPost(db, "1", "pending call post");
    await db.insert(schema.users).values({ id: "curator-2", privyId: "did:privy:curator-2" });
    await db.insert(schema.curatorCalls).values({
      id: "call-pending",
      curatorUserId: "curator-2",
      targetTrader: TEST_USER.walletAddress ?? "",
      thesis: "not staked yet",
      stakeAmount: "999000000000000000000",
      onchainCallId: null,
      status: "pending",
    });
    const app = buildApp({ db, chain: fakeChain({ positions: { "1": { tokenId: "1", marketId: 6, isLong: true, size: 0n, entryPrice: 1_000_000_000_000_000_000n, margin: 0n, lastFundingGrowth: 0n, openedAt: 1, callId: "0", owner: TEST_USER.walletAddress ?? "" } } }) });

    const feed = (await (await app.request("/feed")).json()) as { feed: Array<{ staked: boolean }> };
    assert.equal(feed.feed[0]?.staked, false, "client-supplied stake amounts never set the boost");
  });

  it("only the account that asked for the challenge can submit the proof", async () => {
    const { db } = await testDb();
    const owner = writesApp(db);
    const challenge = await owner.request("/creator/verify", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ platform: "youtube", handle: "@MrBeast" }),
    });
    const challengeBody = (await challenge.json()) as { creatorId: string };

    const other = buildApp({ db, verify: authVerifierFor(OTHER_USER) });
    const stolen = await other.request("/creator/verify", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ creatorId: challengeBody.creatorId, proofUrl: "https://youtube.com/@MrBeast" }),
    });
    assert.equal(stolen.status, 403);
  });

  it("walks the creator verification state machine", async () => {
    const { db } = await testDb();
    const app = writesApp(db, { chain: fakeChain({ creators: { [CREATOR_ID]: { wallet: CREATOR_WALLET, balance: 5_000_000_000_000_000_000n } } }) });

    const challenge = await app.request("/creator/verify", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ platform: "youtube", handle: "@MrBeast" }),
    });
    assert.equal(challenge.status, 201);
    const challengeBody = (await challenge.json()) as { creatorId: string; challenge: string; step: string };
    assert.equal(challengeBody.step, "challenge_issued");
    assert.match(challengeBody.challenge, /^wavvy-[0-9a-f]{10}$/);

    const proof = await app.request("/creator/verify", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ creatorId: challengeBody.creatorId, proofUrl: "https://youtube.com/@MrBeast" }),
    });
    assert.equal(proof.status, 200);
    const proofBody = (await proof.json()) as { step: string };
    assert.equal(proofBody.step, "proof_submitted");

    const wrongAdmin = await app.request("/creator/verify/approve", {
      method: "POST",
      headers: { ...jsonHeaders(), "x-admin-token": "not-the-token" },
      body: JSON.stringify({ creatorId: challengeBody.creatorId, walletAddress: CREATOR_WALLET }),
    });
    assert.equal(wrongAdmin.status, 403);

    const approved = await app.request("/creator/verify/approve", {
      method: "POST",
      headers: { ...jsonHeaders(), "x-admin-token": "admin-token-32-chars-minimum" },
      body: JSON.stringify({ creatorId: challengeBody.creatorId, walletAddress: CREATOR_WALLET }),
    });
    assert.equal(approved.status, 200);
    const approvedBody = (await approved.json()) as { step: string; walletAddress: string };
    assert.equal(approvedBody.step, "verified");
    assert.equal(approvedBody.walletAddress, CREATOR_WALLET);
  });

  it("disables manual verification when no admin token is configured", async () => {
    const { db } = await testDb();
    const app = buildApp({ db, verify: authVerifierFor(TEST_USER) });
    const response = await app.request("/creator/verify/approve", {
      method: "POST",
      headers: { ...jsonHeaders(), "x-admin-token": "anything" },
      body: JSON.stringify({ creatorId: CREATOR_ID, walletAddress: CREATOR_WALLET }),
    });
    assert.equal(response.status, 503);
  });

  it("prepares a creator claim for the linked wallet only", async () => {
    const { db } = await testDb();
    await db.insert(schema.creators).values({
      id: "c1",
      creatorId: CREATOR_ID,
      platform: "youtube",
      handle: "@MrBeast",
      verificationStatus: "verified",
      walletAddress: CREATOR_WALLET,
      verifiedAt: new Date(),
    });

    const wrongWallet = buildApp({
      db,
      verify: authVerifierFor(TEST_USER),
      claimTarget: `0x${"cc".repeat(20)}` as `0x${string}`,
      chain: fakeChain({ creators: { [CREATOR_ID]: { wallet: CREATOR_WALLET, balance: 5_000_000_000_000_000_000n } } }),
    });
    const forbidden = await wrongWallet.request("/creator/claim", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ creatorId: CREATOR_ID }),
    });
    assert.equal(forbidden.status, 403);

    const linked = buildApp({
      db,
      verify: authVerifierFor({ privyUserId: "did:privy:creator", walletAddress: CREATOR_WALLET }),
      claimTarget: `0x${"cc".repeat(20)}` as `0x${string}`,
      chain: fakeChain({ creators: { [CREATOR_ID]: { wallet: CREATOR_WALLET, balance: 5_000_000_000_000_000_000n } } }),
    });
    const response = await linked.request("/creator/claim", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ creatorId: CREATOR_ID }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { amount: string; transaction: { to: string; data: string; value: string; chainId: number } };
    assert.equal(body.amount, "5");
    assert.equal(body.transaction.to, `0x${"cc".repeat(20)}`);
    assert.match(body.transaction.data, /^0x[0-9a-f]+$/);
    assert.equal(body.transaction.value, "0");
    assert.equal(body.transaction.chainId, 10143);
  });

  it("409s a claim with nothing to collect", async () => {
    const { db } = await testDb();
    await db.insert(schema.creators).values({
      id: "c1",
      creatorId: CREATOR_ID,
      platform: "youtube",
      handle: "@MrBeast",
      verificationStatus: "verified",
      walletAddress: CREATOR_WALLET,
    });
    const app = buildApp({
      db,
      verify: authVerifierFor({ privyUserId: "did:privy:creator", walletAddress: CREATOR_WALLET }),
      claimTarget: `0x${"cc".repeat(20)}` as `0x${string}`,
      chain: fakeChain({ creators: { [CREATOR_ID]: { wallet: CREATOR_WALLET, balance: 0n } } }),
    });
    const response = await app.request("/creator/claim", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ creatorId: CREATOR_ID }),
    });
    assert.equal(response.status, 409);
  });

  it("rate limits writes with the shared error shape", async () => {
    const { db } = await testDb();
    await seedPosition(db, { tokenId: "1", marketId: 6 });
    await seedFeedPost(db, "1", "seed");
    const blockingLimiter: RateLimiter = {
      backend: "memory",
      async check() {
        return { allowed: false, remaining: 0, resetSeconds: 30 };
      },
    };
    const app = writesApp(db, { limiter: blockingLimiter });

    const response = await app.request("/feed/1/reply", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ body: "hello" }),
    });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "30");
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "rate_limited");
  });

  it("applies a second rate bucket keyed by the authenticated user", async () => {
    const { db } = await testDb();
    await seedMarket(db, { id: 6 });
    const keys: string[] = [];
    const recording: RateLimiter = {
      backend: "memory",
      async check(key, policy) {
        keys.push(`${policy.name}:${key}`);
        return { allowed: true, remaining: 5, resetSeconds: 30 };
      },
    };
    const app = writesApp(db, { limiter: recording });

    const response = await app.request("/curators/calls", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        marketId: 6,
        targetTrader: TEST_USER.walletAddress,
        thesis: "t",
        stakeAmount: "1",
        stakeTxHash: `0x${"9c".repeat(32)}`,
      }),
    });
    assert.equal(response.status, 201);
    assert.ok(
      keys.some((key) => key.startsWith(`write-user:user:${TEST_USER.privyUserId}`)),
      `expected a user bucket, saw ${keys.join(", ")}`,
    );
  });

  it("links concurrent first requests to one user without a unique violation", async () => {
    const { db } = await testDb();
    const results = await Promise.all([
      ensureUser(db, TEST_USER),
      ensureUser(db, TEST_USER),
      ensureUser(db, TEST_USER),
    ]);

    assert.equal(new Set(results).size, 1, "all three calls resolve to the same user id");
    const rows = await db.select().from(schema.users);
    assert.equal(rows.length, 1);
    const linkedWallets = await db.select().from(schema.wallets);
    assert.equal(linkedWallets.length, 1);
    assert.equal(linkedWallets[0]?.isPrimary, true);
  });

  it("keeps exactly one primary wallet per user", async () => {
    const { db } = await testDb();
    await ensureUser(db, TEST_USER);
    await ensureUser(db, { ...TEST_USER, walletAddress: OTHER_USER.walletAddress });

    const rows = await db.select().from(schema.wallets);
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.isPrimary).length, 1, "linking a second wallet demotes the first");
  });

  it("moves an address-keyed curator_stats row onto the user id when a wallet links", async () => {
    const { db } = await testDb();
    const address = (TEST_USER.walletAddress as string).toLowerCase();
    await db.insert(schema.curatorStats).values({ userId: address, activeCalls: 5 });

    const userId = await ensureUser(db, TEST_USER);

    const rows = await db.select().from(schema.curatorStats);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.userId, userId);
    assert.equal(rows[0]?.activeCalls, 5, "the linked row keeps its stats");
  });

  it("drops the stale address-keyed curator_stats row when the user already has one", async () => {
    const { db } = await testDb();
    const address = (TEST_USER.walletAddress as string).toLowerCase();
    const userId = await ensureUser(db, TEST_USER);
    await db.insert(schema.curatorStats).values({ userId, activeCalls: 9 });
    await db.insert(schema.curatorStats).values({ userId: address, activeCalls: 1 });

    await ensureUser(db, TEST_USER);

    const rows = await db.select().from(schema.curatorStats);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.userId, userId);
    assert.equal(rows[0]?.activeCalls, 9, "the user's own row wins");
  });

  it("counts requests through the memory limiter and then refuses", async () => {
    const { db } = await testDb();
    await seedMarket(db, { id: 6 });
    const limiter = createRateLimiter({}, silentLogger());
    const app = buildApp({ db, limiter });
    let last = 200;
    for (let attempt = 0; attempt < 121; attempt += 1) {
      const response = await app.request("/markets");
      last = response.status;
      if (last === 429) break;
    }
    assert.equal(last, 429, "the read bucket is 120 per minute");
  });
});