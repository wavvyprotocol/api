import { Hono } from "hono";
import type { AppEnv } from "../types.ts";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { formatWad, positionEquity } from "../math.ts";
import * as queries from "../db/queries.ts";
import { invalidRequestHook, requireDb, type RouteDeps } from "./deps.ts";

const paramSchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "wallet must be a 20-byte hex address"),
});

const SERIES_DAYS = 30;

export function portfolioRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/:wallet", zValidator("param", paramSchema, invalidRequestHook), deps.limits.read, async (c) => {
    const db = requireDb(deps);
    const wallet = c.req.valid("param").wallet.toLowerCase();

    const rows = await queries.positionsByOwner(db, wallet);
    const open = rows.filter((row) => row.status === "open");
    const closed = rows.filter((row) => row.status !== "open");

    const openWithPnl = await Promise.all(
      open.map(async (row) => {
        const chainPosition = await deps.chain.position(row.tokenId);
        let markPrice: bigint | null = null;
        let fundingGrowth = 0n;
        try {
          const info = await deps.chain.marketInfo(row.marketId);
          markPrice = info.markPrice;
          fundingGrowth = info.fundingGrowth;
        } catch {
          markPrice = null;
        }
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
        return {
          tokenId: row.tokenId,
          marketId: row.marketId,
          side: chainPosition ? (chainPosition.isLong ? "long" : "short") : row.side,
          size: formatWad(chainPosition?.size ?? 0n),
          entryPrice: formatWad(chainPosition?.entryPrice ?? 0n),
          margin: formatWad(chainPosition?.margin ?? 0n),
          markPrice: markPrice === null ? null : formatWad(markPrice),
          pnl: equity ? formatWad(equity.pnl) : null,
          equity: equity ? formatWad(equity.equity) : null,
          openedAt: row.openedAt.toISOString(),
          pnlRaw: equity?.pnl ?? 0n,
        };
      }),
    );

    const realized = closed
      .filter((row) => row.realizedPnl !== null)
      .reduce((total, row) => total + BigInt(row.realizedPnl ?? "0"), 0n);
    const unrealized = openWithPnl.reduce((total, row) => total + row.pnlRaw, 0n);

    const since = new Date((deps.now ? deps.now() : new Date()).getTime() - SERIES_DAYS * 24 * 60 * 60 * 1000);
    const closedRecent = await queries.closedPositionsSince(db, wallet, since);
    const byDay = new Map<string, bigint>();
    for (const row of closedRecent) {
      if (!row.closedAt) continue;
      const day = row.closedAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0n) + BigInt(row.realizedPnl ?? "0"));
    }
    let running = 0n;
    const pnlSeries = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, daily]) => {
        running += daily;
        return { date: day, realizedPnl: formatWad(daily), cumulativePnl: formatWad(running) };
      });
    pnlSeries.push({
      date: (deps.now ? deps.now() : new Date()).toISOString().slice(0, 10),
      realizedPnl: "0",
      cumulativePnl: formatWad(running + unrealized),
    });

    const openPositions = openWithPnl.map(({ pnlRaw, ...position }) => {
      void pnlRaw;
      return position;
    });

    return c.json({
      wallet,
      openPositions,
      history: closed.map((row) => ({
        tokenId: row.tokenId,
        marketId: row.marketId,
        side: row.side,
        size: formatWad(0n),
        margin: row.margin,
        entryPrice: row.entryPrice,
        realizedPnl: row.realizedPnl === null ? null : formatWad(BigInt(row.realizedPnl)),
        openedAt: row.openedAt.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null,
        status: row.status,
      })),
      totals: {
        openPositions: openWithPnl.length,
        closedPositions: closed.length,
        realizedPnl: formatWad(realized),
        unrealizedPnl: formatWad(unrealized),
      },
      pnlSeries,
      source: "chain+indexer",
    });
  });

  return app;
}