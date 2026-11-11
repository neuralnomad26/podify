import { connection } from "next/server";
import PodifyApp from "@/components/PodifyApp";
import { env } from "@/lib/env";

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
  return <PodifyApp supabaseUrl={config.url} supabaseAnonKey={config.anonKey} />;
}
