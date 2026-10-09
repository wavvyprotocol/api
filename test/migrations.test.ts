import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { applyMigrations } from "./helpers.ts";

async function tableNames(pglite: PGlite): Promise<string[]> {
  const result = await pglite.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  return result.rows.map((row) => row.table_name);
}

describe("migrations", () => {
  it("applies every table and rolls the whole set back", async () => {
    const pglite = new PGlite();

    await applyMigrations(pglite, "up");
    const afterUp = await tableNames(pglite);
    for (const table of ["users", "wallets", "markets", "positions", "feed_posts", "reactions", "replies", "creators", "creator_accruals", "curator_calls", "copies", "trader_stats", "curator_stats", "indexer_state"]) {
      assert.ok(afterUp.includes(table), `expected table ${table} after up`);
    }

    await applyMigrations(pglite, "down");
    const afterDown = await tableNames(pglite);
    assert.deepEqual(afterDown, [], "the down migration drops every table it created");

    await pglite.close();
  });

  it("keeps the realized PnL column the portfolio endpoint reads", async () => {
    const pglite = new PGlite();
    await applyMigrations(pglite, "up");
    const columns = await pglite.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'positions'",
    );
    assert.ok(columns.rows.some((row) => row.column_name === "realized_pnl"));
    await pglite.close();
  });
});