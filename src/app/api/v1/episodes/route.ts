import { createEpisode, parseUrl } from "@/lib/episodes";
import { env } from "@/lib/env";
import { episodeCharge, payerOf } from "@/lib/mpp";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Voice minutes are finite even when paid for: stop selling before the quota runs out.
const PAID_PER_DAY = 25;

/**
 * Agent API: one podcast episode per MPP payment, no account needed.
 * 1. POST { url } with no payment -> 402 with a Payment challenge.
 * 2. Pay it and resend the same body -> 200 with the episode (audio URL, script, takeaways).
 */
export async function POST(request: Request) {
  const body = (await request.clone().json().catch(() => ({}))) as { url?: unknown; role?: unknown; goal?: unknown };
  const parsed = parseUrl(body.url);
  if (!parsed) return Response.json({ error: "invalid_url", message: "Send JSON { \"url\": \"https://...\" }." }, { status: 400 });

  // Check capacity before taking money, so nobody pays for a refusal.
  const admin = supabaseAdmin();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: countErr } = await admin.from("episodes").select("id", { count: "exact", head: true }).not("payer", "is", null).gte("created_at", since);
  if (countErr) return Response.json({ error: "unavailable", message: "Run supabase/setup.sql (episodes.payer missing)." }, { status: 503 });
  if ((count ?? 0) >= PAID_PER_DAY) {
    return Response.json({ error: "sold_out", message: "Today's studio time is sold out. Try again tomorrow." }, { status: 429 });
  }

  const charge = await episodeCharge()(request);
  if (charge.status === 402) return charge.challenge;

  const payer = payerOf(request) ?? "unknown";
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");
  try {
    const ep = await createEpisode({ url: parsed.toString(), userId: null, guestHash: null, profile: { role: str(body.role), goal: str(body.goal) } });
    await admin.from("episodes").update({ payer }).eq("id", ep.id);
    const origin = env.publicOrigin() ?? new URL(request.url).origin;
    return charge.withReceipt(
      Response.json({
        id: ep.id,
        title: ep.title,
        audio_url: ep.audio_url,
        page_url: `${origin}/e/${ep.id}`,
        takeaways: ep.takeaways,
        action: ep.action,
        script: ep.script,
        source_url: ep.url,
      }),
    );
  } catch (err) {
    // Payment settled but the episode failed: keep the receipt so it can be refunded by hand.
    console.error("[podify] paid episode failed", { payer, url: parsed.toString(), err });
    return charge.withReceipt(
      Response.json(
        { error: "episode_failed", message: err instanceof Error ? err.message : "Something went wrong", payer, note: "Keep the Payment-Receipt header; failed paid episodes are refunded on request." },
        { status: 502 },
      ),
    );
  }
}
