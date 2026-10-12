import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";

try {
  process.loadEnvFile(".env");
} catch {
}

const direction = process.argv[2] === "down" ? "down" : "up";
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const sql = postgres(url, { max: 1, prepare: false });
const dir = "drizzle";

const upFiles = readdirSync(dir)
  .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
  .sort();
const downFor = (name: string): string => `${name.replace(/\.sql$/, "")}.down.sql`;

await sql`
  create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`;

if (direction === "up") {
  const applied = new Set<string>((await sql<{ name: string }[]>`select name from schema_migrations`).map((row) => row.name));
  let count = 0;
  for (const name of upFiles) {
    if (applied.has(name)) {
      continue;
    }
    const contents = readFileSync(`${dir}/${name}`, "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    console.log(`applied ${name}`);
    count += 1;
  }
  console.log(count === 0 ? "nothing to apply" : `applied ${count} migration(s)`);
} else {
  const applied = (await sql<{ name: string }[]>`select name from schema_migrations order by name desc`);
  if (applied.length === 0) {
    console.log("nothing to roll back");
  } else {
    const newest = applied[0]?.name;
    if (!newest) {
      throw new Error("migration journal is empty");
    }
    const down = downFor(newest);
    const contents = readFileSync(`${dir}/${down}`, "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`delete from schema_migrations where name = ${newest}`;
    });
    console.log(`rolled back ${newest} via ${down}`);
  }
}

await sql.end({ timeout: 5 });