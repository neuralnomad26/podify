import { env } from "./env";

const MAX_INPUT_CHARS = 24_000; // keep the LLM call fast and cheap
const MAX_SCRIPT_WORDS = 350; // ~2 minutes of audio, friendly to free-tier TTS

async function readError(res: Response) {
  const text = await res.text().catch(() => "");
  return `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 300)}` : ""}`;
}

/** 1. Firecrawl: URL -> clean markdown */
export async function scrape(url: string): Promise<{ markdown: string; title?: string }> {
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
  return { markdown, title: json?.data?.metadata?.title || json?.data?.metadata?.ogTitle };
}

export type Listener = { role?: string; goal?: string };

/** 2. OpenRouter: article -> spoken podcast script, framed for one listener */
export async function writeScript(
  markdown: string,
  sourceUrl: string,
  pageTitle?: string,
  listener: Listener = {},
): Promise<{ title: string; script: string; takeaways: string[]; action: string | null }> {
  const role = listener.role?.trim().slice(0, 200);
  const goal = listener.goal?.trim().slice(0, 300);
  const forWhom =
    role || goal
      ? `This episode is for one specific listener${role ? `: ${role}` : ""}${goal ? `. Their current goal: ${goal}` : ""}. ` +
        `Pick the parts of the article that matter for them, explain why in passing, and skip what does not. ` +
        `Speak to them as "you". Never invent facts the article does not contain, and never read their role or goal back verbatim. `
      : "";
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
            `You turn articles into short solo podcast episodes. Write a warm, conversational script ` +
            `for ONE host to read aloud, at most ${MAX_SCRIPT_WORDS} words. Open with a hook, cover the ` +
            `key points accurately, close with a one-line takeaway. ${forWhom}Plain spoken English only: no ` +
            `markdown, no headings, no bullet points, no URLs, no stage directions, no emojis. ` +
            `Reply with JSON only: {"title": "<catchy episode title, max 8 words>", "script": "<script>", ` +
            `"takeaways": ["<three short takeaways, max 18 words each, grounded in the article>"], ` +
            `"action": "<one concrete thing the listener can do this week, max 25 words>"}`,
        },
        {
          role: "user",
          content: `Source: ${sourceUrl}\nPage title: ${pageTitle ?? "unknown"}\n\nArticle:\n${markdown.slice(0, MAX_INPUT_CHARS)}`,
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
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .slice(0, 3)
        .map((t) => stripMarkdown(t).slice(0, 200))
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
): { title?: string; script?: string; takeaways?: unknown; action?: unknown } | null {
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
