"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Episode, Profile } from "@/lib/supabase-admin";
import { hostOf } from "@/lib/cover";
import Player, { Equalizer, Vinyl } from "./Player";

type Step = "idle" | "scraping" | "writing" | "recording" | "saving";

const STEPS: { key: Exclude<Step, "idle">; label: string; icon: string; anim: string; quips: string[] }[] = [
  { key: "scraping", label: "Reading", icon: "📄", anim: "flip", quips: ["Skimming the abstract…", "Braving the methods section…", "Squinting at figure 3…", "Skipping 80 references…"] },
  { key: "writing", label: "Writing", icon: "✍️", anim: "scribble", quips: ["Translating jargon into human…", "Finding the one number that matters…", "Arguing with reviewer 2…", "Cutting the boring bits…"] },
  { key: "recording", label: "Recording", icon: "🎙️", anim: "pulse-mic", quips: ["Clearing throat…", "Hitting record…", "Doing the radio voice…", "One take, no notes…"] },
  { key: "saving", label: "Pressing", icon: "💿", anim: "beam", quips: ["Pressing the record…", "Sleeving it up…", "Polishing the grooves…"] },
];

// Famous papers, one click away. arXiv ids are stable.
const CRATE = [
  { label: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", emoji: "🧠" },
  { label: "ResNet", url: "https://arxiv.org/abs/1512.03385", emoji: "🏗️" },
  { label: "GANs", url: "https://arxiv.org/abs/1406.2661", emoji: "🎭" },
  { label: "BERT", url: "https://arxiv.org/abs/1810.04805", emoji: "📚" },
  { label: "Diffusion models", url: "https://arxiv.org/abs/2006.11239", emoji: "🌫️" },
  { label: "Adam optimizer", url: "https://arxiv.org/abs/1412.6980", emoji: "⚙️" },
];

// Guests pick who is listening. The same paper comes out differently for each.
const PERSONAS = [
  { id: "curious", emoji: "🧐", label: "Just curious", role: "a curious non-specialist", goal: "understand the big idea and why it matters" },
  { id: "founder", emoji: "🚀", label: "Founder", role: "a startup founder", goal: "find something I can build with or use in my product" },
  { id: "student", emoji: "🎓", label: "Student", role: "a graduate student", goal: "decide whether this paper is worth reading in full" },
  { id: "engineer", emoji: "🛠️", label: "Engineer", role: "a software engineer", goal: "understand how I would implement this" },
];

const TYPED = ["Attention Is All You Need", "that 40-page PDF you saved in March", "the paper everyone keeps citing", "Denoising Diffusion Probabilistic Models", "your advisor's latest preprint"];
const TITLES_A = ["Attention Is All You Need", "Deep Residual Learning", "Generative Adversarial Nets", "BERT", "Denoising Diffusion", "Adam", "AlphaFold", "Dropout", "Batch Normalization", "Word2Vec"];
const TITLES_B = ["CRISPR-Cas9", "The Transformer", "Neural Turing Machines", "YOLO", "Variational Autoencoders", "Graph Neural Networks", "CLIP", "Mamba", "LoRA", "Chain-of-Thought"];

// Fixed layouts for background notes and confetti, so renders stay pure.
const NOTES = ["🎵", "🎶", "📄", "🎧", "🎵", "🔬", "🎶", "💿"].map((ch, i) => ({ ch, left: 6 + i * 12, dur: 16 + (i % 4) * 5, delay: -i * 3.1, spin: `${(i % 2 ? 1 : -1) * (40 + i * 20)}deg` }));
const CONFETTI = ["🎉", "🎧", "💿", "✨", "🎶", "🎉", "📄", "✨", "🎵", "💜", "🎉", "💿", "✨", "🎶", "🎧", "💜"].map((ch, i) => ({ ch, left: 3 + i * 6.2, delay: (i % 6) * 0.09, r: `${(i % 2 ? 1 : -1) * (200 + i * 30)}deg` }));
const GUEST_KEY = "podify.guest.records";

/** Runs the pipeline and reports each step. Works signed in (token) or as a guest (role/goal). */
async function pressRecord(
  body: { url: string; role?: string; goal?: string },
  token: string | undefined,
  onStep: (s: Step) => void,
): Promise<Episode> {
  const res = await fetch("/api/podify", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let episode: Episode | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.step === "error") throw new Error(ev.message);
      if (ev.step === "done") episode = ev.episode as Episode;
      else onStep(ev.step);
    }
  }
  if (!episode) throw new Error("The studio went quiet. Try again.");
  return episode;
}

export default function PodifyApp({
  supabaseUrl,
  supabaseAnonKey,
  featured,
  total,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  featured: Episode | null;
  total: number;
}) {
  const supabase = useMemo(() => createClient(supabaseUrl, supabaseAnonKey), [supabaseUrl, supabaseAnonKey]);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  // A soft light follows the pointer.
  function spotlight(e: React.MouseEvent) {
    root.current?.style.setProperty("--mx", `${e.clientX}px`);
    root.current?.style.setProperty("--my", `${e.clientY}px`);
  }

  return (
    <div ref={root} onMouseMove={spotlight} className="min-h-screen">
      <div className="backdrop" aria-hidden>
        <div className="blob blob-a" />
        <div className="blob blob-b" />
        <div className="blob blob-c" />
        {NOTES.map((n, i) => (
          <span key={i} className="note" style={{ left: `${n.left}%`, animationDuration: `${n.dur}s`, animationDelay: `${n.delay}s`, ["--spin" as string]: n.spin }}>
            {n.ch}
          </span>
        ))}
      </div>
      <div className="spot" aria-hidden />

      <header className="rise mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        {session ? (
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <span className="hidden sm:inline">{session.user.email}</span>
            <button onClick={() => supabase.auth.signOut()} className="btn rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-zinc-200">
              Sign out
            </button>
          </div>
        ) : (
          ready && (
            <nav className="flex items-center gap-2 text-sm">
              <a href="#try" className="hidden rounded-full px-4 py-1.5 text-zinc-300 transition hover:text-white sm:inline">Try it</a>
              <a href="#how" className="hidden rounded-full px-4 py-1.5 text-zinc-300 transition hover:text-white sm:inline">How it works</a>
              <a href="#join" className="btn rounded-full border border-white/15 bg-white/5 px-4 py-1.5 font-medium text-white">Sign in</a>
            </nav>
          )
        )}
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-28">
        {!ready ? <Loading /> : session ? <Studio supabase={supabase} session={session} /> : <Landing supabase={supabase} featured={featured} total={total} />}
      </main>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight">
      <span className="hot jelly grid h-10 w-10 place-items-center rounded-2xl text-xl shadow-lg shadow-fuchsia-500/40">
        <span className="wobble">🎧</span>
      </span>
      Podify
    </div>
  );
}

function Loading() {
  return (
    <div className="grid place-items-center pt-32">
      <Vinyl seed="loading" spinning className="w-24" />
      <p className="mt-6 text-sm text-zinc-500">Warming up the studio…</p>
    </div>
  );
}

/** Types and erases a rotating list of phrases. */
function useTypewriter(phrases: string[]) {
  const [text, setText] = useState("");
  useEffect(() => {
    let phrase = 0, chars = 0, deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const full = phrases[phrase];
      chars += deleting ? -1 : 1;
      setText(full.slice(0, chars));
      let wait = deleting ? 28 : 55;
      if (!deleting && chars === full.length) {
        deleting = true;
        wait = 1700;
      } else if (deleting && chars === 0) {
        deleting = false;
        phrase = (phrase + 1) % phrases.length;
        wait = 350;
      }
      timer = setTimeout(step, wait);
    };
    timer = setTimeout(step, 600);
    return () => clearTimeout(timer);
  }, [phrases]);
  return text;
}

/** Counts up to `value` once. */
function useCountUp(value: number) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 1400);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const settle = setTimeout(() => setShown(value), 1700);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [value]);
  return shown;
}

/** Fades children in the first time they scroll into view. */
function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- landing */

function Landing({ supabase, featured, total }: { supabase: SupabaseClient; featured: Episode | null; total: number }) {
  const typed = useTypewriter(TYPED);
  const pressed = useCountUp(total);
  const card = useRef<HTMLDivElement>(null);

  // The hero card leans towards the pointer.
  function tilt(e: React.MouseEvent) {
    const el = card.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ry", `${x * 10}deg`);
    el.style.setProperty("--rx", `${-y * 10}deg`);
  }
  function untilt() {
    card.current?.style.setProperty("--ry", "0deg");
    card.current?.style.setProperty("--rx", "0deg");
  }

  return (
    <>
      {/* ---------------------------------------------------------- hero */}
      <section className="relative grid items-center gap-12 pt-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="rise inline-flex items-center gap-2 rounded-full border border-fuchsia-400/30 bg-fuchsia-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200" style={{ animationDelay: "80ms" }}>
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-fuchsia-400" /> Papers you can listen to
          </p>
          <h1 className="rise mt-5 text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-7xl" style={{ animationDelay: "160ms" }}>
            Stop reading papers.
            <br />
            <span className="shimmer">Start hearing them.</span>
          </h1>
          <p className="rise mt-6 max-w-xl text-lg text-zinc-300" style={{ animationDelay: "260ms" }}>
            Paste a link to <span className="caret font-semibold text-white">{typed}</span>
          </p>
          <p className="rise mt-3 max-w-xl text-zinc-400" style={{ animationDelay: "320ms" }}>
            Podify reads the whole paper and turns it into a two-minute episode, written for who you are, with three takeaways and one
            thing to try.
          </p>
          <div className="rise mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "400ms" }}>
            <a href="#try" className="btn hot rounded-2xl px-7 py-4 text-lg font-bold text-white shadow-xl shadow-fuchsia-500/40">
              Press your first record ✨
            </a>
            <span className="text-sm text-zinc-400">No sign-up needed to try</span>
          </div>
          <div className="rise mt-9 flex items-center gap-6" style={{ animationDelay: "480ms" }}>
            <div>
              {/* A tiny count reads as empty, so show it only once it means something. */}
              <div className="big-num text-4xl font-black">{total >= 25 ? pressed : "3"}</div>
              <div className="text-xs uppercase tracking-wider text-zinc-500">{total >= 25 ? "records pressed" : "takeaways each"}</div>
            </div>
            <div className="h-10 w-px bg-white/10" />
            <div>
              <div className="big-num text-4xl font-black">~60s</div>
              <div className="text-xs uppercase tracking-wider text-zinc-500">link to audio</div>
            </div>
            <div className="h-10 w-px bg-white/10" />
            <div>
              <div className="big-num text-4xl font-black">2 min</div>
              <div className="text-xs uppercase tracking-wider text-zinc-500">per episode</div>
            </div>
          </div>
        </div>

        <div className="rise" style={{ animationDelay: "300ms" }} onMouseMove={tilt} onMouseLeave={untilt}>
          <div ref={card} className="tilt ring-border rounded-[2rem] p-6 shadow-2xl shadow-fuchsia-900/40 sm:p-8">
            {featured ? (
              <>
                <div className="tilt-pop flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200">
                  <span className="live-dot h-2 w-2 rounded-full bg-rose-500" /> On the turntable · press play
                </div>
                <h2 className="tilt-pop mt-2 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">{featured.title}</h2>
                <p className="mt-1 text-sm text-zinc-400">Made from a paper on {hostOf(featured.url)}</p>
                <div className="mt-6">
                  <Player src={featured.audio_url} seed={featured.id} big />
                </div>
                {featured.takeaways && featured.takeaways[0] && (
                  <p className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-zinc-300">
                    <b className="text-fuchsia-200">Takeaway:</b> {featured.takeaways[0]}
                  </p>
                )}
              </>
            ) : (
              <div className="grid place-items-center py-6" aria-hidden>
                <div className="bob w-52">
                  <Vinyl seed="hero" spinning />
                </div>
                <div className="mt-6">
                  <Equalizer on large />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <a href="#try" className="scroll-cue mx-auto mt-12 hidden w-fit text-2xl text-zinc-500 lg:block" aria-label="Scroll to try it">↓</a>

      {/* ------------------------------------------------------- marquee */}
      <div className="fade-x mt-10 space-y-3 overflow-hidden py-2" aria-hidden>
        {[TITLES_A, TITLES_B].map((row, r) => (
          <div key={r} className={`marquee ${r ? "rev" : ""}`}>
            {[...row, ...row, ...row, ...row].map((t, i) => (
              <span key={i} className="mx-2 inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-300">
                <span className="text-fuchsia-300">♪</span> {t}
              </span>
            ))}
          </div>
        ))}
      </div>

      {/* ----------------------------------------------------------- try */}
      <Reveal>
        <GuestStudio />
      </Reveal>

      {/* ---------------------------------------------------------- how */}
      <section id="how" className="mt-24 scroll-mt-8">
        <Reveal>
          <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-5xl">
            From PDF to earbuds <span className="shimmer">in four stops</span>
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["📄", "flip", "It reads everything", "The full text, not the abstract. References get dropped; the results and conclusions stay."],
            ["✍️", "scribble", "It writes for you", "The question, what the authors did, the headline number, one honest limitation. Jargon explained."],
            ["🎙️", "pulse-mic", "It records", "A natural voice, about two minutes, ready before your coffee is."],
            ["💿", "beam", "It lands in your app", "A private podcast feed. Add it once and every new record shows up there."],
          ].map(([icon, anim, title, body], i) => (
            <Reveal key={title} delay={i * 110}>
              <div className="glass lift group h-full rounded-3xl p-6">
                <div className="flex items-center justify-between">
                  <span className="text-5xl"><span className={anim}>{icon}</span></span>
                  <span className="font-mono text-sm text-fuchsia-300/70">0{i + 1}</span>
                </div>
                <div className="mt-5 text-lg font-bold">{title}</div>
                <p className="mt-2 text-sm text-zinc-400">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------- same paper, two ways */}
      <section className="mt-24">
        <Reveal>
          <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-5xl">
            Same paper. <span className="shimmer">Your episode.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-zinc-400">
            Tell Podify who is listening and it changes what it keeps, what it skips, and how it ends.
          </p>
        </Reveal>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {[
            ["🚀", "For a founder", "“…the part worth borrowing is the training speed. If your demo needs AI smarts, this is the architecture behind most of the tools that followed.”", "Try this week: prototype one feature on a hosted Transformer model."],
            ["🎓", "For a student", "“…the key move is dropping recurrence entirely. Notice the ablations in table 3: that is where the design choices are actually justified.”", "Try this week: re-derive scaled dot-product attention on paper."],
          ].map(([emoji, who, quote, action], i) => (
            <Reveal key={who} delay={i * 140}>
              <div className="glass lift h-full rounded-3xl p-6">
                <div className="flex items-center gap-3">
                  <span className="hot grid h-11 w-11 place-items-center rounded-2xl text-2xl">{emoji}</span>
                  <b className="text-lg">{who}</b>
                  <span className="ml-auto"><Equalizer on /></span>
                </div>
                <p className="mt-4 text-zinc-200">{quote}</p>
                <p className="note-card mt-4 rounded-xl bg-amber-300 p-3 text-sm font-medium text-amber-950">📌 {action}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-zinc-600">Illustrative lines showing how the same paper is framed for two listeners.</p>
      </section>

      {/* ---------------------------------------------------------- join */}
      <section id="join" className="mt-24 scroll-mt-8">
        <Reveal>
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_420px]">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
                Keep your records. <span className="shimmer">It&apos;s free.</span>
              </h2>
              <ul className="mt-6 space-y-3 text-zinc-300">
                {[
                  ["📚", "A shelf that remembers every episode you press"],
                  ["🎯", "A saved profile, so every script is written for you"],
                  ["📡", "A private podcast feed for Apple Podcasts, Overcast and the rest"],
                  ["♾️", "No daily guest limit"],
                ].map(([e, t]) => (
                  <li key={t} className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5 text-lg">{e}</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <AuthCard supabase={supabase} />
          </div>
        </Reveal>
      </section>

      <footer className="mt-24 border-t border-white/10 pt-6 text-center text-xs text-zinc-600">
        Podify · built with Stripe Projects, Supabase, Firecrawl, OpenRouter, ElevenLabs and Vercel
      </footer>
    </>
  );
}

/** Try it without an account: pick who is listening, drop a link, get a record. */
function GuestStudio() {
  const [url, setUrl] = useState("");
  const [persona, setPersona] = useState(PERSONAS[0].id);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [party, setParty] = useState(0);
  const [freshId, setFreshId] = useState<string | null>(null);
  // Guest records live in this browser only.
  const [records, setRecords] = useState<Episode[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(GUEST_KEY) ?? "[]") as Episode[];
    } catch {
      return [];
    }
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStep("scraping");
    const who = PERSONAS.find((p) => p.id === persona) ?? PERSONAS[0];
    try {
      const ep = await pressRecord({ url, role: who.role, goal: who.goal }, undefined, setStep);
      const next = [ep, ...records].slice(0, 6);
      setRecords(next);
      try {
        window.localStorage.setItem(GUEST_KEY, JSON.stringify(next));
      } catch {}
      setFreshId(ep.id);
      setParty((n) => n + 1);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setStep("idle");
    }
  }

  const busy = step !== "idle";

  return (
    <section id="try" className="mt-16 scroll-mt-8">
      {party > 0 && <Confetti key={party} />}
      <div className="ring-border rounded-[2rem] p-6 shadow-2xl sm:p-9">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">The studio is open 🎙️</h2>
            <p className="mt-1 text-zinc-400">Press a record right now. No account, about a minute.</p>
          </div>
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">Free · 2 guest records a day</span>
        </div>

        <form onSubmit={submit} className="mt-6">
          <div className="text-sm font-medium text-zinc-300">1. Who&apos;s listening?</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {PERSONAS.map((p) => (
              <button key={p.id} type="button" disabled={busy} onClick={() => setPersona(p.id)} className={`persona rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold ${persona === p.id ? "sel" : ""}`}>
                <span className="mr-1.5 text-lg">{p.emoji}</span>
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-5 text-sm font-medium text-zinc-300">2. Drop in a paper (arXiv, OpenReview, PDF) or any article</div>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <input
              type="url"
              required
              disabled={busy}
              placeholder="https://arxiv.org/abs/1706.03762"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 rounded-2xl border border-white/10 bg-black/40 px-5 py-4 text-lg outline-none transition focus:border-fuchsia-400 focus:shadow-[0_0_0_4px_rgba(217,70,239,0.15)] disabled:opacity-60"
            />
            <button disabled={busy} className="btn hot rounded-2xl px-8 py-4 text-lg font-bold text-white shadow-lg shadow-fuchsia-500/30 disabled:opacity-70">
              {busy ? "Cooking…" : "Podify ✨"}
            </button>
          </div>
          {!busy && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-500">Or pull one from the crate:</span>
              {CRATE.map((p) => (
                <button key={p.url} type="button" onClick={() => setUrl(p.url)} className="chip rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-200">
                  {p.emoji} {p.label}
                </button>
              ))}
            </div>
          )}
          {busy && <ProductionLine step={step} />}
          {error && (
            <div className="pop mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              <span>😬 {error}</span>
              <a href="#join" className="btn rounded-full bg-white px-3 py-1 font-semibold text-zinc-950">Sign up free</a>
            </div>
          )}
        </form>

        {records.length > 0 && (
          <div className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-bold">Your guest records</h3>
              <a href="#join" className="text-sm text-fuchsia-200 underline underline-offset-4">Sign up to keep them and get a podcast feed →</a>
            </div>
            <div className="mt-4 grid gap-5">
              {records.map((ep) => (
                <EpisodeCard key={ep.id} ep={ep} fresh={ep.id === freshId} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ auth */

function AuthCard({ supabase }: { supabase: SupabaseClient }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } =
      mode === "signup" ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMsg({ kind: "error", text: error.message });
    if (mode === "signup" && !data.session) {
      setMsg({ kind: "info", text: "Check your inbox to confirm your email, then sign in." });
      setMode("signin");
    }
  }

  const field = "w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 outline-none transition focus:border-fuchsia-400 focus:shadow-[0_0_0_4px_rgba(217,70,239,0.15)]";

  return (
    <form onSubmit={submit} className="glass glow-ring rounded-3xl p-6 shadow-2xl sm:p-7">
      <div className="flex items-center gap-3">
        <Vinyl seed={mode} spinning className="w-12" />
        <h3 className="text-xl font-bold">{mode === "signup" ? "Start your record collection" : "Welcome back, listener"}</h3>
      </div>
      <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={`${field} mt-5`} />
      <input type="password" required minLength={6} placeholder="Password (6+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} className={`${field} mt-3`} />
      {msg && <p className={`pop mt-3 text-sm ${msg.kind === "error" ? "text-rose-300" : "text-emerald-300"}`}>{msg.text}</p>}
      <button disabled={busy} className="btn hot mt-4 w-full rounded-xl py-3 font-bold text-white shadow-lg shadow-fuchsia-500/30 disabled:opacity-60">
        {busy ? "One sec…" : mode === "signup" ? "Sign up free →" : "Sign in →"}
      </button>
      <button type="button" onClick={() => setMode(mode === "signup" ? "signin" : "signup")} className="mt-3 w-full text-sm text-zinc-400 transition hover:text-white">
        {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
    </form>
  );
}

/* ---------------------------------------------------------------- studio */

function Studio({ supabase, session }: { supabase: SupabaseClient; session: Session }) {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [party, setParty] = useState(0);

  useEffect(() => {
    let alive = true;
    supabase
      .from("episodes")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setError(`Couldn't load your library: ${error.message}`);
        else setEpisodes((data ?? []) as Episode[]);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [supabase]);

  async function podify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStep("scraping");
    try {
      const ep = await pressRecord({ url }, session.access_token, setStep);
      setEpisodes((prev) => [ep, ...prev]);
      setFreshId(ep.id);
      setParty((n) => n + 1);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setStep("idle");
    }
  }

  const busy = step !== "idle";
  const greeting = session.user.email?.split("@")[0] ?? "listener";

  return (
    <div className="mx-auto max-w-5xl pt-4">
      {party > 0 && <Confetti key={party} />}

      <div className="rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
            Hey {greeting} <span className="wobble">👋</span>
          </h1>
          <p className="mt-1 text-zinc-400">What are we listening to today?</p>
        </div>
        <div className="glass flex items-center gap-2 rounded-full px-4 py-2 text-sm">
          <span>💿</span>
          <b className="tabular-nums">{episodes.length}</b>
          <span className="text-zinc-400">{episodes.length === 1 ? "record pressed" : "records pressed"}</span>
        </div>
      </div>

      <form onSubmit={podify} className="rise ring-border mt-6 rounded-[2rem] p-5 shadow-2xl sm:p-7" style={{ animationDelay: "100ms" }}>
        <label className="text-sm font-medium text-zinc-300">Drop in a research paper link (arXiv, OpenReview, PDF) or any article</label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            type="url"
            required
            disabled={busy}
            placeholder="https://arxiv.org/abs/1706.03762"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 rounded-2xl border border-white/10 bg-black/40 px-5 py-4 text-lg outline-none transition focus:border-fuchsia-400 focus:shadow-[0_0_0_4px_rgba(217,70,239,0.15)] disabled:opacity-60"
          />
          <button disabled={busy} className="btn hot rounded-2xl px-8 py-4 text-lg font-bold text-white shadow-lg shadow-fuchsia-500/30 disabled:opacity-70">
            {busy ? "Cooking…" : "Podify ✨"}
          </button>
        </div>

        {!busy && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-500">Or pull one from the crate:</span>
            {CRATE.map((p) => (
              <button key={p.url} type="button" onClick={() => setUrl(p.url)} className="chip rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-200">
                {p.emoji} {p.label}
              </button>
            ))}
          </div>
        )}

        {busy && <ProductionLine step={step} />}
        {error && <p className="pop mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">😬 {error}</p>}
      </form>

      <ListenerPanel supabase={supabase} userId={session.user.id} />

      <h2 className="mt-14 flex items-center gap-3 text-2xl font-extrabold tracking-tight">
        Your record shelf <span className="text-zinc-600">·</span>{" "}
        <span className="text-base font-medium text-zinc-500">{episodes.length} {episodes.length === 1 ? "episode" : "episodes"}</span>
      </h2>
      {loading ? (
        <p className="mt-6 text-zinc-500">Dusting off the shelf…</p>
      ) : episodes.length === 0 ? (
        <div className="glass mt-5 grid place-items-center rounded-3xl px-6 py-14 text-center">
          <div className="bob w-28">
            <Vinyl seed="empty" spinning={false} />
          </div>
          <p className="mt-6 text-lg font-semibold">Nothing on the shelf yet</p>
          <p className="mt-1 max-w-sm text-sm text-zinc-400">Paste a paper above, or grab one from the crate, and your first record gets pressed in about a minute.</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-5">
          {episodes.map((ep) => (
            <EpisodeCard key={ep.id} ep={ep} fresh={ep.id === freshId} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The four stations an episode moves through, with a rotating line of commentary. */
function ProductionLine({ step }: { step: Step }) {
  const activeIdx = STEPS.findIndex((s) => s.key === step);
  const active = STEPS[Math.max(0, activeIdx)];
  const [quip, setQuip] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setQuip((q) => q + 1), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mt-7">
      <div className="belt" />
      <ol className="mt-4 grid grid-cols-4 gap-2 sm:gap-3">
        {STEPS.map((s, i) => {
          const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
          return (
            <li key={s.key} className={`station rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-4 text-center ${state === "todo" ? "opacity-50" : state}`}>
              <div className="text-3xl sm:text-5xl">{state === "done" ? "✅" : <span className={state === "active" ? s.anim : ""}>{s.icon}</span>}</div>
              <div className="mt-2 text-xs font-semibold sm:text-sm">{s.label}</div>
            </li>
          );
        })}
      </ol>
      <div className="mt-5 flex items-center justify-center gap-3">
        <Equalizer on />
        <p key={`${active.key}-${quip}`} className="swap text-sm font-medium text-fuchsia-100">
          {active.quips[quip % active.quips.length]}
        </p>
        <Equalizer on />
      </div>
    </div>
  );
}

function Confetti() {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShow(false), 2800);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div aria-hidden>
      {CONFETTI.map((c, i) => (
        <span key={i} className="confetti" style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, ["--r" as string]: c.r }}>
          {c.ch}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------- listener profile + feed */

function ListenerPanel({ supabase, userId }: { supabase: SupabaseClient; userId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState("");
  const [goal, setGoal] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "saved" | "unavailable">("loading");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Create the row on first visit (the database generates the feed token), then read it.
      await supabase.from("profiles").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
      const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
      if (!alive) return;
      if (error || !data) return setState("unavailable");
      const p = data as Profile;
      setProfile(p);
      setRole(p.role);
      setGoal(p.goal);
      setState("ready");
    })();
    return () => {
      alive = false;
    };
  }, [supabase, userId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    const { error } = await supabase
      .from("profiles")
      .update({ role: role.trim(), goal: goal.trim(), updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    setState(error ? "unavailable" : "saved");
  }

  if (state === "loading") return null;
  if (state === "unavailable" && !profile) {
    return (
      <p className="mt-6 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        Personalisation and your podcast feed are unavailable. Re-run supabase/setup.sql to add the profiles table.
      </p>
    );
  }

  const feedUrl = profile ? `${window.location.origin}/feed/${profile.feed_token}` : "";
  const field = "mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none transition focus:border-fuchsia-400";

  return (
    <div className="mt-6 grid gap-5 md:grid-cols-2">
      <form onSubmit={save} className="rise glass lift rounded-3xl p-5" style={{ animationDelay: "180ms" }}>
        <h2 className="flex items-center gap-2 font-bold">
          <span className="text-2xl">🎯</span> Written for you
        </h2>
        <p className="mt-1 text-sm text-zinc-400">Tell Podify who is listening. Every new episode picks what matters to you and ends with one thing to do.</p>
        <input value={role} onChange={(e) => setRole(e.target.value)} maxLength={200} placeholder="Who you are, e.g. solo founder of a B2B SaaS" className={field + " mt-3"} />
        <input value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} placeholder="What you are working towards, e.g. first 10 paying customers" className={field} />
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button disabled={state === "saving"} className="btn rounded-full bg-fuchsia-500/25 px-4 py-1.5 font-semibold text-fuchsia-100 ring-1 ring-fuchsia-400/40 disabled:opacity-60">
            {state === "saving" ? "Saving…" : "Save"}
          </button>
          {state === "saved" && <span className="pop text-emerald-300">Saved ✓ New episodes will use this.</span>}
          {state === "unavailable" && <span className="pop text-rose-300">Couldn&apos;t save. Try again.</span>}
        </div>
      </form>

      <div className="rise glass lift rounded-3xl p-5" style={{ animationDelay: "260ms" }}>
        <h2 className="flex items-center gap-2 font-bold">
          <span className="relative grid h-8 w-8 place-items-center text-2xl">
            <span className="ring-out" />
            <span className="ring-out" />
            📡
          </span>
          Your private podcast feed
        </h2>
        <p className="mt-1 text-sm text-zinc-400">Add this link once in your podcast app (Add a show by URL) and every episode you make shows up there.</p>
        <input readOnly value={feedUrl} onFocus={(e) => e.currentTarget.select()} className={field + " mt-3 font-mono text-xs text-zinc-300"} />
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(feedUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="btn rounded-full bg-fuchsia-500/25 px-4 py-1.5 font-semibold text-fuchsia-100 ring-1 ring-fuchsia-400/40"
          >
            {copied ? "Copied ✓" : "Copy feed link"}
          </button>
          <span className="text-xs text-zinc-500">Anyone with this link can listen, so keep it to yourself.</span>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- episode */

function EpisodeCard({ ep, fresh }: { ep: Episode; fresh?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  function share() {
    navigator.clipboard.writeText(`${window.location.origin}/e/${ep.id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const pill = "btn rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-200";

  return (
    <article className={`glass lift rounded-3xl p-5 sm:p-6 ${fresh ? "fresh glow-ring" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-wider text-zinc-500">
        {fresh && <span className="rounded-full bg-fuchsia-500 px-2 py-0.5 font-bold normal-case tracking-normal text-white">Fresh off the press</span>}
        <span>{hostOf(ep.url)}</span>
        <span>·</span>
        <span>{new Date(ep.created_at).toLocaleDateString()}</span>
      </div>
      <h3 className="mt-2 text-xl font-extrabold tracking-tight sm:text-2xl">{ep.title}</h3>

      <div className="mt-4">
        <Player src={ep.audio_url} seed={ep.id} />
      </div>

      {(ep.takeaways?.length || ep.action) && (
        <div className="mt-5 grid gap-3 md:grid-cols-[1.4fr_1fr]">
          {ep.takeaways && ep.takeaways.length > 0 && (
            <ol className="space-y-2 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm">
              {ep.takeaways.map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className="hot grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white">{i + 1}</span>
                  <span className="text-zinc-200">{t}</span>
                </li>
              ))}
            </ol>
          )}
          {ep.action && (
            <div className="note-card rounded-2xl bg-amber-300 p-4 text-sm text-amber-950 shadow-lg shadow-amber-500/20">
              <div className="text-xs font-black uppercase tracking-wider">📌 Try this week</div>
              <p className="mt-1.5 font-medium leading-snug">{ep.action}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <button onClick={share} className={`${pill} !border-fuchsia-400/40 !bg-fuchsia-500/20 !text-fuchsia-100`}>
          {copied ? "Link copied ✓" : "🔗 Share"}
        </button>
        <button onClick={() => setOpen(!open)} className={pill}>
          {open ? "Hide script" : "📜 Script"}
        </button>
        <a href={ep.url} target="_blank" rel="noreferrer" className={pill}>
          Source ↗
        </a>
      </div>
      {open && <p className="swap mt-4 whitespace-pre-line rounded-2xl border border-white/10 bg-black/30 p-4 text-sm leading-relaxed text-zinc-300">{ep.script}</p>}
    </article>
  );
}
