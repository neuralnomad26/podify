import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin, type Episode } from "@/lib/supabase-admin";
import { coverGradient, hostOf } from "@/lib/cover";

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
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
        🎧 Podify
      </Link>
      <div
        className="mt-6 grid aspect-[2/1] place-items-center rounded-3xl text-7xl shadow-2xl"
        style={{ background: coverGradient(ep.id) }}
      >
        🎙️
      </div>
      <div className="mt-8 text-xs uppercase tracking-wider text-zinc-500">
        From {hostOf(ep.url)} · {new Date(ep.created_at).toLocaleDateString()}
      </div>
      <h1 className="mt-2 text-4xl font-extrabold tracking-tight">{ep.title}</h1>
      <audio controls src={ep.audio_url} className="mt-6 w-full" />
      <div className="mt-4 flex gap-2 text-sm">
        <a href={ep.url} target="_blank" rel="noreferrer" className="rounded-full border border-zinc-700 px-3 py-1 hover:bg-zinc-800">
          Read the original ↗
        </a>
        <Link href="/" className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 py-1 font-semibold">
          Make your own
        </Link>
      </div>
      {ep.takeaways && ep.takeaways.length > 0 && (
        <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="font-semibold">Takeaways</h2>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-zinc-300">
            {ep.takeaways.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </section>
      )}
      <details className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <summary className="cursor-pointer font-semibold">Transcript</summary>
        <p className="mt-3 whitespace-pre-line leading-relaxed text-zinc-300">{ep.script}</p>
      </details>
    </main>
  );
}
