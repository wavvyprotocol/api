import type { AuthUser } from "../../src/auth.ts";
import type { Database } from "../../src/db/client.ts";
import { ensureUser as ensureUserRow } from "../../src/db/queries.ts";
import * as schema from "../../src/db/schema.ts";
import type { Logger } from "../../src/log.ts";

export async function seedContractData(db: Database, log: Logger): Promise<void> {
  await db
    .insert(schema.markets)
    .values({
      id: Number(process.env.CONTRACT_MARKET_ID ?? 6),
      type: "single_name",
      metricId: "0xb3db25596b1e25fbd04af96c3f661b7b328a76b7d266789a32187e14fc0572bd",
      creatorIds: [],
      status: "active",
    })
    .onConflictDoNothing();

  await db
    .insert(schema.users)
    .values({ id: "contract-curator", privyId: "did:privy:contract-curator", displayName: "contract curator" })
    .onConflictDoNothing();

  await db
    .insert(schema.curatorStats)
    .values({ userId: "contract-curator", activeCalls: 0, totalStaked: "0", copierCount: 0, closedCalls: 0, profitableCalls: 0, reputation: "0" })
    .onConflictDoNothing();

  log.info("contract data seeded", { marketId: Number(process.env.CONTRACT_MARKET_ID ?? 6) });
}

export function ensureUser(db: Database, user: AuthUser): Promise<string> {
  return ensureUserRow(db, user);
}