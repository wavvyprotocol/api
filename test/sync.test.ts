import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sql } from "postgres";

import { syncIndexerTables, syncIntervalMs } from "../src/indexer-sync.ts";
import { silentLogger } from "./helpers.ts";

type UnsafeCall = { query: string };

function fakeSql(onQuery: (query: string) => number): { sql: Sql; calls: UnsafeCall[] } {
  const calls: UnsafeCall[] = [];
  const sql = {
    unsafe: async (query: string) => {
      calls.push({ query });
      return { count: onQuery(query) };
    },
  } as unknown as Sql;
  return { sql, calls };
}

const TABLES = ["markets", "positions", "trader_stats", "curator_stats", "creator_accruals", "indexer_state"];

describe("syncIntervalMs", () => {
  it("defaults to 60000 when unset or empty", () => {
    assert.equal(syncIntervalMs({}), 60_000);
    assert.equal(syncIntervalMs({ SYNC_INTERVAL_MS: "" }), 60_000);
    assert.equal(syncIntervalMs({ SYNC_INTERVAL_MS: "  " }), 60_000);
  });

  it("returns the configured interval", () => {
    assert.equal(syncIntervalMs({ SYNC_INTERVAL_MS: "120000" }), 120_000);
  });

  it("disables on zero or a non-numeric value", () => {
    assert.equal(syncIntervalMs({ SYNC_INTERVAL_MS: "0" }), undefined);
    assert.equal(syncIntervalMs({ SYNC_INTERVAL_MS: "abc" }), undefined);
    assert.equal(syncIntervalMs({ SYNC_INTERVAL_MS: "-5" }), undefined);
  });
});

describe("syncIndexerTables", () => {
  it("runs every statement and reports rows", async () => {
    const { sql, calls } = fakeSql(() => 3);
    const results = await syncIndexerTables({ sql, schema: "envio", chainId: "10143", log: silentLogger() });

    assert.equal(calls.length, TABLES.length);
    assert.deepEqual(
      results.map((result) => result.table),
      TABLES,
    );
    assert.ok(results.every((result) => result.rows === 3 && result.error === undefined));
    assert.ok(calls.every((call) => call.query.includes('"envio"')));
    assert.ok(
      calls.filter((call) => !call.query.includes("chain_metadata")).every((call) => call.query.includes("$10143")),
    );
  });

  it("isolates a failing statement and keeps going", async () => {
    const { sql, calls } = fakeSql((query) => {
      if (query.includes("curator_stats")) {
        throw new Error("curator_stats exploded");
      }
      return 2;
    });
    const results = await syncIndexerTables({ sql, schema: "envio", chainId: "10143", log: silentLogger() });

    assert.equal(calls.length, TABLES.length, "every statement is attempted");
    const curator = results.find((result) => result.table === "curator_stats");
    assert.equal(curator?.error, "curator_stats exploded");
    assert.equal(curator?.rows, 0);
    const state = results.find((result) => result.table === "indexer_state");
    assert.equal(state?.error, undefined, "the last statement still runs after a failure");
    assert.equal(state?.rows, 2);
  });

  it("rejects an identifier that is not a plain schema name", async () => {
    const { sql } = fakeSql(() => 0);
    await assert.rejects(
      syncIndexerTables({ sql, schema: 'envio"; drop table markets; --', chainId: "10143", log: silentLogger() }),
    );
  });

  it("rejects a non-numeric chain id", async () => {
    const { sql } = fakeSql(() => 0);
    await assert.rejects(
      syncIndexerTables({ sql, schema: "envio", chainId: "1$2", log: silentLogger() }),
    );
  });
});