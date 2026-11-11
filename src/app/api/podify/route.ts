import { createHash, randomUUID } from "node:crypto";
import { scrape, sourceFor, synthesize, writeScript } from "@/lib/pipeline";
import { BUCKET, supabaseAdmin, type Episode } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

// Guests can try Podify without an account. Voice minutes are the scarce resource, so cap them.
const GUEST_PER_VISITOR_PER_DAY = 2;
const GUEST_TOTAL_PER_DAY = 12;

type Event =
  | { step: "scraping" | "writing" | "recording" | "saving" }
  | { step: "done"; episode: Episode }
  | { step: "error"; message: string };

export async function POST(req: Request) {
  // --- auth: verify the Supabase access token sent by the browser
  //     (no token = guest: allowed, but limited)
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const admin = supabaseAdmin();
  let userId: string | null = null;
  if (token) {
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return Response.json({ error: "Session expired" }, { status: 401 });
    userId = userData.user.id;
  }

  // --- input
  const { url, role, goal } = (await req.json().catch(() => ({}))) as { url?: string; role?: string; goal?: string };

  // --- guest limits
  let guestHash: string | null = null;
  if (!userId) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    guestHash = createHash("sha256").update(`podify:${ip}`).digest("hex").slice(0, 32);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const guests = admin.from("episodes").select("id", { count: "exact", head: true }).is("user_id", null).gte("created_at", since);
    const [{ count: mine }, { count: everyone }] = await Promise.all([guests.eq("guest_ip_hash", guestHash), admin.from("episodes").select("id", { count: "exact", head: true }).is("user_id", null).gte("created_at", since)]);
    if ((mine ?? 0) >= GUEST_PER_VISITOR_PER_DAY) {
      return Response.json({ error: "You've pressed today's free guest records. Sign up free to keep going.", limit: "visitor" }, { status: 429 });
    }
    if ((everyone ?? 0) >= GUEST_TOTAL_PER_DAY) {
      return Response.json({ error: "The guest studio is fully booked today. Sign up free to press yours now.", limit: "global" }, { status: 429 });
    }
  }
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
        // Guests can pass a one-off role and goal instead.
        const { data: profile } = userId
          ? await admin.from("profiles").select("role, goal").eq("user_id", userId).maybeSingle()
          : { data: { role: typeof role === "string" ? role : "", goal: typeof goal === "string" ? goal : "" } };
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
        const path = `${userId ?? "guest"}/${id}.mp3`;
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
            guest_ip_hash: guestHash,
            // Kept so the companion (breakdown, quiz, questions) can work from the paper itself.
            source_text: sourceFor(article),
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

        // The visitor hash is for rate limiting only; it never leaves the server.
        send({ step: "done", episode: { ...(episode as Episode), guest_ip_hash: undefined, source_text: undefined } as Episode });
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
