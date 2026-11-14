import { randomUUID } from "node:crypto";
import { scrape, sourceFor, synthesize, writeScript } from "@/lib/pipeline";
import { BUCKET, supabaseAdmin, type Episode } from "@/lib/supabase-admin";

export type Step = "scraping" | "writing" | "recording" | "saving";

export type CreateInput = {
  url: string;
  userId: string | null;
  guestHash: string | null;
  profile: { role?: string; goal?: string };
  onStep?: (step: Step) => void;
};

/** Parses a user-supplied link; returns null unless it is http(s). */
export function parseUrl(raw: unknown): URL | null {
  try {
    const u = new URL(String(raw));
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

/** Scrape, write, record and save one episode. Shared by the app and the paid agent API. */
export async function createEpisode({ url, userId, guestHash, profile, onStep }: CreateInput): Promise<Episode> {
  const admin = supabaseAdmin();

  onStep?.("scraping");
  const article = await scrape(url);

  onStep?.("writing");
  const { title, script, takeaways, action } = await writeScript(article.markdown, url, article.title, profile, article.kind);

  onStep?.("recording");
  const audio = await synthesize(script);

  onStep?.("saving");
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
      url,
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

  // The visitor hash is for rate limiting only and the source text is large: neither leaves the server.
  return { ...(episode as Episode), guest_ip_hash: undefined, source_text: undefined } as Episode;
}
