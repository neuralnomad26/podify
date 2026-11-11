import { env } from "./env";

const MAX_INPUT_CHARS = 24_000; // keep the LLM call fast and cheap
const MAX_SCRIPT_WORDS = 350; // ~2 minutes of audio, friendly to free-tier TTS

async function readError(res: Response) {
  const text = await res.text().catch(() => "");
  return `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 300)}` : ""}`;
}

export type SourceKind = "article" | "paper";

const PAPER_HOSTS =
  /(^|\.)(arxiv\.org|biorxiv\.org|medrxiv\.org|openreview\.net|aclanthology\.org|doi\.org|ncbi\.nlm\.nih\.gov|semanticscholar\.org|ssrn\.com|nature\.com|sciencedirect\.com|acm\.org|ieee\.org)$/i;

/** Landing pages only carry the abstract, so read the full text where we know how to find it. */
export function fullTextUrl(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)arxiv\.org$/i.test(u.hostname)) {
      const m = u.pathname.match(/^\/abs\/(.+)$/);
      if (m) return `https://arxiv.org/pdf/${m[1]}`;
    }
    if (/(^|\.)openreview\.net$/i.test(u.hostname) && u.pathname === "/forum" && u.searchParams.get("id")) {
      return `https://openreview.net/pdf?id=${u.searchParams.get("id")}`;
    }
    if (/(^|\.)(biorxiv|medrxiv)\.org$/i.test(u.hostname) && /^\/content\//.test(u.pathname) && !/\.full(\.pdf)?$/.test(u.pathname)) {
      return `${u.origin}${u.pathname}.full`;
    }
  } catch {}
  return url;
}

function looksLikePaper(url: string, markdown: string, contentType?: string): boolean {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {}
  if (PAPER_HOSTS.test(host)) return true;
  const hasAbstract = /\babstract\b/i.test(markdown.slice(0, 4000));
  const hasRefs = /^\s*(#+\s*)?(references|bibliography)\s*$/im.test(markdown);
  return (hasAbstract && hasRefs) || (Boolean(contentType?.includes("pdf")) && hasRefs);
}

/**
 * Papers are long and the useful parts sit at both ends: drop the reference
 * list and appendices, then keep the opening (abstract, intro, method) and the
 * closing (results, discussion, conclusion) instead of only the first N chars.
 */
export function fitPaper(markdown: string, max: number): string {
  const lines = markdown.split("\n");
  let cut = -1;
  for (let i = lines.length - 1; i > lines.length * 0.4; i--) {
    if (/^\s*(#+\s*)?(\d+\.?\s*)?(references|bibliography)\s*$/i.test(lines[i])) {
      cut = i;
      break;
    }
  }
  const body = (cut > 0 ? lines.slice(0, cut) : lines).join("\n");
  if (body.length <= max) return body;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return `${body.slice(0, head)}\n\n[... middle of the paper omitted ...]\n\n${body.slice(-tail)}`;
}

/** The text every later step works from: the whole article, or a paper's opening and closing sections. */
export function sourceFor(article: { markdown: string; kind: SourceKind }): string {
  return article.kind === "paper" ? fitPaper(article.markdown, MAX_INPUT_CHARS) : article.markdown.slice(0, MAX_INPUT_CHARS);
}

/**
 * One OpenRouter call that must answer in JSON. Uses the same model list as the
 * script writer, so a rate-limited free model falls through to the next.
 */
export async function askModel<T>(system: string, user: string, temperature = 0.3): Promise<T | null> {
  const models = env.openrouterModels();
  const call = () =>
    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openrouterKey()}`, "Content-Type": "application/json", "X-Title": "Podify" },
      body: JSON.stringify({
        ...(models.length > 1 ? { models } : { model: models[0] }),
        temperature,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
  let res = await call();
  // Free models are often briefly rate-limited or slow upstream: one retry, then give up politely.
  if ([408, 429, 502, 503, 504].includes(res.status)) {
    await new Promise((r) => setTimeout(r, 2500));
    res = await call();
  }
  if ([408, 429, 502, 503, 504].includes(res.status)) throw new Error("The free AI model is busy right now. Give it a few seconds and try again.");
  if (!res.ok) throw new Error(`OpenRouter failed (${await readError(res)})`);
  const json = await res.json();
  const raw: string = json?.choices?.[0]?.message?.content ?? "";
  return parseJsonLoose(raw) as T | null;
}

/** 1. Firecrawl: URL -> clean markdown (web pages and PDFs) */
export async function scrape(
  inputUrl: string,
): Promise<{ markdown: string; title?: string; kind: SourceKind }> {
  const url = fullTextUrl(inputUrl);
  const body = JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true });
  const headers = {
    Authorization: `Bearer ${env.firecrawlKey()}`,
    "Content-Type": "application/json",
  };
  // Prefer v2, fall back to v1 if this account/region doesn't have it.
  let res = await fetch("https://api.firecrawl.dev/v2/scrape", { method: "POST", headers, body });
  if (res.status === 404) {
    res = await fetch("https://api.firecrawl.dev/v1/scrape", { method: "POST", headers, body });
  }
  if (!res.ok) throw new Error(`Firecrawl failed (${await readError(res)})`);
  const json = await res.json();
  const markdown: string | undefined = json?.data?.markdown;
  if (!markdown || markdown.trim().length < 200) {
    throw new Error("Couldn't extract enough article text from that page. Try a different link.");
  }
  const meta = json?.data?.metadata ?? {};
  const kind: SourceKind = looksLikePaper(url, markdown, meta.contentType) ? "paper" : "article";
  // PDFs carry no page title: fall back to the first heading.
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return { markdown, title: meta.title || meta.ogTitle || heading, kind };
}

export type Listener = { role?: string; goal?: string };

/** 2. OpenRouter: article -> spoken podcast script, framed for one listener */
export async function writeScript(
  markdown: string,
  sourceUrl: string,
  pageTitle?: string,
  listener: Listener = {},
  kind: SourceKind = "article",
): Promise<{ title: string; script: string; takeaways: string[]; action: string | null }> {
  const role = listener.role?.trim().slice(0, 200);
  const goal = listener.goal?.trim().slice(0, 300);
  const forWhom =
    role || goal
      ? `This episode is for one specific listener${role ? `: ${role}` : ""}${goal ? `. Their current goal: ${goal}` : ""}. ` +
        `Pick the parts of the article that matter for them, explain why in passing, and skip what does not. ` +
        `Speak to them as "you". Never invent facts the article does not contain, and never read their role or goal back verbatim. `
      : "";
  const isPaper = kind === "paper";
  const brief = isPaper
    ? `You turn research papers into short solo podcast episodes for a smart listener who is not a specialist. ` +
      `Write a warm, conversational script for ONE host to read aloud, at most ${MAX_SCRIPT_WORDS} words. ` +
      `Open with the question the paper tries to answer and why anyone should care. Then say what the authors ` +
      `actually did, the main result with one or two real numbers from the paper, and one honest limitation or ` +
      `open question. Explain any term a newcomer would not know in a few plain words. Do not overstate: say ` +
      `"the authors report" rather than presenting findings as settled fact, and never invent numbers. ` +
      `Skip author lists, affiliations, citations, equations and section names. Close with a one-line takeaway. `
    : `You turn articles into short solo podcast episodes. Write a warm, conversational script ` +
      `for ONE host to read aloud, at most ${MAX_SCRIPT_WORDS} words. Open with a hook, cover the ` +
      `key points accurately, close with a one-line takeaway. `;
  const source = isPaper ? fitPaper(markdown, MAX_INPUT_CHARS) : markdown.slice(0, MAX_INPUT_CHARS);
  const models = env.openrouterModels();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openrouterKey()}`,
      "Content-Type": "application/json",
      "X-Title": "Podify",
    },
    body: JSON.stringify({
      ...(models.length > 1 ? { models } : { model: models[0] }),
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            `${brief}${forWhom}Plain spoken English only: no ` +
            `markdown, no headings, no bullet points, no URLs, no stage directions, no emojis. ` +
            `Reply with JSON only: {"title": "<catchy episode title, max 8 words>", "script": "<script>", ` +
            `"takeaways": ["<three short takeaways, max 18 words each, grounded in the article>"], ` +
            `"action": "<one concrete thing the listener can do this week, max 25 words>"}`,
        },
        {
          role: "user",
          content: `Source: ${sourceUrl}\nTitle: ${pageTitle ?? "unknown"}\n\n${isPaper ? "Paper" : "Article"}:\n${source}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter failed (${await readError(res)})`);
  const json = await res.json();
  const raw: string = json?.choices?.[0]?.message?.content ?? "";
  const parsed = parseJsonLoose(raw);
  const script = clampWords(stripMarkdown(parsed?.script ?? raw), MAX_SCRIPT_WORDS);
  if (script.length < 50) throw new Error("The model returned an empty script. Try again.");
  const title = (parsed?.title || pageTitle || "Untitled episode").toString().slice(0, 120);
  const takeaways = Array.isArray(parsed?.takeaways)
    ? parsed.takeaways
        .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
        .slice(0, 3)
        .map((t: string) => stripMarkdown(t).slice(0, 200))
    : [];
  const action = typeof parsed?.action === "string" && parsed.action.trim() ? stripMarkdown(parsed.action).slice(0, 240) : null;
  return { title, script, takeaways, action };
}

/** 3. ElevenLabs: script -> MP3 bytes */
export async function synthesize(script: string): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${env.elevenlabsVoice()}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": env.elevenlabsKey(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text: script, model_id: "eleven_flash_v2_5" }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs failed (${await readError(res)})`);
  return res.arrayBuffer();
}

function parseJsonLoose(
  raw: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers validate the shape they asked for
): any {
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return null;
  }
}

function stripMarkdown(s: string) {
  return s
    .replace(/[*_#>`]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clampWords(s: string, max: number) {
  const words = s.split(/\s+/);
  if (words.length <= max) return s;
  const cut = words.slice(0, max).join(" ");
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return lastStop > cut.length * 0.6 ? cut.slice(0, lastStop + 1) : cut + "…";
}
