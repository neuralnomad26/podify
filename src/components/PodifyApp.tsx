"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import type { Episode, Profile } from "@/lib/supabase-admin";
import { coverGradient, hostOf } from "@/lib/cover";

type Step = "idle" | "scraping" | "writing" | "recording" | "saving";

const STEPS: { key: Exclude<Step, "idle">; label: string; icon: string }[] = [
  { key: "scraping", label: "Reading the source", icon: "📰" },
  { key: "writing", label: "Writing the script", icon: "✍️" },
  { key: "recording", label: "Recording the voice", icon: "🎙️" },
  { key: "saving", label: "Publishing episode", icon: "📡" },
];

export default function PodifyApp({
  supabaseUrl,
  supabaseAnonKey,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
}) {
  const supabase = useMemo(
    () => createClient(supabaseUrl, supabaseAnonKey),
    [supabaseUrl, supabaseAnonKey],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-6">
        <Logo />
        {session && (
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <span className="hidden sm:inline">{session.user.email}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              className="rounded-full border border-zinc-700 px-3 py-1 hover:bg-zinc-800"
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-4xl px-6 pb-24">
        {!ready ? null : session ? (
          <Studio supabase={supabase} session={session} />
        ) : (
          <AuthCard supabase={supabase} />
        )}
      </main>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2 text-xl font-bold tracking-tight">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-lg">
        🎧
      </span>
      Podify
    </div>
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
      mode === "signup"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMsg({ kind: "error", text: error.message });
    if (mode === "signup" && !data.session) {
      setMsg({ kind: "info", text: "Check your inbox to confirm your email, then sign in." });
      setMode("signin");
    }
  }

  return (
    <div className="grid items-center gap-12 pt-10 md:grid-cols-2">
      <div>
        <h1 className="text-5xl font-extrabold leading-tight tracking-tight">
          Any article.
          <br />
          <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            A podcast in seconds.
          </span>
        </h1>
        <p className="mt-5 text-lg text-zinc-400">
          Paste a link. Podify reads it, writes a two-minute script, and records it in a natural
          voice — ready to listen to or share.
        </p>
      </div>
      <form onSubmit={submit} className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">{mode === "signup" ? "Create your account" : "Welcome back"}</h2>
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-4 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-violet-500"
        />
        <input
          type="password"
          required
          minLength={6}
          placeholder="Password (6+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-violet-500"
        />
        {msg && (
          <p className={`mt-3 text-sm ${msg.kind === "error" ? "text-red-400" : "text-emerald-400"}`}>{msg.text}</p>
        )}
        <button
          disabled={busy}
          className="mt-4 w-full rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 font-semibold disabled:opacity-60"
        >
          {busy ? "…" : mode === "signup" ? "Sign up" : "Sign in"}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          className="mt-3 w-full text-sm text-zinc-400 hover:text-zinc-200"
        >
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- studio */

function Studio({ supabase, session }: { supabase: SupabaseClient; session: Session }) {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);

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
      const res = await fetch("/api/podify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ url }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
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
          if (ev.step === "done") {
            setEpisodes((prev) => [ev.episode, ...prev]);
            setUrl("");
          } else setStep(ev.step);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setStep("idle");
    }
  }

  const busy = step !== "idle";
  const activeIdx = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="pt-6">
      <form
        onSubmit={podify}
        className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 shadow-2xl"
      >
        <label className="text-sm font-medium text-zinc-400">Paste an article or research paper link</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            type="url"
            required
            disabled={busy}
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-violet-500 disabled:opacity-60"
          />
          <button
            disabled={busy}
            className="rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-3 font-semibold disabled:opacity-60"
          >
            {busy ? "Podifying…" : "Podify ✨"}
          </button>
        </div>

        {busy && (
          <ol className="mt-5 grid gap-2 sm:grid-cols-4">
            {STEPS.map((s, i) => {
              const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
              return (
                <li
                  key={s.key}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                    state === "active"
                      ? "animate-pulse border-violet-500 bg-violet-500/10 text-violet-200"
                      : state === "done"
                        ? "border-emerald-700 bg-emerald-500/10 text-emerald-300"
                        : "border-zinc-800 text-zinc-500"
                  }`}
                >
                  <span>{state === "done" ? "✓" : s.icon}</span>
                  {s.label}
                </li>
              );
            })}
          </ol>
        )}
        {error && <p className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      </form>

      <ListenerPanel supabase={supabase} userId={session.user.id} />

      <h2 className="mt-12 text-2xl font-bold">Your episodes</h2>
      {loading ? (
        <p className="mt-4 text-zinc-500">Loading…</p>
      ) : episodes.length === 0 ? (
        <p className="mt-4 text-zinc-500">No episodes yet. Podify your first article or paper above (arXiv and PDF links work).</p>
      ) : (
        <div className="mt-5 grid gap-5">
          {episodes.map((ep) => (
            <EpisodeCard key={ep.id} ep={ep} />
          ))}
        </div>
      )}
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
      <p className="mt-6 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        Personalisation and your podcast feed are unavailable. Re-run supabase/setup.sql to add the profiles table.
      </p>
    );
  }

  const feedUrl = profile ? `${window.location.origin}/feed/${profile.feed_token}` : "";

  return (
    <div className="mt-6 grid gap-5 md:grid-cols-2">
      <form onSubmit={save} className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="font-semibold">Written for you</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Tell Podify who is listening. Every new episode picks what matters to you and ends with one thing to do.
        </p>
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          maxLength={200}
          placeholder="Who you are, e.g. solo founder of a B2B SaaS"
          className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-violet-500"
        />
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          maxLength={300}
          placeholder="What you are working towards, e.g. first 10 paying customers"
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-violet-500"
        />
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button
            disabled={state === "saving"}
            className="rounded-full bg-violet-500/20 px-4 py-1.5 font-medium text-violet-200 hover:bg-violet-500/30 disabled:opacity-60"
          >
            {state === "saving" ? "Saving…" : "Save"}
          </button>
          {state === "saved" && <span className="text-emerald-300">Saved. New episodes will use this.</span>}
          {state === "unavailable" && <span className="text-red-300">Couldn&apos;t save. Try again.</span>}
        </div>
      </form>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="font-semibold">Your private podcast feed</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Add this link once in your podcast app (Add a show by URL) and every episode you make shows up there.
        </p>
        <input
          readOnly
          value={feedUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300 outline-none"
        />
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(feedUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-full bg-violet-500/20 px-4 py-1.5 font-medium text-violet-200 hover:bg-violet-500/30"
          >
            {copied ? "Copied!" : "Copy feed link"}
          </button>
          <span className="text-zinc-500">Anyone with this link can listen, so keep it to yourself.</span>
        </div>
      </div>
    </div>
  );
}

function EpisodeCard({ ep }: { ep: Episode }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  function share() {
    navigator.clipboard.writeText(`${window.location.origin}/e/${ep.id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <article className="flex flex-col gap-5 rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5 sm:flex-row">
      <div
        className="grid aspect-square w-full shrink-0 place-items-center rounded-2xl text-5xl shadow-lg sm:w-36"
        style={{ background: coverGradient(ep.id) }}
      >
        🎙️
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wider text-zinc-500">
          {hostOf(ep.url)} · {new Date(ep.created_at).toLocaleDateString()}
        </div>
        <h3 className="mt-1 text-xl font-bold">{ep.title}</h3>
        <audio controls preload="none" src={ep.audio_url} className="mt-3 w-full" />
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <button onClick={share} className="rounded-full bg-violet-500/20 px-3 py-1 text-violet-200 hover:bg-violet-500/30">
            {copied ? "Link copied!" : "Share"}
          </button>
          <button onClick={() => setOpen(!open)} className="rounded-full border border-zinc-700 px-3 py-1 hover:bg-zinc-800">
            {open ? "Hide script" : "Script"}
          </button>
          <a href={ep.url} target="_blank" rel="noreferrer" className="rounded-full border border-zinc-700 px-3 py-1 hover:bg-zinc-800">
            Source ↗
          </a>
        </div>
        {(ep.takeaways?.length || ep.action) && (
          <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm">
            {ep.takeaways && ep.takeaways.length > 0 && (
              <ol className="list-decimal space-y-1 pl-5 text-zinc-300">
                {ep.takeaways.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            )}
            {ep.action && (
              <p className="mt-3 text-emerald-300">
                <span className="font-semibold">Try this week:</span> {ep.action}
              </p>
            )}
          </div>
        )}
        {open && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-zinc-300">{ep.script}</p>}
      </div>
    </article>
  );
}
