// Applies supabase/setup.sql (every statement is safe to run twice).
// Usage: npm run db:setup   (reads SUPABASE_POOLER_URL and SUPABASE_DB_PASS from .env / .env.local)
import { readFileSync } from "node:fs";
import pg from "pg";

process.loadEnvFile?.(".env");
try { process.loadEnvFile?.(".env.local"); } catch {}

const u = new URL(process.env.SUPABASE_POOLER_URL);
const client = new pg.Client({
  host: u.hostname,
  port: 6543,
  user: decodeURIComponent(u.username),
  password: process.env.SUPABASE_DB_PASS,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query(readFileSync("supabase/setup.sql", "utf8"));
  const { rowCount } = await client.query("select 1 from information_schema.columns where table_name = 'episodes' and column_name = 'payer'");
  console.log(rowCount ? "setup.sql applied (episodes.payer present)" : "applied, but episodes.payer is missing");
} finally {
  await client.end();
}
