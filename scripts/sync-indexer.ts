import postgres from "postgres";
import { syncIndexerTables } from "../src/indexer-sync.ts";
import { createLogger } from "../src/log.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: the environment is expected to provide everything.
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
const indexerSchema = process.env.INDEXER_PG_SCHEMA ?? "envio";
const chainId = process.env.INDEXER_CHAIN_ID ?? "10143";
const log = createLogger({ level: "error" });

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  ssl: process.env.ENVIO_PG_SSL_MODE === "require" ? "require" : undefined,
});

const results = await syncIndexerTables({ sql, schema: indexerSchema, chainId, log });
for (const result of results) {
  if (result.error !== undefined) {
    console.log(`${result.table}: error: ${result.error}`);
  } else {
    console.log(`${result.table}: ${result.rows} rows`);
  }
}

await sql`select 1`;
await sql.end({ timeout: 5 });