import { randomUUID } from "node:crypto";
import { scrape, synthesize, writeScript } from "@/lib/pipeline";
import { BUCKET, supabaseAdmin, type Episode } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

type Event =
  | { step: "scraping" | "writing" | "recording" | "saving" }
  | { step: "done"; episode: Episode }
  | { step: "error"; message: string };

export async function POST(req: Request) {
  // --- auth: verify the Supabase access token sent by the browser
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return Response.json({ error: "Session expired" }, { status: 401 });
  const userId = userData.user.id;

  // --- input
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  let parsed: URL;
  try {
    parsed = new URL(String(url));
    if (!/^https?:$/.test(parsed.protocol)) throw new Error();
  } catch {
    return Response.json({ error: "Please paste a valid http(s) URL" }, { status: 400 });
  }

  // --- stream progress as NDJSON so the UI can show each step live
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: Event) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        send({ step: "scraping" });
        const article = await scrape(parsed.toString());

        send({ step: "writing" });
        // The profile is optional: a missing row or table just means a generic episode.
        const { data: profile } = await admin
          .from("profiles")
          .select("role, goal")
          .eq("user_id", userId)
          .maybeSingle();
        const { title, script, takeaways, action } = await writeScript(
          article.markdown,
          parsed.toString(),
          article.title,
          profile ?? {},
          article.kind,
        );

        send({ step: "recording" });
        const audio = await synthesize(script);

        send({ step: "saving" });
        const id = randomUUID();
        const path = `${userId}/${id}.mp3`;
        let up = await admin.storage.from(BUCKET).upload(path, audio, { contentType: "audio/mpeg" });
        if (up.error && /not found/i.test(up.error.message)) {
          // First run: create the public bucket automatically, then retry.
          await admin.storage.createBucket(BUCKET, { public: true });
          up = await admin.storage.from(BUCKET).upload(path, audio, { contentType: "audio/mpeg" });
        }
        if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);
        const audio_url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

        const { data: episode, error: dbErr } = await admin
          .from("episodes")
          .insert({
            id,
            user_id: userId,
            url: parsed.toString(),
            title,
            script,
            audio_url,
            takeaways,
            action,
            audio_bytes: audio.byteLength,
          })
          .select()
          .single();
        if (dbErr) {
          throw new Error(
            dbErr.message.includes("episodes")
              ? `Database table missing — run supabase/setup.sql (${dbErr.message})`
              : `Database insert failed: ${dbErr.message}`,
          );
        }

        send({ step: "done", episode: episode as Episode });
      } catch (err) {
        send({ step: "error", message: err instanceof Error ? err.message : "Something went wrong" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
