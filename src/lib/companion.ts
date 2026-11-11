import { createHash } from "node:crypto";
import { askModel, scrape, sourceFor } from "./pipeline";
import { supabaseAdmin, type Answer, type Episode, type Kit, type Quote } from "./supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const QUESTIONS_PER_VISITOR_PER_DAY = 25;

export const visitorHash = (req: Request) =>
  createHash("sha256").update(`podify:${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}`).digest("hex").slice(0, 32);

/** Loads an episode with its source text, fetching and saving the text for older records that lack it. */
export async function episodeWithSource(id: string): Promise<(Episode & { source_text: string }) | null> {
  if (!UUID.test(id)) return null;
  const admin = supabaseAdmin();
  const { data } = await admin.from("episodes").select("*").eq("id", id).maybeSingle();
  const ep = data as Episode | null;
  if (!ep) return null;
  if (!ep.source_text) {
    ep.source_text = sourceFor(await scrape(ep.url));
    await admin.from("episodes").update({ source_text: ep.source_text }).eq("id", id);
  }
  return ep as Episode & { source_text: string };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Builds the study kit once and caches it on the episode. */
export async function kitFor(id: string): Promise<Kit | null> {
  const ep = await episodeWithSource(id);
  if (!ep) return null;
  if (ep.kit) return ep.kit;

  const raw = await askModel<Record<string, unknown>>(
    `You make study kits from research papers and articles for a smart reader who is not a specialist. ` +
      `Use ONLY what the text says. Never invent numbers, names or claims; if the text does not give something, leave it out. ` +
      `Write in plain English, short sentences, no markdown. Reply with JSON only, in exactly this shape:\n` +
      `{"tldr": "<one sentence, max 30 words>",` +
      ` "breakdown": {"problem": "<what question or gap, 1-2 sentences>", "approach": "<what the authors did, 2-3 sentences>",` +
      ` "results": "<what they found, with real numbers from the text, 2-3 sentences>", "limitations": "<honest limits or open questions, 1-2 sentences>",` +
      ` "why_it_matters": "<1-2 sentences>"},` +
      ` "numbers": [{"value": "<a number exactly as written in the text, with its unit>", "meaning": "<what it measures, max 15 words>"}],` +
      ` "glossary": [{"term": "<jargon term from the text>", "plain": "<plain-English meaning, max 20 words>"}],` +
      ` "quiz": [{"q": "<question testing understanding, not trivia>", "options": ["<4 short options>"], "answer": <index 0-3 of the correct option>, "why": "<one sentence>"}],` +
      ` "read_it_if": "<who should read the full text, max 20 words>", "skip_it_if": "<who can stop at this summary, max 20 words>"}\n` +
      `Give at most 4 numbers, 4 to 6 glossary terms, and exactly 3 quiz questions with the correct answer in varied positions.`,
    `Title: ${ep.title}\nSource: ${ep.url}\n\nText:\n${ep.source_text}`,
  );
  if (!raw) throw new Error("The model did not return a study kit. Try again.");

  const b = (raw.breakdown ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const kit: Kit = {
    tldr: str(raw.tldr, 300),
    breakdown: {
      problem: str(b.problem, 600), approach: str(b.approach, 800), results: str(b.results, 800),
      limitations: str(b.limitations, 600), why_it_matters: str(b.why_it_matters, 600),
    },
    numbers: list(raw.numbers).map((n) => ({ value: str(n.value, 60), meaning: str(n.meaning, 160) })).filter((n) => n.value && n.meaning).slice(0, 4),
    glossary: list(raw.glossary).map((g) => ({ term: str(g.term, 60), plain: str(g.plain, 200) })).filter((g) => g.term && g.plain).slice(0, 6),
    quiz: list(raw.quiz)
      .map((q) => ({
        q: str(q.q, 300),
        options: (Array.isArray(q.options) ? q.options : []).map((o) => str(o, 160)).filter(Boolean).slice(0, 4),
        answer: Number.isInteger(q.answer) ? (q.answer as number) : -1,
        why: str(q.why, 300),
      }))
      .filter((q) => q.q && q.options.length === 4 && q.answer >= 0 && q.answer < 4)
      .slice(0, 3),
    read_it_if: str(raw.read_it_if, 200),
    skip_it_if: str(raw.skip_it_if, 200),
  };
  if (!kit.tldr || !kit.breakdown.problem) throw new Error("The study kit came back incomplete. Try again.");
  await supabaseAdmin().from("episodes").update({ kit }).eq("id", id);
  return kit;
}

const squash = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

/** A quote counts as verified only if it appears in the source text, ignoring spacing and case. */
export function verifyQuotes(quotes: unknown, source: string): Quote[] {
  const hay = squash(source);
  return (Array.isArray(quotes) ? quotes : [])
    .map((q) => str(q, 500))
    .filter((q) => q.length >= 15)
    .slice(0, 3)
    .map((text) => ({ text, verified: hay.includes(squash(text).replace(/^["'.…\s]+|["'.…\s]+$/g, "")) }));
}

/** Answers a question from the paper's text and attaches the passages it relied on. */
export async function answerQuestion(id: string, question: string, ipHash: string): Promise<Answer | { error: string; status: number }> {
  const q = question.trim().replace(/\s+/g, " ").slice(0, 300);
  if (q.length < 3) return { error: "Ask a question about the paper.", status: 400 };
  const admin = supabaseAdmin();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from("questions").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since);
  if ((count ?? 0) >= QUESTIONS_PER_VISITOR_PER_DAY) return { error: "That's today's question limit. Come back tomorrow.", status: 429 };

  const ep = await episodeWithSource(id);
  if (!ep) return { error: "Episode not found.", status: 404 };

  const raw = await askModel<{ answer?: unknown; quotes?: unknown }>(
    `You answer questions about one document. Use ONLY the document. ` +
      `If the document does not contain the answer, say so plainly and say what it does cover instead; never guess or use outside knowledge. ` +
      `Answer in 2 to 5 plain-English sentences for a smart non-specialist, no markdown. ` +
      `Then give up to 3 supporting quotes copied EXACTLY, character for character, from the document (one sentence each, no ellipses, no edits). ` +
      `Reply with JSON only: {"answer": "<answer>", "quotes": ["<exact quote>", "..."]}`,
    `Document title: ${ep.title}\n\nDocument:\n${ep.source_text}\n\nQuestion: ${q}`,
    0.2,
  );
  const answer = str(raw?.answer, 1500);
  if (!answer) return { error: "No answer came back. Try rephrasing.", status: 502 };
  const quotes = verifyQuotes(raw?.quotes, ep.source_text);

  const { data } = await admin.from("questions").insert({ episode_id: id, question: q, answer, quotes, ip_hash: ipHash }).select("id, created_at").single();
  return { id: data?.id, created_at: data?.created_at, question: q, answer, quotes };
}

export async function recentQuestions(id: string): Promise<Answer[]> {
  if (!UUID.test(id)) return [];
  const { data } = await supabaseAdmin().from("questions").select("id, question, answer, quotes, created_at").eq("episode_id", id).order("created_at", { ascending: false }).limit(8);
  return (data ?? []) as Answer[];
}
