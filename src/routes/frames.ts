import { Hono } from "hono";
import type { AppEnv } from "../types.ts";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { notFound, unavailable } from "../errors.ts";
import { formatWad, positionEquity } from "../math.ts";
import { DEFAULT_APP_URL, invalidRequestHook, type RouteDeps } from "./deps.ts";

const paramSchema = z.object({ id: z.string().regex(/^\d+$/, "position id must be a token id") });

const STATE_TTL_SECONDS = 300;

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function framesRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/position/:id", zValidator("param", paramSchema, invalidRequestHook), async (c) => {
    if (!deps.signState) {
      throw unavailable("frames are disabled: set FRAME_SIGNING_SECRET");
    }
    const { id } = c.req.valid("param");
    const position = await deps.chain.position(id);
    if (!position) {
      throw notFound(`position ${id} does not exist`);
    }

    let markPrice: bigint | null = null;
    let fundingGrowth = 0n;
    try {
      const info = await deps.chain.marketInfo(position.marketId);
      markPrice = info.markPrice;
      fundingGrowth = info.fundingGrowth;
    } catch (error) {
      deps.log.warn("frame mark price read failed", {
        tokenId: id,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    const equity =
      markPrice === null
        ? null
        : positionEquity({
            isLong: position.isLong,
            size: position.size,
            entryPrice: position.entryPrice,
            markPrice,
            margin: position.margin,
            fundingGrowth,
            lastFundingGrowth: position.lastFundingGrowth,
          });

    const now = deps.now ? deps.now() : new Date();
    const payload = {
      positionId: id,
      marketId: position.marketId,
      side: position.isLong ? "long" : "short",
      entryPrice: formatWad(position.entryPrice),
      markPrice: markPrice === null ? null : formatWad(markPrice),
      pnl: equity ? formatWad(equity.pnl) : null,
      status: "open",
      expiresAt: Math.floor(now.getTime() / 1000) + STATE_TTL_SECONDS,
    };
    const payloadJson = JSON.stringify(payload);
    const signature = deps.signState(payloadJson);
    const state = Buffer.from(JSON.stringify({ payload, signature })).toString("base64url");

    const appUrl = deps.publicAppUrl ?? DEFAULT_APP_URL;
    const imageUrl = `${appUrl}/og/position/${id}.png`;
    const title = `Position #${id}: ${payload.side} market ${payload.marketId}`;
    const description = `Entry ${payload.entryPrice} | Mark ${payload.markPrice ?? "n/a"} | PnL ${payload.pnl ?? "n/a"}`;

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeAttribute(title)}</title>
    <meta property="og:title" content="${escapeAttribute(title)}" />
    <meta property="og:description" content="${escapeAttribute(description)}" />
    <meta property="og:image" content="${escapeAttribute(imageUrl)}" />
    <meta name="fc:frame" content="vNext" />
    <meta name="fc:frame:image" content="${escapeAttribute(imageUrl)}" />
    <meta name="fc:frame:image:aspect_ratio" content="1.91:1" />
    <meta name="fc:frame:state" content="${escapeAttribute(state)}" />
    <meta name="fc:frame:button:1" content="Copy on Wavvy" />
    <meta name="fc:frame:button:1:action" content="link" />
    <meta name="fc:frame:button:1:target" content="${escapeAttribute(`${appUrl}/position/${id}?action=copy`)}" />
    <meta name="fc:frame:button:2" content="Open Wavvy" />
    <meta name="fc:frame:button:2:action" content="link" />
    <meta name="fc:frame:button:2:target" content="${escapeAttribute(`${appUrl}/position/${id}`)}" />
  </head>
  <body>
    <p>${escapeAttribute(description)}</p>
    <p>Final position status is always re-read from the chain before copy execution.</p>
  </body>
</html>`;

    deps.log.debug("frame rendered", { tokenId: id, marketId: position.marketId });
    return c.html(html);
  });

  return app;
}