"use client";

import { useEffect, useState } from "react";
import type { Answer, Kit } from "@/lib/supabase-admin";
import { Equalizer } from "./Player";

type Tab = "breakdown" | "ask" | "quiz" | "transcript";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "breakdown", label: "Breakdown", icon: "🧩" },
  { id: "ask", label: "Ask the paper", icon: "💬" },
  { id: "quiz", label: "Quiz me", icon: "🎯" },
  { id: "transcript", label: "Transcript", icon: "📜" },
];

const STARTERS = ["What problem does this solve?", "What is the main result?", "What are the limitations?", "How was it evaluated?", "How could I use this?"];

const PARTS: { key: keyof Kit["breakdown"]; label: string; icon: string }[] = [
  { key: "problem", label: "The problem", icon: "❓" },
  { key: "approach", label: "What they did", icon: "🔧" },
  { key: "results", label: "What they found", icon: "📈" },
  { key: "limitations", label: "The catch", icon: "⚠️" },
  { key: "why_it_matters", label: "Why it matters", icon: "💡" },
];

/** Everything beyond the audio: a breakdown, questions answered from the paper, a quiz, the transcript. */
export default function Companion({ id, script, initialKit, initialQuestions }: { id: string; script: string; initialKit: Kit | null; initialQuestions: Answer[] }) {
  const [tab, setTab] = useState<Tab>("breakdown");
  const [kit, setKit] = useState<Kit | null>(initialKit);
  const [kitError, setKitError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (initialKit) return;
    let alive = true;
    fetch("/api/kit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
      .then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => ({})) }))
      .then(({ ok, json }) => {
        if (!alive) return;
        if (ok && json.kit) setKit(json.kit);
        else setKitError(json.error ?? "Could not build the study kit.");
      })
      .catch(() => alive && setKitError("Could not reach the server."));
    return () => {
      alive = false;
    };
  }, [id, initialKit, attempt]);

  const retry = () => {
    setKitError(null);
    setAttempt((n) => n + 1);
  };

  return (
    <section className="rise mt-5" style={{ animationDelay: "240ms" }}>
      <div className="glass flex flex-wrap gap-1.5 rounded-2xl p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`btn flex-1 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-semibold transition ${tab === t.id ? "hot text-white shadow-lg shadow-fuchsia-500/30" : "text-zinc-300 hover:bg-white/5"}`}
          >
            <span className="mr-1.5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div key={tab} className="swap mt-4">
        {tab === "breakdown" && <Breakdown kit={kit} error={kitError} retry={retry} />}
        {tab === "ask" && <Ask id={id} initial={initialQuestions} />}
        {tab === "quiz" && <Quiz kit={kit} error={kitError} retry={retry} />}
        {tab === "transcript" && <p className="glass whitespace-pre-line rounded-3xl p-6 leading-relaxed text-zinc-300">{script}</p>}
      </div>
    </section>
  );
}

function Building({ error, retry, what }: { error: string | null; retry: () => void; what: string }) {
  if (error) {
    return (
      <div className="glass rounded-3xl p-6 text-center">
        <p className="text-rose-200">😬 {error}</p>
        <button onClick={retry} className="btn hot mt-4 rounded-full px-5 py-2 text-sm font-bold text-white">Try again</button>
      </div>
    );
  }
  return (
    <div className="glass grid place-items-center rounded-3xl px-6 py-12 text-center">
      <Equalizer on large />
      <p className="mt-5 font-semibold">Reading the paper to build your {what}…</p>
      <p className="mt-1 text-sm text-zinc-500">First time takes about 20 seconds. After that it&apos;s instant.</p>
    </div>
  );
}

function Breakdown({ kit, error, retry }: { kit: Kit | null; error: string | null; retry: () => void }) {
  if (!kit) return <Building error={error} retry={retry} what="breakdown" />;
  return (
    <div className="space-y-4">
      <div className="ring-border rounded-3xl p-6">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-fuchsia-200">In one sentence</div>
        <p className="mt-2 text-xl font-semibold leading-snug sm:text-2xl">{kit.tldr}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {PARTS.map((p, i) =>
          kit.breakdown[p.key] ? (
            <div key={p.key} className={`glass lift rise rounded-3xl p-5 ${i === 4 ? "md:col-span-2" : ""}`} style={{ animationDelay: `${i * 70}ms` }}>
              <div className="flex items-center gap-2 font-bold">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-lg">{p.icon}</span>
                {p.label}
              </div>
              <p className="mt-3 leading-relaxed text-zinc-300">{kit.breakdown[p.key]}</p>
            </div>
          ) : null,
        )}
      </div>

      {kit.numbers.length > 0 && (
        <div>
          <h3 className="mb-3 mt-6 text-lg font-bold">The numbers that matter</h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kit.numbers.map((n, i) => (
              <div key={i} className="glass lift rounded-2xl p-4">
                <div className="big-num text-2xl font-black sm:text-3xl">{n.value}</div>
                <p className="mt-1 text-sm text-zinc-400">{n.meaning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {kit.glossary.length > 0 && (
        <div>
          <h3 className="mb-3 mt-6 text-lg font-bold">Jargon, decoded</h3>
          <dl className="grid gap-3 md:grid-cols-2">
            {kit.glossary.map((g, i) => (
              <div key={i} className="glass rounded-2xl p-4">
                <dt className="font-mono text-sm font-bold text-fuchsia-200">{g.term}</dt>
                <dd className="mt-1 text-sm text-zinc-300">{g.plain}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {(kit.read_it_if || kit.skip_it_if) && (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {kit.read_it_if && (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4">
              <div className="text-xs font-black uppercase tracking-wider text-emerald-300">📖 Read the full paper if</div>
              <p className="mt-1.5 text-zinc-200">{kit.read_it_if}</p>
            </div>
          )}
          {kit.skip_it_if && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs font-black uppercase tracking-wider text-zinc-400">⏭️ This is enough if</div>
              <p className="mt-1.5 text-zinc-200">{kit.skip_it_if}</p>
            </div>
          )}
        </div>
      )}
      <p className="pt-2 text-center text-xs text-zinc-600">Generated from the paper&apos;s text by an AI model. Check the source before you cite it.</p>
    </div>
  );
}

function Ask({ id, initial }: { id: string; initial: Answer[] }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answer[]>(initial);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, question: q }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not answer that.");
      setAnswers((prev) => [json as Answer, ...prev]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not answer that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="ring-border rounded-3xl p-5"
      >
        <label className="text-sm font-medium text-zinc-300">Ask anything. Answers come only from this paper, with the exact lines they rest on.</label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={300}
            disabled={busy}
            placeholder="e.g. What data did they train on?"
            className="flex-1 rounded-2xl border border-white/10 bg-black/40 px-5 py-3.5 outline-none transition focus:border-fuchsia-400 focus:shadow-[0_0_0_4px_rgba(217,70,239,0.15)] disabled:opacity-60"
          />
          <button disabled={busy || !question.trim()} className="btn hot rounded-2xl px-7 py-3.5 font-bold text-white shadow-lg shadow-fuchsia-500/30 disabled:opacity-60">
            {busy ? "Looking it up…" : "Ask"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {STARTERS.map((s) => (
            <button key={s} type="button" disabled={busy} onClick={() => ask(s)} className="chip rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-200 disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
        {busy && (
          <div className="mt-4 flex items-center gap-3 text-sm text-fuchsia-100">
            <Equalizer on /> Searching the paper for the answer…
          </div>
        )}
        {error && <p className="pop mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">😬 {error}</p>}
      </form>

      <div className="mt-5 space-y-4">
        {answers.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">No questions yet. Be the first to ask.</p>}
        {answers.map((a, i) => (
          <article key={a.id ?? i} className="glass pop rounded-3xl p-5">
            <h4 className="flex gap-2 font-bold">
              <span className="text-fuchsia-300">Q</span> {a.question}
            </h4>
            <p className="mt-2 leading-relaxed text-zinc-200">{a.answer}</p>
            {a.quotes.length > 0 && (
              <div className="mt-4 space-y-2">
                {a.quotes.map((q, j) => (
                  <blockquote key={j} className={`rounded-xl border-l-4 px-4 py-2.5 text-sm ${q.verified ? "border-emerald-400 bg-emerald-400/5" : "border-amber-400 bg-amber-400/5"}`}>
                    <p className="italic text-zinc-300">“{q.text}”</p>
                    <footer className={`mt-1.5 text-xs font-semibold ${q.verified ? "text-emerald-300" : "text-amber-300"}`}>
                      {q.verified ? "✓ Found word for word in the paper" : "⚠ Not found word for word in the paper. Treat with care."}
                    </footer>
                  </blockquote>
                ))}
              </div>
            )}
            {a.quotes.length === 0 && <p className="mt-3 text-xs font-semibold text-amber-300">⚠ No supporting quote was given for this answer. Treat with care.</p>}
          </article>
        ))}
      </div>
    </div>
  );
}

function Quiz({ kit, error, retry }: { kit: Kit | null; error: string | null; retry: () => void }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  if (!kit) return <Building error={error} retry={retry} what="quiz" />;
  if (kit.quiz.length === 0) return <p className="glass rounded-3xl p-6 text-center text-zinc-400">No quiz could be made for this one.</p>;

  const answered = Object.keys(picked).length;
  const score = kit.quiz.filter((q, i) => picked[i] === q.answer).length;
  const done = answered === kit.quiz.length;

  return (
    <div className="space-y-4">
      {kit.quiz.map((q, i) => {
        const chosen = picked[i];
        const locked = chosen !== undefined;
        return (
          <div key={i} className="glass rounded-3xl p-5">
            <div className="flex gap-3">
              <span className="hot grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white">{i + 1}</span>
              <h4 className="font-bold">{q.q}</h4>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {q.options.map((o, j) => {
                const right = locked && j === q.answer;
                const wrong = locked && j === chosen && j !== q.answer;
                return (
                  <button
                    key={j}
                    disabled={locked}
                    onClick={() => setPicked((p) => ({ ...p, [i]: j }))}
                    className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      right ? "pop border-emerald-400 bg-emerald-400/15 text-emerald-100" : wrong ? "border-rose-400 bg-rose-500/15 text-rose-100" : locked ? "border-white/10 text-zinc-500" : "chip border-white/10 bg-white/5 text-zinc-200"
                    }`}
                  >
                    <span className="mr-2 font-mono text-xs opacity-60">{"ABCD"[j]}</span>
                    {o} {right && "✓"} {wrong && "✗"}
                  </button>
                );
              })}
            </div>
            {locked && q.why && <p className="swap mt-3 text-sm text-zinc-400">💡 {q.why}</p>}
          </div>
        );
      })}
      {done && (
        <div className="ring-border pop rounded-3xl p-6 text-center">
          <div className="text-5xl">{score === kit.quiz.length ? "🏆" : score > 0 ? "👏" : "📚"}</div>
          <p className="mt-2 text-2xl font-extrabold">
            {score} / {kit.quiz.length}
          </p>
          <p className="mt-1 text-zinc-400">{score === kit.quiz.length ? "You've got this paper." : score > 0 ? "Close. Have another listen to the tricky part." : "Worth another listen."}</p>
          <button onClick={() => setPicked({})} className="btn mt-4 rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm font-semibold text-white">Try again</button>
        </div>
      )}
    </div>
  );
}
