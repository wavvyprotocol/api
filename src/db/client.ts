import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import type { Logger } from "../log.ts";
import * as schema from "./schema.ts";

export type Database = PostgresJsDatabase<typeof schema>;

export type Db = {
  db: Database;
  close(): Promise<void>;
};

export function connect(env: { DATABASE_URL?: string; NODE_ENV?: string }, logger: Logger): Db {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to open the database");
  }
  const sql: Sql = postgres(url, { max: env.NODE_ENV === "production" ? 5 : 1, prepare: false });
  const db = drizzle(sql, { schema });
  logger.info("database client ready", { host: new URL(url).host });
  return {
    db,
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}