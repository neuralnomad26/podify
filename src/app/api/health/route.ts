import { envStatus } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/** Quick setup check: open /api/health after deploying. */
export async function GET() {
  const vars = envStatus();
  let database: string = "skipped (Supabase env missing)";
  if (vars.supabaseUrl && vars.supabaseServiceKey) {
    const { error } = await supabaseAdmin().from("episodes").select("id").limit(1);
    database = error ? `error: ${error.message} — run supabase/setup.sql` : "ok";
  }
  const ok = Object.values(vars).every(Boolean) && database === "ok";
  return Response.json({ ok, env: vars, database }, { status: ok ? 200 : 500 });
}
