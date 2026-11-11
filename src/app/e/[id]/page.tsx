import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Player from "@/components/Player";
import { supabaseAdmin, type Episode } from "@/lib/supabase-admin";
import { hostOf } from "@/lib/cover";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

async function getEpisode(id: string): Promise<Episode | null> {
  if (!UUID.test(id)) return null;
  const { data } = await supabaseAdmin().from("episodes").select("*").eq("id", id).maybeSingle();
  return (data as Episode) ?? null;
}

export async function generateMetadata({ params }: PageProps<"/e/[id]">): Promise<Metadata> {
  const ep = await getEpisode((await params).id);
  return ep
    ? { title: `${ep.title} · Podify`, description: `A two-minute audio explainer of a paper from ${hostOf(ep.url)}` }
    : { title: "Episode not found · Podify" };
}

export default async function SharedEpisode({ params }: PageProps<"/e/[id]">) {
  const ep = await getEpisode((await params).id);
  if (!ep) notFound();

  return (
    <>
      <div className="backdrop" aria-hidden>
        <div className="blob blob-a" />
        <div className="blob blob-b" />
        <div className="blob blob-c" />
      </div>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/" className="rise inline-flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <span className="hot grid h-9 w-9 place-items-center rounded-xl text-lg">
            <span className="wobble">🎧</span>
          </span>
          Podify
        </Link>

        <article className="rise glass glow-ring mt-8 rounded-3xl p-6 sm:p-9" style={{ animationDelay: "120ms" }}>
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            From {hostOf(ep.url)} · {new Date(ep.created_at).toLocaleDateString()}
          </div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-5xl">{ep.title}</h1>
          <div className="mt-8">
            <Player src={ep.audio_url} seed={ep.id} big />
          </div>
          <div className="mt-7 flex flex-wrap gap-2 text-sm">
            <a href={ep.url} target="_blank" rel="noreferrer" className="btn rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-zinc-200">
              Read the original ↗
            </a>
            <Link href="/" className="btn hot rounded-full px-4 py-1.5 font-bold text-white">
              Make your own ✨
            </Link>
          </div>
        </article>

        {(ep.takeaways?.length || ep.action) && (
          <div className="rise mt-5 grid gap-4 md:grid-cols-[1.4fr_1fr]" style={{ animationDelay: "240ms" }}>
            {ep.takeaways && ep.takeaways.length > 0 && (
              <section className="glass rounded-3xl p-5">
                <h2 className="font-bold">Takeaways</h2>
                <ol className="mt-3 space-y-2 text-sm">
                  {ep.takeaways.map((t, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="hot grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white">{i + 1}</span>
                      <span className="text-zinc-200">{t}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {ep.action && (
              <div className="note-card h-fit rounded-2xl bg-amber-300 p-5 text-sm text-amber-950 shadow-lg shadow-amber-500/20">
                <div className="text-xs font-black uppercase tracking-wider">📌 Try this week</div>
                <p className="mt-1.5 font-medium leading-snug">{ep.action}</p>
              </div>
            )}
          </div>
        )}

        <details className="rise glass mt-5 rounded-3xl p-5" style={{ animationDelay: "320ms" }}>
          <summary className="cursor-pointer font-bold">📜 Transcript</summary>
          <p className="mt-3 whitespace-pre-line leading-relaxed text-zinc-300">{ep.script}</p>
        </details>
      </main>
    </>
  );
}
