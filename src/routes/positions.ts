import { Hono } from "hono";
import type { AppEnv } from "../types.ts";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { notFound } from "../errors.ts";
import { formatWad, positionEquity } from "../math.ts";
import * as queries from "../db/queries.ts";
import { asMetricId, invalidRequestHook, requireDb, type RouteDeps } from "./deps.ts";

const listSchema = z.object({
  owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  marketId: z.string().regex(/^\d+$/).optional(),
  status: z.enum(["open", "closed", "liquidated"]).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

const paramSchema = z.object({ tokenId: z.string().regex(/^\d+$/, "tokenId must be a number") });

async function mergePosition(deps: RouteDeps, tokenId: string) {
  const db = requireDb(deps);
  const [row, chainPosition] = await Promise.all([queries.getPosition(db, tokenId), deps.chain.position(tokenId)]);
  if (!row && !chainPosition) {
    return null;
  }
  const marketId = chainPosition?.marketId ?? row?.marketId ?? 0;
  let markPrice: bigint | null = null;
  let fundingGrowth = 0n;
  try {
    const info = await deps.chain.marketInfo(marketId);
    markPrice = info.markPrice;
    fundingGrowth = info.fundingGrowth;
  } catch (error) {
    deps.log.warn("mark price read failed", {
      tokenId,
      marketId,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const isLong = chainPosition?.isLong ?? row?.side === "long";
  const size = chainPosition?.size ?? 0n;
  const entryPrice = chainPosition?.entryPrice ?? 0n;
  const margin = chainPosition?.margin ?? 0n;
  const lastFundingGrowth = chainPosition?.lastFundingGrowth ?? 0n;

  const equity =
    chainPosition && markPrice !== null
      ? positionEquity({ isLong, size, entryPrice, markPrice, margin, fundingGrowth, lastFundingGrowth })
      : null;

  return {
    tokenId,
    marketId,
    owner: (chainPosition?.owner ?? row?.ownerAddress ?? null) as string | null,
    side: isLong ? "long" : "short",
    size: formatWad(size),
    entryPrice: formatWad(entryPrice),
    margin: formatWad(margin),
    markPrice: markPrice === null ? null : formatWad(markPrice),
    fundingGrowth: fundingGrowth.toString(),
    lastFundingGrowth: lastFundingGrowth.toString(),
    pnl: equity ? formatWad(equity.pnl) : null,
    fundingCost: equity ? formatWad(equity.fundingCost) : null,
    equity: equity ? formatWad(equity.equity) : null,
    leverage: row?.leverage ?? null,
    status: row?.status ?? (chainPosition ? "open" : "unknown"),
    callId: chainPosition?.callId ?? null,
    openedAt: chainPosition?.openedAt
      ? new Date(chainPosition.openedAt * 1000).toISOString()
      : (row?.openedAt.toISOString() ?? null),
    closedAt: row?.closedAt?.toISOString() ?? null,
    source: chainPosition && row ? "chain+indexer" : chainPosition ? "chain" : "indexer",
  };
}

export function positionsRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", zValidator("query", listSchema, invalidRequestHook), deps.limits.read, async (c) => {
    const db = requireDb(deps);
    const query = c.req.valid("query");
    const limit = Math.min(Number(query.limit ?? 50), 100);

    const rows = await queries.listPositions(db, {
      ...(query.owner ? { owner: query.owner } : {}),
      ...(query.marketId ? { marketId: Number(query.marketId) } : {}),
      ...(query.status ? { status: query.status } : {}),
      limit,
    });
    const positions = await Promise.all(rows.map((row) => mergePosition(deps, row.tokenId)));
    const page = positions.filter((entry) => entry !== null);
    return c.json({ positions: page, count: page.length });
  });

  app.get("/:tokenId", zValidator("param", paramSchema, invalidRequestHook), deps.limits.read, async (c) => {
    const { tokenId } = c.req.valid("param");
    const position = await mergePosition(deps, tokenId);
    if (!position) {
      throw notFound(`position ${tokenId} does not exist`);
    }
    return c.json({ position });
  });

  return app;
}