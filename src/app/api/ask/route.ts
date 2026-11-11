import { answerQuestion, recentQuestions, visitorHash } from "@/lib/companion";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Ask the paper a question. The answer comes with quotes checked against the source text. */
export async function POST(req: Request) {
  const { id, question } = (await req.json().catch(() => ({}))) as { id?: string; question?: string };
  try {
    const out = await answerQuestion(String(id), String(question ?? ""), visitorHash(req));
    if ("error" in out) return Response.json({ error: out.error }, { status: out.status });
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not answer that." }, { status: 502 });
  }
}

/** Questions people have already asked about this episode. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return Response.json({ questions: await recentQuestions(id) });
}
