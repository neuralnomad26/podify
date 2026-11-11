import { connection } from "next/server";
import PodifyApp from "@/components/PodifyApp";
import { env } from "@/lib/env";
import { supabaseAdmin, type Episode } from "@/lib/supabase-admin";

/** The episode visitors can play on the landing page, and how many records exist. Both optional. */
async function showcase(): Promise<{ featured: Episode | null; total: number }> {
  try {
    const admin = supabaseAdmin();
    const [{ data }, { count }] = await Promise.all([
      admin.from("episodes").select("id, url, title, script, audio_url, created_at, takeaways, action, audio_bytes, user_id").eq("featured", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("episodes").select("id", { count: "exact", head: true }),
    ]);
    return { featured: (data as Episode) ?? null, total: count ?? 0 };
  } catch {
    return { featured: null, total: 0 };
  }
}

export default async function Home() {
  // Read config at request time so env vars set by Stripe Projects are picked up
  // without needing NEXT_PUBLIC_ names. The anon/publishable key is safe to expose.
  await connection();
  let config: { url: string; anonKey: string } | null = null;
  try {
    config = { url: env.supabaseUrl(), anonKey: env.supabaseAnonKey() };
  } catch {}

  if (!config) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-3xl font-bold">Podify isn&apos;t configured yet</h1>
        <p className="mt-4 text-zinc-400">
          Supabase env vars are missing. Run the Stripe Projects setup, then open{" "}
          <code className="text-violet-300">/api/health</code> to check.
        </p>
      </main>
    );
  }
  const { featured, total } = await showcase();
  return <PodifyApp supabaseUrl={config.url} supabaseAnonKey={config.anonKey} featured={featured} total={total} />;
}
