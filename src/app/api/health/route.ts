import { db } from "@/lib/db";
import { envStatus } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/** Quick setup check: open /api/health after deploying. */
export async function GET() {
  const vars = envStatus();
  let database: string = "skipped (Supabase env missing)";
  if (vars.supabaseUrl && vars.supabaseServiceKey) {
    const { error } = await supabaseAdmin().from("episodes").select("payer").limit(1);
    database = error ? `error: ${error.message} — run supabase/setup.sql` : "ok";
  }
  // MPP replay protection lives in Postgres: the paid agent API needs this connection.
  let payments = "skipped (MPP or database env missing)";
  if (vars.mppSecret && vars.mppRecipient && vars.dbPoolerUrl && vars.dbPassword) {
    payments = await db().query("select 1").then(() => "ok", (e: Error) => `error: ${e.message}`);
  }
  const ok = Object.values(vars).every(Boolean) && database === "ok" && payments === "ok";
  return Response.json({ ok, env: vars, database, payments }, { status: ok ? 200 : 500 });
}
