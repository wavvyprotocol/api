import { Hono } from "hono";
import type { AppEnv } from "../types.ts";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { notFound } from "../errors.ts";
import { formatWad, changeBps } from "../math.ts";
import * as queries from "../db/queries.ts";
import { DEFAULT_APP_URL, asMetricId, invalidRequestHook, requireDb, type RouteDeps } from "./deps.ts";

const paramSchema = z.object({ id: z.string().regex(/^\d+$/, "market id must be a number") });

const DAY_SECONDS = 86_400;

export function marketsRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", deps.limits.read, async (c) => {
    const db = requireDb(deps);
    const rows = await queries.listMarkets(db);
    const cards = await Promise.all(
      rows.map(async (market) => {
        const info = await deps.chain.marketInfo(market.id);
        const status = await oracleStatus(deps, asMetricId(market.metricId));
        return {
          marketId: market.id,
          type: market.type,
          status: market.status,
          metricId: market.metricId,
          markPrice: info.markPrice === null ? null : formatWad(info.markPrice),
          metricValue: status?.value === undefined ? null : status.value.toString(),
          change24hBps: status?.change24hBps ?? null,
          oracleState: status?.state ?? "not_registered",
          openInterestLong: formatWad(info.openInterestLong),
          openInterestShort: formatWad(info.openInterestShort),
          fundingGrowth: info.fundingGrowth.toString(),
          updatedAt: new Date().toISOString(),
        };
      }),
    );
    return c.json({ markets: cards, source: "chain+oracle", site: DEFAULT_APP_URL });
  });

  app.get("/:id", zValidator("param", paramSchema, invalidRequestHook), deps.limits.read, async (c) => {
    const db = requireDb(deps);
    const { id } = c.req.valid("param");
    const marketId = Number(id);
    const row = await queries.getMarket(db, marketId);
    const info = await deps.chain.marketInfo(marketId);
    if (!row && !info.exists) {
      throw notFound(`market ${marketId} does not exist`);
    }

    const index =
      row?.type === "index" || info.type === "index" ? await deps.chain.indexValue(marketId) : null;
    const status = await oracleStatus(deps, asMetricId(row?.metricId) ?? info.metricId);

    return c.json({
      marketId,
      type: row?.type ?? info.type,
      status: row?.status ?? "active",
      metricId: row?.metricId ?? info.metricId,
      creatorIds: info.creatorIds,
      markPrice: info.markPrice === null ? null : formatWad(info.markPrice),
      indexValue: index ? formatWad(index.value) : null,
      indexValid: index ? index.valid : null,
      oracle: status
        ? {
            state: status.state,
            value: status.value.toString(),
            twap: status.twap === null ? null : status.twap.toString(),
            lastUpdateAt: status.lastUpdateAt,
            change24hBps: status.change24hBps,
            fresh: status.fresh,
            suspended: status.suspended,
            frozen: status.frozen,
          }
        : null,
      openInterestLong: formatWad(info.openInterestLong),
      openInterestShort: formatWad(info.openInterestShort),
      fundingGrowth: info.fundingGrowth.toString(),
    });
  });

  return app;
}

async function oracleStatus(
  deps: RouteDeps,
  metricId: `0x${string}` | null | undefined,
): Promise<{
  state: string;
  value: bigint;
  twap: bigint | null;
  lastUpdateAt: number;
  change24hBps: number;
  fresh: boolean;
  suspended: boolean;
  frozen: boolean;
} | null> {
  if (!metricId) {
    return null;
  }
  try {
    const status = await deps.chain.oracleStatus(metricId);
    const twap = await deps.chain.twap(metricId, DAY_SECONDS);
    const change24hBps = twap === null ? 0 : changeBps(status.value, twap);
    return {
      state: status.state,
      value: status.value,
      twap,
      lastUpdateAt: status.lastUpdateAt,
      change24hBps,
      fresh: status.fresh,
      suspended: status.suspended,
      frozen: status.frozen,
    };
  } catch (error) {
    deps.log.warn("oracle status read failed", {
      metricId,
      cause: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export const DAY = DAY_SECONDS;