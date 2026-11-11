import type { NextRequest } from "next/server";
import { hostOf } from "@/lib/cover";
import { supabaseAdmin, type Episode } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORDS_PER_SECOND = 2.5;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function describe(ep: Episode) {
  const parts = [`A short audio take on an article from ${hostOf(ep.url)}.`];
  if (ep.takeaways?.length) parts.push("Takeaways: " + ep.takeaways.map((t, i) => `${i + 1}. ${t}`).join(" "));
  if (ep.action) parts.push(`Try this: ${ep.action}`);
  parts.push(`Original: ${ep.url}`);
  return parts.join("\n\n");
}

/**
 * Private podcast feed. The token in the URL is the only credential, so anyone
 * with the link can listen: treat it like a password. Paste the URL into a
 * podcast app ("Add a show by URL") and new episodes arrive there.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/feed/[token]">) {
  const { token } = await ctx.params;
  if (!UUID.test(token)) return new Response("Not found", { status: 404 });

  const admin = supabaseAdmin();
  const { data: profile } = await admin.from("profiles").select("user_id").eq("feed_token", token).maybeSingle();
  if (!profile) return new Response("Not found", { status: 404 });

  const { data } = await admin
    .from("episodes")
    .select("*")
    .eq("user_id", profile.user_id)
    .order("created_at", { ascending: false })
    .limit(100);
  const episodes = (data ?? []) as Episode[];

  const origin = req.nextUrl.origin;
  const self = `${origin}/feed/${token}`;
  const items = episodes
    .map((ep) => {
      const seconds = Math.max(1, Math.round(ep.script.split(/\s+/).length / WORDS_PER_SECOND));
      return `    <item>
      <title>${esc(ep.title)}</title>
      <description>${esc(describe(ep))}</description>
      <link>${esc(`${origin}/e/${ep.id}`)}</link>
      <guid isPermaLink="false">${ep.id}</guid>
      <pubDate>${new Date(ep.created_at).toUTCString()}</pubDate>
      <enclosure url="${esc(ep.audio_url)}" length="${ep.audio_bytes ?? 0}" type="audio/mpeg"/>
      <itunes:duration>${seconds}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>My Podify</title>
    <link>${esc(origin)}</link>
    <atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>
    <description>Articles I saved, turned into short episodes written for me.</description>
    <language>en</language>
    <itunes:author>Podify</itunes:author>
    <itunes:explicit>false</itunes:explicit>
    <itunes:block>Yes</itunes:block>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
